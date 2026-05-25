# Implementation Report — ORCH-0961 [Public brand + event page dead-end fix] REWORK v2

> Date: 2026-05-25
> Mode: Spec Rework (post tester FAIL)
> Prior: `IMPLEMENTATION_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md` (v1, commit `d243050b1`)
> Tester verdict driving rework: `QA_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md` (FAIL, F-1 P1 + F-2 P1)
> Status: implemented, jest-verified, runtime-handoff for tester re-run

## 1. Layman Summary

The earlier ORCH-0961 commit added a visible Close button to the public brand and event pages but the event page rendered TWO Share buttons in the live browser — one from the shared event-rendering package, one from the new business adapter. This rework introduces a single prop on the shared package so the buyer-web adapter can suppress the shared chrome, leaving exactly one Close + one Share on `/e/*`. It also adds stable `testID` handles on every floating Close/Share so the tester's mobile Playwright run can target them by `data-testid` instead of the role+name selector that was timing out under iPhone simulation.

## 2. Request And Context

- **Request:** Rework dispatch from Claude `mingla-orchestrator` after tester FAIL (F-1 duplicate Share chrome, F-2 mobile-viewport Close timeout).
- **Source:** Operator-dispatched rework prompt (this turn).
- **Affected surfaces:** Same as v1 — buyer-anonymous web only (`/b/{brandSlug}`, `/e/{brandSlug}/{eventSlug}`). No change to surface scope.
- **Hard guards:** No trip page touch, no route file touch, no backend touch, no unrelated product code. Shared package `packages/event-rendering/` is now in scope because F-1 explicitly requires its cooperation; tester's required-rework block §F-1 named "Add a scoped way for the business public-event adapter to suppress the shared renderer's floating chrome."

## 3. Scope

- **In scope:** Shared `packages/event-rendering/` opt-out prop; business adapter wires that prop + testIDs; brand page testIDs; adversarial test extension.
- **Out of scope:** Trip page, route files, backend, app-mobile sheet consumer (`ExpandedBusinessEventSheet.tsx`) — the new prop is opt-in (`hideFloatingChrome?: boolean`, default `false`) so the sheet's organizer-mode chrome is preserved untouched.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/reports/QA_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md` | Tester FAIL contract | F-1 P1 duplicate Share; F-2 P1 mobile Close timeout. |
| `Mingla_Artifacts/reports/REVIEW_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md` | REVIEW context | §6.1 anticipated duplicate-chrome risk. |
| `packages/event-rendering/PublicEventPage.tsx` | Shared chrome source | Lines 181-203 unconditionally render Close (organizer)+Share. |
| `packages/event-rendering/types.ts` | Shared prop contract | `PublicEventPageProps` lacks any suppress hook. |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | Other shared-package consumer | Renders `<PublicEventPage>` inside a sheet; relies on default chrome. Must remain unchanged. |
| `mingla-business/src/components/ui/IconChrome.tsx` | testID plumbing | Already supports `testID` prop → maps to `data-testid` via RN Web. |
| `mingla-business/app/_layout.tsx` | SafeAreaProvider mount check | Provider IS mounted at root, so web mobile viewport should receive `insets.top=0` defaults. F-2 is not a missing-provider bug. |

## 5. Blast Radius

- **Direct changes:** Shared `PublicEventPage` floating-chrome render conditional + new prop in `PublicEventPageProps`; business adapter passes `hideFloatingChrome={true}`; testIDs on 4 IconChromes.
- **Cascade changes:** None — default prop value `false` preserves all other consumers (`app-mobile/.../ExpandedBusinessEventSheet.tsx` keeps its built-in chrome).
- **Parity surfaces:** Buyer-web only.
- **Cache impact:** None.
- **State boundaries:** None.
- **Auth/RLS/security:** None.
- **Deploy path:** Business web deploy required (touches `mingla-business/src/` + `packages/event-rendering/` which is bundled by Next.js build).

## 6. Old → New Receipts

### `packages/event-rendering/types.ts`

- **Before:** `PublicEventPageProps` had 4 fields: event, brand, viewerRole, callbacks.
- **After:** Added optional `hideFloatingChrome?: boolean` (default `false`) with a docstring naming ORCH-0961 rework and the contract (host opts out so it can own the chrome).
- **Why:** Gives the buyer-web adapter a clean suppression hook without forking the shared renderer or hard-coding host-aware logic into the package.
- **Lines changed:** 9 added.

### `packages/event-rendering/PublicEventPage.tsx`

- **Before:** Component always rendered the floating chrome (`<View>` with Pressable Close [organizer-only] + Pressable Share).
- **After:** Destructures `hideFloatingChrome = false` from props; wraps the chrome `<View>` in `hideFloatingChrome ? null : ( ... )`. Comment block notes the rework.
- **Why:** Single opt-out point for any host that wants to own its own chrome.
- **Lines changed:** ~44 changed (mostly re-indent of the existing JSX block; net behavior unchanged when `hideFloatingChrome` is `false`).

