/*
 * QCSrt — turns timestamped words into caption cues and SRT text.
 * Host-agnostic: runs in the browser, UXP, and CEP without changes.
 */
window.QCSrt = (function () {
  function pad(n, w) {
    return String(n).padStart(w, "0");
  }

  // 00:00:01,200 — SRT timestamp format
  function fmtSrtTime(sec) {
    const ms = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "," + pad(ms % 1000, 3);
  }

  // 00:04.8 — compact clock for the review list
  function fmtClock(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return pad(m, 2) + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  // 04:32 — duration badge
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    return pad(Math.floor(sec / 60), 2) + ":" + pad(sec % 60, 2);
  }

  const SENTENCE_END = /[।.!?]\s*$/;

  /*
   * words: [{ text, start, end }] in seconds.
   * Greedy grouping into cues, breaking on: character budget, max duration,
   * silence gaps, and always after sentence-ending punctuation (captions
   * never straddle two sentences). A lone sentence-final word left over by
   * the budget is folded back into the previous caption when it nearly fits.
   */
  function buildCues(words, opts) {
    const o = Object.assign(
      { maxChars: 42, maxLines: 2, minDur: 1, maxDur: 6, maxGap: 0.8 },
      opts
    );
    const budget = o.maxChars * o.maxLines;
    const cues = [];
    let cur = null;

    for (const w of words) {
      const text = (w.text || "").trim();
      if (!text) continue;

      const wouldBe = cur ? cur.text + " " + text : text;
      const gap = cur ? w.start - cur.end : 0;
      const dur = cur ? w.end - cur.start : 0;

      const mustBreak =
        cur &&
        (wouldBe.length > budget ||
          dur > o.maxDur ||
          gap > o.maxGap ||
          SENTENCE_END.test(cur.text));

      if (!cur || mustBreak) {
        if (cur) pushCue(cur);
        cur = { start: w.start, end: w.end, text: text, words: [w] };
      } else {
        cur.text = wouldBe;
        cur.end = w.end;
        cur.words.push(w);
      }
    }
    if (cur) pushCue(cur);

    // "…कर" + "देगा।" reads far better as one caption than as a one-word
    // flash, so allow up to 25% over budget for that single case.
    function pushCue(c) {
      const prev = cues[cues.length - 1];
      if (
        prev &&
        c.words.length === 1 &&
        SENTENCE_END.test(c.text) &&
        !SENTENCE_END.test(prev.text) &&
        c.start - prev.end <= o.maxGap &&
        (prev.text + " " + c.text).length <= budget * 1.25 &&
        c.end - prev.start <= o.maxDur * 1.25
      ) {
        prev.text += " " + c.text;
        prev.end = c.end;
        prev.words = prev.words.concat(c.words);
      } else {
        cues.push(c);
      }
    }

    cues.forEach(function (c, i) {
      c.id = i + 1;
      c.end = Math.max(c.end, c.start + o.minDur);
      // never overlap the next cue
      if (cues[i + 1]) c.end = Math.min(c.end, cues[i + 1].start - 0.05 > c.start ? cues[i + 1].start - 0.05 : c.end);
      c.rom = null; // roman transliteration, filled on demand
    });
    return cues;
  }

  // Balance text into at most maxLines lines of ~maxChars each.
  function wrapText(text, maxChars, maxLines) {
    const words = text.split(/\s+/);
    if (text.length <= maxChars || maxLines < 2) return text;
    const lines = [];
    let line = "";
    const target = Math.ceil(text.length / maxLines);
    for (const w of words) {
      if (line && (line + " " + w).length > Math.max(target, maxChars)) {
        lines.push(line);
        line = w;
      } else {
        line = line ? line + " " + w : w;
      }
    }
    if (line) lines.push(line);
    return lines.slice(0, maxLines).join("\n") + (lines.length > maxLines ? " " + lines.slice(maxLines).join(" ") : "");
  }

  // script: 'hi' uses cue.text (Devanagari), 'rom' prefers cue.rom
  function toSrt(cues, script, opts) {
    const o = Object.assign({ maxChars: 42, maxLines: 2 }, opts);
    return cues
      .map(function (c, i) {
        const raw = script === "rom" && c.rom ? c.rom : c.text;
        return (
          i + 1 + "\n" + fmtSrtTime(c.start) + " --> " + fmtSrtTime(c.end) + "\n" +
          wrapText(raw, o.maxChars, o.maxLines) + "\n"
        );
      })
      .join("\n");
  }

  return {
    buildCues: buildCues,
    toSrt: toSrt,
    wrapText: wrapText,
    fmtSrtTime: fmtSrtTime,
    fmtClock: fmtClock,
    fmtDuration: fmtDuration,
  };
})();
