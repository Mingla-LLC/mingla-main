# QA_ORCH-0939_ORCH-0931 Four-Device Live Matrix Retest 3

Date: 2026-05-23  
Mode: RETEST / SPEC-COMPLIANCE  
Verdict: CONDITIONAL PASS  
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
Session under test: Testing stuff (`daadd454-35a8-487d-ab25-bb595abc4635`)  
Foreign session under retest: `f706a421-0c70-4763-8bfe-3fe534218626`

## Inputs

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_ORCH-0931_RETEST_2_FOREIGN_SESSION_REWORK.md`
- `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_2.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`

## Executive Verdict

CONDITIONAL PASS for the Codex implementor rework, not release close.

The rework now has repo-running source regressions and code evidence for the exact retest-2 foreign-session vector. `f706a421-0c70-4763-8bfe-3fe534218626` is explicitly included in the regression and cannot produce `collabDeckParams` while Testing stuff is the resolved session. `session_updated` now rejects foreign payload ids and invalidates only `['deck-cards', 'collab', capturedSessionId]`.

This is not a full PASS because the required fresh four-device live matrix was not rerun after the rework, and Seth's physical iPhone leg remains a required manual checkpoint. The report therefore cannot honestly prove from fresh post-rework logs that `f706a421...` is gone after an actual UI preference save / live `session_updated`. It proves the code path and regression contract that should remove it.

## Findings

### P2 - Fresh four-device live proof is still missing

Retest 2 provided the live failure. The implementor report for Retest 3 explicitly says the four-device live matrix was not rerun. I found no `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_3/` evidence directory. Because Seth must operate the physical iPhone leg, Codex cannot close the manual-device proof independently.

This blocks a clean PASS but does not refute the code rework.

Required manual gate:

1. Seth opens Testing stuff on the physical iPhone.
2. Android or simulator saves preferences / taps Lock It In.
3. Capture Metro, Android, and iOS simulator logs.
4. Assert no `deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.*` query or network call occurs after `session_updated`.

### P2 - Chat Swipe divergence is stale-state evidence, while full-sheet dead-end is expected geography

The Retest 2 full `CollabDeckSheet` dead-end is supported by current server truth. Read-only SQL on 2026-05-23 showed:

- `collaboration_sessions`: Testing stuff is active with `deck_version=53` and `deck_params_hash=a3d20e25...`.
- `session_participants`: all four accepted participants are at `current_position=44`.
- `session_deck_cards`: Testing stuff has 44 frozen rows, min position 1 and max position 44; there is no position 45.
- `pg_aggregate_collab_prefs('daadd454...')`: `intersection_empty=true`, `acceptedCount=4`, `pending_gps_user_ids=[]`.
- Aggregated circles include Raleigh/Cary, DC, Lagos, and Raleigh/Cary radii, so the server's "no shared reachable places" verdict is expected for current geography.

The chat Swipe card seen in Retest 2, `Nasher Museum of Art at Duke University -> Parizade`, is not the current next card. Read-only SQL found it at `session_deck_cards.position=22`, generated at deck version 16. Position 44 is `Sky Zone Trampoline Park -> The Dominican Restaurant`, and position 45 does not exist. Therefore the Retest 2 full-sheet vs chat Swipe divergence is best classified as a stale chat-mounted Swipe state, not a full-sheet geography bug.

This should be queued as a separate stale-state investigation if it reproduces after the foreign-session rework.

## Claim Verification

| Claim | Result | Evidence |
| --- | --- | --- |
| CollabDeckSheet is session-scoped | VERIFIED | `app-mobile/src/components/connections/CollabDeckSheet.tsx:17` imports `RecommendationsProvider`; lines 116-122 wrap `SwipeableCards` with `currentMode={sessionId}`, `persistedSessionId={sessionId}`, and `key={sessionId}`. |
| Explicit session id wins over ambient currentSession | VERIFIED | `app-mobile/src/contexts/RecommendationsContext.tsx:350-368` resolves `propPersistedSessionId` and UUID `currentMode` before ambient `currentSession`. |
| Foreign board session rows cannot choose `collabDeckParams.sessionId` | VERIFIED | `RecommendationsContext.tsx:595-612` returns null when `sessionRow.id !== resolvedSessionId` and emits `sessionId: resolvedSessionId`. |
| Foreign `session_updated` payloads are ignored | VERIFIED | `app-mobile/src/hooks/useBoardSession.ts:343-350` reads `updatedSession?.session_id ?? updatedSession?.id` and returns when it differs from `capturedSessionId`. |
| Valid `session_updated` invalidates only the active collab deck key | VERIFIED | `useBoardSession.ts:373-380` invalidates `['deck-cards', 'collab', capturedSessionId]` and reloads the captured session. |
| Exact `f706a421...` retest-2 regression is automated | VERIFIED | `CollabDeckSheet.ghostSessionRegression.test.tsx:188-195` asserts a board row with `f706a421...` returns null while Testing stuff is resolved. |
| Full sheet dead-end is product-plausible | VERIFIED | `discover-cards` source uses server `current_position + 1` and returns `intersection_empty` when `agg.intersection_empty === true` (`supabase/functions/discover-cards/index.ts:827-833`, `1019-1026`). Read-only SQL shows current position 44, no row 45, and `intersection_empty=true`. |
| `f706a421...` is gone after real UI preference save / live `session_updated` | UNVERIFIED LIVE | No fresh Retest 3 live matrix logs exist. Source/regression proof passes, but the required runtime proof still needs the manual/live gate. |

## Automated Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Ghost regression compile | PASS | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-ghost-retest3` |
| Ghost regression run | PASS | `node /tmp/orch-0939-ghost-retest3/CollabDeckSheet.ghostSessionRegression.test.js` -> `PASS T-REWORK-GHOST CollabDeckSheet does not refetch stale or arbitrary foreign collab session ids` |
| Provider-wrap regression compile | PASS | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-provider-retest3` |
| Provider-wrap regression run | PASS | `node /tmp/orch-0939-provider-retest3/CollabDeckSheet.providerWrap.test.js` -> `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider` |
| ORCH-0931 regression compile | PASS | `cd app-mobile && npx tsc --types react-native src/services/realtimeService.ts src/hooks/useBoardSession.ts src/services/__tests__/realtimeService.orch-0931.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0931-retest3` |
| ORCH-0931 regression run | PASS | `node /tmp/orch-0931-retest3/services/__tests__/realtimeService.orch-0931.test.js` -> PASS T-IMP-1 through T-IMP-5 |
| ORCH-0939 strict-grep self-test and gate | PASS | `node --test .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs && node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` |
| ORCH-0931 strict-grep self-test and gate | PASS | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs && node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` |
| Scoped ESLint | PASS with existing warnings | `npx eslint ...` exited 0 with 18 warnings in `RecommendationsContext.tsx`; no errors. |
| Diff whitespace | PASS | `git diff --check -- ...` exited 0. |

