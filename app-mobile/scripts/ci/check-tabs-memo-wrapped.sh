#!/usr/bin/env bash
# I-TAB-SCREENS-MEMOIZED — ORCH-0679 Wave 2A invariant.
#
# Fails if any of the 6 tab screen files is missing `React.memo(...)` on its
# default export. Without memo, hidden tabs re-render on every parent state
# change, even when their props haven't changed.
#
# Negative-control: change `export default React.memo(HomePage);` to
# `export default HomePage;` → run this script → exit 1 → revert → exit 0.
set -e

VIOLATIONS=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Map of file → component name (for the React.memo check)
declare -A TABS=(
  ["src/components/HomePage.tsx"]="HomePage"
  ["src/components/DiscoverScreen.tsx"]="DiscoverScreen"
  ["src/components/ConnectionsPage.tsx"]="ConnectionsPageRefactored"
  ["src/components/SavedExperiencesPage.tsx"]="SavedExperiencesPage"
  ["src/components/LikesPage.tsx"]="LikesPage"
  ["src/components/ProfilePage.tsx"]="ProfilePage"
)

for FILE in "${!TABS[@]}"; do
  FULL_PATH="$APP_ROOT/$FILE"
  COMP="${TABS[$FILE]}"
  if [ ! -f "$FULL_PATH" ]; then
    echo "ERROR: $FULL_PATH not found"
    VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi
  if ! grep -q "export default React\.memo($COMP)" "$FULL_PATH"; then
    echo "I-TAB-SCREENS-MEMOIZED violation: $FILE missing 'export default React.memo($COMP)'"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "I-TAB-SCREENS-MEMOIZED: $VIOLATIONS violation(s)."
  echo ""
  echo "All 6 tab screens MUST default-export React.memo(...). Default Object.is"
  echo "shallow compare is sufficient — DO NOT add custom arePropsEqual fns."
  echo "If shallow compare fails, fix upstream prop instability (see spec §2.A.2)."
  exit 1
fi

echo "I-TAB-SCREENS-MEMOIZED: PASS (6/6 tabs memoized)"
exit 0
