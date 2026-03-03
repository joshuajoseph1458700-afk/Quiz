/* app.js - Works without modules/exports, good for phone HTML viewers */

(function () {
  "use strict";

  // ======= DOM =======
  const elTitle = document.getElementById("quizTitle");
  const quizContainer = document.getElementById("quiz");
  const elScore = document.getElementById("score");
  const errorBox = document.getElementById("errorBox");

  const btnCheck = document.getElementById("btnCheck");
  const btnReset = document.getElementById("btnReset");
  const btnWeak = document.getElementById("btnWeak");
  const btnExitWeak = document.getElementById("btnExitWeak");

  const btnExport = document.getElementById("btnExport");
  const btnExportWeakOnly = document.getElementById("btnExportWeakOnly");
  const btnImport = document.getElementById("btnImport");
  const btnClearLecture = document.getElementById("btnClearLecture");
  const btnClearAll = document.getElementById("btnClearAll");

  const weakThresholdInput = document.getElementById("weakThreshold");
  const minAttemptsInput = document.getElementById("minAttempts");
  const limitQuestionsInput = document.getElementById("limitQuestions");
  const rangeBox = document.getElementById("rangeBox");
  const btnApplyRange = document.getElementById("btnApplyRange");
  const btnClearRange = document.getElementById("btnClearRange");

  const progressBox = document.getElementById("progressBox");

  function showError(msg) {
    errorBox.style.display = "block";
    errorBox.textContent = msg;
  }
  function clearError() {
    errorBox.style.display = "none";
    errorBox.textContent = "";
  }

  // ======= Validate loaded questions.js =======
  const quizMeta = (window.quizMeta && typeof window.quizMeta === "object") ? window.quizMeta : null;
  const rawQuizData = Array.isArray(window.quizData) ? window.quizData : null;

  if (!quizMeta || !rawQuizData) {
    elTitle.textContent = "Quiz load error";
    showError(
      "questions.js did not load correctly.\n\n" +
      "Make sure:\n" +
      "1) questions.js is in the SAME folder as index.html\n" +
      "2) index.html loads it like: <script src=\"questions.js\"></script>\n" +
      "3) questions.js sets window.quizMeta and window.quizData\n"
    );
    return;
  }

  // Enforce 5 options (A–E)
  for (let i = 0; i < Math.min(rawQuizData.length, 5); i++) {
    const q = rawQuizData[i];
    const ok =
      q &&
      typeof q.question === "string" &&
      Array.isArray(q.options) &&
      q.options.length === 5 &&
      typeof q.answer === "number" &&
      q.answer >= 0 && q.answer <= 4;
    if (!ok) {
      elTitle.textContent = "Quiz data error";
      showError(
        "Each question must look like:\n" +
        "{ question: \"...\", options: [\"A\",\"B\",\"C\",\"D\",\"E\"], answer: 0 }\n\n" +
        "Found invalid structure near question #" + (i + 1) + ".\n" +
        "Make sure options length = 5 and answer is 0..4."
      );
      return;
    }
  }

  clearError();
  elTitle.textContent = quizMeta.title || "Medical MCQ Quiz";

  // ======= Decorate questions with original index =======
  const allQuizData = rawQuizData.map((q, i) => ({
    question: q.question,
    options: q.options.slice(),
    answer: q.answer,
    _orig: i
  }));

  // ======= Storage =======
  const STORAGE_KEY = "mcq_progress_v3";

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { lectures: {} };
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return { lectures: {} };
      if (!obj.lectures) obj.lectures = {};
      return obj;
    } catch {
      return { lectures: {} };
    }
  }

  function saveProgress(p) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function makeQid(q) {
    const base = `${q.question}||${q.options.join("||")}`;
    let h = 0;
    for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
    return `q_${h.toString(16)}`;
  }

  // ======= Quiz state =======
  let weakMode = false;
  let activeQuizData = allQuizData.slice();
  let visibleIndices = [];
  let usedRangeText = "";

  function clampInt(value, fallback, min, max) {
    const n = parseInt(value || "", 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function getLimit() {
    const n = clampInt(limitQuestionsInput.value, 150, 1, 999999);
    return Math.min(n, activeQuizData.length);
  }

  // ======= Selection Preservation System =======
  // Save current selections before rebuilding
  function saveSelections() {
    const selections = {};
    const qDivs = quizContainer.querySelectorAll(".q");
    qDivs.forEach((qDiv) => {
      const srcIndex = qDiv.dataset.srcIndex;
      const selected = qDiv.querySelector('input[type="radio"]:checked');
      if (selected) {
        selections[srcIndex] = selected.value;
      }
    });
    return selections;
  }

  // Restore selections after rebuilding
  function restoreSelections(selections) {
    const qDivs = quizContainer.querySelectorAll(".q");
    qDivs.forEach((qDiv) => {
      const srcIndex = qDiv.dataset.srcIndex;
      if (selections[srcIndex] !== undefined) {
        const radio = qDiv.querySelector(`input[value="${selections[srcIndex]}"]`);
        if (radio) radio.checked = true;
      }
    });
  }

  // ======= Range parser =======
  function parseRangeText(text) {
    const s = (text || "").replace(/\s+/g, "");
    if (!s) return null;

    const matches = [...s.matchAll(/\[(\d+)(?:-(\d+))?\]/g)];
    if (!matches.length) return null;

    const ranges = matches.map(m => {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      return { start, end };
    });

    return ranges;
  }

  function computeVisibleIndices() {
    const rangeText = (rangeBox.value || "").trim();
    const parsed = parseRangeText(rangeText);

    if (!parsed) {
      usedRangeText = "";
      const lim = getLimit();
      return Array.from({ length: lim }, (_, i) => i);
    }

    usedRangeText = rangeText;

    const picked = [];
    for (let i = 0; i < activeQuizData.length; i++) {
      const origNumber = activeQuizData[i]._orig + 1;
      for (let r = 0; r < parsed.length; r++) {
        if (origNumber >= parsed[r].start && origNumber <= parsed[r].end) {
          picked.push(i);
          break;
        }
      }
    }

    return picked;
  }

  // ======= Render =======
  function buildQuiz() {
    // FIX #1: Save selections before clearing
    const savedSelections = saveSelections();
    
    quizContainer.innerHTML = "";
    clearError();

    if (!activeQuizData.length) {
      quizContainer.innerHTML = "<p>No questions to show.</p>";
      elScore.textContent = "Score: —";
      visibleIndices = [];
      return;
    }

    visibleIndices = computeVisibleIndices();

    if (!visibleIndices.length) {
      quizContainer.innerHTML = "<p>No questions matched your filter.</p>";
      elScore.textContent = "Score: —";
      return;
    }

    const frag = document.createDocumentFragment();

    for (let displayIndex = 0; displayIndex < visibleIndices.length; displayIndex++) {
      const srcIndex = visibleIndices[displayIndex];
      const q = activeQuizData[srcIndex];

      const qDiv = document.createElement("div");
      qDiv.className = "q";
      qDiv.dataset.answer = String(q.answer);
      qDiv.dataset.srcIndex = String(srcIndex);
      qDiv.dataset.displayIndex = String(displayIndex);

      const origNo = q._orig + 1;

      let html = `<h3>${origNo}) ${escapeHtml(q.question)}</h3>`;

      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i];
        const letter = String.fromCharCode(65 + i);
        html += `
          <label>
            <input type="radio" name="q${displayIndex}" value="${i}" data-opt-index="${i}">
            ${letter}) ${escapeHtml(String(opt))}
          </label>
        `;
      }

      qDiv.innerHTML = html;
      frag.appendChild(qDiv);
    }

    quizContainer.appendChild(frag);
    
    // FIX #1: Restore selections after building
    restoreSelections(savedSelections);
    
    // FIX #2: Add click-to-unselect behavior
    addUnselectBehavior();
    
    elScore.textContent = "Score: —";
    clearMarks();
  }

  // FIX #2: Allow clicking a selected radio to unselect it
  function addUnselectBehavior() {
    const radios = quizContainer.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => {
      radio.addEventListener("mousedown", function(e) {
        if (this.checked) {
          this.dataset.wasChecked = "true";
        } else {
          this.dataset.wasChecked = "false";
        }
      });
      
      radio.addEventListener("click", function(e) {
        if (this.dataset.wasChecked === "true") {
          this.checked = false;
          this.dataset.wasChecked = "false";
        }
      });
    });
  }

  function clearMarks() {
    const labels = quizContainer.querySelectorAll(".q label");
    labels.forEach(l => l.classList.remove("correct", "wrong"));
  }

  function escapeHtml(s) {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ======= Check / Save =======
  function checkAnswers() {
    clearMarks();

    const qDivs = quizContainer.querySelectorAll(".q");
    const shownCount = qDivs.length;

    let score = 0;

    const progress = loadProgress();
    if (!progress.lectures[quizMeta.id]) {
      progress.lectures[quizMeta.id] = { title: quizMeta.title, questions: {} };
    }
    const lectureProgress = progress.lectures[quizMeta.id];

    for (let displayIndex = 0; displayIndex < shownCount; displayIndex++) {
      const qDiv = qDivs[displayIndex];
      const srcIndex = parseInt(qDiv.dataset.srcIndex, 10);
      const q = activeQuizData[srcIndex];
      const qid = makeQid(q);

      const correct = parseInt(qDiv.dataset.answer, 10);
      const selected = quizContainer.querySelector(`input[name="q${displayIndex}"]:checked`);
      const correctInput = qDiv.querySelector(`input[value="${correct}"]`);
      const correctLabel = correctInput ? correctInput.parentElement : null;

      if (selected) {
        const choice = parseInt(selected.value, 10);

        if (!lectureProgress.questions[qid]) {
          lectureProgress.questions[qid] = {
            seen: 0,
            correct: 0,
            last: "",
            lastChoice: null,
            orig: q._orig + 1,
            q: q.question,
            options: q.options.slice(),
            answer: q.answer
          };
        } else {
          lectureProgress.questions[qid].orig = q._orig + 1;
          lectureProgress.questions[qid].q = q.question;
          lectureProgress.questions[qid].options = q.options.slice();
          lectureProgress.questions[qid].answer = q.answer;
        }

        lectureProgress.questions[qid].seen += 1;
        lectureProgress.questions[qid].last = todayISO();
        lectureProgress.questions[qid].lastChoice = choice;

        const selectedLabel = selected.parentElement;
        if (choice === correct) {
          selectedLabel.classList.add("correct");
          score++;
          lectureProgress.questions[qid].correct += 1;
        } else {
          selectedLabel.classList.add("wrong");
          if (correctLabel) correctLabel.classList.add("correct");
        }
      } else {
        if (correctLabel) correctLabel.classList.add("correct");
      }
    }

    saveProgress(progress);

    const rangeNote = usedRangeText ? ` (range: ${usedRangeText})` : "";
    elScore.textContent =
      `Score: ${score} / ${shownCount}` + (weakMode ? " (weak-only mode)" : "") + rangeNote;
  }

  function resetQuiz() {
    clearMarks();
    const radios = quizContainer.querySelectorAll('input[type="radio"]');
    radios.forEach(r => (r.checked = false));
    elScore.textContent = "Score: —";
  }

  // ======= Weak mode =======
  function startWeakMode() {
    const thresholdPct = clampInt(weakThresholdInput.value, 70, 0, 100);
    const minAttempts = clampInt(minAttemptsInput.value, 2, 1, 999999);
    const threshold = thresholdPct / 100;

    const progress = loadProgress();
    const lec = progress.lectures[quizMeta.id];
    const qp = lec ? lec.questions : {};

    const weak = allQuizData.filter(q => {
      const qid = makeQid(q);
      const rec = qp && qp[qid];
      if (!rec) return false;
      if (rec.seen < minAttempts) return false;
      const acc = rec.correct / rec.seen;
      return acc < threshold;
    });

    weakMode = true;
    activeQuizData = weak;

    buildQuiz();
    elScore.textContent = weak.length
      ? `Score: — (weak-only mode, ${weak.length} questions total)`
      : "Score: — (no weak questions found)";
  }

  function exitWeakMode() {
    weakMode = false;
    activeQuizData = allQuizData.slice();
    buildQuiz();
  }

  // ======= Export / Import =======
  function exportProgress() {
    const p = loadProgress();
    progressBox.value = JSON.stringify(p, null, 2);
  }

  function exportWeakOnlyProgress() {
    const thresholdPct = clampInt(weakThresholdInput.value, 70, 0, 100);
    const minAttempts = clampInt(minAttemptsInput.value, 2, 1, 999999);
    const threshold = thresholdPct / 100;

    const p = loadProgress();
    const out = { lectures: {} };

    const lectureIds = Object.keys(p.lectures || {});
    for (let li = 0; li < lectureIds.length; li++) {
      const lectureId = lectureIds[li];
      const lec = p.lectures[lectureId];
      const qs = (lec && lec.questions) ? lec.questions : {};

      const newQs = {};
      const qids = Object.keys(qs);
      for (let qi = 0; qi < qids.length; qi++) {
        const qid = qids[qi];
        const rec = qs[qid];
        if (!rec) continue;
        if ((rec.seen || 0) < minAttempts) continue;
        const acc = (rec.correct || 0) / (rec.seen || 1);
        if (acc < threshold) newQs[qid] = rec;
      }

      if (Object.keys(newQs).length) {
        out.lectures[lectureId] = {
          title: lec.title || lectureId,
          questions: newQs
        };
      }
    }

    progressBox.value = JSON.stringify(out, null, 2);
  }

  function importProgress() {
    try {
      const txt = (progressBox.value || "").trim();
      if (!txt) return;
      const obj = JSON.parse(txt);
      if (!obj || typeof obj !== "object" || !obj.lectures) {
        alert("Invalid JSON progress.");
        return;
      }
      saveProgress(obj);
      alert("Progress imported ✅");
    } catch {
      alert("Invalid JSON progress.");
    }
  }

  function clearLectureProgress() {
    const p = loadProgress();
    if (p.lectures && p.lectures[quizMeta.id]) {
      delete p.lectures[quizMeta.id];
      saveProgress(p);
    }
    alert("This lecture progress cleared ✅");
  }

  function clearAllProgress() {
    localStorage.removeItem(STORAGE_KEY);
    alert("All progress cleared ✅");
  }

  // ======= Range controls =======
  function applyRange() {
    buildQuiz();
  }
  function clearRange() {
    rangeBox.value = "";
    buildQuiz();
  }

  // ======= Wire buttons =======
  btnCheck.addEventListener("click", checkAnswers);
  btnReset.addEventListener("click", resetQuiz);
  btnWeak.addEventListener("click", startWeakMode);
  btnExitWeak.addEventListener("click", exitWeakMode);

  btnExport.addEventListener("click", exportProgress);
  btnExportWeakOnly.addEventListener("click", exportWeakOnlyProgress);
  btnImport.addEventListener("click", importProgress);
  btnClearLecture.addEventListener("click", clearLectureProgress);
  btnClearAll.addEventListener("click", clearAllProgress);

  btnApplyRange.addEventListener("click", applyRange);
  btnClearRange.addEventListener("click", clearRange);

  // Rebuild when user changes limit - now preserves selections!
  limitQuestionsInput.addEventListener("change", buildQuiz);

  // Init
  buildQuiz();
})();
