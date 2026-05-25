# INVESTIGATION — META-ORCH-0952 Buyer-Web Confirm Pipeline

**Mode:** INVESTIGATE only  
**Date:** 2026-05-24  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]`  
**Branch:** `meta-orch-0952-buyer-web-confirm-deep-forensics`  
**In scope:** buyer-anonymous web confirm pages: `/checkout-trip/{tripEventId}/confirm` and `/checkout/{eventId}/confirm`  
**Out of scope:** consumer iOS/Android, business iOS/Android native, admin web, edge deploys, DB migrations, Stripe live/test charges beyond mocked Playwright confirmation

## Executive Summary

The post-ORCH-0951 v2 production web bundle is still broken for multi-ticket buyer-web confirmations. React #418 still fires in Chromium, WebKit, and Firefox against the current production asset, so v2 did not eliminate the runtime hydration/recovery fault. Independently, the carousel has a durable layout deadlock: multi-ticket `TicketQrCarousel` first renders an empty measuring host while `pageWidth === 0`; inside the center-aligned `GlassCard` chain that empty host computes to `width: 0px`, so the measured width never becomes positive and the QR `<Image>` subtree never mounts.

Schema/data/edge are not the failing layer. Live multi-ticket orders have N distinct non-empty `tickets.qr_code` rows, `ticket-checkout-confirm` and `ticket-checkout-status` are active and return `qrImageDataUrl`, and the production bundle contains `<Image>`-based QR rendering rather than `react-native-qrcode-svg`. Trip and event confirm routes share the same failure signature. The next SPEC should cover the web confirm render architecture and regression matrix, not QR generation, DB shape, or Stripe finalization.

## Phase 0 Ingest Log

| Artifact | Status | What the next phase needs |
|---|---:|---|
| `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md` | Read | Locked hard guards: investigate only, no product edits, no deploy/DB push, six-field evidence, Q1-Q6 scorecard. |
| `Mingla_Artifacts/reports/SAGA_BUYER_WEB_CONFIRM_CAROUSEL.md` | Read end-to-end | Five failed attempts are sealed. Do not re-litigate SVG generation or earlier mount-guard hypotheses. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0928_BUYER_WEB_QR_CAROUSEL_RENDERS_AS_STRIP.md` | Read | Useful old symptom trace, but partly stale after QR PNG and v2/v3 churn. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0930_*.md`, `INVESTIGATION_ORCH-0932_*.md`, `INVESTIGATION_ORCH-0951_*.md` | Missing | `find Mingla_Artifacts ... 0930/0932/0951` found no matching investigation reports. Saga is the only local sealed history for those attempts. |
| `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` | Read | Trip confirm uses `useState(false)+useEffect`, sync confirm, `qrImageDataUrl` threading, and `GlassCard` with `qrCard.alignItems:"center"`. Comments still describe old v3 in the mount block. |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | Read | Event confirm mirrors trip confirm, including v2 gate and stale v3 comment in the QR card block. |
| `mingla-business/src/components/checkout/TicketQrCarousel.tsx` | Read | Multi-ticket path gates on `pageWidth === 0` and returns a bare `styles.host` measuring view before rendering images/dots. |
| `mingla-business/src/components/checkout/CartContext.tsx` | Read | `OrderResult.tickets` carries optional `qrImageDataUrl`. |
| `supabase/functions/ticket-checkout-confirm/index.ts` | Read | Active confirm edge path maps tickets to `qrImageDataUrl` via `_shared/ticketQrImage.ts`. |
| `supabase/functions/ticket-checkout-status/index.ts` | Read | Status edge function also returns `qrImageDataUrl`; not the failing layer. |
| `supabase/functions/_shared/ticketQrImage.ts` | Read | Server-side QR PNG path uses `qrcode@1.5.4`; empty payloads return empty string. |
| `mingla-business/src/components/checkout/__tests__/orch_0930_qr_carousel_mounted_guard.test.tsx` | Read | Test coverage is source-string only. It cannot catch zero-width runtime layout, missing images, or React #418. |
| `/tmp/orch-0928-forensic/probe-orch-0951-v2.js` | Read/reused | Existing harness already showed post-v2 strip. Extended into `/tmp/orch-0928-forensic/probe-meta-orch-0952.js`. |
| README Constitution | Read | Relevant rules: no dead taps, no silent failures, no fabricated data. |
| ORCH-0852 SPEC | Read | Contract says buyer-web confirm should synchronously finalize and render full order + QR, with realtime as safety net. |

## Q1-Q6 Verdicts

### Q1 — Does the post-v2 production bundle still throw React #418?

**Verdict:** `#418 fires: YES`.

