# Implementation Report: Public Brand + Event Close Nav Parity (ORCH-0961)

> Date: 2026-05-25
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md`
> Status: implemented, partially verified

## 1. Layman Summary

Public brand pages and public event pages now show a visible Close button in the floating cover chrome, so buyers who open a shared link are not stranded. The Close action matches the public trip-page pattern: go back when browser/app history exists, otherwise fall back to a safe public route.

## 2. Request And Context

- **Request:** Implement ORCH-0961 close/back navigation parity for `/b/{brandSlug}` and `/e/{brandSlug}/{eventSlug}`.
- **Source:** User-dispatched implementor prompt.
- **Affected surfaces:** `mingla-business` buyer-anonymous web public brand page and public event page.
- **Related issues/artifacts:** Public trip page ORCH-0874 reference; dispatch prompt above.

## 3. Scope

- **In scope:** `PublicBrandPage.tsx`, `PublicEventPage.tsx`, and focused regression tests for both close controls.
- **Out of scope:** Backend, migrations, Supabase, route files, public trip route, not-found components, analytics, copy changes.
- **Assumptions:** The event adapter may use `brand.slug` when available and `event.brandSlug` as the frozen public fallback.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry scan | COMMS-0002/0003/0004 are WARN and N/A to this frontend-only ORCH; acknowledged as `implementor+codex (ORCH-0961)`. |
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md` | Contract | Requires two component edits, tests, fails-on-revert proof, no backend/route changes. |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | Reference pattern | Uses `router.canGoBack()` / `router.back()` / public fallback and IconChrome cover chrome. |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | Target | Had share-only floating chrome with `<View />` placeholder. |
| `mingla-business/src/components/event/PublicEventPage.tsx` | Target | Adapter delegated to shared renderer; old `onClose` routed organizers to hub events. |
| `packages/event-rendering/PublicEventPage.tsx` | Dependency check | Shared package still has its own organizer-only plain Pressable chrome; left untouched per hard guard. |
| `mingla-business/jest.config.cjs` | Test harness | Node Jest with `ts-jest`; no React Native render library installed. |

## 5. Blast Radius

- **Direct changes:** Public brand and event UI chrome plus callbacks.
- **Cascade changes:** Event adapter `callbacks.onClose` now uses public fallback behavior instead of founder hub fallback.
- **Parity surfaces:** Public brand and event now align with public trip's back/fallback behavior.
- **Cache impact:** None.
- **State boundaries:** Local component state only (`shareModalVisible`).
- **Auth/RLS/security:** None.
- **Deploy path:** Business web deploy only; no native rebuild, migrations, or edge deploy.

## 6. Old To New Receipts

### `mingla-business/src/components/brand/PublicBrandPage.tsx`

- **Before:** Floating chrome rendered an empty left placeholder and share button only.
- **After:** Added `handleClose` at lines 180-186 and an always-visible Close IconChrome at lines 329-334.
- **Why:** Buyers entering by deep link need a visible escape route.
- **Approx lines changed:** 17.

### `mingla-business/src/components/event/PublicEventPage.tsx`

- **Before:** Shared event renderer received an `onClose` callback that always replaced to `/(tabs)/hub/events`; anonymous buyers did not get a visible close button.
- **After:** Added `handleClose` at lines 205-215 with back, brand-page, and root fallback; added Close + Share IconChrome overlay at lines 302-318; wired shared callbacks to the same close/share handlers at lines 221-246.
- **Why:** Deep-linked public event buyers need the same safe fallback as public trip.
- **Approx lines changed:** 59.

### `mingla-business/src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx`

- **Before:** No regression coverage for public brand close chrome.
- **After:** Source-level Jest regression pins the Close IconChrome and `canGoBack()` root fallback.
- **Why:** Repo lacks RN render libraries; source assertions are the repo-running gate available here.
- **Approx lines changed:** 45 new.

### `mingla-business/src/components/event/__tests__/PublicEventPage.closeButton.test.tsx`

- **Before:** No regression coverage for public event close chrome.
- **After:** Source-level Jest regression pins Close + Share IconChrome and back/brand/root fallback.
- **Why:** Ensures reverting the visible close block fails locally.
- **Approx lines changed:** 52 new.

## 7. Implementation Details

