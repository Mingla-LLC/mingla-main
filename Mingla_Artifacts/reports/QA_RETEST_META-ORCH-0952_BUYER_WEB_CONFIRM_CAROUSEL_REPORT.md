# QA_RETEST_META-ORCH-0952_BUYER_WEB_CONFIRM_CAROUSEL_REPORT

**ORCH:** META-ORCH-0952 - Buyer-web confirm pipeline deep forensics / physical Safari carousel rework  
**Mode:** RETEST  
**Tester:** Codex tester-mingla parity mirror  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]`  
**Branch:** `meta-orch-0952-buyer-web-confirm-deep-forensics`  
**Report date:** 2026-05-25 America/New_York  

## Verdict

**BLOCKED/UNVERIFIED.**

The local branch-level regression gates for the carousel rework are green: the browser matrix passed 9/9, the adversarial narrow-wide-narrow resize guard passed 3/3, the edge fallback regression passed 4/4, the ORCH-0951 host-width guard passed 4/4, and SC-7 DIAG grep stayed clean.

The binding BC-11 gate cannot be passed from this Codex session because the required fresh physical iPhone Safari live checkout retest was not available to the tester: no controllable physical iPhone Safari session, no fresh 3-ticket live checkout URL, and no fresh 1-ticket regression screenshot/URL were supplied after the carousel rework. Because the user explicitly required a physical Safari 3-ticket live checkout retest plus a 1-ticket physical regression guard, this report cannot route to close as PASS.

## Comms Ledger

| entry | status for this retest |
| --- | --- |
| COMMS-0002 | Read and factored. The warning about the ORCH-0863 strict-grep GitHub gate is already acknowledged for META-ORCH-0952 in the ledger and remains a CI/merge caveat, not a local carousel regression result. |

## Blocking Gate

| id | severity | surface | finding | evidence | required next action |
| --- | ---: | --- | --- | --- | --- |
| G-1 | BLOCKED | Physical iPhone Safari, live `business.usemingla.com` checkout return | The required fresh BC-11 physical Safari 3-ticket live checkout and 1-ticket physical regression guard were not executed in this Codex session, so the live buyer-device contract remains unverified. | Codex has no physical iPhone Safari control in this environment. Existing physical evidence in `Mingla_Artifacts/qa/meta-orch-0952-retest-after-edge-deploy/` is the prior FAIL before this carousel rework, not fresh PASS evidence after it. | Seth must run a fresh physical iPhone Safari 3-ticket paid trip checkout and a fresh/opened 1-ticket paid trip checkout after the carousel rework is live on the tested URL. If 3-ticket shows full QR cards, dots, and swipe behavior, route to orchestrator close review; if it collapses/sticks/misses QR, route to implementor rework. |

## Non-Blocking Observations

| id | severity | surface | observation | evidence | impact |
| --- | ---: | --- | --- | --- | --- |
| O-1 | P4 | Browser regression gate | One full browser matrix attempt had a transient Firefox HP-02 failure where the accessibility snapshot still showed three labeled QR code nodes, but the strict `img[src^='data:image/png;base64,']` locator saw zero nodes. The isolated Firefox HP-02 rerun passed, and the final full matrix rerun passed 9/9. | Failed attempt: `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts`, Firefox HP-02 received 0 PNG `img` nodes. Failure context: `mingla-business/test-results/meta_orch_0952_carousel_br-1c109-cards-on-first-browser-pass-firefox/error-context.md`. Isolated rerun: `--project=firefox -g "HP-02"` passed 1/1. Final full rerun passed 9/9. | Does not block this report because the required comparable final gate passed, but it is worth watching in CI. |

## Implementation Claims Checked

| claim | status | evidence |
| --- | --- | --- |
| Multi-ticket carousel uses measured numeric page widths after layout instead of percentage/flex pages. | VERIFIED BY CODE | `mingla-business/src/components/checkout/TicketQrCarousel.tsx:60-66`, `:103-109`, `:146-174` use `pageWidth`, `onLayout`, `ScrollView` ref sync, and `{ width: pageWidth }` per page. |
| The single-ticket path remains outside the carousel and has no dots/hint. | VERIFIED BY CODE AND TEST | `TicketQrCarousel.tsx:124-143`; browser HP-03 passed across Chromium/WebKit/Firefox in the final 9/9 run. |
| Browser tests now assert geometry, not just image count. | VERIFIED BY CODE AND TEST | `meta_orch_0952_carousel_browser.test.ts:30-57` and `meta_orch_0952_carousel_adversarial.test.ts:35-58` assert carousel width, first QR size/centering, and off-screen later pages. Final runs passed. |
| Edge finalization fallback regression remains green. | VERIFIED BY TEST | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-confirm/__tests__/orch_0952_web_checkout_session_fallback.test.ts` passed 4/4. |
| SC-7 DIAG cleanup remains clean. | VERIFIED BY GREP | `rg -n "\[META-ORCH-0952-DIAG\]|MetaOrch0952DiagBoundary|ORCH-0930 v3|useState initializer pattern" mingla-business app-mobile supabase/functions mingla-admin -S` returned zero matches (exit 1, no output). |
| Physical Safari BC-11 is fixed after the carousel rework. | UNVERIFIED | No fresh physical iPhone Safari live checkout evidence was available after this rework. |

## Commands And Results

