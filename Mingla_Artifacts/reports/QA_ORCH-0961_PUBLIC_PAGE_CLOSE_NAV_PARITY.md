# QA Report — ORCH-0961 Public Page Close Nav Parity

Date: 2026-05-25  
Tester: Codex `tester+codex`  
Branch: `ORCH-0961-public-page-close-nav-parity`  
Commit under test: `d243050b13a338e409c0c316fd639fd23d9c7e83`  
Verdict: **FAIL**

## 1. Executive Verdict

ORCH-0961 does fix the core desktop deep-link close fallback for public brand and event pages, and the new adversarial Jest test proves the event callback no longer routes founders/organizers to `/(tabs)/hub/events`.

QA fails because runtime browser testing still found release-blocking parity gaps:

1. **P1 — Event page still exposes duplicate Share chrome from the shared renderer plus the new adapter overlay.** The visible pixels overlap, but the accessibility/DOM tree has two `Share` buttons and Playwright's normal role click can target the lower legacy control while the new overlay intercepts the pointer. This violates the tester prompt's duplicate-chrome gate and T-7 "only one share control" requirement.
2. **P1 — iOS/mobile simulated browser verification did not reach a visible Close button.** Playwright WebKit with iPhone simulation and WebKit/Chromium mobile viewport both timed out waiting for the Close button on `/b/leggothis`; desktop Chromium/WebKit rendered it. The target bug explicitly concerns iOS Safari/PWA-style entry, so this cannot pass without rework or a proven environment-only explanation.

## 2. Inputs Read

