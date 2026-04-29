#!/usr/bin/env bash
# I-HOOKS-ABOVE-EARLY-RETURNS — ORCH-0679 Wave 2.6 invariant.
#
# Fails if `react-hooks/rules-of-hooks` ESLint rule reports any errors. This
# rule catches hooks called inside conditionals/loops AND hooks that may be
# skipped in some renders (e.g., placed after early returns) — the exact bug
# class that caused Wave 2's runtime crash on first dev-client cold start.
#
# Negative-control: temporarily insert `useMemo(() => 1, [])` after the
# `if (!_hasHydrated || isLoadingAuth) return ...` early return in
# app/index.tsx → run this gate → expect exit 1 with "React Hook" reference
# → revert → expect exit 0.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Run ESLint on Wave 2/2.5/2.6 surface area only — the files this wave touched
# OR is responsible for. Pre-existing violations in unmodified files (e.g.,
# PopularityIndicators.tsx — D-WAVE2.6-IMPL-1) are out of scope for this gate;
# they'll be fixed in their own separate ORCH dispatch.
RAW_OUTPUT=$(cd "$APP_ROOT" && npx eslint \
  app/index.tsx \
  app/_layout.tsx \
  src/components/HomePage.tsx \
  src/components/DiscoverScreen.tsx \
  src/components/ConnectionsPage.tsx \
  src/components/SavedExperiencesPage.tsx \
  src/components/LikesPage.tsx \
  src/components/ProfilePage.tsx \
  src/components/MobileFeaturesProvider.tsx \
  src/contexts/NavigationContext.tsx \
  src/contexts/CoachMarkContext.tsx \
  --rule '{"react-hooks/rules-of-hooks": "error"}' \
  --no-warn-ignored \
  2>&1 || true)

# Count error lines that mention rules-of-hooks
HOOK_ERRORS=$(echo "$RAW_OUTPUT" | grep -E "error.*react-hooks/rules-of-hooks" || true)

if [ -n "$HOOK_ERRORS" ]; then
  echo "I-HOOKS-ABOVE-EARLY-RETURNS violation:"
  echo "$HOOK_ERRORS"
  echo ""
  echo "React Hook(s) called conditionally OR after early returns. This causes"
  echo "'Rendered more hooks than during the previous render' at runtime when"
  echo "the early-return guard becomes false on a later render."
  echo ""
  echo "Fix: move the hook(s) ABOVE all early returns in the component body."
  exit 1
fi

echo "I-HOOKS-ABOVE-EARLY-RETURNS: PASS"
exit 0
