const fs = require("fs");
const path = require("path");
const assert = require("assert");
global.window = global;
// Run from the project root:  node tests/core.test.js
const root = process.argv[2] || path.join(__dirname, "..");
for (const f of ["srt.js", "cues.js", "sarvam.js", "polish.js", "settings.js"]) eval(fs.readFileSync(path.join(root, "core", f), "utf8"));

// 70 s of 16 kHz mono 16-bit silence = what the bundled preset produces.
function wav(seconds) {
  const rate = 16000, n = rate * seconds * 2;
  const b = new ArrayBuffer(44 + n), dv = new DataView(b);
  dv.setUint32(0, 0x52494646); dv.setUint32(4, 36 + n, true); dv.setUint32(8, 0x57415645);
  dv.setUint32(12, 0x666d7420); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x64617461); dv.setUint32(40, n, true);
  return b;
}
const sliced = QCSarvam.chunkWav(wav(70));
assert.strictEqual(sliced.chunks.length, 3, "70 s -> 3 chunks");
assert.strictEqual(Math.round(sliced.duration), 70);
assert.deepStrictEqual(sliced.chunks.map(c => c.offsetSeconds), [0, 28, 56]);
assert(sliced.chunks.every(c => c.bytes instanceof Uint8Array));
// each chunk must itself be a valid WAV under 30 s
for (const c of sliced.chunks) {
  const re = QCSarvam.chunkWav(c.bytes.buffer);
  assert(re.duration <= 28.01, "chunk under 30 s");
}
console.log("ok  wav slicing:", sliced.chunks.map(c => c.seconds.toFixed(1) + "s").join(", "));

// Sarvam phrase-level timestamps -> word timings -> caption cues
const fake = {
  transcript: "x",
  timestamps: {
    words: [
      "नमस्ते दोस्तों, आज हम बात करेंगे एक ऐसे टूल के बारे में जो आपका घंटों का काम मिनटों में कर देगा।",
      "वीडियो एडिटिंग में सबसे बोरिंग काम होता है कैप्शन लगाना।",
    ],
    start_time_seconds: [0.4, 9.1],
    end_time_seconds: [8.6, 13.0],
  },
};
const words = QCSarvam.parseWords(fake, 28, 28);
assert(words.length > 20);
assert(Math.abs(words[0].start - 28.4) < 1e-6, "chunk offset applied");
assert(words.every((w, i) => i === 0 || w.start >= words[i - 1].start), "monotonic");
const cues = QCSrt.buildCues(words, { maxChars: 30, maxLines: 1, maxDur: 5 });
assert(cues.every(c => c.text.length <= 30 || c.text.split(" ").length === 1), "char budget respected");
assert(cues.every(c => c.end - c.start <= 5.5), "duration budget respected");
console.log("ok  phrase -> " + words.length + " words -> " + cues.length + " cues (1 line, 30 chars):");
cues.forEach(c => console.log("    " + QCSrt.fmtClock(c.start) + "  " + c.text));
const srt = QCSrt.toSrt(cues, "hi", { maxChars: 30, maxLines: 1 });
assert(/^1\n00:00:28,400 --> /.test(srt));
console.log("ok  srt output starts:", JSON.stringify(srt.split("\n").slice(0, 3)));

// Captions never straddle sentences, in every pacing preset.
{
  const s = "नमस्ते दोस्तों, आज हम बात करेंगे एक ऐसे टूल के बारे में जो आपका घंटों का काम मिनटों में कर देगा। वीडियो एडिटिंग में सबसे बोरिंग काम होता है कैप्शन लगाना। हर लाइन को सुनकर टाइप करना पड़ता है।";
  let t = 0;
  const ws = s.split(" ").map((w) => { const d = 0.18 + w.length * 0.035; const o = { text: w, start: t, end: t + d }; t += d + 0.08; return o; });
  for (const o of [{ maxLines: 1, maxChars: 20, maxDur: 2 }, { maxLines: 1, maxChars: 32, maxDur: 4 }, { maxLines: 2, maxChars: 42, maxDur: 6 }]) {
    const cs = QCSrt.buildCues(ws, Object.assign({ minDur: 1 }, o));
    assert(cs.every((c) => !/[।.!?]\s/.test(c.text)), "no caption spans two sentences");
    assert(cs.every((c) => c.text.length <= o.maxChars * o.maxLines * 1.25), "within budget (+25% orphan fold)");
    assert(cs.every((c, i) => i === 0 || c.start >= cs[i - 1].end), "no overlaps");
  }
  console.log("ok  sentence boundaries respected in fast/balanced/relaxed presets");
}

