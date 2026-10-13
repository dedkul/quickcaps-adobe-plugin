/*
 * UXP host adapter for Premiere Pro 2026+ (25.6+) — implements the
 * QCHost interface (see core/ui/adapter.js for the mock reference)
 * against the real Premiere UXP API.
 *
 * Verified against Adobe's official docs (github.com/AdobeDocs/uxp-premiere-pro,
 * ppro-reference/classes/*.md) as of Premiere 26.3. One known API gap:
 * there is no call to programmatically create a caption track from an
 * imported file — Sequence only exposes getCaptionTrack/getCaptionTrackCount
 * to read existing tracks, and overwriting the imported item onto the
 * sequence doesn't create one either (tried in Premiere). So
 * placeCaptions() imports the SRT into the Project panel and the user
 * drags it onto the sequence.
 */
(function () {
  const app = require("premierepro");
  const { localFileSystem, formats } = require("uxp").storage;
  const os = require("os");

  function joinPath(dir, name) {
    const sep = os.platform() === "win32" ? "\\" : "/";
    return dir.endsWith(sep) ? dir + name : dir + sep + name;
  }

  async function resolvePresetPath() {
    try {
      const entry = await localFileSystem.getEntryWithUrl("plugin:/presets/audio-wav.epr");
      return entry.nativePath;
    } catch (e) {
      throw new Error(
        "Missing presets/audio-wav.epr — see the README to create this export preset once in Premiere."
      );
    }
  }

  async function replaceFile(folder, name, write) {
    try {
      const old = await folder.getEntry(name);
      await old.delete();
    } catch (e) {
      /* nothing to clean up */
    }
    const file = await folder.createFile(name, { overwrite: true });
    if (write) await write(file);
    return file;
  }

  async function requireSequence() {
    const project = await app.Project.getActiveProject();
    if (!project) throw new Error("No project open in Premiere.");
    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("No sequence open — open one in Premiere first.");
    return { project: project, sequence: sequence };
  }

  window.QCHost = {
    mock: false,
    name: "uxp",
    pluginVersion: require("uxp").versions.plugin,

    async getSequenceInfo() {
      const ctx = await requireSequence();
      const seq = ctx.sequence;
      const endTime = await seq.getEndTime();
      const selection = await seq.getSelection();
      const items = await selection.getTrackItems();
      // Lengths for the cost estimate on the main screen.
      const inPoint = await seq.getInPoint();
      const outPoint = await seq.getOutPoint();
      let selectionSeconds = 0;
      if (items.length) {
        const starts = await Promise.all(items.map(function (i) { return i.getStartTime(); }));
        const ends = await Promise.all(items.map(function (i) { return i.getEndTime(); }));
        selectionSeconds = Math.max.apply(null, ends.map(function (t) { return t.seconds; })) -
          Math.min.apply(null, starts.map(function (t) { return t.seconds; }));
      }
      return {
        name: seq.name,
        durationSeconds: endTime.seconds,
        hasInOut: true,
        selectedAudioClips: items.length,
        supportsClipScope: true,
        inOutSeconds: Math.max(0, outPoint.seconds - inPoint.seconds),
        selectionSeconds: selectionSeconds,
      };
    },

    async exportAudio(scope, onStatus) {
      const ctx = await requireSequence();
      const project = ctx.project;
      const sequence = ctx.sequence;

      const presetPath = await resolvePresetPath();
      const tempFolder = await localFileSystem.getEntryWithUrl("plugin-temp:/");
      const outputName = "quickcaps-export.wav";
      try {
        const old = await tempFolder.getEntry(outputName);
        await old.delete();
      } catch (e) {
        /* nothing to clean up */
      }
      const outputPath = joinPath(tempFolder.nativePath, outputName);

      if (onStatus) onStatus("Rendering audio from Premiere…");

      // Where the exported audio begins on the timeline, so captions can
      // be timed to sequence timecodes rather than to the audio file.
      let startSeconds = 0;
      if (scope === "inout") startSeconds = (await sequence.getInPoint()).seconds;

      // "clips" scope has no direct export param, so we bound it by
      // temporarily moving the sequence in/out points around the
      // selected items, then always restoring them afterwards.
      let restoreInOut = null;
      if (scope === "clips") {
        const selection = await sequence.getSelection();
        const items = await selection.getTrackItems();
        if (!items.length) throw new Error("Select one or more clips on the timeline first.");
        const starts = await Promise.all(items.map((i) => i.getStartTime()));
        const ends = await Promise.all(items.map((i) => i.getEndTime()));
        const minStart = starts.reduce((a, b) => (a.ticksNumber < b.ticksNumber ? a : b));
        const maxEnd = ends.reduce((a, b) => (a.ticksNumber > b.ticksNumber ? a : b));
        startSeconds = minStart.seconds;
        const origIn = await sequence.getInPoint();
        const origOut = await sequence.getOutPoint();
        restoreInOut = function () {
          return project.executeTransaction(function (c) {
            c.addAction(sequence.createSetInPointAction(origIn));
            c.addAction(sequence.createSetOutPointAction(origOut));
          }, "QuickCaps: restore in/out");
        };
        project.executeTransaction(function (c) {
          c.addAction(sequence.createSetInPointAction(minStart));
          c.addAction(sequence.createSetOutPointAction(maxEnd));
        }, "QuickCaps: set export range");
      }

      // "sequence" scope exports the full timeline regardless of in/out;
      // "inout" and "clips" both rely on the (real or temporary) in/out points.
      const exportFull = scope === "sequence";
      try {
        const ok = await app.EncoderManager.getManager().exportSequence(
          sequence,
          app.Constants.ExportType.IMMEDIATELY,
          outputPath,
          presetPath,
          exportFull
        );
        if (!ok) throw new Error("Premiere couldn't export the audio. Check the export preset and try again.");
      } finally {
        if (restoreInOut) restoreInOut();
      }

      const wavFile = await tempFolder.getEntry(outputName);
      const wavBuffer = await wavFile.read({ format: formats.binary });
      return { wavBuffer: wavBuffer, startSeconds: startSeconds };
    },

    /*
     * srtText is timed to sequence time (cue 1 at its real timecode), so the
     * imported caption item belongs at the very start of the sequence.
     *
     * Premiere's UXP API can't place a caption item on a caption track
     * (tested: createOverwriteItemAction doesn't produce one), so this only
     * imports; the user does the final drag. Files live in the plugin's data
     * folder so the imported item never goes offline.
     */
    // tracks: [{label, srt}] -> one result per track, same order.
    async placeCaptions(tracks, sequenceName) {
      const project = await app.Project.getActiveProject();
      if (!project) throw new Error("No project open in Premiere.");

      const dataFolder = await localFileSystem.getEntryWithUrl("plugin-data:/");
      const targetBin = await project.getInsertionBin();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      const base = "QuickCaps " + (sequenceName || "captions").replace(/[^\w\u0900-\u097F -]+/g, "_");
      const results = [];
      for (const t of tracks) {
        const name = base + " " + t.label + " " + stamp + ".srt";
        const srtFile = await replaceFile(dataFolder, name, function (f) {
          return f.write(t.srt);
        });
        const ok = await project.importFiles([srtFile.nativePath], true, targetBin, false);
        if (!ok) throw new Error("Premiere could not import the caption file.");
        results.push({ placed: false, itemName: name });
      }
      return results;
    },

    async saveSrt(srtText, suggestedName) {
      const dataFolder = await localFileSystem.getEntryWithUrl("plugin-data:/");
      const file = await replaceFile(dataFolder, suggestedName || "captions.srt", function (f) {
        return f.write(srtText);
      });
      return { ok: true, path: file.nativePath };
    },
  };
})();