- `Mingla_Artifacts/prompts/TESTER_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md`
- `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md`
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx:68-78`
- `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`

Comms ledger acked on entry: COMMS-0002, COMMS-0003, COMMS-0004 as `tester+codex (ORCH-0961)`.

## 3. Code Evidence

| Area | Evidence | Result |
|---|---|---|
| Brand close callback | `mingla-business/src/components/brand/PublicBrandPage.tsx:180-186` uses `router.canGoBack() ? back() : replace("/")`. | PASS |
| Brand close chrome | `mingla-business/src/components/brand/PublicBrandPage.tsx:324-340` renders Close + Share IconChrome row. | PASS |
| Event close callback | `mingla-business/src/components/event/PublicEventPage.tsx:205-215` uses back, `brand.slug`, `event.brandSlug`, then root fallback. | PASS |
| Event adapter chrome | `mingla-business/src/components/event/PublicEventPage.tsx:302-318` renders Close + Share IconChrome row at zIndex 4. | PARTIAL |
| Shared legacy chrome | `packages/event-rendering/PublicEventPage.tsx:181-203` still renders its own organizer-only Close and always-on Share Pressable at zIndex 3. | FAIL |
| Founder callback | `mingla-business/src/components/event/PublicEventPage.tsx:221-246` wires `callbacks.onClose` to the public fallback `handleClose`. | PASS |

## 4. Browser Matrix

Test surface:

- Brand: `/b/leggothis`
- Event: `/e/leggothis/runtime-share-test-freeta-throwaway-free-ticket-qa-event-for-testing-public-links-and-share-buttons`
- Runtime data note: local export used real Supabase public brand/event views, with `claimed_venues_public_view` mocked to `[]` because the dev anon key currently receives `permission denied for table brands` from that preflight lookup before the brand fallback query can run. This is a test-environment bypass for an unrelated public venue lookup and did not mock the brand/event content or close callbacks.

| # | Chromium | WebKit / Safari engine | iOS Safari simulated |
|---|---|---|---|
| T-1 `/b` direct, `canGoBack=false`, tap Close -> `/` | PASS | PASS | FAIL/UNVERIFIED — mobile viewport/iPhone simulation timed out before Close appeared |
| T-2 `/b` internal history, `canGoBack=true`, tap Close -> previous page | PASS by adversarial Jest true-branch coverage; local hard-nav Playwright cannot create Expo Router internal stack | PASS by adversarial Jest true-branch coverage | FAIL/UNVERIFIED — mobile route did not render Close |
| T-3 `/e` direct, brand populated, tap Close -> `/b/leggothis` | PASS | PASS | FAIL/UNVERIFIED — mobile route not reached after `/b` render timeout |
| T-4 `/e` direct, `brand.slug=null`, `event.brandSlug` present -> `/b/{event.brandSlug}` | PASS by adversarial Jest fallback branch | PASS by adversarial Jest fallback branch | PASS by adversarial Jest fallback branch only |
| T-5 `/e` internal history, `canGoBack=true`, tap Close -> previous page | PASS by adversarial Jest true-branch coverage; local hard-nav Playwright cannot create Expo Router internal stack | PASS by adversarial Jest true-branch coverage | FAIL/UNVERIFIED — mobile route not reached |
| T-6 `/b` Share opens ShareModal | PASS | PASS | FAIL/UNVERIFIED — mobile route did not render Close/Share |
| T-7 `/e` Share opens ShareModal and only one Share control exists | FAIL — ShareModal opens from top overlay, but role tree has two `Share` buttons; normal `.first().click()` hits the lower legacy target and is intercepted | FAIL — ShareModal opens from top overlay, but role tree has two `Share` buttons | FAIL/UNVERIFIED — mobile route not reached; desktop engines already fail duplicate-share condition |

## 5. Screenshot Evidence

Screenshots are stored in `Mingla_Artifacts/reports/screenshots/`:

- `orch0961-brand-chromium.png`
- `orch0961-event-chromium.png`
- `orch0961-brand-webkit.png`
- `orch0961-event-webkit.png`

Visual read: the event screenshots show one apparent top-right Share icon because the new IconChrome overlays the legacy shared-renderer Share button at the same position. Runtime/accessibility read: Playwright's page snapshot shows two `button "Share"` nodes on the event page, one from the shared renderer and one from the adapter overlay, and the lower target is pointer-intercepted by the overlay.

## 6. Founder / Organizer Regression Check

Automated founder-path coverage is in the tester-owned adversarial Jest test:

- `mingla-business/src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx`
- Test: `founder public route keeps public close fallback instead of hub replacement`
- Result: PASS

The test sets `mockUser = { id: "founder-1" }`, `mockUserBrands = [{ id: "brand-1" }]`, verifies the shared renderer receives `viewerRole="organizer"`, invokes `callbacks.onClose`, and asserts `router.replace("/b/live-brand")` instead of `router.replace("/(tabs)/hub/events")`.

Manual signed-in browser verification remains **not completed** because this local QA session does not have a scripted founder web auth flow. The callback-level founder regression is nevertheless covered by a repo-running automated test and fails if the old hub route returns.

## 7. Adversarial Regression Test

Path:

- `mingla-business/src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx`

Angle:

- Callback-behavior attack with mocked `useRouter`, not a renamed source grep.
- Executes the adapter boundary by transpiling the TSX component inside the test, mocking React hooks and app boundary modules, extracting rendered `IconChrome` and shared-renderer callback props, then invoking the real `handleClose` closure.

Coverage:

- `canGoBack=false`, `brand.slug` set -> `/b/live-brand`
- `canGoBack=false`, `brand=null`, `event.brandSlug` set -> `/b/frozen-brand`
- `canGoBack=false`, no brand slug -> `/`
- `canGoBack=true` -> `router.back()`, no replace
- founder/organizer public route -> public brand fallback, not hub route

Run output:

```text
PASS src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx
  ORCH-0961 — PublicEventPage close callback adversarial coverage
    ✓ deep-link close falls back to the live brand slug when brand is populated
    ✓ deep-link close falls back to event.brandSlug when brand is null
    ✓ deep-link close falls back to root when no public brand slug exists
    ✓ history close uses router.back without replacing the URL
    ✓ founder public route keeps public close fallback instead of hub replacement

Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
```

Fails-on-revert proof:

- Passing proof commit object: `eba18470ac1eafafb1447f92f256d3eb242ea50b`
- Reverted proof commit object: `da7901f8e7f96dfc8714d34419795bf8704a4525`
- Revert mutation used for proof only: replaced event `handleClose` with `router.replace("/(tabs)/hub/events" as never)`, then restored the product file.
- Reverted run result: FAIL, 5/5 adversarial tests failed, including expected `/b/live-brand` vs received `/(tabs)/hub/events`.

## 8. Smoke Gates

Focused Jest gate:

```text
npx jest src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx \
  src/components/event/__tests__/PublicEventPage.closeButton.test.tsx \
  src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx \
  --runInBand

