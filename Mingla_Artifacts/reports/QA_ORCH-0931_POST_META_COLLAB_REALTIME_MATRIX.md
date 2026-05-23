# QA ORCH-0931 — Post-META Collab Realtime + Preferences Matrix

**Mode:** TARGETED QA via Codex `tester-mingla` parity mirror  
**Date:** 2026-05-23  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Verdict:** **C / FAIL — bug 1 still alive**

## Executive Verdict

Bug 1 is **not healed** by META-ORCH-0929 single-mount relocation plus the ORCH-0926 scoped authenticated rebind. A UI-driven remote preference change on Sim A changed the DB source of truth from `deck_version=44`, `deck_params_hash=974f50f5...` to `deck_version=45`, `deck_params_hash=ce6f68cd...`, but Sim B received **0** `onSessionUpdated fired` callbacks and the client emitted **0** `collab params changed` invalidation logs between the scenario markers.

Severity counts:

| Severity | Count | Summary |
|---|---:|---|
| P0 | 1 | Realtime `collaboration_sessions` UPDATE delivery still does not reach the client after a proven DB hash/version bump. |
| P1 | 2 | Two-device same-session deck determinism failed; DB says `intersection_empty=true` while both clients still render cards. |
| P2 | 4 | Preferences sheet blanked after one apply, bug-3 path remains incoherent, Android AVD did not attach, sign-out/sign-in cycle needs operator re-auth approval. |
| P3 | 0 | None. |
| P4 | 2 | Selector map improved; Contract-1 source audit is now sharper. |

Hard guards held: no SQL mutation of live `daadd454-...`; all DB access was read-only via Supabase Management API. UI-driven changes through the app did mutate the live session as allowed by the dispatch. No push, PR, merge, migration, edge deploy, or product-code edit was performed.

## Phase 0.A Live-Fire Gate

PASS for the foundation gate. Scenario 1 selector discovery was solved live on iOS sim `2C3312D9-EE52-4EBD-9704-15811D49A2EC`.

`SIM_DRIVING_REFERENCE.md` was updated at `Mingla_Artifacts/sim_test_reference/SIM_DRIVING_REFERENCE.md:193` and `:246`:

| Gap | Result |
|---|---|
| Swipe pill selector | `tapOn: text: "Swipe Testing stuff"` works. Generic form: `tapOn: text: "Swipe .*"`. The live hierarchy exposes `accessibilityText=Swipe Testing stuff`; visible text-only `Swipe` is not the reliable target. |
| Testing stuff row selector | `tapOn: text: ".*Testing stuff.*"` works. The row exposes a parent label: `Group chat with 3 people, Testing stuff, Collab session, Marcus Rivera: Locked in...`. |

Evidence screenshots are under `Mingla_Artifacts/reports/evidence/ORCH-0931/`.

## Bug-1 Metrics

| Metric | Bar | Result | Evidence |
|---|---:|---:|---|
| Channel subscribe count per session entry | `<=3` | FAIL / unstable | Full current Metro log now has `105` `subscribing to channel: board_session` matches. A later isolated relaunch/open marker emitted no new realtime lines, so the clean per-entry delta could not be trusted. Prior ORCH-0926 failure was 58; the aggregate storm is not improved. |
| `onSessionUpdated fired` per remote pref change | `>=1` | **FAIL: 0** | Between `SCENARIO 2B T0` and `SCENARIO 2B T1`, grep count for `onSessionUpdated fired` was `0`. Full log count is also `0`. Callback source: `app-mobile/src/hooks/useBoardSession.ts:331`. |
| `deckParamsHash prev vs next` divergence in client diag | DIFFERENT hashes | **FAIL: no client diag fired** | DB changed `974f50f5...` -> `ce6f68cd...`, but between markers `collab params changed` count was `0`. Invalidation source: `app-mobile/src/contexts/RecommendationsContext.tsx:1662`. |

DB proof for the successful remote pref/hash change:

| Step | DB state |
|---|---|
| Before date change | `deck_version=44`, `deck_params_hash=974f50f575e17a6b...`, user `b17...` `date_option=today` |
| After UI `This Weekend` + `Lock It In` | `deck_version=45`, `deck_params_hash=ce6f68cda9e146d...`, user `b17...` `date_option=this_weekend`, aggregate `dateWindows=["this_weekend"]` |

## Per-Scenario Results

