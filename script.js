/* =========================================================
   Vokabeltrainer – Spiellogik
   Die deutschen Wörter werden aus "vokabeln.csv" geladen
   (Format: level;deutsch), die
   Übersetzungen in die gewählte Sprache kommen live von der
   kostenlosen MyMemory-API (https://mymemory.translated.net,
   ohne API-Key)
   ========================================================= */

// ---------- Konstanten ----------
const CSV_FILE        = "vokabeln.csv";
const API_URL         = "https://api.mymemory.translated.net/get";
const POINTS_PER_WORD = 10;   // FR-06
const POINTS_PER_LEVEL = 100; // FR-07
const MAX_LEVEL       = 5;    // FR-08
const START_LEVEL     = 0;    // Startlevel (zum Testen; normal 0)
const START_LIVES     = 3;    // FR-09
const TIME_PER_WORD   = 20;   // FR-05 (Sekunden)
const FEEDBACK_DELAY  = 1000; // Anzeigedauer der Rückmeldung bei richtiger Antwort (ms)
const SOLUTION_DELAY  = 4000; // Anzeigedauer der Lösung bei falscher Antwort (ms)
const LEVELUP_DELAY   = 2800; // Anzeigedauer der Level-Animation (ms)
const FLAG_URL        = "https://flagcdn.com/"; // Flaggenbilder (kostenlos, ohne Key)
const PLAYER_DATA_KEY = "vokabeltrainer.player";

// ---------- Lernsprachen ----------
// label = Text unter der Flagge, name = Anzeige im Spiel ("ins Englische"),
// flag = Ländercode für das Flaggenbild, articles = werden vor dem Vergleich entfernt
const LANGUAGES = {
  en: { label: "Englisch",       name: "Englische",       flag: "gb", articles: ["the", "a", "an", "to"] },
  fr: { label: "Französisch",    name: "Französische",    flag: "fr", articles: ["le", "la", "les", "l'", "un", "une", "des"] },
  es: { label: "Spanisch",       name: "Spanische",       flag: "es", articles: ["el", "la", "los", "las", "un", "una"] },
  it: { label: "Italienisch",    name: "Italienische",    flag: "it", articles: ["il", "lo", "la", "i", "gli", "le", "l'", "un", "uno", "una"] },
  pt: { label: "Portugiesisch",  name: "Portugiesische",  flag: "pt", articles: ["o", "a", "os", "as", "um", "uma"] },
  nl: { label: "Niederländisch", name: "Niederländische", flag: "nl", articles: ["de", "het", "een"] },
  sv: { label: "Schwedisch",     name: "Schwedische",     flag: "se", articles: ["en", "ett", "att"] },
  pl: { label: "Polnisch",       name: "Polnische",       flag: "pl", articles: [] },
  tr: { label: "Türkisch",       name: "Türkische",       flag: "tr", articles: ["bir"] }
};

// ---------- Spielzustand ----------
let vocabulary = [];          // deutsche Wörter aus der CSV ({ id, level, german })
const translationCache = new Map(); // "langpair:wort" -> Liste von Übersetzungen
const state = {
  playerName: "",
  language: "en",             // gewählte Lernsprache (Schlüssel aus LANGUAGES)
  answers: [],                // richtige Übersetzungen der aktuellen Vokabel
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
  nameForm:    $("name-form"),
  nameInput:   $("name-input"),
  nameMessage: $("name-message"),
  startBtn:    $("start-btn"),
  csvFallback: $("csv-fallback"),
  csvInput:    $("csv-input"),
  retryBtn:    $("retry-btn"),
  restartBtn:  $("restart-btn"),
  langGrid:    $("language-grid"),
  languageTitle: $("language-title"),
  intro:       $("intro-text"),
  levelHeader: $("level-header"),
  word:        $("word"),
  task:        $("task-text"),
  form:        $("answer-form"),
  input:       $("answer-input"),
  checkBtn:    $("check-btn"),
  feedback:    $("feedback"),
  solution:    $("solution"),
  solutionTitle: $("solution-title"),
  solutionWord: $("solution-word"),
  timer:       $("timer"),
  points:      $("points"),
  progress:    $("progress-fill"),
  level:       $("level"),
  lives:       $("lives"),
  levelup:     $("levelup"),
  levelupTitle: $("levelup-title"),
  levelupText: $("levelup-text"),
  confetti:    $("confetti")
};

// =========================================================
// Data Handling (CSV mit den deutschen Wörtern)
// =========================================================

