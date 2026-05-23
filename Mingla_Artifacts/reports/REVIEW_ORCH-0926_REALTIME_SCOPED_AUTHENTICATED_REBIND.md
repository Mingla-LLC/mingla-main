# REVIEW — ORCH-0926 — Realtime scoped authenticated rebind

**Reviewer:** Claude `mingla-orchestrator` (REVIEW mode)
**Date:** 2026-05-23
**Implementor:** Codex `implementor-mingla`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`
**Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0926_REALTIME_POSTGRES_CHANGES_NOT_DELIVERED.md`

## Verdict

**PASS — route to independent TEST.**

The implementation matches the investigation's recommended fix contract. All four file-level changes landed. All hard guards hold. Regression tests independently re-ran green by the reviewer. Tests cover the required happy-path + adversarial angles. Code reads cleanly and preserves the existing realtime callback-bundle architecture.

## Independent verification performed by reviewer

| Check | Method | Result |
|---|---|---|
| Tests 1-4 actually pass | `cd app-mobile && npx tsc --rootDir src --outDir /tmp/orch0926-test --module commonjs --target es2020 --jsx react-jsx --esModuleInterop --skipLibCheck --types react-native src/services/realtimeService.ts src/services/__tests__/realtimeService.orch-0926.test.ts && node /tmp/orch0926-test/services/__tests__/realtimeService.orch-0926.test.js` | **PASS** — 4× `PASS Test N` lines emitted, exit 0 |
| No `createClient({ accessToken })` | `grep -n "createClient.*accessToken"` across 4 files + test | No matches |
| No `realtime.disconnect()` | `grep -n "realtime\.disconnect"` across 4 files + test | No matches |
| No `realtime.connect(` | `grep -n "realtime\.connect("` across 4 files + test | No matches |
| ORCH-0923 invalidate preserved | `grep -n "queryClient.invalidateQueries.*deck-cards" RecommendationsContext.tsx` | Match at line 1666 — preserved |
| Files touched match dispatch | `git diff --stat` | Exactly the 4 scoped files + 1 new test file |
| Live `daadd454-...` session untouched | No live SQL mutation in any of the changed code or the test (mocks the Supabase client) | Confirmed |

## Spec traceability

| Investigation §"Single Recommended Fix" item | Implemented at | Verified by |
|---|---|---|
| (1) Read current auth session before channel | `realtimeService.ts:386-388` (in new async `subscribeToBoardSession`) | Test 1 + 2 |
| (2) Defer when no session | `realtimeService.ts:390-393` returns `null` with `[ORCH-0926]` log | Test 2 |
| (3) Await `setAuth(access_token)` | `realtimeService.ts:395` | Test 1 (with explicit ordering assertion) |
| (4) Remove existing channel before recreate | `realtimeService.ts:407-409` via `removeChannel(..., preserveBoardCallbacks: true)` | Test 3 |
| (5) Recreate with existing bindings | `realtimeService.ts:411+` (existing Phoenix `.channel(...).on(...)…subscribe(...)` block) | Test 3 verifies the rebuilt channel keeps the `collaboration_sessions` UPDATE binding |
| (6) Subscribe only after token applied | Sequencing in `subscribeToBoardSession`: getSession → setAuth → removeChannel → channel + subscribe | Test 1 fails-on-revert at commit `6225d7ef…` |
| (7) Rebind on `SIGNED_IN` and `TOKEN_REFRESHED` only | `useAuthSimple.ts:325-328` gated by `event === 'SIGNED_IN' \|\| event === 'TOKEN_REFRESHED'` | Source inspection + scoped lint |

## Code-quality observations

**Positive:**
- Callback bundles are correctly preserved across rebind via the new `removeChannel(name, { preserveBoardCallbacks: true })` option. Test 3 verifies the rebuilt channel dispatches to the original callback set.
- `useBoardSession` correctly handles the new async return — the IIFE inside `setTimeout` awaits cleanly, the `cancelled` flag prevents stale subscription completion from leaking, and the dep array now includes `user?.id` so the effect re-runs when auth lands.
- `authenticatedChannelTokens` map deduplicates rebinds: if the same access token is already attached, the rebind skips the teardown. Avoids needless churn on `TOKEN_REFRESHED` events where the new token equals the old (idempotency).
- I-AUTH-CB-01 invariant preserved — `rebindAuthenticatedChannels()` is fire-and-forget inside `onAuthStateChange`. Initial-session `setAuth` IS awaited but that's outside the auth callback (inside `initializeAuth`), which is the correct surface for awaiting.
- Constitutional #6 ("logout clears everything") preserved — `SIGNED_OUT` now calls `realtime.setAuth('')` + `realtimeService.unsubscribeAll()`.

**Observations worth noting for tester (not blockers):**

1. **`subscribeToBoardSession` removed the "channel already exists, return early" fast path.** Every call now tears down and recreates. This is intentional and required for the rebind contract, but any code path that calls subscribe twice for the same session will now produce a teardown+recreate cycle instead of a no-op. Spot-checked: the existing caller in `useBoardSession.ts` guards via `stableSessionIdRef.current === sessionId` → returns early before re-subscribing, so this is a non-issue for the only known caller. Tester should still confirm no UI-visible flicker on quick mode switches.