| Scenario | Result | Evidence |
|---|---|---|
| 1. Selector discovery | PASS | Live Maestro hierarchy and flows proved `.*Testing stuff.*` and `Swipe Testing stuff`; selector map updated. |
| 2. Two-sim realtime delivery | FAIL | Sim A changed prefs via UI; DB hash/version bumped; Sim B received `0` `onSessionUpdated fired`; screenshot: `simB_scenario2B_T1.png`. |
| 3. Same-GPS + same-prefs control | FAIL | With both sims set to DC, Sim A showed `National Gallery of Art`; Sim B showed `Regal Crossroads - Cary` at the top of the same session deck. Screenshots: `simA_deck_opened2.png`, `simB_deck_opened2.png`. |
| 4. Three-device intersection-empty repro | DEFERRED | No third authenticated device/account was available. The two-device leg already produced C/FAIL for bug 1. |
| 5. Field-by-field aggregator audit | PARTIAL / FAIL | `date_option` contributes: DB hash bumped 44 -> 45. Selecting a New York dropdown suggestion also contributed via coords: DB bumped 45 -> 46. Category toggle attempt persisted `icebreakers` but did not hash because another participant already contributed it. Source audit confirms `custom_location`, `location`, and `travel_constraint_type` are ghost/display metadata for aggregation. |
| 6. Bug 2 legibility | FAIL before legibility check | DB aggregate returns `intersection_empty=true`, but both clients rendered card decks instead of the dead-end sheet. Could not truthfully screenshot white-on-white dead-end text because the dead-end state did not render. |
| 7. Sign-out + sign-in cycle | BLOCKED / OPERATOR | Not run. Signing out would destroy the authenticated sim fixture, and Maestro cannot reliably complete OAuth re-auth. Needs operator to re-auth both sims immediately after sign-out. |
| 8. Token-refresh rebind | DEFERRED | No dev-only `refreshSession()` hook was found/driven; waiting for token expiry is infeasible in this turn. |
| 9. Android Pixel 8 Pro parity | DEFERRED | `Pixel_8_Pro` AVD exists and boot was attempted, but `adb devices` stayed empty and the emulator process exited before attachment. Android report leg needs a signed-in AVD fixture. |
| 10. Multi-city GPS roundtrip stress | NOT RUN after C/FAIL | Bug 1 was conclusively failed with a DB hash-changing UI pref update. Current participant prefs use stored custom coords, so raw sim GPS changes would not be a clean signal without first reconfiguring the account. |

## Bug 2 Evidence

Not reproduced as white-on-white because the deck rendered cards when the server-side aggregate said it should be geographically dead-ended.

Read-only DB probe after Scenario 2B:

- `aggregate.intersection_empty=true`
- participant circles include Raleigh (`ac7...`), DC (`b17...`), and Lagos (`c727...`)
- both iOS clients still rendered card surfaces

This is worse than a pure legibility bug for the current state: the client is not showing the server-authoritative empty state at all.

## Bug 3 Evidence

Exact persisted text/coord mismatch was **not** reproduced in this run.

Design contract registered from operator clarification: the custom location field is autocomplete-by-design. A user may type to search, but the app must not allow Enter/Apply/Lock It In to commit a custom location until the user selects a dropdown suggestion that provides coordinates.

Typed-only behavior after clearing location and typing `New York` without choosing a suggestion:

- UI displayed `New York`.
- CTA changed to `Add a starting point`.
- DB remained unchanged at `custom_location=Washington, District of Columbia, United States`, `custom_lat=38.8950982`, `custom_lng=-77.0363849`.

Operator correction was then applied: type `New York`, select `New York, New York, United States` from the dropdown, then `Lock It In`.

DB after selecting the suggestion:

- `deck_version=46`
- `deck_params_hash=917b35df56c5e523...`
- `custom_location=New York, United States`
- `location=New York, United States`
- `custom_lat=43.1561681`
- `custom_lng=-75.8449946`

So the selected-suggestion path updates both text and coordinates and bumps the deck hash. It does **not** prove the original persisted text/old-coord mismatch. It does expose a separate precision/product issue: the selected row text looked like New York City, but the saved label/coords are New York state centroid-ish (`43.1561,-75.8450`), not NYC (`~40.7128,-74.0060`).

Source still shows the invariant risk: `PreferencesSheet.tsx:890-892` writes `custom_location` from `searchLocation` and coordinates from `selectedCoords` independently, with no invariant that the text and coords came from the same selected suggestion.

Code-level autocomplete boundary:

