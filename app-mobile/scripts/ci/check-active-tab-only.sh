#!/usr/bin/env bash
# I-ONLY-ACTIVE-TAB-MOUNTED — ORCH-0679 Wave 2.8 Path B invariant.
#
# Detects regression to the "all 6 tabs always mounted" pattern. Path B
# requires that ONLY the active tab is mounted at any time, selected via
# switch(currentPage). Hidden tabs literally don't exist → no React.memo
# concerns possible, no context-propagation re-renders, no god-hook impact.
#
# This gate fires on TWO signals:
#   1. The legacy `styles.tabVisible` / `styles.tabHidden` style names
#      being defined or referenced in app/index.tsx.
#   2. (Future-proof) Multiple top-level tab component invocations inside
#      the AppContent JSX render block. Hard to verify statically without
#      an AST parser, so this gate's primary teeth is signal #1.
#
# Negative-control: temporarily re-add `tabVisible: { flex: 1 }` to the
# styles block in app/index.tsx → run this gate → exit 1 with named
# invariant in output → revert → run gate → exit 0.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_FILE="$APP_ROOT/app/index.tsx"

if [ ! -f "$TARGET_FILE" ]; then
  echo "ERROR: $TARGET_FILE not found"
  exit 1
fi

# Signal 1: legacy style names — definitions or references
LEGACY_VIOLATIONS=$(grep -nE "(styles\.(tabVisible|tabHidden)|^\s+tabVisible:|^\s+tabHidden:)" "$TARGET_FILE" || true)

if [ -n "$LEGACY_VIOLATIONS" ]; then
  echo "I-ONLY-ACTIVE-TAB-MOUNTED violation: legacy tabVisible/tabHidden pattern detected"
  echo "$LEGACY_VIOLATIONS"
  echo ""
  echo "Path B (Wave 2.8) replaced the 'all tabs always mounted, visibility toggled"
  echo "by style' pattern with switch(currentPage) IIFE rendering only the active"
  echo "tab. Hidden tabs literally must not exist — they were the source of the"
  echo "render-storm bug class that 5 prior waves chased."
  echo ""
  echo "If you're tempted to re-introduce the all-mounted pattern, read:"
  echo "  Mingla_Artifacts/reports/INVESTIGATION_ORCH-0679_WAVE2_CONTEXT_AUDIT.md"
  exit 1
fi

echo "I-ONLY-ACTIVE-TAB-MOUNTED: PASS"
exit 0
