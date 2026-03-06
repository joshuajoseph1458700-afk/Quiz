/* app.js - Works without modules/exports, good for phone HTML viewers */

(function () {
  "use strict";

  // ======= 1. DEFINE YOUR CATALOG HERE =======
  // Just list the EXACT folder names for each module.
  const quizCatalog = {
    "Urinary": [
      "S1.1", "S1.2", "S2.1", "S2.2", "S3.1", "S3.2", "S4.1", "S5.1"
    ],
    "Psychology": [
      "Lec1", "Lec2" // Replace with actual folder names if you have them
    ],
    "Respiratory": [
      "Lec1"
    ],
    "GIT": [
      "Lec1"
    ]
  };

  // ======= DOM Elements =======
  const setupScreen = document.getElementById("setupScreen");
  const moduleSelect = document.getElementById("moduleSelect");
  const lectureSelect = document.getElementById("lectureSelect");
  const btnLoadQuiz = document.getElementById("btnLoadQuiz");
  
  const quizApp = document.getElementById("quizApp");
  const btnBackToMenu = document.getElementById("btnBackToMenu");
  const elTitle = document.getElementById("quizTitle");
  const quizContainer = document.getElementById("quiz");
  const elScore = document.getElementById("score");
  const errorBox = document.getElementById("errorBox");

  const btnCheck = document.getElementById("btnCheck");
  const btnReset = document.getElementById("btnReset");
  const btnWeak = document.getElementById("btnWeak");
  const btnExitWeak = document.getElementById("btnExitWeak");
  
  const btnExportLecture = document.getElementById("btnExportLecture");
  const btnShowAttempt = document.getElementById("btnShowAttempt");

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

  // Global Quiz State
  let quizMeta = null;
  let rawQuizData = null;
  let allQuizData = [];
  let activeQuizData = [];
  let visibleIndices = [];
  let weakMode = false;
  let usedRangeText = "";
  const STORAGE_KEY = "mcq_progress_v3";

  // ======= INIT MENU =======
  function initMenu() {
    moduleSelect.innerHTML = '<option value="">-- Select Module --</option>';
    for (const mod in quizCatalog) {
      const opt = document.createElement("option");
      opt.value = mod;
      opt.textContent = mod;
      moduleSelect.appendChild(opt);
    }

    moduleSelect.addEventListener("change", () => {
      const mod = moduleSelect.value;
      lectureSelect.innerHTML = '<option value="">-- Select Folder --</option>';
      if (mod && quizCatalog[mod]) {
        lectureSelect.disabled = false;
        quizCatalog[mod].forEach(folderName => {
          const opt = document.createElement("option");
          opt.value = folderName;
          opt.textContent = folderName;
          lectureSelect.appendChild(opt);
        });
      } else {
        lectureSelect.disabled = true;
        btnLoadQuiz.disabled = true;
      }
    });

    lectureSelect.addEventListener("change", () => {
      btnLoadQuiz.disabled = lectureSelect.value === "";
    });

    btnLoadQuiz.addEventListener("click", () => {
      const mod = moduleSelect.value;
      const folderName = lectureSelect.value;
      if (mod && folderName !== "") {
        const path = `${mod}/${folderName}/questions.js`;
        loadScriptAndStart(path);
      }
    });

    btnBackToMenu.addEventListener("click", () => {
      quizApp.style.display = "none";
      setupScreen.style.display = "block";
      window.quizMeta = null;
      window.quizData = null;
      quizContainer.innerHTML = "";
    });
  }

  // ======= SCRIPT LOADER =======
  function loadScriptAndStart(path) {
    window.quizMeta = null;
    window.quizData = null;

    const oldScript = document.getElementById("dynamicQuizScript");
    if (oldScript) oldScript.remove();

    const script = document.createElement("script");
    script.id = "dynamicQuizScript";
    script.src = path;
    
    script.onload = () => {
      setupScreen.style.display = "none";
      quizApp.style.display = "block";
      initQuizApp();
    };
    
    script.onerror = () => {
      alert(`Could not load file at: ${path}\nMake sure your folder structure matches the names in app.js.`);
    };

    document.body.appendChild(script);
  }

  // ======= CORE APP LOGIC =======
  function showError(msg) {
    errorBox.style.display = "block";
    errorBox.textContent = msg;
  }
  function clearError() {
    errorBox.style.display = "none";
    errorBox.textContent = "";
  }

  function initQuizApp() {
    quizMeta = window.quizMeta;
    rawQuizData = window.quizData;

    if (!quizMeta || !rawQuizData) {
      elTitle.textContent = "Quiz load error";
      showError("questions.js did not load correctly. Verify the file structure.");
      return;
    }

    clearError();
    elTitle.textContent = quizMeta.title || "Medical MCQ Quiz";

    allQuizData = rawQuizData.map((q, i) => ({
      question: q.question,
      options: q.options.slice(),
      answer: q.answer,
      _orig: i
    }));

    weakMode = false;
    activeQuizData = allQuizData.slice();
    buildQuiz();
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { lectures: {} };
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return { lectures: {} };
      if (!obj.lectures) obj.lectures = {};
      return obj;
    } catch { return { lectures: {} }; }
  }

  function saveProgress(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function makeQid(q) {
    const base = `${q.question}||${q.options.join("||")}`;
    let h = 0;
    for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
    return `q_${h.toString(16)}`;
  }

  function clampInt(value, fallback, min, max) {
    const n = parseInt(value || "", 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }
  function getLimit() { return Math.min(clampInt(limitQuestionsInput.value, 150, 1, 999999), activeQuizData.length); }

  function saveSelections() {
    const selections = {};
    quizContainer.querySelectorAll(".q").forEach((qDiv) => {
      const srcIndex = qDiv.dataset.srcIndex;
      const selected = qDiv.querySelector('input[type="radio"]:checked');
      if (selected) selections[srcIndex] = selected.value;
      const flag = qDiv.querySelector(".qFlag");
      if (flag) selections[`flag_${srcIndex}`] = flag.checked ? "1" : "0";
    });
    return selections;
  }

  function restoreSelections(selections) {
    quizContainer.querySelectorAll(".q").forEach((qDiv) => {
      const srcIndex = qDiv.dataset.srcIndex;
      if (selections[srcIndex] !== undefined) {
        const radio = qDiv.querySelector(`input[value="${selections[srcIndex]}"]`);
        if (radio) radio.checked = true;
      }
      const flag = qDiv.querySelector(".qFlag");
      const icon = qDiv.querySelector(".warnIcon");
      if (flag && selections[`flag_${srcIndex}`] !== undefined) {
        flag.checked = (selections[`flag_${srcIndex}`] === "1");
        if (icon) flag.checked ? icon.classList.add("show") : icon.classList.remove("show");
      }
    });
  }

  function parseRangeText(text) {
    const s = (text || "").replace(/\s+/g, "");
    if (!s) return null;
    const matches = [...s.matchAll(/\[(\d+)(?:-(\d+))?\]/g)];
    if (!matches.length) return null;
    return matches.map(m => {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      return { start: Math.min(a, b), end: Math.max(a, b) };
    });
  }

  function computeVisibleIndices() {
    const rangeText = (rangeBox.value || "").trim();
    const parsed = parseRangeText(rangeText);
    if (!parsed) {
      usedRangeText = "";
      return Array.from({ length: getLimit() }, (_, i) => i);
    }
    usedRangeText = rangeText;
    const picked = [];
    for (let i = 0; i < activeQuizData.length; i++) {
      const origNo = activeQuizData[i]._orig + 1;
      for (let r = 0; r < parsed.length; r++) {
        if (origNo >= parsed[r].start && origNo <= parsed[r].end) {
          picked.push(i);
          break;
        }
      }
    }
    return picked;
  }

  function wireFlagUI(qDiv) {
    const cb = qDiv.querySelector(".qFlag");
    const icon = qDiv.querySelector(".warnIcon");
    if (!cb || !icon) return;
    const sync = () => { cb.checked ? icon.classList.add("show") : icon.classList.remove("show"); };
    cb.addEventListener("change", sync);
    sync();
  }

  function buildQuiz() {
    quizContainer.classList.remove("graded"); // Unlock choices on new build
    const savedSelections = saveSelections();
    quizContainer.innerHTML = "";
    clearError();

    if (!activeQuizData.length) {
      quizContainer.innerHTML = "<p>No questions to show.</p>";
      elScore.textContent = "Score: —";
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

      const origNo = q._orig + 1;
      let html = `
        <div class="qTop">
          <h3>${origNo}) ${escapeHtml(q.question)}</h3>
          <div class="flagWrap" title="Mark this question (adds it to weak pool)">
            <span class="warnIcon">⚠️</span>
            <input type="checkbox" class="qFlag" aria-label="Flag question">
          </div>
        </div>
      `;

      for (let i = 0; i < q.options.length; i++) {
        const letter = String.fromCharCode(65 + i);
        html += `
          <label>
            <input type="radio" name="q${displayIndex}" value="${i}">
            ${letter}) ${escapeHtml(String(q.options[i]))}
          </label>`;
      }
      qDiv.innerHTML = html;
      frag.appendChild(qDiv);
    }
    quizContainer.appendChild(frag);
    quizContainer.querySelectorAll(".q").forEach(wireFlagUI);
    restoreSelections(savedSelections);
    addUnselectBehavior();
    elScore.textContent = "Score: —";
    clearMarks();
  }

  function clearMarks() {
    quizContainer.querySelectorAll(".q").forEach(qDiv => {
      qDiv.classList.remove("flaggedAfterCheck");
      qDiv.querySelectorAll("label").forEach(l => l.classList.remove("correct", "wrong"));
    });
  }

  function escapeHtml(s) {
    return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function addUnselectBehavior() {
    quizContainer.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener("mousedown", function () { this.dataset.wasChecked = this.checked ? "true" : "false"; });
      radio.addEventListener("click", function () {
        if (this.dataset.wasChecked === "true") { this.checked = false; this.dataset.wasChecked = "false"; }
      });
    });
  }

  function checkAnswers(isReadOnly = false) {
    clearMarks();
    quizContainer.classList.add("graded"); // LOCK choices visually
    
    const qDivs = quizContainer.querySelectorAll(".q");
    let score = 0;

    const progress = loadProgress();
    if (!isReadOnly && !progress.lectures[quizMeta.id]) {
      progress.lectures[quizMeta.id] = { title: quizMeta.title, questions: {} };
    }
    const lectureProgress = isReadOnly ? null : progress.lectures[quizMeta.id];

    for (let displayIndex = 0; displayIndex < qDivs.length; displayIndex++) {
      const qDiv = qDivs[displayIndex];
      const flag = qDiv.querySelector(".qFlag");
      const isFlagged = (flag && flag.checked);
      
      if (isFlagged) qDiv.classList.add("flaggedAfterCheck");

      const srcIndex = parseInt(qDiv.dataset.srcIndex, 10);
      const q = activeQuizData[srcIndex];
      const qid = makeQid(q);
      const correct = parseInt(qDiv.dataset.answer, 10);
      const selected = quizContainer.querySelector(`input[name="q${displayIndex}"]:checked`);
      const correctLabel = qDiv.querySelector(`input[value="${correct}"]`)?.parentElement;

      if (selected) {
        const choice = parseInt(selected.value, 10);
        
        if (!isReadOnly) {
          if (!lectureProgress.questions[qid]) {
            lectureProgress.questions[qid] = { seen: 0, correct: 0, orig: q._orig + 1, q: q.question, options: q.options.slice(), answer: q.answer };
          }
          lectureProgress.questions[qid].seen += 1;
          lectureProgress.questions[qid].last = todayISO();
          lectureProgress.questions[qid].lastChoice = choice;
          lectureProgress.questions[qid].flagged = isFlagged;
          if (choice === correct) lectureProgress.questions[qid].correct += 1;
        }

        const selectedLabel = selected.parentElement;
        if (choice === correct) {
          selectedLabel.classList.add("correct");
          score++;
        } else {
          selectedLabel.classList.add("wrong");
          if (correctLabel) correctLabel.classList.add("correct");
        }
      } else {
        if (correctLabel) correctLabel.classList.add("correct");
        if (!isReadOnly && isFlagged) {
          // Still save flag status even if unanswered
           if (!lectureProgress.questions[qid]) {
            lectureProgress.questions[qid] = { seen: 1, correct: 0, orig: q._orig + 1, q: q.question, options: q.options.slice(), answer: q.answer };
          }
          lectureProgress.questions[qid].flagged = true;
        }
      }
    }

    if (!isReadOnly) saveProgress(progress);
    
    const rangeNote = usedRangeText ? ` (range: ${usedRangeText})` : "";
    const readOnlyNote = isReadOnly ? " (Viewing Attempt)" : "";
    elScore.textContent = `Score: ${score} / ${qDivs.length}` + (weakMode ? " (weak-only mode)" : "") + rangeNote + readOnlyNote;
  }

  function resetQuiz() {
    quizContainer.classList.remove("graded"); // UNLOCK choices
    clearMarks();
    quizContainer.querySelectorAll('input[type="radio"]').forEach(r => (r.checked = false));
    quizContainer.querySelectorAll(".qFlag").forEach(cb => (cb.checked = false));
    quizContainer.querySelectorAll(".warnIcon").forEach(ic => ic.classList.remove("show"));
    elScore.textContent = "Score: —";
  }

  function startWeakMode() {
    const thresholdPct = clampInt(weakThresholdInput.value, 70, 0, 100);
    const minAttempts = clampInt(minAttemptsInput.value, 2, 1, 999999);
    const threshold = thresholdPct / 100;

    const progress = loadProgress();
    const qp = progress.lectures[quizMeta.id]?.questions || {};

    const weak = allQuizData.filter(q => {
      const qid = makeQid(q);
      const rec = qp[qid];
      if (!rec) return false;
      if (rec.flagged) return true; 
      if (rec.seen < minAttempts) return false;
      return (rec.correct / rec.seen) < threshold;
    });

    weakMode = true;
    activeQuizData = weak;
    buildQuiz();
    elScore.textContent = weak.length ? `Score: — (weak-only mode, ${weak.length} questions total)` : "Score: — (no weak questions found)";
  }

  function exitWeakMode() {
    weakMode = false;
    activeQuizData = allQuizData.slice();
    buildQuiz();
  }

  function exportLectureProgress() {
    const p = loadProgress();
    const lec = p.lectures[quizMeta.id] || {};
    progressBox.value = JSON.stringify(lec, null, 2);
    alert("Exported JSON for THIS lecture to the text box.");
  }

  function showAttempt() {
    try {
      const txt = progressBox.value.trim();
      if (!txt) { alert("Please paste the JSON attempt data first."); return; }
      const attemptData = JSON.parse(txt);
      
      let lectureData = attemptData;
      if (attemptData.lectures && attemptData.lectures[quizMeta.id]) {
        lectureData = attemptData.lectures[quizMeta.id];
      }

      if (!lectureData || !lectureData.questions) {
        alert("No attempt data found for this lecture in the pasted JSON.");
        return;
      }

      resetQuiz(); 

      quizContainer.querySelectorAll(".q").forEach(qDiv => {
        const srcIndex = parseInt(qDiv.dataset.srcIndex, 10);
        const qid = makeQid(activeQuizData[srcIndex]);
        const rec = lectureData.questions[qid];

        if (rec) {
          if (rec.lastChoice !== undefined && rec.lastChoice !== null) {
            const radio = qDiv.querySelector(`input[value="${rec.lastChoice}"]`);
            if (radio) radio.checked = true;
          }
          if (rec.flagged) {
            const flag = qDiv.querySelector(".qFlag");
            if (flag) {
              flag.checked = true;
              qDiv.querySelector(".warnIcon").classList.add("show");
            }
          }
        }
      });

      checkAnswers(true); 
      
    } catch {
      alert("Invalid JSON format.");
    }
  }

  function exportProgress() { progressBox.value = JSON.stringify(loadProgress(), null, 2); }
  
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
        if (rec.flagged) { newQs[qid] = rec; continue; }
        if ((rec.seen || 0) < minAttempts) continue;
        const acc = (rec.correct || 0) / (rec.seen || 1);
        if (acc < threshold) newQs[qid] = rec;
      }

      if (Object.keys(newQs).length) {
        out.lectures[lectureId] = { title: lec.title || lectureId, questions: newQs };
      }
    }
    progressBox.value = JSON.stringify(out, null, 2);
  }

  function importProgress() {
    try {
      const obj = JSON.parse(progressBox.value.trim());
      if (!obj || !obj.lectures) { alert("Invalid JSON progress."); return; }
      saveProgress(obj);
      alert("Progress imported ✅");
    } catch { alert("Invalid JSON progress."); }
  }

  function clearLectureProgress() {
    const p = loadProgress();
    if (p.lectures[quizMeta.id]) { delete p.lectures[quizMeta.id]; saveProgress(p); }
    alert("This lecture progress cleared ✅");
  }

  // ======= Event Listeners =======
  btnCheck.addEventListener("click", () => checkAnswers(false));
  btnReset.addEventListener("click", resetQuiz);
  btnWeak.addEventListener("click", startWeakMode);
  btnExitWeak.addEventListener("click", exitWeakMode);

  btnExportLecture.addEventListener("click", exportLectureProgress);
  btnShowAttempt.addEventListener("click", showAttempt);

  btnExport.addEventListener("click", exportProgress);
  btnExportWeakOnly.addEventListener("click", exportWeakOnlyProgress);
  btnImport.addEventListener("click", importProgress);
  btnClearLecture.addEventListener("click", clearLectureProgress);
  btnClearAll.addEventListener("click", () => { localStorage.removeItem(STORAGE_KEY); alert("All progress cleared ✅"); });

  btnApplyRange.addEventListener("click", buildQuiz);
  btnClearRange.addEventListener("click", () => { rangeBox.value = ""; buildQuiz(); });
  limitQuestionsInput.addEventListener("change", buildQuiz);

  initMenu();
})();
