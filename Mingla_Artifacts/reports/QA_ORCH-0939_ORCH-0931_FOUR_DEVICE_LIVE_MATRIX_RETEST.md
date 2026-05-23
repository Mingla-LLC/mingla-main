# QA ORCH-0939 + ORCH-0931 Four-Device Live Matrix Retest

Date: 2026-05-23  
Tester: Codex tester-mingla  
Verdict: FAIL  
Branch: Seth  
Target session: `daadd454-35a8-487d-ab25-bb595abc4635` (`Testing stuff`)  
Evidence directory: `Mingla_Artifacts/reports/evidence/ORCH-0939/retest/`

## Executive Summary

The rework closes the previously named literal ghost `d5ca15ba-e6ce-4f95-a192-03b580e2017d`: that ID did not produce a deck query or console error during this retest.

The live matrix still fails because the same class of ghost-session query error reproduces with new session IDs. During valid `daadd454-35a8-487d-ab25-bb595abc4635` realtime broadcasts, devices refetched the correct collab deck and also issued `discover-cards` calls for unrelated sessions:

- `bbab695c-2bf3-4754-a613-78f7541789ff`
- `cc03e7d5-0d5d-4357-b962-6d9f2c00dde6`
- `49f937fb-a2a2-406a-bda2-1cdb22367d34`

All four devices also showed the `You are too far apart` empty/dead-end state instead of a shared place card at the same position, so the "same card appears at the same position" hero assertion is not satisfied.

