#!/usr/bin/env bash
# I-ZUSTAND-PERSIST-DEBOUNCED — ORCH-0675 Wave 1 protection.
#
# Zustand persist storage adapter MUST use the debounced wrapper, NOT raw
# AsyncStorage. AppState 'background'/'inactive' listener MUST be wired to
# flush pending writes — without it, app-killed mid-debounce loses recent state.
#
# Why: Android SQLite-backed AsyncStorage takes 20-200ms per write on mid-tier
# devices. Heavy swipe sessions write per-swipe, blocking JS thread.
# Debouncing coalesces to ~1 write per 250ms window.
#
# Negative-control: replace `createJSONStorage(() => debouncedAsyncStorage)`
# with `createJSONStorage(() => AsyncStorage)` → run this script → exit 1 →
# revert → exit 0.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STORE_FILE="$APP_ROOT/src/store/appStore.ts"

if [ ! -f "$STORE_FILE" ]; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED: ERROR — $STORE_FILE not found"
  exit 1
fi

VIOLATIONS=0

# 1. Must define the debouncedAsyncStorage wrapper symbol.
if ! grep -q "debouncedAsyncStorage" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: debouncedAsyncStorage wrapper not found in $STORE_FILE."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# 2. createJSONStorage MUST reference debouncedAsyncStorage.
if ! grep -q "createJSONStorage(() => debouncedAsyncStorage)" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: createJSONStorage must reference debouncedAsyncStorage."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# 3. Raw AsyncStorage adapter MUST NOT remain in the persist config.
# (Bare AsyncStorage references for getItem/setItem inside the wrapper are OK;
# the violation is using AsyncStorage directly in createJSONStorage.)
if grep -q "createJSONStorage(() => AsyncStorage)" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: raw AsyncStorage adapter still present (bypasses debounce)."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# 4. AppState background flush listener MUST be present.
# Imported as RNAppState to avoid local AppState interface collision; check both forms.
if ! grep -qE "(AppState|RNAppState)\.addEventListener\(['\"]change['\"]" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: AppState background flush listener missing."
  echo "Without it, pending writes are LOST on app kill."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# 5. flushPendingWrites function MUST exist (the function called by AppState listener).
if ! grep -q "flushPendingWrites" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: flushPendingWrites function missing."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "I-ZUSTAND-PERSIST-DEBOUNCED: $VIOLATIONS violation(s) found."
  exit 1
fi

echo "I-ZUSTAND-PERSIST-DEBOUNCED: PASS"
exit 0
