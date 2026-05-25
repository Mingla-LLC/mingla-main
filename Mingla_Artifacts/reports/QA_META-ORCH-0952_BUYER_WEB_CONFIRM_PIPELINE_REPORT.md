# QA_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE_REPORT

**ORCH:** META-ORCH-0952 — Buyer-web confirm pipeline deep forensics / multi-ticket QR carousel fix  
**Tester:** Codex tester-mingla parity mirror  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]`  
**Branch:** `meta-orch-0952-buyer-web-confirm-deep-forensics`  
**Approved review commit tested:** `f8502c7b`  
**Implementation bundle commit cited by implementor:** `b8d5300a`  
**Report date:** 2026-05-24 America/New_York

## Verdict

**FAIL.**

The controlled carousel fix passed the independent browser matrix, the required adversarial browser test, the adversarial fails-on-revert check, and the iOS simulator native regression. However, the required live BC-11 physical iPhone/Safari check failed before the QR carousel could be reached: after Stripe test checkout return, the live production URL remained stuck on `Confirming your reservation...` / `Payment received. Your tickets will appear here in a moment.` after manual reload and wait.

This is a buyer-facing confirmation finalization failure on the exact surface BC-11 was meant to validate. It blocks close even though the carousel component itself is behaving in controlled tests.

## Blocking Finding

| id | severity | surface | finding | evidence | required rework |
|---|---:|---|---|---|---|
| F-1 | P1 | Physical iPhone/Safari + live business web confirm | Live paid test checkout returns to the confirm page but never resolves from the holding state to the QR/ticket carousel. | Seth's physical Safari manual check on 2026-05-24 using `https://business.usemingla.com/checkout-trip/060d0483-50db-48d1-840b-73d9fc59356a/confirm?cs=cs_test_a1VFoXZScnf202mlGeXOqNrTO5Pz7doS5mQx79XYNcIAFrEjhX3PuqL9pv&csi=63200106-3401-4fe4-bb61-c1038be6e7c3&bst=f7d9f8ff9d074b2a8f018b15a4b03f7e8ca6733a8df942f7833045d9e2c8019e`; screenshot showed the holding copy; after reload + 30s, Seth replied `still stuck`. `curl -I` returned HTTP 200 from Vercel for that confirm URL, so this is not a simple missing-page/network failure. Code path: `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx:167-283` attempts sync confirm and realtime fallback, while `:374-393` renders the stuck holding state whenever `result === null` and `?cs=` is present. | Implementor must determine why this live `csi` + `bst` session does not produce `confirmResult.status === "paid" && order !== null` or a realtime order update. Retest must include the same physical Safari BC-11 path reaching visible ticket QR cards and dot updates. |
| F-2 | P2 | Android emulator native parity | Android business package was not initially installed. After approval, a fresh debug APK build completed and installed on `emulator-5554`, but Android could not resolve or launch `com.sethogieva.minglabusiness/.MainActivity`. | `./gradlew :app:assembleDebug` succeeded in 27m37s. `adb -s emulator-5554 install .../app-debug.apk` returned `Success`. `adb shell monkey -p com.sethogieva.minglabusiness ...` returned `No activities found to run`; `adb shell am start -n com.sethogieva.minglabusiness/.MainActivity` returned `Error type 3 ... MainActivity does not exist`; `cmd package query-activities ...` returned `No activities found`. `apkanalyzer manifest print` and `dumpsys package` both showed the manifest declares `.MainActivity`, so the emulator package/runtime state is inconsistent and the checkout path could not be exercised. | Android BC/SC parity remains unverified. Implementor or release owner must provide a launchable business Android build for `emulator-5554` and rerun the 3-ticket native confirmation path. |

## Severity Matrix

| severity | count | notes |
|---|---:|---|
| P0 | 0 | No data-loss/security/payment-integrity proof from tester actions. |
| P1 | 1 | Live physical Safari confirm finalization blocks the user from seeing tickets. |
| P2 | 1 | Android emulator parity blocked by launch/install runtime issue. |
| P3 | 0 | None. |
| P4 | 2 | Controlled browser/iOS carousel evidence is positive but not sufficient to close while F-1 stands. |

