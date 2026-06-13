# IMPLEMENTATION — ORCH-1130 [public trip page payment-structure + installments UX redesign]

**Phase:** IMPLEMENT (mingla-implementor). **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on `ORCH-1130-trip-pay-structure`.
**Commit:** `068eb72ed`. **Date:** 2026-06-12.
**Binding contract:** `SPEC_ORCH-1130_PUBLIC_TRIP_PAYMENT_UX.md` (RESOLVED FORKS: segmented toggle + supporting block below; choice on public page + re-editable at Review) + `DESIGN_ORCH-1130_PUBLIC_TRIP_PAYMENT_UX.md` + `INVESTIGATE_ORCH-1130_PUBLIC_TRIP_PAYMENT_UX.md`.
**Comms ledger:** read on entry. No BLOCK to implementor/ORCH-1130/ALL. COMMS-0029/0030 (WARN, `biz_update_live_trip` authoring) — zero overlap (this ORCH touches buyer/checkout surfaces only). COMMS-0027/0030 (OTA/iOS-build WARN) — honored: no OTA, no deploy.

---

## 1. Summary

Pay-full vs pay-over-time is now a first-class choice presented at consideration time on both the business public trip page and the consumer trip detail, with the schedule revealed only when "Pay over time" is selected. The business checkout funnel collapses 3→2 for single-tier trips (the prod-universal case). The consumer native path now sends an EXPLICIT `payment_plan_choice` so a plan trip never silently charges deposit-only (DISC-1130-A consent fix). The shared selector is a segmented toggle (Seth-binding Fork 1) with the price/terms/schedule in a full-width block below the toggle.

## 2. SPEC success-criteria coverage

All satisfied by commit `068eb72ed`.

| State (SPEC §4) | Built | How |
|---|---|---|
| A1 no-plan public | ✓ | `TripCheckoutFlow` quiet recap (no toggle); bar `{price}` |
| A2 plan public default | ✓ | `TripPaymentChoice`, "Pay in full" selected, terms, no schedule; bar `{price} total` |
| A3 plan public over-time | ✓ | toggle over-time → `InstallmentScheduleDisplay` ladder + reassurance |
| A4 bookings closed | ✓ | `[tripSlug]` closed banner precedence unchanged; selector only on bookable paid trips |
| A5 free trip | ✓ | no toggle; "Reserve my spot" free bar |
| A6 single-tier funnel | ✓ | `index.tsx` auto-skip → lands on buyer "1 OF 2" |
| A7 Review & pay | ✓ | header "2 OF 2"; selector pre-filled from CartContext; qty stepper; Pay label per choice |
| A8 qty=2 plan | ✓ | `projectInstallmentSchedule(…, line.quantity)` scales deposit/schedule/Pay-label |
| B1 no-plan consumer | ✓ | module not mounted (hasPlan-gated); request omits the key (byte-identical) |
| B2 plan consumer default | ✓ | module "Pay in full"; pre-Reserve disclosure; Reserve → `payment_plan_choice="full"` |
| B3 plan consumer over-time | ✓ | module over-time; schedule + disclosure; Reserve → `"installments"` |
| B4 closed/unavailable consumer | ✓ | module hidden (`!closed && bookable !== false` gate) |
| B5 edge fn | ✓ | server receives explicit `full`/`installments`, never `'auto'` (nativeCheckoutFlow body key) |

## 3. Files changed (19 product/test/gate + 3 artifacts)

**Path A (business):**
- `mingla-business/src/components/checkout/CartContext.tsx` — `+~35` add `paymentPlanChoice` field (default "full") + `SET_PAYMENT_PLAN_CHOICE` action + `setPaymentPlanChoice`.
- `mingla-business/src/components/trip/TripPaymentChoice.tsx` — **NEW** `+285` segmented-toggle module (null-on-null, radiogroup, 3-channel selected, schedule-under-over-time).
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` — `~-95/+55` remove hero dupe + tier card + passive projection; no-plan recap / plan → `TripPaymentChoice`.
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — `+~25` local choice state; bar `{price} total` for plan trips; thread choice as route param.
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` — `~+35/-40` single-tier auto-skip + seed choice from param; remove passive per-tier card.
- `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` — `~-30` remove passive projection; header → "1 OF 2".
- `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` — `~-70/+70` replace inline selector with `TripPaymentChoice` from CartContext; add qty stepper; header → "2 OF 2".
- `mingla-business/src/components/checkout/CheckoutHeader.tsx` — `+4` widen `totalSteps` to `2 | 3`.