- `PreferencesSheet.tsx:561-563` sets `searchLocation` from typed text and immediately clears `selectedCoords`.
- `PreferencesSheet.tsx:597-614` sets `searchLocation` and `selectedCoords` only after a dropdown suggestion is selected and coordinates validate.
- `PreferencesSheet.tsx:690-708` treats the custom location as complete only when `searchLocation.length > 0 && selectedCoords !== null`.

Leakage risk discovered during the pipeline trace: `RecommendationsContext.tsx:1409-1420` writes `custom_lat/custom_lng` from device GPS on every collab session entry when `userLocation` is present. That effect does **not** check the participant's stored `use_gps_location` preference. If a user chose a custom dropdown place, this entry effect can later overwrite the coordinates with device GPS while the text label remains custom, which is a plausible source of the text/coord mismatch class.

## Contract-1 Aggregator Audit

Aggregator reads these fields in `supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql:147-209`: `categories`, `category_toggle`, `intents`, `intent_toggle`, `date_option`, `selected_dates`, `datetime_pref`, `custom_lat`, `custom_lng`, `travel_mode`, `travel_constraint_value`.

Ghost / Contract-1 violation fields:

| Field | Evidence |
|---|---|
| `custom_location` | Written by the RPC/prefs save (`20260701000000...sql:468`, `PreferencesSheet.tsx:890`) but not read by `pg_aggregate_collab_prefs`; only coords affect circles. |
| `location` | Added client-side from `searchLocation` (`PreferencesSheet.tsx:899-900`) but not read by the aggregator. |
| `travel_constraint_type` | Stored as constant `'time'` (`PreferencesSheet.tsx:881`, migration `:462`) but not read by the aggregator; radius uses only `travel_mode` + `travel_constraint_value`. |

## Discoveries

1. `StartSwipingHeaderButton.tsx` is not imported anywhere in `app-mobile/src`; the live Swipe pill is the `MessageInterface` compact action row.
2. After one category apply, Sim A’s PreferencesSheet became an empty bottom sheet tree (`Bottom sheet backdrop`, `Bottom Sheet`, handle only). Cold relaunch recovered.
3. Two-device deck state is already divergent before realtime delivery is considered, which means ORCH-0909 determinism needs to be re-opened or folded into the next forensics pass.
4. The current Metro log had `105` board-session subscribe attempts and `0` `onSessionUpdated fired` occurrences.

## Required Operator Unblocks

BLOCKED — needs operator action for the remaining non-core matrix legs.

What I was trying to verify: Scenario 7 sign-out/sign-in teardown and Scenario 9 Android parity. What I need from you: confirm you are ready to re-auth the two iOS sims after sign-out, and provide or sign into a Pixel_8_Pro Android AVD test account in session `daadd454-...` or a fresh shared session. How to provide it: keep both iOS sims visible for OAuth after I trigger sign-out, then boot/sign into the Android AVD manually if the emulator still does not attach to `adb`. What I will do when you confirm: rerun Scenario 7 and Scenario 9 only, appending evidence to this report.

## NEXT HANDOFF

NEXT HANDOFF — paste into Claude `mingla-forensics`:

Re-investigate ORCH-0926 / ORCH-0931 on the forensics side because Codex `tester-mingla` returned `C / FAIL` in `Mingla_Artifacts/reports/QA_ORCH-0931_POST_META_COLLAB_REALTIME_MATRIX.md`: a UI-driven date preference change on iOS changed DB `deck_version` 44 -> 45 and `deck_params_hash` `974f50f5...` -> `ce6f68cd...`, but Metro still showed `0` `onSessionUpdated fired` and `0` client `collab params changed` invalidations. Primary inputs are this QA report, `Mingla_Artifacts/reports/QA_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`, and `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0926_REALTIME_POSTGRES_CHANGES_NOT_DELIVERED.md`; also inspect the selector updates in `Mingla_Artifacts/sim_test_reference/SIM_DRIVING_REFERENCE.md`. Hard guards: do not mutate live `daadd454-...` via SQL, preserve diag markers, do not push/open PR/merge, and treat the two-device deck divergence plus server `intersection_empty=true` while clients render cards as part of the same evidence bundle. Expected output is a root-cause investigation and one authoritative fix path; downstream routing is Codex `implementor-mingla` only after forensics proves whether this is Supabase realtime auth/join payload, client stale cache/query invalidation, ORCH-0909 deck-position divergence, or a combination. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