## Browser Matrix

Command run from `mingla-business`:

```bash
CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts
```

Result: **9 passed (2.9m)**.

| path | Chromium | WebKit | Firefox | result |
|---|---|---|---|---|
| HP-01 trip confirm, 3 tickets | PASS | PASS | PASS | Carousel renders, 3 PNG QR images, dots, hint. |
| HP-02 event confirm, 3 tickets | PASS | PASS | PASS | Carousel renders, 3 PNG QR images, dots, hint. |
| HP-03 trip confirm, 1 ticket | PASS | PASS | PASS | Single ticket renders without dots/hint. |

## Required Adversarial Test

Added tester-owned test:

`mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_adversarial.test.ts`

Contract covered:

- Trip confirm path.
- 3-ticket QR carousel.
- Narrow viewport at mount: `375x667`.
- Resize to wide viewport: `1440x900`.
- Resize back to narrow viewport.
- Assert carousel remains visible, width stays >= 200, 3 PNG QR images render, dot state is stable, swipe hint remains visible, and no React #418 page errors occur.

Fixed run:

```bash
CI=1 npm run test:browser -- meta_orch_0952_carousel_adversarial.test.ts
```

Result: **3 passed (18.9s)** on Chromium, WebKit, and Firefox.

Fails-on-revert run:

- Fixed branch/review commit under test: `f8502c7b`.
- Implementation bundle commit cited by implementor: `b8d5300a`.
- Revert simulation: stashed the implementation changes in `TicketQrCarousel.tsx`, `checkout-trip/[tripEventId]/confirm.tsx`, and `checkout/[eventId]/confirm.tsx` back to the pre-fix state in the same worktree.
- Stash evidence id: `e9744098d93a4ab2452c9ed870fe948f94886d29`.
- Result: **3 failed**. Chromium, WebKit, and Firefox all failed because `getByLabel("Ticket QR carousel", exact: true)` was not found within 10s.

This satisfies SPEC §7's adversarial viewport-resize-during-mount vector and proves the test catches the reverted regression.

## Native Regression