### `mingla-business/src/components/event/PublicEventPage.tsx`

- **Before:** Rendered `<SharedPublicEventPage event brand viewerRole callbacks />` followed by its own floating IconChrome row. Result: two Share buttons in the DOM tree (P1 F-1).
- **After:** Passes `hideFloatingChrome` to the shared component; adds `testID="orch-0961-public-event-close"` to the adapter's Close IconChrome and `testID="orch-0961-public-event-share"` to the adapter's Share IconChrome.
- **Why:** Removes the duplicate Share/Close from the shared renderer's output; gives mobile-viewport Playwright a stable `data-testid` selector that does not depend on accessibility-tree name resolution under iPhone simulation.
- **Lines changed:** 3 added.

### `mingla-business/src/components/brand/PublicBrandPage.tsx`

- **Before:** Close + Share IconChrome rendered with `accessibilityLabel` only.
- **After:** Added `testID="orch-0961-public-brand-close"` and `testID="orch-0961-public-brand-share"`.
- **Why:** Same robust-selector reasoning as the event page — desktop Playwright resolves `getByRole('button', {name:'Close'})` fine, but the tester's mobile WebKit run timed out on the same selector. `data-testid` is the most stable cross-viewport handle.
- **Lines changed:** 2 added.

### `mingla-business/src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx`

- **Before:** 5 adversarial cases covering brand/event-slug/root fallbacks, `router.back()`, and the founder regression.
- **After:** Added one F-1-targeted case `buyer-web adapter suppresses the shared renderer's floating chrome to avoid duplicate Share/Close (ORCH-0961 rework F-1)` that asserts `sharedPage.props?.hideFloatingChrome === true`. Reverts to undefined fail the case. Also extended `ElementNode` type with the new prop.
- **Why:** Direct guardrail against the F-1 regression — if a future change drops the prop, this test fails before the duplicate Share leaks into production.
- **Lines changed:** 13 added.

## 7. Implementation Details

- **Architecture decisions:** The opt-out prop is a one-line shared-package change; alternatives considered and rejected:
  - Hide-via-CSS on the adapter side: pollutes the DOM/a11y tree (the original F-1 root cause).
  - Override `callbacks.onShare`/`onClose` to no-op + visually mask: still leaves duplicate buttons in the accessibility tree, also fails T-7.
  - Conditionally render `<SharedPublicEventPage>` body without its chrome by forking the package: violates DRY; consumers diverge.
  The opt-out prop is the smallest, most explicit, fully-typed contract.
- **Data flow:** No change.
- **Mutation/query behavior:** None.
- **State handling:** None.
- **Error handling:** None.
- **Copy/accessibility:** Preserved `accessibilityLabel="Close"`/`"Share"` on all IconChromes. Added testIDs alongside (does not replace the labels — assistive tech still reads the label).
- **Analytics:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| F-1 — Exactly one runtime/accessibility Share control on `/e/*` | Yes | New adversarial test asserts `hideFloatingChrome={true}` reaches the shared renderer; shared renderer skips chrome render when true. | PASS (jest-verified; tester runtime re-run pending) |
| F-1 — Adapter IconChrome remains the responding tap target | Yes | Adapter's IconChrome is now the only Close/Share in the tree. | PASS |
| F-1 — Close fallback behavior preserved | Yes | None of the close-callback logic changed; existing 5 adversarial cases still pass. | PASS |
| F-2 — Mobile/iOS Safari-simulated public route renders visible Close | Mitigated via testID handles | `testID="orch-0961-public-brand-close"`, `…-event-close` added — RN Web maps to `data-testid` selectable by Playwright `getByTestId` independent of role-name resolution. | PARTIAL — tester to re-run with `data-testid` selectors. If still failing, the root cause is not selector-resolution and a deeper investigation is required (see §15 Discoveries). |
| Do not touch trip page, routes, backend | Yes | `git diff --stat` lists 4 product files + 1 test + 1 registry row; no `app/`, `supabase/`, or trip files. | PASS |
| Keep/extend adversarial test path | Yes | Same file path; +1 new test. | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-38 accessible touch targets | Yes | Yes | IconChrome unchanged. |
| Safearea-on-fullscreen route allowlist | Yes | Yes | Route files untouched. |
| Regression test habit | Yes | Yes | Extended adversarial test with F-1-specific case + fails-on-revert proof. |
| Backend separation | Yes | Yes | No backend touch. |
| Append-only on existing tests | Yes | Yes | Only ADDED a new test case; existing tests unchanged (`tests-append-only.yml` will not complain). |

## 10. Parity Check

