# Implementation Report: Realtime Scoped Authenticated Rebind (ORCH-0926)

> Date: 2026-05-23  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`  
> Status: implemented, partially verified

## 1. Layman Summary

Mingla mobile now creates the collaboration board-session realtime channel only after the current user JWT has been applied to Supabase Realtime. This targets the bug where a channel could say `SUBSCRIBED` but still miss `collaboration_sessions` UPDATE rows because the Realtime server registered the Postgres-change subscription under anon/stale claims.

## 2. Request And Context

- **Request:** Implement ORCH-0926 scoped authenticated rebind for `board_session:{sessionId}`.
- **Source:** Investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0926_REALTIME_POSTGRES_CHANGES_NOT_DELIVERED.md`.
- **Affected surfaces:** `app-mobile` iOS and Android collaboration sessions.
- **Related issues/artifacts:** ORCH-0923 invalidation in `RecommendationsContext.tsx` is preserved as intentional; no live mutation was made to `daadd454-35a8-487d-ab25-bb595abc4635`.

## 3. Scope

- **In scope:** `realtimeService` board-session auth gating/rebind, `useBoardSession` async subscription handling, `useAuthSimple` auth-event rebind wiring, deterministic ORCH-0926 regression tests.
- **Out of scope:** ORCH-0923 product behavior, ORCH-0924 legibility, ORCH-0925 Apply coordinate writes, live Supabase mutation, global Realtime disconnect/reconnect.
- **Assumptions:** `MEMORY.md` was requested by Phase 0 but is absent in this checkout; `rg --files -g 'MEMORY.md' -g '*MEMORY*'` found no memory files.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0926_REALTIME_POSTGRES_CHANGES_NOT_DELIVERED.md` | Authoritative root cause | Realtime subscription claims must be registered under the authenticated JWT before JOIN. |
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` | Dispatch contract | Required four code surfaces plus new test file; no global disconnect; no `createClient({ accessToken })`. |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Phase 0 invariant check | Regression-test and append-only test mandates apply. |
| `Mingla_Artifacts/DECISION_LOG.md` | Phase 0 decision check | DEC-153 requires fails-on-revert evidence for implementor tests. |
| `app-mobile/src/services/realtimeService.ts` | Primary fix | `board_session:*` had many RLS-gated `postgres_changes` bindings and reused channels without an authenticated rejoin boundary. |
| `app-mobile/src/hooks/useBoardSession.ts` | Caller update | The debounced subscription boundary needed to await async subscribe and tolerate `null`. |
| `app-mobile/src/hooks/useAuthSimple.ts` | Auth-event wiring | Existing callback has I-AUTH-CB-01 no-await constraint; rebind must be fire-and-forget there. |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Guarded non-scope file | ORCH-0923 invalidation is preserved unchanged. |

## 5. Blast Radius

- **Direct changes:** Mobile realtime board-session channel creation and auth-event channel rebind.
- **Cascade changes:** `useBoardSession` can retry after auth becomes available because its subscription effect now also observes `user?.id`.
- **Parity surfaces:** Same React Native code path for iOS and Android consumer apps.
- **Cache impact:** No query keys, invalidations, or persisted cache state changed.
- **State boundaries:** React Query/Zustand ownership unchanged. RealtimeService continues to own channel/callback registries.
- **Auth/RLS/security:** Channel JOIN is now sequenced after `supabase.auth.getSession()` and awaited `supabase.realtime.setAuth(access_token)`.
- **Deploy path:** No migrations, no edge functions, no Supabase deploy.

## 6. Old To New Receipts

### `app-mobile/src/services/realtimeService.ts`

- **Before:** `subscribeToBoardSession` synchronously reused or created `board_session:*` without a guaranteed authenticated Realtime JOIN boundary.
- **After:** It is async, defers with `null` when no auth session exists, awaits `supabase.realtime.setAuth(access_token)`, removes/recreates an existing board-session channel while preserving callback bundles, and records the token used for the joined channel.
- **Why:** Postgres-change delivery for RLS-gated tables depends on subscription claims stored on the Realtime server.
- **Approx lines changed:** ~75.

### `app-mobile/src/hooks/useBoardSession.ts`

- **Before:** The debounced timer called `subscribeToBoardSession` synchronously.
- **After:** The timer awaits the async subscription inside an IIFE, clears the stable session marker on `null`/error, and keeps stale-event guards across the async boundary.
- **Why:** A no-auth subscription must not leave the hook believing it is subscribed.
- **Approx lines changed:** ~25.

