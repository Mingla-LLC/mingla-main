#!/usr/bin/env bash
# I-PROPOSED-RQ-PROVIDER-AT-ROOT-LAYOUT — ORCH-1125 invariant.
#
# In app-mobile, the React Query provider (PersistQueryClientProvider) MUST be
# mounted in the expo-router root layout app/_layout.tsx (wrapping <Stack/>),
# and MUST NOT be mounted in any route component (notably app/index.tsx), so
# that every cold-routed public deep-link (/t/, /b/, /brand/) is wrapped by a
# QueryClient. Mounting it inside the `/` (Home) route made it a SIBLING of the
# deep-link routes; a cold deep-link opened in a fresh process routed straight
# to one of those siblings before Home mounted and crashed with
# "No QueryClient set, use QueryClientProvider to set one".
#
# The single source of truth is app/_layout.tsx.
#
# Negative-control: move the provider back into app/index.tsx (and remove it
# from app/_layout.tsx) → run this script → exit 1 → revert → exit 0.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

LAYOUT="$APP_ROOT/app/_layout.tsx"
INDEX="$APP_ROOT/app/index.tsx"

FAIL=0

# Strip single-line `//` comments before counting code occurrences so that the
# explanatory ORCH-1125 comment blocks (which legitimately name the symbol) do
# not count as a provider mount.
code_only() {
  # $1 = file path. Removes lines whose first non-space char is `//`.
  grep -vE '^[[:space:]]*//' "$1" 2>/dev/null
}

# ── Condition A: provider IS at root (_layout.tsx) ──────────────────────────
A_COUNT=$(code_only "$LAYOUT" | grep -cE '\bPersistQueryClientProvider\b' || true)
if [ "$A_COUNT" -lt 1 ]; then
  echo "VIOLATION (A): PersistQueryClientProvider NOT found in app/_layout.tsx."
  echo "  The React Query provider must be mounted at the root layout, wrapping <Stack/>."
  FAIL=1
else
  echo "PASS (A): PersistQueryClientProvider present in app/_layout.tsx ($A_COUNT)."
fi

# ── Condition B: provider is NOT on the `/` route (index.tsx) ───────────────
B_MATCHES=$(code_only "$INDEX" | grep -E '\b(PersistQueryClientProvider|QueryClientProvider)\b' || true)
if [ -n "$B_MATCHES" ]; then
  echo "VIOLATION (B): a QueryClient provider is mounted in app/index.tsx (the / route):"
  echo "$B_MATCHES" | sed 's/^/    /'
  echo "  The provider must live ONLY at app/_layout.tsx so cold deep-links are wrapped."
  FAIL=1
else
  echo "PASS (B): no QueryClient provider in app/index.tsx."
fi

# ── Condition C: no OTHER route file under app/ mounts it (only _layout.tsx) ─
C_MATCHES=$(grep -rE '\bPersistQueryClientProvider\b' "$APP_ROOT/app" --include='*.tsx' 2>/dev/null \
  | grep -v '/_layout\.tsx:' \
  | grep -vE ':[[:space:]]*//' \
  || true)
if [ -n "$C_MATCHES" ]; then
  echo "VIOLATION (C): PersistQueryClientProvider mounted in a route file other than _layout.tsx:"
  echo "$C_MATCHES" | sed 's/^/    /'
  echo "  Only app/_layout.tsx may mount the provider (single root owner)."
  FAIL=1
else
  echo "PASS (C): no route file other than app/_layout.tsx mounts PersistQueryClientProvider."
fi

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "I-PROPOSED-RQ-PROVIDER-AT-ROOT-LAYOUT violation (ORCH-1125)."
  echo "Keep PersistQueryClientProvider in app/_layout.tsx ONLY."
  exit 1
fi

echo ""
echo "I-PROPOSED-RQ-PROVIDER-AT-ROOT-LAYOUT: PASS (provider at root, absent from routes)."
exit 0
