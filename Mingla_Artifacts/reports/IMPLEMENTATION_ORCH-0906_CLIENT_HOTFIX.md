# IMPLEMENTATION — ORCH-0906 Client Hotfix

**Status:** implemented, partially verified  
**Branch:** `ORCH-0906-CLIENT-HOTFIX`  
**Base:** `741421084f3340a02b33afad8c9899b4a18e472d` (`origin/main`, PR #158 merge commit)  
**Hotfix code commit:** `d68b4571`  
**Report commit:** pending at report authoring time  
**Date:** 2026-05-21  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main`  

## Scope Implemented

| Scope | Files | Result |
| --- | --- | --- |
| P0-1 curated payload preservation | `app-mobile/src/services/deckService.ts` | Added `discoverCardsPayloadToRecommendations(data)` and routed both solo `discover-cards` and collab-v2 `discover-cards` responses through it. Curated payloads now pass through with `cardType: 'curated'` while preserving `stops`, `tagline`, `experienceType`, `pairingKey`, pricing, duration, match score, shopping list, teaser, and lock fields. |
| P0-1 leaking-envelope guard | `app-mobile/src/services/deckService.ts` | Added a single-place payload guard so a malformed/mixed response with envelope `card_type: 'curated'` does not incorrectly mark obvious single-place rows as curated. |
| P0-2 swipe empty-state flash | `app-mobile/src/components/SwipeableCards.tsx`, `app-mobile/src/contexts/RecommendationsContext.tsx` | Collab local swipe-through now renders loading while there is no explicit dead-end reason, instead of rendering `EXHAUSTED`. Context empty/exhausted classification for collab now requires `soloCuratedEmptyReason` or `serverPath === 'pool-empty'`, and explicit dead-end clears the prior one-card recommendation. |
| Regression gate | `app-mobile/scripts/ci/orch-0906-client-hotfix-regression-check.mjs`, `app-mobile/package.json` | Added `npm run test:orch-0906-client-hotfix`, matching the repo’s existing Node CI gate pattern. App-mobile does not currently have Jest configured, so this is the repo-running automated regression for ORCH-0840. |

## Spec Traceability

- Source FAIL report read first: `Mingla_Artifacts/reports/QA_ORCH-0909_AMENDMENT_ORCH-0906_BUNDLE_REPORT.md`.
- Server contract confirmed from `supabase/functions/discover-cards/index.ts`: positional response emits envelope `card_type`, and curated rows hydrate from `row.curated_payload`.
- Client render contract preserved: `SwipeableCards.tsx` already routes `(currentRec as any).cardType === 'curated'` to `CuratedExperienceSwipeCard`; this patch ensures curated rows reach that branch intact.
- UI/UX pre-flight invoked before component edits via `.codex/skills/ui-ux-mingla/scripts/search.py`; the relevant guidance was truthful async state: loading during in-flight transitions, not empty/exhausted copy.

## Regression Receipts

Positive gates:

```text
npm run test:orch-0906-client-hotfix
PASS T-01 curated envelope mapper exists
PASS T-02 envelope card_type='curated' preserves curated payload
PASS T-03 curated shape preserves stops, tagline, and experienceType
PASS T-04 leaking curated envelope cannot corrupt single place rows
PASS T-05 solo and collab discover-cards paths both use envelope mapper
PASS T-06 no direct response-card map through single mapper remains
PASS T-07 collab transient empty renders loading, not exhausted
PASS T-08 context empty state requires explicit collab terminal signal
PASS T-09 collab dead-end clears the prior one-card recommendation
```

Existing bundle gates:

```text
npm run test:orch-0909
PASS T-IMP-01 through T-IMP-11

npm run test:orch-0909-adv
PASS T-ADV-01 through T-ADV-10

node ./scripts/ci/orch-0906-no-resurrected-solo-only-comment-check.mjs
PASS ORCH-0906 resurrected solo-only comment gate
```

Lint / type gates:

```text
npx eslint scripts/ci/orch-0906-client-hotfix-regression-check.mjs src/services/deckService.ts src/contexts/RecommendationsContext.tsx src/components/SwipeableCards.tsx
0 errors, warnings only from pre-existing touched-file lint debt.

npx tsc --noEmit
FAILED on pre-existing/unrelated errors in files outside this patch, including
src/components/board/LockedPlanBanner.tsx, src/components/BoardDiscussion.tsx,
src/components/ConnectionsPage.tsx, shared packages/event-rendering,
packages/payments-native, and packages/phone-input.
```

## Fails-on-Revert Receipts

Hotfix code commit: `d68b4571`.

Mapper negative control:

```text
git diff d68b4571^ d68b4571 -- app-mobile/src/services/deckService.ts > /tmp/orch0906_mapper.patch
git apply -R /tmp/orch0906_mapper.patch
npm run test:orch-0906-client-hotfix
FAIL T-01 curated envelope mapper exists
FAIL T-02 envelope card_type='curated' preserves curated payload
FAIL T-03 curated shape preserves stops, tagline, and experienceType
FAIL T-04 leaking curated envelope cannot corrupt single place rows
FAIL T-05 solo and collab discover-cards paths both use envelope mapper
FAIL T-06 no direct response-card map through single mapper remains
PASS T-07 through T-09
git apply /tmp/orch0906_mapper.patch
npm run test:orch-0906-client-hotfix
PASS T-01 through T-09
```

Empty-state negative control:

```text
git diff d68b4571^ d68b4571 -- app-mobile/src/contexts/RecommendationsContext.tsx app-mobile/src/components/SwipeableCards.tsx > /tmp/orch0906_empty_state.patch
git apply -R /tmp/orch0906_empty_state.patch
npm run test:orch-0906-client-hotfix
PASS T-01 through T-06
FAIL T-07 collab transient empty renders loading, not exhausted
FAIL T-08 context empty state requires explicit collab terminal signal
FAIL T-09 collab dead-end clears the prior one-card recommendation
git apply /tmp/orch0906_empty_state.patch
npm run test:orch-0906-client-hotfix
PASS T-01 through T-09
```

## Risk And Invariant Notes

- No DB migrations touched.
- No Supabase edge functions touched or deployed.
- No Stripe, RLS, storage, auth, or production data mutation touched.
- React Query ownership preserved: `useDeckCards` still owns server response fetching; mapping remains inside `deckService.fetchDeck`.
- Empty-state truthfulness improved: collab `EMPTY` / `EXHAUSTED` no longer derives from transient zero local cards without an explicit terminal server signal.
- The curated mapper deliberately preserves raw curated payload shape so the canonical renderer `CuratedExperienceSwipeCard` consumes the server-owned journey object.
- The mapper includes a defensive single-place check to satisfy the expected adversarial test that a single row must not acquire curated type from a leaking envelope flag.

## Unverified / Manual Gates

- iPhone 17 Metro hot-reload live-fire was not performed by Codex in this run. Operator/tester should verify `(currentRec as any).cardType === 'curated'` on curated rows and confirm `CuratedExperienceSwipeCard` renders stops, tagline, and journey chrome.
- Rapid double-swipe no-flicker remains for Claude `mingla-tester` adversarial retest.
- SC-01..SC-18 live-fire remains for tester after PR merge.

## Deploy Notes

- Pure client-side hotfix.
- Operator runs the EAS OTA after PR merge: `eas update --branch production --platform ios --message "ORCH-0906 client hotfix: curated cards + empty-state flash"`.
- No `supabase db push`.
- No edge function deploy.