- **Architecture decisions:** Kept all runtime changes inside the two allowed business component files. Did not edit the shared event-rendering package even though it still contains legacy plain Pressable share chrome.
- **Data flow:** Close reads `router.canGoBack()` and uses `router.back()` when possible. Brand deep-link fallback goes to `/`; event deep-link fallback goes to `/b/{brandSlug}` when available, then `/`.
- **Mutation/query behavior:** None.
- **State handling:** Event share state uses a `handleShare` callback shared by adapter IconChrome and shared renderer callbacks.
- **Error handling:** No async error path added.
- **Copy/accessibility:** Added `accessibilityLabel="Close"` to both Close IconChrome controls and preserved `accessibilityLabel="Share"`.
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Brand page always-visible close IconChrome | Yes | `PublicBrandPage.closeButton.test.tsx` | PASS |
| Brand close: back else `/` | Yes | Focused Jest + source review | PASS |
| Event page floating Close + Share IconChrome | Yes | `PublicEventPage.closeButton.test.tsx` | PASS |
| Event close: back else brand page else `/` | Yes | Focused Jest + source review | PASS |
| Do not edit trip page or route files | Yes | `git diff --cached --name-only` | PASS |
| Zero backend touches | Yes | `git diff --cached --name-only` and grep for `supabase/` | PASS |
| No `any` / no `@ts-ignore` introduced | Yes | `rg "(:\\s*any|as\\s+any|@ts-ignore)" ...` returned no matches | PASS |
| Use existing IconChrome primitive | Yes | Both components import/use `IconChrome` | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-38 accessible touch targets | Yes | Yes | `IconChrome` size 40 includes built-in hitSlop. |
| Safearea-on-fullscreen route allowlist | Yes | Yes | No route files changed; existing comments untouched. |
| Regression test habit | Yes | Yes | Added two focused repo-running tests and fail-on-revert proof. |
| Backend separation | Yes | Yes | No Supabase/functions/migration paths touched. |

## 10. Parity Check

- **Mobile:** Native app surfaces not in scope.
- **Business app:** Public brand/event components updated; founder dashboard chrome not touched.
- **Admin:** Not applicable.
- **Public/web:** Brand and event now expose visible Close controls for share-link entry.
- **Solo/collab:** Not applicable.
- **Gaps:** The shared event-rendering package still has legacy plain Pressable floating share chrome under the adapter overlay; left untouched because ORCH-0961 hard guard limited edits to two business component files.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Public event deep-link close now routes to brand page or root instead of founder hub.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Focused Jest | `cd mingla-business && npx jest src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx src/components/event/__tests__/PublicEventPage.closeButton.test.tsx --runInBand` | PASS: 2 suites, 4 tests | Final run after restoring temporary revert. |
| Fails-on-revert | Temporarily replaced both Close IconChrome blocks with `<View />`, then reran focused Jest | FAIL as expected: both close-button render tests failed | Passing proof tree `98833f6774e318774e960440b5c68b6019a545a3`; revert proof tree `cbe65a007a0cee30982f74d976b832a9290d9180`. Temporary mutation was restored before commit. |
| TypeScript | `cd mingla-business && npx tsc --noEmit` | BLOCKED by pre-existing unrelated errors | Errors include checkout implicit-any files, Playwright typings, package alias typings, existing IconChrome/Sheet/type fixture issues. |
| Targeted ESLint | `cd mingla-business && npx eslint src/components/brand/PublicBrandPage.tsx src/components/event/PublicEventPage.tsx src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx src/components/event/__tests__/PublicEventPage.closeButton.test.tsx` | BLOCKED by pre-existing alias resolver issue | Remaining error: `@mingla/event-rendering` import cannot be resolved by ESLint in `PublicEventPage.tsx`; this import existed before ORCH-0961. Removed the pre-existing unused `usePathname` warning while touching the file. |
| Scope grep | `git diff --cached --name-only` plus `rg` guards | PASS | Only four scoped files staged; no route/backend files. |

## 13. Regression Surface

1. Public event top-right share chrome: adapter overlay now sits above the shared package's legacy share chrome.
2. Event organizer close behavior: shared package callback now uses public fallback behavior instead of hub replacement.
3. Brand share modal: same floating row now has an active left Close control but share state remains unchanged.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Shared event-rendering legacy chrome | The shared package still renders a plain Pressable share button underneath the adapter IconChrome row. The adapter overlay uses higher z-index and matching web top spacing, but tester should visually inspect Chromium + iOS Safari. | Follow-up ORCH allows shared package prop/API or package chrome refactor if duplicate chrome is visible. | `packages/event-rendering/PublicEventPage.tsx` |
| Source-level tests | Tests do not physically render/tap because the repo lacks RN renderer dependencies. | Add `@testing-library/react-native` or a supported component render harness in a separate test-infra ORCH. | New close-button tests |

## 15. Discoveries For Orchestrator

- The public event adapter's shared renderer already contains legacy floating share chrome and organizer-only close chrome. This does not block ORCH-0961 inside the hard guard, but tester should visually confirm no duplicate share control is visible on `/e/{brand}/{event}`.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** None.
- **Business/admin web:** Business web deploy required after PR close because `mingla-business/src/` changed.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
fix(public): add close fallback chrome to brand and event pages

Resolves: ORCH-0961
Evidence: focused Jest close-button tests; fails-on-revert proof trees
Deploy: business web only; no backend changes
```

## Ready-To-Test Checklist

1. Open `/b/{brandSlug}` as a direct deep link with no browser history; Close should navigate to `/`.
2. Open `/e/{brandSlug}/{eventSlug}` as a direct deep link with no browser history; Close should navigate to `/b/{brandSlug}`.
3. Navigate to each page from inside the site; Close should use browser/app back history.
4. Tap Share on both pages; existing ShareModal should still open.