Production HTTP did not expose a commit hash. The tested production HTML was `https://business.usemingla.com/checkout-trip/060d0483-50db-48d1-840b-73d9fc59356a/confirm?...`, served by Vercel with `etag: "77ff1f037cb7bdb302f1e36af3a5a1ed"`, `last-modified: Sun, 24 May 2026 19:39:28 GMT`, and JS asset `/_expo/static/js/web/entry-cdbb3c81556f9fbe47dd576de08b2362.js`. Git history points to latest relevant deploy candidate `f560476d Close ORCH-0951 v2 ... (#191)`, but the Vercel response did not provide that SHA.

Production bundle probes found `qrImageDataUrl`, `Swipe to see next ticket`, `Ticket QR carousel`, and `width:"100%"`; they did not find `react-native-qrcode-svg`.

Playwright matrix with mocked 3-ticket paid confirm response:

| Browser | Flow | #418 | Carousel found | Bare host | Width | Height | Images | SVGs |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Chromium | trip | YES | false | true | 0 | 320 | 0 | 1 |
| Chromium | event | YES | false | true | 0 | 320 | 0 | 3 |
| WebKit | trip | YES | false | true | 0 | 320 | 0 | 1 |
| WebKit | event | YES | false | true | 0 | 320 | 0 | 3 |
| Firefox | trip | YES | false | true | 0 | 320 | 0 | 1 |
| Firefox | event | YES | false | true | 0 | 320 | 0 | 3 |

Representative page error:

```text
Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
```

### Q2 — Which root causes are confirmed or ruled out?

| Candidate | Verdict | Evidence |
|---|---|---|
| (a) `pageWidth` / `onLayout` chicken-and-egg | **CONFIRMED ROOT CAUSE** | The only multi-ticket code path that renders an empty `styles.host` is `pageWidth === 0` at `TicketQrCarousel.tsx:140-145`. Runtime keeps that bare host for 7s with `width:0`, `height:320`, `childCount:0`, `carouselFound:false`, and `imageCount:0`. |
| (b) `GlassCard` parent 0-width edge on RNW | **SECONDARY ROOT CAUSE / CONFIRMED CONTRIBUTOR** | Ancestors above the bare host compute to 32px padding-only wrappers, then a full-width parent with `alignItems:center`. The child host's `width:"100%"` resolves to `0px` in that shrink-wrap chain. |
| (c) Expo Router Suspense boundary abort | **RULED OUT AS PROVEN ROOT** | The page renders hero, order summary, CTA, and confirm response data; probe did not find a Suspense fiber in the captured target chain. React #418 exists, but no Suspense-specific abort was observed. |
| (d) residual `react-native-svg-web` / SVG QR mismatch | **RULED OUT FOR CURRENT BUNDLE** | Production bundle lacks `react-native-qrcode-svg`; carousel code imports `Image`; DOM SVGs are page icons/CTA icons, not QR carousel SVGs; `imageCount` is 0 because the image subtree never mounts. |
| (e) something else | **CONFIRMED: hydration/recovery fault remains; other listed causes not evidenced** | React #418 fires in all three browser engines post-v2. No probe evidence supports Stripe query-state race, CSS load order, font reflow, or ScrollView paging as the first failing layer. |

### Q3 — Browser matrix

**Verdict:** broken everywhere tested, not Safari/WebKit-only.

Chromium, WebKit, and Firefox all reproduce the same runtime signature with the same production URL shape and mocked 3-ticket order. WebKit initially was unavailable, then installed via `npx playwright install webkit firefox` and rerun successfully.

