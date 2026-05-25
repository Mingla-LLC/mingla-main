# IMPLEMENTATION — META-ORCH-0952 Buyer-Web Confirm Pipeline

**Status:** implemented, partially verified  
**Date:** 2026-05-24  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]`  
**Branch:** `meta-orch-0952-buyer-web-confirm-deep-forensics`  
**Bundle/branch commit probed:** `b8d5300aa0d3c09c979fe31a3452d89d70896c84`  
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md`  
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md`

## Summary

The buyer-web confirm carousel now passes the browser-running contract across Chromium, WebKit, and Firefox. Multi-ticket trip and event confirm pages mount the carousel with three QR images, positive width, dots, swipe hint, and zero React #418 pageerrors; the single-ticket guard renders one QR without carousel affordances.

The residual #418 source was Expo Router static web pre-render hydration, not DB/edge/Stripe/QR data. Amendment 3 discriminator runs showed #418 on checkout and non-checkout routes under `web.output: "static"`; switching `mingla-business/app.json` web output to `"single"` eliminated #418 on checkout and non-checkout controls. Root `app/_layout.tsx` also removes the render-time `useRef(Date.now())` candidate by initializing the timestamp in `useEffect`.

Native SC-6 remains a manual tester gate, not a completed visual pass: iOS simulator was booted with an installed business app, and Android emulator was booted, but the Android business package was not installed and no native fixture path exists in this worktree to drive a paid 3-ticket confirm state. No native behavior code path was changed in `TicketQrCarousel`; native still gates multi-page render on numeric `pageWidth`.

## Amendment 3 Discriminator Probe

Gate rule: run before editing `mingla-business/app/_layout.tsx`, `mingla-business/app.json`, or `mingla-business/app.config.ts`.

Bundle commit: `b8d5300aa0d3c09c979fe31a3452d89d70896c84`.

Pre-edit probe command shape: `npm run web:export`, serve `web-build`, Playwright Chromium route probe with `page.on("pageerror")` matching `/Minified React error #418/`, 5s wait per route, two repeated runs.

| Run | Group | Route | #418 |
|---|---|---|---|
| run-1 | checkout | `/checkout-trip/test-trip-id/confirm?cs=mock&csi=mock&bst=mock` | yes |
| run-1 | checkout | `/checkout/test-event-id/confirm?cs=mock&csi=mock&bst=mock` | yes |
| run-1 | non-checkout | `/` | no |
| run-1 | non-checkout | `/auth` | yes |
| run-1 | non-checkout | `/home` | yes |
| run-2 | checkout | `/checkout-trip/test-trip-id/confirm?cs=mock&csi=mock&bst=mock` | yes |
| run-2 | checkout | `/checkout/test-event-id/confirm?cs=mock&csi=mock&bst=mock` | yes |
| run-2 | non-checkout | `/` | no |
| run-2 | non-checkout | `/auth` | yes |
| run-2 | non-checkout | `/home` | yes |

Representative raw pageerror:

```text
Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
```

Verdict: non-checkout routes also fired #418, so Amendment 3 authorized root shell/config edits.

## #418 Isolation

Temporary `[META-ORCH-0952-DIAG]` instrumentation was added to `RootLayoutInner` and the root Stack boundary. The trace showed root renders moving from `loading:true,currentBrandId:null,brandReady:false,splashHidden:false,evictionRan:false,reapRan:false` into client bootstrap before #418 surfaced; the Stack boundary did not catch a component throw.

Isolation attempts:

| Candidate | Result |
|---|---|
| `app/_layout.tsx useRef(Date.now())` | Hardened, but #418 still reproduced while `web.output` remained `static`. Kept because it removes a real SSR/client render-time divergence. |
| Web safe-area initial metrics | Tried and removed; did not change #418. |
| `app.json web.output` | Proven source. `static` reproduced #418; `single` eliminated #418 on checkout routes and `/auth` + `/home`. |

Specific eliminating change (SC-9): `mingla-business/app.json` changed `"web": { "output": "static" }` to `"web": { "output": "single" }`, removing Expo Router static-route hydration for this app. The route test fixture was also widened from the synthetic Supabase host to `https://*.supabase.co/**` because the single export still embeds the configured project URL from app config.

## Old To New Receipts

