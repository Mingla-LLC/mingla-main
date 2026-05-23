# QA Report: ORCH-0939 + ORCH-0931 Four-Device Live Matrix

> Date: 2026-05-23
> Mode: TARGETED / SPEC-COMPLIANCE via Codex `tester-mingla`
> Verdict: FAIL
> Findings: P0:0 P1:3 P2:2 P3:0 P4:2
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> Target session: `daadd454-35a8-487d-ab25-bb595abc4635` (`Testing stuff`)

## 1. Layman Summary

The bundled ORCH-0939 + ORCH-0931 live gate does not pass.

The source-level ORCH-0939 provider wrap and ORCH-0931 broadcast invalidation tests pass. The live matrix does not. Three available devices were verified in the `Testing stuff` CollabDeckSheet: iOS Sim A / Ava Thompson, iOS Sim B / Priya Collins, and Pixel emulator / Ethan Bennet. All three rendered the same server-authoritative dead-end state (`You are too far apart`), not a same-position card/place. The required fourth iOS dev-build device was not visible to CoreDevice/xctrace.

The UI-driven Ethan apply path did update the live session without SQL mutation (`deck_version` 51 -> 52). Android/Ethan received `broadcast session_updated`, invalidated `deck-cards`, and refetched the correct collab key within seconds. However, the same event also triggered an invalid `discover-cards` call for nonexistent session `d5ca15ba-e6ce-4f95-a192-03b580e2017d`; both iOS sims surfaced `[QUERY] ERROR deck-cards.collab.d5ca15ba...` while open in `Testing stuff`. That blocks the bundled CLOSE.

