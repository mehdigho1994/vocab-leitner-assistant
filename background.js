const MENU_ID = "vocab-toolbar";
const STORAGE_SCHEMA_VERSION = 2;

const DEFAULT_SETTINGS = {
  dailyGoal: 10,
  browseReviewEnabled: false,
  browseReviewIntervalMinutes: 60,
  browseReviewBatchSize: 3,
  translationTarget: "fa",
  visualTheme: "promo"
};

const LANGUAGE_NAMES = {
  ar: "Arabic", bg: "Bulgarian", ca: "Catalan", "zh-CN": "Chinese Simplified", "zh-TW": "Chinese Traditional",
  hr: "Croatian", cs: "Czech", da: "Danish", nl: "Dutch", en: "English", et: "Estonian", fi: "Finnish",
  fr: "French", de: "German", el: "Greek", he: "Hebrew", hi: "Hindi", hu: "Hungarian", id: "Indonesian",
  it: "Italian", ja: "Japanese", ko: "Korean", lv: "Latvian", lt: "Lithuanian", ms: "Malay", no: "Norwegian",
  fa: "Persian", pl: "Polish", pt: "Portuguese", "pt-BR": "Portuguese Brazilian", ro: "Romanian", ru: "Russian",
  sk: "Slovak", sl: "Slovenian", es: "Spanish", sv: "Swedish", th: "Thai", tr: "Turkish", uk: "Ukrainian",
  ur: "Urdu", vi: "Vietnamese"
};

const LANGUAGE_ALIASES = {
  "fa-ir": "fa", fa_ir: "fa", persian: "fa", farsi: "fa",
  iw: "he", nb: "no", zh: "zh-CN", cn: "zh-CN", tw: "zh-TW", br: "pt-BR"
};

const MYMEMORY_CODE = {
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  "pt-BR": "pt-BR",
  fa: "fa"
};

const LIBRE_TARGET_CODE = {
  "zh-CN": "zh",
  "zh-TW": "zh",
  "pt-BR": "pt",
  no: "nb",
  fa: "fa"
};

const LIBRE_ENDPOINTS = [
  "https://translate.argosopentech.com/translate"
];

chrome.runtime.onInstalled.addListener((details) => {
  // Keep user vocabulary private from content scripts. The service worker is the only storage gateway.
  try {
    chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (_) {}

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Vocab Assistant: '%s'",
      contexts: ["selection"]
    });
  });

  chrome.storage.local.get(["settings", "schemaVersion"], async ({ settings, schemaVersion }) => {
    const merged = normalizeSettings({ ...DEFAULT_SETTINGS, ...(settings || {}) });
    await chrome.storage.local.set({ settings: merged, schemaVersion: STORAGE_SCHEMA_VERSION });
    resetReviewAlarm(merged);
  });
});

chrome.runtime.onStartup.addListener(async () => {
  resetReviewAlarm(await getSettings());
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText || !tab?.id) return;
  const text = cleanSelection(info.selectionText);
  try {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "SHOW_VOCAB_TOOLBAR", text });
  } catch (error) {
    console.warn("Vocab Assistant could not open on this page:", error?.message || error);
  }
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "VLA_PING" });
    return;
  } catch (_) {}
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = (promise) => {
    promise.then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
    return true;
  };

  switch (message?.type) {
    case "FETCH_DICTIONARY": return respond(fetchDictionary(message.text));
    case "FETCH_TRANSLATION": return respond(fetchTranslation(message.text, message.targetLang));
    case "GET_SETTINGS": return respond(getSettings());
    case "ADD_TO_LEITNER": return respond(addToLeitner(message.card));
    case "GET_DUE_CARDS": return respond(getDueCards(message.limit));
    case "REVIEW_CARD": return respond(reviewCard(message.id, message.result));
    case "GET_DASHBOARD": return respond(markActivity("open").then(() => getDashboard()));
    case "START_MANUAL_REVIEW": return respond(startManualReview(message.limit));
    case "SAVE_SETTINGS": return respond(saveSettings(message.settings));
    case "MARK_ACTIVITY": return respond(markActivity(message.reason || "activity"));
    default: return false;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "reviewReminder") return;
  const settings = await getSettings();
  if (!settings.browseReviewEnabled) return;
  const cards = await getDueCards(settings.browseReviewBatchSize || 3);
  if (!cards.length) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return;
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, { type: "SHOW_INLINE_REVIEW", count: cards.length, limit: settings.browseReviewBatchSize || 3 });
  } catch (error) {
    console.warn("Could not show review prompt:", error?.message || error);
  }
});

