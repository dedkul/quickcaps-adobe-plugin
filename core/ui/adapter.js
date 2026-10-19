/*
 * Browser mock adapter — lets the whole panel run in a normal browser with
 * canned data, so the flow can be reviewed without Premiere or a Sarvam key.
 *
 * The build script replaces this file with hosts/uxp/adapter.js or
 * hosts/cep/adapter.js. Every adapter implements the same interface:
 *   mock:boolean, getSequenceInfo, exportAudio, placeCaptions, saveSrt,
 *   openUrl
 *
 * Preview the "new version" bar with ?update=demo (pretends to be v0.9.0
 * and that GitHub has v0.10.0).
 */
window.QCHost = (function () {
  // [Devanagari, roman] word pairs, aligned one-to-one.
  const SCRIPT = [
    ["नमस्ते", "namaste"], ["दोस्तों,", "doston,"], ["आज", "aaj"], ["हम", "hum"],
    ["बात", "baat"], ["करेंगे", "karenge"], ["एक", "ek"], ["ऐसे", "aise"],
    ["टूल", "tool"], ["के", "ke"], ["बारे", "baare"], ["में", "mein"],
    ["जो", "jo"], ["आपका", "aapka"], ["घंटों", "ghanton"], ["का", "ka"],
    ["काम", "kaam"], ["मिनटों", "minton"], ["में", "mein"], ["कर", "kar"],
    ["देगा।", "dega."],
    ["वीडियो", "video"], ["एडिटिंग", "editing"], ["में", "mein"], ["सबसे", "sabse"],
    ["बोरिंग", "boring"], ["काम", "kaam"], ["होता", "hota"], ["है", "hai"],
    ["कैप्शन", "caption"], ["लगाना।", "lagana."],
    ["हर", "har"], ["लाइन", "line"], ["को", "ko"], ["सुनकर", "sunkar"],
    ["टाइप", "type"], ["करना", "karna"], ["पड़ता", "padta"], ["है।", "hai."],
    ["लेकिन", "lekin"], ["अब", "ab"], ["ये", "ye"], ["सब", "sab"],
    ["अपने", "apne"], ["आप", "aap"], ["हो", "ho"], ["जाएगा।", "jaayega."],
    ["बस", "bas"], ["एक", "ek"], ["बटन", "button"], ["दबाइए", "dabaiye"],
    ["और", "aur"], ["देखिए", "dekhiye"], ["कमाल।", "kamaal."],
    ["आपकी", "aapki"], ["टाइमलाइन", "timeline"], ["पर", "par"], ["कैप्शन", "caption"],
    ["तैयार", "taiyaar"], ["मिलेंगे।", "milenge."],
    ["चलिए", "chaliye"], ["शुरू", "shuru"], ["करते", "karte"], ["हैं।", "hain."],
  ];

  // What Sarvam's "codemix" mode does: English words stay in English.
  const CODEMIX = {
    "टूल": "tool", "मिनटों": "minutes", "वीडियो": "video", "एडिटिंग": "editing",
    "बोरिंग": "boring", "कैप्शन": "captions", "लाइन": "line", "टाइप": "type",
    "बटन": "button", "टाइमलाइन": "timeline",
  };
  // "translate" mode: English sentences, roughly the same timing.
  const ENGLISH = "Hello friends, today we'll talk about a tool that turns hours of work into minutes. " +
    "The most boring part of video editing is adding captions. You have to listen to every line and type it. " +
    "But now it all happens on its own. Just press one button and see the magic. " +
    "Your captions will be ready on the timeline. Let's get started.";

  function timed(texts) {
    let t = 0.4;
    return texts.map(function (text) {
      const dur = 0.22 + text.length * 0.055;
      const w = { text: text, start: t, end: t + dur };
      t += dur + (/[।.!?]$/.test(text) ? 0.7 : 0.12);
      return w;
    });
  }

  function mockWords(mode) {
    if (mode === "translate") return timed(ENGLISH.split(" "));
    return timed(SCRIPT.map(function (pair) {
      if (mode === "translit") return pair[1];
      if (mode === "codemix") return CODEMIX[pair[0]] || pair[0];
      return pair[0];
    }));
  }

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  const updateDemo = /update=demo/.test(location.search);
  if (updateDemo) {
    try {
      // Start each demo from a fresh daily check.
      const s = JSON.parse(localStorage.getItem("quickcaps.settings") || "{}");
      delete s.update;
      localStorage.setItem("quickcaps.settings", JSON.stringify(s));
    } catch (e) {
      /* no storage: the demo still works for this load */
    }
  }

  return {
    mock: true,
    name: "browser-mock",
    // Preview the CEP build's one-click placement with ?host=cep
    placesOnTimeline: /host=cep/.test(location.search),
    pluginVersion: updateDemo ? "0.9.0" : undefined,
    fetch: updateDemo
      ? async function () {
        return { ok: true, status: 200, json: async function () {
          return { tag_name: "v0.10.0", html_url: "https://github.com/dedkul/quickcaps-adobe-plugin/releases/latest" };
        } };
      }
      : undefined,

    openUrl: async function (url) {
      window.open(url, "_blank");
    },

    getSequenceInfo: async function () {
      return {
        name: "Sequence 01",
        durationSeconds: 272,
        hasInOut: true,
        selectedAudioClips: 2,
        supportsClipScope: true,
        inOutSeconds: 34,
        selectionSeconds: 21,
      };
    },

    exportAudio: async function (scope, onStatus) {
      if (onStatus) onStatus("Rendering audio from " + scope + "…");
      await delay(1200);
      // Pretend In point at 0:12.5 and first selected clip at 0:31, so the
      // preview shows sequence-timed captions like the real host.
      const startSeconds = scope === "inout" ? 12.5 : scope === "clips" ? 31 : 0;
      return { mockWords: true, seconds: 34, startSeconds: startSeconds };
    },

    mockTranscribe: async function (onProgress, mode) {
      for (let i = 1; i <= 3; i++) {
        await delay(700);
        if (onProgress) onProgress(i, 3);
      }
      return mockWords(mode);
    },

    // tracks: [{label, srt}] -> one result per track, same order.
    placeCaptions: async function (tracks, sequenceName) {
      await delay(900);
      const placed = this.placesOnTimeline;
      return tracks.map(function (t) {
        console.log("[mock] " + (placed ? "placed" : "imported") + " " + t.label + " captions on '" + sequenceName + "':\n" + t.srt);
        return { placed: placed, itemName: "QuickCaps " + sequenceName + " " + t.label + ".srt" };
      });
    },

    saveSrt: async function (srtText, suggestedName) {
      const blob = new Blob([srtText], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = suggestedName || "captions.srt";
      a.click();
      URL.revokeObjectURL(a.href);
      return { ok: true };
    },
  };
})();