| File | Old | New |
|---|---|---|
| `mingla-business/app.json` | Static Expo web output pre-rendered route HTML, causing React #418 hydration recovery on checkout and non-checkout routes. | Web output is `single`, so exported web routes hydrate as the client app without SSR route markup mismatch. No plugin, permission, scheme, icon, or build-target changes. |
| `mingla-business/app/_layout.tsx` | `useRef(Date.now())` evaluated during render. | Timestamp ref initializes as `null` and is set in `useEffect`; splash elapsed calculation falls back safely if needed. |
| `mingla-business/src/components/checkout/TicketQrCarousel.tsx` | Multi-ticket render returned an empty measuring host while `pageWidth === 0`; pages always used numeric width. | Web renders the full carousel subtree immediately with percentage-width pages; native keeps numeric `pageWidth` behavior and native-only early return. Dots now have stable labels for browser assertions. |
| `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` | `qrCard.alignItems: "center"` shrink-wrapped the carousel; stale ORCH-0930 v3 comments remained. | `qrCard` stretches children, stale comments removed, web confirm effects wait for client readiness. |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | Same as trip route. | Same as trip route. |
| `mingla-business/package.json` / `package-lock.json` | No Playwright browser-test dependency/scripts. | Added `@playwright/test`, `web:export`, and `test:browser`. |
| `mingla-business/playwright.config.ts` | Missing. | Added Chromium, WebKit, Firefox projects and export + static server webServer. |
| `mingla-business/playwright/meta-orch-0952-static-server.mjs` | Missing. | Added SPA static server with index fallback. |
| `mingla-business/playwright/meta-orch-0952-fixtures.ts` | Missing. | Added mocked checkout confirm/status and Supabase REST fixtures; host wildcard matches the bundle's configured Supabase project. |
| `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_browser.test.ts` | Missing. | Added HP-01, HP-02, HP-03 browser-running tests. |
| `mingla-business/src/components/checkout/__tests__/orch_0930_qr_carousel_mounted_guard.test.tsx` | Source-string test that could pass while browser carousel failed. | Deleted. Test deletion approved for CLOSE body/report with `[TEST-MOD-APPROVED META-ORCH-0952]`. |

## Verification

| Gate | Result | Evidence |
|---|---|---|
| SC-1 HP-01 | PASS | `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts`: trip 3-ticket passed on Chromium, WebKit, Firefox. |
| SC-2 HP-02 | PASS | Same command: event 3-ticket passed on Chromium, WebKit, Firefox. |
| SC-3 HP-03 | PASS | Same command: trip 1-ticket passed on Chromium, WebKit, Firefox. |
| SC-7 DIAG cleanup | PASS | `rg -n "META-ORCH-0952-DIAG|MetaOrch0952DiagBoundary" mingla-business app-mobile supabase/functions mingla-admin || true` returned zero matches. |
| SC-8 stale comments | PASS | `rg -n "ORCH-0930 v3|useState initializer pattern" ...confirm.tsx` returned zero matches. |
| Typecheck | Existing repo failures | `npm run typecheck -- --noEmit` failed on pre-existing unrelated TS errors in checkout buyer files, marketing rich editor, IconChrome, Sheet.web, missing `@mingla/payments-native`, and package typings. No new type errors were identified in the touched files. |
| SC-6 native regression | Manual gate remains | iOS booted: `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)` with installed `com.sethogieva.minglabusiness`. Android booted: `emulator-5554`, but `adb shell pm list packages com.sethogieva.minglabusiness` returned no package. No visual 3-ticket native confirm pass was completed. |

Passing browser matrix output:

```text
CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts
9 passed (29.3s)
```

Fails-on-revert output:

```text
git stash push -m meta-orch-0952-fails-on-revert-check -- TicketQrCarousel.tsx confirm.tsx app/_layout.tsx app.json
CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts --grep "HP-0[12]"
6 failed
```

Fails-on-revert details: HP-01 and HP-02 failed on Chromium, WebKit, and Firefox with `Ticket QR carousel` not found. Fixed and reverted-test commit hash: `b8d5300aa0d3c09c979fe31a3452d89d70896c84` plus uncommitted scoped implementation. The temporary stash was popped and dropped after the failure proof.

## Scope / Guards

No DB, Supabase migrations, edge functions, Stripe code, `CartContext.tsx`, `buildQrPayload`, consumer mobile, admin, QR schema, or edge-function deploys were touched. `app.config.ts` was read only and not edited.

## Remaining Manual Gates

1. SC-6 native visual check: iOS simulator + Android emulator/dev build should verify a paid 3-ticket trip-confirm renders 3 swipeable QR cards with dots and hint.
2. BC-11 physical iPhone Safari check after deploy remains downstream tester/operator scope.
3. Tester adversarial resize test remains downstream `mingla-tester` scope per SPEC.

