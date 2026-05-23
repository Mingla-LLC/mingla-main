# Implementation ORCH-0939 + ORCH-0931 Ghost Session Rework 2

Date: 2026-05-23  
Implementor: Codex implementor-mingla  
Status: implemented, partially verified  
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

## Rework Contract

Input QA report:

- `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST.md`

Prior implementation/spec inputs:

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_REWORK_GHOST_SESSION_ID.md`
- `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`
- `Mingla_Artifacts/reports/evidence/ORCH-0939/retest/`

Tester failed the bundle because the literal old ghost `d5ca15ba-e6ce-4f95-a192-03b580e2017d` was gone, but arbitrary foreign session IDs still entered `deck-cards.collab.{sessionId}.{position}` query keys and `discover-cards` request bodies while `Testing stuff` / `daadd454-35a8-487d-ab25-bb595abc4635` was visibly open.

## Root Cause

`RecommendationsProvider` resolved collab mode as:

1. ambient `currentSession?.id`
2. `propPersistedSessionId`
3. UUID `currentMode`
4. available-session lookup

That order is unsafe for sheet-scoped collab providers. `CollabDeckSheet` correctly passed the visible session ID as `currentMode` and `persistedSessionId`, but an ambient/global `currentSession` from another collaboration session could still win first. This matches the QA evidence where the visible sheet stayed on `daadd454...`, while query keys briefly flipped to `bbab...`, `cc03...`, and `49f...`.

## Changes

### `app-mobile/src/contexts/RecommendationsContext.tsx`

- Added a shared `UUID_REGEX`.
- Reordered `resolvedSessionId` priority to:
  1. explicit/persisted UUID
  2. UUID `currentMode`
  3. ambient `currentSession` only when it matches `currentMode` by ID or name
  4. available-session lookup by ID or name
- Preserved the prior session-scoped collab invalidation shape from the previous ORCH-0939/ORCH-0931 implementation: `['deck-cards', 'collab', collabDeckParams.sessionId]`.

### `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`

- Added `sessionIdOverride={sessionId}` to the in-chat `SwipeableCards` sheet path so SwipeableCards uses the visible chat session directly instead of re-deriving it from `currentMode="collab"` plus session lists.

### `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx`

- Expanded the regression from one named stale ID to an arbitrary foreign ID modeled after the physical-iPhone failure (`49f937fb-a2a2-406a-bda2-1cdb22367d34`).
- Added a source-level guard that explicit persisted session IDs and UUID `currentMode` must appear before the ambient `currentSession` fallback.
- Added a guard that `currentSession` can only win when it matches the requested mode.

## Old-To-New Receipts

Old behavior:

- A sheet-local provider could render `Testing stuff` while `resolvedSessionId` returned a different ambient session ID.
- That foreign ID could become the collab query key and `discover-cards` body.
- The prior regression only proved the named `d5ca...` stale ID did not refetch.

New behavior:

- Explicit sheet session IDs win over ambient session state.
- `currentSession` is demoted to a matching fallback, not a global override.
- The regression now covers arbitrary foreign IDs and the resolver priority that caused the live failure class.

## Verification

| Gate | Result | Output |
|---|---:|---|
| ORCH-0939 ghost regression | PASS | `PASS T-REWORK-GHOST CollabDeckSheet does not refetch stale or arbitrary foreign collab session ids` |
| ORCH-0939 provider wrap | PASS | `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider` |
| ORCH-0931 realtime focused test | PASS | `PASS T-IMP-1` through `PASS T-IMP-5` |
| ORCH-0939 strict grep self-test + scan | PASS | `I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER: PASS ... violations=0` |
| ORCH-0931 strict grep self-test + scan | PASS | `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME: scanned 966 files, 64 postgres_changes listeners, 0 violations` |
| ORCH-0918 regression check | PARTIAL / existing failures | T-11 now passes. Remaining failures are T-01 and T-03-rev, which predate this rework and are outside the ghost-session failure vector. |
| App-wide TypeScript | PARTIAL / existing failures | `npx tsc --noEmit --project tsconfig.json --pretty false` still fails on existing repo-wide issues; scoped grep found no `RecommendationsContext`, `CollabSessionChatBanners`, or `CollabDeckSheet.ghostSessionRegression` errors after the fix. |

Commands run:

```bash
cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-ghost-rework && node /tmp/orch-0939-ghost-rework/CollabDeckSheet.ghostSessionRegression.test.js
cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-provider-rework && node /tmp/orch-0939-provider-rework/CollabDeckSheet.providerWrap.test.js
rm -rf /tmp/orch-0931-rework && cd app-mobile && npx tsc src/services/realtimeService.ts src/services/__tests__/realtimeService.orch-0931.test.ts --target es2020 --module commonjs --esModuleInterop --skipLibCheck --types react-native --rootDir src --outDir /tmp/orch-0931-rework && node /tmp/orch-0931-rework/services/__tests__/realtimeService.orch-0931.test.js
node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs && node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs
node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs && node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs
cd app-mobile && npm run test:orch-0918
cd app-mobile && npx tsc --noEmit --project tsconfig.json --pretty false
cd app-mobile && npx tsc --noEmit --project tsconfig.json --pretty false 2>&1 | rg "CollabDeckSheet\\.ghostSessionRegression|RecommendationsContext|CollabSessionChatBanners" || true
```

## Residual Risk

- The four-device live matrix was not re-run by implementor. This needs tester-mingla because the original failure was live and involved two simulators, Android, and Seth's physical iPhone.
- The prior QA also found `Testing stuff` showing `You are too far apart` on all devices instead of a shared card. This rework targets the ghost-session contamination; it does not mutate `daadd454...` via SQL or change deck data to manufacture a shared card.
- `npm run test:orch-0918` still has unrelated red assertions T-01 and T-03-rev in this shared dirty worktree. T-11, the in-chat session-scoped deck assertion relevant to this work, now passes.

## Hard-Guard Compliance

- No SQL mutation of `daadd454-35a8-487d-ab25-bb595abc4635`.
- No Supabase, Stripe, GitHub, push, PR, merge, or deploy action.
- No weakening/deleting tests. The ghost regression was expanded.
- No physical-device automation.
- No production code outside the collab session resolution / in-chat session override surface.

## Next Verification

Dispatch tester-mingla to re-run the bundled ORCH-0939 + ORCH-0931 four-device matrix using the same human-in-the-loop physical iPhone contract from the failed retest. The pass condition is no ghost-session query error for `d5ca...` or any arbitrary foreign session ID while `Testing stuff` is open and preference/broadcast refetches occur.