Hard guards honored: no SQL mutation of the live session, no test weakening, no PR/push/merge, no product-code edits by tester, and no ORCH-0931 / ORCH-0926 code edits by tester. The only live mutation was an app UI `Lock It In` by Ethan Bennet, which is the requested participant-apply path.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- Implementation reports:
  - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
  - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`
- Prior QA:
  - `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`
  - `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_RETEST.md`
  - `Mingla_Artifacts/reports/QA_ORCH-0931_POST_META_COLLAB_REALTIME_MATRIX.md`
- Changed app files inspected by test commands:
  - `app-mobile/src/components/connections/CollabDeckSheet.tsx`
  - `app-mobile/src/hooks/useBoardSession.ts`
  - `app-mobile/src/services/realtimeService.ts`
  - `app-mobile/src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx`
  - `app-mobile/src/services/__tests__/realtimeService.orch-0931.test.ts`
- Evidence folder: `Mingla_Artifacts/reports/evidence/ORCH-0939/`

## 3. Device / Account Manifest

| Device | Runtime availability | Account | Evidence |
|---|---|---|---|
| iPhone 17 Pro Max sim `2C3312D9-EE52-4EBD-9704-15811D49A2EC` | Booted, app installed | Ava Thompson (`b17e3e15-...`) | Local app storage and screenshots `simA_launch.png`, `simA_after_ethan_apply.png` |
| iPhone 17 sim `F7ECAC25-2A98-4002-AD17-85AED17AB752` | Booted, app installed | Priya Collins (`ac7f00ee-...`) | Local app storage and screenshots `simB_launch.png`, `simB_after_ethan_apply.png` |
| Pixel emulator `emulator-5554` | Attached, app installed | Ethan Bennet (`eff78416-...`) | Android RKStorage auth token/user identity, screenshots `android_launch.png`, `android_after_swipe_tap.png` |
| iOS dev-build device | Not available to tester | Not verified | `xcrun devicectl list devices` returned no devices; `xcrun xctrace list devices` listed only the Mac under physical devices |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| ORCH-0939 wraps `CollabDeckSheet` deck in a per-session provider | Provider-wrap test and strict-grep gate | PASS source | Automated source evidence passes. |
| Same-position card shows identical place across all 4 devices in `CollabDeckSheet` | Live screenshots on 3 available devices; device inventory | FAIL / unverified | No card state appeared. All 3 available devices showed identical dead-end state. Fourth iOS dev-build device absent. |
| Ethan Bennet can apply prefs through UI | Android UI flow; read-only DB before/after | PASS | Ethan toggled `Romantic` and tapped `Lock It In`; DB moved `deck_version` 51 -> 52 and Ethan prefs gained `romantic`. |
| ORCH-0931 broadcast invalidates/refetches active collab deck within seconds | Android logcat, iOS sim logs/screenshots | PARTIAL / FAIL | Android/Ethan proved broadcast + invalidation + correct collab refetch. iOS sims showed a bad-session deck-cards error toast, and no clean PASS receipt. |
| ORCH-0931 and ORCH-0926 code untouched by tester | Git discipline; no apply_patch to product code | PASS tester discipline | Tester added evidence/report only. Existing product-code diffs predated this QA dispatch. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Device inventory | `xcrun simctl list devices booted`, `adb devices -l`, `xcrun devicectl list devices`, `xcrun xctrace list devices` | PARTIAL | Two iOS sims + Pixel available; no physical iOS dev-build device exposed. |
| Participant/account mapping | Local iOS AsyncStorage grep; Android `RKStorage` pull/read | PASS | Sim A = Ava, Sim B = Priya, Pixel = Ethan. |
| Current session state | Read-only Supabase `select` | PASS | Before apply: `deck_version=51`, hash `d5c33e9f...`, all participants at `current_position=44`. |
| Three-device CollabDeckSheet screenshot | Sim screenshots + Android screencap | PARTIAL | All 3 available devices showed `Testing stuff` and `You are too far apart`. Not a same-position card. |
| Ethan UI apply | Android tap: `Romantic` -> `Lock It In (1)` | PASS mutation path | DB after apply: `deck_version=52`, hash `46cd137c...`, Ethan intents include `romantic`. No SQL mutation. |
| Broadcast/refetch live log | Android `adb logcat -v time` | PARTIAL / FAIL | `07:34:47.685` broadcast v52; `07:34:47.687` invalidation; `07:34:47.731` correct `discover-cards` body; `07:34:53.321` `success deck-cards.collab.daadd454...44`. Also bad `d5ca15ba...` call/error. |
| iOS receiver behavior | `simctl log stream` + screenshots | FAIL | Both iOS sims showed `[QUERY] ERROR deck-cards.collab.d5ca15ba...` toast while open in `Testing stuff`. |
| ORCH-0939 provider regression | `cd app-mobile && npx tsc ...CollabDeckSheet.providerWrap.test.tsx...`; `node /tmp/orch-0939-provider-test-qa/CollabDeckSheet.providerWrap.test.js` | PASS | `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider`. |
| ORCH-0939 strict-grep | `node --test .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs`; `node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` | PASS | 3/3 test pass; gate pass with `violations=0`. |
| ORCH-0931 focused regression | `cd app-mobile && npx tsc --types react-native ...`; `node /tmp/orch-0931-rework-test-qa/services/__tests__/realtimeService.orch-0931.test.js` | PASS | T-IMP-1..T-IMP-5 pass, including direct deck-cards invalidation. |
| ORCH-0931 strict-grep | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs`; `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` | PASS | 2/2 test pass; scanned 966 files, 64 listeners, 0 violations. |

## 6. Findings

### P1 High

**P1-001: Four-device card assertion is not satisfied.**
- **Evidence:** `Mingla_Artifacts/reports/evidence/ORCH-0939/simA_launch.png`, `simB_launch.png`, `android_after_swipe_tap.png`; `xcrun devicectl list devices`; `xcrun xctrace list devices`.
- **What is wrong:** The requested hero assertion was "same-position card shows identical place across all 4 devices in the CollabDeckSheet." Only 3 devices were available, and they all showed the dead-end state instead of a card/place.
- **Impact:** The ORCH-0939 visible deck contract is not proven in the requested matrix. Identical dead-end is useful parity evidence, but it is not the requested same-card proof.
- **Required fix:** Provide/attach the fourth iOS dev-build device and make the live session enter a card-returning aggregate state through approved UI/account setup, or explicitly revise the tester acceptance to allow a dead-end parity assertion for this session state.
- **Retest:** Reopen `Testing stuff` CollabDeckSheet on all 4 devices and capture the same card title/place at the same `current_position`.

