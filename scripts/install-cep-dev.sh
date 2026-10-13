#!/bin/bash
# Installs the CEP build (Premiere Pro 2022+) on this Mac for testing.
#
#   bash scripts/install-cep-dev.sh            # build + install
#   bash scripts/install-cep-dev.sh --remove   # uninstall
#
# It links dist/cep into Adobe's extensions folder, so later rebuilds show
# up after reopening the panel. It also turns on CEP "debug mode", which
# lets Premiere load unsigned extensions (needed until we ship a signed
# .zxp). Turn it off again with --remove.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
LINK="$EXT_DIR/com.quickcaps.cep"
# Premiere 2022-2024 use CSXS 11, 2025-2026 use CSXS 12; 13 is future-proofing.
CSXS_VERSIONS="11 12 13"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$LINK"
  for v in $CSXS_VERSIONS; do defaults delete "com.adobe.CSXS.$v" PlayerDebugMode 2>/dev/null || true; done
  echo "Removed QuickCaps (CEP) and turned debug mode off. Restart Premiere."
  exit 0
fi

node "$ROOT/scripts/build.js" cep
mkdir -p "$EXT_DIR"
rm -f "$LINK"
ln -s "$ROOT/dist/cep" "$LINK"
for v in $CSXS_VERSIONS; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

echo
echo "Installed. Restart Premiere, then open QuickCaps from Window > Extensions"
echo "(newer versions may label that menu Extensions (Legacy))."