## Inputs Reviewed

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_REWORK_GHOST_SESSION_ID.md`
- `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`
- Prior and retest evidence under `Mingla_Artifacts/reports/evidence/ORCH-0939/`

## Device Matrix

| Device | Account / role | Driver posture | Result | Evidence |
|---|---|---|---|---|
| iOS Simulator #1, iPhone 17 Pro Max `2C3312D9-EE52-4EBD-9704-15811D49A2EC` | Ava Thompson / `b17e3e15-218d-475b-8c80-32d4948d6905` | Autonomous via Metro + Maestro after foreground-close/relaunch | FAIL. Initial deck showed `You are too far apart`; later logged ghost errors for `bbab...`, `cc03...`, and `49f...`. | `simA_home_after_relaunch.png`, `simA_testing_stuff_deck_initial.png`, `simA_after_android_apply.png`, `simA_after_second_ghost.png`, `simA_live.log` |
| iOS Simulator #2, iPhone 17 `F7ECAC25-2A98-4002-AD17-85AED17AB752` | Priya Collins / `ac7f00ee-b87f-4eb8-86ea-772b9fc88afa` | Autonomous via Metro + Maestro after foreground-close/relaunch | FAIL. Initial deck showed `You are too far apart`; later logged ghost errors for `bbab...`, `cc03...`, and `49f...`. | `simB_home_after_relaunch.png`, `simB_testing_stuff_deck_initial.png`, `simB_after_android_apply.png`, `simB_after_second_ghost.png`, `simB_live.log` |
| Android Pixel emulator `emulator-5554` | Ethan Bennet / `eff78416-0d36-4bca-b350-10a6c3f046cb` | Autonomous via adb. Maestro attempted but unavailable due gRPC/tcp:7001 closure, preserved as evidence. | FAIL. Initial deck showed `You are too far apart`; applying preferences produced valid `daadd454` refetches and ghost errors for `bbab...` and `cc03...`. | `android_home_after_relaunch.png`, `android_testing_stuff_deck_initial.png`, `android_preferences_open.png`, `android_after_lock_it_in_retest.png`, `android_after_close_deck.png`, `android_live.log`, `maestro_android_tap_friends/` |
| Operator physical iPhone dev build | Seth / `sethogieva@icloud.com` | Human-in-the-loop only. Not driven by CoreDevice, xctrace, idb, or Maestro. | FAIL. Seth first reported the same dead-end screen, then reported a React Native console error for ghost session `49f937fb-a2a2-406a-bda2-1cdb22367d34`. | `physical_iphone_initial_dead_end_IMG_0388.PNG`, `physical_iphone_after_pref_error_IMG_0389.PNG`, `metro_retest.log` |

Seth verbatim feedback captured:

- Initial physical iPhone screen: "I see this"
- Physical iPhone after preference action/error: "I got this"

Screenshot-derived physical iPhone observations:

- `IMG_0388.PNG`: `Testing stuff` screen shows `You are too far apart`, helper text `Try increasing travel time so everyone has overlapping options.`, and `Shift preferences`.
- `IMG_0389.PNG`: React Native console error shows `[QUERY] ERROR deck-cards.collab.49f937fb-a2a2-406a-bda2-1cdb22367d34.44 | DeckFetchError: discover-cards (collab v2) failed: Edge Function returned a non-2xx status code`, source `queryClient.ts (150:20)`.

## Assertion Results

| Assertion | Result | Evidence |
|---|---:|---|
| Latest bundle and relaunch hygiene before run | PASS | `metro_retest.log` includes fresh iOS and Android bundle output; autonomous devices were relaunched via Expo dev-client deep links. |
| With `Testing stuff` open on all 4 devices, same card appears at same position | FAIL | All four devices showed the empty/dead-end state, not a shared place card. Screenshots: `simA_testing_stuff_deck_initial.png`, `simB_testing_stuff_deck_initial.png`, `android_testing_stuff_deck_initial.png`, `physical_iphone_initial_dead_end_IMG_0388.PNG`. |
| No `[QUERY] ERROR deck-cards.collab.d5ca15ba...` | PASS for the literal ID | `rg d5ca15ba` only hit iOS log filter predicate lines, not query/error lines. |
| No ghost-session query error of any kind | FAIL | Ghost errors reproduced for `bbab695c...`, `cc03e7d5...`, and `49f937fb...`. |
| Lock It In / preference apply broadcasts and triggers refetch on other devices | FAIL, with partial plumbing proven | Valid `daadd454` broadcast -> refetch is visible, but each broadcast wave is contaminated by unrelated session refetches/errors. |
| Closing CollabDeckSheet tears down session-scoped provider and callbacks cleanly | FAIL-gated / not accepted | Android close screenshot exists, but provider/refetch cleanliness cannot pass because foreign session invalidations occurred before close and the physical device then reproduced another ghost error. |
| Solo Explore on Home unaffected | PASS | Home screenshots after relaunch show solo deck cards on all autonomous devices: `simA_home_after_relaunch.png`, `simB_home_after_relaunch.png`, `android_home_after_relaunch.png`. |

## Log Excerpts

### Fresh bundle

`metro_retest.log`

```text
47:iOS Bundled 20162ms node_modules/expo-router/entry.js (4815 modules)
48:iOS Bundled 20206ms node_modules/expo-router/entry.js (1 module)
49:iOS Bundled 13432ms node_modules/expo-router/entry.js (1 module)
51:Android Bundled 16153ms node_modules/expo-router/entry.js (4826 modules)
```

### Android adb logcat: valid broadcast -> refetch plus ghost

`android_live.log`

```text
436:[REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=52
441:[EDGE] -> discover-cards | body={"session_id":"daadd454-35a8-487d-ab25-bb595abc4635","current_position":44}
459:[EDGE] -> discover-cards | body={"session_id":"bbab695c-2bf3-4754-a613-78f7541789ff","current_position":44}
487:[QUERY] ERROR deck-cards.collab.bbab695c-2bf3-4754-a613-78f7541789ff.44 | DeckFetchError: discover-cards (collab v2) failed: Edge Function returned a non-2xx status code
532:[QUERY] success deck-cards.collab.daadd454-35a8-487d-ab25-bb595abc4635.44 | dataType="object"
```

Second broadcast wave:

```text
591:[REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=53
596:[EDGE] -> discover-cards | body={"session_id":"daadd454-35a8-487d-ab25-bb595abc4635","current_position":44}
635:[EDGE] -> discover-cards | body={"session_id":"cc03e7d5-0d5d-4357-b962-6d9f2c00dde6","current_position":44}
673:[QUERY] ERROR deck-cards.collab.cc03e7d5-0d5d-4357-b962-6d9f2c00dde6.44 | DeckFetchError: discover-cards (collab v2) failed: Edge Function returned a non-2xx status code
718:[QUERY] success deck-cards.collab.daadd454-35a8-487d-ab25-bb595abc4635.44 | dataType="object"
```

### iOS simulator device logs

`simA_live.log`

```text
14966:2026-05-23 08:07:29.717 E Mingla ... [QUERY] ERROR deck-cards.collab.bbab695c-2bf3-4754-a613-78f7541789ff.44 | DeckFetchError...
15994:2026-05-23 08:08:34.666 E Mingla ... [QUERY] ERROR deck-cards.collab.cc03e7d5-0d5d-4357-b962-6d9f2c00dde6.44 | DeckFetchError...
17758:2026-05-23 08:10:52.150 E Mingla ... [QUERY] ERROR deck-cards.collab.49f937fb-a2a2-406a-bda2-1cdb22367d34.44 | DeckFetchError...
```

`simB_live.log`

```text
14389:2026-05-23 08:07:29.735 E Mingla ... [QUERY] ERROR deck-cards.collab.bbab695c-2bf3-4754-a613-78f7541789ff.44 | DeckFetchError...
15478:2026-05-23 08:08:34.732 E Mingla ... [QUERY] ERROR deck-cards.collab.cc03e7d5-0d5d-4357-b962-6d9f2c00dde6.44 | DeckFetchError...
17248:2026-05-23 08:10:52.016 E Mingla ... [QUERY] ERROR deck-cards.collab.49f937fb-a2a2-406a-bda2-1cdb22367d34.44 | DeckFetchError...
```

### Metro aggregate: physical iPhone ghost ID

`metro_retest.log`

```text
2012:LOG [REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=53
2044:LOG [EDGE] -> discover-cards | body={"session_id":"49f937fb-a2a2-406a-bda2-1cdb22367d34","current_position":44}
2047:LOG [ORCH-0923-DIAG] collab params changed, invalidating deck-cards {"next":"{\"sessionId\":\"49f937fb-a2a2-406a-bda2-1cdb22367d34\"...","prev":"{\"sessionId\":\"daadd454-35a8-487d-ab25-bb595abc4635\"..."}
2073:LOG [QUERY] ERROR deck-cards.collab.49f937fb-a2a2-406a-bda2-1cdb22367d34.44 | error="discover-cards (collab v2) failed: Edge Function returned a non-2xx status code"
2182:LOG [QUERY] success deck-cards.collab.daadd454-35a8-487d-ab25-bb595abc4635.44 | dataType="object"
```

### `d5ca15ba...` explicit check

Result: no deck query or query error for `d5ca15ba-e6ce-4f95-a192-03b580e2017d` appeared in runtime logs. The only matches were the iOS log-stream predicate itself:

```text
simA_live.log:2:Filtering the log data using ... CONTAINS "d5ca15ba"
simB_live.log:2:Filtering the log data using ... CONTAINS "d5ca15ba"
```

## Source / Regression Gates

These gates passed before and during live QA. They reduce risk around the intended source changes, but they did not catch the live arbitrary-ghost failure.

| Gate | Command / scope | Result |
|---|---|---:|
| ORCH-0939 ghost regression | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-ghost-retest && node /tmp/orch-0939-ghost-retest/CollabDeckSheet.ghostSessionRegression.test.js` | PASS: `PASS T-REWORK-GHOST CollabDeckSheet does not refetch stale prior collab session ids` |
| ORCH-0939 provider wrap | focused TypeScript compiled JS test for `CollabDeckSheet.providerWrap.test.tsx` | PASS: `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider` |
| ORCH-0931 realtime broadcast plumbing | focused TypeScript compiled JS test for `realtimeService.orch-0931.test.ts` | PASS: `PASS T-IMP-1..5` |
| ORCH-0939 strict grep | provider-wrap strict grep self-test + scan | PASS: `violations=0` |
| ORCH-0931 strict grep | no-PK-filter realtime strict grep self-test + scan | PASS: `0 violations` |

## Findings

### P1-001: Ghost-session query failures persist with arbitrary session IDs

The fix is not complete. The old `d5ca15ba...` vector is gone, but unrelated session IDs still become active collab deck query params during `Testing stuff` retests.

Evidence:

- Android: `android_live.log:459`, `487`, `635`, `673`
- iOS simulator #1: `simA_live.log:14966`, `15994`, `17758`
- iOS simulator #2: `simB_live.log:14389`, `15478`, `17248`
- Physical iPhone: `physical_iphone_after_pref_error_IMG_0389.PNG`; matching Metro aggregate at `metro_retest.log:2044`, `2073`

Impact: The bundled ORCH-0939 + ORCH-0931 close is blocked. Users can still hit red-screen query failures from foreign collab session IDs when interacting with a valid shared chat session.

### P1-002: Four-device shared-card assertion is not satisfied

All four devices opened `Testing stuff`, but the UI showed an empty/dead-end state (`You are too far apart`) rather than the same place card at the same position.

Evidence:

- `simA_testing_stuff_deck_initial.png`
- `simB_testing_stuff_deck_initial.png`
- `android_testing_stuff_deck_initial.png`
- `physical_iphone_initial_dead_end_IMG_0388.PNG`

Impact: Even aside from the ghost errors, the required live matrix success condition was not met.

### P1-003: ORCH-0931 broadcast -> invalidate -> refetch works for the valid session, but is contaminated

The realtime `session_updated` broadcast path does trigger valid `daadd454...` refetches within seconds. However, each wave also introduces or exposes foreign session queries. This means the ORCH-0931 plumbing is partly visible end-to-end, but the bundled behavior is not production-acceptable.

Evidence:

- Valid broadcast/refetch: `android_live.log:436`, `441`, `532`; `android_live.log:591`, `596`, `718`
- Contamination in same wave: `android_live.log:459`, `487`; `android_live.log:635`, `673`
- Cross-device contamination: iOS simulator and physical iPhone log excerpts above

## Hard-Guard Compliance

| Guard | Status |
|---|---:|
| Do not mutate `daadd454-...` via SQL | Complied. No SQL mutation performed. |
| Do not weaken existing tests | Complied. Tests were executed only. |
| Do not push, open PR, or merge | Complied. No git push/PR/merge. |
| Preserve ORCH-0931 + ORCH-0926 + ORCH-0939 production code as-is | Complied by tester. No production code edits made in this retest. |
| Physical iPhone human-in-the-loop only | Complied. Seth operated the physical device; tester captured Seth's feedback and screenshots. |
| Do not use `osascript ... keystroke` | Complied. |

## Rework Vector

Route back to Codex implementor-mingla for REWORK. The failing vector is:

> Arbitrary foreign collab session IDs still enter `deck-cards.collab.{sessionId}.{position}` query keys and `discover-cards` request bodies while the visible/open chat session is `daadd454-35a8-487d-ab25-bb595abc4635`.

Required implementation focus:

- Do not hardcode a fix for `d5ca15ba...`; the new failures prove this is a class bug.
- Trace why `collabDeckParams.sessionId` changes from `daadd454...` to unrelated IDs (`bbab...`, `cc03...`, `49f...`) during preference apply and realtime refetch.
- Inspect mounted/stale `CollabDeckSheet`, `PreferencesSheet`, `RecommendationsProvider`, `useBoardSession`, and any chat/banner/deck sheet parent state that can hold a prior `sessionId`.
- Add or update regression coverage so an arbitrary prior/foreign session ID cannot become the active query key, invalidation target, or `discover-cards` body while the sheet prop/session context remains `daadd454...`.
- Re-run this four-device matrix, including the physical iPhone human-in-the-loop contract, after rework.

NEXT HANDOFF - paste into Codex implementor-mingla: REWORK ORCH-0939 + ORCH-0931. QA retest on 2026-05-23 is FAIL. Literal ghost `d5ca15ba-e6ce-4f95-a192-03b580e2017d` is gone, but the same ghost-session class reproduces live with `bbab695c-2bf3-4754-a613-78f7541789ff`, `cc03e7d5-0d5d-4357-b962-6d9f2c00dde6`, and physical-iPhone/Metro `49f937fb-a2a2-406a-bda2-1cdb22367d34`. While `Testing stuff` / `daadd454-35a8-487d-ab25-bb595abc4635` is open, realtime `session_updated` broadcasts trigger valid `daadd454` refetches and also foreign `discover-cards` bodies/query keys. Evidence: `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST.md` and `Mingla_Artifacts/reports/evidence/ORCH-0939/retest/`. Fix the arbitrary foreign-session contamination, not just a named ID.
