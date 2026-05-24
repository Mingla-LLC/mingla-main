# SPEC — META-ORCH-0952 [Buyer-web confirm pipeline — multi-ticket QR carousel fix]

**Mode:** SPEC (binding contract)
**Date:** 2026-05-24
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]`
**Branch:** `meta-orch-0952-buyer-web-confirm-deep-forensics`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md` (APPROVED)
**Confidence:** HIGH — both root causes proven across 3 browser engines on 2 routes; live SQL on real orders ruled out data/edge.

---

## 1. Executive Summary

The multi-ticket QR carousel on buyer-web confirm pages collapses into a thin strip because two layered faults interact: React error #418 fires post-hydration in all three browser engines, and the carousel's first paint is an empty measuring host whose `width: "100%"` shrink-wraps to `0px` inside the `qrCard` parent's `alignItems: "center"` chain. This SPEC eliminates both: the carousel is restructured so it never renders an empty measuring host (CSS-percentage page widths on web, numeric `pageWidth` on native, `pageWidth === 0` early-return removed), the `qrCard` parent stops shrink-wrapping its child, the stale ORCH-0930 v3 mount-block comments are removed, and the implementor isolates the residual #418 source via instrumented error boundary then eliminates it. A browser-running regression test contract replaces the source-string tests that gave 5 attempts false confidence — both implementor and tester ship `expo export -p web` based tests that assert positive computed width, N mounted `<img>` elements, no `pageerror` matching `Minified React error #418`, on Chromium + WebKit + Firefox, for both trip and event routes. Buyers who pay for 2+ tickets on buyer-anonymous web will see N swipeable QR cards with dots + hint, identical to single-ticket visual quality.

---

## 2. Background

