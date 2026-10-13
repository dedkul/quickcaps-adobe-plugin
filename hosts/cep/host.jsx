/*
 * QuickCaps — ExtendScript side of the CEP build (Premiere Pro 2022+).
 *
 * ExtendScript is ES3: no let/const, arrow functions, or JSON object, so
 * results are serialized by qc_json below. Every entry point catches its own
 * errors and returns {"error": "..."} so the panel can show a clear message.
 *
 * Called from hosts/cep/adapter.js via evalScript.
 */

var QC_TICKS_PER_SECOND = 254016000000;

function qc_str(s) {
  return '"' + String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t") + '"';
}

function qc_json(o) {
  if (o === null || o === undefined) return "null";
  var t = typeof o;
  if (t === "number") return isFinite(o) ? String(o) : "null";
  if (t === "boolean") return o ? "true" : "false";
  if (t === "string") return qc_str(o);
  var parts = [];
  if (o instanceof Array) {
    for (var i = 0; i < o.length; i++) parts.push(qc_json(o[i]));
    return "[" + parts.join(",") + "]";
  }
  for (var k in o) {
    if (o.hasOwnProperty(k)) parts.push(qc_str(k) + ":" + qc_json(o[k]));
  }
  return "{" + parts.join(",") + "}";
}

function qc_error(e) {
  return qc_json({ error: String(e && e.message ? e.message : e) });
}

function qc_activeSequence() {
  if (!app.project) throw new Error("No project open in Premiere.");
  var seq = app.project.activeSequence;
  if (!seq) throw new Error("No sequence open. Open one in Premiere first.");
  return seq;
}

// Selected clips as [{start, end}] in seconds (sequence time).
function qc_selectedRanges(seq) {
  var out = [];
  var sel = seq.getSelection();
  if (!sel) return out;
  for (var i = 0; i < sel.length; i++) {
    var item = sel[i];
    if (item && item.start && item.end) out.push({ start: item.start.seconds, end: item.end.seconds });
  }
  return out;
}

function qc_sequenceInfo() {
  try {
    var seq = qc_activeSequence();
    var ranges = qc_selectedRanges(seq);
    var lo = null, hi = null;
    for (var i = 0; i < ranges.length; i++) {
      if (lo === null || ranges[i].start < lo) lo = ranges[i].start;
      if (hi === null || ranges[i].end > hi) hi = ranges[i].end;
    }
    var inOut = seq.getOutPointAsTime().seconds - seq.getInPointAsTime().seconds;
    return qc_json({
      name: seq.name,
      durationSeconds: Number(seq.end) / QC_TICKS_PER_SECOND,
      selectedAudioClips: ranges.length,
      supportsClipScope: true,
      inOutSeconds: inOut > 0 ? inOut : 0,
      selectionSeconds: ranges.length ? hi - lo : 0
    });
  } catch (e) {
    return qc_error(e);
  }
}

/*
 * Renders the sequence's audio to outPath with the bundled preset.
 * scope: "sequence" | "inout" | "clips".
 * "clips" renders the whole sequence and reports the selection's time range,
 * which the panel then cuts out of the WAV, so the user's In/Out marks are
 * never touched.
 */
function qc_exportAudio(scope, outPath, presetPath) {
  try {
    var seq = qc_activeSequence();
    if (!new File(presetPath).exists) throw new Error("QuickCaps' export preset is missing. Reinstall the panel.");

    var old = new File(outPath);
    if (old.exists) old.remove();

    var workArea = 0; // 0 entire sequence, 1 in to out
    var result = { ok: true, startSeconds: 0, endSeconds: null };

    if (scope === "inout") {
      workArea = 1;
      result.startSeconds = seq.getInPointAsTime().seconds;
    } else if (scope === "clips") {
      var ranges = qc_selectedRanges(seq);
      if (!ranges.length) throw new Error("Select one or more clips on the timeline first.");
      var lo = ranges[0].start, hi = ranges[0].end;
      for (var i = 1; i < ranges.length; i++) {
        if (ranges[i].start < lo) lo = ranges[i].start;
        if (ranges[i].end > hi) hi = ranges[i].end;
      }
      result.startSeconds = lo;
      result.endSeconds = hi;
    }

    seq.exportAsMediaDirect(outPath, presetPath, workArea);
    // The return value differs between versions; the file is the real check.
    if (!new File(outPath).exists) throw new Error("Premiere couldn't export the audio. Try again, or restart Premiere.");
    return qc_json(result);
  } catch (e) {
    return qc_error(e);
  }
}

/*
 * Imports the SRT and puts it on a new caption track. The SRT is already
 * timed to sequence time, so the track starts at 0.
 */
function qc_addCaptions(srtPath, itemName) {
  try {
    var seq = qc_activeSequence();
    var bin = app.project.getInsertionBin() || app.project.rootItem;
    app.project.importFiles([srtPath], true, bin, false);

    var base = itemName.replace(/\.srt$/i, "");
    var item = null;
    for (var i = bin.children.numItems - 1; i >= 0; i--) {
      var c = bin.children[i];
      if (c && (c.name === itemName || c.name === base)) {
        item = c;
        break;
      }
    }
    if (!item) throw new Error("Premiere didn't import the caption file.");

    var placed = false;
    var reason = "";
    try {
      placed = !!seq.createCaptionTrack(item, 0);
      if (!placed) reason = "Premiere declined to create the caption track";
    } catch (e2) {
      reason = String(e2 && e2.message ? e2.message : e2);
    }
    return qc_json({ ok: true, placed: placed, itemName: item.name, reason: reason });
  } catch (e) {
    return qc_error(e);
  }
}
