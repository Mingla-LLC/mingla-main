# IMPLEMENTATION — META-ORCH-0952 Buyer-Web Confirm Pipeline

**Status:** blocked before implementation completion  
**Date:** 2026-05-24  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]`  
**Branch:** `meta-orch-0952-buyer-web-confirm-deep-forensics`  
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md`  
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md`

## Summary

Implementation was stopped because React #418 is not isolated to the SPEC §4 confirm-page/carousel allowlist. After the carousel layout fix, the browser test proves the multi-ticket carousel mounts and has positive layout, but `pageerror` still reports `Minified React error #418`. A follow-up probe showed #418 fires on all tested dynamic checkout routes, including `/checkout-trip/test-trip-id`, `/checkout-trip/test-trip-id/buyer`, `/checkout-trip/test-trip-id/payment`, `/checkout/test-event-id`, `/checkout/test-event-id/buyer`, and `/checkout/test-event-id/payment`. Those routes/layouts are outside the SPEC §4 allowlist, so implementation must stop for a SPEC amendment before touching them.

## Implemented Partial Changes

| File | Old | New |
|---|---|---|
| `mingla-business/package.json` | No Playwright browser-test script/dependency. | Added `@playwright/test` devDependency, `web:export`, and `test:browser`. |
| `mingla-business/package-lock.json` | No Playwright lock graph. | Added lockfile entries from `npm install --save-dev @playwright/test`. |
| `mingla-business/playwright.config.ts` | Missing. | Added Chromium, WebKit, Firefox Playwright projects and export+static-server webServer. |
| `mingla-business/playwright/meta-orch-0952-static-server.mjs` | Missing. | Added SPA static server for `web-build/`. |
| `mingla-business/playwright/meta-orch-0952-fixtures.ts` | Missing. | Added mocked Supabase REST + `ticket-checkout-confirm/status` responses for trip/event and 1/3-ticket cases. |
| `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_browser.test.ts` | Missing. | Added HP-01, HP-02, HP-03 browser-running regression test. |
| `mingla-business/src/components/checkout/TicketQrCarousel.tsx` | Web multi-ticket render returned an empty measuring host while `pageWidth === 0`; pages always used numeric `pageWidth`; dots lacked stable labels. | Web multi-ticket render now mounts the full subtree immediately with percentage-width pages; native still preserves numeric `pageWidth` behavior; dots have stable accessible labels for browser assertions. |
| `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` | `qrCard` used `alignItems: "center"` and stale v3 comments. | Removed `qrCard.alignItems`, removed stale comments, and added a web outer client gate while investigating #418. |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | Same as trip route. | Same as trip route. |

## Verification Evidence

### Red Baseline Before Product Fix

Command:

```sh
cd mingla-business
npm run test:browser -- meta_orch_0952_carousel_browser.test.ts
```

Result before product-code changes: 9 failed. HP-01/HP-02 failed on Chromium, WebKit, and Firefox because `getByLabel("Ticket QR carousel")` was not found. HP-03 failed on Chromium, WebKit, and Firefox because `Minified React error #418` was captured.

### Partial Post-Fix Evidence

Command:

```sh
cd mingla-business
npm run test:browser -- meta_orch_0952_carousel_browser.test.ts --project=chromium
```

Result after layout changes: visual/layout assertions pass far enough to reach the final `react418Errors` assertion; all three Chromium cases still fail only because the captured array contains `Minified React error #418`.

### #418 Scope Probe

One-off Chromium probe against the exported bundle showed:

```text
/checkout-trip/test-trip-id #418 1
/checkout-trip/test-trip-id/buyer #418 1
/checkout-trip/test-trip-id/payment #418 1
/checkout-trip/test-trip-id/confirm #418 1
/checkout/test-event-id #418 1
/checkout/test-event-id/buyer #418 1
/checkout/test-event-id/payment #418 1
/checkout/test-event-id/confirm #418 1
```

This means SC-9 cannot be completed inside the current allowlist. The source is upstream of the confirm carousel block and affects dynamic checkout route hydration generally.

## Diagnostics Cleanup

Temporary `[META-ORCH-0952-DIAG]` carousel render/onLayout loggers and confirm-page error boundaries were added during isolation, then removed after the out-of-scope #418 source was proven. Cleanup grep:

```sh
rg -n "META-ORCH-0952-DIAG|MetaOrch0952DiagBoundary" mingla-business app-mobile supabase/functions mingla-admin || true
```

Result: zero matches.

## Not Completed

- Full SC-1/SC-2/SC-3 pass across Chromium, WebKit, and Firefox is blocked by cross-route React #418.
- Fails-on-revert verification is not valid until #418 is fixed, because the suite still fails on the fixed worktree.
- SC-6 native iOS/Android regression checks were not run because implementation stopped at the SPEC allowlist blocker.
- The obsolete source-string test was not deleted.

## Required SPEC Amendment

Amend SPEC §4 to include the dynamic checkout route layer that owns the shared React #418 hydration source. The evidence above indicates the amended scope must cover more than the two confirm files and `TicketQrCarousel.tsx`; at minimum, the dynamic checkout route layouts and/or shared Expo Router checkout route shell need investigation and authorization before implementation continues.
