#!/bin/bash
# Builds the downloadable package for Premiere Pro 2022-2025 (Mac and Windows):
#
#   bash scripts/package.sh
#
# Output: release/QuickCaps-Premiere-2022-2025.zxp
#
# File names carry no version number, so the website's "latest release"
# download links keep working. The version lives in the GitHub release tag.
#
# The 2026 version (.ccx) is made in the UXP Developer Tool: ••• → Package.
#
# Signing uses a self-signed certificate kept in signing/. Keep that folder
# private and keep using the same certificate for updates.
# Per Adobe's 2024 known issue: no symlinks or .DS_Store files in the
# package. Adobe also suggests signing on each platform; this Mac-signed
# build was tested and works on Windows.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGN="$ROOT/tools/ZXPSignCmd"
CERT_DIR="$ROOT/signing"
CERT="$CERT_DIR/quickcaps.p12"
PASS_FILE="$CERT_DIR/password.txt"

[ -x "$SIGN" ] || { echo "Missing tools/ZXPSignCmd (Adobe's signing tool)."; exit 1; }

VERSION=$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$ROOT/hosts/cep/CSXS/manifest.xml")
OUT="$ROOT/release/QuickCaps-Premiere-2022-2025.zxp"

# One certificate for the life of the plugin (10 years).
if [ ! -f "$CERT" ]; then
  mkdir -p "$CERT_DIR"
  chmod 700 "$CERT_DIR"
  openssl rand -hex 16 > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
  "$SIGN" -selfSignedCert IN India QuickCaps QuickCaps "$(cat "$PASS_FILE")" "$CERT" -validityDays 3650
  echo "Created signing certificate in signing/ (keep it private, reuse it for updates)."
fi

node "$ROOT/scripts/build.js" cep >/dev/null

# Clean copy: real files only, no dev debug file, no Finder metadata.
STAGE="$(mktemp -d)/QuickCaps"
cp -RL "$ROOT/dist/cep" "$STAGE"
rm -f "$STAGE/.debug"
find "$STAGE" -name ".DS_Store" -delete
if [ -n "$(find "$STAGE" -type l)" ]; then echo "Symlink found in package; aborting."; exit 1; fi

mkdir -p "$ROOT/release"
rm -f "$OUT"
"$SIGN" -sign "$STAGE" "$OUT" "$CERT" "$(cat "$PASS_FILE")" -tsa http://timestamp.digicert.com
"$SIGN" -verify "$OUT"
rm -rf "$(dirname "$STAGE")"

echo
echo "Done: release/$(basename "$OUT") (version $VERSION)"
echo "Upload it to a GitHub release tagged v$VERSION."
