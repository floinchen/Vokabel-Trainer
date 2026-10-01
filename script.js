/* =========================================================
   Vokabeltrainer – Spiellogik
   Die deutschen Wörter stehen pro Level in WORDS, die
   englischen Übersetzungen kommen live von der kostenlosen
   MyMemory-API (https://mymemory.translated.net, ohne API-Key)
   ========================================================= */

// ---------- Konstanten ----------
const API_URL         = "https://api.mymemory.translated.net/get";
const POINTS_PER_WORD = 10;   // FR-06
const POINTS_PER_LEVEL = 100; // FR-07
const MAX_LEVEL       = 5;    // FR-08
const START_LIVES     = 3;    // FR-09
const TIME_PER_WORD   = 20;   // FR-05 (Sekunden)
const FEEDBACK_DELAY  = 1500; // Anzeigedauer der Rückmeldung (ms)

// ---------- Wortlisten (Index = Level) ----------
const WORDS = [
  ["Haus", "Hund", "Katze", "Baum", "Buch", "Wasser", "Sonne", "Tisch", "Auto", "Apfel",
   "Milch", "Rot", "Mutter", "Vater", "Schule"],
  ["Fenster", "Stuhl", "Schlüssel", "Vogel", "Zug", "Wolke", "Brücke", "Küche", "Pferd", "Straße",
   "Geschenk", "Freund", "Frühstück", "Kirche", "Himmel"],
  ["Flughafen", "Rechnung", "Nachbar", "Wissen", "Erfahrung", "Gesundheit", "Umwelt", "Wetter",
   "Zahnarzt", "Versuch", "Gebäude", "Wettbewerb", "Geschwindigkeit", "Unterricht", "Verkehr"],
  ["Entscheidung", "Verantwortung", "Gleichgewicht", "Herausforderung", "Zuverlässigkeit",
   "Anforderung", "Vertrauen", "Beziehung", "Voraussetzung", "Wahrscheinlichkeit", "Gewissen",
   "Bewerbung", "Schwierigkeit", "Vorurteil", "Nachhaltigkeit"],
  ["Eichhörnchen", "Rücksichtslos", "Gleichgültigkeit", "Beharrlichkeit", "Zweideutig",
   "Unentbehrlich", "Vergänglichkeit", "Gewährleistung", "Selbstgefällig", "Zwangsläufig",
   "Verschwiegenheit", "Glaubwürdigkeit", "Beeinträchtigung", "Schadenfreude", "Unverzichtbar"]
];

// ---------- Spielzustand ----------
const vocabulary = WORDS.flatMap((words, level) =>
  words.map((german) => ({ id: level + ":" + german, level: level, german: german }))
);
const translationCache = new Map(); // "langpair:wort" -> Liste von Übersetzungen
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
// Data Handling (Wörterbuch-API)
// =========================================================

/**
 * Fragt die MyMemory-API nach Übersetzungen für ein Wort.
 * langpair z. B. "de|en". Liefert eine Liste normalisierter Übersetzungen.
 */
async function translate(word, langpair) {
  const key = langpair + ":" + word.toLowerCase();
  if (translationCache.has(key)) return translationCache.get(key);

  const url = API_URL + "?q=" + encodeURIComponent(word) + "&langpair=" + encodeURIComponent(langpair);
  const response = await fetch(url);
  if (!response.ok) throw new Error("HTTP " + response.status);
  const data = await response.json();
  if (data.responseStatus && Number(data.responseStatus) !== 200) {
    throw new Error(data.responseDetails || "API-Fehler");
  }

  // Hauptübersetzung + alle Treffer aus dem Übersetzungsspeicher sammeln
  const candidates = [data.responseData && data.responseData.translatedText]
    .concat((data.matches || []).map((m) => m.translation));

  const source = normalize(word);
  const result = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const t = cleanTranslation(candidate);
    // leere, unübersetzte und doppelte Einträge überspringen
    if (t === "" || t === source || result.includes(t)) continue;
    result.push(t);
  }

  translationCache.set(key, result);
  return result;
}

/** Entfernt Artikel, "to" bei Verben und Satzzeichen ("The house." -> "house"). */
function cleanTranslation(text) {
  return normalize(text)
    .replace(/[.!?,;:"„“()]/g, "")
    .replace(/^(the|a|an|to|der|die|das|ein|eine) /, "")
    .trim();
}

/** Lädt die englischen Übersetzungen für eine Vokabel (einmalig, dann aus dem Cache). */
async function loadAnswers(vocab) {
  if (!vocab.english) {
    vocab.english = await translate(vocab.german, "de|en");
  }
  return vocab.english;
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

async function isCorrect(answer, vocab) {
  const cleaned = cleanTranslation(answer);
  if (vocab.english.includes(cleaned)) return true;

  // Rückwärtsprüfung für Synonyme: übersetzt die API die Antwort
  // zurück ins Deutsche und kommt dabei das gesuchte Wort heraus?
  try {
    const backwards = await translate(cleaned, "en|de");
    return backwards.includes(cleanTranslation(vocab.german));
  } catch (err) {
    console.warn("Rückwärtsprüfung fehlgeschlagen:", err);
    return false;
  }
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

async function showNextWord() {
  const next = pickNextWord();
  if (!next) {
    // keine Vokabeln mehr übrig – als geschafft werten
    showWin();
    return;
  }
  state.current = next;
  state.locked = true;

  el.word.textContent = next.german;
  el.input.value = "";
  el.input.disabled = true;
  el.checkBtn.disabled = true;
  el.feedback.textContent = "Übersetzung wird geladen...";
  el.feedback.className = "feedback";

  try {
    const answers = await loadAnswers(next);
    if (answers.length === 0) throw new Error("Keine Übersetzung gefunden");
  } catch (err) {
    console.warn("Wörterbuch-API nicht erreichbar:", err);
    showFeedback("Wörterbuch-API nicht erreichbar – neuer Versuch...", false);
    setTimeout(showNextWord, FEEDBACK_DELAY * 2);
    return;
  }
  // Spiel wurde während des Ladens beendet/neu gestartet
  if (state.current !== next) return;

  state.locked = false;
  el.input.disabled = false;
  el.checkBtn.disabled = false;
  el.feedback.textContent = "";
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

async function handleAnswer(answer) {
  if (state.locked) return;
  state.locked = true;
  stopTimer();
  el.input.disabled = true;
  el.checkBtn.disabled = true;

  const vocab = state.current;
  const correct = answer !== null && await isCorrect(answer, vocab);

  if (correct) {
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
    showFeedback(prefix + "Richtig wäre: " + vocab.english[0], false);
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
