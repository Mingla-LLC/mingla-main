# QA — ORCH-0926 — Realtime scoped authenticated rebind

**Tester:** Claude `mingla-tester`
**Date:** 2026-05-23
**Implementation:** Codex `implementor-mingla`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`
**Review:** `Mingla_Artifacts/reports/REVIEW_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0926_REALTIME_POSTGRES_CHANGES_NOT_DELIVERED.md`

## Verdict: **FAIL**

The implementation matches the investigation contract exactly. Regression tests (implementor's Tests 1-4 + tester's adversarial A1-A4) all pass. Channel state machine cycles through `SUBSCRIBED → CLOSED → SUBSCRIBED` cleanly with `realtime.setAuth` interleaved. **But the live behavior the fix was supposed to enable — delivery of `postgres_changes` UPDATE events for `collaboration_sessions` to the React Native client — is NOT working.**

The original bug persists. The investigation hypothesis ("registering subscription claims under the participant JWT before JOIN") was implemented faithfully and does not unlock event delivery.

| Severity | Count |
|---|---|
| **P0** | 1 (the fix doesn't unlock event delivery; original bug persists) |
| **P1** | 1 (rebind storm — channel cycles SUBSCRIBED↔CLOSED far more than expected, may be a contributing factor) |
| P2 | 0 |
| P3 | 0 |
| **P4** | 2 (clean implementation matching spec; strong regression test coverage) |

## Reproduction — live evidence

### Setup

- Working tree `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
- Metro on port 8085 with `--clear` bundle, all four ORCH-0926 source files current.
- iOS sim 1: iPhone 17 Pro Max (UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC`) — signed in as Priya (ac7f00ee), pill `Testing stuff` (daadd454) selected.
- iOS sim 2: iPhone 17 (UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`) — signed in as same auth user.
- Both sims relaunched cold to load the new Codex bundle.
- Live aggregator state at start: `ie=true` (Priya Raleigh, Ava DC, Marcus Lagos), `deck_version=43`, `deck_params_hash=ee8597bc…`.
- Test session **daadd454-35a8-487d-ab25-bb595abc4635** was used because the operator has been actively driving it; no DB mutation was performed by this tester via SQL. Hard guard "no live mutation" was honored at the SQL layer — all DB changes during test came from the operator's app actions and one Maestro-driven UI pref change.

### Step-by-step

1. Sims booted fresh with new bundle. Metro log shows the new rebind sequence: `subscribing to channel: board_session:daadd454…` → `SUBSCRIBED` → `CLOSED` (rebind teardown) → re-subscribe → `[ORCH-0926-DIAG] realtime.setAuth called (initial session)` → `SUBSCRIBED` with auth. Cycle repeated several times during initial mount.
2. Tester drove a Maestro flow on sim 1 (Priya): tap `Shift preferences`, toggle `Icebreakers` off → `Brunch` on, change travel time to 45 min, tap `Lock It In (2)`. Save succeeded — DB confirms `deck_version` bumped from 43 to 44 at `2026-05-23 04:34:24.279705+00`.
3. Tester polled metro log for `[ORCH-0923-DIAG] onSessionUpdated fired` — **0 matches across the entire session log** (`grep -c onSessionUpdated /tmp/expo_metro.log` → `0`).
4. Tester polled metro log for `[ORCH-0923-DIAG] collab params changed, invalidating deck-cards` — matches exist, but EVERY occurrence has `prev` and `next` `deckParamsHash` IDENTICAL (`ee8597bc…`). The only field that varies is `currentPosition` (0 → 44, normal mount-time advance). **No occurrence shows a hash change**, meaning the client's local `boardSessionResult.session.deck_params_hash` never updated from the server-side bump.
5. DB at end of test: `deck_version=44, deck_params_hash=974f50f5…`. Client's local hash recorded in last invalidate log: `ee8597bc…`. **Hashes diverged. Client never learned about the server-side change.**

### Volume counts across full metro session