| gate | command | result |
| --- | --- | --- |
| Edge function type check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-confirm/index.ts` | PASS, no output. |
| Edge fallback regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-confirm/__tests__/orch_0952_web_checkout_session_fallback.test.ts` | PASS, 4/4. |
| ORCH-0951 host-width guard | `npx jest src/components/checkout/__tests__/orch_0951_carousel_host_width.test.tsx --runInBand` from `mingla-business` | PASS, 4/4. |
| Browser adversarial resize | `CI=1 npm run test:browser -- meta_orch_0952_carousel_adversarial.test.ts` from `mingla-business` | PASS, 3/3 across Chromium/WebKit/Firefox. |
| Browser matrix - first concurrent attempt | `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts` while adversarial suite was also starting | INFRA FAIL, Playwright webServer `EADDRINUSE` on `127.0.0.1:43095`; rerun required. |
| Browser matrix - sequential rerun | `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts` | FAIL, 8/9; transient Firefox HP-02 saw 0 PNG `img` nodes while page snapshot still showed labeled QR nodes. |
| Firefox HP-02 isolated rerun | `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts --project=firefox -g "HP-02"` | PASS, 1/1. |
| Browser matrix - final comparable rerun | `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts` | PASS, 9/9 across Chromium/WebKit/Firefox in 36.1s. |
| SC-7 DIAG/stale marker grep | `rg -n "\[META-ORCH-0952-DIAG\]|MetaOrch0952DiagBoundary|ORCH-0930 v3|useState initializer pattern" mingla-business app-mobile supabase/functions mingla-admin -S` | PASS, zero matches. |

## Physical iPhone Safari BC-11

| check | status | evidence |
| --- | --- | --- |
| Fresh 3-ticket paid trip checkout on physical iPhone Safari reaches order view with full-size QR card, `Ticket 1 of 3`, dots, and swipe hint. | BLOCKED/UNVERIFIED | Not executable from this Codex session without physical iPhone Safari control or fresh operator evidence. Prior screenshot `physical-safari-3-ticket-collapsed-carousel-2026-05-24-232214.png` is pre-this-carousel-rework FAIL evidence and cannot be reused as current proof. |
| Physical iPhone Safari horizontal swipe advances to tickets 2 and 3 with full-size QR cards and dot updates. | BLOCKED/UNVERIFIED | No fresh physical device evidence supplied. |
| Fresh/opened 1-ticket paid checkout on physical iPhone Safari shows one visible QR card and no dots/swipe hint. | BLOCKED/UNVERIFIED | Prior screenshot `physical-safari-1-ticket-qr-visible-2026-05-24-232309.png` predates this carousel rework. It remains useful historical evidence only. |

## Per-Surface Retest Table

| surface | tested this retest? | status | evidence / note |
| --- | ---: | --- | --- |
| Physical iPhone Safari, 3-ticket live trip checkout | NO | BLOCKED/UNVERIFIED | Required binding BC-11 evidence unavailable. |
| Physical iPhone Safari, 1-ticket live trip checkout | NO | BLOCKED/UNVERIFIED | Required physical regression guard evidence unavailable. |
| Chromium exported web bundle | YES | PASS | Final browser matrix 9/9 and adversarial resize 3/3. |
| WebKit exported web bundle | YES | PASS | Final browser matrix 9/9 and adversarial resize 3/3. |
| Firefox exported web bundle | YES | PASS WITH P4 NOTE | Final browser matrix 9/9 and adversarial resize 3/3 after one transient HP-02 failure and isolated pass. |
| Edge function fallback | YES | PASS | Deno check passed; fallback regression 4/4. |
| Android native | NO | DEFERRED BY DIRECTIVE | No Android retest this cycle. |
| iOS simulator native | NO | PRIOR PASS ONLY | Prior simulator pass was not rerun; the requested binding surface is physical iPhone Safari. |

## BC / SC Outcome

| contract | status | evidence |
| --- | --- | --- |
| BC-11 / SC-5 physical iPhone Safari paid 3-ticket trip-confirm | BLOCKED/UNVERIFIED | Fresh physical Safari evidence unavailable. |
| 1-ticket physical Safari regression guard | BLOCKED/UNVERIFIED | Fresh physical Safari evidence unavailable. |
| Browser trip 3-ticket carousel | PASS | Final matrix HP-01 passed across Chromium/WebKit/Firefox. |
| Browser event 3-ticket carousel | PASS | Final matrix HP-02 passed across Chromium/WebKit/Firefox after isolated Firefox retry and full final rerun. |
| Browser trip 1-ticket single QR guard | PASS | Final matrix HP-03 passed across Chromium/WebKit/Firefox. |
| Adversarial resize/mount guard | PASS | 3/3 across Chromium/WebKit/Firefox. |
| Edge fallback regression | PASS | 4/4 Deno tests. |
| SC-7 DIAG cleanup | PASS | Strict grep clean. |
| Android parity | DEFERRED / NOT RETESTED | Explicit hard guard: no Android retest this cycle. |

## Hard Guards

Honored by tester in this retest:

- No Android retest.
- No database writes.
- No Supabase migrations.
- No Stripe mutations.
- No `CartContext.tsx` edits.
- No `buildQrPayload` edits.
- No consumer mobile edits.
- No admin edits.
- No QR schema edits.
- No diagnostic marker reintroduced; SC-7 grep stayed clean.

This tester action only added this QA report. Product/runtime code was not patched by tester.

## Routing

Do not route this result to orchestrator close as PASS yet.

Current next owner is Seth/operator for the missing physical-device gate. Run a fresh physical iPhone Safari 3-ticket paid checkout and a 1-ticket regression guard against the live URL that contains this carousel rework. If both pass, route this report plus the fresh physical evidence to Codex orchestrator-mingla for close review; if either fails, route to Codex implementor-mingla with the failing screenshot, order id, confirm URL, and whether the failure is stuck confirmation, collapsed carousel, missing dots/hint, or swipe/dot mismatch.
