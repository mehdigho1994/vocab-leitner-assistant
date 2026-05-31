let cards = [];
let dueCards = [];
let dashboard = null;
let reviewQueue = [];
let currentReviewIndex = 0;
let modalAnswerVisible = false;
let modalDetailsToken = 0;

const LANGUAGES = [
  ["fa","Persian"],["ar","Arabic"],["bg","Bulgarian"],["ca","Catalan"],["zh-CN","Chinese Simplified"],["zh-TW","Chinese Traditional"],["hr","Croatian"],["cs","Czech"],["da","Danish"],["nl","Dutch"],["en","English"],["et","Estonian"],["fi","Finnish"],["fr","French"],["de","German"],["el","Greek"],["he","Hebrew"],["hi","Hindi"],["hu","Hungarian"],["id","Indonesian"],["it","Italian"],["ja","Japanese"],["ko","Korean"],["lv","Latvian"],["lt","Lithuanian"],["ms","Malay"],["no","Norwegian"],["pl","Polish"],["pt","Portuguese"],["pt-BR","Portuguese Brazilian"],["ro","Romanian"],["ru","Russian"],["sk","Slovak"],["sl","Slovenian"],["es","Spanish"],["sv","Swedish"],["th","Thai"],["tr","Turkish"],["uk","Ukrainian"],["ur","Urdu"],["vi","Vietnamese"]
];

init();

document.getElementById("startReview").addEventListener("click", startManualReviewOnPage);
document.getElementById("closeReview").addEventListener("click", closeReviewModal);
document.getElementById("exportWords").addEventListener("click", exportWordsCsv);
document.getElementById("dailyGoal").addEventListener("change", saveSettingsFromUI);
document.getElementById("dailyGoal").addEventListener("keydown", (e) => { if (e.key === "Enter") saveSettingsFromUI(); });
document.getElementById("browseReviewEnabled").addEventListener("change", saveSettingsFromUI);
document.getElementById("browseInterval").addEventListener("change", syncIntervalFromNumber);
document.getElementById("browseInterval").addEventListener("input", syncIntervalFromNumber);
document.getElementById("browseIntervalRange").addEventListener("input", syncIntervalFromRange);
document.getElementById("browseBatchSize").addEventListener("change", saveSettingsFromUI);
document.getElementById("browseBatchSize").addEventListener("input", saveSettingsFromUI);
document.getElementById("translationTarget").addEventListener("change", saveSettingsFromUI);
document.getElementById("visualTheme").addEventListener("change", saveSettingsFromUI);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeReviewModal();
});

async function init() {
  renderLanguageOptions();
  const res = await chrome.runtime.sendMessage({ type: "GET_DASHBOARD" });
  dashboard = res?.data || {
    cards: [], due: [], boxes: [], learned: 0,
    settings: { dailyGoal: 10, browseReviewEnabled: false, browseReviewIntervalMinutes: 60, browseReviewBatchSize: 3, translationTarget: "fa", visualTheme: "promo" },
    addedToday: 0,
    streak: { currentStreak: 0, bestStreak: 0, totalActiveDays: 0, streakMissed: false, hasToday: true }
  };
  cards = dashboard.cards || [];
  dueCards = dashboard.due || [];

  document.getElementById("stats").textContent = `${cards.length} saved • ${dueCards.length} due now • ${dashboard.learned || 0} learned`;
  document.getElementById("dailyGoal").value = dashboard.settings?.dailyGoal || 10;
  document.getElementById("browseReviewEnabled").checked = Boolean(dashboard.settings?.browseReviewEnabled);
  const interval = Number(dashboard.settings?.browseReviewIntervalMinutes || 60);
  document.getElementById("browseInterval").value = String(interval);
  document.getElementById("browseIntervalRange").value = String(Math.min(120, interval));
  document.getElementById("browseBatchSize").value = String(dashboard.settings?.browseReviewBatchSize || 3);
  document.getElementById("translationTarget").value = dashboard.settings?.translationTarget || "fa";
  document.getElementById("visualTheme").value = dashboard.settings?.visualTheme || "promo";
  applyVisualTheme(dashboard.settings?.visualTheme || "promo");

  renderStreak();
  renderGoal();
  renderBoxes();
  renderReviewIntro();
  startMascotBlinkLoop();
}


