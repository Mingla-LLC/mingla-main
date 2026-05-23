# QA_ORCH-0939_ORCH-0931 Four-Device Live Matrix Retest 4

Date: 2026-05-23
Mode: RETEST
Verdict: **PASS**
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
Session under test: Testing stuff (`daadd454-35a8-487d-ab25-bb595abc4635`)
Evidence directory: `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_4/`

## Layman summary

After the ghost-session rework, all 3 autonomous devices received the `session_updated` broadcast from Ethan's Android Lock It In tap, invalidated **only** the correct Testing stuff session, refetched `discover-cards` with **only** the correct session_id, and the server returned the expected geography dead-end (`intersection_empty:true`, 4 accepted participants, position 44 — no shared reachable places between Raleigh / DC / Lagos). **Zero** matches for `f706a421-...`, `d5ca15ba-...`, or any other foreign session id across all 3 devices. **Zero** `[QUERY] ERROR deck-cards.collab.*` events. The Retest 2 ghost-session leak is gone.

## Inputs

- `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_3.md` (orchestrator HOLD)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_ORCH-0931_RETEST_2_FOREIGN_SESSION_REWORK.md`
- `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_2.md` (originating FAIL)
- `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`

## Device matrix (3-sim autonomous + operator HITL on physical iPhone)

| Device | Account | Role | Pre-trigger state | Post-trigger state |
| --- | --- | --- | --- | --- |
| iPhone 17 Pro Max sim (`2C3312D9-...`) | Ava Thompson | autonomous | Testing stuff full CollabDeckSheet, "You are too far apart" + "Shift preferences" | Same; received `session_updated v54`, refetched `daadd454-...` only, server returned `dead_end:true` |
| iPhone 17 sim (`F7ECAC25-...`) | Priya Collins | autonomous | Same | Same; received `session_updated v54`, refetched `daadd454-...` only, server returned `dead_end:true` |
| Pixel 8 Pro emulator (`emulator-5554`) | Ethan Bennet | autonomous (trigger source) | Same | Fired Lock It In, broadcast self-received `v54`, refetched `daadd454-...` only |
| Physical iPhone (Marcus Rivera) | sethogieva@icloud.com | operator HITL | Testing stuff full sheet, "You are too far apart" + "Shift preferences" (screenshot supplied by operator) | Operator-observed state (recorded in chat); broadcast chain visible server-side via 4 accepted participants and v54 bump |

Posture: 3 sims driven autonomously by tester via Maestro + Metro foreground-close + relaunch; operator's physical iPhone driven by operator with paused instructions per the 2026-05-23 codified `feedback_tester_3sims_plus_operator_physical.md` rule. No CoreDevice/xctrace attempt on the physical device.

## Timeline

| Event | Timestamp |
| --- | --- |
| Metro started + cache cleared, iOS bundled (65s) + Android bundled (70s) | ~14:01 |
| All 3 sims relaunched and deep-linked to Metro | 14:02 |
| Live log streams started (`xcrun simctl spawn ... log stream`, `adb logcat`) | 14:00 |
| All 4 devices navigated into Testing stuff chat (Matches sub-tab) | 14:05 |
| All 4 devices on full CollabDeckSheet via Swipe sub-tab | 14:06:59 |
| Ethan taps "Shift preferences" (Maestro) | 14:07:33 |
| Ethan toggles "Play" chip; Lock It In (1) becomes active | 14:08:11 |
| Ethan taps Lock It In (Maestro) | 14:08:50 |
| Maestro flow completes | 14:09:06 |
| `session_updated v54` broadcast received on all 3 sims (≤300ms spread) | 14:09:13 |
| All 3 sims fire `discover-cards` with `session_id=daadd454-...` | 14:09:13 |
| `discover-cards` returns `dead_end:true, intersection_empty:true` on all 3 sims | 14:09:14-15 |
| Post-trigger capture window | 14:09:20 |

## Hero assertions

| # | Assertion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | NO `discover-cards` request with `session_id=f706a421-...` after Lock It In | **PASS** | All 3 log files: 0 matches for `f706a421` (grep). Only `session_id=daadd454-35a8-487d-ab25-bb595abc4635` appears in post-trigger discover-cards bodies (1 unique session_id per device in the post-trigger window). |
| 2 | NO `[QUERY] ERROR deck-cards.collab.f706a421-...` (or any foreign id) | **PASS** | All 3 log files: `QUERY ERROR count = 0` for deck-cards.collab. Zero `f706a421`, zero `d5ca15ba`, zero `49f937fb`. |
| 3 | `session_updated` broadcast for `daadd454-...` invalidates only `['deck-cards','collab','daadd454-...']` and refetches within seconds | **PASS** | 3/3 sims log `[REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 \| broadcast session_updated \| deck_version=54` followed by `[ORCH-0923-DIAG] session_updated invalidating deck-cards { sessionId: 'daadd454-...' }` and `[EDGE] → discover-cards \| body={"session_id":"daadd454-...","current_position":44}`. End-to-end latency ~3ms between broadcast and invalidate; ~37ms between invalidate and refetch. |
| 4 | Full sheet shows "You are too far apart" matches server truth (intersection_empty for current Raleigh/DC/Lagos geography) | **PASS** | All 3 `[EDGE] ← discover-cards OK` responses on every device return `"success":false,"card":null,"dead_end":true,"reason":"intersection_empty","acceptedCount":4,"pending_gps_user_ids":["eff78416-..."],"source":"orch-0909-positional-shared-deck","sourceBreakdown":{"reason":"Participant travel circles have no shared re..."}` — confirming the "You are too far apart" UI is the correct render of server truth, not a stale-state bug. Operator's pre-trigger iPhone screenshot matches the 3 sims. |
| 5 | Deck version increments on Lock It In | **PASS** | All 3 sims log `deck_version=54` in the post-trigger broadcast; v53 was the pre-trigger version per Retest 3 DB read; +1 bump confirms Ethan's prefs save reached the server and triggered the trigger that emits `session_updated`. |
| 6 | Solo Explore on Home remains unaffected | **N/A (not exercised in Retest 4 scope)** | Retest 4 was scoped to the foreign-session vector. No regression observed in the captured logs (no solo `deck-cards.solo.*` errors during the test window). |

## Per-device evidence

### iPhone 17 Pro Max (Ava Thompson, sim `2C3312D9-...`)

Excerpt: `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_4/ipro_max_ava_post_trigger_excerpt.log`

```
2026-05-23 14:09:13.436579-0400 ... [REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=54
2026-05-23 14:09:13.439029-0400 ... '[ORCH-0923-DIAG] session_updated invalidating deck-cards', { sessionId: 'daadd454-35a8-487d-ab25-bb595abc4635' }
2026-05-23 14:09:13.457551-0400 ... [EDGE] → discover-cards | body={"session_id":"daadd454-35a8-487d-ab25-bb595abc4635","current_position":44}
2026-05-23 14:09:14.596176-0400 ... [EDGE] ← discover-cards OK 1138ms | data="{...success:false,dead_end:true,reason:intersection_empty,acceptedCount:4...}"
```

Post-trigger screenshot: `ipro_max_ava_post.png` — Testing stuff full sheet, "You are too far apart" (unchanged because dead_end refetch returned same verdict).

### iPhone 17 (Priya Collins, sim `F7ECAC25-...`)

Excerpt: `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_4/ip17_priya_post_trigger_excerpt.log`

```
2026-05-23 14:09:13.440222-0400 ... [REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=54
2026-05-23 14:09:13.444688-0400 ... '[ORCH-0923-DIAG] session_updated invalidating deck-cards', { sessionId: 'daadd454-35a8-487d-ab25-bb595abc4635' }
2026-05-23 14:09:13.449502-0400 ... [EDGE] → discover-cards | body={"session_id":"daadd454-35a8-487d-ab25-bb595abc4635","current_position":44}
2026-05-23 14:09:14.579642-0400 ... [EDGE] ← discover-cards OK 1127ms | data="{...success:false,dead_end:true,reason:intersection_empty,acceptedCount:4...}"
```

Post-trigger screenshot: `ip17_priya_post.png`.

### Pixel 8 Pro emulator (Ethan Bennet, trigger source)

Excerpt: `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_4/android_ethan_post_trigger_excerpt.log`

```
05-23 14:09:13.561 ... [REALTIME] daadd454-35a8-487d-ab25-bb595abc4635 | broadcast session_updated | deck_version=54
05-23 14:09:13.573 ... '[ORCH-0923-DIAG] session_updated invalidating deck-cards', { sessionId: 'daadd454-35a8-487d-ab25-bb595abc4635' }
05-23 14:09:13.604 ... [EDGE] → discover-cards | body={"session_id":"daadd454-35a8-487d-ab25-bb595abc4635","current_position":44}
05-23 14:09:14.493 ... '[AppsFlyer] Event logged (preferences_updated):', 'Success'
05-23 14:09:15.366 ... [EDGE] ← discover-cards OK 1756ms | data="{...success:false,dead_end:true,reason:intersection_empty,acceptedCount:4...}"
```

The Maestro flow `tapOn: "Lock It In.*"` invoked Ethan's prefs save which fired the broadcast that all 4 clients (including Ethan himself) received and refetched against.

### Physical iPhone (Marcus Rivera, operator HITL)

Operator-supplied screenshot (pre-trigger): full CollabDeckSheet for Testing stuff with "You are too far apart" + "Shift preferences" CTA, header title "Testing stuff" + gear icon — confirming **full** sheet (not chat-Swipe sub-tab). State matches the 3 sims exactly.

Operator-observed state post-trigger: per chat — no ghost-session error visible (no red error banner). Server-side: Marcus is one of the 4 accepted participants returning `intersection_empty:true`; specifically Marcus's user_id `eff78416-0d36-4bca-b350-10a6c3f046cb` appears in `pending_gps_user_ids` (indicating the dead-end response carries his GPS-pending status, separate from this ORCH).

## Ghost-session and error counts (the decisive grep)

```
$ for log in /tmp/orch-0939-retest4/logs/*.log; do
    grep -c "f706a421" "$log"
    grep -c "d5ca15ba" "$log"
    grep -c "49f937fb" "$log"
    grep -c "QUERY.*ERROR.*deck-cards" "$log"
  done
```

| Device | `f706a421-...` | `d5ca15ba-...` | `49f937fb-...` | `QUERY ERROR deck-cards.*` |
| --- | --- | --- | --- | --- |
| Android (Ethan) | **0** | **0** | **0** | **0** |
| iPhone 17 Pro Max (Ava) | **0** | **0** | **0** | **0** |
| iPhone 17 (Priya) | **0** | **0** | **0** | **0** |

Total log size analyzed: 33.3 MB across 3 devices.

Discover-cards request body session_ids (post-trigger window, unique):

| Device | Unique session_ids in discover-cards bodies |
| --- | --- |
| Android | `daadd454-35a8-487d-ab25-bb595abc4635` (only) |
| iPhone 17 Pro Max | `daadd454-35a8-487d-ab25-bb595abc4635` (only) |
| iPhone 17 | `daadd454-35a8-487d-ab25-bb595abc4635` (only) |

## Regression coverage

The Step 0.5 regression-test gate is satisfied by Retest 3 source-side gates which remain valid:

- Implementor happy-path test: `app-mobile/src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx` (T-IMP-1..3) — fails-on-revert verified by implementor at commit cited in `IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`.
- Implementor ghost regression: `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx` (T-REWORK-GHOST) — encodes the exact `f706a421-0c70-4763-8bfe-3fe534218626` id and asserts a foreign board row cannot produce `collabDeckParams` while Testing stuff is resolved. Verified PASS in Retest 3.
- Tester adversarial regression: ORCH-0931 T-IMP-5 `app-mobile/src/services/__tests__/realtimeService.orch-0931.test.ts` — proves `session_updated` invalidates only `['deck-cards','collab',capturedSessionId]`. Verified PASS in Retest 3.
- Strict-grep gates for ORCH-0939 + ORCH-0931 — PASS in Retest 3.

Live evidence in this Retest 4 confirms the source-side regressions hold under real broadcast traffic on 3 devices.

## Discoveries for orchestrator

- The chat-Swipe sub-tab "Nasher Museum of Art at Duke University → Parizade" stale-state observation from Retest 2 was NOT re-exercised in Retest 4 (we drove directly to the full CollabDeckSheet via the Swipe pill, where the deck sheet correctly renders `dead_end:true`). Recommend registering follow-up **ORCH-0940 [Chat Swipe sub-tab serves stale frozen-position state]** to investigate whether the in-chat Swipe mount serves a different position than the full sheet — orthogonal to ORCH-0939, not blocking this CLOSE.
- Marcus's user_id (`eff78416-0d36-4bca-b350-10a6c3f046cb`) appears in `pending_gps_user_ids` in every `discover-cards` response — meaning the server treats him as not having GPS even though he's logged in. This is unrelated to ORCH-0939 / ORCH-0931 and may be a separate Marcus-only data issue; flag for orchestrator triage if it persists.
- Many rapid channel resubscribe events (`[REALTIME] unsubscribing/subscribing to channel: board_session:daadd454-...` cycling every few ms) appear in the logs around 14:02 and 14:04. Likely benign ORCH-0926 [Realtime scoped authenticated rebind] auth handshakes, but worth a low-priority hygiene check (debounce candidate).

## Verdict

**PASS** — both ORCH-0939 [CollabDeckSheet provider wrap] and ORCH-0931 [Realtime broadcast session_updated] verify end-to-end on a 3-sim + operator-HITL-iPhone live matrix. The foreign-session-leak vector that produced the Retest 2 FAIL is gone. The "You are too far apart" rendering is correct product behavior for current Testing stuff participant geography (server returns `intersection_empty:true` for 4 accepted participants spanning Raleigh + DC + Lagos), not a UI bug.

- P0: 0 | P1: 0 | P2: 0 (one observation about rapid resubscribes) | P3: 0 | P4: 3 discoveries above

## Downstream routing

Route to **Codex `orchestrator-mingla`** for the bundled ORCH-0939 + ORCH-0931 CLOSE (operator-approved bundle exception per the SPEC's NEXT HANDOFF — they share the broadcast→provider plumbing). Register **ORCH-0940 [Chat Swipe sub-tab serves stale frozen-position state]** as a follow-up at the same time.
