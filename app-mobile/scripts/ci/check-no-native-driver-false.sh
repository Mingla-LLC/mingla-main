#!/usr/bin/env bash
# I-ANIMATIONS-NATIVE-DRIVER-DEFAULT — ORCH-0675 Wave 1 RC-1 + RC-3 protection.
#
# Fails if `useNativeDriver: false` appears in the SwipeableCards swipe-handler
# region (PanResponder body) OR in the DiscoverScreen LoadingGridSkeleton block.
#
# Whitelist: width/height animations are exempt — must include explicit comment
#   `// useNativeDriver:false JUSTIFIED: <reason>` on the same line or the line
#   directly above. Width is not GPU-eligible so JS-driven is the only valid path.
#
# Negative-control: inject `useNativeDriver: false` at SwipeableCards.tsx in the
# PanResponder body → run this script → exit 1 with named invariant in output →
# revert → exit 0.
set -e

VIOLATIONS=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SWIPE_FILE="$APP_ROOT/src/components/SwipeableCards.tsx"
DISCOVER_FILE="$APP_ROOT/src/components/DiscoverScreen.tsx"

# SwipeableCards.tsx: PanResponder swipe handler region (lines 1216-1380)
# All transform/opacity animations in this region MUST be native-driven.
if [ -f "$SWIPE_FILE" ]; then
  SWIPE_VIOLATIONS=$(awk '
    NR>=1216 && NR<=1380 && /useNativeDriver: false/ && !/JUSTIFIED:/ {
      print FILENAME ":" NR ": " $0
    }
  ' "$SWIPE_FILE")
  if [ -n "$SWIPE_VIOLATIONS" ]; then
    echo "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT violation in SwipeableCards swipe handler:"
    echo "$SWIPE_VIOLATIONS"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
else
  echo "WARN: $SWIPE_FILE not found — skipping SwipeableCards check"
fi

# DiscoverScreen.tsx: LoadingGridSkeleton (lines 575-620)
# Opacity-only animation. Native driver mandatory.
if [ -f "$DISCOVER_FILE" ]; then
  DISCOVER_VIOLATIONS=$(awk '
    NR>=575 && NR<=620 && /useNativeDriver: false/ && !/JUSTIFIED:/ {
      print FILENAME ":" NR ": " $0
    }
  ' "$DISCOVER_FILE")
  if [ -n "$DISCOVER_VIOLATIONS" ]; then
    echo "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT violation in DiscoverScreen LoadingGridSkeleton:"
    echo "$DISCOVER_VIOLATIONS"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
else
  echo "WARN: $DISCOVER_FILE not found — skipping DiscoverScreen check"
fi

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: $VIOLATIONS violation(s) found."
  echo ""
  echo "Animations on transform/opacity properties must use useNativeDriver: true."
  echo "JS-driven animations stutter on mid-tier Android (Snapdragon 600-class)."
  echo ""
  echo "If width/height/non-native property is genuinely required, add inline comment:"
  echo "  // useNativeDriver:false JUSTIFIED: <reason>"
  exit 1
fi

echo "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: PASS"
exit 0