let mascotBlinkTimer = null;

function mascotSrcFor(mood = "happy", blink = false) {
  const suffix = blink ? "-blink" : "";
  if (mood === "study") return `assets/mascot-study${suffix}.svg`;
  return `assets/mascot-${mood}${suffix}.svg`;
}

function applyMascotMood(ids, mood = "happy") {
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
    const el = typeof id === "string" ? document.getElementById(id) : id;
    if (!el) return;
    el.dataset.mood = mood;
    el.src = mascotSrcFor(mood, false);
    el.alt = mood === "study" ? "study owl mascot" : `${mood} owl mascot`;
  });
}

function blinkMascot(el) {
  if (!el) return;
  const mood = el.dataset.mood || "happy";
  el.classList.add("blinking");
  el.src = mascotSrcFor(mood, true);
  clearTimeout(el._blinkTimeout);
  el._blinkTimeout = setTimeout(() => {
    el.src = mascotSrcFor(mood, false);
    el.classList.remove("blinking");
  }, 140);
}

function startMascotBlinkLoop() {
  clearInterval(mascotBlinkTimer);
  mascotBlinkTimer = setInterval(() => {
    const mascots = [document.getElementById("streakMascot")].filter(Boolean);
    const target = mascots[Math.floor(Math.random() * mascots.length)];
    blinkMascot(target);
  }, 3400);
}

function renderStreak() {
  const s = dashboard.streak || {};
  const current = Number(s.currentStreak || 0);
  const total = Number(s.totalActiveDays || 0);
  const learned = Number(dashboard.learned || 0);
  const missed = Boolean(s.streakMissed);
  const card = document.getElementById("streakCard");

  document.getElementById("streakDays").textContent = current;

  if (missed) {
    applyMascotMood("streakMascot", "sad");
    card.classList.add("missed");
    card.classList.remove("fire-streak");
    document.getElementById("streakTitle").textContent = "Your streak needs a comeback";
    document.getElementById("streakText").textContent = `You have used the extension on ${total} day${total === 1 ? "" : "s"}. Review one card today to make the mascot happy again.`;
  } else if (current >= 7) {
    applyMascotMood("streakMascot", "fire");
    card.classList.remove("missed");
    card.classList.add("fire-streak");
    document.getElementById("streakTitle").textContent = "You are on fire";
    document.getElementById("streakText").textContent = `${current} days in a row • ${learned} words completely learned • best streak ${s.bestStreak || current}.`;
  } else if (current > 0) {
    applyMascotMood("streakMascot", "happy");
    card.classList.remove("missed");
    card.classList.remove("fire-streak");
    document.getElementById("streakTitle").textContent = "Streak alive";
    document.getElementById("streakText").textContent = `${current} day${current === 1 ? "" : "s"} active • ${learned} words completely learned. Keep it alive today.`;
  } else {
    applyMascotMood("streakMascot", "happy");
    card.classList.remove("missed");
    card.classList.remove("fire-streak");
    document.getElementById("streakTitle").textContent = "Start your streak";
    document.getElementById("streakText").textContent = `Open reviews or add words daily to build your plan.`;
  }
}

function renderGoal() {
  const goal = Number(dashboard.settings?.dailyGoal || 10);
  const added = Number(dashboard.addedToday || 0);
  const percent = Math.min(100, Math.round((added / goal) * 100));
  document.getElementById("goalProgress").innerHTML = `${added}/${goal} words added today<div class="progress-wrap"><div class="progress" style="width:${percent}%"></div></div>`;
}

