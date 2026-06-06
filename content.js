let currentData = null;
let selectedContextSentence = "";
let selectedPageUrl = "";
let selectedPageTitle = "";
let outsideClickHandler = null;
let escHandler = null;
let inlineReviewCard = null;
let inlineAnswerVisible = false;
let inlineReviewLimit = 1;
let inlineReviewedThisSession = 0;
let inlineReviewQueue = [];
let currentSettings = { translationTarget: "fa", visualTheme: "promo" };
let inlineReviewMode = "browsing";
let inlineMascotMood = "happy";
let mascotBlinkTimer = null;

function mascotAsset(mood = "happy", blink = false) {
  const suffix = blink ? "-blink" : "";
  if (mood === "study") return chrome.runtime.getURL(`assets/mascot-study${suffix}.svg`);
  return chrome.runtime.getURL(`assets/mascot-${mood}${suffix}.svg`);
}

function setMascotMood(selector, mood = "happy") {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  el.dataset.mood = mood;
  el.src = mascotAsset(mood, false);
}

function blinkMascot(selector) {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const mood = el.dataset.mood || "happy";
  el.src = mascotAsset(mood, true);
  clearTimeout(el._blinkTimeout);
  el._blinkTimeout = setTimeout(() => { el.src = mascotAsset(mood, false); }, 140);
}

function startContentBlinkLoop() {
  clearInterval(mascotBlinkTimer);
  mascotBlinkTimer = setInterval(() => {
    const mascots = Array.from(document.querySelectorAll('#vla-toolbar .vla-head-mascot, #vla-inline-review .vla-mascot')).filter(Boolean);
    if (!mascots.length) return;
    blinkMascot(mascots[Math.floor(Math.random() * mascots.length)]);
  }, 3500);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "VLA_PING") {
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "SHOW_VOCAB_TOOLBAR") showToolbar(message.text);
  if (message.type === "SHOW_REVIEW_REMINDER") {
    showToast(`${message.count} Leitner review${message.count > 1 ? "s" : ""} due. Open the extension popup to review.`);
  }
  if (message.type === "SHOW_INLINE_REVIEW") showInlineReview(message.limit || message.count || 1, message.mode || "browsing");
});

async function showToolbar(text) {
  removeToolbar();
  removeInlineReview();
  currentData = null;
  currentSettings = await getExtensionSettings();
  const targetLabel = languageName(currentSettings.translationTarget || "fa");

  const selection = window.getSelection();
  let rect = null;
  if (selection && selection.rangeCount > 0) rect = selection.getRangeAt(0).getBoundingClientRect();
  selectedContextSentence = getSelectedSentence(text);
  selectedPageUrl = location.href;
  selectedPageTitle = document.title || "";

  const box = document.createElement("div");
  box.id = "vla-toolbar";
  box.className = currentSettings.visualTheme === "classic" ? "vla-theme-classic" : "vla-theme-promo";
  box.innerHTML = `
    <div class="vla-head">
      <div class="vla-head-brand">
        <img class="vla-logo" src="${chrome.runtime.getURL("assets/logo.svg")}" alt="Vocab Assistant" />
        <img class="vla-head-mascot" src="${mascotAsset("study", false)}" alt="Study owl mascot" data-mood="study" />
        <div class="vla-title-wrap">
          <span class="vla-kicker">Vocab Assistant</span>
          <strong title="${escapeHtml(text)}">${escapeHtml(text)}</strong>
        </div>
      </div>
      <button class="vla-close" title="Close">×</button>
    </div>
    <div class="vla-actions">
      <button data-action="dictionary">📖 Dictionary</button>
      <button data-action="leitner">✨ + Leitner</button>
      <button data-action="us">🇺🇸 Spell US</button>
      <button data-action="uk">🇬🇧 Spell UK</button>
      <button data-action="translate">🌍 Translate: ${escapeHtml(targetLabel)}</button>
    </div>
    <div class="vla-body"><div class="vla-loading"><span></span>Loading dictionary...</div></div>
  `;
  document.documentElement.appendChild(box);
  startContentBlinkLoop();

  positionToolbar(box, rect);

  box.querySelector(".vla-close").onclick = removeToolbar;
  box.querySelector('[data-action="dictionary"]').onclick = () => loadDictionary(text);
  box.querySelector('[data-action="leitner"]').onclick = () => addSelectedToLeitner(text);
  box.querySelector('[data-action="us"]').onclick = () => speak(text, "en-US");
  box.querySelector('[data-action="uk"]').onclick = () => speak(text, "en-GB");
  box.querySelector('[data-action="translate"]').onclick = () => loadTranslation(text);

  bindDismissHandlers("vla-toolbar", removeToolbar);
  loadDictionary(text);
}