### Q4 — Event-flow parity

**Verdict:** same root cause.

The first event probe used a trip event ID and was invalid. The corrected event probe used real scheduled event `e8b2a8c6-32ba-42a1-bf6d-a062803a909c` and reproduced the same strip: React #418, no carousel, zero-width bare host, zero QR images. Trip route and event route differ in public event/trip data fetches and CTA content, not in the failing carousel chain.

| Dimension | Trip confirm | Event confirm | Parity |
|---|---|---|---|
| Sync confirm mocked response | 200 | 200 | Same |
| Page reaches order view | Yes | Yes | Same |
| React #418 | Yes | Yes | Same |
| `Ticket QR carousel` aria node | Missing | Missing | Same |
| Bare host width/height | `0 x 320` | `0 x 320` | Same |
| QR images | 0 | 0 | Same |

### Q5 — Five-Truth-Layer Reconciliation

| Layer | Truth | Verdict |
|---|---|---|
| Docs | Saga says DB and edge are correct, bundle contains v2 + `<Image>`, but multi-ticket web still strips. | Matches current investigation. |
| Schema | `tickets.qr_code` is non-empty and distinct per ticket on live multi-ticket orders; realtime publication includes `orders`, `ticket_checkout_sessions`, and `tickets`. | Not root. |
| Code | Confirm pages thread `qrImageDataUrl`; carousel uses server PNG `<Image>`; multi-ticket path still returns a bare measurement host while `pageWidth === 0`. | Code contains the failing design. |
| Runtime | Browser reaches order view after confirm 200, but React #418 fires and DOM contains only a zero-width 320px-tall host where carousel should be. | Root reproduced. |
| Data | Real orders `d99081c3...` and `86443229...` have 3 and 4 valid distinct QR rows respectively. | Data contradicts "missing QR data" theories. |

Live data sample:

```text
order d99081c3-c77d-462e-a0ff-1e0345222af5: ticket_count=3, all_qr_present=true, distinct_qr_count=3, qr_len=122 each
order 86443229-557a-4d57-9ce2-a5f36ef0fa2e: ticket_count=4, all_qr_present=true, distinct_qr_count=4, qr_len=122 each
```

### Q6 — Why did the prior attempts all fail?

**Verdict:** the saga kept fixing one truth layer at a time without a browser-level invariant for the whole confirm pipeline.

ORCH-0930 tried hydration gates around a QR SVG subtree. ORCH-0932 correctly removed the SVG dependency and fixed single-ticket display, but did not test the multi-ticket measurement path. ORCH-0951 v1 noticed the empty-host width loop, but `width:"100%"` was treated as sufficient without asserting the computed browser box became positive under the real `GlassCard` ancestor chain. ORCH-0951 v2 restored a safer hydration gate, but did not revalidate the production page across browser engines with DOM ancestry, pageerror capture, and image-count assertions.

The missing invariant is not "source contains the expected strings." It is: after a production-like confirm response with N tickets, the browser must have no React #418, a mounted carousel, a positive carousel box, N visible QR images/placeholders, dots/swipe UI for N>1, and parity across trip/event routes.

## Findings Table

