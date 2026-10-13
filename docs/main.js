/*
 * Hero demo: three captions play over the monitor, word by word, while the
 * playhead moves along the caption track; then the script switches.
 * Clicking a script stops the auto-switch. With reduced motion, nothing
 * moves on its own.
 */
(function () {
  const LINES = {
    hi: ["नमस्ते दोस्तों, आज हम बात करेंगे", "एक ऐसे टूल के बारे में", "जो घंटों का काम मिनटों में कर देगा"],
    rom: ["namaste doston, aaj hum baat karenge", "ek aise tool ke baare mein", "jo ghanton ka kaam minton mein kar dega"],
    mix: ["नमस्ते दोस्तों, आज हम बात करेंगे", "एक ऐसे tool के बारे में", "जो घंटों का काम minutes में कर देगा"],
    en: ["Hello friends, today we'll talk", "about a tool", "that turns hours of work into minutes"],
  };
  const NOTES = {
    hi: "Devanagari, straight from the speech.",
    rom: "Hinglish in Roman letters, the way people type it.",
    mix: "Hindi in Devanagari, English words left in English.",
    en: "English subtitles, translated from the Hindi.",
  };
  const ORDER = ["hi", "rom", "mix", "en"];
  // Caption clip spans on the track, as fractions of its width.
  const SPANS = [[0.01, 0.32], [0.33, 0.58], [0.59, 0.99]];
  const LOOP_MS = 6500;

  const cap = document.getElementById("cap");
  const note = document.getElementById("script-note");
  const tc = document.getElementById("tc");
  const playhead = document.getElementById("playhead");
  const clips = Array.prototype.slice.call(document.querySelectorAll(".track-c .clip"));
  const tabs = Array.prototype.slice.call(document.querySelectorAll(".scripts button"));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let script = "hi";
  let auto = !reduced;
  let shownLine = -1;
  let shownWord = -1;
  let words = [];
  let t0 = performance.now();

  function setScript(s) {
    script = s;
    tabs.forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.s === s)); });
    cap.setAttribute("lang", s === "rom" || s === "en" ? "en" : "hi");
    note.textContent = NOTES[s];
    shownLine = -1;
    render(reduced ? 0.1 : ((performance.now() - t0) % LOOP_MS) / LOOP_MS);
  }

  function showLine(text) {
    cap.textContent = "";
    words = text.split(" ").map(function (w, i) {
      const span = document.createElement("span");
      span.className = "w";
      span.textContent = (i ? " " : "") + w;
      cap.appendChild(span);
      return span;
    });
    shownWord = -1;
  }

  function render(f) {
    playhead.style.left = (f * 100).toFixed(2) + "%";
    let idx = 0;
    SPANS.forEach(function (sp, i) { if (f >= sp[0]) idx = i; });
    clips.forEach(function (c, i) { c.classList.toggle("on", i === idx); });
    if (idx !== shownLine) {
      shownLine = idx;
      showLine(LINES[script][idx]);
    }
    // The spoken word, karaoke style.
    const sp = SPANS[idx];
    const local = Math.min(0.999, Math.max(0, (f - sp[0]) / (sp[1] - sp[0])));
    const w = reduced ? -1 : Math.floor(local * words.length);
    if (w !== shownWord) {
      if (words[shownWord]) words[shownWord].classList.remove("now");
      if (words[w]) words[w].classList.add("now");
      shownWord = w;
    }
    // 25 fps timecode from 00:00:12:00.
    const frames = Math.floor(f * 6.5 * 25) + 12 * 25;
    const s = Math.floor(frames / 25), fr = frames % 25;
    tc.textContent = "00:00:" + String(s).padStart(2, "0") + ":" + String(fr).padStart(2, "0");
  }

  function tick(now) {
    if (auto && now - t0 >= LOOP_MS) {
      t0 = now;
      setScript(ORDER[(ORDER.indexOf(script) + 1) % ORDER.length]);
    }
    render(((now - t0) % LOOP_MS) / LOOP_MS);
    requestAnimationFrame(tick);
  }

  tabs.forEach(function (b) {
    b.addEventListener("click", function () {
      auto = false;
      t0 = performance.now();
      setScript(b.dataset.s);
    });
  });

  setScript("hi");
  if (!reduced) requestAnimationFrame(tick);
})();