function positionToolbar(box, rect) {
  const margin = 12;
  const gap = 10;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const estimatedWidth = 380;

  box.style.position = "fixed";
  box.style.maxHeight = `${Math.max(220, viewportHeight - margin * 2)}px`;
  box.style.width = `${Math.min(estimatedWidth, Math.max(300, viewportWidth - margin * 2))}px`;
  box.style.left = "auto";
  box.style.right = "auto";
  box.style.top = "-9999px";
  box.style.visibility = "hidden";

  requestAnimationFrame(() => {
    const boxRect = box.getBoundingClientRect();
    const boxWidth = boxRect.width || Math.min(estimatedWidth, viewportWidth - margin * 2);
    const boxHeight = boxRect.height || 320;

    const selectionLeft = rect ? rect.left : viewportWidth / 2 - boxWidth / 2;
    const selectionRight = rect ? rect.right : selectionLeft + boxWidth;
    const availableBelow = rect ? viewportHeight - rect.bottom - gap : viewportHeight - margin * 2;
    const availableAbove = rect ? rect.top - gap : viewportHeight - margin * 2;

    let top;
    if (rect && availableBelow < boxHeight && availableAbove > availableBelow) {
      top = Math.max(margin, rect.top - boxHeight - gap);
    } else if (rect) {
      top = Math.min(viewportHeight - boxHeight - margin, rect.bottom + gap);
    } else {
      top = Math.max(margin, Math.min(viewportHeight - boxHeight - margin, 80));
    }

    let left = rect ? rect.left : (viewportWidth - boxWidth) / 2;
    left = Math.max(margin, Math.min(viewportWidth - boxWidth - margin, left));

    if (rect && selectionRight > viewportWidth - margin) {
      left = Math.max(margin, viewportWidth - boxWidth - margin);
    }
    if (rect && selectionLeft < margin) {
      left = margin;
    }

    box.style.top = `${Math.max(margin, top)}px`;
    box.style.left = `${Math.max(margin, left)}px`;
    box.style.visibility = "visible";
  });
}

function bindDismissHandlers(elementId, closeFn) {
  if (outsideClickHandler) document.removeEventListener("pointerdown", outsideClickHandler, true);
  if (escHandler) document.removeEventListener("keydown", escHandler, true);

  outsideClickHandler = (event) => {
    const el = document.getElementById(elementId);
    if (el && !el.contains(event.target)) closeFn();
  };
  escHandler = (event) => {
    if (event.key === "Escape") closeFn();
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClickHandler, true);
    document.addEventListener("keydown", escHandler, true);
  }, 0);
}

function clearDismissHandlers() {
  if (outsideClickHandler) document.removeEventListener("pointerdown", outsideClickHandler, true);
  if (escHandler) document.removeEventListener("keydown", escHandler, true);
  outsideClickHandler = null;
  escHandler = null;
}

function removeToolbar() {
  document.getElementById("vla-toolbar")?.remove();
  clearDismissHandlers();
}

async function loadDictionary(text) {
  setBody(`<div class="vla-loading"><span></span>Loading dictionary...</div>`);
  chrome.runtime.sendMessage({ type: "FETCH_DICTIONARY", text }, (res) => {
    const runtimeError = chrome.runtime.lastError?.message;
    if (runtimeError || !res?.ok) {
      setBody(`<p class="vla-error">${escapeHtml(runtimeError || res?.error || "Dictionary failed.")}</p><p class="vla-muted">Test on a normal website and try a clean English word like <b>capable</b>. For phrases, the extension falls back to the main word.</p>`);
      return;
    }
    currentData = res.data;
    renderDictionary(res.data);
  });
}

