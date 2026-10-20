#!/usr/bin/env node
/*
 * Assembles core/ + one host adapter into a flat, loadable plugin folder
 * (dist/<target>/) with manifest.json at its root — what you point the
 * UXP Developer Tool (or CEP loader) at.
 *
 * Usage: node scripts/build.js uxp
 */
const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!["uxp", "cep"].includes(target)) {
  console.error("Usage: node scripts/build.js <uxp|cep>");
  process.exit(1);
}

const root = path.join(__dirname, "..");
const hostDir = path.join(root, "hosts", target);
const outDir = path.join(root, "dist", target);

if (!fs.existsSync(hostDir)) {
  console.error("No host found at hosts/" + target);
  process.exit(1);
}

function copyDirIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyDirIfExists(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function copy(src, destName) {
  fs.copyFileSync(src, path.join(outDir, destName));
}

// Core logic, flattened alongside the host adapter (plugin sandboxes
// can't reach outside their own folder).
copy(path.join(root, "core", "srt.js"), "srt.js");
copy(path.join(root, "core", "cues.js"), "cues.js");
copy(path.join(root, "core", "sarvam.js"), "sarvam.js");
copy(path.join(root, "core", "settings.js"), "settings.js");
copy(path.join(root, "core", "polish.js"), "polish.js");
copy(path.join(root, "core", "langs.js"), "langs.js");
copy(path.join(root, "core", "numbers.js"), "numbers.js");
copy(path.join(root, "core", "updates.js"), "updates.js");
copy(path.join(root, "core", "styles.js"), "styles.js");
copy(path.join(root, "core", "ui", "styles.css"), "styles.css");
copy(path.join(root, "core", "ui", "app.js"), "app.js");

// Host-specific glue (manifest, adapter, and anything else in hosts/<target>).
for (const f of fs.readdirSync(hostDir)) {
  const full = path.join(hostDir, f);
  if (fs.statSync(full).isDirectory()) copyDirIfExists(full, path.join(outDir, f));
  else copy(full, f);
}

// Bundled export preset(s).
copyDirIfExists(path.join(root, "presets"), path.join(outDir, "presets"));

// index.html: same markup as the browser dev preview, with script tags
// flattened (no "../" or "?v=" cache-busting — those only make sense
// for the local http-server preview).
let html = fs.readFileSync(path.join(root, "core", "ui", "index.html"), "utf8");
html = html
  .replace(/<script src="(?:\.\.\/)?([\w.-]+\.js)(?:\?v=\d+)?"><\/script>/g, '<script src="$1"></script>')
  .replace(/href="styles\.css\?v=\d+"/, 'href="styles.css"');
fs.writeFileSync(path.join(outDir, "index.html"), html);

console.log("Built " + target + " plugin -> dist/" + target);
if (target === "uxp") {
  console.log('Open the UXP Developer Tool -> "Add Plugin" -> select the dist/uxp folder.');
}
