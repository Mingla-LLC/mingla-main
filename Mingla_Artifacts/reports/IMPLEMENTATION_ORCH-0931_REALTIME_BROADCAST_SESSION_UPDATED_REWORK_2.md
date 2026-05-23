# Implementation Rework 2: ORCH-0931 Realtime Broadcast `session_updated`

> Date: 2026-05-23  
> Mode: Rework after tester FAIL  
> Source QA: `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_RETEST.md`  
> Status: implemented, partially verified  
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

## 1. Summary

This rework fixes the remaining app-code blocker from the retest: a received `session_updated` broadcast now invalidates the active collab `deck-cards` query immediately, before the existing `loadSession()` refresh.

The retest proved the broadcast and `[ORCH-0923-DIAG] onSessionUpdated fired` logs, but no deck-cards refetch followed when the broadcast payload carried the same `deck_params_hash`. Root cause in code: `RecommendationsContext` only invalidated deck-cards when derived `collabDeckParams` changed; hash-stable participant preference updates fired the handler but could not trip that derived-params detector. The fix moves the hard invalidation into the broadcast handler itself while preserving the session reload path for fresh `participant_prefs`.

No migrations were added or applied. No live Supabase data was mutated directly. No push, PR, or merge was performed.

## 2. Rework Inputs

| Artifact | Use |
|---|---|
| `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_RETEST.md` | Tester FAIL and rework contract. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK.md` | Prior rework baseline. |
| `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` | Original QA baseline. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` | SC-1/SC-2 cache invalidation contract. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` | Original implementation report and prior tests. |

## 3. Files Changed

| File | Change |
|---|---|
| `app-mobile/src/hooks/useBoardSession.ts` | On `session_updated`, logs `[ORCH-0923-DIAG] session_updated invalidating deck-cards`, invalidates `['deck-cards', 'collab', capturedSessionId]`, then calls `loadSession(capturedSessionId)`. Also tightened related hook dependency arrays so the new query-client usage is not a stale closure. |
| `app-mobile/src/services/__tests__/realtimeService.orch-0931.test.ts` | Added T-IMP-5 source regression proving the `onSessionUpdated` callback invalidates active collab deck queries and emits a diagnostic log for tester live-fire evidence. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md` | This report. |

## 4. Old To New Receipt

### Broadcast-to-refetch contract

- **Before:** `onSessionUpdated` logged the event and refreshed session state. Deck refetch depended on `RecommendationsContext` detecting a changed `collabDeckParams` JSON string. If `deck_params_hash` stayed the same, no deck-cards invalidation/refetch occurred after the broadcast.
- **After:** `onSessionUpdated` directly invalidates the active collab deck query key prefix `['deck-cards', 'collab', capturedSessionId]` immediately after the broadcast callback fires. `loadSession()` still runs afterward to refresh `allParticipantPreferences` and session metadata.
- **Why:** SC-1/SC-2 require a causally observable deck-cards refetch after broadcast receipt. The broadcast itself is the cache-invalidation signal; it cannot rely only on a later derived-state diff that may be hash-stable.

### Regression coverage

- **Before:** T-IMP-4 asserted only that `loadSession(capturedSessionId)` happens after broadcast.
- **After:** T-IMP-5 also asserts the hook callback contains `queryClient.invalidateQueries({ queryKey: ['deck-cards', 'collab', capturedSessionId] })` and the explicit `session_updated invalidating deck-cards` diagnostic.
- **Why:** Reverting the direct invalidation recreates the tester failure while T-IMP-1..4 would still pass.

## 5. Verification

| Check | Command | Result |
|---|---|---|
| Focused TypeScript compile | `cd app-mobile && npx tsc --types react-native src/services/realtimeService.ts src/hooks/useBoardSession.ts src/services/__tests__/realtimeService.orch-0931.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0931-rework-test` | PASS |
| ORCH-0931 focused regression runner | `cd app-mobile && node /tmp/orch-0931-rework-test/services/__tests__/realtimeService.orch-0931.test.js` | PASS: T-IMP-1..T-IMP-5 |
| Scoped ESLint | `cd app-mobile && npx eslint src/services/realtimeService.ts src/hooks/useBoardSession.ts src/services/__tests__/realtimeService.orch-0931.test.ts` | PASS, 0 errors / 0 warnings |
| Strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs` | PASS, 2/2 |
| Strict-grep gate | `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` | PASS: scanned 966 files, 64 `postgres_changes` listeners, 0 violations |
| Diff whitespace | `git diff --check -- app-mobile/src/hooks/useBoardSession.ts app-mobile/src/services/__tests__/realtimeService.orch-0931.test.ts` | PASS |

## 6. Invariant Review

| Invariant | Status |
|---|---|
| No silent failures | Improved: the broadcast handler now emits a specific invalidation diagnostic before refetch. |
| React Query owns server state | Preserved: refetch is triggered by React Query invalidation; no deck data is copied into local state. |
| ORCH-0909 positional shared deck | Preserved: invalidation targets the collab deck query prefix for the current session; server still owns positional card truth. |
| Private broadcast/RLS model | Unchanged: no DB/RLS code touched. |
| Regression test habit | Satisfied for the app-code fix via T-IMP-5. |

## 7. Remaining Tester Gates

This implementor pass did not claim live matrix closure. Tester still needs to rerun:

1. iOS two-device live-fire proving broadcast receipt, `session_updated invalidating deck-cards`, `[ORCH-0923-DIAG] onSessionUpdated fired`, and the subsequent `[QUERY] success deck-cards.collab.<sessionId>.<position>` after a UI-driven remote pref change.
2. Android Pixel_8_Pro matrix once the AVD/Maestro control path is stable.
3. Anonymous denial (previously passing, should reconfirm).
4. Authenticated non-participant denial with a real non-participant credential/device.
5. Chat/presence/message no-regression smoke.

## 8. Risks And Notes

- This intentionally invalidates on every `session_updated` broadcast for the active collab session, even if the hash is unchanged. That is slightly more eager than the derived-params detector, but matches the spec's "broadcast is a cache-invalidation signal" contract and avoids stale hash-stable UI.
- The invalidation is scoped to `['deck-cards', 'collab', sessionId]`; it does not invalidate solo deck caches or other sessions.
- The Android and non-participant failures in the retest were not caused by this code path. They remain tester/operator fixture gates.

## 9. Next Handoff

NEXT HANDOFF — paste into Codex `tester-mingla`:

Retest ORCH-0931 on the tester side using `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`, `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_RETEST.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK.md`, `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`, `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`, and `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`; the goal is to verify the live SC-1..SC-12 matrix after the app-code rework that directly invalidates collab deck-cards on `session_updated`. Hard guards: do not weaken tests, do not mutate live `daadd454-35a8-487d-ab25-bb595abc4635` directly via SQL, do not push/open PR/merge, and do not apply migrations because ORCH-0931 is already applied remotely. Expected output is `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_RETEST_2.md` with PASS / CONDITIONAL PASS / FAIL and explicit evidence for live broadcast receipt, cache invalidation/refetch, anon denial, non-participant denial, Android attempt/parity, and no regression to chat/presence/message flows. After PASS route to Codex `orchestrator-mingla` for CLOSE; after FAIL route back to Codex `implementor-mingla` for REWORK; Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