function renderDictionary(data) {
  const audioButtons = (data.audioItems || []).map((a, i) => `<button class="vla-small" data-audio="${i}">🔊 ${escapeHtml(a.accent)}</button>`).join(" ");
  const meanings = (data.meanings || []).map((m, i) => `
    <div class="vla-meaning">
      <b>${i + 1}. ${escapeHtml(m.partOfSpeech || "meaning")}</b>
      <p>${escapeHtml(m.definition)}</p>
      ${m.example ? `<em>Example: ${escapeHtml(m.example)}</em>` : ""}
      ${m.synonyms?.length ? `<div class="vla-muted">Synonyms: ${escapeHtml(m.synonyms.join(", "))}</div>` : ""}
    </div>
  `).join("");

  setBody(`
    <div class="vla-wordline"><b>${escapeHtml(data.word)}</b> <span>${escapeHtml(data.phonetic || "")}</span></div>
    <div class="vla-audios">${audioButtons || `<span class="vla-muted">No API audio found. Use Spell US/UK buttons.</span>`}</div>
    ${meanings || `<p>No meanings found.</p>`}

  `);

  document.querySelectorAll("#vla-toolbar [data-audio]").forEach((btn) => {
    btn.onclick = () => {
      const item = data.audioItems[Number(btn.dataset.audio)];
      if (item?.audio) new Audio(item.audio).play();
    };
  });
}

async function loadTranslation(text) {
  const targetLang = currentSettings.translationTarget || "fa";
  setBody(`<div class="vla-loading"><span></span>Translating to ${escapeHtml(languageName(targetLang))}...</div>`);
  chrome.runtime.sendMessage({ type: "FETCH_TRANSLATION", text, targetLang }, (res) => {
    const runtimeError = chrome.runtime.lastError?.message;
    if (runtimeError || !res?.ok) {
      setBody(`<p class="vla-error">${escapeHtml(runtimeError || res?.error || "Translation failed.")}</p><p class="vla-muted">This uses the free MyMemory API with simple codes like en|fa. If it fails, the provider may be rate-limited in your network.</p>`);
      return;
    }
    renderTranslation(res.data);
  });
}

function renderTranslation(data) {
  const isRtl = ["fa", "ar", "ur", "he"].includes(data.targetLang);
  setBody(`
    <div class="vla-translate-card ${isRtl ? "vla-rtl" : ""}">
      <span class="vla-kicker">Translation • ${escapeHtml(data.targetName)}</span>
      <div class="vla-translated">${escapeHtml(data.translatedText)}</div>
      <div class="vla-muted">Provider: ${escapeHtml(data.source)} • ${escapeHtml(data.sourceLang)} → ${escapeHtml(data.targetLang)}</div>
    </div>

    <button class="vla-small" id="vla-back-dict">📖 Back to dictionary</button>
  `);
  const back = document.getElementById("vla-back-dict");
  if (back) back.onclick = () => loadDictionary(data.originalText);
}

async function addSelectedToLeitner(text) {
  if (!currentData) {
    setBody(`<div class="vla-loading"><span></span>Finding meaning before saving...</div>`);
    try {
      const res = await sendMessagePromise({ type: "FETCH_DICTIONARY", text });
      if (res?.ok) currentData = res.data;
    } catch (_) {}
  }

  const first = currentData?.meanings?.[0] || {};
  const card = {
    term: text,
    meaning: first.definition || "",
    example: first.example || "",
    contextSentence: selectedContextSentence || "",
    pageUrl: selectedPageUrl || location.href,
    pageTitle: selectedPageTitle || document.title || "",
    partOfSpeech: first.partOfSpeech || "",
    phonetic: currentData?.phonetic || "",
    audioItems: currentData?.audioItems || []
  };

  chrome.runtime.sendMessage({ type: "ADD_TO_LEITNER", card }, (res) => {
    if (!res?.ok) {
      setBody(`<p class="vla-error">${escapeHtml(res?.error || "Could not add card.")}</p>`);
      return;
    }
    showToast(`Added to Leitner: ${text}`);
    setBody(`<div class="vla-success">✅ Added to Leitner box ${res.data.box}.</div><p class="vla-muted">Open the extension popup or enable browsing review to study cards.</p>`);
  });
}