**Path B (consumer):**
- `app-mobile/src/hooks/useConsumerTripDetail.ts` — `+~80` `installmentSchedule` + `hasPlan` + `tier_metadata` select + `extractTripInstallmentSchedule`.
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` — `+~200` "HOW YOU PAY" module + projection + disclosure + thread choice.
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` — `+~12` `paymentPlanChoice` prop forwarded into `runNativeCheckout`.
- `app-mobile/src/payments/nativeCheckoutFlow.ts` — `+~12` `paymentPlanChoice` input → `payment_plan_choice` body key.

**Tests + gates:**
- `mingla-business/.../__tests__/TripPaymentChoice_orch_1130_regression.test.ts` — **NEW** happy-path (12 tests).
- `app-mobile/scripts/ci/orch-1130-consumer-payment-choice-check.mjs` — **NEW** consumer consent check (SIMULATE_REVERT fails-on-revert).
- `mingla-business/.../__tests__/InstallmentScheduleDisplay_wiring.test.ts` + `_adversarial.test.ts` + `ORCH-0876.adversarial.test.ts` — `[TEST-MOD-APPROVED ORCH-1130]` scope/shape realignment (superseded ORCH-0882 invariant; nav object form).
- `.github/scripts/strict-grep/i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` + `i-proposed-pay-in-full-opt-out-no-installment-rows.mjs` — gate realignment (disclosure scope; pay-full default relocated to CartContext) with self-tests green.

## 4. Data-model / edge functions

- **No migration.** No RPC change. `ticket-checkout-create` already accepts `body.payment_plan_choice` and forwards `p_payment_plan_choice`; `biz_ticket_checkout_create_session` unchanged.
- **No edge-fn deploy required** (consumer just now sends the already-supported key).

## 5. Regression tests + fails-on-revert

- **Business happy-path:** `mingla-business/src/components/trip/__tests__/TripPaymentChoice_orch_1130_regression.test.ts` — 12/12 PASS. Real-logic (projection math + EUR/GBP formatting) + source-characterization (toggle/null-on-null/no-hero-dupe/funnel/CartContext default).
  - **fails-on-revert verified at `068eb72ed`:** true line-deletion of the "Pay over time" segment `<Pressable>` in `TripPaymentChoice.tsx` → "two segments" test FAILED (1 failed/11 passed); restored → 12/12 PASS; `git diff --stat` clean (file matches commit).
- **Consumer consent (Path B):** `app-mobile/scripts/ci/orch-1130-consumer-payment-choice-check.mjs` — PASS normally; `ORCH1130_SIMULATE_REVERT=1` → FAILS (strips body-key forward + EBES forward + screen thread). This is the DISC-1130-A teeth (no silent 'auto').
- The tester will add a separate adversarial suite.

## 6. Gate results (pasted)

- `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint`: 3 files scanned, all markers present — PASS.
- `i-proposed-pay-in-full-opt-out-no-installment-rows`: self-test positive=0/negative=1 PASS; real scan 5 files, 0 violations PASS; `.test.mjs` PASS.
- `i-proposed-finalize-callers-pass-installment-params`: 0 violations. `orch-0769-app-wide-currency`: PASS.
- Business happy-path + `InstallmentScheduleDisplay_wiring(.test/_adversarial)` + `ORCH-0876.adversarial`: 4 suites, 84/84 PASS.
- **Typecheck (business):** ORCH-1130 files clean (only pre-existing `@mingla/phone-input` TS7006 on buyer.tsx — identical on the untouched event-side buyer.tsx; baseline).
- **Typecheck (app-mobile):** ORCH-1130 files clean (only pre-existing `applePay`/`@mingla/payments-native` baseline at nativeCheckoutFlow.ts:313).
- **Lint:** my one introduced warning (`useMemo` unused in index.tsx) fixed; remaining are pre-existing baseline (`@mingla/*` no-unresolved, line-686 Stripe-copy apostrophe, unused `glass`/`BottomSheetScrollView`/`scrollBottomClearance`/`BOTTOM_NAV_CONTENT_HEIGHT`, `OrderResult.tickets` Array-type — all predate ORCH-1130, confirmed via git diff).