async function startManualReview(limit) {
  const cards = await getDueCards(limit || 50);
  if (!cards.length) return { started: false, count: 0, message: "No due words right now." };

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) throw new Error("No active webpage found. Open a normal website tab and try again.");

  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: "SHOW_INLINE_REVIEW",
    mode: "manual",
    count: cards.length,
    limit: Math.min(cards.length, Math.max(1, Math.min(50, Number(limit) || 50)))
  });
  return { started: true, count: cards.length };
}

function resetReviewAlarm(settings) {
  const minutes = Math.max(1, Math.min(240, Number(settings.browseReviewIntervalMinutes) || 60));
  chrome.alarms.clear("reviewReminder", () => {
    // No passive reminders when the user has turned browsing review off.
    if (settings.browseReviewEnabled) {
      chrome.alarms.create("reviewReminder", { delayInMinutes: minutes, periodInMinutes: minutes });
    }
  });
}

function cleanSelection(text = "") {
  return String(text).trim().replace(/\s+/g, " ").slice(0, 300);
}

function termCandidates(text) {
  const raw = cleanSelection(text).toLowerCase();
  const noOuterPunct = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const noPunct = noOuterPunct.replace(/[“”"'‘’`.,!?;:()[\]{}<>]/g, "").trim();
  const tokens = noPunct.split(/\s+/).filter(Boolean);
  const candidates = [raw, noOuterPunct, noPunct];
  if (tokens.length) candidates.push(tokens[0]);
  if (tokens.length > 1) candidates.push(tokens[tokens.length - 1]);
  return [...new Set(candidates.filter(Boolean))].slice(0, 6);
}

async function fetchDictionary(text) {
  const original = cleanSelection(text);
  if (!original) throw new Error("Empty selected text.");

  let lastError = "No dictionary result found. Try selecting one clean English word.";
  for (const candidate of termCandidates(original)) {
    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(candidate)}`;
      const res = await fetchWithTimeout(url, {}, 9000);
      if (!res.ok) {
        lastError = `dictionaryapi.dev returned ${res.status} for “${candidate}”.`;
        continue;
      }
      const json = await res.json();
      const normalized = normalizeDictionary(json, original);
      if (normalized.meanings.length || normalized.audioItems.length) return normalized;
    } catch (error) {
      lastError = readableError(error);
    }
  }

  // Backup: Datamuse gives compact definitions, not as rich as dictionaryapi.dev, but it is useful as a fallback.
  try {
    const candidate = termCandidates(original).find((x) => !x.includes(" ")) || termCandidates(original)[0];
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(candidate)}&md=dp&max=1`;
    const res = await fetchWithTimeout(url, {}, 9000);
    if (res.ok) {
      const json = await res.json();
      const item = json?.[0];
      if (item?.defs?.length) {
        return normalizeDatamuse(item, original);
      }
    }
  } catch (_) {}

  throw new Error(lastError);
}

function normalizeDictionary(entries, originalText) {
  const entry = Array.isArray(entries) ? entries[0] || {} : {};
  const phonetics = entry.phonetics || [];
  const audioItems = phonetics
    .filter((p) => p.audio)
    .map((p) => ({
      text: p.text || entry.phonetic || "",
      audio: p.audio.startsWith("//") ? `https:${p.audio}` : p.audio,
      accent: guessAccent(p.audio)
    }));

  const meanings = [];
  for (const m of entry.meanings || []) {
    for (const d of m.definitions || []) {
      meanings.push({
        partOfSpeech: m.partOfSpeech || "",
        definition: d.definition || "",
        example: d.example || "",
        synonyms: [...new Set([...(d.synonyms || []), ...(m.synonyms || [])])].slice(0, 8),
        antonyms: [...new Set([...(d.antonyms || []), ...(m.antonyms || [])])].slice(0, 8)
      });
    }
  }

  return {
    originalText,
    word: entry.word || originalText,
    phonetic: entry.phonetic || phonetics.find((p) => p.text)?.text || "",
    audioItems,
    meanings: meanings.slice(0, 12),
    source: "dictionaryapi.dev"
  };
}

function normalizeDatamuse(item, originalText) {
  const meanings = (item.defs || []).map((def) => {
    const [pos, ...rest] = String(def).split("\t");
    return {
      partOfSpeech: expandPos(pos),
      definition: rest.join(" ") || String(def),
      example: "",
      synonyms: [],
      antonyms: []
    };
  });
  return {
    originalText,
    word: item.word || originalText,
    phonetic: "",
    audioItems: [],
    meanings: meanings.slice(0, 8),
    source: "Datamuse fallback"
  };
}

function expandPos(pos = "") {
  return ({ n: "noun", v: "verb", adj: "adjective", adv: "adverb", u: "meaning" })[pos] || pos || "meaning";
}

async function fetchTranslation(text, targetLang) {
  const q = cleanSelection(text);
  if (!q) throw new Error("Empty selected text.");

  const target = normalizeLanguageCode(targetLang || (await getSettings()).translationTarget || "fa");
  if (target === "en") return {
    originalText: q,
    translatedText: q,
    sourceLang: "en",
    targetLang: target,
    targetName: LANGUAGE_NAMES[target] || "English",
    source: "No translation needed"
  };

  const targetCode = MYMEMORY_CODE[target] || target;
  const attempts = [`en|${targetCode}`, `en-US|${targetCode}`];
  let errors = [];

  for (const pair of [...new Set(attempts)]) {
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(pair)}&mt=1`;
      const res = await fetchWithTimeout(url, {}, 10000);
      if (!res.ok) { errors.push(`MyMemory ${res.status}`); continue; }
      const json = await res.json();
      if (Number(json?.responseStatus || 200) >= 400) {
        errors.push(json?.responseDetails || `MyMemory ${json.responseStatus}`);
        continue;
      }
      const translatedText = String(json?.responseData?.translatedText || "").trim();
      if (!translatedText || translatedText.toLowerCase() === q.toLowerCase()) {
        errors.push("MyMemory returned empty/same text");
        continue;
      }
      return {
        originalText: q,
        translatedText,
        sourceLang: pair.split("|")[0],
        targetLang: target,
        targetName: LANGUAGE_NAMES[target] || target.toUpperCase(),
        source: "MyMemory",
        match: json?.responseData?.match ?? null
      };
    } catch (error) {
      errors.push(readableError(error));
    }
  }

  // Legal free fallback: LibreTranslate-compatible public endpoint.
  // Some public instances may rate-limit, but this avoids Google scraping and fixes Persian when MyMemory is unreliable.
  const libreTarget = LIBRE_TARGET_CODE[target] || target;
  for (const endpoint of LIBRE_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ q, source: "en", target: libreTarget, format: "text" })
      }, 12000);
      if (!res.ok) { errors.push(`LibreTranslate ${res.status}`); continue; }
      const json = await res.json();
      const translatedText = String(json?.translatedText || json?.translation || "").trim();
      if (!translatedText || translatedText.toLowerCase() === q.toLowerCase()) {
        errors.push("LibreTranslate returned empty/same text");
        continue;
      }
      return {
        originalText: q,
        translatedText,
        sourceLang: "en",
        targetLang: target,
        targetName: LANGUAGE_NAMES[target] || target.toUpperCase(),
        source: "LibreTranslate",
        match: null
      };
    } catch (error) {
      errors.push(readableError(error));
    }
  }

  throw new Error(`Translation failed. ${errors.slice(-3).join(" | ")}`);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLanguageCode(code = "fa") {
  const raw = String(code).trim();
  const lower = raw.toLowerCase();
  const alias = LANGUAGE_ALIASES[lower];
  if (alias && LANGUAGE_NAMES[alias]) return alias;
  const direct = Object.keys(LANGUAGE_NAMES).find((key) => key.toLowerCase() === lower);
  return direct || "fa";
}

function guessAccent(url = "") {
  const u = String(url).toLowerCase();
  if (u.includes("-us") || u.includes("_us") || u.includes("/us/") || u.includes("us.mp3") || u.includes("-american")) return "American";
  if (u.includes("-uk") || u.includes("_uk") || u.includes("/uk/") || u.includes("gb.mp3") || u.includes("uk.mp3") || u.includes("-british")) return "British";
  return "Audio";
}

function readableError(error) {
  if (error?.name === "AbortError") return "The API request timed out. Try again.";
  return error?.message || String(error || "Unknown error");
}

async function getAllCards() {
  const { cards = [] } = await chrome.storage.local.get("cards");
  return Array.isArray(cards) ? cards : [];
}

async function saveCards(cards) { await chrome.storage.local.set({ cards }); }

async function getSettings() {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get("settings");
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...settings });
}

function normalizeSettings(settings) {
  return {
    dailyGoal: Math.max(1, Math.min(200, Number(settings.dailyGoal) || DEFAULT_SETTINGS.dailyGoal)),
    browseReviewEnabled: Boolean(settings.browseReviewEnabled),
    browseReviewIntervalMinutes: Math.max(1, Math.min(240, Number(settings.browseReviewIntervalMinutes) || 60)),
    browseReviewBatchSize: Math.max(1, Math.min(50, Number(settings.browseReviewBatchSize) || DEFAULT_SETTINGS.browseReviewBatchSize)),
    translationTarget: normalizeLanguageCode(settings.translationTarget || DEFAULT_SETTINGS.translationTarget),
    visualTheme: normalizeTheme(settings.visualTheme || DEFAULT_SETTINGS.visualTheme)
  };
}

function normalizeTheme(value) {
  return value === "classic" ? "classic" : "promo";
}

async function saveSettings(next = {}) {
  const settings = normalizeSettings({ ...(await getSettings()), ...next });
  await chrome.storage.local.set({ settings });
  resetReviewAlarm(settings);
  return settings;
}

async function addToLeitner(card) {
  if (!card?.term) throw new Error("No word selected.");
  const cards = await getAllCards();
  const key = card.term.toLowerCase();
  const existing = cards.find((c) => c.term.toLowerCase() === key);
  const now = Date.now();

  if (existing) {
    existing.meaning = card.meaning || existing.meaning;
    existing.example = card.example || existing.example;
    existing.contextSentence = card.contextSentence || existing.contextSentence || "";
    existing.pageUrl = card.pageUrl || existing.pageUrl || "";
    existing.pageTitle = card.pageTitle || existing.pageTitle || "";
    existing.partOfSpeech = card.partOfSpeech || existing.partOfSpeech || "";
    existing.phonetic = card.phonetic || existing.phonetic;
    existing.audioItems = card.audioItems || existing.audioItems || [];
    existing.learned = false;
    existing.updatedAt = now;
    await saveCards(cards);
    await markActivity("add-existing");
    return existing;
  }

  const newCard = {
    id: crypto.randomUUID(), term: card.term, meaning: card.meaning || "", example: card.example || "",
    contextSentence: card.contextSentence || "", pageUrl: card.pageUrl || "", pageTitle: card.pageTitle || "",
    partOfSpeech: card.partOfSpeech || "", phonetic: card.phonetic || "", audioItems: card.audioItems || [],
    box: 1, learned: false, createdAt: now, updatedAt: now, dueAt: now, correctCount: 0, wrongCount: 0
  };
  cards.push(newCard);
  await saveCards(cards);
  await markActivity("add");
  return newCard;
}

async function getDueCards(limit) {
  const now = Date.now();
  const cards = await getAllCards();
  const due = cards.filter((c) => !c.learned && (c.dueAt || 0) <= now).sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
  const max = Number(limit);
  return Number.isFinite(max) && max > 0 ? due.slice(0, max) : due;
}

async function reviewCard(id, result) {
  const cards = await getAllCards();
  const card = cards.find((c) => c.id === id);
  if (!card) throw new Error("Card not found.");
  const previousBox = card.box || 1;
  const intervalsDays = [0, 0, 1, 3, 7, 14];

  if (result === "known") {
    card.correctCount = (card.correctCount || 0) + 1;
    if (previousBox >= 5) {
      card.box = 5; card.learned = true; card.learnedAt = Date.now(); card.dueAt = null;
    } else {
      card.box = Math.min(5, previousBox + 1);
      card.dueAt = Date.now() + (intervalsDays[card.box] || 1) * 86400000;
    }
  } else {
    card.box = 1; card.learned = false; card.wrongCount = (card.wrongCount || 0) + 1; card.dueAt = Date.now() + 10 * 60000;
  }
  card.updatedAt = Date.now();
  await saveCards(cards);
  await markActivity("review");
  return card;
}

async function getStats() {
  const { activityDates = [] } = await chrome.storage.local.get("activityDates");
  const unique = [...new Set(activityDates)].sort();
  const today = dateKey();
  const yesterday = dateKey(Date.now() - 86400000);
  const hasToday = unique.includes(today);
  const hasYesterday = unique.includes(yesterday);
  let currentStreak = 0;
  const set = new Set(unique);
  let cursor = hasToday ? Date.now() : hasYesterday ? Date.now() - 86400000 : null;
  while (cursor && set.has(dateKey(cursor))) { currentStreak += 1; cursor -= 86400000; }

  let bestStreak = 0, running = 0, previous = null;
  for (const key of unique) {
    if (previous && daysBetween(previous, key) === 1) running += 1; else running = 1;
    bestStreak = Math.max(bestStreak, running); previous = key;
  }
  return { activityDates: unique, totalActiveDays: unique.length, currentStreak, bestStreak, streakMissed: unique.length > 0 && !hasToday && !hasYesterday, hasToday };
}

async function markActivity(reason = "activity") {
  const key = dateKey();
  const { activityDates = [] } = await chrome.storage.local.get("activityDates");
  const unique = [...new Set([...activityDates, key])].sort().slice(-730);
  await chrome.storage.local.set({ activityDates: unique, lastActivityReason: reason });
  return getStats();
}

function dateKey(time = Date.now()) { return new Date(time).toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000); }

async function getDashboard() {
  const cards = await getAllCards();
  const due = await getDueCards();
  const settings = await getSettings();
  const streak = await getStats();
  const boxes = [1, 2, 3, 4, 5].map((box) => ({ box, count: cards.filter((c) => !c.learned && (c.box || 1) === box).length }));
  const learned = cards.filter((c) => c.learned).length;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const addedToday = cards.filter((c) => (c.createdAt || 0) >= todayStart.getTime()).length;
  return { cards, due, boxes, learned, settings, addedToday, streak };
}