// Find & replace: Devanagari-aware whole words, case-insensitive Roman, undo.
{
  const mk = () => [
    { id: 1, text: "आज का काम बहुत ज़रूरी है", rom: "aaj ka kaam bahut zaroori hai" },
    { id: 2, text: "Asheesh का tool", rom: "Asheesh ka tool" },
    { id: 3, text: "काम खत्म।", rom: "kaam khatm." },
  ];
  const c = mk();
  assert.deepStrictEqual(QCCues.findMatches(c, "का", "hi", true), { total: 2, ids: [1, 2] }, "का not inside काम");
  assert.strictEqual(QCCues.findMatches(c, "का", "hi", false).total, 4);
  assert.deepStrictEqual(QCCues.findMatches(c, "KAAM", "rom", true), { total: 2, ids: [1, 3] });
  assert.strictEqual(QCCues.findMatches(c, "kaa", "rom", true).total, 0);
  const snap = QCCues.snapshot(c);
  assert.strictEqual(QCCues.replaceAll(c, "Asheesh", "Ashish", "hi", true), 1);
  assert.strictEqual(c[1].text, "Ashish का tool");
  assert.strictEqual(c[1].rom, null, "stale Roman cleared after a Devanagari edit");
  QCCues.replaceAll(c, "बहुत", "", "hi", true);
  assert.strictEqual(c[0].text, "आज का काम ज़रूरी है", "deleting a word leaves no double space");
  assert.strictEqual(QCCues.replaceAll(c, "(a+", "x", "hi", false), 0, "regex characters are literal");
  QCCues.restore(c, snap);
  assert.deepStrictEqual(c, mk(), "undo restores every caption");
  console.log("ok  find & replace: whole-word Devanagari, case-insensitive Roman, literal text, undo");
}

// Polish extras: fillers, bleep (both Devanagari encodings), reels, caps, transcript.
{
  const W = (str) => str.split(" ").map((t, i) => ({ text: t, start: i, end: i + 0.9 }));
  let r = QCPolish.cleanWords(W("umm हम आज अं बात करेंगे uh. Hmm, ok"), { fillers: true });
  assert.strictEqual(r.map((w) => w.text).join(" "), "हम आज बात करेंगे. ok", "fillers gone, हम kept, full stop kept");
  r = QCPolish.cleanWords(W("ye fucking chutiya aur भोस\u0921\u093Cीके भोस\u095Cीके shift assessment chut"), { bleep: true });
  const out = r.map((w) => w.text).join(" ");
  assert(!/fuck|chutiya|भोस/.test(out) && /shift assessment chut/.test(out), out);
  const cues = [{ text: "नमस्ते दोस्तों।", rom: "namaste doston." }, { text: "kya haal hai?", rom: null }];
  QCPolish.finishCues(cues, { reels: true, caps: true }, "hi");
  assert.strictEqual(cues[0].text, "नमस्ते दोस्तों"); assert.strictEqual(cues[0].rom, "NAMASTE DOSTON"); assert.strictEqual(cues[1].text, "kya haal hai?");
  assert.strictEqual(QCPolish.transcript([{ text: "a.", start: 0, end: 1 }, { text: "b", start: 1.2, end: 2 }, { text: "c", start: 4, end: 5 }], "hi"), "a. b\n\nc\n");
  console.log("ok  polish: fillers, bleep (both ड़ encodings), reels, caps, transcript paragraphs");
}

