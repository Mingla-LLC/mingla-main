#!/usr/bin/env bash
# ORCH-0679 Wave 2A — dev-only render-counter instrument.
#
# Fails if any of the 6 tab files is missing the `[render-count] X:` log,
# which is the founder's primary verification tool that memo barriers hold.
# Gated by __DEV__ so it's dead-stripped from release builds.
set -e

VIOLATIONS=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

declare -A TABS=(
  ["src/components/HomePage.tsx"]="HomePage"
  ["src/components/DiscoverScreen.tsx"]="DiscoverScreen"
  ["src/components/ConnectionsPage.tsx"]="ConnectionsPage"
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
  if ! grep -q "\[render-count\] $COMP" "$FULL_PATH"; then
    echo "Render-counter missing: $FILE expected '[render-count] $COMP' log"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
  if ! grep -q "if (__DEV__)" "$FULL_PATH"; then
    echo "__DEV__ gate missing: $FILE — render counter must be dev-only"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "Render-counter instrument: $VIOLATIONS violation(s)."
  exit 1
fi

echo "Render-counter instrument: PASS (6/6 tabs instrumented)"
exit 0