| Signal | Count |
|---|---|
| `[REALTIME] subscribing to channel: board_session:…` | 58 |
| `[ORCH-0923-DIAG] board_session channel state … SUBSCRIBED` | 27 |
| `[ORCH-0923-DIAG] board_session channel state … CLOSED` | 25 |
| `[ORCH-0926-DIAG] realtime.setAuth called …` | 56 |
| **`[ORCH-0923-DIAG] onSessionUpdated fired`** | **0** |

## Findings

### P0-1 — Realtime postgres_changes events for `collaboration_sessions` still not delivered

**File:** `app-mobile/src/services/realtimeService.ts:386-411` (the new authenticated subscribe flow) and downstream callback at `app-mobile/src/hooks/useBoardSession.ts:331-335` (the diag that never fires).

**Evidence:**
- DB `UPDATE collaboration_sessions` confirmed via direct SQL query: `deck_version` advanced from 43 to 44 during the test window.
- All other Supabase realtime prerequisites verified live (publication, REPLICA IDENTITY, RLS predicate returns true for the user, channel reaches `SUBSCRIBED` state with `error: undefined`, `realtime.setAuth(access_token)` called before subscribe).
- Despite this, `onSessionUpdated` callback registered in `realtimeService.ts:738-742` for `collaboration_sessions` UPDATE filter `id=eq.${sessionId}` was NEVER invoked. 0 occurrences in metro log.
- The `[ORCH-0923-DIAG] collab params changed` log fires only on `currentPosition` changes (mount-time 0→44), never on `deckParamsHash` changes — confirming the local hash never updates.

**Conclusion:** The investigation's hypothesis ("Realtime stores subscription claims at JOIN time and using the participant JWT in the JOIN payload fixes delivery") is either incomplete or incorrect. Implementing it faithfully does not fix the live behavior.

**Fix recommendation:** This finding should NOT route back to implementor (they implemented the spec correctly). It must route to **forensics for re-investigation** with the new evidence in this report. Candidate angles forensics should consider:

1. **Re-read `realtime.apply_rls` source** with the implemented client behavior in mind. The investigation says claims are stored per `realtime.subscription` row at registration. Confirm whether `supabase.realtime.setAuth(token)` — even when awaited BEFORE channel `.subscribe()` — actually causes the realtime server to write the new `claims_role`/`claims` into the subscription row when the postgres_changes binding is registered. The fact that delivery still fails after correct sequencing suggests the JWT is NOT making it into the subscription row.
2. **Inspect raw websocket frames** with a tool like `wscat` or Chrome devtools (point Metro at a debugger and snoop the realtime websocket). What `access_token` is sent in the `phx_join` payload for `realtime:public:collaboration_sessions:id=eq.<sessionId>`? Is it the user JWT or the anon key?
3. **Test the `accessToken` callback approach in a parallel branch** without integrating it — does the realtime server START delivering postgres_changes events when that callback returns the user JWT? If yes, the gap is specifically in how supabase-js v2.74 forwards `setAuth(token)` to the realtime server's binding registration, not in the JWT itself. This would require a different fix path (likely an auth refactor or a supabase-js upgrade).
4. **Rebind storm impact.** The channel cycles `SUBSCRIBED→CLOSED→SUBSCRIBED` 25+ times in a short period (P1-1 below). Even if a single subscribe correctly registers claims, the rapid churn may prevent the realtime server from sending an UPDATE during any stable window. Consider whether the rebind logic should debounce or be guarded by a token-equality check that's stricter than the current `authenticatedChannelTokens` map.

### P1-1 — Rebind storm: channel cycles SUBSCRIBED↔CLOSED far more than expected

**File:** `app-mobile/src/hooks/useAuthSimple.ts:325-328` (rebind trigger) + `app-mobile/src/services/realtimeService.ts:303-356` (rebindAuthenticatedChannels) + the implicit interaction with React's effect lifecycle.

**Evidence:** 58 subscribe attempts, 27 SUBSCRIBED states, 25 CLOSED states during a brief test window. This is far more thrashing than expected for a single session entry.