function renderBoxes() {
  const boxes = document.getElementById("boxes");
  const data = dashboard.boxes?.length ? dashboard.boxes : [1,2,3,4,5].map(box => ({ box, count: 0 }));
  boxes.innerHTML = data.map(b => `
    <div class="box">
      <span>Box ${b.box}</span>
      <strong>${b.count}</strong>
      <small>${boxLabel(b.box)}</small>
    </div>
  `).join("");

  document.getElementById("learned").innerHTML = `
    <div>
      <b>Completely learned</b>
      <p class="muted">Cards you knew after reaching box 5.</p>
    </div>
    <strong>🏆 ${dashboard.learned || 0}</strong>
  `;
}

function boxLabel(box) { return ({1:"new",2:"1 day",3:"3 days",4:"7 days",5:"14 days"})[box] || ""; }

function renderReviewIntro() {
  const wrap = document.getElementById("review");
  const mode = dashboard.settings?.browseReviewEnabled
    ? `Browsing review is ON: ${dashboard.settings?.browseReviewBatchSize || 3} word(s) every ${dashboard.settings?.browseReviewIntervalMinutes || 60} minute(s).`
    : "Browsing review is OFF. Use the Review button for manual study.";
  wrap.innerHTML = `<div class="card"><b>Ready to review?</b><p class="muted">${mode}</p><p class="muted">Due cards: ${dueCards.length}</p></div>`;
}

async function startManualReviewOnPage() {
  const btn = document.getElementById("startReview");
  const oldText = btn.textContent;
  btn.textContent = "Opening...";
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "START_MANUAL_REVIEW", limit: 50 });
    if (res?.ok && res.data?.started) {
      window.close();
      return;
    }
    const reviewArea = document.getElementById("review");
    reviewArea.innerHTML = `<div class="empty">${escapeHtml(res?.data?.message || res?.error || "No due words right now.")}</div>`;
  } catch (e) {
    document.getElementById("review").innerHTML = `<div class="empty">${escapeHtml(e.message || "Could not open manual review on this page.")} Open a normal webpage and try again.</div>`;
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
}

async function openReviewModal() {
  const res = await chrome.runtime.sendMessage({ type: "GET_DUE_CARDS" });
  reviewQueue = res?.data || dueCards || [];
  currentReviewIndex = 0;
  modalAnswerVisible = false;
  document.getElementById("reviewModal").classList.remove("hidden");
  renderModalCard();
}

function closeReviewModal() {
  document.getElementById("reviewModal").classList.add("hidden");
  document.getElementById("modalBody").innerHTML = "";
  reviewQueue = [];
  currentReviewIndex = 0;
  modalAnswerVisible = false;
}

function currentModalCard() { return reviewQueue[currentReviewIndex]; }

function renderModalCard() {
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  const c = currentModalCard();

  if (!c) {
    title.textContent = "Finished";
    body.innerHTML = `<div class="modal-finished"><div class="finish-emoji">🎉</div><b>No more due words right now.</b><p class="muted">Nice work. Your dashboard has been updated.</p><button id="doneReview">Done</button></div>`;
    document.getElementById("doneReview").onclick = closeReviewModal;
    init();
    return;
  }

  title.textContent = `${currentReviewIndex + 1}/${reviewQueue.length}`;
  const target = dashboard.settings?.translationTarget || "fa";
  const targetName = languageName(target);
  body.innerHTML = `
    <div class="modal-card-content">
      <div class="term"><span>${escapeHtml(c.term)}</span><span class="muted">Box ${c.box || 1}</span></div>
      <p class="muted">Remember it first, then reveal the answer.</p>
      ${c.contextSentence ? `<div class="context-sentence">${escapeHtml(c.contextSentence)}</div>` : ""}
      ${audioButtons(c)}
      <button id="modalReveal">${modalAnswerVisible ? "Hide answer" : "Show answer"}</button>
      <div id="modalAnswer" class="reveal ${modalAnswerVisible ? "" : "hidden"}">
        <p><b>Saved meaning:</b> ${escapeHtml(c.meaning || "No meaning saved.")}</p>
        ${c.example ? `<p class="muted"><b>Saved example:</b> ${escapeHtml(c.example)}</p>` : ""}
        <div class="review-extra-grid">
          <div class="review-extra" id="modalDict"><b>Dictionary</b><p class="muted">${modalAnswerVisible ? "Loading dictionary..." : "Click Show answer to load."}</p></div>
          <div class="review-extra ${isRtlLang(target) ? "rtl" : ""}" id="modalTrans"><b>Translate: ${escapeHtml(targetName)}</b><p class="muted">${modalAnswerVisible ? "Loading translation..." : "Click Show answer to load."}</p></div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="known" id="modalKnown">I know it</button>
        <button class="again" id="modalAgain">Again</button>
        <button class="later" id="modalLater">Later</button>
      </div>
    </div>
  `;
  bindAudio(body, c);
  document.getElementById("modalReveal").onclick = () => {
    modalAnswerVisible = !modalAnswerVisible;
    renderModalCard();
    if (modalAnswerVisible) loadModalDetails(c);
  };
  document.getElementById("modalKnown").onclick = () => answerModalCard("known");
  document.getElementById("modalAgain").onclick = () => answerModalCard("again");
  document.getElementById("modalLater").onclick = () => skipModalCard();
  if (modalAnswerVisible) loadModalDetails(c);
}

