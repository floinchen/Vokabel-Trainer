/* =========================================================
   Vokabeltrainer – Spiellogik
   Vokabeln werden aus "vokabeln.csv" geladen
   (Format: level;deutsch;englisch – mehrere richtige
   Antworten mit "|" trennen, z. B. "street|road")
   ========================================================= */

// ---------- Konstanten ----------
const CSV_FILE        = "vokabeln.csv";
const POINTS_PER_WORD = 10;   // FR-06
const POINTS_PER_LEVEL = 100; // FR-07
const MAX_LEVEL       = 5;    // FR-08
const START_LIVES     = 3;    // FR-09
const TIME_PER_WORD   = 20;   // FR-05 (Sekunden)
const FEEDBACK_DELAY  = 1500; // Anzeigedauer der Rückmeldung (ms)

// ---------- Spielzustand ----------
let vocabulary = [];          // alle Vokabeln aus der CSV
const state = {
  points: 0,
  level: 0,
  lives: START_LIVES,
  solved: new Set(),          // IDs bereits korrekt übersetzter Vokabeln (FR-13)
  current: null,              // aktuell angezeigte Vokabel
  timeLeft: TIME_PER_WORD,
  timerId: null,
  locked: false               // sperrt Eingaben während der Rückmeldung
};

// ---------- DOM-Elemente ----------
const $ = (id) => document.getElementById(id);
const el = {
  startBtn:    $("start-btn"),
  retryBtn:    $("retry-btn"),
  restartBtn:  $("restart-btn"),
  csvFallback: $("csv-fallback"),
  csvInput:    $("csv-input"),
  levelHeader: $("level-header"),
  word:        $("word"),
  form:        $("answer-form"),
  input:       $("answer-input"),
  checkBtn:    $("check-btn"),
  feedback:    $("feedback"),
  timer:       $("timer"),
  points:      $("points"),
  level:       $("level"),
  lives:       $("lives")
};

// =========================================================
// Data Handling (CSV)
// =========================================================

/** Wandelt den CSV-Text in ein Array von Vokabel-Objekten um. */
function parseCSV(text) {
  const lines = text
    .replace(/^﻿/, "")           // BOM entfernen (z. B. aus Excel)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const result = [];
  // Zeile 0 = Kopfzeile (level;deutsch;englisch)
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(";");
    if (parts.length < 3) continue;

    const level   = parseInt(parts[0], 10);
    const german  = parts[1].trim();
    const answers = parts[2]
      .split("|")
      .map(normalize)
      .filter((a) => a !== "");

    if (isNaN(level) || german === "" || answers.length === 0) continue;

    result.push({
      id: i,
      level: level,
      german: german,
      english: answers,
      display: parts[2].split("|")[0].trim() // für die Anzeige der Lösung
    });
  }
  return result;
}