async function showInlineReview(limit = 1, mode = "browsing") {
  removeToolbar();
  removeInlineReview();
  currentSettings = await getExtensionSettings();
  inlineAnswerVisible = false;
  inlineReviewMode = mode === "manual" ? "manual" : "browsing";
  inlineReviewLimit = Math.max(1, Math.min(50, Number(limit) || 1));
  inlineReviewedThisSession = 0;
  inlineMascotMood = "happy";

  const res = await sendMessagePromise({ type: "GET_DUE_CARDS", limit: inlineReviewLimit });
  const cards = res?.data || [];
  if (!cards.length) return;

  inlineReviewCard = cards[0];
  inlineReviewQueue = cards.slice(1);
  renderInlineReview();
}

function renderInlineReview() {
  const c = inlineReviewCard;
  if (!c) return;

  let box = document.getElementById("vla-inline-review");
  if (!box) {
    box = document.createElement("div");
    box.id = "vla-inline-review";
    box.className = currentSettings.visualTheme === "classic" ? "vla-theme-classic" : "vla-theme-promo";
    document.documentElement.appendChild(box);
  startContentBlinkLoop();
    bindDismissHandlers("vla-inline-review", removeInlineReview);
  }

  box.className = currentSettings.visualTheme === "classic" ? "vla-theme-classic" : "vla-theme-promo";

  const targetLang = currentSettings.translationTarget || "fa";
  const targetName = languageName(targetLang);
  box.innerHTML = `
    <div class="vla-review-top">
      <div class="vla-review-brand"><img class="vla-mascot" src="${mascotAsset(inlineMascotMood, false)}" alt="Mascot" data-mood="${inlineMascotMood}" />
      <div>
        <span class="vla-kicker">${inlineReviewMode === "manual" ? "Manual Review" : "Browsing Review"} • ${inlineReviewedThisSession + 1}/${inlineReviewLimit}</span>
        <strong>${inlineReviewMode === "manual" ? "Review your due words" : "Do you remember this?"}</strong>
      </div></div>
      <button class="vla-close" title="Close">×</button>
    </div>
    <div class="vla-review-term">${escapeHtml(c.term)}</div>
    <div class="vla-muted">Box ${c.box || 1} • say the meaning before revealing it</div>
    ${c.contextSentence ? `<div class="vla-context-sentence">${highlightTermInSentence(c.contextSentence, c.term)}</div>` : ""}
    <div class="vla-review-audio">
      ${audioButtons(c)}
    </div>
    <button class="vla-primary" data-action="reveal">${inlineAnswerVisible ? "Hide answer" : "Show answer"}</button>
    <div class="vla-review-answer ${inlineAnswerVisible ? "" : "vla-hidden"}">
      <p><b>Saved meaning:</b> ${escapeHtml(c.meaning || "No meaning saved.")}</p>
      ${c.example ? `<em>Saved example: ${escapeHtml(c.example)}</em>` : ""}
      <div class="vla-review-extra-grid">
        <div class="vla-review-extra" id="vla-inline-dict"><b>Dictionary</b><p class="vla-muted">${inlineAnswerVisible ? "Loading dictionary..." : "Click Show answer to load."}</p></div>
        <div class="vla-review-extra ${["fa","ar","ur","he"].includes(targetLang) ? "vla-rtl" : ""}" id="vla-inline-trans"><b>Translate: ${escapeHtml(targetName)}</b><p class="vla-muted">${inlineAnswerVisible ? "Loading translation..." : "Click Show answer to load."}</p></div>
      </div>
    </div>
    <div class="vla-review-actions">
      <button class="vla-known" data-action="known">I know it</button>
      <button class="vla-again" data-action="again">Again</button>
      <button class="vla-later" data-action="later">Later</button>
    </div>

  `;

  box.querySelector(".vla-close").onclick = removeInlineReview;
  box.querySelector('[data-action="reveal"]').onclick = () => {
    inlineAnswerVisible = !inlineAnswerVisible;
    renderInlineReview();
    if (inlineAnswerVisible) loadInlineReviewDetails(c);
  startContentBlinkLoop();
  };
  box.querySelector('[data-action="known"]').onclick = () => reviewInlineCard("known");
  box.querySelector('[data-action="again"]').onclick = () => reviewInlineCard("again");
  box.querySelector('[data-action="later"]').onclick = () => nextInlineCard(false);
  bindInlineAudio(box, c);
  if (inlineAnswerVisible) loadInlineReviewDetails(c);
  startContentBlinkLoop();
}