| surface | status | evidence |
|---|---|---|
| iOS Simulator iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` | PASS | Business app launched through the dev client against the branch Metro bundle and local mock checkout server. A 3-ticket free trip checkout reached the confirmation screen. Evidence screenshots: `/tmp/meta-orch-0952-ios-after-submit.png` showed `Ticket 1 of 3`; `/tmp/meta-orch-0952-ios-confirm-scrolled.png` showed `Ticket 3 of 3`, dot indicator, and `Swipe to see next ticket`. |
| Android emulator `emulator-5554` | BLOCKED/UNVERIFIED | Package was initially absent. After approved install path, debug APK rebuilt and installed, but the package had no resolvable launchable activity at runtime despite manifest declarations. No checkout confirmation parity could be executed. |

## Physical iPhone Safari BC-11

| surface | status | evidence |
|---|---|---|
| Physical iPhone Safari, live `business.usemingla.com` trip confirm | FAIL | Seth opened the provided live Stripe-return URL. Screenshot showed the holding state: `Confirming your reservation...` and `Payment received. Your tickets will appear here in a moment.` Tester instructed reload + 30s wait; Seth replied `still stuck`. The QR carousel never mounted, so BC-11 cannot pass. |

## Per-Surface Parity Table

| surface | status | notes |
|---|---|---|
| Chrome / Chromium | PASS | Automated HP + adversarial browser tests passed. |
| Safari / WebKit | PASS in controlled browser test; FAIL in live physical Safari | WebKit Playwright passed the QR carousel contract. Physical Safari live checkout failed earlier in the confirmation finalization pipeline. |
| Firefox | PASS | Automated HP + adversarial browser tests passed. |
| iOS simulator native | PASS | 3-ticket native confirmation carousel visible. |
| Android emulator native | BLOCKED/UNVERIFIED | Launchable business build unavailable on `emulator-5554` after install/rebuild attempt. |
| Physical iPhone Safari | FAIL | Live confirmation page stuck before QR carousel. |

## BC Mapping

| BC | status | evidence |
|---|---|---|
| BC-1 | PASS | Trip 3-ticket controlled browser path renders carousel across Chromium/WebKit/Firefox. |
| BC-2 | PASS | Event 3-ticket controlled browser path renders carousel across Chromium/WebKit/Firefox. |
| BC-3 | PASS | Single-ticket trip confirm keeps single-card behavior with no dots/hint. |
| BC-4 | PASS | Carousel uses server PNG data URIs in controlled tests. |
| BC-5 | PASS | Dot and swipe-hint contract asserted in browser and iOS sim evidence. |
| BC-6 | PASS | No React #418 observed in adversarial browser test. |
| BC-7 | PASS | Fails-on-revert evidence proves regression test sensitivity. |
| BC-8 | PASS | `web.output` is verified as `"single"` in implementation state; controlled browser paths load confirm routes directly. |
| BC-9 | PASS | No DB, Stripe code, QR schema, CartContext, or edge deploy changes made by tester. |
| BC-10 | PASS | iOS native 3-ticket confirmation carousel reached. |
| BC-11 | FAIL | Physical iPhone Safari live checkout stuck on confirmation holding state and never reached QR carousel. |
| BC-12 | BLOCKED/UNVERIFIED | Android emulator native path could not be launched after install/rebuild. |
| BC-13 | FAIL by dependency | Pre-merge/live parity cannot close while BC-11 fails and Android remains unverified. |

## SC Mapping

| SC | status | evidence |
|---|---|---|
| SC-1 | PASS | HP-01 trip 3-ticket browser matrix passed on Chromium/WebKit/Firefox. |
| SC-2 | PASS | HP-02 event 3-ticket browser matrix passed on Chromium/WebKit/Firefox. |
| SC-3 | PASS | HP-03 single-ticket browser matrix passed on Chromium/WebKit/Firefox. |
| SC-4 | PASS | Required adversarial test added and passed; fails-on-revert verified. |
| SC-5 | FAIL | Physical iPhone Safari live check stuck before ticket carousel. |
| SC-6 | PARTIAL | iOS simulator native PASS; Android emulator BLOCKED/UNVERIFIED. |
| SC-7 | PASS | Strict grep for `[META-ORCH-0952-DIAG]`, `MetaOrch0952DiagBoundary`, `ORCH-0930 v3`, and `useState initializer pattern` returned no matches. |
| SC-8 | PASS | No diagnostic markers reintroduced by tester. |
| SC-9 | PASS | Implementation report documents root cause and `web.output` change; code state matches. |
| SC-10 | DEFERRED/NOT APPLICABLE | Optional registration/forward-look item remains for orchestrator/close only after rework passes. |

## Hard Guards

Honored:

- No database writes.
- No Supabase migrations.
- No edge-function deploys.
- No Stripe code edits.
- No `CartContext.tsx` edits.
- No `buildQrPayload` edits.
- No consumer mobile or admin edits.
- No QR schema edits.
- No `[META-ORCH-0952-DIAG]` marker reintroduced.

Tester-added artifacts only:

- `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_adversarial.test.ts`
- `Mingla_Artifacts/qa/meta-orch-0952-native-mock-server.mjs`
- `Mingla_Artifacts/qa/meta-orch-0952-ios-*.yaml`
- This QA report.

## Commands / Evidence Summary

| command/check | result |
|---|---|
| `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts` | 9 passed. |
| `CI=1 npm run test:browser -- meta_orch_0952_carousel_adversarial.test.ts` | 3 passed. |
| Fails-on-revert rerun of adversarial test | 3 failed as expected; carousel locator absent. |
| iOS simulator manual/native flow | PASS; 3-ticket carousel visible. |
| Android `./gradlew :app:assembleDebug` | BUILD SUCCESSFUL in 27m37s. |
| Android install | `Success`. |
| Android launch | FAIL/BLOCKED: no resolvable launchable activity. |
| Production confirm URL `curl -I` | HTTP 200 from Vercel; page exists. |
| Physical iPhone Safari reload + 30s wait | FAIL: still stuck in holding state. |

## Routing

Route this QA result to **Codex implementor-mingla REWORK**, not orchestrator close.

Required rework scope:

1. Diagnose and fix why live trip confirm URL with `cs`, `csi`, and `bst` stays in `result === null` holding state after Stripe return.
2. Preserve the now-passing carousel browser contracts and the required adversarial test.
3. Provide or repair a launchable Android business build for `emulator-5554`, then rerun SC-6 Android native parity.
4. Retest physical iPhone Safari BC-11 end-to-end until the live page reaches visible QR cards, card labels, and dot updates.

---

## Retest after edge fn deploy

**Date/time:** 2026-05-24 23:25 EDT  
**Tester:** Codex tester-mingla parity mirror  
**Edge deploy under retest:** `ticket-checkout-confirm` version 57, `verify_jwt=false`, entrypoint `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]/supabase/functions/ticket-checkout-confirm/index.ts` per Supabase function list.  
**Verdict:** **FAIL.**

The edge-function rework appears to fix the prior finalization blocker: physical Safari no longer remains stuck on `Confirming your reservation...`; it reaches the order confirmation view. The binding BC-11 requirement still fails, however: the fresh 3-ticket physical Safari purchase shows the order header but the multi-ticket QR carousel area is collapsed to a thin vertical strip, with no visible QR cards, dots, or swipe hint. The 1-ticket regression guard renders a visible QR correctly.

### Blocking finding after deploy

| id | severity | surface | finding | evidence | required rework |
|---|---:|---|---|---|---|
| F-3 | P1 | Physical iPhone Safari, live `business.usemingla.com`, 3-ticket trip confirm | The hosted Checkout return now finalizes into the order view, but the 3-ticket QR carousel still does not render usable QR cards. This fails BC-11's physical iPhone Safari paid 3-ticket contract. | Operator live-fire screenshot `Mingla_Artifacts/qa/meta-orch-0952-retest-after-edge-deploy/physical-safari-3-ticket-collapsed-carousel-2026-05-24-232214.png` shows `You're in`, The DC Adventure, `3x Standard`, total `€375.00`, order `ce447c44-2fe1-4ecb-a864-fce7a4c84e42`, and a narrow vertical strip where the QR carousel should be. No QR images, dots, or swipe hint are visible. Operator corrected the run as 3 tickets + 1 ticket. | Implementor must fix the physical Safari multi-ticket rendering path after successful finalization. Retest must prove the 3-ticket order view shows 3 swipeable QR cards, dot indicators, and the swipe hint on physical iPhone Safari. |

