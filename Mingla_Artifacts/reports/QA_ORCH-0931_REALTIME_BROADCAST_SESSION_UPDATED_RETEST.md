# QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_RETEST

**Date:** 2026-05-23  
**Branch:** `Seth`  
**Verdict:** FAIL  
**Tester:** Codex `$tester`  
**Session under test:** `daadd454-35a8-487d-ab25-bb595abc4635` (`Testing stuff`)

## Scope

Retest ORCH-0931 using:

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK.md`
- `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`

Hard guards honored:

- Did not weaken tests.
- Did not mutate live session `daadd454-35a8-487d-ab25-bb595abc4635` directly via SQL.
- Did not push, open PR, or merge.
- Did not apply migrations; only verified applied migration state.
- Android was attempted and not silently skipped.

## Findings

| Severity | Finding | Evidence | Result |
|---|---|---|---|
| P1 | Fresh live iOS broadcast was received, but the required deck-cards invalidation/refetch was not observed within 1s after the broadcast log. | `/tmp/orch0931-livefire-20260523.log:132-140` shows `broadcast session_updated` at `06:28:18`, three `[ORCH-0923-DIAG] onSessionUpdated fired` entries at `06:28:18`, and then only `preferences_updated` / `chat.participants`; no `collab params changed, invalidating deck-cards` or `deck-cards.collab...` refetch appeared in the post-broadcast window. | FAIL |
| P1 | Required non-participant authenticated denial was not completed. | Anonymous denial was proven, but no reusable authenticated non-participant credential/session was available in the retest environment. The attached Android app was logged in as Marcus and already had `Testing stuff` visible, so it was not a non-participant for this session. | FAIL |
| P1 | Android Pixel_8_Pro matrix was attempted but not completed. | `adb devices -l` showed `emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64`; app PID existed. A Maestro run initially targeted Android and failed with `io.grpc.StatusRuntimeException: UNAVAILABLE` / `Command failed (tcp:7001): closed`. Screenshot `/tmp/orch0931-android-current.png` showed the app responsive, but the required Android receive/denial matrix was not completed. | FAIL |
| P2 | Chat/presence/message no-regression matrix is not fully proven. | Chat participant polling continued after broadcast (`chat.participants...` at `/tmp/orch0931-livefire-20260523.log:140`), and board_session subscriptions were visible in Metro, but a controlled live message/presence/send-receive smoke was not completed after the failing refetch gate. | FAIL |

## Passing Evidence

| Gate | Evidence | Result |
|---|---|---|
| CI workflow wiring | `.github/workflows/strict-grep-mingla-business.yml:105` registers `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME`; `.github/workflows/strict-grep-mingla-business.yml:118-129` wires the job and runs both the test and strict-grep script. YAML parse passed. | PASS |
| Strict grep regression | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs` passed 2/2 tests. `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` passed: scanned 966 files, 64 postgres_changes listeners, 0 violations. | PASS |
| Focused app regression | `npx tsc --types react-native ...realtimeService.orch-0931.test.ts...` plus `node /tmp/orch-0931-test-retest/services/__tests__/realtimeService.orch-0931.test.js` passed T-IMP-1..T-IMP-4. | PASS |
| ESLint | `npx eslint src/services/realtimeService.ts src/hooks/useBoardSession.ts src/services/__tests__/realtimeService.orch-0931.test.ts` exited 0, with existing warnings in `useBoardSession.ts`. | PASS |
| Private broadcast channel code | `app-mobile/src/services/realtimeService.ts:414-416` uses `supabase.channel(channelName, { config: { private: true } })`; `app-mobile/src/services/realtimeService.ts:727-737` listens to `broadcast` event `session_updated` and dispatches `onSessionUpdated`. | PASS |
| Handler refetch path exists in code | `app-mobile/src/hooks/useBoardSession.ts:331-342` logs `[ORCH-0923-DIAG] onSessionUpdated fired`, merges the payload, and calls `loadSession(capturedSessionId)`. Runtime proved the handler fired, but did not prove deck-cards refetch. | PARTIAL |
| Remote migration applied | `/Users/sethogieva/bin/supabase migration list --linked` showed remote migration `20260724000001_orch_0931_realtime_broadcast_session_updated` applied. No migration was applied during retest. | PASS |
| DB trigger/function/policy shape | Read-only Supabase queries verified `notify_session_updated_via_broadcast`, trigger `tr_collaboration_sessions_broadcast_session_updated`, and realtime.messages RLS policy for authenticated session participants. | PASS |
| Anonymous denial | Node anon subscription to private `board_session:daadd454-35a8-487d-ab25-bb595abc4635` returned `CHANNEL_ERROR` with `Unauthorized: You do not have permissions to read from this Channel topic...` at `2026-05-23T10:30:07.883Z`. | PASS |

