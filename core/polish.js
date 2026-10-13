/*
 * QCPolish — optional caption clean-up, all done locally (no Sarvam cost):
 *   fillers  drop "umm, uh, hmm, अं…" words before captions are built
 *   bleep    mask common profanity as ****
 *   reels    no full stop / danda at the end of a caption
 *   caps     ALL CAPS for Roman and English text (Devanagari has no case)
 * Plus transcript() for the plain-text export.
 */
window.QCPolish = (function () {
  // Whole-word guards that understand Devanagari (letters + vowel signs),
  // same approach as find & replace in cues.js.
  const B = "(?<![\\p{L}\\p{M}\\p{N}])";
  const E = "(?![\\p{L}\\p{M}\\p{N}])";

  // Only sounds that are never real words. "हम" (we) and "ah"-like words
  // that carry meaning are deliberately left out.
  const FILLERS = new RegExp(
    "^(?:u+m+|u+h+m*|h+m+|e+r+m*|a+h+|अं+|अ+म्+|उ+म्+|ह्+म्+|हम्म+|आं+)$", "iu"
  );

  // Devanagari can encode the same letter two ways (e.g. ड़ as one code point
  // or ड + nukta), so patterns and text are both NFC-normalised first.
  const nfc = function (s) { return typeof s.normalize === "function" ? s.normalize("NFC") : s; };

  // Common English and Hindi/Hinglish profanity, Roman and Devanagari.
  // "~" marks a stem that may continue with more letters or vowel signs, so
  // inflections match too (fucking, chutiye, भोसड़ीके).
  const BAD = new RegExp(nfc(B + "(?:" + [
    "f+u+c+k~", "motherf~", "sh+i+t+~", "b+i+t+c+h~", "bastards?",
    "assholes?", "dickheads?", "cunts?",
    "chut(?:iy|iy)~", "madar ?chod~", "b(?:e|a)h?e?n ?chod~", "bhosd~",
    "gaa?ndu~", "gaa?nd", "lund~", "randi~", "harami~", "lau?d(?:a|e|on)", "lavd(?:a|e)",
    "चूति~", "चुति~", "मादरचोद~", "बहनचोद~", "भेनचोद~", "भोसड़ी~",
    "भोसडी~", "गांडू~", "गांड", "लंड~", "रंडी~", "हरामी~", "लौड़~",
  ].join("|") + ")" + E).replace(/~/g, "[\\p{L}\\p{M}]*"), "giu");

  const MASK = "****";
  const TRAIL_PUNCT = /[,.।!?]+$/;

  // words: [{text, start, end}] straight from Sarvam (after phrase splitting).
  function cleanWords(words, opts) {
    const out = [];
    words.forEach(function (w) {
      let text = w.text;
      if (opts.fillers) {
        const bare = text.replace(TRAIL_PUNCT, "");
        if (FILLERS.test(bare)) {
          // Keep any sentence ending the filler carried ("…umm.").
          const end = (text.match(/[.।!?]+$/) || [""])[0];
          const prev = out[out.length - 1];
          if (end && prev && !/[.।!?]$/.test(prev.text)) prev.text += end;
          return;
        }
      }
      if (opts.bleep) text = nfc(text).replace(BAD, MASK);
      out.push({ text: text, start: w.start, end: w.end, rom: w.rom });
    });
    return out;
  }

  function finishText(text, opts, upper) {
    let t = text;
    if (opts.bleep) t = nfc(t).replace(BAD, MASK);
    if (opts.reels) t = t.replace(/\s*[.।]+$/, "");
    if (opts.caps && upper) t = t.toUpperCase();
    return t;
  }

  // Applies reels/caps (and bleep, for transliterated text) to built cues.
  // `script` is the caption script the cues were generated with. Safe to
  // run repeatedly: every step is idempotent.
  function finishCues(cues, opts, script) {
    const upperMain = script === "en" || script === "mix" || script === "rom";
    cues.forEach(function (c) {
      c.text = finishText(c.text, opts, upperMain) || c.text;
      if (c.rom) c.rom = finishText(c.rom, opts, true) || c.rom;
    });
    return cues;
  }

  // Plain-text transcript: captions joined into flowing text, with a new
  // paragraph wherever the speaker pauses for more than 1.5 seconds.
  function transcript(cues, script) {
    let out = "";
    cues.forEach(function (c, i) {
      const text = script === "rom" ? (c.rom || c.text) : c.text;
      if (i > 0) out += c.start - cues[i - 1].end > 1.5 ? "\n\n" : " ";
      out += text;
    });
    return out + "\n";
  }

  return { cleanWords: cleanWords, finishCues: finishCues, transcript: transcript };
})();