### Time-to-mount / URL / session audit

| field | 3-ticket run | 1-ticket run |
|---|---|---|
| Order view mount | PASS: page reached `You're in`; exact stopwatch time not supplied by operator. | PASS: page reached `You're in`; exact stopwatch time not supplied by operator. |
| QR mount | FAIL: multi-ticket QR carousel did not mount visibly in the captured order view. | PASS: single QR visibly mounted. |
| 30-second reload window | Not fully measurable from provided evidence because no stopwatch/URL was supplied; screenshot is sufficient to fail BC-11 because the final order view is reached and the carousel itself is collapsed. | Not required for BC-11; used as regression guard. |
| Actual `/confirm?...` URL | Not supplied; Safari address bar is truncated in screenshots. | Not supplied; Safari address bar is truncated in screenshots. |
| `checkoutSessionId` / `csi` | Not supplied and not visible in screenshot. | Not supplied and not visible in screenshot. |
| Visible order id | `ce447c44-2fe1-4ecb-a864-fce7a4c84e42` | `5088b78c-8b3d-43de-8f99-4ff11074c630` |

### Screenshot evidence

| artifact | result |
|---|---|
| `Mingla_Artifacts/qa/meta-orch-0952-retest-after-edge-deploy/physical-safari-3-ticket-collapsed-carousel-2026-05-24-232214.png` | FAIL evidence: 3-ticket order finalized, carousel collapsed/no QR cards visible. |
| `Mingla_Artifacts/qa/meta-orch-0952-retest-after-edge-deploy/physical-safari-1-ticket-qr-visible-2026-05-24-232309.png` | PASS evidence: 1-ticket order finalized with a visible single QR card and no carousel affordances. |