## Live-Fire Evidence

### iOS Two-Device Setup

- Sim A: `2C3312D9-EE52-4EBD-9704-15811D49A2EC` (`iPhone 17 Pro Max`)
- Sim B: `F7ECAC25-2A98-4002-AD17-85AED17AB752` (`iPhone 17`)
- Both booted and running `com.mingla.app.v2`.
- Sim A opened `Testing stuff`, opened Preferences, changed the `First Dates` preference via UI, and saved.
- Evidence flows added under `Mingla_Artifacts/reports/evidence/` for repeatable taps/screens.

### Required Broadcast Receipt

PASS. Post-save Metro capture:

```text
/tmp/orch0931-livefire-20260523.log:132
2026-05-23T06:28:18... LOG [REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=48

/tmp/orch0931-livefire-20260523.log:133-135
2026-05-23T06:28:18... LOG [ORCH-0923-DIAG] onSessionUpdated fired {"new_deck_params_hash":"566ec67a","new_deck_version":48,"sessionId":"daadd454-35a8-487d-ab25-bb595abc4635"}
```

Read-only DB confirmation from `realtime.messages`:

```text
topic=board_session:daadd454-35a8-487d-ab25-bb595abc4635
event=session_updated
inserted_at=2026-05-23 10:28:17.396291
payload.deck_version=48
payload.deck_params_hash=566ec67a8ad0877dce7288d3c2ea0f2d01622fa0114a1d184fa258d5ad92daa7
```

### Required Cache Invalidation / Refetch

FAIL. The required sequence was:

1. remote UI preference change
2. Sim B broadcast `session_updated`
3. `[ORCH-0923-DIAG] onSessionUpdated fired`
4. deck-cards invalidation/refetch within 1s

Steps 1-3 were proven. Step 4 was not. The fresh post-broadcast capture contains no `collab params changed, invalidating deck-cards` or `success deck-cards.collab...` after the `06:28:18` broadcast. The only subsequent query log in-window was `chat.participants`.

Important nuance: the broadcast payload had the same `deck_version=48` and same hash prefix `566ec67a` already present in the latest session state. That may explain why deck-card invalidation did not trigger, but the retest contract required explicit refetch evidence per remote pref change.

## Android Attempt

Android was attempted and not skipped.

Evidence:

```text
adb devices -l
emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:12

adb shell pidof com.mingla.app.v2
2670
```

A Maestro run initially targeted Pixel_8_Pro and failed before device interaction:

```text
Running on Pixel_8_Pro
io.grpc.StatusRuntimeException: UNAVAILABLE
Caused by: java.io.IOException: Command failed (tcp:7001): closed
```

Screenshot `/tmp/orch0931-android-current.png` confirmed the app itself was open and responsive on the Friends tab. However, the requested Android live matrix was not completed. Operator/dev-env action needed: unblock stable Maestro/ADB control for Pixel_8_Pro, or provide an authenticated non-participant fixture/device for the denial leg.

## Final Matrix

| Requirement | Verdict |
|---|---|
| CI workflow wiring | PASS |
| No PK-filter realtime guard runs | PASS |
| Remote migration applied, no reapply | PASS |
| Private channel uses broadcast `session_updated` | PASS |
| Live broadcast receipt per UI-driven pref change | PASS |
| `[ORCH-0923-DIAG] onSessionUpdated fired` | PASS |
| Deck-cards refetch within 1s after broadcast | FAIL |
| Anonymous channel JOIN returns `CHANNEL_ERROR` | PASS |
| Authenticated non-participant receives nothing | FAIL / NOT COMPLETED |
| Android Pixel_8_Pro attempted | PASS |
| Android live receive/denial matrix | FAIL / NOT COMPLETED |
| No regression to chat/presence/message flows | FAIL / NOT COMPLETED |

## Tester Decision

ORCH-0931 remains **FAIL**.

The rework fixed the CI workflow wiring and the core broadcast path is now demonstrably live on iOS. However, the remaining required live matrix is not closed because cache invalidation/refetch did not appear after the fresh broadcast, non-participant denial was not proven, Android was attachable but not controllable enough to complete the matrix, and chat/presence/message regression smoke was not completed.

## Required Next Step

Route back to `implementor-mingla` for rework.

Suggested rework targets:

1. Ensure a received `session_updated` broadcast causes an observable deck-cards invalidation/refetch when participant prefs change, or tighten the contract/logging so the tester can prove the intentional skip path when `deck_params_hash` is unchanged.
2. Add or document a repeatable authenticated non-participant test fixture for private realtime channel denial.
3. Stabilize Android test control for Pixel_8_Pro or provide an alternate required Android verification path.
4. Add a small live/manual QA script for chat, presence, and message smoke so ORCH-0931 can prove no realtime substrate regression.

