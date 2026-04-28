#!/usr/bin/env bash
# I-NO-INLINE-MAP-IN-APPCONTENT — ORCH-0679 Wave 2.7 invariant.
#
# Detects unmemoized inline `.map()` / `.filter()` declarations inside
# AppContent body in app/index.tsx. These rebuild fresh arrays every render,
# busting React.memo barriers on any consumer.
#
# This gate exists because Wave 2 + Wave 2.5 + Wave 2.6 all missed the
# `availableFriendsForSessions` inline `.map()` at line 1009 — the diagnostic
# audit (INVESTIGATION_ORCH-0679_WAVE2_DIAG_AUDIT.md) caught it as the second
# root cause of the post-Wave-2 render storm.
#
# Region scope: lines 144-2700 (AppContent body). Excludes JSX render block
# inside the return statement (which has many legitimate .map() calls in JSX).
# Adjust the upper bound if AppContent body grows.
#
# Whitelist: add `// inline-OK: <reason>` on the same line for genuinely
# unavoidable cases.
#
# Negative-control: temporarily insert `const x = [].map(y => y);` at line 200
# of app/index.tsx → run this gate → exit 1 → revert → exit 0.
set -e

VIOLATIONS=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_FILE="$APP_ROOT/app/index.tsx"

if [ ! -f "$TARGET_FILE" ]; then
  echo "ERROR: $TARGET_FILE not found"
  exit 1
fi

# Match `const X = (any).map(` or `const X = (any).filter(` declarations
# at the top-level body indentation (^  const), where the line does NOT
# contain `useMemo` (which would indicate it IS already wrapped).
MAP_VIOLATIONS=$(awk '
  NR>=144 && NR<=2700 && /inline-OK:/ { next }
  NR>=144 && NR<=2700 && /useMemo/ { next }
  NR>=144 && NR<=2700 && /^  const .* = .*\.map\(/ {
    print FILENAME ":" NR ": " $0
  }
  NR>=144 && NR<=2700 && /^  const .* = .*\.filter\(/ {
    print FILENAME ":" NR ": " $0
  }
' "$TARGET_FILE")

if [ -n "$MAP_VIOLATIONS" ]; then
  echo "I-NO-INLINE-MAP-IN-APPCONTENT violation(s):"
  echo "$MAP_VIOLATIONS"
  echo ""
  echo "These inline .map()/.filter() declarations rebuild a fresh array every"
  echo "render, busting React.memo barriers on any consumer (e.g., the 6 tabs)."
  echo ""
  echo "Fix: wrap in useMemo with appropriate deps:"
  echo "  const result = useMemo(() => array.map(...), [array]);"
  echo ""
  echo "If genuinely unavoidable, add inline comment:"
  echo "  // inline-OK: <reason>"
  exit 1
fi

echo "I-NO-INLINE-MAP-IN-APPCONTENT: PASS"
exit 0
