/*
 * QCSarvam — Sarvam AI client: speech-to-text with timestamps + transliteration.
 *
 * Checked against docs.sarvam.ai (Oct 2026):
 * - POST /speech-to-text (multipart): models saaras:v4 (default) / saaras:v3,
 *   accepts audio up to ~30 s, best at 16 kHz mono.
 * - with_timestamps=true returns timestamps.{words,start_time_seconds,
 *   end_time_seconds} where each entry is a phrase/sentence, not a word.
 * - POST /transliterate (JSON): input <= 1000 chars -> transliterated_text.
 *
 * Long audio: the exported WAV is sliced locally into ~28 s chunks and the
 * results stitched back together with time offsets.
 *
 * Uploads are built by hand as a multipart ArrayBuffer because Premiere's
 * UXP runtime doesn't reliably send Blob/FormData binary bodies.
 *
 * All Sarvam specifics live in this file, so a future backend proxy (for a
 * public launch) replaces just this module.
 */
window.QCSarvam = (function () {
  const BASE = "https://api.sarvam.ai";
  const CHUNK_SECONDS = 28;

  async function apiError(res) {
    let detail = "";
    try {
      const body = await res.json();
      detail = (body && (body.error && (body.error.message || body.error))) || body.detail || body.message || "";
      if (typeof detail !== "string") detail = JSON.stringify(detail);
    } catch (e) {
      /* non-JSON error body */
    }
    let msg;
    const outOfCredit = res.status === 402 || /insufficient|credit|balance|top.?up|payment/i.test(detail);
    if (outOfCredit) msg = "Your Sarvam credit has run out. Add credit at dashboard.sarvam.ai, then try again.";
    else if (res.status === 401 || res.status === 403) msg = "Sarvam rejected the API key. Check it in Settings.";
    else if (res.status === 429) msg = "Sarvam rate limit or quota reached. Wait a minute, or check your Sarvam dashboard.";
    else if (res.status === 422 || res.status === 400) msg = "Sarvam couldn't process this request. " + detail;
    else msg = "Sarvam had a problem (" + res.status + "). Try again in a moment. " + detail;
    const e = new Error(msg.trim());
    e.status = res.status;
    return e;
  }

  /* ---------------- Bytes + multipart ---------------- */

  // UTF-8 by hand: TextEncoder isn't guaranteed in every Premiere runtime,
  // and field values (keyterms) can be Devanagari.
  function utf8Bytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function concatBytes(parts) {
    let n = 0;
    parts.forEach(function (p) { n += p.byteLength; });
    const out = new Uint8Array(n);
    let o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.byteLength; });
    return out;
  }

  function multipart(fields, file) {
    const boundary = "----quickcaps" + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const parts = [];
    Object.keys(fields).forEach(function (k) {
      parts.push(utf8Bytes(
        "--" + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + "\r\n"
      ));
    });
    parts.push(utf8Bytes(
      "--" + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + file.name +
      '"\r\nContent-Type: ' + file.type + "\r\n\r\n"
    ));
    parts.push(file.bytes);
    parts.push(utf8Bytes("\r\n--" + boundary + "--\r\n"));
    return { body: concatBytes(parts).buffer, contentType: "multipart/form-data; boundary=" + boundary };
  }

  /* ---------------- WAV slicing (PCM) ---------------- */

  function readWavInfo(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < 12 || dv.getUint32(0, false) !== 0x52494646) {
      throw new Error("The exported audio isn't a WAV file. Check the export preset.");
    }
    let offset = 12;
    let fmt = null,
      dataOffset = -1,
      dataSize = 0;
    while (offset + 8 <= buf.byteLength) {
      const id = dv.getUint32(offset, false);
      const size = dv.getUint32(offset + 4, true);
      if (id === 0x666d7420) {
        fmt = {
          channels: dv.getUint16(offset + 10, true),
          sampleRate: dv.getUint32(offset + 12, true),
          byteRate: dv.getUint32(offset + 16, true),
          blockAlign: dv.getUint16(offset + 20, true),
          bitsPerSample: dv.getUint16(offset + 22, true),
        };
      } else if (id === 0x64617461) {
        dataOffset = offset + 8;
        dataSize = Math.min(size, buf.byteLength - dataOffset);
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (!fmt || dataOffset < 0) throw new Error("Couldn't read the exported WAV file.");
    return Object.assign(fmt, { dataOffset: dataOffset, dataSize: dataSize, duration: dataSize / fmt.byteRate });
  }

  function makeWav(fmt, pcm) {
    const out = new Uint8Array(44 + pcm.byteLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x52494646, false); // RIFF
    dv.setUint32(4, 36 + pcm.byteLength, true);
    dv.setUint32(8, 0x57415645, false); // WAVE
    dv.setUint32(12, 0x666d7420, false); // fmt
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); // PCM
    dv.setUint16(22, fmt.channels, true);
    dv.setUint32(24, fmt.sampleRate, true);
    dv.setUint32(28, fmt.byteRate, true);
    dv.setUint16(32, fmt.blockAlign, true);
    dv.setUint16(34, fmt.bitsPerSample, true);
    dv.setUint32(36, 0x64617461, false); // data
    dv.setUint32(40, pcm.byteLength, true);
    out.set(new Uint8Array(pcm), 44);
    return out;
  }

  function chunkWav(buf) {
    const info = readWavInfo(buf);
    const bytesPerChunk = Math.floor((CHUNK_SECONDS * info.byteRate) / info.blockAlign) * info.blockAlign;
    const chunks = [];
    for (let pos = 0; pos < info.dataSize; pos += bytesPerChunk) {
      const end = Math.min(pos + bytesPerChunk, info.dataSize);
      chunks.push({
        bytes: makeWav(info, buf.slice(info.dataOffset + pos, info.dataOffset + end)),
        offsetSeconds: pos / info.byteRate,
        seconds: (end - pos) / info.byteRate,
      });
    }
    return { chunks: chunks, duration: info.duration };
  }

  // Cut [startSec, endSec) out of a PCM WAV, returning a new WAV ArrayBuffer.
  function sliceWav(buf, startSec, endSec) {
    const info = readWavInfo(buf);
    const at = function (sec) {
      const b = Math.floor((Math.max(0, sec) * info.byteRate) / info.blockAlign) * info.blockAlign;
      return Math.min(b, info.dataSize);
    };
    const a = at(startSec);
    const b = Math.max(a, at(endSec));
    return makeWav(info, buf.slice(info.dataOffset + a, info.dataOffset + b)).buffer;
  }

  // Hosts whose fetch can't reach Sarvam (e.g. CEP, where Node does the
  // request) provide QCHost.fetch; everywhere else the built-in is used.
  function doFetch(url, init) {
    const host = window.QCHost;
    return host && host.fetch ? host.fetch(url, init) : fetch(url, init);
  }

  /* ---------------- Speech to text ---------------- */

  // Spread a phrase's time span across its words, proportional to length,
  // so the caption builder can break long sentences at sensible points.
  function phraseToWords(text, start, end, out) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const total = words.reduce(function (n, w) { return n + w.length + 1; }, 0);
    const span = Math.max(end - start, 0.2 * words.length);
    let t = start;
    words.forEach(function (w) {
      const d = span * ((w.length + 1) / total);
      out.push({ text: w, start: t, end: t + d });
      t += d;
    });
  }

  // Normalizes Sarvam's phrase timestamps into [{text, start, end}] words.
  function parseWords(json, offset, chunkSeconds) {
    const out = [];
    const ts = json && json.timestamps;
    if (ts && Array.isArray(ts.words) && ts.words.length) {
      const starts = ts.start_time_seconds || [];
      const ends = ts.end_time_seconds || [];
      ts.words.forEach(function (phrase, i) {
        const s = Number(starts[i]) || 0;
        const e = Number(ends[i]) || s;
        phraseToWords(String(phrase), offset + s, offset + e, out);
      });
    } else if (json && json.transcript) {
      // No timestamps returned — spread the text across the chunk.
      phraseToWords(json.transcript, offset, offset + chunkSeconds, out);
    }
    return out;
  }

  async function transcribeChunk(chunk, opts) {
    const fields = { model: opts.model, with_timestamps: "true" };
    if (opts.language) fields.language_code = opts.language;
    // transcribe (default) | codemix | translate — supported on saaras v3 and v4.
    if (opts.mode && opts.mode !== "transcribe") fields.mode = opts.mode;
    // Keyterm prompting is v4-only; Sarvam wants a JSON array in one field.
    if (opts.keyterms && opts.keyterms.length && opts.model === "saaras:v4") {
      fields.keyterms = JSON.stringify(opts.keyterms);
    }
    const mp = multipart(fields, { name: "audio.wav", type: "audio/wav", bytes: chunk.bytes });
    let res;
    try {
      res = await doFetch(BASE + "/speech-to-text", {
        method: "POST",
        headers: { "api-subscription-key": opts.apiKey, "Content-Type": mp.contentType },
        body: mp.body,
      });
    } catch (e) {
      throw new Error("Couldn't reach Sarvam. Check your internet connection and try again.");
    }
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  /*
   * wavBuffer: ArrayBuffer of the exported WAV.
   * opts: { apiKey, language: 'hi-IN', model, mode, keyterms: [string],
   *         onProgress(done, total), isCancelled() }
   * Returns { words: [{text,start,end}], durationSeconds }
   */
  const PARALLEL = 3; // parts in flight at once; billing is per audio second either way
  const RETRY_DELAYS = [1500, 4000]; // rate limit or a brief Sarvam hiccup

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function transcribeChunkWithRetry(chunk, opts) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transcribeChunk(chunk, opts);
      } catch (e) {
        const retryable = e && (e.status === 429 || e.status >= 500);
        if (!retryable || attempt >= RETRY_DELAYS.length) throw e;
        await wait(RETRY_DELAYS[attempt]);
      }
    }
  }

  async function transcribe(wavBuffer, opts) {
    const o = Object.assign({ language: "hi-IN", model: "saaras:v4" }, opts);
    const sliced = chunkWav(wavBuffer);
    const chunks = sliced.chunks;
    const results = new Array(chunks.length);
    let next = 0;
    let done = 0;
    let failed = null;

    // A few workers pull parts off a shared queue; results are stored by
    // index so captions come out in order however the replies arrive. The
    // first error (or a cancel) stops every worker from starting new parts.
    async function worker() {
      while (!failed && next < chunks.length) {
        if (o.isCancelled && o.isCancelled()) {
          failed = { cancelled: true };
          return;
        }
        const i = next++;
        try {
          results[i] = await transcribeChunkWithRetry(chunks[i], o);
        } catch (e) {
          if (!failed) failed = e;
          return;
        }
        done++;
        if (o.onProgress) o.onProgress(done, chunks.length);
      }
    }
    const workers = [];
    for (let w = 0; w < Math.min(PARALLEL, chunks.length); w++) workers.push(worker());
    await Promise.all(workers);
    if (failed) throw failed;

    let words = [];
    chunks.forEach(function (c, i) {
      words = words.concat(parseWords(results[i], c.offsetSeconds, c.seconds));
    });
    return { words: words, durationSeconds: sliced.duration };
  }

  /* ---------------- Transliteration (Devanagari → Roman) ---------------- */

  async function transliterateOne(input, apiKey) {
    let res;
    try {
      res = await doFetch(BASE + "/transliterate", {
        method: "POST",
        headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: input,
          source_language_code: "hi-IN",
          target_language_code: "en-IN",
        }),
      });
    } catch (e) {
      throw new Error("Couldn't reach Sarvam. Check your internet connection and try again.");
    }
    if (!res.ok) throw await apiError(res);
    const json = await res.json();
    return json.transliterated_text || "";
  }

  // Batches cues (newline-separated, <= 1000 chars) to save calls; if the
  // reply doesn't split back into the same number of lines, that batch is
  // redone one cue at a time.
  async function transliterateCues(cues, apiKey, onProgress) {
    const SEP = "\n";
    const LIMIT = 900;
    let batch = [],
      batchLen = 0,
      done = 0;
    const flush = async function () {
      if (!batch.length) return;
      const out = await transliterateOne(batch.map(function (c) { return c.text; }).join(SEP), apiKey);
      const parts = out.split(/\r?\n/);
      if (parts.length === batch.length) {
        batch.forEach(function (c, i) { c.rom = parts[i].trim() || c.text; });
      } else {
        for (const c of batch) c.rom = (await transliterateOne(c.text, apiKey)).trim() || c.text;
      }
      done += batch.length;
      if (onProgress) onProgress(done, cues.length);
      batch = [];
      batchLen = 0;
    };
    for (const c of cues) {
      if (c.rom) { done++; continue; }
      if (batchLen + c.text.length + 1 > LIMIT) await flush();
      batch.push(c);
      batchLen += c.text.length + 1;
    }
    await flush();
    return cues;
  }

  // Cheap key check: transliterate one word.
  async function validateKey(apiKey) {
    try {
      await transliterateOne("नमस्ते", apiKey);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message, status: e.status || 0 };
    }
  }

  return {
    transcribe: transcribe,
    transliterateCues: transliterateCues,
    validateKey: validateKey,
    chunkWav: chunkWav,
    sliceWav: sliceWav,
    parseWords: parseWords,
  };
})();