## 7. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Consumer iOS/Android | YES | `ConsumerTripDetailScreen` module + plumbing (shared RN; parity automatic) |
| Buyer/anon Web | YES | `/t/` public page + `/checkout-trip/*` funnel |
| Business iOS/Android | YES | same `/checkout-trip/*` RN screens (parity automatic) |
| Admin Web | NO | no trip checkout surface |
| Business Web preview | NO | authoring, not buyer checkout |

## 8. Deviations from spec (justified)

- **Public page is OUTSIDE the checkout CartProvider** (CartProvider wraps only `/checkout-trip/*`). SPEC §2.3 implied `TripCheckoutFlow` drives `useCart()` on the public page; that would throw. Resolution honoring SPEC §4 intent ("thread the choice through the checkout-trip route params/state"): `TripCheckoutFlow` takes `paymentPlanChoice`/`onPaymentPlanChoiceChange` props held in local state by the `/t/` route, and the choice is threaded as a `plan` route param on Reserve; the checkout `index.tsx` seeds `CartContext.paymentPlanChoice` from it. CartContext remains the single owner across the funnel + the Review last-chance editor — invariant preserved.
- **index.tsx CheckoutHeader stays `totalSteps={3}`** for the multi-tier fallback only (single-tier auto-skips so this screen never renders for prod trips) — SPEC §2.6 explicitly permits this.
- **payment.tsx title → "Review & pay"** (DESIGN §1.3 IA), header `stepIndex={1} totalSteps={2}`.

## 9. Operator action required

- None for deploy: no migration, no edge-fn deploy, no OTA. Route to orchestrator REVIEW → tester for device proofs (SPEC §6): business-web `https://business.usemingla.com/t/travelbrand/the-sone` (toggle, over-time ladder €125/Jul-12 €250/Aug-11 €125, 2-step funnel, Pay-label); consumer app-mobile same trip (charge = €125 over-time vs €500 full; no silent 'auto'); Android opaque-glass on the option cards.

## 10. Tester must verify on a real device (could not be done here)

- Runtime dead-tap proof: every toggle segment + qty stepper + Reserve fires (ORCH-1103). Source + jest are green but no device/sim was driven this phase.
- Actual charged amount on the consumer plan-trip path (€125 over-time / €500 full) on a Stripe TEST card.
- Android: option cards render opaque (no glass bleed-through), no square shadow halo, accent tint visible.
- Web anon: the `/t/` page stays logged-out-reachable (PUBLIC_BUYER_ROUTE_PREFIXES) after the changes.

## 11. Discoveries for orchestrator

- **Pre-existing baseline jest failures (NOT ORCH-1130):** `eventType.filter.audit.test.ts` (4 fails in `publicEventsService`/`tripsService.updateTripBasics`/`getPublicTripById`/`ExperienceCheckoutFlow` — files untouched here), and `TripVisualParity(.test/_adversarial)`, `tr2RewordPolish`, `PaymentPlanEditor(.test/_adversarial)`, `TripPublishStripeBanner`, `TripCreatorWizard.cover`, `IntakeTypePickerSheet_orch_0884`, `EditPublishedTripScreen.refundGate/save`, `meta_orch_0952_carousel*` — all read stale source paths (e.g. `app/trip/[id]/index.tsx` moved to `…/money/index.tsx`) or the ORCH-1114-superseded `Share.share()` assertion. Confirmed against committed `[tripSlug].tsx` (zero `Share.share(`). Worth a sweep ORCH to realign these stale source-characterization tests.
- **`@mingla/phone-input` / `@mingla/payments-native` / `@mingla/event-rendering` do not type/lint-resolve in the per-ORCH worktree** (import/no-unresolved + TS7006 on untouched files too) — a worktree package-link issue, not code.