### Retest gates run by tester before live-fire

| gate | command / evidence | result |
|---|---|---|
| Confirm edge function version | Supabase MCP `list_edge_functions` | PASS: `ticket-checkout-confirm` version 57 active, `verify_jwt=false`, entrypoint points at this worktree source. |
| Edge function type check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-confirm/index.ts` | PASS. |
| Edge fallback regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-confirm/__tests__/orch_0952_web_checkout_session_fallback.test.ts` | PASS, 4/4. |
| Browser happy path | `npm run test:browser -- meta_orch_0952_carousel_browser.test.ts` | PASS, 9/9. |
| Browser adversarial resize | `CI=1 npm run test:browser -- meta_orch_0952_carousel_adversarial.test.ts` | PASS, 3/3. Note: an initial non-`CI=1` rerun failed on Chromium/WebKit; the implementation-reported `CI=1` gate passed and is the recorded comparable gate. |
| DIAG/stale-comment grep | `rg -n "\\[META-ORCH-0952-DIAG\\]\|MetaOrch0952DiagBoundary\|ORCH-0930 v3\|useState initializer pattern" mingla-business app-mobile supabase/functions mingla-admin -S` | PASS: zero matches. |

### Per-surface retest table

| surface | tested this retest? | status | evidence / note |
|---|---:|---|---|
| Physical iPhone Safari, 3-ticket live trip checkout | YES | **FAIL** | Order finalizes, but carousel is collapsed and no QR cards/dots/hint are visible. This is the binding BC-11 gate. |
| Physical iPhone Safari, 1-ticket live trip checkout | YES | PASS | Single-ticket QR card renders visibly; screenshot shows no multi-ticket affordances. |
| Physical iPhone Safari, 2-ticket live trip checkout | NO | NOT TESTED | Operator corrected earlier note: live runs were 3 tickets and 1 ticket. |
| Chromium/WebKit/Firefox exported web bundle | YES | PASS | Browser happy path 9/9 and adversarial resize 3/3 in `CI=1`. |
| Edge function self-healing fallback | YES | PASS | Version 57 active; Deno check and 4/4 regression test pass. |
| Android business native parity | NO | DEFERRED | SC-6 Android parity remains blocked for this cycle by operator directive. Do not downgrade verdict on Android; create/follow a separate ORCH for the clean Android dev build/install runbook before retesting Android parity. |
| iOS simulator native | NO in this deploy retest | Prior PASS retained only as supplemental signal. Physical iPhone Safari is binding. |

### Updated BC / SC outcome

| contract | status after edge deploy | evidence |
|---|---|---|
| BC-11 / SC-5 physical iPhone Safari paid 3-ticket trip-confirm | **FAIL** | Fresh 3-ticket purchase reaches the order view but does not render 3 swipeable QR cards, dots, or hint. |
| BC-9 / SC-3 single-ticket regression guard | PASS | Fresh 1-ticket purchase renders a visible single QR card. |
| Prior finalization blocker | RESOLVED for this retest | The live page no longer stays on `Confirming your reservation...`; it reaches `You're in`. |
| SC-6 Android parity | DEFERRED / separate ORCH | Explicitly not attempted per hard guard; Android dev build path needs a clean install runbook. |
| SC-7 DIAG cleanup | PASS | Strict grep clean. |

### Routing after retest

Route this QA result to **Codex implementor-mingla REWORK**, not orchestrator close.

Required rework scope:

1. Treat the edge-function finalization rework as successful unless new evidence contradicts it.
2. Focus on the physical Safari multi-ticket rendered order view: it receives/finalizes a 3-ticket order but collapses the QR carousel into a vertical strip.
3. Preserve the 1-ticket QR rendering path, which passed live.
4. Preserve all green automated gates: edge fallback regression, browser happy-path matrix, browser adversarial resize, and SC-7 DIAG cleanliness.
5. Do not attempt Android in this cycle; keep Android parity deferred to a separate ORCH with a clean native build/install runbook.
