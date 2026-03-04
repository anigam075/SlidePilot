const uploadForm = document.getElementById("uploadForm");
const pptFileInput = document.getElementById("pptFile");
const statusBox = document.getElementById("status");

const deckPanel = document.getElementById("deckPanel");
const slideTitle = document.getElementById("slideTitle");
const slideCounter = document.getElementById("slideCounter");
const slideImage = document.getElementById("slideImage");
const slideImageHint = document.getElementById("slideImageHint");
const scriptBox = document.getElementById("scriptBox");
const answerBox = document.getElementById("answerBox");
const qnaSection = document.getElementById("qnaSection");
const audioPlayer = new Audio();

const prevBtn = document.getElementById("prevBtn");
const narrateBtn = document.getElementById("narrateBtn");
const askBtn = document.getElementById("askBtn");
const questionInput = document.getElementById("questionInput");

let deck = null;
let currentSlideIndex = 0;
let autoPresentationRunning = false;
let isPaused = false;
let hasCompletedPresentation = false;

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.style.color = isError ? "#b00020" : "#475569";
}

function currentSlide() {
  return deck?.slides?.[currentSlideIndex] || null;
}

function renderSlide() {
  const slide = currentSlide();
  if (!slide) return;
  slideTitle.textContent = `Slide ${slide.slide_number}`;
  slideCounter.textContent = `${slide.slide_number} / ${deck.total_slides}`;
  if (slide.image_url) {
    slideImage.src = slide.image_url;
    slideImage.classList.remove("hidden");
    slideImageHint.textContent = "";
  } else {
    slideImage.src = "";
    slideImage.classList.add("hidden");
    slideImageHint.textContent = "Slide preview image not available for this slide.";
  }
  scriptBox.textContent = slide.script || "";
  answerBox.textContent = "";
  questionInput.value = "";
  audioPlayer.src = slide.audio_url || "";

  prevBtn.disabled = currentSlideIndex === 0;
  if (autoPresentationRunning) {
    prevBtn.disabled = true;
  }
}

function setPresentationButtonIdle() {
  autoPresentationRunning = false;
  isPaused = false;
  narrateBtn.disabled = !deck;
  narrateBtn.textContent = hasCompletedPresentation
    ? "Replay Presentation"
    : "Start Presentation";
  prevBtn.disabled = currentSlideIndex === 0;
}

function waitForAudioToEnd() {
  return new Promise((resolve, reject) => {
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Audio playback failed."));
    };
    const cleanup = () => {
      audioPlayer.removeEventListener("ended", onEnded);
      audioPlayer.removeEventListener("error", onError);
    };
    audioPlayer.addEventListener("ended", onEnded, { once: true });
    audioPlayer.addEventListener("error", onError, { once: true });
  });
}

async function playCurrentSlideAudioAuto() {
  const slide = currentSlide();
  if (!deck || !slide) return;
  if (!slide.audio_url) {
    throw new Error(`Missing narration audio for slide ${slide.slide_number}.`);
  }

  prevBtn.disabled = true;
  renderSlide();
  setStatus(`Playing slide ${slide.slide_number} narration...`);
  await audioPlayer.play();
  await waitForAudioToEnd();
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pptFileInput.files.length) {
    setStatus("Choose a .pptx file first.", true);
    return;
  }
  const file = pptFileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);

  try {
    setStatus("Uploading and parsing deck...");
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Upload failed");
    }

    deck = await response.json();
    currentSlideIndex = 0;
    autoPresentationRunning = false;
    isPaused = false;
    hasCompletedPresentation = false;
    deckPanel.classList.remove("hidden");
    qnaSection.classList.add("hidden");
    setPresentationButtonIdle();
    renderSlide();
    if (deck.render_warning) {
      setStatus(
        `Loaded ${deck.filename} with ${deck.total_slides} slides. Image rendering warning: ${deck.render_warning}`,
        true
      );
    } else {
      setStatus(`Loaded ${deck.filename} with ${deck.total_slides} slides.`);
    }
  } catch (error) {
    setStatus(error.message || "Upload failed", true);
  }
});

narrateBtn.addEventListener("click", async () => {
  if (!deck) return;
  if (autoPresentationRunning) {
    if (isPaused) {
      try {
        await audioPlayer.play();
        isPaused = false;
        narrateBtn.textContent = "Pause";
        setStatus("Presentation resumed.");
      } catch {
        setStatus("Unable to resume audio playback.", true);
      }
    } else {
      audioPlayer.pause();
      isPaused = true;
      narrateBtn.textContent = "Play";
      setStatus("Presentation paused.");
    }
    return;
  }

  try {
    if (hasCompletedPresentation) {
      currentSlideIndex = 0;
      renderSlide();
    }

    narrateBtn.disabled = true;
    qnaSection.classList.add("hidden");
    answerBox.textContent = "";
    setStatus("Engines on. Prepping all slide narrations for smooth playback...");
    const prepareResponse = await fetch(`/api/decks/${deck.deck_id}/prepare`, {
      method: "POST",
    });
    if (!prepareResponse.ok) {
      const err = await prepareResponse.json();
      throw new Error(err.detail || "Preparation failed");
    }
    const prepared = await prepareResponse.json();
    deck.slides = prepared.slides || deck.slides;
    deck.closing_statement = prepared.closing_statement;
    deck.closing_audio_url = prepared.closing_audio_url;

    autoPresentationRunning = true;
    hasCompletedPresentation = false;
    isPaused = false;
    narrateBtn.disabled = false;
    narrateBtn.textContent = "Pause";
    while (autoPresentationRunning && deck && currentSlideIndex < deck.total_slides) {
      await playCurrentSlideAudioAuto();
      if (!autoPresentationRunning) return;
      if (currentSlideIndex < deck.total_slides - 1) {
        currentSlideIndex += 1;
        renderSlide();
      } else {
        break;
      }
    }

    hasCompletedPresentation = true;
    const closingStatement =
      deck.closing_statement ||
      "If you have any question, feel free to drop your query in the QnA section. I will be happy to answer.";
    setStatus(closingStatement);
    if (deck.closing_audio_url) {
      audioPlayer.src = deck.closing_audio_url;
      await audioPlayer.play();
      await waitForAudioToEnd();
    }
    setPresentationButtonIdle();
    qnaSection.classList.remove("hidden");
    setStatus("Narration complete. Ask anything in the QnA zone.");
  } catch (error) {
    setPresentationButtonIdle();
    setStatus(error.message || "Presentation failed", true);
  }
});

prevBtn.addEventListener("click", () => {
  if (!deck || currentSlideIndex === 0) return;
  currentSlideIndex -= 1;
  renderSlide();
});

askBtn.addEventListener("click", async () => {
  const question = questionInput.value.trim();
  if (!deck) return;
  if (qnaSection.classList.contains("hidden")) {
    setStatus("QnA opens after presentation finishes.", true);
    return;
  }
  if (!question) {
    setStatus("Enter a question first.", true);
    return;
  }

  try {
    setStatus("Answering your presentation question...");
    askBtn.disabled = true;
    answerBox.textContent = "";
    const response = await fetch(`/api/decks/${deck.deck_id}/qna`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "QnA failed");
    }
    const payload = await response.json();
    answerBox.textContent = payload.answer;
    if (payload.audio_url) {
      audioPlayer.src = payload.audio_url;
      audioPlayer.play();
    }
    setStatus("Answer generated.");
  } catch (error) {
    setStatus(error.message || "QnA failed", true);
  } finally {
    askBtn.disabled = false;
  }
});