async function loadInlineReviewDetails(card) {
  const dictEl = document.getElementById("vla-inline-dict");
  const transEl = document.getElementById("vla-inline-trans");
  const targetLang = currentSettings.translationTarget || "fa";

  try {
    const dict = await sendMessagePromise({ type: "FETCH_DICTIONARY", text: card.term });
    if (dictEl) {
      if (dict?.ok) {
        const html = (dict.data.meanings || []).slice(0, 2).map((m, i) => `<p><b>${i + 1}. ${escapeHtml(m.partOfSpeech || "meaning")}</b> — ${escapeHtml(m.definition || "")}</p>${m.example ? `<p class="vla-muted">Example: ${escapeHtml(m.example)}</p>` : ""}`).join("");
        dictEl.innerHTML = `<b>Dictionary</b>${html || `<p class="vla-muted">No dictionary result.</p>`}`;
      } else {
        dictEl.innerHTML = `<b>Dictionary</b><p class="vla-muted">${escapeHtml(dict?.error || "Dictionary failed.")}</p>`;
      }
    }
  } catch (e) {
    if (dictEl) dictEl.innerHTML = `<b>Dictionary</b><p class="vla-muted">${escapeHtml(e.message || "Dictionary failed.")}</p>`;
  }

  try {
    const tr = await sendMessagePromise({ type: "FETCH_TRANSLATION", text: card.term, targetLang });
    if (transEl) {
      if (tr?.ok) {
        transEl.innerHTML = `<b>Translate: ${escapeHtml(tr.data.targetName)}</b><div class="vla-translated-small">${escapeHtml(tr.data.translatedText)}</div><p class="vla-muted">${escapeHtml(tr.data.sourceLang)} → ${escapeHtml(tr.data.targetLang)}</p>`;
      } else {
        transEl.innerHTML = `<b>Translate: ${escapeHtml(languageName(targetLang))}</b><p class="vla-muted">${escapeHtml(tr?.error || "Translation failed.")}</p>`;
      }
    }
  } catch (e) {
    if (transEl) transEl.innerHTML = `<b>Translate: ${escapeHtml(languageName(targetLang))}</b><p class="vla-muted">${escapeHtml(e.message || "Translation failed.")}</p>`;
  }
}

function removeInlineReview(clearCard = true) {
  clearInterval(mascotBlinkTimer);
  document.getElementById("vla-inline-review")?.remove();
  clearDismissHandlers();
  if (clearCard) {
    inlineReviewCard = null;
    inlineReviewQueue = [];
    inlineAnswerVisible = false;
  }
}

async function reviewInlineCard(result) {
  if (!inlineReviewCard?.id) return;
  inlineMascotMood = result === "again" ? "sad" : ((inlineReviewCard.box || 1) >= 4 ? "fire" : "happy");
  setMascotMood('#vla-inline-review .vla-mascot', inlineMascotMood);
  blinkMascot('#vla-inline-review .vla-mascot');
  await sendMessagePromise({ type: "REVIEW_CARD", id: inlineReviewCard.id, result });
  await new Promise(r => setTimeout(r, 220));
  nextInlineCard(true);
}

async function nextInlineCard(wasAnswered) {
  if (wasAnswered) inlineReviewedThisSession += 1;
  else inlineReviewedThisSession += 1;

  if (inlineReviewedThisSession >= inlineReviewLimit) {
    showInlineFinished();
    return;
  }

  if (inlineReviewQueue.length) {
    inlineReviewCard = inlineReviewQueue.shift();
    inlineAnswerVisible = false;
    inlineMascotMood = "happy";
    renderInlineReview();
  } else {
    showInlineFinished("No more due words right now 🎉");
  }
}

function showInlineFinished(message = null) {
  message = message || (inlineReviewMode === "manual" ? "Manual review finished 🎉" : "Great. Browsing review finished 🎉");
  const box = document.getElementById("vla-inline-review");
  if (!box) {
    showToast(message);
    return;
  }
  box.innerHTML = `
    <div class="vla-review-top">
      <div class="vla-review-brand"><img class="vla-mascot" src="${mascotAsset("fire", false)}" alt="Happy mascot" data-mood="fire" /><div><span class="vla-kicker">Review complete</span><strong>${escapeHtml(message)}</strong></div></div>
      <button class="vla-close" title="Close">×</button>
    </div>
    <p class="vla-muted">The same popup stayed open and your progress was saved.</p>
  `;
  box.querySelector(".vla-close").onclick = removeInlineReview;
  setTimeout(removeInlineReview, 2500);
}

