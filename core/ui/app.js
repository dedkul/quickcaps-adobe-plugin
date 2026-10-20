/*
 * QuickCaps — panel controller. Wires the 4 screens to the host adapter
 * (Premiere via UXP/CEP, or the browser mock) and the Sarvam client.
 *
 * Written to run inside Premiere's UXP renderer as well as a browser, so:
 * controls are divs (not <button>), events use addEventListener, caption
 * editing uses <textarea> (no contenteditable), and messages render
 * in-flow (no positioned toasts).
 */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const all = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  const host = window.QCHost;
  const S = QCSettings.load();

  const state = {
    screen: "main",
    cues: [], // main track
    cuesEn: null, // English track, when "Add English track" was on
    track: "main", // track shown on the review screen: "main" | "en"
    seq: null,
    genScript: S.script, // caption script the current captions were made with
    genLang: S.language, // spoken language they were made from
    polish: {}, // extras in effect when the captions were made
    cancel: false,
    busy: false,
  };

  // Click + keyboard activation for div-based controls.
  function on(el, fn) {
    el.addEventListener("click", fn);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn(e);
      }
    });
  }

  function setBusy(el, busy, label) {
    el.classList.toggle("busy", busy);
    if (label) el.textContent = label;
  }

  // UXP doesn't reflect select.value assignments visually; set `selected` too.
  function setSelect(el, val) {
    all("#" + el.id + " option").forEach(function (o) {
      if (o.getAttribute("value") === val) o.setAttribute("selected", "selected");
      else o.removeAttribute("selected");
    });
    el.setAttribute("value", val);
    el.value = val;
  }

  /* ---------------- Navigation ---------------- */

  const SCREENS = ["main", "progress", "review", "settings"];
  const TITLES = { main: "QuickCaps", progress: "Generating", review: "Review captions", settings: "Settings" };

  function show(name) {
    state.screen = name;
    SCREENS.forEach(function (s) {
      $("screen-" + s).classList.toggle("hidden", s !== name);
    });
    $("title").textContent = TITLES[name];
    $("btn-back").classList.toggle("hidden", name === "main" || name === "progress");
    $("btn-settings").classList.toggle("hidden", name !== "main");
    if (name === "settings") {
      keyEditing = false;
      paintKey();
      recheckSavedKey();
    }
    if (name === "main") paintResume();
    $("save-menu").classList.add("hidden");
    fitGutters();
  }

  // Header, content and footer share one side margin. A scrolling body
  // loses width to its scrollbar, which would shift its centred column off
  // the header's; so the scrollbar is tucked into the right margin instead.
  function fitGutters() {
    const base = parseFloat(getComputedStyle($("topbar")).paddingLeft) || 16;
    all(".screen-scroll").forEach(function (el) {
      const bar = el.offsetWidth - el.clientWidth;
      el.style.paddingLeft = base + "px";
      el.style.paddingRight = Math.max(0, base - bar) + "px";
    });
  }
  window.addEventListener("resize", fitGutters);

  on($("btn-back"), function () {
    show(state.screen === "settings" && state.cues.length ? "review" : "main");
  });
  on($("btn-settings"), function () {
    hideNotice();
    show("settings");
  });

  /* ---------------- Notices ---------------- */

  let noticeTimer = null;
  let noticeActionFn = null;

  // kind: 'error' | 'warn' | 'success' | 'info'. Success/info auto-dismiss
  // unless `sticky`. `detail` is small print (e.g. why something fell back).
  function notice(kind, msg, action, detail, sticky) {
    clearTimeout(noticeTimer);
    const n = $("notice");
    n.className = kind;
    $("notice-text").textContent = msg;
    $("notice-detail").textContent = detail || "";
    $("notice-detail").classList.toggle("hidden", !detail);
    const a = $("notice-action");
    noticeActionFn = action ? action.fn : null;
    a.textContent = action ? action.label : "";
    a.classList.toggle("hidden", !action);
    if ((kind === "success" || kind === "info") && !sticky) {
      noticeTimer = setTimeout(hideNotice, 4500);
    }
  }
  function hideNotice() {
    clearTimeout(noticeTimer);
    $("notice").className = "hidden";
  }
  on($("notice-close"), hideNotice);
  on($("notice-action"), function () {
    const fn = noticeActionFn;
    hideNotice();
    if (fn) fn();
  });

  function goToSettingsAction() {
    return { label: "Open settings", fn: function () { show("settings"); } };
  }

  /* ---------------- Main screen ---------------- */

  function paintScope() {
    paintSeg("seg-scope", S.scope);
    paintCost();
  }

  wireSeg("seg-scope", function (val) {
    const el = document.querySelector('#seg-scope [data-val="' + val + '"]');
    if (el.classList.contains("unavailable")) {
      notice("info", val === "clips"
        ? "Select one or more clips on the timeline first, then choose Clips."
        : "Set an In and an Out mark on your sequence first, then choose In to Out.");
      return;
    }
    S.scope = val;
    QCSettings.save(S);
    paintScope();
  });

  function paintSeg(segId, val) {
    all("#" + segId + " .seg-item").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-val") === String(val));
    });
  }

  function wireSeg(segId, fn) {
    all("#" + segId + " .seg-item").forEach(function (b) {
      on(b, function () { fn(b.getAttribute("data-val")); });
    });
  }

  /* ---------------- Language + caption script ---------------- */

  // The script captions will actually come out in: English audio always
  // gives English, whatever was picked for other languages.
  function effScript() {
    return QCLangs.effectiveScript(S.language, S.script);
  }

  // Script buttons are renamed per language (हिंदी / Hinglish, தமிழ் /
  // Tanglish, মরাঠি / Roman…); English audio shows only "English".
  function paintScript() {
    const opts = QCLangs.scriptOptions(S.language);
    all("#seg-script .seg-item").forEach(function (b) {
      const key = b.getAttribute("data-val");
      const o = opts.filter(function (x) { return x.key === key; })[0];
      b.classList.toggle("hidden", !o);
      if (!o) return;
      b.querySelector(".seg-title").textContent = o.title;
      b.querySelector(".seg-sub").textContent = o.sub;
    });
    paintSeg("seg-script", effScript());
    $("script-hint").textContent = QCLangs.scriptHint(S.language, effScript());
  }

  wireSeg("seg-script", function (val) {
    S.script = val;
    QCSettings.save(S);
    paintScript();
    paintExtras();
    previewIndex = 0;
    paintPreview();
  });

  const langSelect = $("inp-language");
  setSelect(langSelect, S.language);
  langSelect.addEventListener("change", function () {
    const v = langSelect.value;
    // The menu's divider lines aren't languages.
    if (!QCLangs.isKnown(v)) {
      setSelect(langSelect, S.language);
      return;
    }
    S.language = v;
    QCSettings.save(S);
    paintScript();
    paintExtras();
    previewIndex = 0;
    paintPreview();
  });

  /* ---------------- Extras ---------------- */

  // An English track on English captions would be the same thing twice.
  function bilingualOn() {
    return !!S.bilingual && effScript() !== "en";
  }

  // What "Numbers as digits" will do for the chosen language.
  function digitsHint() {
    const l = QCLangs.get(S.language);
    if (l && l.english) return "“four thousand five hundred” becomes 4,500";
    if (QCNumbers.coversLanguage(S.language)) return "“चार हज़ार पांच सौ” becomes 4,500, and 1,50,000 for lakhs";
    return "For " + (l ? l.name : "this language") + ", only English number words, for now";
  }

  function paintExtras() {
    all("#extras .extra").forEach(function (row) {
      const k = row.getAttribute("data-k");
      row.classList.toggle("on", k === "bilingual" ? bilingualOn() : !!S[k]);
    });
    const bi = document.querySelector('#extras [data-k="bilingual"]');
    bi.classList.toggle("disabled", effScript() === "en");
    bi.querySelector(".extra-sub").textContent = effScript() === "en"
      ? "Your captions are already in English"
      : "A second caption track with English subtitles";
    $("digits-sub").textContent = digitsHint();
    $("opt-caps").classList.toggle("active", !!S.caps);
    paintExtrasSummary();
    paintCost();
  }

  // The folded Extras row says what's on, so it can stay closed.
  function paintExtrasSummary() {
    const names = all("#extras .extra.on").map(function (row) {
      return row.querySelector(".extra-name").textContent;
    });
    $("extras-count").textContent = names.length + " on";
    $("extras-count").classList.toggle("hidden", !names.length);
    $("extras-summary").textContent = names.length
      ? names.join(", ")
      : "Clean-up, digits, Reels style, English track";
  }

  function paintExtrasOpen() {
    $("extras").classList.toggle("hidden", !S.extrasOpen);
    $("extras-head").classList.toggle("open", !!S.extrasOpen);
    $("extras-chev-path").setAttribute("d", S.extrasOpen ? "M2 6.5 L5 3.5 L8 6.5" : "M2 3.5 L5 6.5 L8 3.5");
    fitGutters();
  }
  on($("extras-head"), function () {
    S.extrasOpen = !S.extrasOpen;
    QCSettings.save(S);
    paintExtrasOpen();
  });

  all("#extras .extra").forEach(function (row) {
    on(row, function (e) {
      // The ALL CAPS checkbox sits inside the Reels row; handle it alone.
      if (e && e.target && e.target.closest && e.target.closest("#opt-caps")) return;
      if (row.classList.contains("disabled")) return;
      const k = row.getAttribute("data-k");
      S[k] = !S[k];
      QCSettings.save(S);
      paintExtras();
    });
  });
  on($("opt-caps"), function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    S.caps = !S.caps;
    QCSettings.save(S);
    paintExtras();
  });

  /* ---------------- Cost estimate ---------------- */

  // Seconds of audio the current caption source would send to Sarvam.
  function scopeSeconds() {
    const q = state.seq;
    if (!q) return null;
    if (S.scope === "inout" && q.inOutSeconds > 0) return q.inOutSeconds;
    if (S.scope === "clips" && q.selectionSeconds > 0) return q.selectionSeconds;
    return q.durationSeconds || null;
  }

  function paintCost() {
    const secs = scopeSeconds();
    const passes = bilingualOn() ? 2 : 1;
    $("cost-x2").classList.toggle("hidden", passes === 1);
    if (!secs) {
      $("cost-val").textContent = "—";
      return;
    }
    const rupees = (secs / 3600) * QCSettings.RUPEES_PER_HOUR * passes;
    $("cost-val").textContent = "~₹" + (rupees < 10 ? rupees.toFixed(2) : Math.round(rupees));
  }

  /* ---------------- Pacing + preview ---------------- */

  // A sample sentence in the chosen language and script, "spoken" at
  // roughly natural speed, run through the same caption builder the real
  // transcript uses.
  let previewIndex = 0;

  function cueOptions() {
    return { maxChars: S.maxChars, maxLines: S.maxLines, minDur: S.minDur, maxDur: S.maxDur, maxWords: S.maxWords };
  }

  function previewCues() {
    const words = [];
    let t = 0;
    QCLangs.sample(S.language, S.script).split(" ").forEach(function (w) {
      const d = 0.18 + w.length * 0.035;
      words.push({ text: w, start: t, end: t + d });
      t += d + 0.08;
    });
    return QCSrt.buildCues(words, cueOptions());
  }

  function paintPreview() {
    const cues = previewCues();
    if (!cues.length) return;
    if (previewIndex >= cues.length) previewIndex = 0;
    const c = cues[previewIndex];
    $("preview-caption").textContent = QCSrt.wrapText(c.text, S.maxChars, S.maxLines);
    QCStyles.applyPreview($("preview-caption"), S.style);
    $("preview-info").textContent =
      "Caption " + (previewIndex + 1) + " of " + cues.length + " · " + (c.end - c.start).toFixed(1) + " s";
  }
  on($("preview-next"), function () {
    previewIndex += 1;
    paintPreview();
  });

  // Words per caption: Auto (fit by length), or a hard limit of 1-6.
  function paintWords() {
    const n = S.maxWords;
    $("words-val").textContent = n ? n + (n === 1 ? " word" : " words") : "Auto";
    $("words-sub").textContent = n ? "At most " + n + ", even if more would fit" : "Auto fits by length";
    $("words-minus").classList.toggle("disabled", !n);
    $("words-plus").classList.toggle("disabled", n >= QCSettings.MAX_WORDS);
  }
  function setWords(n) {
    S.maxWords = Math.max(0, Math.min(QCSettings.MAX_WORDS, n));
    QCSettings.save(S);
    previewIndex = 0;
    paintWords();
    paintPreview();
  }
  on($("words-minus"), function () { if (S.maxWords) setWords(S.maxWords - 1); });
  on($("words-plus"), function () { setWords(S.maxWords + 1); });

  function paintPace() {
    paintSeg("seg-pace", S.pace);
    $("custom-panel").classList.toggle("hidden", S.pace !== "custom");
    paintSeg("seg-lines", S.maxLines);
    $("opt-maxchars").value = String(S.maxChars);
    $("opt-maxdur").value = String(S.maxDur);
    paintPreview();
  }

  wireSeg("seg-pace", function (val) {
    if (val === "custom") {
      S.pace = "custom";
      QCSettings.save(S);
    } else {
      QCSettings.applyPace(S, val);
    }
    previewIndex = 0;
    paintPace();
  });

  wireSeg("seg-lines", function (val) {
    S.maxLines = parseInt(val, 10);
    QCSettings.save(S);
    paintSeg("seg-lines", S.maxLines);
    paintPreview();
  });

  [["opt-maxchars", "maxChars", 12, 64], ["opt-maxdur", "maxDur", 1, 10]].forEach(function (p) {
    const el = $(p[0]);
    el.addEventListener("change", function () {
      let v = parseInt(el.value, 10);
      if (isNaN(v)) v = QCSettings.DEFAULTS[p[1]];
      v = Math.min(p[3], Math.max(p[2], v));
      el.value = String(v);
      S[p[1]] = v;
      QCSettings.save(S);
      previewIndex = 0;
      paintPreview();
    });
  });

  async function refreshSequence() {
    try {
      state.seq = await host.getSequenceInfo();
      const n = state.seq.selectedAudioClips || 0;
      $("clips-note").textContent = n ? n + " selected" : "Select first";
      document.querySelector('#seg-scope [data-val="clips"]').classList.toggle("unavailable", !state.seq.supportsClipScope || !n);
      const io = state.seq.inOutSeconds || 0;
      $("inout-note").textContent = io > 0 ? QCSrt.fmtDuration(io) : "No marks";
      document.querySelector('#seg-scope [data-val="inout"]').classList.toggle("unavailable", !(io > 0));
      $("seq-dot").className = "status-dot ok";
      $("seq-text").textContent =
        state.seq.name + " · " + QCSrt.fmtDuration(state.seq.durationSeconds) +
        (host.mock ? " · preview data" : "");
    } catch (e) {
      state.seq = null;
      $("seq-dot").className = "status-dot bad";
      $("seq-text").textContent = "Open a sequence in Premiere to begin";
    }
    paintCost();
  }

  /* ---------------- Draft: never lose edits ---------------- */

  // The review is saved (debounced) after every change, so closing the
  // panel or Premiere mid-review loses nothing. Word timings are kept so
  // Split still times new captions accurately after a restore.
  const DRAFT_KEY = "quickcaps.draft";
  let draftTimer = null;

  function slimCues(cues) {
    return cues.map(function (c) {
      return {
        id: c.id, start: c.start, end: c.end, text: c.text, rom: c.rom,
        words: c.words ? c.words.map(function (w) { return { text: w.text, start: w.start, end: w.end }; }) : null,
      };
    });
  }

  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      if (!state.cues.length) return;
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          v: 1,
          savedAt: Date.now(),
          seqName: (state.seq && state.seq.name) || "",
          genScript: state.genScript,
          genLang: state.genLang,
          polish: state.polish,
          cues: slimCues(state.cues),
          cuesEn: state.cuesEn ? slimCues(state.cuesEn) : null,
        }));
      } catch (e) {
        /* storage full or unavailable: the draft just isn't kept */
      }
    }, 400);
  }

  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      return d && d.v === 1 && d.cues && d.cues.length ? d : null;
    } catch (e) {
      return null;
    }
  }

  function clearDraft() {
    clearTimeout(draftTimer);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* nothing to clear */
    }
  }

  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
    const h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.round(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }

  function paintResume() {
    const d = loadDraft();
    $("resume-card").classList.toggle("hidden", !d);
    if (!d) return;
    const n = d.cues.length;
    $("resume-sub").textContent =
      n + (n === 1 ? " caption" : " captions") + (d.cuesEn ? " + English track" : "") +
      (d.seqName ? " · " + d.seqName : "") + " · " + ago(d.savedAt);
  }

  on($("btn-resume"), function () {
    const d = loadDraft();
    if (!d) return paintResume();
    // Drafts from before Hinglish was transcribed directly may hold the
    // Roman text in `rom`; show that version.
    if (d.viewScript === "rom") d.cues.forEach(function (c) { if (c.rom) c.text = c.rom; });
    state.cues = d.cues;
    state.cuesEn = d.cuesEn;
    state.genScript = d.genScript;
    state.genLang = d.genLang || "hi-IN"; // drafts from before v2 were Hindi
    state.polish = d.polish || {};
    state.track = "main";
    hideNotice();
    renderReview();
    show("review");
  });

  on($("btn-discard"), function () {
    clearDraft();
    paintResume();
  });

  /* ---------------- Progress screen ---------------- */

  let stepTimer = null;

  function resetSteps(withTranslate) {
    all("#steps .step").forEach(function (li) {
      li.className = "step";
      li.querySelector(".step-meta").textContent = "";
    });
    document.querySelector('#steps [data-step="translate"]').classList.toggle("hidden", !withTranslate);
    pbar(0);
    note("");
  }
  // UXP has no CSS animation, so the active step shows a live seconds counter.
  function stepActive(name) {
    clearInterval(stepTimer);
    const li = document.querySelector('#steps [data-step="' + name + '"]');
    li.className = "step active";
    const meta = li.querySelector(".step-meta");
    const t0 = Date.now();
    meta.textContent = "0 s";
    stepTimer = setInterval(function () {
      meta.textContent = Math.round((Date.now() - t0) / 1000) + " s";
    }, 1000);
    return t0;
  }
  function stepDone(name, t0) {
    clearInterval(stepTimer);
    const li = document.querySelector('#steps [data-step="' + name + '"]');
    li.className = "step done";
    li.querySelector(".step-meta").textContent = t0 ? Math.max(1, Math.round((Date.now() - t0) / 1000)) + " s" : "";
  }
  function pbar(frac) {
    $("pbar-fill").style.width = Math.round(frac * 100) + "%";
  }
  function note(msg) { $("progress-note").textContent = msg; }

  on($("btn-cancel"), function () {
    state.cancel = true;
    note("Cancelling…");
  });

  /* ---------------- Generate pipeline ---------------- */

  // One Sarvam pass over the exported audio: words in sequence time.
  async function runPass(audio, mode, from, to, label) {
    const progress = function (d, t) {
      pbar(from + (to - from) * (d / t));
      note(label + " part " + d + " of " + t + (t > 1 ? " · 3 at a time, same cost" : ""));
    };
    let words;
    if (audio.mockWords) {
      words = await host.mockTranscribe(progress, mode);
    } else {
      words = (await QCSarvam.transcribe(audio.wavBuffer, {
        apiKey: S.apiKey,
        language: S.language,
        model: S.model,
        mode: mode,
        keyterms: QCSettings.parseKeyterms(S.keyterms),
        isCancelled: function () { return state.cancel; },
        onProgress: progress,
      })).words;
    }
    if (state.cancel) throw { cancelled: true };
    // Transcript times are relative to the exported audio; shift them to
    // sequence time so captions land where the speech is on the timeline
    // (e.g. at the In point, or at the first selected clip).
    const offset = audio.startSeconds || 0;
    words.forEach(function (w) {
      w.start += offset;
      w.end += offset;
    });
    return words;
  }

  // lang: the language the words are in (the English track is English
  // whatever was spoken), so "Numbers as digits" reads the right words.
  function buildTrack(words, polish, script, lang) {
    const cleaned = QCPolish.cleanWords(words, Object.assign({ lang: lang }, polish));
    const cues = QCSrt.buildCues(cleaned, cueOptions());
    return QCPolish.finishCues(cues, polish, script);
  }

  async function generate() {
    if (state.busy) return;
    hideNotice();
    if (!host.mock && !S.apiKey) {
      notice("warn", "Add your Sarvam API key first. You'll find it at dashboard.sarvam.ai.", goToSettingsAction());
      return;
    }
    const wrongKey = !host.mock && QCSettings.wrongKeyMessage(S.apiKey);
    if (wrongKey) {
      notice("warn", wrongKey, goToSettingsAction());
      return;
    }
    if (!state.seq) {
      await refreshSequence();
      if (!state.seq) {
        notice("warn", "Open a sequence in Premiere first, then try again.");
        return;
      }
    }

    const bilingual = bilingualOn();
    const polish = { reels: !!S.reels, caps: !!(S.reels && S.caps), fillers: !!S.fillers, bleep: !!S.bleep, digits: !!S.digits };
    const script = effScript();
    state.busy = true;
    state.cancel = false;
    show("progress");
    resetSteps(bilingual);

    try {
      let t0 = stepActive("export");
      const audio = await host.exportAudio(S.scope, note);
      if (state.cancel) throw { cancelled: true };
      stepDone("export", t0);
      pbar(0.1);
      note("");

      t0 = stepActive("transcribe");
      const words = await runPass(audio, QCLangs.modeFor(S.language, script), 0.1, bilingual ? 0.5 : 0.85, "Transcribing");
      stepDone("transcribe", t0);

      let wordsEn = null;
      if (bilingual) {
        t0 = stepActive("translate");
        wordsEn = await runPass(audio, "translate", 0.5, 0.88, "Translating");
        stepDone("translate", t0);
      }

      t0 = stepActive("build");
      state.polish = polish;
      state.genScript = script;
      state.genLang = S.language;
      const cues = buildTrack(words, polish, script, script === "en" ? "en-IN" : S.language);
      if (!cues.length) throw new Error("No speech was found in this audio. Check that the audio tracks aren't muted and the right range is chosen, then try again.");
      const cuesEn = wordsEn ? buildTrack(wordsEn, polish, "en", "en-IN") : null;
      stepDone("build", t0);
      pbar(1);
      note("");

      const seconds = audio.seconds || (audio.wavBuffer ? QCSarvam.chunkWav(audio.wavBuffer).duration : 0);
      QCSettings.addUsage(S, seconds * (bilingual ? 2 : 1));
      state.cues = cues;
      state.cuesEn = cuesEn;
      state.track = "main";
      renderReview();
      show("review");
    } catch (e) {
      clearInterval(stepTimer);
      show("main");
      if (e && e.cancelled) {
        notice("info", "Cancelled. Nothing was added to your project.");
      } else {
        const msg = (e && e.message) || "Something went wrong. Try again.";
        const keyProblem = e && (e.status === 401 || e.status === 403);
        notice("error", msg, keyProblem ? goToSettingsAction() : null);
      }
    } finally {
      state.busy = false;
    }
  }

  on($("btn-generate"), generate);

  /* ---------------- Review screen ---------------- */

  function activeCues() {
    return state.track === "en" && state.cuesEn ? state.cuesEn : state.cues;
  }
  // Textareas can't auto-grow in UXP; size them from the text length.
  function fitTextarea(el) {
    const perLine = Math.max(20, Math.floor(((el.clientWidth || 300) - 14) / 6.3));
    const lines = Math.max(1, Math.ceil(el.value.length / perLine));
    // ~20px per line leaves room for Devanagari's taller glyphs.
    el.style.height = (lines * 20 + 12) + "px";
  }

  function countLabel(n) {
    return n + (n === 1 ? " caption" : " captions");
  }

  // "हिंदी", "Tanglish", "English"… for the captions on review.
  function trackName() {
    return QCLangs.scriptName(state.genLang || "hi-IN", state.genScript);
  }

  function renderReview() {
    const cues = activeCues();
    const hasEn = !!state.cuesEn;
    $("seg-track").classList.toggle("hidden", !hasEn);
    if (hasEn) {
      $("track-main-title").textContent = trackName() + " track";
      $("track-main-sub").textContent = countLabel(state.cues.length);
      $("track-en-sub").textContent = countLabel(state.cuesEn.length);
      paintSeg("seg-track", state.track);
    }
    $("review-count").textContent = countLabel(cues.length);
    $("save-srt-hint").textContent = trackName();
    $("save-srt-en").classList.toggle("hidden", !hasEn);

    const list = $("cue-list");
    list.innerHTML = "";
    cues.forEach(function (c, i) {
      const row = document.createElement("div");
      row.className = "cue-row";
      row.setAttribute("data-id", String(c.id));

      const top = document.createElement("div");
      top.className = "cue-top";

      const time = document.createElement("div");
      time.className = "cue-time";
      time.textContent = QCSrt.fmtClock(c.start) + " – " + QCSrt.fmtClock(c.end);

      const spacer = document.createElement("div");
      spacer.className = "cue-spacer";

      const tools = document.createElement("div");
      tools.className = "cue-tools";
      const mk = function (label, title, fn, danger) {
        const b = document.createElement("div");
        b.className = "cue-tool" + (danger ? " danger" : "");
        b.setAttribute("tabindex", "0");
        b.setAttribute("title", title);
        b.textContent = label;
        on(b, fn);
        return b;
      };
      tools.appendChild(mk("Split", "Split into two captions", function () {
        QCCues.split(cues, c.id);
        renderReview();
      }));
      if (i < cues.length - 1) {
        tools.appendChild(mk("Merge", "Merge with the next caption", function () {
          QCCues.mergeWithNext(cues, c.id);
          renderReview();
        }));
      }
      tools.appendChild(mk("Delete", "Delete this caption", function () {
        QCCues.remove(cues, c.id);
        renderReview();
      }, true));

      top.appendChild(time);
      top.appendChild(spacer);
      top.appendChild(tools);

      const text = document.createElement("textarea");
      text.className = "cue-text";
      text.value = c.text;
      // Save on every keystroke — blur isn't reliable enough to be the only
      // save point (re-renders and UXP focus quirks can skip it).
      text.addEventListener("input", function () {
        fitTextarea(text);
        const v = text.value.trim();
        if (v && v !== c.text) QCCues.updateText(cues, c.id, "hi", v);
        paintMatches();
        saveDraft();
      });
      text.addEventListener("blur", function () {
        if (!text.value.trim()) {
          text.value = c.text;
          fitTextarea(text);
        }
      });

      row.appendChild(top);
      row.appendChild(text);
      list.appendChild(row);
      fitTextarea(text);
    });
    paintMatches();
    saveDraft();
  }

  wireSeg("seg-track", function (val) {
    if (val === state.track) return;
    state.track = val;
    renderReview();
  });

  /* ---------------- Find & replace ---------------- */

  let wholeWord = true;

  // Highlights rows containing the search text (in the track and script
  // being viewed) by toggling classes, without re-rendering the list.
  function paintMatches() {
    const q = $("inp-find").value;
    const m = QCCues.findMatches(activeCues(), q, "hi", wholeWord);
    const hit = {};
    m.ids.forEach(function (id) { hit[id] = true; });
    all("#cue-list .cue-row").forEach(function (row) {
      row.classList.toggle("match", !!hit[row.getAttribute("data-id")]);
    });
    $("find-count").textContent = !q.trim() ? "" : m.total ? m.total + (m.total === 1 ? " match" : " matches") : "No matches";
  }

  $("inp-find").addEventListener("input", paintMatches);
  on($("find-whole"), function () {
    wholeWord = !wholeWord;
    $("find-whole").classList.toggle("active", wholeWord);
    paintMatches();
  });

  on($("btn-replace-all"), function () {
    const q = $("inp-find").value;
    if (!q.trim()) {
      notice("info", "Type the text to find first.");
      return;
    }
    const cues = activeCues();
    const snap = QCCues.snapshot(cues);
    const n = QCCues.replaceAll(cues, q, $("inp-replace").value.trim(), "hi", wholeWord);
    if (!n) {
      notice("info", 'No captions contain "' + q.trim() + '".');
      return;
    }
    renderReview();
    notice("success", "Replaced " + n + (n === 1 ? " match." : " matches."), {
      label: "Undo",
      fn: function () {
        QCCues.restore(cues, snap);
        renderReview();
      },
    }, null, true);
  });

  function srtFor(cues, script) {
    return QCSrt.toSrt(cues, script, { maxChars: S.maxChars, maxLines: S.maxLines });
  }

  // Every track the user has, in timeline order (main first).
  function tracksToPlace() {
    const tracks = [{ label: trackName(), srt: srtFor(state.cues, "hi") }];
    if (state.cuesEn) tracks.push({ label: "English", srt: srtFor(state.cuesEn, "hi") });
    return tracks;
  }

  const PLACE_LABEL = host.placesOnTimeline ? "Add to timeline" : "Add to project";
  $("btn-place").textContent = PLACE_LABEL;

  on($("btn-place"), async function () {
    if (state.busy || !state.cues.length) return;
    state.busy = true;
    setBusy($("btn-place"), true, "Adding…");
    try {
      const seqName = (state.seq && state.seq.name) || "your sequence";
      const tracks = tracksToPlace();
      const results = await host.placeCaptions(tracks, seqName);
      show("main");
      const styleTip = "Select a caption and use Properties → Track Style to set the font and look.";
      const placed = results.filter(function (r) { return r.placed; }).length;
      const two = tracks.length > 1;
      if (placed === tracks.length) {
        notice("success",
          (two ? "Added " + tracks.length + " caption tracks to \"" : "Captions added to \"") + seqName + '"' +
            (two ? "." : " on a new caption track."),
          null, styleTip, true);
      } else {
        // UXP can't create caption tracks (and CEP can occasionally refuse),
        // so the last step is a drag. Captions are already sequence-timed,
        // which is why they go at 00:00 rather than at the In point.
        const names = results.filter(function (r) { return !r.placed; })
          .map(function (r) { return '"' + r.itemName + '"'; }).join(" and ");
        const reason = results.map(function (r) { return r.reason; }).filter(Boolean)[0];
        notice("success",
          (two ? "Captions added to your Project panel as " + names + ". Drag each one" : "Captions added to your Project panel as " + names + ". Drag it") +
            " to the very start of the timeline (00:00) and they'll line up with the speech.",
          null,
          (reason ? "Couldn't place them automatically: " + reason + ". " : "") + styleTip,
          true);
      }
    } catch (e) {
      notice("error", (e && e.message) || "Couldn't add the captions. Try Save instead.");
    } finally {
      state.busy = false;
      setBusy($("btn-place"), false, PLACE_LABEL);
    }
  });

  /* ---------------- Save menu ---------------- */

  on($("btn-save"), function () {
    $("save-menu").classList.toggle("hidden");
  });

  function baseName() {
    return ((state.seq && state.seq.name) || "captions").replace(/[^\wऀ-ॿ-]+/g, "_");
  }

  async function saveFile(text, name) {
    $("save-menu").classList.add("hidden");
    try {
      const result = await host.saveSrt(text, name);
      if (result && result.cancelled) return;
      notice("success", result && result.path ? "Saved to " + result.path : "Saved " + name,
        null, null, !!(result && result.path));
    } catch (e) {
      notice("error", (e && e.message) || "Couldn't save the file.");
    }
  }

  on($("save-srt"), function () {
    if (state.cues.length) saveFile(srtFor(state.cues, "hi"), baseName() + ".srt");
  });
  on($("save-srt-en"), function () {
    if (state.cuesEn) saveFile(srtFor(state.cuesEn, "hi"), baseName() + " (English).srt");
  });
  on($("save-txt"), function () {
    const cues = activeCues();
    if (cues.length) saveFile(QCPolish.transcript(cues, "hi"), baseName() + (state.track === "en" ? " (English)" : "") + " transcript.txt");
  });

  /* ---------------- Settings screen ---------------- */

  // The key works like a connection: paste it (or press Enter, or Save)
  // and it's checked and saved at once. Once saved it's never shown
  // again, only its last four characters, with Change and Remove.
  const keyInput = $("inp-key");
  let keyEditing = false; // replacing a saved key
  let keyBusy = false;

  function paintKey(msg, bad) {
    const saved = !!S.apiKey && S.keyValid !== false;
    const showEntry = !saved || keyEditing;
    $("key-entry").classList.toggle("hidden", !showEntry);
    $("key-ok").classList.toggle("hidden", showEntry);
    $("btn-key-cancel").classList.toggle("hidden", !(keyEditing && saved));
    keyInput.disabled = keyBusy;
    keyInput.classList.toggle("bad", !!bad);
    setBusy($("btn-key-save"), keyBusy, keyBusy ? "Checking…" : "Save key");
    $("key-msg").className = "footnote" + (bad ? " bad" : "");
    $("key-msg").textContent = msg || (S.keyValid === false && S.apiKey
      ? "Sarvam didn't accept the saved key. Paste a new one from dashboard.sarvam.ai."
      : "Paste it and QuickCaps checks and saves it straight away.");
    $("key-title").textContent = S.keyValid ? "Connected" : "Key saved";
    $("key-tail").textContent = "Key ending " + QCSettings.keyTail(S.apiKey) +
      (S.keyValid ? " · saved on this computer" : " · not checked yet");
    paintUsage();
  }

  async function submitKey() {
    if (keyBusy) return;
    const v = QCSettings.cleanKey(keyInput.value);
    keyInput.value = v;
    if (!v) {
      paintKey("Paste your key first.", true);
      return;
    }
    const wrong = QCSettings.wrongKeyMessage(v);
    if (wrong) {
      paintKey(wrong, true);
      return;
    }
    keyBusy = true;
    paintKey("Checking with Sarvam…");
    const res = host.mock ? { ok: true } : await QCSarvam.validateKey(v);
    keyBusy = false;
    const outcome = QCSettings.keyCheckOutcome(res);
    if (outcome === "rejected") {
      paintKey("Sarvam didn't accept this key. Copy it again from dashboard.sarvam.ai and paste it here.", true);
      return;
    }
    S.apiKey = v;
    S.keyValid = outcome === "ok" ? true : null;
    QCSettings.save(S);
    keyEditing = false;
    keyInput.value = "";
    paintKey();
    if (outcome === "unchecked") notice("warn", "Key saved, but Sarvam didn't answer, so it isn't checked yet. " + (res.message || ""));
    else if (!res.ok && res.message) notice("warn", res.message);
  }

  // A key saved by an older version, or while offline: check it quietly
  // the first time Settings opens.
  async function recheckSavedKey() {
    if (host.mock || !S.apiKey || S.keyValid !== null || keyBusy) return;
    const res = await QCSarvam.validateKey(S.apiKey);
    const outcome = QCSettings.keyCheckOutcome(res);
    if (outcome === "unchecked") return;
    S.keyValid = outcome === "ok";
    QCSettings.save(S);
    paintKey();
  }

  keyInput.addEventListener("paste", function () { setTimeout(submitKey, 0); });
  keyInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitKey();
    }
  });
  on($("btn-key-save"), submitKey);
  on($("btn-key-change"), function () {
    keyEditing = true;
    keyInput.value = "";
    paintKey();
    keyInput.focus();
  });
  on($("btn-key-cancel"), function () {
    keyEditing = false;
    keyInput.value = "";
    paintKey();
  });
  on($("btn-key-remove"), function () {
    S.apiKey = "";
    S.keyValid = null;
    QCSettings.save(S);
    keyEditing = false;
    paintKey();
    notice("info", "Key removed from this computer. It still works in your Sarvam account until you delete it there.");
  });

  setSelect($("inp-model"), S.model);
  $("inp-model").addEventListener("change", function () { S.model = $("inp-model").value; QCSettings.save(S); });
  // Custom words (Sarvam keyterms): one per line or comma-separated.
  function paintKeyterms() {
    const n = QCSettings.parseKeyterms(S.keyterms).length;
    $("keyterms-count").textContent = n + " of " + QCSettings.MAX_KEYTERMS;
    $("keyterms-note").textContent = S.model === "saaras:v4"
      ? "Spells names, brands, and slang the way you write them."
      : "Only used with Saaras v4. Switch the model above to use these.";
  }
  const keytermsInput = $("inp-keyterms");
  keytermsInput.value = S.keyterms || "";
  keytermsInput.addEventListener("input", function () {
    S.keyterms = keytermsInput.value;
    QCSettings.save(S);
    paintKeyterms();
  });
  $("inp-model").addEventListener("change", paintKeyterms);
  paintKeyterms();

  function paintUsage() { $("usage-val").textContent = QCSettings.usageLabel(S); }

  // Handy when friends report a problem: "which version are you on?"
  $("version-line").textContent = "QuickCaps " + (host.pluginVersion || "preview") + " · free and open source";

  /* ---------------- Links + updates ---------------- */

  const X_PROFILE = "https://x.com/feat_ashish";

  // Each host opens the default browser its own way (CEP: cep.util,
  // UXP: shell.openExternal); the browser preview opens a new tab.
  async function openLink(url) {
    try {
      if (host.openUrl) await host.openUrl(url);
      else window.open(url, "_blank");
    } catch (e) {
      notice("info", "Couldn't open your browser. Go to " + url.replace(/^https:\/\//, "") + " instead.", null, null, true);
    }
  }
  on($("btn-x"), function () { openLink(X_PROFILE); });
  on($("link-dashboard"), function () { openLink("https://dashboard.sarvam.ai"); });
  on($("link-billing"), function () { openLink("https://dashboard.sarvam.ai"); });

  function paintUpdate() {
    const r = QCUpdates.pending(host.pluginVersion, S.update);
    $("update-card").classList.toggle("hidden", !r);
    if (r) $("update-title").textContent = "QuickCaps " + r.version + " is out";
  }
  on($("btn-update"), function () {
    const r = QCUpdates.pending(host.pluginVersion, S.update);
    openLink(r ? r.url : QCUpdates.RELEASES_PAGE);
  });
  on($("btn-update-later"), function () {
    QCUpdates.dismiss(S.update);
    QCSettings.save(S);
    paintUpdate();
  });

  // At most once a day (the result is remembered in settings), and only
  // where the plugin knows its own version.
  async function checkForUpdate() {
    if (!host.pluginVersion) return;
    const fetchFn = host.fetch || function (u, i) { return fetch(u, i); };
    await QCUpdates.check(host.pluginVersion, S.update, fetchFn);
    QCSettings.save(S);
    paintUpdate();
  }

  /* ---------------- Init ---------------- */

  paintScope();
  paintScript();
  paintExtras();
  paintWords();
  paintPace();
  paintKey();
  paintExtrasOpen();
  paintUsage();
  show("main");
  paintUpdate();
  refreshSequence();
  setTimeout(checkForUpdate, 1500);
  setInterval(function () {
    if (state.screen === "main" && !state.busy) refreshSequence();
    fitGutters();
  }, 4000);
})();
