#!/usr/bin/env bash
# I-LOCALES-LAZY-LOAD — ORCH-0675 Wave 1 RC-2 protection.
#
# Only the 'en' locale (23 namespaces) may be statically imported in
# src/i18n/index.ts. All other 28 languages MUST be loaded via dynamic import()
# in the localeLoaders map.
#
# Why: static eager-load of 667 locale JSONs adds ~200-500ms to cold-start
# parse on lower-tier ARM CPUs. Lazy-load defers cost to language-switch event.
#
# Negative-control: inject `import fr_common from './locales/fr/common.json';`
# into i18n/index.ts → run this script → exit 1 → revert → exit 0.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
I18N_FILE="$APP_ROOT/src/i18n/index.ts"

if [ ! -f "$I18N_FILE" ]; then
  echo "I-LOCALES-LAZY-LOAD: ERROR — $I18N_FILE not found"
  exit 1
fi

# Count static `import .* from './locales/<lang>/...'` lines
STATIC_IMPORTS=$(grep -cE "^import .* from '\./locales/" "$I18N_FILE" || echo 0)
EN_IMPORTS=$(grep -cE "^import .* from '\./locales/en/" "$I18N_FILE" || echo 0)

# Total static must equal en imports (only en is allowed eager).
# en must be exactly 23 namespaces.
if [ "$STATIC_IMPORTS" -ne "$EN_IMPORTS" ]; then
  NON_EN=$((STATIC_IMPORTS - EN_IMPORTS))
  echo "I-LOCALES-LAZY-LOAD violation: $NON_EN non-en static locale import(s) in $I18N_FILE."
  echo "Only 'en' locale may be statically imported. All others MUST use dynamic import()."
  echo ""
  echo "Offending lines:"
  grep -nE "^import .* from '\./locales/" "$I18N_FILE" | grep -v "/en/" | head -10
  exit 1
fi

if [ "$EN_IMPORTS" -ne 23 ]; then
  echo "I-LOCALES-LAZY-LOAD violation: en has $EN_IMPORTS static imports (expected exactly 23 namespaces)."
  echo "Mingla i18n requires all 23 namespaces eager for the active locale."
  exit 1
fi

# Verify localeLoaders map has 28 entries (one per non-en language).
# Pattern: `<lang_code>: async () =>`
LOADER_COUNT=$(grep -cE "^[[:space:]]+[a-z]{2,3}: async \(\) =>" "$I18N_FILE" || echo 0)
if [ "$LOADER_COUNT" -lt 28 ]; then
  echo "I-LOCALES-LAZY-LOAD violation: only $LOADER_COUNT lazy loaders found (expected 28)."
  echo "Mingla supports 29 locales; en is eager, the other 28 MUST be in localeLoaders map."
  exit 1
fi

echo "I-LOCALES-LAZY-LOAD: PASS ($EN_IMPORTS static en imports, $LOADER_COUNT lazy loaders)"
exit 0