- **Mobile (`app-mobile/`):** Not affected — `ExpandedBusinessEventSheet.tsx` uses the shared package WITHOUT passing `hideFloatingChrome`, so its sheet-mode close+share chrome is unchanged.
- **Business iOS/Android:** Not affected (these surfaces don't render public anonymous routes).
- **Admin:** Not applicable.
- **Public/web:** Single source of chrome on both pages; testID handles for mobile-viewport selectors.

## 11. Cache And Persisted State Safety

None — pure UI / type addition.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Focused Jest (3 suites) | `cd mingla-business && npx jest src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx src/components/event/__tests__/PublicEventPage.closeButton.test.tsx src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx --runInBand` | **PASS: 3 suites / 10 tests** in 2.536s | All previously-passing tests still pass; new F-1 case PASS. |
| Fails-on-revert for new F-1 case | Commented out `hideFloatingChrome` prop in `PublicEventPage.tsx:300`, re-ran adversarial suite | **FAIL as expected** (1 failed / 5 passed) — exactly the new case failed at line 340 `expect(sharedPage.props?.hideFloatingChrome).toBe(true)` received `undefined`. | Then restored the prop and re-ran — 6/6 PASS. The remaining 5 cases remained green during the revert, proving the revert was scoped to F-1. |
| Pre-revert blob hash (event component) | `git rev-parse HEAD:mingla-business/src/components/event/PublicEventPage.tsx` | `40e88cebe063dd319a7719b9b65b9621f22193f3` | Pre-revert (= commit `d243050b1` state) blob. |
| Scope grep | `git diff --stat HEAD` | 4 product files + 1 test + 1 registry row | No `app/`, `supabase/`, `mingla-admin/`, or trip-page paths. |
| TypeScript / ESLint | Not re-run | Pre-existing-red per REVIEW §6.3 — out of scope per rework dispatch. | — |
| Playwright runtime | Deferred to tester per role boundary | — | Tester re-runs Chromium + iOS WebKit T-1..T-7 with `getByTestId('orch-0961-public-event-share')` / `…-close` selectors. |

## 13. Regression Surface

1. **`ExpandedBusinessEventSheet.tsx` (app-mobile sheet preview):** Did NOT change consumer — default `hideFloatingChrome=false` preserves sheet chrome behavior. Tester should spot-check the sheet still renders Close + Share in the app-mobile build (low risk; default-value safe by design).
2. **Shared package consumers that pass props by spread (`...sharedProps`):** None found in repo grep, but flagged for vigilance.
3. **Brand page Share modal:** Untouched; still opens via the existing handler.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| F-2 runtime root cause not directly fixed | If mobile-viewport timeout was selector-resolution → testID handles resolve it. If it was a deeper RN Web reanimated / `<Pressable>` rendering bug on iPhone UA, testID alone won't help — tester re-run will determine. | Tester re-runs with `getByTestId`; if still timing out, escalate to a new investigation ORCH targeted at the rendering path. | Adapter testIDs |
| Shared package default unchanged | If a future host forgets to pass `hideFloatingChrome` but renders its own chrome on top, the duplicate returns. | The adversarial test pins the prop for the buyer-web adapter. A hard CI guard could be added later if more hosts adopt the pattern. | `packages/event-rendering/types.ts` |

## 15. Discoveries For Orchestrator

- **None new for this rework.** The previous v1 implementation surfaced the duplicate-chrome risk in §10 + §14; this rework resolves it.
- **F-2 hypothesis chain to communicate to tester:** SafeAreaProvider IS mounted at root (`mingla-business/app/_layout.tsx:247`), so the mobile-viewport timeout is not a missing-provider bug. The two surviving hypotheses are: (a) Playwright's `getByRole('button', {name:'Close'})` resolution against RN Web's mobile-UA render differs from desktop — testID handles bypass this entirely; (b) a deeper RN Web / reanimated render-path bug under iPhone UA — tester re-run with `getByTestId` will tell us which.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** None.
- **Business/admin web:** Vercel `[deploy]` tag required at CLOSE (touches `mingla-business/src/` + `packages/event-rendering/`).
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
fix(public): suppress duplicate share chrome + add testID handles

Resolves ORCH-0961 rework: shared event-rendering package now accepts
hideFloatingChrome; buyer-web adapter opts in so only one Share/Close
exists in the DOM and accessibility tree. testID="orch-0961-public-*"
added on brand+event close+share for mobile-viewport Playwright.

Evidence: focused Jest 3 suites / 10 tests PASS; new F-1 adversarial
case fails-on-revert verified at blob 40e88cebe (event component);
remaining 5 cases stayed green during revert (scope-confined).
Deploy: business web only (Vercel [deploy] required); no backend.
```

## Ready-To-Test Checklist

1. Open `/e/{brandSlug}/{eventSlug}` fresh tab (Chromium desktop + WebKit desktop + WebKit iPhone). Expect: ONE Share button + ONE Close button in the DOM. Use `getByTestId('orch-0961-public-event-share')` / `…-close`.
2. Open `/b/{brandSlug}` fresh tab in all three viewports. Use `getByTestId('orch-0961-public-brand-close')`.
3. Tap Close on `/b/{brand}` (no history) → `/`. Tap Close on `/e/{brand}/{event}` (no history) → `/b/{brand}`.
4. Tap Share on both → ShareModal opens (no regression).
5. Verify `getByRole('button', {name:'Share'}).all()` returns length=1 on the event page DOM (the F-1 gate).
