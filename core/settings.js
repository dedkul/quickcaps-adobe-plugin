/*
 * QCSettings — persisted preferences + usage meter.
 * localStorage works in the browser, UXP, and CEP alike.
 */
window.QCSettings = (function () {
  const KEY = "quickcaps.settings";
  // Read once as a fallback so pre-rename settings (incl. the API key)
  // carry over where storage is shared, e.g. the browser preview.
  const LEGACY_KEY = "boli.settings";
  const MODELS = ["saaras:v4", "saaras:v3"];

  // Caption pacing presets — how much text each caption holds and how
  // long it can stay up. "custom" means the user's own numbers.
  const PACES = {
    fast: { label: "Fast", hint: "Reels and Shorts", maxLines: 1, maxChars: 20, maxDur: 2 },
    balanced: { label: "Balanced", hint: "Most videos", maxLines: 1, maxChars: 32, maxDur: 4 },
    relaxed: { label: "Relaxed", hint: "Long-form YouTube", maxLines: 2, maxChars: 42, maxDur: 6 },
  };

  const DEFAULTS = {
    apiKey: "",
    keyValid: null, // null = never checked, true/false after validation
    model: "saaras:v4",
    language: "hi-IN", // a QCLangs code, or 'unknown' for auto-detect
    script: "hi", // 'hi' the language's own script | 'rom' Roman (Hinglish…) | 'mix' + English words | 'en' English translation
    scope: "sequence", // 'sequence' | 'inout' | 'clips'
    pace: "balanced", // a PACES key, or 'custom'
    maxChars: 32,
    maxLines: 1,
    minDur: 1,
    maxDur: 4,
    maxWords: 0, // words per caption: 0 = auto (fit by length), else 1-6
    keyterms: "", // custom words, raw text as typed (see parseKeyterms)
    // Extras (all off by default). Only `bilingual` costs Sarvam credits.
    reels: false, // no full stop at the end of captions
    caps: false, // ALL CAPS for Roman/English text (only with reels)
    fillers: false, // drop umm/uh/hmm/अं
    bleep: false, // mask profanity
    bilingual: false, // also make an English track (2x Sarvam usage)
    digits: false, // number words as digits, Indian grouping
    style: "plain", // a QCStyles id (see styles.js)
    extrasOpen: false, // the Extras section is folded until opened
    usage: { month: "", seconds: 0 },
    update: { checkedAt: 0, latest: "", url: "", dismissed: "", dismissedAt: 0 }, // see updates.js
  };

  const MAX_WORDS = 6;

  // Sarvam keyterm limits: up to 50 terms, 64 characters each.
  const MAX_KEYTERMS = 50;
  const MAX_KEYTERM_LEN = 64;

  // One term per line or comma-separated; trimmed, de-duplicated, capped.
  function parseKeyterms(raw) {
    const seen = {};
    const out = [];
    String(raw || "").split(/[\n,]+/).forEach(function (t) {
      const term = t.trim().slice(0, MAX_KEYTERM_LEN);
      const k = term.toLowerCase();
      if (term && !seen[k] && out.length < MAX_KEYTERMS) {
        seen[k] = true;
        out.push(term);
      }
    });
    return out;
  }

  // Which preset (if any) the stored numbers correspond to.
  function paceFor(s) {
    for (const k in PACES) {
      const p = PACES[k];
      if (p.maxLines === s.maxLines && p.maxChars === s.maxChars && p.maxDur === s.maxDur) return k;
    }
    return "custom";
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
      const stored = raw ? JSON.parse(raw) : {};
      const s = Object.assign({}, DEFAULTS, stored);
      const month = new Date().toISOString().slice(0, 7);
      if (s.usage.month !== month) s.usage = { month: month, seconds: 0 };
      // Sarvam retired the saarika models; move older saved settings forward.
      if (MODELS.indexOf(s.model) < 0) s.model = DEFAULTS.model;
      if (window.QCLangs && !QCLangs.isKnown(s.language)) s.language = DEFAULTS.language;
      if (!(s.maxWords >= 0 && s.maxWords <= MAX_WORDS)) s.maxWords = 0;
      s.update = Object.assign({}, DEFAULTS.update, s.update);
      // Settings saved before pacing presets existed: infer from the numbers.
      if (!stored.pace && raw) s.pace = paceFor(s);
      return s;
    } catch (e) {
      // Fresh copies of the nested objects, so updating usage never
      // changes DEFAULTS itself.
      return Object.assign({}, DEFAULTS, { usage: { month: "", seconds: 0 }, update: Object.assign({}, DEFAULTS.update) });
    }
  }

  function save(s) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {
      /* storage unavailable — settings just won't persist */
    }
  }

  function applyPace(s, pace) {
    s.pace = pace;
    const p = PACES[pace];
    if (p) {
      s.maxLines = p.maxLines;
      s.maxChars = p.maxChars;
      s.maxDur = p.maxDur;
    }
    save(s);
  }

  function addUsage(s, seconds) {
    s.usage.seconds += Math.round(seconds);
    save(s);
  }

  // Sarvam speech-to-text is roughly ₹30 per hour of audio.
  const RUPEES_PER_HOUR = 30;

  function usageLabel(s) {
    const min = Math.round(s.usage.seconds / 60);
    const rupees = (s.usage.seconds / 3600) * RUPEES_PER_HOUR;
    return min + " min · ~₹" + (rupees < 1 ? rupees.toFixed(2) : Math.round(rupees));
  }

  // Pasted keys often carry quotes, a "Bearer " or header-name prefix, or a
  // line break. Strip all of it so Sarvam gets just the key.
  function cleanKey(raw) {
    return String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(api-subscription-key|authorization)\s*[:=]\s*/i, "")
      .replace(/^bearer\s+/i, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s/g, "");
  }

  // QuickCaps only talks to Sarvam. Recognise the common keys people paste
  // by mistake so the message says what's wrong instead of "rejected".
  const OTHER_KEYS = [
    [/^sk-ant-/, "an Anthropic (Claude)"],
    [/^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/, "an OpenAI"],
    [/^AIza[0-9A-Za-z_-]{30,}$/, "a Google (Gemini)"],
    [/^gsk_/, "a Groq"],
    [/^hf_/, "a Hugging Face"],
    [/^r8_/, "a Replicate"],
    [/^xai-/, "an xAI (Grok)"],
    [/^pplx-/, "a Perplexity"],
  ];
  function otherProvider(key) {
    for (let i = 0; i < OTHER_KEYS.length; i++) if (OTHER_KEYS[i][0].test(key)) return OTHER_KEYS[i][1];
    return null;
  }
  // What a key check means for the key: "ok" (works; out of credit still
  // counts, the key itself is fine), "rejected" (Sarvam refused it, so it
  // isn't saved), or "unchecked" (no answer, e.g. offline: kept, checked
  // again later). res is QCSarvam.validateKey's result.
  function keyCheckOutcome(res) {
    if (res.ok) return "ok";
    if (res.status === 402 || /credit has run out/.test(res.message || "")) return "ok";
    if (res.status === 401 || res.status === 403) return "rejected";
    return "unchecked";
  }

  // "Key ending a1b2": enough to recognise a key without showing it.
  function keyTail(key) {
    return key ? key.slice(-4) : "";
  }

  function wrongKeyMessage(key) {
    const who = otherProvider(key);
    return who
      ? "This looks like " + who + " key. QuickCaps only works with Sarvam AI keys, from dashboard.sarvam.ai."
      : null;
  }

  return {
    cleanKey: cleanKey,
    keyCheckOutcome: keyCheckOutcome,
    keyTail: keyTail,
    wrongKeyMessage: wrongKeyMessage,
    load: load,
    save: save,
    applyPace: applyPace,
    parseKeyterms: parseKeyterms,
    MAX_KEYTERMS: MAX_KEYTERMS,
    MAX_WORDS: MAX_WORDS,
    addUsage: addUsage,
    usageLabel: usageLabel,
    DEFAULTS: DEFAULTS,
    PACES: PACES,
    RUPEES_PER_HOUR: RUPEES_PER_HOUR,
  };
})();