| ID | Symptom | Layer | Probe | Evidence | Mechanism | Severity |
|---|---|---|---|---|---|---|
| F1 | Production confirm still logs React #418 after ORCH-0951 v2. | Runtime | `node /tmp/orch-0928-forensic/probe-meta-orch-0952.js` against production URL with mocked 3-ticket confirm. | All six browser/flow rows have `pageErrors` containing `Minified React error #418`. | v2 did not remove the runtime hydration/recovery fault. Any SPEC that only changes QR data or SVG generation will miss a still-active page-level failure. | CONFIRMED ROOT CAUSE LAYER |
| F2 | Multi-ticket QR region is a 320px-tall empty strip with no images/dots/swipe hint. | Code + Runtime | Same Playwright probe; code read `TicketQrCarousel.tsx:140-145`. | Runtime `targetBox`: `width:0`, `height:320`, `widthCSS:"0px"`, `minHeight:"320px"`, `childCount:0`; code path returns bare host only when `pageWidth === 0`. | The component waits for a positive measured width before mounting the carousel subtree, but the first rendered measuring node is empty and never establishes a positive width in the real web layout. | CONFIRMED ROOT CAUSE |
| F3 | `width:"100%"` does not rescue the host. | Runtime + Code | Playwright ancestor walk; code read `TicketQrCarousel.tsx:213-230` and confirm `qrCard` styles. | Host `widthCSS:"0px"` despite source `width:"100%"`; ancestor depths 1-3 are `width:32`; depth 4 is `width:1232` with `alignItems:"center"`. | RNW resolves percentage width against a shrink-wrapped/padding-only parent chain created by the empty child and center-aligned card, so the host never gets usable page width. | SECONDARY ROOT CAUSE |
| F4 | Server QR data exists but browser shows zero QR images. | Data + Edge + Runtime | Supabase SELECT on two real orders; edge code read; Playwright DOM image count. | Data: 3-ticket and 4-ticket orders have all QR present and distinct; edge functions map `qrImageDataUrl`; DOM `imageCount:0`. | The failure occurs after data delivery. Images are absent because the multi-ticket image subtree is never mounted, not because QR payloads are missing. | RULED OUT DATA/EDGE AS ROOT |
| F5 | Residual SVG hypothesis no longer explains current failure. | Code + Runtime | Production bundle substring probe; DOM SVG census. | Bundle contains `qrImageDataUrl` and no `react-native-qrcode-svg`; DOM SVG count is 1 or 3 but none are inside a carousel; no carousel aria node exists. | SVGs present are icons. The QR renderer is `<Image>`, and it is never reached in the multi-ticket render path. | RULED OUT |
| F6 | Suspense-boundary abort was not observed as the root. | Runtime | Probe inspected target React/fiber chain where available and page render state. | Page renders full order text and CTA; `suspendedFibers: []` in captured chain; confirm/data fetches 200. | There is a React recovery error, but no evidence that an Expo Router Suspense boundary specifically owns the missing carousel. | RULED OUT AS PROVEN ROOT |
| F7 | Existing regression tests gave false confidence. | Test | Read `orch_0930_qr_carousel_mounted_guard.test.tsx`. | Tests assert source strings: imports, no QRCode, `qrImageDataUrl`, and v2 gate. They never launch a browser or assert computed width/image count/pageerror. | The failure is a production browser layout/hydration invariant, so source-string tests can all pass while users still see a strip. | SUSPECTED PROCESS CONTRIBUTOR |

## Five-Truth-Layer Contradictions

1. **Docs vs runtime:** Saga expected ORCH-0951 v2 might eliminate #418; runtime shows #418 still fires in Chromium, WebKit, and Firefox.
2. **Code comments vs code:** Both confirm files still contain mount-block comments describing ORCH-0930 v3 behavior, while the actual code is ORCH-0951 v2 `useState(false)+useEffect`.
3. **Code intent vs browser CSS:** `styles.host.width = "100%"` claims to break the pageWidth deadlock, but computed CSS is `width:0px` in the production ancestor chain.
4. **Data/edge vs runtime:** Live DB has N distinct QR payloads and edge functions expose `qrImageDataUrl`; browser DOM has zero QR images because the subtree never mounts.
5. **Test suite vs user-visible result:** Source-string tests pass the intended implementation contract, but no regression test asserts the production browser carousel exists and has positive dimensions.
6. **Parity assumption vs prior probe:** The event route initially appeared different only because the probe used a trip event ID. With a valid event ID, event and trip fail identically.

## Pattern Analysis

The prior attempts were locally rational but not pipeline-complete. Each one attacked a plausible layer:

- ORCH-0930 v1/v2/v3 attacked hydration gates.
- ORCH-0932 attacked QR generation and correctly removed the SVG dependency.
- ORCH-0951 v1 attacked host width.
- ORCH-0951 v2 attacked the v3 client-first-render mismatch.