**P1-002: Live refetch path emits an invalid collab deck query for nonexistent session `d5ca15ba-e6ce-4f95-a192-03b580e2017d`.**
- **Evidence:** iOS logs `/tmp/orch0939-simA-live.log:1118`, `/tmp/orch0939-simB-live.log:1144`; iOS screenshots `simA_after_ethan_apply.png`, `simB_after_ethan_apply.png`; Android log `/tmp/orch0939-android-live.log:84630-84664`.
- **What is wrong:** While the visible sheet title is `Testing stuff`, the deck layer tries `deck-cards.collab.d5ca15ba-e6ce-4f95-a192-03b580e2017d.44`, and the server returns 404. Read-only DB lookup found no `collaboration_sessions` row for that id.
- **Impact:** The sheet can show query-error toasts during the core broadcast/refetch path. This directly blocks the bundled close because the live UI is not cleanly reading only the target session context.
- **Required fix:** Investigate where `d5ca15ba-e6ce-4f95-a192-03b580e2017d` is sourced. Prove `CollabDeckSheet` and any nested `SwipeableCards`/`RecommendationsProvider`/persisted-session path cannot swap from `daadd454-...` to stale or unrelated UUID during broadcast/refetch.
- **Retest:** Ethan applies a pref while Ava/Priya/Ethan/Fourth-device all keep `Testing stuff` open; logs show only `deck-cards.collab.daadd454-...` queries and no `d5ca15ba...` query/error.

**P1-003: ORCH-0931 broadcast refetch is only partially proven across devices.**
- **Evidence:** Android log `/tmp/orch0939-android-live.log:84492-84696`; iOS logs/screenshots listed above.
- **What is wrong:** Android/Ethan proves broadcast + invalidation + correct refetch. The iOS receiver evidence is not clean: both iOS sims surfaced the bad-session query error while open in the target sheet, and the iOS log stream did not show the required `broadcast session_updated` / `onSessionUpdated fired` / correct `deck-cards.collab.daadd454...` chain.
- **Impact:** The ORCH-0931 visibility blocker is not fully closed. The best available evidence says broadcast works on at least one device, but the target multi-device visible matrix still fails.
- **Required fix:** After P1-002 is fixed, rerun with device logs or Metro capture for all receiver devices and require per-device receipt/refetch evidence.
- **Retest:** For each receiver, capture timestamps: `broadcast session_updated`, `session_updated invalidating deck-cards`, `discover-cards body={"session_id":"daadd454-..."}`, and `success deck-cards.collab.daadd454...` or dead-end OK response.

### P2 Medium

**P2-001: Android Maestro remains unstable for this matrix.**
- **Evidence:** `maestro test --udid emulator-5554 Mingla_Artifacts/reports/evidence/orch0931_retest2_open_testing_deck.yaml` failed with `io.grpc.StatusRuntimeException: UNAVAILABLE` / `Command failed (tcp:7001): closed`.
- **Impact:** Android was testable through ADB taps/screenshots/logcat, but not via the repeatable Maestro path.
- **Required fix:** Stabilize Maestro driver/server for `emulator-5554` or document ADB-coordinate fallback as the official tester path.

**P2-002: Duplicate/stale broadcast receipts observed on Android.**
- **Evidence:** `/tmp/orch0939-android-live.log:84492-84532` shows broadcast `deck_version=52`, then additional `deck_version=51` broadcasts and repeated invalidations within ~150ms.
- **Impact:** The core refetch did happen, but repeated stale receipt/noisy invalidation can mask timing and increase fetch churn.
- **Required fix:** Investigate whether multiple subscriptions or stale private channel instances remain mounted after ORCH-0926/0931 rebinds.

### P4 Notes

