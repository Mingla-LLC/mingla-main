# QA_ORCH-0939_ORCH-0931 Four-Device Live Matrix Retest 2

Date: 2026-05-23  
Mode: RETEST  
Verdict: FAIL  
Session under test: Testing stuff (`daadd454-35a8-487d-ab25-bb595abc4635`)  
Evidence directory: `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_2/`

## Inputs

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_ORCH-0931_GHOST_SESSION_REWORK_2.md`
- `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`
- Prior evidence under `Mingla_Artifacts/reports/evidence/ORCH-0939/`

## Summary

Automated regression gates pass, and ORCH-0931 realtime broadcast plumbing is visible: `session_updated` broadcasts invalidate and refetch `deck-cards` for the Testing stuff session. The live matrix still fails release criteria.

Two P1 blockers remain:

1. A new ghost-session query error fires after Android saves preferences / taps Lock It In: `deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.44`.
2. The full `CollabDeckSheet` does not show the same shared card as the chat Swipe sub-tab. The chat Swipe sub-tab shows `Nasher Museum of Art at Duke University -> Parizade` on all autonomous devices, while the full deck sheet shows `You are too far apart` on all three autonomous devices and on Seth's physical iPhone.

The exact prior ghost IDs `d5ca15ba-e6ce-4f95-a192-03b580e2017d` and `49f937fb-a2a2-406a-bda2-1cdb22367d34` did not recur in the captured logs, but the broader hero assertion explicitly forbids any ghost-session error. That assertion fails due `f706a421-0c70-4763-8bfe-3fe534218626`.

## Findings

### P1 - Ghost-session error still fires after preference broadcast

After the Android Pixel emulator opened Testing stuff, opened preferences, toggled a preference, and tapped Lock It In, the app broadcast `session_updated` for the correct Testing stuff session and refetched `daadd454-35a8-487d-ab25-bb595abc4635`. Within the same chain, the resolver/query path switched to a foreign session id:

```text
android_live.log:845 [REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=53
android_live.log:849 [ORCH-0923-DIAG] session_updated invalidating deck-cards { sessionId: 'daadd454-35a8-487d-ab25-bb595abc4635' }
android_live.log:850 [EDGE] -> discover-cards | body={"session_id":"daadd454-35a8-487d-ab25-bb595abc4635","current_position":44}
android_live.log:868 [EDGE] -> discover-cards | body={"session_id":"f706a421-0c70-4763-8bfe-3fe534218626","current_position":44}
android_live.log:875 [ORCH-0923-DIAG] collab params changed, invalidating deck-cards { prev: '{"sessionId":"daadd454-35a8-487d-ab25-bb595abc4635",...}'
android_live.log:895 [QUERY] ERROR deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.44 | DeckFetchError: discover-cards (collab v2) failed: Edge Function returned a non-2xx status code
```

The same ghost query reached both iOS simulators:

```text
simA_live.log:24073 [QUERY] ERROR deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.44 | DeckFetchError: discover-cards (collab v2) failed: Edge Function returned a non-2xx status code
simB_live.log:23028 [QUERY] ERROR deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.44 | DeckFetchError: discover-cards (collab v2) failed: Edge Function returned a non-2xx status code
```

Metro also captured the broadcast -> refetch -> foreign-session error chain:

```text
metro_retest_2.log:1953 #15 [NETWORK] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=53
metro_retest_2.log:1954 #16 [NETWORK] -> discover-cards | body={"session_id":"daadd454-35a8-487d-ab25-bb595abc4635","current_position":44}
metro_retest_2.log:1958 #20 [NETWORK] -> discover-cards | body={"session_id":"f706a421-0c70-4763-8bfe-3fe534218626","current_position":44}
metro_retest_2.log:1967 #29 [QUERY] ERROR deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.44 | error="discover-cards (collab v2) failed: Edge Function returned a non-2xx status code"
metro_retest_2.log:2008 [ORCH-0923-DIAG] collab params changed ... "prev": "{\"sessionId\":\"f706a421-0c70-4763-8bfe-3fe534218626\",...}", "sessionId": "daadd454-35a8-487d-ab25-bb595abc4635"
```

Screenshot evidence: `android_after_lock_it_in.png` shows the Android deck after Lock It In with the red query-error banner for `deck-cards.collab.f706a421-0c70-47...`.

### P1 - Full CollabDeckSheet diverges from the mounted chat Swipe deck

The chat Swipe sub-tab, mounted inside the Testing stuff chat, showed the same top shared card across the three autonomous devices:

- iOS Simulator #1: `simA_testing_stuff_chat_final.png` shows `Nasher Museum of Art at Duke University -> Parizade`, `2 stops`.
- iOS Simulator #2: `simB_testing_stuff_chat_final.png` shows `Nasher Museum of Art at Duke University -> Parizade`.
- Android Pixel emulator: `android_testing_stuff_chat.png` shows `Nasher Museum of Art at Duke University -> Parizade`.

The full deck sheet did not match that shared-card state:

- iOS Simulator #1: `simA_after_swipe_coord.png` shows Testing stuff full sheet with `You are too far apart` and `Shift preferences`.
- iOS Simulator #2: `simB_collab_deck_sheet.png` shows the same dead-end state.
- Android Pixel emulator: `android_collab_deck_sheet_retry.png` shows the same dead-end state.
- Physical iPhone: Seth reported, verbatim, "I see this and my location is raleigh. I took a screenshot of my preferences as well". `physical_iphone_seth_dead_end_IMG_0390.PNG` shows the same full-sheet dead-end. `physical_iphone_seth_preferences_IMG_0391.PNG` shows Testing stuff Vibes with current location enabled, This Weekend selected, curated experiences enabled with Romantic and Adventurous selected, and popular options enabled with Play and Icebreakers visible.

This violates the hero assertion that the same card appears at the same position across all devices with Testing stuff open. It also means the ORCH-0939 provider-wrap behavior is still not correct for the actual full `CollabDeckSheet` user path, even though the in-chat Swipe mount can show a shared card.

### P2 - Physical iPhone leg confirms full-sheet dead-end but not ghost-log status

The operator contract requires the physical iPhone to be driven by Seth only. Seth provided a fresh human-in-the-loop checkpoint after the autonomous P1 failures:

```text
I see this and my location is raleigh. I took a screenshot of my preferences as well
```

Physical iPhone screenshots copied into evidence:

- `physical_iphone_seth_dead_end_IMG_0390.PNG`: Testing stuff full sheet shows `You are too far apart`.
- `physical_iphone_seth_preferences_IMG_0391.PNG`: Testing stuff Vibes shows current location enabled, This Weekend selected, Romantic and Adventurous selected, and Play/Icebreakers visible.

This confirms the full-sheet dead-end on the fourth device. It does not independently confirm or deny physical-device console/log ghost status because the physical iPhone is not driven via CoreDevice/xctrace/idb/Maestro under the operator contract.

## Automated Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `CollabDeckSheet.ghostSessionRegression.test.tsx` compiled/run with Node | PASS | `PASS T-REWORK-GHOST CollabDeckSheet does not refetch stale or arbitrary foreign collab session ids` |
| `CollabDeckSheet.providerWrap.test.tsx` compiled/run with Node | PASS | `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider` |
| `realtimeService.orch-0931.test.ts` compiled/run with Node | PASS | ORCH-0931 realtime PASS T-IMP-1 through T-IMP-5 |
| Strict grep ORCH-0939 provider wrap | PASS | 3/3 checks passed, violations 0 |
| Strict grep ORCH-0931 no PK-filter realtime | PASS | Scanned 966 files, 64 postgres_changes listeners, violations 0 |

Automated coverage is useful but insufficient. The live failure proves the current tests do not cover the fresh-session preference/broadcast path that leaks `f706a421-0c70-4763-8bfe-3fe534218626`, nor the mismatch between chat-mounted Swipe and full `CollabDeckSheet`.

## Device Evidence Table

| Device | Actor | Evidence | Result |
| --- | --- | --- | --- |
| iOS Simulator #1 (`2C3312D9-EE52-4EBD-9704-15811D49A2EC`) | Ava / `sethogieva@gmail.com` | `simA_home_after_relaunch.png` proves Solo Explore still renders (`National Gallery of Art`). `simA_testing_stuff_chat_final.png` shows chat Swipe top card `Nasher Museum of Art at Duke University -> Parizade`. `simA_after_swipe_coord.png` shows full sheet dead-end. `simA_live.log:24073` shows `f706a421...` query error. | FAIL |
| iOS Simulator #2 (`F7ECAC25-2A98-4002-AD17-85AED17AB752`) | Priya / `hareefatoladauda@gmail.com` | `simB_home_after_relaunch.png` proves Solo Explore still renders (`Regal Crossroads - Cary`). `simB_testing_stuff_chat_final.png` shows chat Swipe top card `Nasher Museum of Art at Duke University -> Parizade`. `simB_collab_deck_sheet.png` shows full sheet dead-end. `simB_live.log:23028` shows `f706a421...` query error. | FAIL |
| Android Pixel emulator (`emulator-5554`) | Ethan Bennet / `eff78416...` | `android_home_after_relaunch.png` proves Solo Explore still renders (`The Pit Authentic Barbecue`). `android_testing_stuff_chat.png` shows chat Swipe top card `Nasher Museum of Art at Duke University -> Parizade`. `android_collab_deck_sheet_retry.png` shows full sheet dead-end. `android_after_lock_it_in.png` shows the red `f706a421...` query-error banner after Lock It In. | FAIL |
| Physical iPhone dev-build | Seth / `sethogieva@icloud.com` | Verbatim operator feedback: "I see this and my location is raleigh. I took a screenshot of my preferences as well". `physical_iphone_seth_dead_end_IMG_0390.PNG` shows Testing stuff full sheet dead-end. `physical_iphone_seth_preferences_IMG_0391.PNG` shows current location enabled with Raleigh reported by Seth, This Weekend selected, curated experiences enabled with Romantic and Adventurous selected, and popular options enabled with Play/Icebreakers visible. | FAIL for full-sheet hero assertion; ghost-log status unverified |

## Ghost ID Check

Command:

```bash
rg -n "\\[QUERY\\] ERROR deck-cards\\.collab\\.(d5ca15ba-e6ce-4f95-a192-03b580e2017d|49f937fb-a2a2-406a-bda2-1cdb22367d34)" Mingla_Artifacts/reports/evidence/ORCH-0939/retest_2/*.log || true
```

Result: no matches for the exact prior query-error IDs. However:

```bash
rg -n "\\[QUERY\\] ERROR deck-cards\\.collab" Mingla_Artifacts/reports/evidence/ORCH-0939/retest_2/*.log
```

Result: matches for `deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.44` in Android, iOS Simulator #1, iOS Simulator #2, and Metro logs.

## Solo Explore Regression

Solo Explore was spot-checked after relaunch on all autonomous devices and remained functional:

- `simA_home_after_relaunch.png`: `National Gallery of Art`
- `simB_home_after_relaunch.png`: `Regal Crossroads - Cary`
- `android_home_after_relaunch.png`: `The Pit Authentic Barbecue`

This regression check passes for the autonomous matrix.

## Closing / Teardown Assertion

The close-sheet teardown assertion was not completed as a PASS claim because the run hit P1 blockers first. The next retest must verify that closing the full `CollabDeckSheet` tears down session-scoped provider state and realtime callbacks after the ghost-session leak and full-sheet dead-end are fixed.

## Rework Vector

Route back to implementor with this failing vector:

`ORCH-0939_RETEST_2_F706_GHOST_AFTER_PREF_BROADCAST_AND_FULL_SHEET_DEAD_END`

Required rework:

1. Prove where `f706a421-0c70-4763-8bfe-3fe534218626` enters `collabDeckParams` after preference save / `session_updated`.
2. Prevent `CollabDeckSheet` and its nested provider/query path from ever resolving to an ambient or foreign collab session when `sessionId=daadd454-35a8-487d-ab25-bb595abc4635` is passed.
3. Align full `CollabDeckSheet` deck state with the chat Swipe sub-tab state, or explain with product-backed evidence why the two surfaces intentionally diverge.
4. Add a repo-running regression that fails before the fix and passes after for preference-save/broadcast changing from correct session id to a foreign session id.
5. Retest the four-device matrix, including a fresh Seth-operated physical iPhone checkpoint.

Downstream routing: FAIL -> Codex implementor-mingla for rework. Do not close ORCH-0939/ORCH-0931.
