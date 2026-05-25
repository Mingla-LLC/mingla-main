# META-ORCH-0952 Buyer-Web Confirm Pipeline Rework

Status: REWORK IMPLEMENTED; PHYSICAL SAFARI CAROUSEL RETEST REQUIRED
Updated: 2026-05-25
Branch: meta-orch-0952-buyer-web-confirm-deep-forensics
Worktree: /Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]

## Outcome

The physical Safari BC-11 failure was traced to a server-side confirm gap: a hosted Stripe Checkout return could reach `ticket-checkout-confirm` while `ticket_checkout_sessions.stripe_payment_intent_id` was still null. In that state the live session had `status = awaiting_web_redirect`, no `order_id`, no `stripe_payment_intent_id`, but did have `stripe_checkout_session_id` and `stripe_account_id`; the confirm endpoint returned 200 without finalizing, so the buyer web page stayed on "Confirming your reservation..." indefinitely.

The rework adds a narrow self-healing path inside `ticket-checkout-confirm`: when the stored PaymentIntent id is missing, the function retrieves the stored Stripe Checkout Session on the connected account, expands `payment_intent`, persists the recovered PI id, and then continues through the existing `biz_ticket_checkout_finalize` RPC path. No database migrations, QR schema changes, consumer mobile changes, admin changes, CartContext changes, `buildQrPayload` changes, edge deploys, or live Stripe mutation/deploy actions were performed.

Important scope note: this necessarily touches the Stripe read path inside `ticket-checkout-confirm` because the blocking production state could not be fixed from the browser carousel layer. The added Stripe call is read-only Checkout Session retrieval plus the existing read-only PaymentIntent/finalize flow; no Stripe create/update/refund/capture logic was changed.

## Files Changed By This Rework

- `supabase/functions/ticket-checkout-confirm/index.ts`
  - Selects `stripe_checkout_session_id`.
  - Retrieves the hosted Checkout Session with `expand: ["payment_intent"]` when the PaymentIntent id is missing.
  - Returns `expired` for expired Checkout Sessions.
  - Returns `pending` only when the Checkout Session is not paid/complete.
  - Persists the recovered `stripe_payment_intent_id` back to `ticket_checkout_sessions` with a null-only guard.
  - Reuses the expanded PaymentIntent where available, then continues through the existing finalize RPC.
  - Supports both `charges.data[0].id` and modern `latest_charge` shapes for charge id extraction.

- `supabase/functions/ticket-checkout-confirm/__tests__/orch_0952_web_checkout_session_fallback.test.ts`
  - Adds source-level regression coverage for the exact stuck state.
  - Guards selection of `stripe_checkout_session_id`, Checkout Session retrieval with expanded `payment_intent`, recovered PI persistence, and reuse of the existing finalize RPC path.

## Live Failure Evidence Used

QA reported BC-11 physical iPhone Safari still stuck at:

`https://business.usemingla.com/checkout-trip/060d0483-50db-48d1-840b-73d9fc59356a/confirm?cs=cs_test_a1VFoXZScnf202mlGeXOqNrTO5Pz7doS5mQx79XYNcIAFrEjhX3PuqL9pv&csi=63200106-3401-4fe4-bb61-c1038be6e7c3&bst=f7d9f8ff9d074b2a8f018b15a4b03f7e8ca6733a8df942f7833045d9e2c8019e`

Read-only status call returned:

```json
{
  "checkoutSessionId": "63200106-3401-4fe4-bb61-c1038be6e7c3",
  "status": "awaiting_web_redirect",
  "order": null
}
```

Read-only database inspection showed:

| Field | Value |
| --- | --- |
| `id` | `63200106-3401-4fe4-bb61-c1038be6e7c3` |
| `status` | `awaiting_web_redirect` |
| `order_id` | `null` |
| `event_id` | `060d0483-50db-48d1-840b-73d9fc59356a` |
| `total_cents` | `37500` |
| `currency` | `EUR` |
| `stripe_checkout_session_id` | `cs_test_a1VFoXZScnf202mlGeXOqNrTO5Pz7doS5mQx79XYNcIAFrEjhX3PuqL9pv` |
| `stripe_payment_intent_id` | `null` |
| `stripe_account_id` | `acct_1TY6UFPjlZjiLhFt` |

Edge logs showed the browser did call `ticket-checkout-confirm` and received HTTP 200, while no matching `payment_webhook_events` row was present for that checkout session id / Checkout Session id. That combination proves the page was not stuck because the carousel failed to mount in browsers; it was stuck because the server kept reporting an unfinalized session.

## Verification