- Source-level regression coverage for ORCH-0939 and ORCH-0931 is present and passing.
- Current server truth for `daadd454-...` is still `intersection_empty`; identical dead-end rendering across three devices is materially better than the previous solo-card leak, but it is not the requested card-place assertion.

## 7. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| ORCH-0939 SC-1: sheet renders session deck, not solo | PARTIAL | Three-device dead-end; Android correct `discover-cards` for `daadd454`; bad `d5ca15ba` query | P1-002 |
| ORCH-0939 SC-2 / T-TESTER-A1: same card at same position | FAIL / unverified | No card state; all available devices dead-ended; fourth iOS absent | P1-001 |
| ORCH-0939 SC-3 / T-TESTER-A2: remote pref change refetches visible deck within seconds | PARTIAL / FAIL | Android proves correct broadcast/refetch; iOS shows query error | P1-002, P1-003 |
| ORCH-0939 SC-5 / SC-6: strict-grep + unit regression | PASS | Local commands pass | None |
| ORCH-0931 broadcast handler invalidates active collab query | PASS source / PARTIAL live | T-IMP-5 passes; Android live pass | P1-003 |
| Hard guards | PASS | No SQL mutation; no product-code patch; no PR/push/merge | None |

## 8. Security / Data Safety

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| No SQL mutation of `daadd454-...` | Gate | Only read-only Supabase `select` queries were executed. Ethan pref change was through app UI. | PASS |
| No PR/push/merge | Gate | No git push/PR/merge commands run. | PASS |
| No test weakening | Gate | Tests were run as-is. | PASS |
| Private broadcast RLS/non-participant denial | Out of scope in this dispatch | Not re-run here because the user specified the four-device live matrix hero assertions. | UNVERIFIED in this report |

## 9. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Consumer iOS Sim A | Yes | FAIL / partial | Dead-end parity; bad-session query toast after Ethan apply. |
| Consumer iOS Sim B | Yes | FAIL / partial | Dead-end parity; bad-session query toast after Ethan apply. |
| Consumer Android Pixel / Ethan | Yes | PARTIAL | Correct broadcast/refetch proven, but same bad-session query also occurs in log. |
| iOS dev-build device | No | BLOCKED | Not visible to CoreDevice/xctrace. |
| Business/Admin/Public | N/A | N/A | Not in scope. |
| Solo Explore regression | No | UNVERIFIED | Not run after live matrix blocker. |

## 10. Required Actions

1. **P1-002:** Route to `implementor-mingla` to eliminate the bad `d5ca15ba-e6ce-4f95-a192-03b580e2017d` session resolution/query during CollabDeckSheet broadcast/refetch.
2. **P1-001:** Provide a usable fourth iOS dev-build device and a card-returning test state, or revise the tester gate to accept identical dead-end parity for this specific server state.
3. **P1-003:** Rerun the receiver matrix after P1-002 with per-device logs proving broadcast -> invalidate -> correct `daadd454` refetch.

## 11. Next Handoff

NEXT HANDOFF - paste into Codex `implementor-mingla`:

Codex `tester-mingla` returned FAIL for the bundled ORCH-0939 + ORCH-0931 live matrix in `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX.md`; the target session is `daadd454-35a8-487d-ab25-bb595abc4635` (`Testing stuff`) and the live blocker is that CollabDeckSheet/broadcast refetch emits `deck-cards.collab.d5ca15ba-e6ce-4f95-a192-03b580e2017d.44` even though that session does not exist and the visible sheet is `Testing stuff`. Inputs are the QA report, `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`, and `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`; evidence screenshots live under `Mingla_Artifacts/reports/evidence/ORCH-0939/`. Hard guards: do not mutate `daadd454-...` via SQL, do not weaken tests, do not push/open PR/merge, and preserve ORCH-0931 + ORCH-0926 code unless the root cause proves a bounded change is required and you name it explicitly. Expected output is a rework report with a failing regression for the stale/nonexistent session-id query, a fix, and local gates; downstream routing is back to Codex `tester-mingla` for the four-device live retest, then Codex `orchestrator-mingla` for bundled CLOSE only after PASS; Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