### `app-mobile/src/hooks/useAuthSimple.ts`

- **Before:** Diagnostic setAuth scaffolding existed but did not rebind active RLS-gated Postgres-change channels on token-changing auth events.
- **After:** Initial-session setAuth is awaited outside the auth callback; `SIGNED_IN` and `TOKEN_REFRESHED` fire-and-forget `realtimeService.rebindAuthenticatedChannels()`; `SIGNED_OUT` clears realtime auth and calls `unsubscribeAll()` for logout cleanup.
- **Why:** Existing joined channels must be recreated after token changes; auth callback still avoids awaiting Supabase work.
- **Approx lines changed:** ~20.

### `app-mobile/src/contexts/RecommendationsContext.tsx`

- **Before/After:** No ORCH-0926 edit. Existing ORCH-0923 invalidate and diagnostic log are preserved intentionally.
- **Why:** Dispatch explicitly said this change is unrelated and intentional.
- **Approx lines changed:** 0 by ORCH-0926.

### `app-mobile/src/services/__tests__/realtimeService.orch-0926.test.ts`

- **Before:** No deterministic regression coverage for authenticated board-session Realtime JOIN sequencing.
- **After:** New self-running TypeScript test file with Tests 1-4 covering awaited setAuth ordering, no-auth deferral, token-refresh rebind with callback preservation, and broadcast-only channel exclusion.
- **Why:** ORCH-0840/DEC-153 requires implementor regression tests with fails-on-revert evidence.
- **Approx lines changed:** ~253.

## 7. Implementation Details

- **Architecture decisions:** Added `authenticatedChannelTokens` to detect token changes for active `board_session:*` channels. Added filtered RLS-channel teardown for no-session rebinds without touching `chat:*`.
- **Data flow:** `getSession()` → await `realtime.setAuth(token)` → remove existing `board_session:*` channel object → rebuild channel bindings → subscribe.
- **Mutation/query behavior:** None.
- **State handling:** `useBoardSession` clears `stableSessionIdRef` when subscription is deferred or fails.
- **Error handling:** Async subscription failures log and clear local subscription refs.
- **Copy/accessibility:** None.
- **Analytics/notifications/realtime:** Realtime is the only changed integration surface.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Read auth session before `board_session:*` channel creation | Yes | Test 1/2 | PASS |
| Defer when no auth session | Yes | Test 2 | PASS |
| Await `realtime.setAuth(access_token)` before channel creation | Yes | Test 1 + negative control | PASS |
| Remove/recreate existing board-session channel preserving callbacks | Yes | Test 3 | PASS |
| Rebind on `SIGNED_IN` and `TOKEN_REFRESHED` only | Yes | Source inspection + scoped lint | PASS |
| Do not use global realtime disconnect/connect | Yes | `rg` guard found no matches | PASS |
| Do not use `createClient({ accessToken })` | Yes | `rg` guard found no matches | PASS |
| Do not mutate live `daadd454-...` session | Yes | No live Supabase command run | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-AUTH-CB-01 no awaiting inside auth callback | Yes | Yes | `rebindAuthenticatedChannels()` is fire-and-forget inside `onAuthStateChange`. |
| Logout clears private realtime state | Yes | Yes | `SIGNED_OUT` calls `setAuth('')` and `realtimeService.unsubscribeAll()`. |
| Regression-test mandatory / fails-on-revert | Yes | Yes | New ORCH-0926 test file added; negative control recorded below. |
| No global cache wipes | Yes | Yes | No React Query or persisted state wipe added. |

## 10. Parity Check