async function loadModalDetails(card) {
  const token = ++modalDetailsToken;
  const target = dashboard.settings?.translationTarget || "fa";
  const dictEl = document.getElementById("modalDict");
  const transEl = document.getElementById("modalTrans");

  try {
    const dict = await chrome.runtime.sendMessage({ type: "FETCH_DICTIONARY", text: card.term });
    if (token !== modalDetailsToken) return;
    if (dict?.ok) {
      const meanings = (dict.data.meanings || []).slice(0, 3).map((m, i) => `<p><b>${i + 1}. ${escapeHtml(m.partOfSpeech || "meaning")}</b> — ${escapeHtml(m.definition || "")}</p>${m.example ? `<p class="muted">Example: ${escapeHtml(m.example)}</p>` : ""}`).join("");
      dictEl.innerHTML = `<b>Dictionary</b>${meanings || `<p class="muted">No dictionary result.</p>`}`;
    } else {
      dictEl.innerHTML = `<b>Dictionary</b><p class="muted">${escapeHtml(dict?.error || "Dictionary failed.")}</p>`;
    }
  } catch (e) {
    if (dictEl) dictEl.innerHTML = `<b>Dictionary</b><p class="muted">${escapeHtml(e.message || "Dictionary failed.")}</p>`;
  }

  try {
    const tr = await chrome.runtime.sendMessage({ type: "FETCH_TRANSLATION", text: card.term, targetLang: target });
    if (token !== modalDetailsToken) return;
    if (tr?.ok) {
      transEl.innerHTML = `<b>Translate: ${escapeHtml(tr.data.targetName)}</b><div class="translated-line">${escapeHtml(tr.data.translatedText)}</div><p class="muted">${escapeHtml(tr.data.sourceLang)} → ${escapeHtml(tr.data.targetLang)}</p>`;
    } else {
      transEl.innerHTML = `<b>Translate: ${escapeHtml(languageName(target))}</b><p class="muted">${escapeHtml(tr?.error || "Translation failed.")}</p>`;
    }
  } catch (e) {
    if (transEl) transEl.innerHTML = `<b>Translate: ${escapeHtml(languageName(target))}</b><p class="muted">${escapeHtml(e.message || "Translation failed.")}</p>`;
  }
}

async function answerModalCard(result) {
  const card = currentModalCard();
  if (!card?.id) return;
  await chrome.runtime.sendMessage({ type: "REVIEW_CARD", id: card.id, result });
  reviewQueue.splice(currentReviewIndex, 1);
  if (currentReviewIndex >= reviewQueue.length) currentReviewIndex = 0;
  modalAnswerVisible = false;
  await refreshDashboardQuietly();
  renderModalCard();
}

function skipModalCard() {
  if (reviewQueue.length <= 1) {
    reviewQueue = [];
  } else {
    const [card] = reviewQueue.splice(currentReviewIndex, 1);
    reviewQueue.push(card);
    if (currentReviewIndex >= reviewQueue.length) currentReviewIndex = 0;
  }
  modalAnswerVisible = false;
  renderModalCard();
}