2. **`subscribeToBoardSession` now returns `Promise<RealtimeChannel | null>` instead of `RealtimeChannel`.** Searched the codebase: the only caller is `useBoardSession.ts`, which has been updated to handle the async + null returns. Confirmed no other consumer.

3. **`rebindAuthenticatedChannels()` removes all RLS-gated channels when no session exists.** Filtered RLS-gated channels include `board_session:*`, `session:*`, and `board:*`. Broadcast-only `chat:*` is preserved (Test 4 verifies). The `subscribeToSession` and `subscribeToBoard` channels are removed-but-not-recreated on no-session-rebind. The implementation report flags this in §"Risks, Limitations" — those channels don't have a callback-bundle registry, so a future ORCH can address their rebind if needed. Not a regression.

4. **The diag logs are intentionally preserved** per the dispatch §"Change 4 — Remove diagnostic logs" (deferred until tester signs off). The implementor will reap them in a follow-up commit on the same branch / PR. The CLOSE Step 1.5 gate will block the close until they're gone.

## Hard guard table

| Guard | Status |
|---|---|
| No `createClient({ accessToken })` | PASS |
| No `supabase.realtime.disconnect()` | PASS |
| No `supabase.realtime.connect()` | PASS |
| No mutation of live `daadd454-...` session | PASS |
| Preserve ORCH-0923 invalidate in `RecommendationsContext.tsx` | PASS |
| Touch only the 4 scoped files + 1 new test file | PASS |
| No `--no-verify` git ops | PASS (no commits made) |
| No PR opened | PASS |
| No global cache wipe | PASS |

## Step 0.5 regression-test gate (CLOSE prerequisite — informational at REVIEW)

- **Implementor happy-path test (Test 1):** PASS, fails-on-revert verified at `6225d7ef6fb583bc48408da7c3df792f7a5379d0`. ✓
- **Tester adversarial test:** still required at CLOSE time. The four tests already in place (no-auth defer, token-refresh rebind, broadcast-only preservation) are strong adversarial coverage, but per ORCH-0840 the **tester** must add at least one more adversarial angle attributable to their independent QA (e.g., concurrent rebind under signed-out-mid-rebind, or simultaneous rebind from two near-simultaneous TOKEN_REFRESHED events). Document in test dispatch.

## Routing

**Route to:** Claude `mingla-tester` for independent two-sim/dev-build verification.

**Tester must verify (live, on real auth):**

1. With two authenticated sims/devices in the same collab session, change participant prefs on client A and confirm client B logs `[ORCH-0923-DIAG] onSessionUpdated fired` within ~1s.
2. The `[ORCH-0923-DIAG] collab params changed, invalidating deck-cards` log fires next on client B with DIFFERENT `prev` vs `next` `deckParamsHash` (this proves the ORCH-0926 fix lets ORCH-0923's invalidate trigger from remote changes).
3. React Query refetches the deck-cards at the current position on client B.
4. If the new aggregator produces `intersection_empty: false`, the dead-end screen heals to a real card within ~1s.
5. Cross-platform parity per `feedback_tester_canonical_and_platform_parity`: iOS sim + Android emu + web browser (web is N/A here; document the gap).
6. Sign-out → sign-in cycle: confirm `board_session:*` channel is correctly recreated after sign-in and `onSessionUpdated` delivers on the new login.
7. Token-refresh handling: ideally drive a `TOKEN_REFRESHED` event (Supabase auto-refreshes near token expiry; can be forced via `supabase.auth.refreshSession()` from a dev console if accessible). Confirm `rebindAuthenticatedChannels` log + that subsequent prefs changes still deliver.
8. **Tester-authored adversarial regression test** at `app-mobile/src/services/__tests__/realtimeService.orch-0926.adversarial.test.ts` — at least ONE distinct adversarial angle that the implementor's Tests 2-4 don't cover. Captured in QA report with run output.
9. **Do not push or open the PR.** Tester returns PASS / CONDITIONAL PASS / FAIL to orchestrator for CLOSE routing.
10. **Do not mutate live `daadd454-...` session.** Use a fresh test session OR coordinate with operator for a sacrificial session.

**Do NOT route to:** implementor REWORK. Implementation is complete and correct per the investigation contract.

## Discoveries / follow-ups (not in ORCH-0926 scope)

- The investigation flagged adjacent RLS-gated postgres_changes listeners that may share the same root cause: `subscribeToSession`, `subscribeToBoard`, plus listeners in `messagingService.ts`, `useChatPresence.ts`, `useSessionDiscussion.ts`, `useNotifications.ts`, etc. The implementor's `rebindAuthenticatedChannels` filters them correctly on sign-out but doesn't yet rebind them on token refresh because they lack a callback-bundle registry equivalent to `boardSessionCallbackSets`. **Recommend opening a follow-up ORCH after ORCH-0926 closes** to audit and (if needed) extend the rebind pattern to the other RLS-gated channels. Operator to confirm whether to file pre-close.

- Pre-existing repo-wide `npx tsc --noEmit` errors in `BoardDiscussion.tsx`, `HomePage.tsx`, `nativeCheckoutFlow.ts`, and shared packages remain. Not introduced by this ORCH; called out in implementor report §15.

## Final note

Implementation is APPROVED. Hand off to tester. After tester PASS, orchestrator handles CLOSE (artifact updates, DIAG reaping verification, regression-test backfill citation, commit, PR open, pre-merge gate, merge).

NEXT HANDOFF: TEST (Claude `mingla-tester`).
