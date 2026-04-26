#!/usr/bin/env bash
# I-TAB-PROPS-STABLE — ORCH-0679 Wave 2A invariant.
#
# Fails if inline arrow functions OR inline object literals appear within the
# 6-tab JSX region of app/index.tsx (lines 2486-2602). Inline props bust the
# React.memo barriers on each tab, recreating the render-storm bug that this
# wave fixed.
#
# Allowed patterns inside the region:
#   - prop={someStableRef}              ← useCallback/useMemo result, OK
#   - prop={primitive}                  ← string/number/boolean, OK
#   - prop={obj.field}                  ← member access, OK (parent-stable assumed)
#
# Forbidden patterns (will fail this gate):
#   - prop={() => ...}                  ← inline arrow fn
#   - prop={async () => ...}            ← inline async arrow fn
#   - prop={{ ... }}                    ← inline object literal
#
# Whitelist: add `// inline-OK: <reason>` on the same line for genuinely
# unavoidable cases (none expected — all hoists are documented in spec §2.A.1).
#
# Negative-control: temporarily insert `onTest={() => null}` at line 2500 →
# run this script → exit 1 with named invariant in output → revert → exit 0.
set -e

VIOLATIONS=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_FILE="$APP_ROOT/app/index.tsx"

if [ ! -f "$TARGET_FILE" ]; then
  echo "ERROR: $TARGET_FILE not found"
  exit 1
fi

# Region-scoped check: lines 2529-2645 (the 6-tab JSX block — Wave 2.6 shifted bounds).
# Match `={() =>`, `={async () =>`, OR `={{` (inline object literal).
INLINE_VIOLATIONS=$(awk '
  NR>=2529 && NR<=2645 && /inline-OK:/ { next }
  NR>=2529 && NR<=2645 && (/={\(\) =>/ || /={async \(\) =>/ || /={\(.*\) =>/ || /={{/) {
    print FILENAME ":" NR ": " $0
  }
' "$TARGET_FILE")

if [ -n "$INLINE_VIOLATIONS" ]; then
  echo "I-TAB-PROPS-STABLE violation in app/index.tsx tab JSX region (lines 2486-2602):"
  echo "$INLINE_VIOLATIONS"
  echo ""
  echo "Inline arrow functions and object literals bust React.memo on tab screens."
  echo "Hoist to useCallback/useMemo at the top of AppContent (see spec §2.A.1)."
  echo ""
  echo "If genuinely unavoidable, add inline comment:"
  echo "  // inline-OK: <reason>"
  exit 1
fi

echo "I-TAB-PROPS-STABLE: PASS"
exit 0