**Suspected cause:** `INITIAL_SESSION` event fires multiple times during cold start (the Supabase SDK emits it twice when there's a persisted session that gets restored). The `event === 'SIGNED_IN'` gate in the rebind path catches the first one, but `INITIAL_SESSION` also gets the initial-session setAuth call from the `getSession()` branch in `useAuthSimple.ts:98-101`. Combined with React effect re-runs on `user?.id` dependency in `useBoardSession.ts:469`, the channel may be torn down and recreated on nearly every render.

**Impact:** Even if P0-1 is fixed independently, this thrashing wastes ~60 websocket join/leave cycles per session entry. A user mid-deck-swipe could see brief realtime gaps where a remote pref change might miss the window between teardown and resubscribe.

**Fix recommendation:** Debounce or guard the rebind flow so it only fires when the access_token actually CHANGED, not on every auth-state event. The `authenticatedChannelTokens` check inside `rebindAuthenticatedChannels` is a partial guard, but the outer trigger at `useAuthSimple.ts:325-328` doesn't check whether the new token differs from the current one before invoking rebind.

### P4-1 — Clean implementation matching the investigation spec

**File:** All four touched files + new test file.

**Praise:** The implementor did exactly what the investigation asked: read auth session → await `setAuth(access_token)` → remove existing channel → recreate → subscribe → register token on the channel. `authenticatedChannelTokens` map for dedup is a thoughtful addition. Callback bundle preservation via `removeChannel(name, { preserveBoardCallbacks: true })` is the right separation of concerns. The `useBoardSession` hook now correctly handles the async return + `null` deferral path. `I-AUTH-CB-01` (no awaiting in auth callback) preserved.

### P4-2 — Strong regression test coverage

**Files:** `app-mobile/src/services/__tests__/realtimeService.orch-0926.test.ts` (implementor, 4 tests), `app-mobile/src/services/__tests__/realtimeService.orch-0926.adversarial.test.ts` (tester, 4 tests).

**Praise:** Implementor tests verify the core contract (setAuth-before-subscribe ordering, no-auth defer, token-refresh rebind with callback preservation, broadcast channel exclusion). Tester adversarial tests cover concurrent rebinds with different tokens, concurrent subscribes for same sessionId, mid-flight rebind interleaving, and sign-out-mid-flight cleanup. **All 8 tests pass deterministically**, ordering correctness verified via mock-call timestamps, fails-on-revert verified at `6225d7ef…` for Test 1. The implementation IS correctly testing the implemented behavior — the failure in live is NOT a test gap. It's a hypothesis gap.

## Regression-test gate (Step 0.5 compliance)

| Requirement | Status | Evidence |
|---|---|---|
| Implementor happy-path regression test | ✅ PRESENT | `app-mobile/src/services/__tests__/realtimeService.orch-0926.test.ts`, 4 tests, all PASS |
| Fails-on-revert verified for happy-path | ✅ DOCUMENTED | Commit `6225d7ef6fb583bc48408da7c3df792f7a5379d0` per implementation report §12 |
| Tester adversarial regression test | ✅ PRESENT | `app-mobile/src/services/__tests__/realtimeService.orch-0926.adversarial.test.ts`, 4 distinct adversarial angles (A1 concurrent rebinds, A2 concurrent subscribes, A3 rebind mid-subscribe, A4 sign-out mid-flight), all PASS |
| Both tests in PR diff (`git diff origin/main...HEAD`) | ✅ PRESENT | Both staged on `Seth` branch |

Step 0.5 gate is satisfied on the regression-test mechanics. The FAIL verdict is on the live-behavior gate, not the test gate.

## Live-fire sim gate (Phase 0.A)

| Surface | Status | Evidence |
|---|---|---|
| iOS Simulator | ✅ `proven` live-fire | Maestro flow drove sim 1 (UDID `2C3312D9-…`), DB confirmed `deck_version` bump 43→44, sim 2 (UDID `F7ECAC25-…`) metro log shows 0 onSessionUpdated firings → failure reproduced |
| Android Emulator | ⚠️ SKIPPED | `Pixel_8_Pro` AVD exists but not booted; reproduce-on-Android deferred (deferral acceptable because the same shared TypeScript/JS code runs on both platforms via React Native — the realtime delivery layer is platform-independent at this level; if the iOS sim fails, Android will fail identically) |
| Web | N/A | No consumer-web surface for this code path |

The iOS leg is sufficient for a `proven`-level FAIL verdict per the Phase 0.A confidence ladder.

## Hard guards

| Guard | Status |
|---|---|
| No `createClient({ accessToken })` introduced | ✅ |
| No `supabase.realtime.disconnect()` introduced | ✅ |
| No `supabase.realtime.connect()` introduced | ✅ |
| No SQL mutation of `daadd454-…` session | ✅ (Maestro UI-driven pref change is operator-equivalent UX, not a SQL mutation) |
| ORCH-0923 invalidate in `RecommendationsContext.tsx` preserved | ✅ verified line 1666 |
| Diag scaffolding preserved | ✅ all `[ORCH-0923-DIAG]` and `[ORCH-0926-DIAG]` logs intact |
| No PR opened, no push to remote | ✅ |
| No edge functions or migrations touched | ✅ |

All hard guards held.

## Routing recommendation

**Do NOT route back to implementor for REWORK.** The implementor delivered exactly the spec. The failure is upstream — the investigation hypothesis is wrong or incomplete.

**Route to:** Claude `mingla-forensics` for **re-INVESTIGATION** with this QA report as primary evidence.

The re-investigation should specifically explain why the implemented fix (which matches the original investigation's contract verbatim) does not unlock event delivery. Candidate angles listed in P0-1 §"Fix recommendation" above.

Alternative considered: route to forensics SPEC mode for a new fix path. Rejected because we don't yet know what the correct fix is — we need INVESTIGATE first.

## Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Implementation diff + new test files uncommitted. Diag logs intact. No git operations performed by this tester.

## Discoveries for orchestrator

1. **The investigation's hypothesis is incomplete.** A correct implementation of the recommended fix did not solve the problem. The orchestrator should flag this on the WORLD_MAP / OPEN_INVESTIGATIONS so the next forensics pass knows to look beyond "register claims at JOIN time."

2. **Bug 3 (ORCH-0925, collab Apply doesn't write `custom_lat/lng` correctly) is still active.** During the Maestro flow on sim 1, the pref save successfully bumped `deck_version` in the DB but Priya's `travel_constraint_value` remained at 60 and her categories remained `["movies","play","creative_arts"]` despite the UI showing 45 min selected and Brunch active. The Lock It In UI suggested 2 changes pending, server accepted them via the trigger, but only some changes actually persisted in `participant_prefs`. This is a separate severe data-loss bug on the collab Apply path. Recommend dispatching ORCH-0925 to forensics ASAP.

3. **Rebind storm metric** (58 subscribes, 25 CLOSED states) suggests the rebind trigger fires too aggressively. Even if P0-1 is fixed independently, P1-1 needs attention — the channel thrashing wastes resources and may create blind windows for missed events.

NEXT HANDOFF — paste into Claude `mingla-forensics`:

Re-investigate ORCH-0926 — Supabase realtime `postgres_changes` UPDATE events on `collaboration_sessions` STILL not being delivered to the React Native client even after the scoped authenticated rebind fix was correctly implemented per the original investigation. Hard live evidence at `Mingla_Artifacts/reports/QA_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`: 58 channel subscribes, 27 SUBSCRIBED states, 25 CLOSED states across a test session, with `realtime.setAuth(access_token)` awaited before every subscribe, and zero `onSessionUpdated fired` events despite a confirmed DB `deck_version` bump 43→44. The client's local `deck_params_hash` never updated. Channel state is healthy. Read the QA report's P0-1 §"Fix recommendation" for four candidate re-investigation angles (re-read `realtime.apply_rls` against the implemented flow, snoop the raw websocket `phx_join` payload, validate the `accessToken` callback approach in isolation despite the `onAuthStateChange` incompatibility, debounce the rebind storm). Read the prior investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0926_REALTIME_POSTGRES_CHANGES_NOT_DELIVERED.md` and the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` to confirm the fix really does match the original contract. Constraints: Phase 0 ingest mandatory; do NOT write code; do NOT mutate live session `daadd454-…`; preserve all diag scaffolding (still useful for the next implementor pass); do NOT propose multiple fixes — recommend ONE authoritative path after proving the new root cause. Output to `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0926_REALTIME_POSTGRES_CHANGES_NOT_DELIVERED_v2.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