async function refreshDashboardQuietly() {
  const res = await chrome.runtime.sendMessage({ type: "GET_DASHBOARD" });
  if (!res?.data) return;
  dashboard = res.data;
  cards = dashboard.cards || [];
  dueCards = dashboard.due || [];
  document.getElementById("stats").textContent = `${cards.length} saved • ${dueCards.length} due now • ${dashboard.learned || 0} learned`;
  renderStreak();
  renderGoal();
  renderBoxes();
  renderReviewIntro();
  startMascotBlinkLoop();
}

function exportWordsCsv() {
  const headers = ["term","meaning","example","contextSentence","pageTitle","pageUrl","partOfSpeech","phonetic","box","learned","createdAt","dueAt","correctCount","wrongCount"];
  const rows = cards.map(c => headers.map(h => csvCell(formatExportValue(c[h]))).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vocab-leitner-words-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatExportValue(value) {
  if (value == null) return "";
  if (typeof value === "number" && value > 1000000000000) return new Date(value).toISOString();
  return value;
}
function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

async function saveSettingsFromUI() {
  const dailyGoal = Math.max(1, Math.min(200, Number(document.getElementById("dailyGoal").value) || 10));
  const browseReviewEnabled = document.getElementById("browseReviewEnabled").checked;
  const browseReviewIntervalMinutes = Math.max(1, Math.min(240, Number(document.getElementById("browseInterval").value) || 60));
  const browseReviewBatchSize = Math.max(1, Math.min(50, Number(document.getElementById("browseBatchSize").value) || 3));
  const translationTarget = document.getElementById("translationTarget").value || "fa";
  const visualTheme = document.getElementById("visualTheme").value || "promo";
  applyVisualTheme(visualTheme);
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: { dailyGoal, browseReviewEnabled, browseReviewIntervalMinutes, browseReviewBatchSize, translationTarget, visualTheme } });
  await init();
}

function syncIntervalFromNumber() {
  const input = document.getElementById("browseInterval");
  const range = document.getElementById("browseIntervalRange");
  const value = Math.max(1, Math.min(240, Number(input.value) || 60));
  input.value = String(value);
  range.value = String(Math.min(120, value));
  saveSettingsFromUI();
}

function syncIntervalFromRange() {
  const value = Number(document.getElementById("browseIntervalRange").value) || 60;
  document.getElementById("browseInterval").value = String(value);
  saveSettingsFromUI();
}

function applyVisualTheme(theme = "promo") {
  document.body.classList.toggle("theme-classic", theme === "classic");
  document.body.classList.toggle("theme-promo", theme !== "classic");
}

function renderLanguageOptions() {
  const select = document.getElementById("translationTarget");
  if (!select || select.options.length) return;
  select.innerHTML = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
}

function languageName(code = "fa") {
  const found = LANGUAGES.find(([c]) => c === code);
  return found ? found[1] : String(code).toUpperCase();
}
function isRtlLang(code) { return ["fa", "ar", "ur", "he"].includes(code); }

function audioButtons(c) {
  const api = (c.audioItems || []).map((a, i) => `<button class="audio" data-audio="${i}">🔊 ${escapeHtml(a.accent || "Audio")}</button>`).join("");
  return `<div>${api}<button class="audio" data-speak="us">🇺🇸 Spell US</button><button class="audio" data-speak="uk">🇬🇧 Spell UK</button></div>`;
}

function bindAudio(scope, c) {
  scope.querySelectorAll("[data-audio]").forEach(btn => {
    btn.onclick = () => {
      const item = c.audioItems?.[Number(btn.dataset.audio)];
      if (item?.audio) new Audio(item.audio).play();
    };
  });
  scope.querySelectorAll("[data-speak]").forEach(btn => {
    btn.onclick = () => speak(c.term, btn.dataset.speak === "us" ? "en-US" : "en-GB");
  });
}

function speak(text, lang) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.82;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"}[ch]));
}
