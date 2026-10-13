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
    if (name === "settings") paintUsage();
    if (name === "main") paintResume();
    $("save-menu").classList.add("hidden");
  }

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
    all("#scope-list .choice").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-scope") === S.scope);
    });
    paintCost();
  }

  all("#scope-list .choice").forEach(function (el) {
    on(el, function () {
      if (el.classList.contains("unavailable")) {
        notice("info", "Select one or more clips on the timeline first, then choose this option.");
        return;
      }
      S.scope = el.getAttribute("data-scope");
      QCSettings.save(S);
      paintScope();
    });
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

  // Caption script -> Sarvam speech-to-text mode. All four are the same
  // per-second price; Hinglish uses "translit" (Roman output straight from
  // speech) rather than the separately billed transliteration service.
  const MODES = { hi: "transcribe", rom: "translit", mix: "codemix", en: "translate" };
  const SCRIPT_NAMES = { hi: "हिंदी", rom: "Hinglish", mix: "Mixed", en: "English" };

  wireSeg("seg-script", function (val) {
    S.script = val;
    QCSettings.save(S);
    paintSeg("seg-script", val);
    paintExtras();
    paintPreview();
  });

  /* ---------------- Extras ---------------- */

  // An English track on English captions would be the same thing twice.
  function bilingualOn() {
    return !!S.bilingual && S.script !== "en";
  }

  function paintExtras() {
    all("#extras .extra").forEach(function (row) {
      const k = row.getAttribute("data-k");
      row.classList.toggle("on", k === "bilingual" ? bilingualOn() : !!S[k]);
    });
    const bi = document.querySelector('#extras [data-k="bilingual"]');
    bi.classList.toggle("disabled", S.script === "en");
    bi.querySelector(".extra-sub").textContent = S.script === "en"
      ? "Your captions are already in English"
      : "A second caption track with English subtitles";
    $("opt-caps").classList.toggle("active", !!S.caps);
    paintCost();
  }

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

  // A sample sentence, "spoken" at roughly natural Hindi speed, run through
  // the same caption builder the real transcript uses.
  const SAMPLE = {
    hi: "नमस्ते दोस्तों, आज हम बात करेंगे एक ऐसे टूल के बारे में जो आपका घंटों का काम मिनटों में कर देगा। चलिए शुरू करते हैं।",
    rom: "namaste doston, aaj hum baat karenge ek aise tool ke baare mein jo aapka ghanton ka kaam minton mein kar dega. chaliye shuru karte hain.",
    mix: "नमस्ते दोस्तों, आज हम बात करेंगे एक ऐसे tool के बारे में जो आपका घंटों का काम minutes में कर देगा। चलिए start करते हैं।",
    en: "Hello friends, today we'll talk about a tool that turns hours of work into minutes. Let's get started.",
  };
  let previewIndex = 0;

  function previewCues() {
    const words = [];
    let t = 0;
    (SAMPLE[S.script] || SAMPLE.hi).split(" ").forEach(function (w) {
      const d = 0.18 + w.length * 0.035;
      words.push({ text: w, start: t, end: t + d });
      t += d + 0.08;
    });
    return QCSrt.buildCues(words, { maxChars: S.maxChars, maxLines: S.maxLines, minDur: S.minDur, maxDur: S.maxDur });
  }

  function paintPreview() {
    const cues = previewCues();
    if (!cues.length) return;
    if (previewIndex >= cues.length) previewIndex = 0;
    const c = cues[previewIndex];
    $("preview-caption").textContent = QCSrt.wrapText(c.text, S.maxChars, S.maxLines);
    $("preview-info").textContent =
      "Caption " + (previewIndex + 1) + " of " + cues.length + " · " + (c.end - c.start).toFixed(1) + " s";
  }
  on($("preview-next"), function () {
    previewIndex += 1;
    paintPreview();
  });

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
      const clipsEl = document.querySelector('#scope-list [data-scope="clips"]');
      const n = state.seq.selectedAudioClips || 0;
      $("clips-note").textContent = n
        ? n + (n > 1 ? " clips selected" : " clip selected")
        : "Select clips on the timeline";
      clipsEl.classList.toggle("unavailable", !state.seq.supportsClipScope || !n);
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

  function buildTrack(words, polish, script) {
    const cleaned = QCPolish.cleanWords(words, polish);
    const cues = QCSrt.buildCues(cleaned, {
      maxChars: S.maxChars, maxLines: S.maxLines, minDur: S.minDur, maxDur: S.maxDur,
    });
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
    const polish = { reels: !!S.reels, caps: !!(S.reels && S.caps), fillers: !!S.fillers, bleep: !!S.bleep };
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
      const words = await runPass(audio, MODES[S.script] || "transcribe", 0.1, bilingual ? 0.5 : 0.85, "Transcribing");
      stepDone("transcribe", t0);

      let wordsEn = null;
      if (bilingual) {
        t0 = stepActive("translate");
        wordsEn = await runPass(audio, "translate", 0.5, 0.88, "Translating");
        stepDone("translate", t0);
      }

      t0 = stepActive("build");
      state.polish = polish;
      state.genScript = S.script;
      const cues = buildTrack(words, polish, S.script);
      if (!cues.length) throw new Error("No speech was found in this audio. Check that the audio tracks aren't muted and the right range is chosen, then try again.");
      const cuesEn = wordsEn ? buildTrack(wordsEn, polish, "en") : null;
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

  function renderReview() {
    const cues = activeCues();
    const hasEn = !!state.cuesEn;
    $("seg-track").classList.toggle("hidden", !hasEn);
    if (hasEn) {
      $("track-main-title").textContent = (SCRIPT_NAMES[state.genScript] || "Main") + " track";
      $("track-main-sub").textContent = countLabel(state.cues.length);
      $("track-en-sub").textContent = countLabel(state.cuesEn.length);
      paintSeg("seg-track", state.track);
    }
    $("review-count").textContent = countLabel(cues.length);
    $("save-srt-hint").textContent = SCRIPT_NAMES[state.genScript] || "";
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
    const tracks = [{ label: SCRIPT_NAMES[state.genScript], srt: srtFor(state.cues, "hi") }];
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

  function paintKeyStatus() {
    const el = $("key-status");
    if (S.keyValid === true) { el.textContent = "Key works"; el.className = "footnote ok"; }
    else if (S.keyValid === false) { el.textContent = "Sarvam rejected this key"; el.className = "footnote bad"; }
    else { el.textContent = S.apiKey ? "Not checked yet" : "No key added yet"; el.className = "footnote"; }
  }

  // macOS UXP can't read a password field's value, so the field is plain
  // text while focused and masked only when idle.
  const keyInput = $("inp-key");
  let keyRevealed = false;
  keyInput.value = S.apiKey;

  function commitKey() {
    const v = QCSettings.cleanKey(keyInput.value);
    if (keyInput.value !== v) keyInput.value = v;
    if (v !== S.apiKey) {
      S.apiKey = v;
      S.keyValid = null;
      QCSettings.save(S);
      paintKeyStatus();
      const wrong = QCSettings.wrongKeyMessage(v);
      if (wrong) notice("warn", wrong);
    }
  }
  keyInput.addEventListener("focus", function () { keyInput.type = "text"; });
  keyInput.addEventListener("blur", function () {
    commitKey();
    if (!keyRevealed) keyInput.type = "password";
  });
  keyInput.addEventListener("change", commitKey);

  on($("btn-key-eye"), function () {
    if (keyInput.type === "text" && keyRevealed === false) commitKey();
    keyRevealed = !keyRevealed;
    keyInput.type = keyRevealed ? "text" : "password";
    $("btn-key-eye").textContent = keyRevealed ? "Hide" : "Show";
  });

  on($("btn-key-check"), async function () {
    commitKey();
    if (!S.apiKey) {
      notice("warn", "Paste your Sarvam API key first.");
      return;
    }
    const wrong = QCSettings.wrongKeyMessage(S.apiKey);
    if (wrong) {
      S.keyValid = false;
      QCSettings.save(S);
      paintKeyStatus();
      notice("warn", wrong);
      return;
    }
    const btn = $("btn-key-check");
    if (btn.classList.contains("busy")) return;
    setBusy(btn, true, "Checking…");
    const res = host.mock ? { ok: true } : await QCSarvam.validateKey(S.apiKey);
    S.keyValid = res.ok;
    QCSettings.save(S);
    paintKeyStatus();
    if (!res.ok && res.message) notice("error", res.message);
    setBusy(btn, false, "Check key");
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

  setSelect($("inp-language"), S.language);
  $("inp-language").addEventListener("change", function () { S.language = $("inp-language").value; QCSettings.save(S); });

  function paintUsage() { $("usage-val").textContent = QCSettings.usageLabel(S); }

  // Handy when friends report a problem: "which version are you on?"
  $("version-line").textContent = "QuickCaps " + (host.pluginVersion ? "v" + host.pluginVersion : "preview");

  /* ---------------- Init ---------------- */

  paintScope();
  paintSeg("seg-script", S.script);
  paintExtras();
  paintPace();
  paintKeyStatus();
  paintUsage();
  show("main");
  refreshSequence();
  setInterval(function () {
    if (state.screen === "main" && !state.busy) refreshSequence();
  }, 4000);
})();