/** Lädt die CSV automatisch (funktioniert über einen lokalen Webserver). */
async function loadVocabulary() {
  try {
    const response = await fetch(CSV_FILE, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    setVocabulary(parseCSV(await response.text()));
  } catch (err) {
    // Beim Öffnen per Doppelklick (file://) blockiert der Browser fetch –
    // dann kann die CSV manuell ausgewählt werden.
    console.warn("CSV konnte nicht automatisch geladen werden:", err);
    el.startBtn.textContent = "Spiel starten";
    el.csvFallback.classList.remove("hidden");
  }
}

/** Manuelle Auswahl der CSV-Datei über das Datei-Eingabefeld. */
el.csvInput.addEventListener("change", () => {
  const file = el.csvInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setVocabulary(parseCSV(reader.result));
  reader.readAsText(file, "UTF-8");
});

function setVocabulary(list) {
  if (list.length === 0) {
    alert("Die CSV-Datei enthält keine gültigen Vokabeln.");
    return;
  }
  vocabulary = list;
  el.csvFallback.classList.add("hidden");
  el.startBtn.disabled = false;
  el.startBtn.textContent = "Spiel starten";
}

// =========================================================
// Bildschirme
// =========================================================

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

// =========================================================
// Algorithmus 1: Antwortkontrolle
// =========================================================

function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isCorrect(answer, vocab) {
  return vocab.english.includes(normalize(answer));
}

// =========================================================
// Vokabelauswahl (FR-13, FR-14)
// =========================================================

function pickNextWord() {
  const notSolved = vocabulary.filter((v) => !state.solved.has(v.id));

  // bevorzugt Vokabeln des aktuellen Levels
  let pool = notSolved.filter((v) => v.level === state.level);
  // Fallback: falls das Level leer ist, nächstgelegenes Level verwenden
  if (pool.length === 0) {
    pool = notSolved.slice().sort(
      (a, b) => Math.abs(a.level - state.level) - Math.abs(b.level - state.level)
    );
    if (pool.length > 0) {
      const nearest = pool[0].level;
      pool = pool.filter((v) => v.level === nearest);
    }
  }
  if (pool.length === 0) return null;

  // dieselbe Vokabel nicht zweimal hintereinander (wenn möglich)
  if (pool.length > 1 && state.current) {
    pool = pool.filter((v) => v.id !== state.current.id);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function showNextWord() {
  const next = pickNextWord();
  if (!next) {
    // keine Vokabeln mehr übrig – als geschafft werten
    showWin();
    return;
  }
  state.current = next;
  state.locked = false;

  el.word.textContent = next.german;
  el.input.value = "";
  el.input.disabled = false;
  el.checkBtn.disabled = false;
  el.feedback.textContent = "";
  el.feedback.className = "feedback";
  el.input.focus();

  startTimer();
}

// =========================================================
// Timer (FR-05, FR-16)
// =========================================================

function startTimer() {
  stopTimer();
  state.timeLeft = TIME_PER_WORD;
  renderTimer();
  state.timerId = setInterval(() => {
    state.timeLeft--;
    renderTimer();
    if (state.timeLeft <= 0) {
      stopTimer();
      handleAnswer(null); // Zeit abgelaufen = falsche Antwort
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerId !== null) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function renderTimer() {
  el.timer.textContent = "Zeit: " + state.timeLeft + " s";
  el.timer.classList.toggle("warning", state.timeLeft <= 5);
}

// =========================================================
// Algorithmus 2: Level + Leben
// =========================================================

function handleAnswer(answer) {
  if (state.locked) return;
  state.locked = true;
  stopTimer();
  el.input.disabled = true;
  el.checkBtn.disabled = true;

  const vocab = state.current;

  if (answer !== null && isCorrect(answer, vocab)) {
    // korrekt: +10 Punkte, bei 100 Punkten Levelaufstieg
    state.solved.add(vocab.id);
    state.points += POINTS_PER_WORD;
    let levelUp = false;
    if (state.points >= POINTS_PER_LEVEL) {
      state.points = 0;
      state.level++;
      levelUp = true;
    }
    showFeedback(levelUp ? "Richtig! Level " + state.level + " erreicht!" : "Richtig! +10 Punkte", true);
    renderStatus();

    // Algorithmus 3: Beendigung bei Level 5
    if (state.level >= MAX_LEVEL) {
      setTimeout(showWin, FEEDBACK_DELAY);
      return;
    }
  } else {
    // inkorrekt: ein Leben weniger (Leben regenerieren sich beim Levelaufstieg nicht)
    state.lives--;
    const prefix = answer === null ? "Zeit abgelaufen! " : "Leider falsch! ";
    showFeedback(prefix + "Richtig wäre: " + vocab.display, false);
    renderStatus();

    // Algorithmus 5: alle Leben verloren
    if (state.lives <= 0) {
      setTimeout(() => {
        resetGame();
        showScreen("gameover-screen");
      }, FEEDBACK_DELAY);
      return;
    }
  }

  setTimeout(showNextWord, FEEDBACK_DELAY);
}

function showFeedback(text, correct) {
  el.feedback.textContent = text;
  el.feedback.className = "feedback " + (correct ? "correct" : "wrong");
}

// =========================================================
// Statusanzeige (FR-11, FR-12)
// =========================================================

function renderStatus() {
  el.levelHeader.textContent = "Level " + Math.min(state.level, MAX_LEVEL);
  el.level.textContent = state.level;
  el.points.textContent = state.points;

  // Herzen verschwinden von rechts nach links
  el.lives.innerHTML = "";
  for (let i = 0; i < START_LIVES; i++) {
    const heart = document.createElement("span");
    heart.className = "heart" + (i >= state.lives ? " lost" : "");
    heart.textContent = "♥";
    el.lives.appendChild(heart);
  }
}

// =========================================================
// Algorithmus 3 + 4: Spielende & Neustart
// =========================================================

function showWin() {
  stopTimer();
  showScreen("win-screen");
}

function resetGame() {
  stopTimer();
  state.points = 0;
  state.level = 0;
  state.lives = START_LIVES;
  state.solved.clear();  // nach einem Reset dürfen alle Vokabeln wieder vorkommen
  state.current = null;
  state.locked = false;
  renderStatus();
}

function startGame() {
  resetGame();
  showScreen("game-screen");
  showNextWord();
}

// =========================================================
// Event-Listener
// =========================================================

el.startBtn.addEventListener("click", startGame);

// Absenden per Button oder Enter-Taste
el.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (el.input.value.trim() === "") {
    el.input.focus();
    return;
  }
  handleAnswer(el.input.value);
});

// FR-17: "Wiederholen" nach Game Over → zurück zum Startbildschirm
el.retryBtn.addEventListener("click", () => {
  resetGame();
  showScreen("start-screen");
});

// Algorithmus 4: "Neustart" nach dem letzten Level
el.restartBtn.addEventListener("click", startGame);

// ---------- Initialisierung ----------
renderStatus();
loadVocabulary();
