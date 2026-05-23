#!/usr/bin/env bash
# Enforces I-PROPOSED-YOUR-CIRCLE-RPC-SOLE-OWNER.
set -euo pipefail

SCOPE="app-mobile/src/components/profile/circle app-mobile/src/hooks/useUserCircle.ts app-mobile/src/services/circleService.ts"
PATTERN="\\.from\\(['\"](friends|pairings|orders)['\"]\\)|accept_friend_request_atomic"

hits=$(grep -rEn "$PATTERN" $SCOPE 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "FAIL: Circle feature must use get_user_circle RPC, not direct social graph queries:"
  echo "$hits"
  exit 1
fi

rpc_hits=$(grep -rEn "\\.rpc\\(['\"]get_user_circle['\"]" app-mobile/src/hooks/useUserCircle.ts app-mobile/src/services/circleService.ts 2>/dev/null || true)
if [ -z "$rpc_hits" ]; then
  echo "FAIL: Circle feature must call get_user_circle RPC."
  exit 1
fi

echo "PASS: G-CIRCLE-RPC-SOLE-OWNER"