// Upload format: capture what transcribe() would send to Sarvam.
(async () => {
  const sent = [];
  global.fetch = async (url, init) => {
    sent.push({ url, init });
    return { ok: true, json: async () => fake };
  };
  const r = await QCSarvam.transcribe(wav(40), { apiKey: "test-key", model: "saaras:v4", language: "hi-IN" });
  assert.strictEqual(sent.length, 2, "40 s -> 2 requests");
  const req = sent[0];
  assert.strictEqual(req.url, "https://api.sarvam.ai/speech-to-text");
  assert.strictEqual(req.init.headers["api-subscription-key"], "test-key");
  assert(req.init.body instanceof ArrayBuffer, "body is ArrayBuffer (UXP-safe)");
  const boundary = req.init.headers["Content-Type"].split("boundary=")[1];
  const text = Buffer.from(req.init.body).toString("latin1");
  for (const f of ['name="model"\r\n\r\nsaaras:v4', 'name="with_timestamps"\r\n\r\ntrue', 'name="language_code"\r\n\r\nhi-IN', 'name="file"; filename="audio.wav"'])
    assert(text.includes(f), "multipart has " + f);
  assert(text.endsWith("\r\n--" + boundary + "--\r\n"), "closing boundary");
  const riff = text.indexOf("RIFF");
  assert(riff > 0 && text.slice(riff + 8, riff + 12) === "WAVE", "file part is a WAV");
  // sanity-check with a real multipart parser
  const parsed = await new Response(Buffer.from(req.init.body), { headers: { "Content-Type": req.init.headers["Content-Type"] } }).formData();
  assert.strictEqual(parsed.get("model"), "saaras:v4");
  assert.strictEqual(parsed.get("file").size, 28 * 16000 * 2 + 44, "full 28 s chunk uploaded");
  console.log("ok  upload: 2 requests, multipart parses cleanly, file =", parsed.get("file").size, "bytes");

  // Transliteration batch + fallback when line counts don't match
  sent.length = 0;
  global.fetch = async (url, init) => {
    const input = JSON.parse(init.body).input;
    sent.push(input);
    const out = input.includes("\n") ? "joined together without newlines" : "rom:" + input;
    return { ok: true, json: async () => ({ transliterated_text: out }) };
  };
  const cs = [{ text: "नमस्ते" }, { text: "दोस्तों" }];
  await QCSarvam.transliterateCues(cs, "k");
  assert.deepStrictEqual(cs.map(c => c.rom), ["rom:नमस्ते", "rom:दोस्तों"]);
  console.log("ok  transliteration falls back to per-caption when a batch doesn't split cleanly");

  // Modes + keyterms (UTF-8, v4 only) reach Sarvam correctly.
  sent.length = 0;
  global.fetch = async (url, init) => { sent.push(init); return { ok: true, json: async () => fake }; };
  await QCSarvam.transcribe(wav(5), { apiKey: "k", model: "saaras:v4", mode: "codemix", keyterms: ["QuickCaps", "बेंगलुरु"] });
  let form = await new Response(Buffer.from(sent[0].body), { headers: { "Content-Type": sent[0].headers["Content-Type"] } }).formData();
  assert.strictEqual(form.get("mode"), "codemix");
  assert.deepStrictEqual(JSON.parse(form.get("keyterms")), ["QuickCaps", "बेंगलुरु"], "Devanagari keyterm survives UTF-8 encoding");
  sent.length = 0;
  await QCSarvam.transcribe(wav(5), { apiKey: "k", model: "saaras:v3", mode: "transcribe", keyterms: ["QuickCaps"] });
  form = await new Response(Buffer.from(sent[0].body), { headers: { "Content-Type": sent[0].headers["Content-Type"] } }).formData();
  assert.strictEqual(form.get("mode"), null, "default mode not sent");
  assert.strictEqual(form.get("keyterms"), null, "keyterms dropped on v3");
  console.log("ok  mode + UTF-8 keyterms sent on v4; keyterms dropped on v3");

  // Host-provided fetch (CEP) is used when present.
  let hostCalls = 0;
  global.QCHost = { fetch: async () => { hostCalls++; return { ok: true, json: async () => fake }; } };
  await QCSarvam.transcribe(wav(5), { apiKey: "k" });
  assert.strictEqual(hostCalls, 1); delete global.QCHost;
  console.log("ok  QCHost.fetch takes over when provided");

  // sliceWav keeps exactly the requested span.
  const cut = QCSarvam.sliceWav(wav(70), 28.5, 40);
  const cutInfo = QCSarvam.chunkWav(cut);
  assert(Math.abs(cutInfo.duration - 11.5) < 0.001, "11.5 s slice, got " + cutInfo.duration);
  assert.strictEqual(QCSarvam.chunkWav(QCSarvam.sliceWav(wav(10), 8, 99)).duration, 2, "clamped to end");
  console.log("ok  sliceWav cuts 28.5–40 s to an 11.5 s WAV, clamps past the end");

  // Parallel: at most 3 in flight, results in order despite out-of-order replies, retries 429.
  {
    let inFlight = 0, peak = 0, calls = 0, failedOnce = false;
    global.fetch = async (url, init) => {
      calls++; inFlight++; peak = Math.max(peak, inFlight);
      const text = Buffer.from(init.body).toString("latin1");
      // each 28 s part of a 140 s file starts at a different byte offset; echo the part index back
      const idx = calls;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 25));
      inFlight--;
      if (idx === 2 && !failedOnce) { failedOnce = true; return { ok: false, status: 429, json: async () => ({}) }; }
      return { ok: true, json: async () => ({ transcript: "x", timestamps: { words: ["शब्द"], start_time_seconds: [1], end_time_seconds: [2] } }) };
    };
    const t0 = Date.now();
    const r = await QCSarvam.transcribe(wav(140), { apiKey: "k" });
    assert(peak <= 3 && peak >= 2, "peak concurrency " + peak);
    assert.strictEqual(r.words.length, 5, "one word per part, 5 parts");
    assert.deepStrictEqual(r.words.map((w) => Math.round(w.start)), [1, 29, 57, 85, 113], "parts stay in timeline order");
    assert(failedOnce && calls === 6, "429 retried once (6 calls for 5 parts), got " + calls);
    console.log("ok  3 parts in flight (peak " + peak + "), timeline order kept, 429 retried");
  }
  // A non-retryable error stops everything and surfaces.
  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "bad audio" } }) });
  await assert.rejects(QCSarvam.transcribe(wav(140), { apiKey: "k" }), (e) => e.status === 400 && /bad audio/.test(e.message));
  console.log("ok  400 is not retried and stops the run");

  // Error mapping
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "Invalid API key" } }) });
  await assert.rejects(QCSarvam.transcribe(wav(5), { apiKey: "bad" }), (e) => e.status === 403 && /API key/.test(e.message));
  console.log("ok  403 -> 'Sarvam rejected the API key' message");

  // Out of credit gets its own message, whatever the status code.
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "Insufficient credits" } }) });
  await assert.rejects(QCSarvam.transcribe(wav(5), { apiKey: "k" }), (e) => /credit has run out/.test(e.message));
  console.log("ok  out-of-credit error explains how to top up");

  // Pasted keys are cleaned; other providers' keys are recognised.
  assert.strictEqual(QCSettings.cleanKey(' "sk_abc123_XYZ"\n'), "sk_abc123_XYZ");
  assert.strictEqual(QCSettings.cleanKey("api-subscription-key: sk_abc"), "sk_abc");
  assert.strictEqual(QCSettings.cleanKey("Bearer sk_abc"), "sk_abc");
  assert(/OpenAI/.test(QCSettings.wrongKeyMessage("sk-proj-" + "a".repeat(40))));
  assert(/Anthropic/.test(QCSettings.wrongKeyMessage("sk-ant-api03-" + "a".repeat(40))));
  assert(/Gemini/.test(QCSettings.wrongKeyMessage("AIza" + "a".repeat(35))));
  assert.strictEqual(QCSettings.wrongKeyMessage("sk_abcd1234_" + "a".repeat(24)), null, "Sarvam-style key passes");
  console.log("ok  pasted keys cleaned; OpenAI/Claude/Gemini keys flagged");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