/** Wandelt den CSV-Text (level;deutsch) in ein Array von Vokabel-Objekten um. */
function parseCSV(text) {
  const lines = text
    .replace(/^﻿/, "")       // BOM entfernen (z. B. aus Excel)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const result = [];
  // Zeile 0 = Kopfzeile (level;deutsch)
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(";");
    if (parts.length < 2) continue;

    const level  = parseInt(parts[0], 10);
    const german = parts[1].trim();
    if (isNaN(level) || german === "") continue;

    result.push({ id: level + ":" + german, level: level, german: german });
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
// Data Handling (Wörterbuch-API)
// =========================================================

/**
 * Fragt die MyMemory-API nach Übersetzungen für ein Wort von Sprache
 * "from" nach "to" (z. B. "de", "fr"). Liefert eine Liste bereinigter Übersetzungen.
 */
async function translate(word, from, to) {
  const langpair = from + "|" + to;
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
    // fehlerhafte Einträge aus dem Übersetzungsspeicher (HTML-Codes, Tags, Zahlen) ignorieren
    if (!candidate || /[<>&#\d]/.test(candidate)) continue;
    const t = cleanTranslation(candidate, to);
    // leere, unübersetzte und doppelte Einträge überspringen
    if (t === "" || t === source || result.includes(t)) continue;
    result.push(t);
  }

  translationCache.set(key, result);
  return result;
}

const GERMAN_ARTICLES = ["der", "die", "das", "ein", "eine"];

/** Entfernt Artikel der Sprache und Satzzeichen ("The house." -> "house", "l'école" -> "école"). */
function cleanTranslation(text, lang) {
  const articles = lang === "de" ? GERMAN_ARTICLES : LANGUAGES[lang].articles;
  let result = normalize(text).replace(/[.!?,;:"„“«»¿¡()]/g, "").replace(/’/g, "'").trim();
  for (const article of articles) {
    const prefix = article.endsWith("'") ? article : article + " ";
    if (result.startsWith(prefix) && result.length > prefix.length) {
      result = result.slice(prefix.length).trim();
      break;
    }
  }
  return result;
}

/** Vergleichsschlüssel ohne Akzente, damit z. B. "ecole" auch für "école" zählt. */
function compareKey(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
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
  const cleaned = cleanTranslation(answer, state.language);
  if (state.answers.some((a) => compareKey(a) === compareKey(cleaned))) return true;

  // Rückwärtsprüfung für Synonyme: übersetzt die API die Antwort
  // zurück ins Deutsche und kommt dabei das gesuchte Wort heraus?
  try {
    const backwards = await translate(cleaned, state.language, "de");
    const german = compareKey(cleanTranslation(vocab.german, "de"));
    return backwards.some((b) => compareKey(b) === german);
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

  hideSolution();
  el.word.textContent = next.german;
  el.input.value = "";
  el.input.disabled = true;
  el.checkBtn.disabled = true;
  el.feedback.textContent = "Übersetzung wird geladen...";
  el.feedback.className = "feedback";

  let answers;
  try {
    answers = await translate(next.german, "de", state.language);
    if (answers.length === 0) throw new Error("Keine Übersetzung gefunden");
  } catch (err) {
    console.warn("Wörterbuch-API nicht erreichbar:", err);
    showFeedback("Wörterbuch-API nicht erreichbar – neuer Versuch...", false);
    setTimeout(showNextWord, FEEDBACK_DELAY * 2);
    return;
  }
  // Spiel wurde während des Ladens beendet/neu gestartet
  if (state.current !== next) return;

  state.answers = answers;
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

    if (levelUp) {
      showLevelUp(state.level);
      // Algorithmus 3: Beendigung bei Level 5
      if (state.level >= MAX_LEVEL) {
        setTimeout(showWin, LEVELUP_DELAY);
      } else {
        setTimeout(() => {
          hideLevelUp();
          showNextWord();
        }, LEVELUP_DELAY);
      }
      return;
    }
  } else {
    // inkorrekt: ein Leben weniger (Leben regenerieren sich beim Levelaufstieg nicht)
    state.lives--;
    showSolution(answer);
    renderStatus();

    // Algorithmus 5: alle Leben verloren
    if (state.lives <= 0) {
      setTimeout(() => {
        resetGame();
        showScreen("gameover-screen");
      }, SOLUTION_DELAY);
      return;
    }
    setTimeout(showNextWord, SOLUTION_DELAY);
    return;
  }

  setTimeout(showNextWord, FEEDBACK_DELAY);
}

function showFeedback(text, correct) {
  el.feedback.textContent = text;
  el.feedback.className = "feedback " + (correct ? "correct" : "wrong");
}

/** Zeigt bei falscher Antwort einen kleinen Hinweis und das richtige Wort groß. */
function showSolution(answer) {
  el.feedback.textContent = "";
  el.feedback.className = "feedback hidden";
  el.timer.classList.add("hidden");

  el.solutionTitle.textContent = answer === null ? "Zeit abgelaufen" : "Leider falsch";
  el.solutionWord.textContent = state.answers[0];
  el.solution.classList.remove("hidden");
}

function hideSolution() {
  el.solution.classList.add("hidden");
  el.feedback.className = "feedback";
  el.timer.classList.remove("hidden");
}

// =========================================================
// Statusanzeige (FR-11, FR-12)
// =========================================================

function renderStatus() {
  el.levelHeader.textContent = "Level " + Math.min(state.level, MAX_LEVEL);
  el.level.textContent = state.level;
  el.points.textContent = state.points;
  el.progress.style.width = (state.points / POINTS_PER_LEVEL * 100) + "%";

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
// Level-Aufstieg (Animation)
// =========================================================

const CONFETTI_COLORS = ["#5c2e18", "#98501f", "#bd7937", "#476b3a", "#d99a32"];

function showLevelUp(level) {
  el.levelupTitle.textContent = "Level " + level + "!";
  const greeting = state.playerName ? "Super, " + state.playerName + "! " : "Super! ";
  el.levelupText.textContent = level >= MAX_LEVEL
    ? greeting + "Du hast alle Level geschafft!"
    : greeting + "Du bist ein Level aufgestiegen.";

  // Konfetti erzeugen
  el.confetti.innerHTML = "";
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = Math.random() * 0.6 + "s";
    piece.style.animationDuration = 1.8 + Math.random() * 1.2 + "s";
    piece.style.transform = "rotate(" + Math.random() * 360 + "deg)";
    el.confetti.appendChild(piece);
  }

  el.levelup.classList.remove("hidden");
  // Animation des Headers neu starten
  el.levelHeader.classList.remove("flash");
  void el.levelHeader.offsetWidth;
  el.levelHeader.classList.add("flash");
}

function hideLevelUp() {
  el.levelup.classList.add("hidden");
  el.confetti.innerHTML = "";
}

// =========================================================
// Algorithmus 3 + 4: Spielende & Neustart
// =========================================================

function showWin() {
  stopTimer();
  hideLevelUp();
  showScreen("win-screen");
}

function resetGame() {
  stopTimer();
  hideLevelUp();
  hideSolution();
  state.points = 0;
  state.level = START_LEVEL;
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

el.nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = el.nameInput.value.trim();
  if (!name) {
    el.nameMessage.textContent = "Bitte gib deinen Namen ein.";
    el.nameInput.focus();
    return;
  }

  try {
    localStorage.setItem(PLAYER_DATA_KEY, JSON.stringify({ name: name }));
  } catch (error) {
    console.error("Name konnte nicht gespeichert werden:", error);
    el.nameMessage.textContent = "Der Name konnte im Browser nicht gespeichert werden.";
    return;
  }

  state.playerName = name;
  el.languageTitle.textContent = "Welche Sprache möchtest du heute lernen, " + name + "?";
  el.nameMessage.textContent = "";
  showScreen("start-screen");
});

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

// =========================================================
// Sprachauswahl am Startbildschirm (Flaggen-Buttons)
// =========================================================

function renderLanguageButtons() {
  for (const [code, lang] of Object.entries(LANGUAGES)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-btn";
    btn.dataset.lang = code;

    const flag = document.createElement("img");
    flag.src = FLAG_URL + "w80/" + lang.flag + ".png";
    flag.srcset = FLAG_URL + "w160/" + lang.flag + ".png 2x";
    flag.alt = "";
    flag.width = 64;
    flag.height = 43;

    const label = document.createElement("span");
    label.textContent = lang.label;

    btn.append(flag, label);
    btn.addEventListener("click", () => setLanguage(code));
    el.langGrid.appendChild(btn);
  }
}

/** Übernimmt die Lernsprache und passt die Texte an ("ins Englische" usw.). */
function setLanguage(lang) {
  state.language = lang;
  el.langGrid.querySelectorAll(".lang-btn").forEach((btn) => {
    const selected = btn.dataset.lang === lang;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", selected);
  });
  const name = LANGUAGES[lang].name;
  el.intro.textContent = "Übersetze die deutschen Begriffe ins " + name + " und steigere dein Level.";
  el.task.textContent = "Übersetze das Wort ins " + name;
  el.input.placeholder = name + " Übersetzung eingeben...";
}

// ---------- Initialisierung ----------
try {
  const savedPlayer = localStorage.getItem(PLAYER_DATA_KEY);
  if (savedPlayer) {
    const playerData = JSON.parse(savedPlayer);
    if (typeof playerData.name !== "string") {
      throw new Error("Gespeicherte Namensdaten sind ungültig.");
    }
    state.playerName = playerData.name;
    el.nameInput.value = playerData.name;
    el.languageTitle.textContent = "Welche Sprache möchtest du heute lernen, " + playerData.name + "?";
  }
} catch (error) {
  console.error("Gespeicherter Name konnte nicht geladen werden:", error);
  el.nameMessage.textContent = "Der gespeicherte Name konnte nicht geladen werden. Bitte gib ihn erneut ein.";
}
renderLanguageButtons();
setLanguage(state.language);
renderStatus();
loadVocabulary();
