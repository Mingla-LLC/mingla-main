#!/usr/bin/env bash
# I-SENTRY-SINGLE-INIT — ORCH-0679 Wave 2B-2 invariant.
#
# Fails if more than one `Sentry.init(` call exists in app-mobile/. Double-init
# has undefined merge semantics across SDK versions and was the source of
# config drift between _layout.tsx and app/index.tsx prior to this wave.
#
# The single source of truth is app/_layout.tsx.
#
# Negative-control: re-add `Sentry.init({...})` to app/index.tsx → run this
# script → exit 1 → revert → exit 0.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Count Sentry.init( occurrences in app/ and src/ (excludes node_modules + comments).
# Use grep with -c to count per-file, then sum.
COUNT=$(grep -rE "^\s*Sentry\.init\(" "$APP_ROOT/app" "$APP_ROOT/src" 2>/dev/null \
  --include="*.ts" --include="*.tsx" \
  | grep -v "^\s*//" \
  | wc -l \
  | tr -d ' ')

if [ "$COUNT" -gt 1 ]; then
  echo "I-SENTRY-SINGLE-INIT violation: found $COUNT Sentry.init() calls (expected exactly 1):"
  grep -rnE "^\s*Sentry\.init\(" "$APP_ROOT/app" "$APP_ROOT/src" \
    --include="*.ts" --include="*.tsx" 2>/dev/null
  echo ""
  echo "Sentry.init() must be called EXACTLY ONCE in app-mobile/, in app/_layout.tsx."
  echo "Delete duplicates."
  exit 1
fi

if [ "$COUNT" -eq 0 ]; then
  echo "I-SENTRY-SINGLE-INIT violation: NO Sentry.init() found in app-mobile/."
  echo "Sentry must be initialized in app/_layout.tsx."
  exit 1
fi

echo "I-SENTRY-SINGLE-INIT: PASS (1 Sentry.init found)"
exit 0