What none of them enforced was the complete web buyer confirm contract under production-like conditions. The actual failure spans a runtime React recovery signal plus an RNW layout deadlock under the confirm page's card hierarchy. A point fix can satisfy its local source assertion while the browser still has no mounted carousel.

The durable test shape must be browser-observed, not source-observed: load the exported/production web confirm route, mock a paid order with 1 and 3 tickets, assert no pageerror #418, assert the carousel/QR images are present for N tickets, assert computed boxes are positive, and run it for trip and event routes across the browser matrix.

## Recommended SPEC Scope

The binding SPEC should cover:

- Buyer-web confirm carousel architecture for multi-ticket orders where first render does not depend on an empty zero-width measuring host.
- Elimination or containment of React #418 on production-like confirm pages with mocked paid 3-ticket responses.
- Trip/event confirm parity as a first-class success criterion.
- Browser matrix: Chromium, WebKit/Safari, Firefox; desktop and mobile-width viewports.
- Regression test requirement in the same commit: browser-running production-like Expo web route with mocked confirm/status responses for 1-ticket and 3-ticket orders.
- Assertions: no pageerror #418, carousel exists for N>1, image/placeholder count equals ticket count, host/page boxes have positive width, dots/swipe affordance visible for N>1, single-ticket visual path still renders one QR without carousel affordance.
- Documentation cleanup for stale v3 comments in both confirm files so future responders do not chase the wrong hydration history.
- Manual tester gate for physical iPhone Safari after implementation, because operator-reported Safari was the original visual signal.

The binding SPEC should not touch:

- `tickets.qr_code` schema or QR token generation.
- Server-side QR PNG generation in `_shared/ticketQrImage.ts`.
- `ticket-checkout-confirm` / `ticket-checkout-status` QR response shape, except if SPEC needs a test fixture.
- Stripe checkout, live charges, finalization RPC behavior, or webhook/reconcile deployment.
- Consumer mobile, business native checkout, or admin surfaces unless a later SPEC explicitly expands scope.

## Artifact Appendix

| Artifact | Path / command |
|---|---|
| Extended Playwright probe | `/tmp/orch-0928-forensic/probe-meta-orch-0952.js` |
| Matrix summary | `/tmp/orch-0928-forensic/meta-orch-0952/summary.json` |
| Chromium trip JSON / screenshot | `/tmp/orch-0928-forensic/meta-orch-0952/trip-chromium.json`, `/tmp/orch-0928-forensic/meta-orch-0952/trip-chromium-confirm.png` |
| Chromium event JSON / screenshot | `/tmp/orch-0928-forensic/meta-orch-0952/event-chromium.json`, `/tmp/orch-0928-forensic/meta-orch-0952/event-chromium-confirm.png` |
| WebKit trip/event screenshots | `/tmp/orch-0928-forensic/meta-orch-0952/trip-webkit-confirm.png`, `/tmp/orch-0928-forensic/meta-orch-0952/event-webkit-confirm.png` |
| Firefox trip/event screenshots | `/tmp/orch-0928-forensic/meta-orch-0952/trip-firefox-confirm.png`, `/tmp/orch-0928-forensic/meta-orch-0952/event-firefox-confirm.png` |
| Production HTML headers | `curl -sSI 'https://business.usemingla.com/checkout-trip/060d0483-50db-48d1-840b-73d9fc59356a/confirm?cs=cs_test_fake&csi=fake&bst=fake'` |
| Production bundle inspected | `/tmp/orch-0928-forensic/prod-entry-cdbb3c81556f9fbe47dd576de08b2362.js` |
| Live data SQL | Supabase MCP SELECT over orders `d99081c3-c77d-462e-a0ff-1e0345222af5`, `86443229-557a-4d57-9ce2-a5f36ef0fa2e` |
| Realtime publication SQL | Supabase MCP `pg_publication_tables` SELECT for `orders`, `ticket_checkout_sessions`, `tickets` |
| Edge function inventory | Supabase MCP `list_edge_functions`: `ticket-checkout-confirm` ACTIVE v45 `verify_jwt:false`; `ticket-checkout-status` ACTIVE v106 `verify_jwt:false` |