This SPEC is built on the APPROVED investigation report — `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md`. That report classifies F1 (React #418 still fires post-v2) and F2/F3 (carousel layout deadlock + GlassCard parent shrink-wrap) as confirmed root causes, F4/F5/F6 (schema/data/edge/SVG/Suspense) as RULED OUT, and F7 (source-string-only regression tests) as the process contributor that let 5 prior attempts ship without catching the live failure. Do not re-litigate any of those findings in implementation — they are sealed.

---

## 3. Cross-Surface Impact

| Surface | In scope? | Why / what |
|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | NO | Buyer-web confirm pages do not exist in the consumer app; consumer ticket UX is the separate ORCH-0847 Phase C cart sheet. |
| Consumer Android (`app-mobile/` Android) | NO | Same as above. |
| **Buyer/anonymous Web** (`mingla-business/` `/checkout/{eventId}/confirm` + `/checkout-trip/{tripEventId}/confirm`) | **YES — PRIMARY** | Both routes use the same `TicketQrCarousel`; both must render identically. |
| Business iOS (`mingla-business/` iOS native dev build) | YES — REGRESSION GUARD ONLY | Multi-ticket carousel believed-working on native (no SSR/hydration). Implementor MUST verify no regression — no behavioral change required, but the native code path must continue to size pages from `pageWidth` numeric values. |
| Business Android (`mingla-business/` Android native dev build) | YES — REGRESSION GUARD ONLY | Same as Business iOS. |
| Admin Web (`mingla-admin/`) | NO | No checkout / no carousel on admin. |
| Business Web preview (`mingla-business/` dev build on web) | YES — DEV PARITY | Dev-mode `expo start --web` must render identically to production; implementor uses this for the inner-loop. |

Parity for the two buyer-web routes is **automatic** (shared `TicketQrCarousel` component). Both `confirm.tsx` files must apply identical changes; SC-1 through SC-7 below have explicit "trip + event" wording so the tester can't skip a route.

---

## 4. Affected Files (Scoped Allowlist)

The implementor MAY edit ONLY these files. Anything else is OUT OF SCOPE — if implementor finds during implement that another file MUST change, STOP and request a SPEC amendment via the orchestrator.

| File | Reason |
|---|---|
| [`mingla-business/src/components/checkout/TicketQrCarousel.tsx`](../../mingla-business/src/components/checkout/TicketQrCarousel.tsx) | Core fix — eliminate empty-measuring-host first render; restructure page-width handling. |
| [`mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx`](../../mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx) | Fix `qrCard` parent shrink-wrap; remove stale v3 comment block at L497-502; potentially restructure `isClient` gate if #418 isolation finds it implicated. |
| [`mingla-business/app/checkout/[eventId]/confirm.tsx`](../../mingla-business/app/checkout/[eventId]/confirm.tsx) | Mirror the trip-confirm changes; both routes must end identical in this surface. |
| [`mingla-business/src/components/checkout/__tests__/orch_0930_qr_carousel_mounted_guard.test.tsx`](../../mingla-business/src/components/checkout/__tests__/orch_0930_qr_carousel_mounted_guard.test.tsx) | Delete or supersede. Per ORCH-0840 [Regression-test enforcement + append-only CI], deletion requires `[TEST-MOD-APPROVED META-ORCH-0952]` in the CLOSE commit body. The browser-running regression tests below REPLACE this file's source-string assertions. |
| `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_browser.test.ts` (NEW) | Implementor's happy-path browser-running regression test. |
| `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_adversarial.test.ts` (NEW — tester writes) | Tester's adversarial browser-running regression test. |
| Test fixtures (NEW, implementor scope): a Playwright fixture / route harness file under `mingla-business/playwright/` (path implementor picks) that serves the exported buyer-web confirm route with mocked `ticket-checkout-confirm` and `ticket-checkout-status` responses for 1-ticket + N-ticket cases. | Required infrastructure for both regression tests. |
| `mingla-business/playwright.config.ts` (NEW or extend) | Configure Chromium + WebKit + Firefox projects. |
| `mingla-business/package.json` | Add `@playwright/test` to `devDependencies` AND add npm scripts the test contract needs (e.g. `test:browser`, `web:export`). No other dependency changes; no `dependencies` edits; no version bumps to existing packages. (Amendment 1 — 2026-05-24.) |
| `mingla-business/package-lock.json` (or `pnpm-lock.yaml` / `yarn.lock` — whichever this workspace uses) | Lockfile update produced by the `npm install --save-dev @playwright/test` (or equivalent) command. Implementor commits the lockfile diff alongside `package.json`. (Amendment 1 — 2026-05-24.) |

**Amendment 1 (2026-05-24):** §4 allowlist extended to include `mingla-business/package.json` (devDep + scripts only) and the workspace lockfile, to unblock the `@playwright/test` install required by §7 and §11 step 2. No widening of behavioral scope; no other dependency edits permitted.

**Amendment 2 (2026-05-24) — Dynamic checkout route-tree authorization for React #418 isolation:**

Codex implementor blocked correctly after the layout/carousel fix shipped: browser test reaches the final assertion but `pageerror` still reports `Minified React error #418` on every dynamic checkout route in both trees (`index.tsx`, `intake.tsx` where present, `buyer.tsx`, `payment.tsx`, `confirm.tsx`, and the route's `_layout.tsx`), not just `confirm.tsx`. Probe evidence in `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md` §"#418 Scope Probe" — 8 routes × `#418=1` across both `/checkout-trip/[tripEventId]/*` and `/checkout/[eventId]/*`. Source is upstream of the carousel block and shared across the dynamic checkout route shell.

§4 allowlist extended to authorize edits to every file under the two dynamic checkout route trees:

| File | Reason added |
|---|---|
| `mingla-business/app/checkout-trip/[tripEventId]/_layout.tsx` | Shared Expo Router layout for all trip-checkout pages; most likely #418 source (route-level hydration, font/dimension/context init, Stack.Screen options diverging between SSR and client). |
| `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | Trip-checkout entry page; on probe `#418=1`; implementor may need to read/edit to isolate. |
| `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` | Trip-checkout intake step; on probe path (parent route fires #418). |
| `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` | Trip-checkout buyer-info step; on probe `#418=1`. |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | Trip-checkout payment step; on probe `#418=1`. |
| `mingla-business/app/checkout/[eventId]/_layout.tsx` | Mirror of trip layout for event checkout; parity. |
| `mingla-business/app/checkout/[eventId]/index.tsx` | Event-checkout entry; on probe `#418=1`. |
| `mingla-business/app/checkout/[eventId]/buyer.tsx` | Event-checkout buyer step; on probe `#418=1`. |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | Event-checkout payment step; on probe `#418=1`. |

Implementor may READ any file in the repo for isolation purposes (no read restriction), but may EDIT only the §4 allowlist (original list + Amendment 1 + Amendment 2 above). If isolation lands on a file outside the two dynamic checkout route trees — e.g., root `mingla-business/app/_layout.tsx`, a shared module under `mingla-business/src/`, an `expo-router` config, a font/loader at app root, or a provider above the route tree — implementor MUST STOP and request Amendment 3 with the specific file + the six-field evidence that pins #418 to it. Do NOT silently widen scope.

**Hard guards still in force (operator directive, this amendment):** no DB, no edge functions, no Stripe code, no `CartContext.tsx`, no consumer mobile, no admin, no QR schema changes unless new evidence proves they are required. The amendment authorizes the route-tree files ONLY because the probe evidence pinpoints them.

**Diagnostic protocol extension for Amendment 2:** implementor's error-boundary + DIAG instrumentation (per §5 React #418 isolation) should now wrap each affected route page or the route `_layout.tsx`, not just the confirm.tsx carousel block. All `[META-ORCH-0952-DIAG]` markers across the route tree must still be reaped before CLOSE per Step 1.5.

**Carousel work already shipped is preserved:** the partial implementation (Playwright harness, carousel rewrite, `qrCard` shrink-wrap fix, stale-comment cleanup, browser-running regression test infrastructure) stays in the branch. Amendment 2 only adds new authorized files; nothing is undone.

**Scope check at re-implementation start:** before editing any newly-authorized file, implementor must restate the locked architecture (§5) and confirm the change being made is targeted at isolating/eliminating React #418, not at incidental refactor.

**OUT OF SCOPE — implementor MUST NOT edit:**

- `tickets.qr_code` schema or any `supabase/migrations/`.
- `supabase/functions/_shared/ticketQrImage.ts` (server-side QR PNG generation).
- `supabase/functions/ticket-checkout-confirm/index.ts` or `supabase/functions/ticket-checkout-status/index.ts` (except: if a test fixture genuinely requires a contract change, STOP and request SPEC amendment).
- Stripe checkout, finalization RPC, webhook, reconcile.
- `mingla-business/src/components/checkout/CartContext.tsx` (`OrderResult.qrImageDataUrl` threading works correctly).
- `app-mobile/`, `mingla-admin/`, or any consumer-app code.
- The `buildQrPayload` helper in [`mingla-business/src/utils/stubOrderId.ts`](../../mingla-business/src/utils/stubOrderId.ts).

---

## 5. Architecture Decision (LOCKED)

### Decision: hybrid web/native page-width strategy + remove parent shrink-wrap + remove empty-measuring-host early-return.

**Web path (`Platform.OS === "web"`):** the multi-page `<ScrollView horizontal pagingEnabled>` renders on first paint without waiting for `pageWidth` measurement. Each page uses CSS percentage width relative to the scroll container — `width: "100%"` of the ScrollView's contentContainer width — so RNW translates to CSS `flex: 0 0 100%` per page and the browser's native scroll-snap (which `pagingEnabled` already wires up) handles paging without any JS-measured `pageWidth`. The `pageWidth` state still exists and is still updated by `onLayout` because `handleScroll`'s active-index math needs a numeric `pageWidth` — but the **render** no longer gates on `pageWidth > 0`. On first paint with `pageWidth === 0`, dots track index 0 (correct — user hasn't scrolled). After onLayout fires (microtask later), `pageWidth` is set and `handleScroll` becomes accurate for subsequent scrolls.

**Native path (`Platform.OS !== "web"`):** behavior is preserved — pages get `width: pageWidth` numeric values, the `pageWidth === 0` early-return CAN remain because native correctly publishes onLayout synchronously on first measure and the shrink-wrap pathology is web-specific. Implementor MAY choose to unify the paths (using CSS-percentage on native too) IF native still measures correctly; this is an implementor judgment call constrained by SC-7 (no native regression).

**Parent shrink-wrap fix:** `styles.qrCard` (currently `{ marginBottom: spacing.md, alignItems: "center" }` at [`confirm.tsx:642-645`](../../mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx#L642-L645)) MUST remove `alignItems: "center"` (or change to `alignSelf: "stretch"` on the child carousel). The carousel internally centers its content via `styles.host.alignItems: "center"` so the visual centering is preserved. The investigation proved (F3) that `alignItems: "center"` on the parent collapses the child's `width: "100%"` to `0px` when the child has no intrinsic-width content on first paint.

**Empty-measuring-host early-return:** the `if (pageWidth === 0) return <View style={styles.host} onLayout={handleLayout} />` block at [`TicketQrCarousel.tsx:143-145`](../../mingla-business/src/components/checkout/TicketQrCarousel.tsx#L143-L145) MUST be removed. The carousel goes straight to rendering the full multi-page subtree with `<Image>` elements mounted. `onLayout` is attached to the outer host as today; the `pageWidth` state still updates from it.

### The locked invariant (this is the contract):

> **On first paint of a multi-ticket carousel on buyer-web (`Platform.OS === "web"`), the host element has `getBoundingClientRect().width > 0` AND the DOM contains N `<img>` elements (or N placeholder views) for N tickets. No React #418 pageerror fires.**

This invariant is enforced at three gates: implementor's happy-path test, tester's adversarial test, manual operator iPhone-Safari check.

### Why not other options:

- **Option: synchronous `getBoundingClientRect` via `useLayoutEffect` on first render** — still has a paint cycle (first paint with 0 width, then layout effect fires, then re-paint). Doesn't eliminate the strip-flash. CSS-percentage avoids the layout cycle entirely.
- **Option: `Dimensions.get("window").width` as first-paint approximation** — produces oversized pages that triggered the original ORCH-0852 overflow clip. Rejected for cause.
- **Option: drop the carousel entirely on web, render vertically stacked QRs** — acceptable fallback BUT explicitly NOT this SPEC's choice; the user-research basis for the swipe-cards UX (Apple Wallet parity, established Cycle 11 J-S8) should be preserved unless future research changes it.
- **Option: render-blocking suspense until `pageWidth` measured** — adds complexity, doesn't fix the parent shrink-wrap, still vulnerable to the chicken-and-egg.

### React #418 isolation (implementor MUST instrument):

The investigation proved #418 still fires post-v2 across all 3 browsers but did not isolate its source. The implementor MUST:

1. Wrap the carousel render block in both `confirm.tsx` files (currently L503-515 in trip) in a React error boundary that captures `componentDidCatch(error, info)` and logs the full `error.message` + `info.componentStack` to `console.error` with prefix `[META-ORCH-0952-DIAG]`.
2. During implement, run the browser-running test harness against the in-progress build, capture the `[META-ORCH-0952-DIAG]` console output, identify which component throws and at which lifecycle phase (hydration vs first effect vs subsequent re-render).
3. Once the source is isolated, eliminate it (likely candidates: a `pageWidth`-dependent value in JSX that differs between SSR and client; the `isClient` `useState(false) + useEffect` pattern itself producing a re-render that React's hydration recovery flags; a fontFamily that resolves differently in static export vs browser; a `Dimensions` call inside render). Document the actual cause in the IMPLEMENTATION report.
4. **Remove the error boundary + DIAG markers before CLOSE** — orchestrator Step 1.5 will grep for `[META-ORCH-0952-DIAG]` and BLOCK CLOSE if any match. Per Mingla META-ORCH-0744-PROCESS / I-PROPOSED-L.

If implementor cannot eliminate #418 cleanly in one pass, STOP and request SPEC amendment — do NOT silently leave #418 firing and ship "the strip is gone, just the error is still in console."

---

## 6. Behavioral Contracts

One bullet per assertion the tester checks. Numbered for traceability.

- **BC-1** On `/checkout-trip/{tripEventId}/confirm` with a paid 3-ticket order response, the `<ScrollView accessibilityLabel="Ticket QR carousel">` element exists in the rendered DOM on first paint (no setTimeout, no act-wait beyond initial render commit).
- **BC-2** Same condition as BC-1: the rendered DOM contains exactly 3 `<img>` elements inside the carousel host with non-empty `src` attributes starting with `data:image/png;base64,`.
- **BC-3** Same condition as BC-1: the carousel host element's `getBoundingClientRect().width` is > 0 (target: matches the parent qrCard's inner content width; minimum: ≥ 200px on viewports ≥ 375px).
- **BC-4** Same condition as BC-1: 3 dot indicators are visible in the DOM with the first one styled active.
- **BC-5** Same condition as BC-1: "Swipe to see next ticket" hint text is present in the DOM.
- **BC-6** Same condition as BC-1: no `pageerror` event whose message matches `/Minified React error #418/` fires during the page lifecycle up to 5 seconds after initial render.
- **BC-7** All BC-1 through BC-6 hold identically on `/checkout/{eventId}/confirm` with a paid 3-ticket event-ticket order.
- **BC-8** All BC-1 through BC-7 reproduce on Chromium, WebKit, and Firefox via Playwright.
- **BC-9** Single-ticket regression guard: on a paid 1-ticket order on either route, the rendered DOM contains exactly 1 `<img>` element, NO dots, NO "Swipe to see next ticket" hint, AND no `pageerror` matching React #418.
- **BC-10** Native regression guard: on iOS dev build and Android dev build of `mingla-business`, a paid 3-ticket trip-confirm renders 3 swipeable QR cards with dots and hint. (Behavior unchanged from pre-SPEC.)
- **BC-11** Operator iPhone-Safari manual check (original visual-bug-report device): paid 3-ticket trip-confirm renders correctly.
- **BC-12** Code hygiene: zero occurrences of `[META-ORCH-0952-DIAG]` in `mingla-business/`, `app-mobile/`, `supabase/functions/`, or `mingla-admin/` source after implementor's diagnostic cleanup.
- **BC-13** Stale comment cleanup: comments referencing "ORCH-0930 v3 useState initializer pattern" at `confirm.tsx` L497-502 (trip) and the parallel block (event) are removed or replaced with comments accurately describing the post-SPEC pattern.

---

## 7. Test Contract (per ORCH-0840 Step 0.5)

### Implementor's happy-path browser regression test (NEW)

**Path:** `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_browser.test.ts`

**Test runner:** Playwright Test (`@playwright/test`). Implementor adds `@playwright/test` to `mingla-business/package.json` devDeps if not present.

**Setup:** before each test, the harness:
1. Runs `expo export -p web` to produce the static buyer-web bundle (CI caches this; locally a flag skips re-export if `web-build/` exists and is fresh).
2. Serves `web-build/` on a local port (e.g. `npx serve -s web-build` via Playwright `webServer` config).
3. Mocks `ticket-checkout-confirm` and `ticket-checkout-status` Supabase Edge URLs via `page.route()` to return canned responses.

**Cases (each runs on Chromium + WebKit + Firefox via Playwright `projects`):**

| Test ID | Route | Mock response | Asserts |
|---|---|---|---|
| HP-01 | `/checkout-trip/test-trip-id/confirm?cs=mock&csi=mock&bst=mock` | 3-ticket paid order with `qrImageDataUrl` per ticket | BC-1, BC-2, BC-3, BC-4, BC-5, BC-6 |
| HP-02 | `/checkout/test-event-id/confirm?cs=mock&csi=mock&bst=mock` | 3-ticket paid event order | BC-7 (same checks as HP-01) |
| HP-03 | Same as HP-01 but 1-ticket response | 1-ticket paid order | BC-9 (single-ticket regression guard) |

**fails-on-revert verification:** implementor must run the test suite once with the SPEC fix applied (capture: all 9 = 3 tests × 3 browsers PASS), then `git stash` the changes to `TicketQrCarousel.tsx` + `confirm.tsx` files, re-run (capture: HP-01 + HP-02 FAIL on `pageerror #418` and/or width=0 assertions; HP-03 may still pass since single-ticket already worked), then `git stash pop`. Document both commit hashes in the IMPLEMENTATION report per ORCH-0840 Step 0.5(a). A test that passes on both fixed and unfixed bundles does not exercise the bug and FAILS the gate.

### Tester's adversarial browser regression test (NEW — tester writes after PASS)

**Path:** `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_adversarial.test.ts`

**Required adversarial vector (SPEC picks ONE; tester may add more):** **Viewport resize during carousel mount.** Open the confirm route on a narrow viewport (375 × 667 iPhone SE), wait for carousel mount and BC-3 to pass, then resize viewport to wide (1440 × 900), then back to narrow. Assert: no `pageerror` matching React #418 fires during or after either resize, the 3 `<img>` elements remain in the DOM throughout, the carousel host width remains > 0 throughout, and the active-index dot tracking remains correct after each resize.

**Why this vector:** the prior 5 attempts focused exclusively on initial-mount layout. Viewport resize triggers RNW relayout + potential re-measurement of `pageWidth` — a different angle than happy-path that exercises whether the new architecture remains stable under runtime layout changes. If the SPEC fix accidentally introduces a re-render-on-resize loop or a new hydration-mismatch on layout change, this test catches it.

**fails-on-revert verification:** tester runs adversarial test with implementor's fix applied (PASS expected), then reverts the implementor's `TicketQrCarousel.tsx` + `confirm.tsx` changes via `git stash`, re-runs (FAIL expected on #418 pageerror AND/OR width=0), restores. Documents both hashes in QA report.

### Source-string test deletion

The existing `mingla-business/src/components/checkout/__tests__/orch_0930_qr_carousel_mounted_guard.test.tsx` becomes obsolete — its source-string assertions are precisely the false-confidence pattern Q6 identified. It MAY be deleted by the implementor; CLOSE commit body must include `[TEST-MOD-APPROVED META-ORCH-0952]` per ORCH-0840 if any test lines are removed. Alternative: implementor may keep the file but supplement (not replace) with the new browser-running tests — this is acceptable but adds noise. Recommendation: delete.

---

## 8. Success Criteria

Numbered, observable, testable, unambiguous. Tester maps each to a verdict row.

- **SC-1** Browser regression test `meta_orch_0952_carousel_browser.test.ts` HP-01 passes on Chromium AND WebKit AND Firefox (3-ticket trip route). `fails-on-revert verified` at commit hash documented.
- **SC-2** Browser regression test HP-02 passes on Chromium AND WebKit AND Firefox (3-ticket event route).
- **SC-3** Browser regression test HP-03 passes on Chromium AND WebKit AND Firefox (1-ticket regression guard).
- **SC-4** Tester's adversarial test `meta_orch_0952_carousel_adversarial.test.ts` passes on Chromium AND WebKit AND Firefox. `fails-on-revert verified` at commit hash documented.
- **SC-5** Manual operator iPhone-Safari check on `business.usemingla.com/checkout-trip/{real-tripEventId}/confirm` post-deploy with a real (or test-mode) 3-ticket purchase: carousel renders 3 swipeable QRs with dots + hint, no console error matching React #418.
- **SC-6** Manual native regression check on iOS dev build (iPhone 17 Pro simulator per worktree's assigned sim) and Android dev build: 3-ticket trip-confirm renders 3 swipeable QRs, behavior unchanged from pre-SPEC.
- **SC-7** Source code grep for `[META-ORCH-0952-DIAG]` returns zero matches across `mingla-business/`, `app-mobile/`, `supabase/functions/`, `mingla-admin/`.
- **SC-8** Source code grep at `confirm.tsx:497-510` (and parallel event-confirm block): no comment text contains "ORCH-0930 v3" or "useState initializer pattern" (replaced or removed per BC-13).
- **SC-9** Implementor's IMPLEMENTATION report documents the actual source of React #418 (which file, which lifecycle phase) and the specific change that eliminated it.
- **SC-10** Strict-grep CI registry: if implementor's changes warrant a new invariant gate (see §10), the gate is registered in `.github/scripts/strict-grep/` per `feedback_strict_grep_registry_pattern.md` and added to the existing `strict-grep-mingla-business.yml` job.

---

## 9. Failure Modes the Implementor MUST Instrument

During implement (NOT in shipped code):

1. **React error boundary** around the carousel mount block in both `confirm.tsx` files, prefixed `[META-ORCH-0952-DIAG]`. Captures `componentDidCatch(error, info)` and logs `error.message`, `error.stack`, `info.componentStack` to `console.error`.
2. **Render-cycle logger** inside `TicketQrCarousel.tsx`: log on each render `[META-ORCH-0952-DIAG] render: pageWidth=${pageWidth}, isMulti=${isMulti}, ticketsLength=${tickets.length}, mountId=${...}` so the cycle of (SSR-render → hydrate-render → effect-fire → re-render) can be reconstructed from console output.
3. **onLayout logger**: `[META-ORCH-0952-DIAG] onLayout: width=${e.nativeEvent.layout.width}` so the actual measured width chain is visible.
4. **All DIAG markers REMOVED before CLOSE.** Orchestrator's Step 1.5 grep is the enforcement gate.

If isolation reveals that the React #418 source is in a file outside this SPEC's allowlist (§4), STOP and request SPEC amendment — do NOT silently widen scope.

---

## 10. Invariants This SPEC Codifies

### NEW invariant — I-PROPOSED-BUYER-WEB-CAROUSEL-BROWSER-TESTED

**Rule:** Any regression test asserting buyer-web checkout-confirm carousel behavior MUST run in a real browser (Playwright Chromium minimum; WebKit + Firefox strongly recommended) against the exported web bundle (`expo export -p web` output served locally OR equivalent harness). Source-string assertions (component-renders-without-crashing, imports-include-X, JSX-contains-Y) are insufficient as the sole coverage for this surface.

**Why:** META-ORCH-0952 Q6 pattern analysis proved that 5 successive attempts shipped with green source-string tests while production browsers consistently showed a broken carousel. The bug class (RNW layout deadlock + React hydration mismatch + parent shrink-wrap) cannot be detected by reading source — it requires a real browser layout engine + real React reconciler running on the production bundle.

**Enforcement:** if the implementor's changes warrant a CI gate, register in `.github/scripts/strict-grep/` per `feedback_strict_grep_registry_pattern.md` — e.g., `strict-grep-meta-orch-0952-browser-test-present.mjs` that asserts at least one `*.test.ts` file under `mingla-business/src/components/checkout/__tests__/` imports `@playwright/test` AND references `expo export` setup AND the `TicketQrCarousel` component. Add as a job in `.github/workflows/strict-grep-mingla-business.yml`. Implementor MAY defer the CI gate to a follow-up META-ORCH if scope pressure demands; if so, register the follow-up ORCH at CLOSE.

**Status at CLOSE:** flips from `I-PROPOSED-*` to `I-*` (active) in `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

### Existing invariants preserved (do NOT regress)

- All 14 Constitutional rules.
- I-PROPOSED-J (Zustand persist no server snapshots) — N/A here, no Zustand touched.
- ORCH-0840 regression-test enforcement + append-only CI — explicitly invoked above (both happy-path + adversarial tests are append-only post-CLOSE).

---

## 11. Implementation Order

1. Read this SPEC end-to-end. Read the linked investigation report end-to-end. Confirm understanding of the two root causes (F1 #418, F2/F3 layout) and the SPEC's locked invariant (§5).
2. Set up the Playwright harness: add `@playwright/test` to `mingla-business/package.json` devDeps, create `mingla-business/playwright.config.ts` with Chromium + WebKit + Firefox projects + `webServer` for the exported web build, create the route harness with mocked edge responses.
3. Write the happy-path browser regression tests (HP-01, HP-02, HP-03). Run them against the CURRENT codebase — expect HP-01 + HP-02 to FAIL with `pageerror #418` and/or `width=0` (this is the `fails-on-revert verified` baseline for the inverse direction).
4. Add the React error boundary + DIAG loggers per §9.
5. Restructure `TicketQrCarousel.tsx`: remove `pageWidth === 0` early-return (L143-145); restructure web path to render pages with CSS-percentage widths; preserve native path numeric `pageWidth` behavior.
6. Restructure `confirm.tsx` `qrCard` style: remove `alignItems: "center"` from `qrCard` (L644 trip + parallel event); confirm carousel internally centers.
7. Run browser tests — capture which DIAG output appears. Use it to isolate #418 source. Apply the targeted fix.
8. Iterate steps 5–7 until HP-01 + HP-02 + HP-03 all PASS on all 3 browsers.
9. Verify `fails-on-revert`: `git stash` the source changes, re-run tests (expect FAIL), `git stash pop`. Document both commit hashes.
10. Remove ALL `[META-ORCH-0952-DIAG]` markers and the error boundary. Re-run tests (still PASS).
11. Remove stale comments at trip-confirm L497-502 and parallel event-confirm block (BC-13).
12. Decide on the source-string test (`orch_0930_qr_carousel_mounted_guard.test.tsx`): delete (recommended; document `[TEST-MOD-APPROVED META-ORCH-0952]` in CLOSE commit) OR keep (acceptable).
13. Run native regression check on iOS dev build via worktree's assigned sim and Android dev build (BC-10) — confirm no behavioral change vs pre-SPEC.
14. Write IMPLEMENTATION report at `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md` with: old→new code receipts per file, both `fails-on-revert verified` commit hashes per ORCH-0840 Step 0.5(a), the isolated #418 source + the specific change that eliminated it (SC-9), the native regression check evidence (SC-6).
15. Hand off to TEST.

---

## 12. Pipeline Routing Post-SPEC

```
SPEC (this) → REVIEW (orchestrator) → IMPLEMENT (Codex `implementor-mingla` default, or Claude `mingla-implementor`)
  → REVIEW (orchestrator) → DEPLOY (orchestrator — likely none; buyer-web only, no edge fns touched)
  → TEST (Claude `mingla-tester` — live matrix: iOS sim + Android emu + desktop Chrome + desktop Safari + desktop Firefox + operator's physical iPhone Safari per BC-11)
  → REVIEW (orchestrator) → CLOSE → worktree reap
```

If TEST returns FAIL: implementor REWORK with cited findings; max 2 retest cycles before orchestrator escalates per Mingla pipeline policy.

If implementor finds during implement that:
- A file outside §4 allowlist must change → STOP, request SPEC amendment.
- The #418 source cannot be isolated cleanly in one pass → STOP, request SPEC amendment.
- Native regression appears (BC-10 fails) → STOP, fix or request SPEC amendment if fix requires out-of-scope files.

---

## 13. Out of Scope (restate verbatim)

- `tickets.qr_code` schema or QR token generation.
- `_shared/ticketQrImage.ts` server-side PNG.
- `ticket-checkout-confirm` / `ticket-checkout-status` response shape (except adding a test fixture if needed — flag explicitly).
- Stripe checkout, live charges, finalization RPC, webhook/reconcile.
- Consumer mobile, business native checkout flows beyond regression guard, admin surfaces.
- `qrImageDataUrl` threading in `CartContext.tsx` `OrderResult` type — works.
- `buildQrPayload` helper.

---

## 14. Discoveries for Orchestrator (from SPEC author)

- The 5-attempt saga is the strongest signal yet that the buyer-web checkout surface needs the new "browser-tested" invariant (§10). If META-ORCH-0953's polish batch (ORCH-0946 + 0947 + 0948 + 0949) ships before this SPEC's CI gate registers, those ORCHs should adopt the same browser-test contract — recommend orchestrator amend META-ORCH-0953's sequencing or have each child ORCH inherit I-PROPOSED-BUYER-WEB-CAROUSEL-BROWSER-TESTED.
- The legacy `orch_0930_qr_carousel_mounted_guard.test.tsx` is a teaching example for future SPEC authors of why source-string regression tests are insufficient for layout/hydration bugs — consider preserving it as a reference at `Mingla_Artifacts/examples/` (move not delete) when the CI gate registers.