| Gate | Command / Evidence | Result |
| --- | --- | --- |
| Edge function type check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-confirm/index.ts` | PASS |
| New regression test | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-confirm/__tests__/orch_0952_web_checkout_session_fallback.test.ts` | PASS, 4/4 |
| Browser carousel matrix | `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts` from `mingla-business` | PASS, 9/9 on sequential rerun |
| Required adversarial browser test | `CI=1 npm run test:browser -- meta_orch_0952_carousel_adversarial.test.ts` from `mingla-business` | PASS, 3/3 |
| Existing ORCH-0921 confirm tests | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params.test.ts supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params_adversarial.test.ts` | FAIL, 7/8; appears pre-existing because current source contains ORCH-0924 rollback comments while these tests expect the reverted ORCH-0921 installment parameter shape |
| Live BC-11 physical Safari | Not rerun as pass | BLOCKED until the updated `ticket-checkout-confirm` function is deployed/promoted |

## Android Business Build Attempt For SC-6

Device state:

```text
adb devices -l
emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a
```

Observed build path issues:

- Running native Android build in the bracketed worktree path failed in CMake with `RegularExpression::compile(): Invalid range in []`, caused by the `[` and `]` characters in the worktree path.
- A temp copy at `/tmp/mingla-business-meta0952-build` avoided the bracket-path CMake failure.
- Debug build succeeded after copying Worklets' built `libworklets.so` files into the legacy `intermediates/cmake/debug/obj/*` locations expected by Reanimated.

Debug APK evidence:

```text
APK: /tmp/mingla-business-meta0952-build/android/app/build/outputs/apk/debug/app-debug.apk
Size: 249M
Install: adb -s emulator-5554 install -r /tmp/mingla-business-meta0952-build/android/app/build/outputs/apk/debug/app-debug.apk
Result: Success
```

Launcher evidence:

```text
aapt dump badging app-debug.apk
launchable-activity: name='com.sethogieva.minglabusiness.MainActivity'

adb -s emulator-5554 shell dumpsys package com.sethogieva.minglabusiness
Activity Resolver Table includes com.sethogieva.minglabusiness/.MainActivity for MAIN/LAUNCHER.

adb -s emulator-5554 shell am start -W -n com.sethogieva.minglabusiness/com.sethogieva.minglabusiness.MainActivity
Error type 3
Error: Activity class {com.sethogieva.minglabusiness/com.sethogieva.minglabusiness.MainActivity} does not exist.
```

Release build attempt:

- Release native compilation passed after the same temporary Worklets library bridge.
- Release JS bundling first failed because the temp app copy was outside the monorepo and Metro expected `/private/tmp/packages`.
- Adding a temp symlink from `/private/tmp/packages` to the real worktree packages advanced bundling.
- Release bundling then failed resolving `@mingla/phone-input` from `app/checkout-trip/[tripEventId]/buyer.tsx`, despite `/private/tmp/packages/phone-input/package.json` and `index.ts` existing.

Android verdict: not launchable yet on `emulator-5554`. The worktree can produce and install a debug APK, but the emulator still rejects the launcher Activity; release packaging remains blocked by Metro workspace resolution in the temp copy. SC-6 Android parity should remain blocked until a clean native-build worktree path without bracket characters is used, or the Android/Metro workspace resolution issue is fixed outside this checkout-confirm rework.

## Deployment And Retest Contract

No edge deploy was performed. To make the BC-11 fix available on live `business.usemingla.com`, deploy/promote only the updated confirm function:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]" && /Users/sethogieva/bin/supabase functions deploy ticket-checkout-confirm --project-ref gqnoajqerqhnvulmnyvv
```

After deploy, tester should rerun:

1. BC-11 physical iPhone Safari with a fresh paid hosted Checkout return URL and the original reload + 30s condition.
2. The browser carousel matrix to ensure web carousel behavior remains green.
3. The adversarial browser test to ensure the old QR-mounted guard still fails on revert.
4. SC-6 Android parity only after a launchable business Android build is available; the current emulator build evidence is installable but not launchable.

---

## Retest After Edge Deploy — Physical Safari Multi-Ticket Carousel Rework

Status: IMPLEMENTED, PARTIALLY VERIFIED; PHYSICAL SAFARI LIVE RETEST REQUIRED  
Updated: 2026-05-25  
Branch: meta-orch-0952-buyer-web-confirm-deep-forensics  
Worktree: /Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]

### Outcome

The edge finalization blocker is treated as resolved per the tester retest evidence: fresh hosted Checkout returns now reach the order confirmation view. The remaining P1 was isolated to the buyer-web multi-ticket carousel render path: the carousel data exists and the order view mounts, but the web carousel pages could collapse or shrink to QR-content width instead of occupying one full swipe page. Single-ticket orders remained correct because they bypass the horizontal carousel and render the bare QR path.

The rework restores one measured full-width page per ticket on web and native, keeps the ORCH-0951 full-width empty host so first measurement cannot collapse, and syncs the `ScrollView` offset when the measured page width changes. This preserves the 1-ticket path, QR PNG payload path, edge finalization path, CartContext, `buildQrPayload`, consumer mobile, admin, DB, migrations, Stripe, and QR schema.

### Root Cause

The prior carousel rework switched web pages from numeric measured widths to percentage/flex pages so the web subtree could render immediately. Local exported-web inspection showed that this was an incomplete contract: Chromium/WebKit/Firefox could still find three QR images and pass the old tests, but the pages no longer behaved as one full-width swipe page. In the physical Safari live view this manifested as a collapsed/strip-like carousel surface after the 3-ticket order finalized.

The old automated tests checked for carousel presence, image count, dots, and hint, but they did not assert that the first QR card was full-size and centered in the viewport while the second and third QR cards were off-screen as swipe pages. The new regression assertions cover that geometry directly.

### Files Changed By This Rework

- `mingla-business/src/components/checkout/TicketQrCarousel.tsx`
  - Restores numeric measured page widths for web and native.
  - Keeps the full-width measuring host before rendering pages so the ORCH-0951 blank-strip loop cannot recur.
  - Adds a `ScrollView` ref and synchronizes scroll offset to `activeIndex * pageWidth` whenever measured width changes, protecting Safari/viewport resize paths.
  - Keeps single-ticket rendering unchanged.

- `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_browser.test.ts`
  - Strengthens HP-01/HP-02 geometry checks so multi-ticket QR cards must render as full-width pages, not merely as three image nodes.
  - Preserves HP-03 single-ticket guard.

- `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_adversarial.test.ts`
  - Adds the same full-width page geometry assertions to the narrow-wide-narrow resize test.

### Verification

| Gate | Command / Evidence | Result |
| --- | --- | --- |
| Browser carousel matrix | `CI=1 npm run test:browser -- meta_orch_0952_carousel_browser.test.ts` from `mingla-business` | PASS, 9/9 in 24.2s across Chromium/WebKit/Firefox |
| Required adversarial resize | `CI=1 npm run test:browser -- meta_orch_0952_carousel_adversarial.test.ts` from `mingla-business` | PASS, 3/3 in 13.4s across Chromium/WebKit/Firefox |
| ORCH-0951 source guard | `npx jest src/components/checkout/__tests__/orch_0951_carousel_host_width.test.tsx --runInBand` from `mingla-business` | PASS, 4/4 |
| SC-7 DIAG cleanup | `rg -n "\\[META-ORCH-0952-DIAG\\]|MetaOrch0952DiagBoundary|ORCH-0930 v3|useState initializer pattern" mingla-business app-mobile supabase/functions mingla-admin -S` | PASS, zero matches |
| Typecheck | `npm run typecheck -- --noEmit` from `mingla-business` | FAIL on existing unrelated repo errors in checkout buyer files, marketing rich editor/tooltip, missing `@mingla/payments-native`, stale DraftEvent test fixtures, and shared package dependency typings. No error in `TicketQrCarousel.tsx` surfaced before the unrelated failures. |

### Scope / Guards

Honored: no Android retest, no database changes, no Supabase migrations, no edge-function changes, no Stripe changes, no `CartContext.tsx` changes, no `buildQrPayload` changes, no consumer mobile changes, no admin changes, no QR schema changes, and SC-7 DIAG grep stayed clean.

### Retest Instructions

1. Use physical iPhone Safari against live `business.usemingla.com`.
2. Buy a fresh 3-ticket paid trip checkout and let Stripe return to `/checkout-trip/{tripEventId}/confirm?...`.
3. Expected: the order view reaches `You're in`, then the QR area shows a full-size first QR card, `Ticket 1 of 3`, three dots, and `Swipe to see next ticket`.
4. Swipe the carousel horizontally.
5. Expected: dots advance and tickets 2 and 3 show as full-size QR cards without the vertical strip/collapse.
6. Buy or open a fresh 1-ticket paid trip checkout as regression guard.
7. Expected: one visible QR card renders with `Show this at the door` and no dots or swipe hint.

Android remains deferred by directive for this cycle; route the next pass to tester for BC-11 physical Safari only plus the existing browser regression gates.