PASS src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx
PASS src/components/event/__tests__/PublicEventPage.closeButton.test.tsx
PASS src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx

Test Suites: 3 passed, 3 total
Tests: 9 passed, 9 total
```

Browser export:

```text
npx expo export -p web --output-dir web-build-orch0961
Web Bundled 39549ms index.js (2235 modules)
Exported: web-build-orch0961
```

Browser runtime:

```text
Chromium desktop: T-1 PASS, T-3 PASS, T-6 PASS, T-7 FAIL_DUPLICATE_SHARE (shareCount=2)
WebKit desktop/Safari engine: T-1 PASS, T-3 PASS, T-6 PASS, T-7 FAIL_DUPLICATE_SHARE (shareCount=2)
WebKit iPhone/iOS Safari simulation: timeout waiting for Close on /b/leggothis
Chromium mobile viewport: timeout waiting for Close on /b/leggothis
```

Per REVIEW §6.3, full `tsc --noEmit` and repo ESLint were not rerun because they are documented pre-existing red and out of ORCH-0961 scope.

## 9. Findings

### F-1 — P1 HIGH — Duplicate event Share chrome remains in the runtime tree

Evidence:

- Shared renderer always renders Share at `packages/event-rendering/PublicEventPage.tsx:196-203`.
- Business adapter renders a second Share at `mingla-business/src/components/event/PublicEventPage.tsx:312-317`.
- Chromium error context: page snapshot contains two event-page `button "Share"` entries, and `.first().click()` on Share is intercepted by the overlay SVG from the new adapter row.
- Screenshots: `Mingla_Artifacts/reports/screenshots/orch0961-event-chromium.png` and `orch0961-event-webkit.png`.

Impact:

- Violates T-7 and REVIEW §6.1 duplicate-chrome gate.
- Creates an accessibility duplicate even when visual pixels overlap.
- Makes role-based automation and assistive-tech navigation ambiguous.

Required rework:

- Add a scoped way for the business public-event adapter to suppress the shared renderer's floating chrome, or otherwise ensure only one Close/Share chrome owner exists at runtime.
- Keep `/e/*` public close fallback behavior intact.
- Add/extend an automated test that fails when both adapter and shared-renderer Share controls are present in the rendered/accessibility tree.

### F-2 — P1 HIGH — Mobile/iOS-simulated runtime did not render the public Close button

Evidence:

- Playwright WebKit with `devices["iPhone 13"]`: timed out waiting for `button[name="Close"]` on `/b/leggothis`.
- Playwright WebKit with iPhone Safari UA/mobile viewport/touch: timed out waiting for `button[name="Close"]`.
- Playwright WebKit mobile viewport/touch: timed out waiting for `button[name="Close"]`.
- Playwright Chromium mobile viewport/touch: timed out waiting for `button[name="Close"]`.
- Desktop Chromium and desktop WebKit both rendered Close, which narrows this to mobile/simulated viewport behavior or the local exported bundle's mobile execution path.

Impact:

- The target scenario is specifically deep-link buyer entry on iOS Safari/PWA-like surfaces. This remains unverified and currently failing in the required simulator shape.

Required rework:

- Reproduce with Playwright mobile viewport/WebKit iPhone simulation and identify whether the app is hanging, rendering an unreachable tree, or failing before the public route mounts.
- If environment-only, document the exact cause and provide an alternate iOS Safari-equivalent runtime proof. If app-caused, fix before close.

## 10. Rework Contract

Return to implementor with two required fixes:

1. Remove/suppress duplicate event Share chrome so `/e/*` has exactly one runtime/accessibility Share control and the adapter IconChrome remains the responding tap target.
2. Make the public brand/event pages render in mobile/iOS-simulated Playwright, or prove the simulator failure is an environment artifact with a replacement iOS Safari-equivalent check.

After rework, rerun:

```text
cd mingla-business
npx jest src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx \
  src/components/event/__tests__/PublicEventPage.closeButton.test.tsx \
  src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx \
  --runInBand
```

Then rerun Chromium + iOS Safari/WebKit simulated browser checks for T-1 through T-7 and update this QA report or create a retest report.
