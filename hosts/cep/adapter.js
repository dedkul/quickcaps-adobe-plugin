/*
 * CEP host adapter for Premiere Pro 2022–2025 (and 2026 while it still
 * loads CEP panels). Implements the QCHost interface used by core/ui/app.js;
 * see core/ui/adapter.js for the reference mock.
 *
 * Premiere is driven through ExtendScript (host.jsx) via evalScript. Files
 * and Sarvam requests go through Node.js (enabled in CSXS/manifest.xml):
 * Node reads the exported WAV efficiently and isn't subject to browser CORS.
 *
 * Unlike UXP, ExtendScript can create a caption track from an SRT, so here
 * "Add to timeline" really places the captions.
 */
(function () {
  const cep = window.__adobe_cep__;
  const nodeRequire = (window.cep_node && window.cep_node.require) || window.require;
  const fs = nodeRequire("fs");
  const path = nodeRequire("path");
  const os = nodeRequire("os");
  const https = nodeRequire("https");
  const Buffer = nodeRequire("buffer").Buffer;

  // Same conversion CSInterface.getSystemPath does, without bundling it.
  function systemPath(type) {
    let p = decodeURI(cep.getSystemPath(type));
    if (/^win/i.test(navigator.platform)) p = p.replace("file:///", "");
    else p = p.replace("file://", "");
    return p;
  }

  const EXT_DIR = systemPath("extension");
  const DATA_DIR = path.join(systemPath("userData"), "QuickCaps");

  function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Calls a host.jsx function with JSON-encoded args; host functions always
  // return JSON, with {"error": "..."} on failure.
  function callHost(fn, args) {
    const script = fn + "(" + (args || []).map(function (a) { return JSON.stringify(a); }).join(",") + ")";
    return new Promise(function (resolve, reject) {
      cep.evalScript(script, function (raw) {
        let res;
        try {
          res = JSON.parse(raw);
        } catch (e) {
          reject(new Error("Premiere scripting error" + (raw ? ": " + raw : "") + ". Try reopening the panel."));
          return;
        }
        if (res && res.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
  }

  // fetch-compatible subset over Node https: method, headers, body
  // (string or ArrayBuffer); response has ok, status, json(), text().
  function nodeFetch(url, init) {
    init = init || {};
    return new Promise(function (resolve, reject) {
      const u = new URL(url);
      const body = init.body == null ? null
        : typeof init.body === "string" ? Buffer.from(init.body, "utf8")
        : Buffer.from(new Uint8Array(init.body));
      const headers = Object.assign({}, init.headers || {});
      if (body) headers["Content-Length"] = String(body.length);
      const req = https.request({
        method: init.method || "GET",
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: headers,
      }, function (res) {
        const chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: function () { return Promise.resolve(text); },
            json: function () {
              try {
                return Promise.resolve(JSON.parse(text));
              } catch (e) {
                return Promise.reject(e);
              }
            },
          });
        });
      });
      req.on("error", reject);
      req.setTimeout(120000, function () { req.destroy(new Error("Request timed out")); });
      if (body) req.write(body);
      req.end();
    });
  }

  function readPluginVersion() {
    try {
      const xml = fs.readFileSync(path.join(EXT_DIR, "CSXS", "manifest.xml"), "utf8");
      const m = xml.match(/ExtensionBundleVersion="([^"]+)"/);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  function safeName(s) {
    // ASCII-only file names: older ExtendScript import on Windows is
    // unreliable with non-ASCII paths.
    return String(s || "captions").replace(/[^\w -]+/g, "_").trim() || "captions";
  }

  window.QCHost = {
    mock: false,
    name: "cep",
    pluginVersion: readPluginVersion(),
    placesOnTimeline: true,
    fetch: nodeFetch,

    async getSequenceInfo() {
      return callHost("qc_sequenceInfo");
    },

    async exportAudio(scope, onStatus) {
      if (onStatus) onStatus("Rendering audio from Premiere…");
      const out = path.join(os.tmpdir(), "quickcaps-export.wav");
      const preset = path.join(EXT_DIR, "presets", "audio-wav.epr");
      const res = await callHost("qc_exportAudio", [scope, out, preset]);
      const data = fs.readFileSync(out);
      let wav = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      // "Selected clips": the host rendered the whole sequence; keep the
      // selection's span only (In/Out marks are never changed).
      if (res.endSeconds != null) wav = QCSarvam.sliceWav(wav, res.startSeconds, res.endSeconds);
      try {
        fs.unlinkSync(out);
      } catch (e) {
        /* temp file; fine to leave */
      }
      return { wavBuffer: wav, startSeconds: res.startSeconds || 0 };
    },

    // tracks: [{label, srt}] -> one result per track, same order. SRTs are
    // timed to sequence time; host.jsx puts each on its own caption track.
    async placeCaptions(tracks, sequenceName) {
      const dir = path.join(DATA_DIR, "captions");
      ensureDir(dir);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      const results = [];
      for (const t of tracks) {
        const name = "QuickCaps " + safeName(sequenceName) + " " + safeName(t.label === "English" ? "English" : "main") + " " + stamp + ".srt";
        const file = path.join(dir, name);
        fs.writeFileSync(file, t.srt, "utf8");
        results.push(await callHost("qc_addCaptions", [file, name]));
      }
      return results;
    },

    // CEP's own call opens the default browser (a plain link would open
    // inside the panel).
    async openUrl(url) {
      if (!window.cep || !window.cep.util || !window.cep.util.openURLInDefaultBrowser) {
        throw new Error("No browser opener in this Premiere version");
      }
      window.cep.util.openURLInDefaultBrowser(url);
    },

    async saveSrt(srtText, suggestedName) {
      let target = null;
      try {
        const res = window.cep.fs.showSaveDialogEx(
          "Save", path.join(os.homedir(), "Desktop"), [path.extname(suggestedName).slice(1) || "srt"], suggestedName
        );
        if (res && res.err === 0) {
          if (!res.data) return { ok: false, cancelled: true };
          target = res.data;
        }
      } catch (e) {
        /* no native dialog: fall back to the Desktop */
      }
      if (!target) target = path.join(os.homedir(), "Desktop", suggestedName);
      const ext = path.extname(suggestedName) || ".srt";
      if (path.extname(target).toLowerCase() !== ext.toLowerCase()) target += ext;
      fs.writeFileSync(target, srtText, "utf8");
      return { ok: true, path: target };
    },
  };
})();
