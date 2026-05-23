# Implementation Rework: ORCH-0939 Ghost Session ID

> Date: 2026-05-23  
> Mode: Codex `implementor-mingla`  
> Source QA: `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX.md`  
> Status: implemented, partially verified  
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

## 1. Summary

Fixed the local app-code path that let a stale collab deck query refetch while the operator was visibly inside the `Testing stuff` sheet (`daadd454-35a8-487d-ab25-bb595abc4635`).

The ghost ID `d5ca15ba-e6ce-4f95-a192-03b580e2017d` is not hardcoded in product source; `rg d5ca15ba .` found it only in the QA report before this rework. That points to device-local stale state, persisted React Query state, or a stale mounted chat deck subtree. The code bug was that active collab param changes invalidated every `deck-cards` query, so any stale active observer for a prior collab session could refetch too. Two hidden deck sheet call sites also kept providers mounted while closed, making stale observers possible.

Layman summary: the app was saying "refresh the deck" too broadly. If an old closed deck was still quietly alive in the app, it could wake up and ask the server for its old session. Now the visible session refresh only wakes its own deck, and closed deck sheets are actually unmounted.

## 2. Inputs

| Input | Use |
|---|---|
| `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX.md` | Tester FAIL and ghost ID evidence. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md` | Provider/session-scoping contract. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md` | Prior provider-wrap implementation and gates. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md` | Broadcast invalidation baseline. |
| `Mingla_Artifacts/reports/evidence/ORCH-0939/` | Live screenshot evidence referenced by QA. |

## 3. Root Cause

| Layer audited | Finding |
|---|---|
| `rg d5ca15ba` across repo | No product-code source. Only the QA report had the literal ghost ID before the new regression test. |
| `useBoardSession` | ORCH-0931 broadcast invalidation is already scoped to `['deck-cards', 'collab', capturedSessionId]`; no change made. |
| `realtimeService.subscribeToBoardSession` | Broadcast callback dispatches on the subscribed topic and does not construct deck query keys; no change made. |
| `useDeckCards` key factory | Collab key factory is correct: `['deck-cards', 'collab', sessionId, currentPosition]`; no change made. |
| `RecommendationsContext` | The collab params change detector used broad `queryClient.invalidateQueries({ queryKey: ['deck-cards'] })`, which can refetch stale active collab observers from another session. |
| Hidden deck sheets | `MessageInterface` and `CollabSessionChatBanners` mounted deck providers even when their modals were closed. Hidden providers can keep stale deck observers alive. |

## 4. Files Changed

| File | Change |
|---|---|
| `app-mobile/src/contexts/RecommendationsContext.tsx:1667` | Scoped collab params invalidation to `['deck-cards', 'collab', collabDeckParams.sessionId]`. |
| `app-mobile/src/components/MessageInterface.tsx:2182` | Mount `CollabDeckSheet` only when the sheet is actually open and has a session id. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx:701` | Mount `InChatDeckSheet` only when `showDeckSheet` is true. |
| `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx:51` | Added regression that mocks prior ghost query + active target query and asserts only the active session can be invalidated/refetched. |

## 5. Verification

| Gate | Command | Result |
|---|---|---|
| New regression compile | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --noEmit` | PASS |
| New regression run | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-ghost-test && node /tmp/orch-0939-ghost-test/CollabDeckSheet.ghostSessionRegression.test.js` | PASS: `PASS T-REWORK-GHOST...` |
| Fails on revert | Temporarily changed `RecommendationsContext` collab params detector back to `queryKey: ['deck-cards']`, then ran the compiled regression | EXPECTED FAIL: assertion showed invalidated sessions included both `d5ca15ba-...` and `daadd454-...` |
| Fails-on-revert hash | `git rev-parse HEAD` | `c7cfb4a5465076282be258870a64def15bea9d55` |
| ORCH-0939 provider regression | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-provider-test && node /tmp/orch-0939-provider-test/CollabDeckSheet.providerWrap.test.js` | PASS |
| ORCH-0931 focused regression | `cd app-mobile && npx tsc --types react-native src/services/realtimeService.ts src/hooks/useBoardSession.ts src/services/__tests__/realtimeService.orch-0931.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0931-rework-test && node /tmp/orch-0931-rework-test/services/__tests__/realtimeService.orch-0931.test.js` | PASS: T-IMP-1..T-IMP-5 |
| Strict grep ORCH-0939 | `node --test .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs && node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` | PASS |
| Strict grep ORCH-0931 | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs && node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` | PASS |
| Scoped ESLint | `cd app-mobile && npx eslint src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx` | PASS, 0 output |
| Diff whitespace | `git diff --check -- app-mobile/src/contexts/RecommendationsContext.tsx app-mobile/src/components/MessageInterface.tsx app-mobile/src/components/chat/CollabSessionChatBanners.tsx` | PASS |

### TypeScript caveat

The broader component-inclusive command:

```bash
cd app-mobile && npx tsc --types react-native src/contexts/RecommendationsContext.tsx src/components/MessageInterface.tsx src/components/chat/CollabSessionChatBanners.tsx src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --noEmit
```

still fails on pre-existing transitive repo issues: unresolved `@mingla/event-rendering`, `@mingla/payments-native`, `@mingla/phone-input`, JSON module flags in `src/i18n/index.ts`, existing React Native animated transform typings, and existing `NodeJS.Timeout` typings. No new diagnostic identified the rework lines above as the root failure.

## 6. Hard Guards

| Guard | Status |
|---|---|
| Do not mutate `daadd454-...` via SQL | Preserved. No SQL or Supabase mutation command was run. |
| Do not weaken tests | Preserved. Added a stricter regression and left existing gates intact. |
| Do not push/open PR/merge | Preserved. No GitHub or push command was run. |
| Preserve ORCH-0931 + ORCH-0926 code | Preserved. `useBoardSession.ts` and `realtimeService.ts` were not edited in this rework. |

## 7. Remaining Live Gate

This rework is locally verified but not live-matrix verified. Tester still needs the 3-sim + operator physical iPhone retest and should require logs showing only `deck-cards.collab.daadd454-35a8-487d-ab25-bb595abc4635.*` for the visible `Testing stuff` sheet, with no `d5ca15ba...` discover-cards query or toast.

## 8. Next Handoff

NEXT HANDOFF — paste into Claude `mingla-tester`:

Retest the bundled ORCH-0939 + ORCH-0931 live matrix on the tester side using `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_REWORK_GHOST_SESSION_ID.md`, `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX.md`, `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md`, and evidence under `Mingla_Artifacts/reports/evidence/ORCH-0939/`; the goal is to verify the ghost `d5ca15ba-e6ce-4f95-a192-03b580e2017d` deck query is gone while `Testing stuff` (`daadd454-35a8-487d-ab25-bb595abc4635`) remains open. Hard guards: do not mutate `daadd454-...` via SQL, do not weaken tests, do not push/open PR/merge, and drive 2 iOS sims plus Pixel/Ethan autonomously while pausing only with explicit instructions when the operator's physical iPhone action is needed. Expected output is `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST.md` with PASS / CONDITIONAL PASS / FAIL, per-device broadcast/invalidate/refetch evidence, and explicit confirmation that no `d5ca15ba...` query/error occurs. After PASS route to Codex `orchestrator-mingla` for bundled CLOSE; after FAIL route back to Codex `implementor-mingla` for REWORK; Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