function audioButtons(c) {
  const api = (c.audioItems || []).slice(0, 2).map((a, i) => `<button class="vla-small" data-audio="${i}">🔊 ${escapeHtml(a.accent || "Audio")}</button>`).join("");
  return `${api}<button class="vla-small" data-speak="us">🇺🇸 US</button><button class="vla-small" data-speak="uk">🇬🇧 UK</button>`;
}

function bindInlineAudio(scope, c) {
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
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.82;
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang === lang) || voices.find((v) => v.lang?.startsWith(lang.slice(0, 2)));
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function setBody(html) {
  const body = document.querySelector("#vla-toolbar .vla-body");
  if (body) body.innerHTML = html;
}

function showToast(message) {
  document.getElementById("vla-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "vla-toast";
  toast.textContent = message;
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

function sendMessagePromise(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

async function getExtensionSettings() {
  try {
    const res = await sendMessagePromise({ type: "GET_SETTINGS" });
    return res?.data || { translationTarget: "fa", visualTheme: "promo" };
  } catch (_) {
    return { translationTarget: "fa", visualTheme: "promo" };
  }
}

function normalizeInlineText(str = "") {
  return String(str).replace(/\s+/g, " ").trim();
}

function getSelectedSentence(selectedText = "") {
  try {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0);
    let node = range.commonAncestorContainer;
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return "";

    const block = element.closest("p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6") || element.closest("article, section, div") || element;
    let text = normalizeInlineText(block.innerText || block.textContent || "");
    const selected = normalizeInlineText(selectedText);
    if (!text || !selected) return "";

    // Very large containers can happen on modern apps. Keep a useful local window around the selected word.
    const lowerText = text.toLowerCase();
    const lowerSelected = selected.toLowerCase();
    let idx = lowerText.indexOf(lowerSelected);

    if (idx < 0) {
      const firstToken = lowerSelected.split(/\s+/)[0];
      idx = firstToken ? lowerText.indexOf(firstToken) : -1;
    }
    if (idx < 0) return text.slice(0, 260);

    const endIdx = idx + selected.length;
    const sentenceMarks = ".!?؟؛;。！？";
    let start = 0;
    for (let i = idx - 1; i >= 0; i--) {
      if (sentenceMarks.includes(text[i])) { start = i + 1; break; }
      if (idx - i > 260) { start = i; break; }
    }
    let end = text.length;
    for (let i = endIdx; i < text.length; i++) {
      if (sentenceMarks.includes(text[i])) { end = i + 1; break; }
      if (i - endIdx > 260) { end = i; break; }
    }
    return normalizeInlineText(text.slice(start, end)).slice(0, 600);
  } catch (_) {
    return "";
  }
}

function highlightTermInSentence(sentence = "", term = "") {
  const safeSentence = escapeHtml(sentence);
  const cleanTerm = normalizeInlineText(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!cleanTerm) return safeSentence;
  try {
    return safeSentence.replace(new RegExp(`(${cleanTerm})`, "ig"), '<mark class="vla-context-highlight">$1</mark>');
  } catch (_) {
    return safeSentence;
  }
}


function languageName(code = "fa") {
  const map = {
    "fa":"Persian", ar:"Arabic", bg:"Bulgarian", ca:"Catalan", "zh-CN":"Chinese Simplified", "zh-TW":"Chinese Traditional", hr:"Croatian", cs:"Czech", da:"Danish", nl:"Dutch", en:"English", et:"Estonian", fi:"Finnish", fr:"French", de:"German", el:"Greek", he:"Hebrew", hi:"Hindi", hu:"Hungarian", id:"Indonesian", it:"Italian", ja:"Japanese", ko:"Korean", lv:"Latvian", lt:"Lithuanian", ms:"Malay", no:"Norwegian", pl:"Polish", pt:"Portuguese", "pt-BR":"Portuguese Brazilian", ro:"Romanian", ru:"Russian", sk:"Slovak", sl:"Slovenian", es:"Spanish", sv:"Swedish", th:"Thai", tr:"Turkish", uk:"Ukrainian", ur:"Urdu", vi:"Vietnamese"
  };
  return map[code] || map[String(code).toLowerCase()] || code.toUpperCase();
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>'"]/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;"
  }[ch]));
}