- **Mobile:** iOS and Android share the changed code.
- **Business app:** Not in scope.
- **Admin:** Not in scope.
- **Public/web:** Not in scope.
- **Solo/collab:** Collab board-session realtime only; solo deck behavior unchanged.
- **Gaps:** Live two-device event delivery still needs tester sim/device verification.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Board-session subscription can defer until auth exists instead of joining under anon/stale claims.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0926 Tests 1-4 | `rm -rf /tmp/orch0926-test && cd app-mobile && npx tsc --rootDir src --outDir /tmp/orch0926-test --module commonjs --target es2020 --jsx react-jsx --esModuleInterop --skipLibCheck --types react-native src/services/realtimeService.ts src/services/__tests__/realtimeService.orch-0926.test.ts && node /tmp/orch0926-test/services/__tests__/realtimeService.orch-0926.test.js` | PASS | Output: four `PASS` lines for Tests 1-4. |
| Scoped typecheck for service + test | `cd app-mobile && npx tsc --rootDir src --outDir /tmp/orch0926-test --module commonjs --target es2020 --jsx react-jsx --esModuleInterop --skipLibCheck --types react-native src/services/realtimeService.ts src/services/__tests__/realtimeService.orch-0926.test.ts --noEmit` | PASS | No output. |
| Scoped lint | `cd app-mobile && npx eslint src/services/realtimeService.ts src/hooks/useBoardSession.ts src/hooks/useAuthSimple.ts src/contexts/RecommendationsContext.tsx src/services/__tests__/realtimeService.orch-0926.test.ts` | PASS with warnings | 0 errors, 26 existing warnings in scoped files. |
| Hard-guard grep | `rg -n "createClient\\([^\\n]*accessToken|accessToken\\s*\\}|realtime\\.disconnect|realtime\\.connect\\(" ...` | PASS | No matches. |
| Full app-mobile typecheck | `cd app-mobile && npx tsc --noEmit` | FAIL, pre-existing unrelated errors | Errors remain in `BoardDiscussion.tsx`, `HomePage.tsx`, `nativeCheckoutFlow.ts`, shared packages, etc.; no ORCH-0926 scoped type error remains. |

**Test 1 fails-on-revert verified at `6225d7ef6fb583bc48408da7c3df792f7a5379d0`:** temporarily changed `await supabase.realtime.setAuth(accessToken);` to `supabase.realtime.setAuth(accessToken);`, reran the ORCH-0926 compile/run command, and Test 1 failed with `AssertionError [ERR_ASSERTION]: channel must be created only after setAuth resolves`.

## 13. Regression Surface

1. Multiple consumers of the same `board_session:*` channel: callback bundles are preserved during channel recreation.
2. Auth refresh while a session channel is active: only changed-token `board_session:*` channels rebind.
3. Signed-out or no-session state: RLS-gated channels are removed, while broadcast-only `chat:*` channels survive filtered rebind cleanup.
4. Other synchronous callers of `subscribeToBoardSession`: they now fire-and-forget the returned Promise unless updated in a future ORCH.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Diagnostic logs preserved | ORCH-0923/0926 diagnostic logs remain noisy | Tester confirms live delivery, then orchestrator/implementor reaps DIAG markers in the same PR | `realtimeService.ts`, `useBoardSession.ts`, `useAuthSimple.ts`, `RecommendationsContext.tsx` |
| Full app typecheck red | Repo-wide `npx tsc --noEmit` is not clean | Separate owners fix existing unrelated type errors | app-mobile/shared package files listed in verification output |
| Other RLS-gated realtime surfaces | `session:*` and `board:*` are filtered on no-auth cleanup but not fully recreated because callback ownership is not registered like board-session | Future audit/ORCH for adjacent realtime subscribers | `realtimeService.ts` and other hooks |

## 15. Discoveries For Orchestrator

- `MEMORY.md` and linked memory files requested by Phase 0 are absent from this checkout.
- app-mobile still has repo-wide TypeScript failures unrelated to ORCH-0926; scoped ORCH-0926 compile passes.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** Mobile JS change; likely OTA-eligible, subject to normal release flow.
- **Business/admin web:** None.
- **Env vars/secrets:** None.

## Smoke-Test Plan

1. On two authenticated dev-build clients in the same collaboration board session, change participant preferences on client A and confirm client B logs `[ORCH-0923-DIAG] onSessionUpdated fired`.
2. Confirm the `board_session:{sessionId}` log reaches `SUBSCRIBED` after the ORCH-0926 `realtime.setAuth` diagnostic on both iOS simulator and Android emulator.
3. Confirm ORCH-0923 deck invalidation follows the remote pref change and the former stale dead-end state refetches.
4. Do not use or mutate live session `daadd454-35a8-487d-ab25-bb595abc4635`.

## Suggested Commit Message

```text
app-mobile: rebind board-session realtime under auth

Resolves: ORCH-0926
Evidence: app-mobile/src/services/__tests__/realtimeService.orch-0926.test.ts
Deploy: no migrations or edge deploys; mobile JS only
```

## Ready-To-Test Checklist

1. Run the ORCH-0926 test compile/run command from §12 and confirm Tests 1-4 pass.
2. Run two-client iOS/Android live verification and confirm remote `collaboration_sessions` UPDATE delivery.
3. After tester confirms live delivery, remove the diagnostic markers in the same scoped PR.