## Read-Only Database Evidence

All database checks were SELECT/RPC read-only. I did not mutate `daadd454-35a8-487d-ab25-bb595abc4635` via SQL.

| Check | Result |
| --- | --- |
| Testing stuff session row | Active; `deck_version=53`; `deck_params_hash=a3d20e25de4215415fb0e4c98c27235a7763bca8991bddc4f5928ff046ecd824`; four participant prefs present. |
| Foreign session row | No `collaboration_sessions` row returned for `f706a421-0c70-4763-8bfe-3fe534218626` in the read-only query. |
| Testing stuff participants | Four accepted participants; all `current_position=44`. |
| Session deck rows | `session_deck_cards` has 44 rows for Testing stuff, min position 1, max position 44, and 0 rows for `f706a421...`. |
| Retest-2 chat card | `Nasher Museum of Art at Duke University -> Parizade` is position 22, generated at deck version 16. |
| Current server edge behavior | With every participant at position 44, `discover-cards` targets position 45; no frozen row exists, and current aggregate returns `intersection_empty=true`. |

## Device Matrix Status

| Device | Retest 3 status | Notes |
| --- | --- | --- |
| iOS Simulator #1 | NOT RERUN LIVE | Retest 2 had `f706a421...` query error. Source regression now covers the vector. Fresh log required. |
| iOS Simulator #2 | NOT RERUN LIVE | Same as above. |
| Android Pixel emulator | NOT RERUN LIVE | Retest 2 was the originating preference-save failure. Fresh Android save/Lock It In log required. |
| Physical iPhone | MANUAL GATE REQUIRED | Seth must operate this leg. Prior screenshot confirmed full-sheet dead-end; fresh post-rework ghost-log status remains unverified. |

## Regression Coverage Assessment

Regression coverage is acceptable for a conditional implementation pass:

- The exact `f706a421...` id is encoded in `CollabDeckSheet.ghostSessionRegression.test.tsx`.
- The test proves a foreign board row cannot produce `collabDeckParams` when Testing stuff is resolved.
- ORCH-0931 T-IMP-5 proves `session_updated` invalidates active collab `deck-cards` queries directly.
- Strict-grep gates preserve both ORCH-0939 provider wrapping and ORCH-0931 no-PK-filter realtime behavior.

Coverage gap:

- No automated/live test drives the full UI preference save -> `session_updated` -> device log chain. That gap is why this is not a PASS.

## Required Next Gate

Run a fresh four-device live matrix after this rework:

1. Open Testing stuff on Android, both iOS simulators, and Seth's physical iPhone.
2. On Android, open preferences, make a harmless UI preference toggle, and tap Lock It In.
3. Capture Android, both simulator, and Metro logs from the moment before save through refetch completion.
4. PASS condition for the foreign-session vector: no `discover-cards` request or `deck-cards.collab` query references `f706a421-0c70-4763-8bfe-3fe534218626`.
5. PASS condition for deck-state coherence: if full sheet shows `You are too far apart`, chat Swipe must not show stale position 22 content as the active card. If it does, route a separate stale chat-mounted Swipe rework.

## Downstream Routing

CONDITIONAL PASS -> route to `orchestrator-mingla` only if the operator accepts the missing fresh live matrix as a manual gate and queues the chat Swipe stale-state check separately. If the operator requires live proof before close, route to `tester-mingla` for a fresh Retest 4. If fresh logs still show `f706a421...` or chat Swipe still serves stale position 22 as the active card, route to `implementor-mingla` for rework.

## Next Handoff

NEXT HANDOFF — paste into Codex `orchestrator-mingla`:

Use orchestrator-mingla for CLOSE review on the Codex implementor/tester side with goal to decide whether `QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_3.md` is acceptable as a CONDITIONAL PASS or whether a fresh Retest 4 is required before close. Inputs are `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_3.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_ORCH-0931_RETEST_2_FOREIGN_SESSION_REWORK.md`, `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_2.md`, and `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`. Hard guards: Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`; do not mutate `daadd454-35a8-487d-ab25-bb595abc4635` via SQL; do not weaken tests; preserve ORCH-0931, ORCH-0926, and ORCH-0939 intent; Seth must operate the physical iPhone leg for any fresh live gate. Expected output is an orchestrator close/hold decision that explicitly handles the missing live proof for `f706a421...` and the evidence that full-sheet dead-end is expected geography while chat Swipe `Nasher Museum of Art at Duke University -> Parizade` was stale position-22 state; after accepted close route to launch artifact sync, otherwise route to tester-mingla for Retest 4 or implementor-mingla if fresh logs reproduce a bug.
