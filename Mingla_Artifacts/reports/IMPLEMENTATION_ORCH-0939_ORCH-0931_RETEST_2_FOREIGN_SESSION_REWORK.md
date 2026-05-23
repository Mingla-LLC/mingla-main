# IMPLEMENTATION_ORCH-0939_ORCH-0931 Retest 2 Foreign Session Rework

Date: 2026-05-23  
Status: implemented, partially verified  
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

## Inputs

- `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_2.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_ORCH-0931_GHOST_SESSION_REWORK_2.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`

## Scope

Reworked failing vector `ORCH-0939_RETEST_2_F706_GHOST_AFTER_PREF_BROADCAST_AND_FULL_SHEET_DEAD_END`.

Hard guards honored:

- Did not mutate `daadd454-35a8-487d-ab25-bb595abc4635` via SQL.
- Did not push, open PR, or merge.
- Did not weaken existing tests.
- Preserved ORCH-0931 scoped broadcast invalidation, ORCH-0926 authenticated realtime rebinding, and ORCH-0939 per-session provider intent.

## Root Cause Proof

The retest-2 logs prove the full-sheet provider had explicit Testing stuff resolution while the collab query session flipped:

- `android_live.log:870` still logged `resolvedSessionId: 'daadd454'`.
- `android_live.log:875-877` logged `collab params changed` from `daadd454-35a8-487d-ab25-bb595abc4635` to `f706a421-0c70-4763-8bfe-3fe534218626`.
- `android_live.log:868` and `metro_retest_2.log:2042` show the leaked network call: `discover-cards` with `session_id=f706a421-0c70-4763-8bfe-3fe534218626`.

That means the explicit `CollabDeckSheet` session owner was not the value that flipped. The leak entered through mutable board session state: `collabDeckParams` trusted `boardSessionResult.session.id`. If a stale or foreign session row/update entered `useBoardSession`, `resolvedSessionId` could remain Testing stuff while `collabDeckParams.sessionId` became foreign.

## Too Far Apart Nuance

I did not treat the full-sheet dead-end as automatically wrong. Retest-2 evidence shows the correct Testing stuff session returned a server verdict:

- `discover-cards` for `daadd454-35a8-487d-ab25-bb595abc4635` returned `success:false`, `dead_end:true`, `reason:"intersection_empty"`, `acceptedCount:4`, `pending_gps_user_ids:[]`.
- The server `sourceBreakdown.reason` was `Participant travel circles have no shared reachable places.`
- The operator clarified participants may genuinely be in Raleigh, New York, and DC.

Given that, the full-sheet `You are too far apart` state is product-plausible for the live Testing stuff geography. The chat Swipe sub-tab showing `Nasher Museum of Art at Duke University -> Parizade` appears to be stale or divergent deck state relative to the current server verdict; this rework fixes the foreign-session leak and leaves the live matrix to verify whether chat-mounted Swipe still needs a separate stale-state fix.

## Changes

### `app-mobile/src/hooks/useBoardSession.ts`

- Added a defensive load guard: if a session SELECT ever returns an id different from the requested id, the hook ignores it and marks the load invalid.
- Added a `session_updated` guard: realtime payloads with `session_id` or `id` that do not match the subscribed `capturedSessionId` are ignored before state mutation.
- Kept ORCH-0931 behavior: valid `session_updated` broadcasts invalidate only `['deck-cards', 'collab', capturedSessionId]` and call `loadSession(capturedSessionId)`.

### `app-mobile/src/contexts/RecommendationsContext.tsx`

- The collab cursor effect now ignores board session rows whose `sessionRow.id` does not match `resolvedSessionId`.
- `collabDeckParams` now rejects mismatched rows and uses `sessionId: resolvedSessionId`, not `sessionRow.id`, as the query owner.
- This prevents `CollabDeckSheet` and nested `useDeckCards` from resolving to ambient or foreign session ids when an explicit session id is passed.

### `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx`

- Extended the repo-running regression with the retest-2 foreign id `f706a421-0c70-4763-8bfe-3fe534218626`.
- Added assertions that `collabDeckParams` rejects a foreign board session row while Testing stuff is resolved.
- Added assertions that `useBoardSession` rejects foreign `session_updated` payloads and invalidates only the subscribed collab query prefix.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Ghost regression compile | PASS | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-ghost-retest2-rework` |
| Ghost regression run | PASS | `PASS T-REWORK-GHOST CollabDeckSheet does not refetch stale or arbitrary foreign collab session ids` |
| Provider-wrap regression compile | PASS | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-provider-retest2-rework` |
| Provider-wrap regression run | PASS | `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider` |
| ORCH-0939 strict grep | PASS | `I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER: PASS target=app-mobile/src/components/connections/CollabDeckSheet.tsx violations=0` |
| ORCH-0931 strict grep | PASS | `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME: scanned 966 files, 64 postgres_changes listeners, 0 violations` |
| Scoped ESLint | PASS with existing warnings | `npx eslint src/hooks/useBoardSession.ts src/contexts/RecommendationsContext.tsx src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx` exited 0 with 18 pre-existing warnings in `RecommendationsContext.tsx`. |
| Diff whitespace | PASS | `git diff --check -- app-mobile/src/hooks/useBoardSession.ts app-mobile/src/contexts/RecommendationsContext.tsx app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx` |
| Scoped typecheck for touched runtime files | PARTIAL | `npx tsc src/hooks/useBoardSession.ts src/contexts/RecommendationsContext.tsx ... --noEmit` is blocked by existing transitive app errors in `src/i18n/index.ts` JSON imports and `src/services/deckService.ts`; no emitted error cited the touched guard lines. |

## Risks And Follow-Up

- Four-device live matrix was not rerun by implementor. Tester must verify that preference save / `session_updated` no longer emits any `deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.*` error.
- If chat Swipe continues to show a shared card while the full sheet receives `intersection_empty` for Testing stuff, that should be treated as a separate stale chat-mounted deck state investigation, not as proof that the full-sheet dead-end is inherently wrong.
- Physical iPhone ghost-log status remains unverified because Seth-operated physical evidence is required by the tester contract.

## Next Verification Target

Run the four-device live matrix again for Testing stuff. Required checks:

- Save preferences / Lock It In on Android and verify only `daadd454-35a8-487d-ab25-bb595abc4635` deck queries fire.
- Verify no `deck-cards.collab.f706a421-0c70-4763-8bfe-3fe534218626.*` query error appears in Android, iOS simulator, or Metro logs.
- Capture whether full sheet and chat Swipe are aligned after fresh open. If not aligned, record whether the full sheet is returning `intersection_empty` from the correct Testing stuff session.
- Include Seth-operated physical iPhone evidence for the full sheet state.
