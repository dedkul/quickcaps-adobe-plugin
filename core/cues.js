/*
 * QCCues — review-screen state: edit, split, and merge caption cues.
 * Operates on the cue objects produced by QCSrt.buildCues.
 */
window.QCCues = (function () {
  function findIndex(cues, id) {
    return cues.findIndex(function (c) {
      return c.id === id;
    });
  }

  function renumber(cues) {
    cues.forEach(function (c, i) {
      c.id = i + 1;
    });
    return cues;
  }

  function updateText(cues, id, script, text) {
    const i = findIndex(cues, id);
    if (i < 0) return cues;
    if (script === "rom") cues[i].rom = text;
    else {
      cues[i].text = text;
      cues[i].rom = null; // Devanagari changed → old transliteration is stale
    }
    return cues;
  }

  /*
   * Split a cue into two at the word nearest its visual midpoint.
   * Times come from word timestamps when present, else proportional to characters.
   */
  function split(cues, id) {
    const i = findIndex(cues, id);
    if (i < 0) return cues;
    const c = cues[i];
    const words = c.text.split(/\s+/);
    if (words.length < 2) return cues;

    let cut = 1,
      len = 0;
    const half = c.text.length / 2;
    for (let w = 0; w < words.length - 1; w++) {
      len += words[w].length + 1;
      if (len >= half) {
        cut = w + 1;
        break;
      }
    }

    let tCut;
    if (c.words && c.words.length === words.length) {
      tCut = (c.words[cut - 1].end + c.words[cut].start) / 2;
    } else {
      tCut = c.start + (c.end - c.start) * (len / c.text.length);
    }

    const a = {
      start: c.start,
      end: tCut,
      text: words.slice(0, cut).join(" "),
      words: c.words ? c.words.slice(0, cut) : null,
      rom: null,
    };
    const b = {
      start: tCut,
      end: c.end,
      text: words.slice(cut).join(" "),
      words: c.words ? c.words.slice(cut) : null,
      rom: null,
    };
    cues.splice(i, 1, a, b);
    return renumber(cues);
  }

  function mergeWithNext(cues, id) {
    const i = findIndex(cues, id);
    if (i < 0 || i >= cues.length - 1) return cues;
    const a = cues[i],
      b = cues[i + 1];
    a.text = a.text + " " + b.text;
    a.rom = a.rom && b.rom ? a.rom + " " + b.rom : null;
    a.end = b.end;
    a.words = a.words && b.words ? a.words.concat(b.words) : null;
    cues.splice(i + 1, 1);
    return renumber(cues);
  }

  function remove(cues, id) {
    const i = findIndex(cues, id);
    if (i >= 0) cues.splice(i, 1);
    return renumber(cues);
  }

  /* ---------------- Find & replace ---------------- */

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Case-insensitive (matters for Roman/English text). "Whole word" can't use
  // \b, which doesn't know Devanagari; instead a match may not touch another
  // letter, vowel sign (matra), or digit on either side, so "का" won't match
  // inside "काम".
  function buildPattern(query, wholeWord) {
    const q = escapeRegExp(query.trim());
    if (!q) return null;
    const body = wholeWord ? "(?<![\\p{L}\\p{M}\\p{N}])" + q + "(?![\\p{L}\\p{M}\\p{N}])" : q;
    return new RegExp(body, "giu");
  }

  function textOf(c, script) {
    return script === "rom" ? (c.rom || c.text) : c.text;
  }

  // -> { total, ids: [cue ids with at least one match] }
  function findMatches(cues, query, script, wholeWord) {
    const re = buildPattern(query || "", wholeWord);
    const out = { total: 0, ids: [] };
    if (!re) return out;
    cues.forEach(function (c) {
      const n = (textOf(c, script).match(re) || []).length;
      if (n) {
        out.total += n;
        out.ids.push(c.id);
      }
    });
    return out;
  }

  // Replaces every match in the given script; returns the number replaced.
  function replaceAll(cues, query, replacement, script, wholeWord) {
    const re = buildPattern(query || "", wholeWord);
    if (!re) return 0;
    let count = 0;
    cues.forEach(function (c) {
      const before = textOf(c, script);
      const after = before.replace(re, function () {
        count++;
        return replacement;
      }).replace(/\s{2,}/g, " ").trim();
      if (after !== before) updateText(cues, c.id, script, after || before);
    });
    return count;
  }

  // Undo support: a copy of every cue's text, restorable later.
  function snapshot(cues) {
    return cues.map(function (c) {
      return { id: c.id, text: c.text, rom: c.rom };
    });
  }

  function restore(cues, snap) {
    const byId = {};
    snap.forEach(function (s) { byId[s.id] = s; });
    cues.forEach(function (c) {
      const s = byId[c.id];
      if (s) {
        c.text = s.text;
        c.rom = s.rom;
      }
    });
    return cues;
  }

  return {
    updateText: updateText,
    split: split,
    mergeWithNext: mergeWithNext,
    remove: remove,
    findMatches: findMatches,
    replaceAll: replaceAll,
    snapshot: snapshot,
    restore: restore,
  };
})();
