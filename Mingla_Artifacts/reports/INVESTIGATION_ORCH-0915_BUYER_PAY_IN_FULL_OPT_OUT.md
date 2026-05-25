# INVESTIGATION - ORCH-0915 [Buyer/traveller pay-in-full opt-out at payment-plan checkout]

**Author:** Codex `forensics` parity mirror  
**Date:** 2026-05-24  
**Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]/` on branch `orch-0915-buyer-pay-in-full-opt-out`  
**Mode:** INVESTIGATE + SPEC  
**HEAD:** `4c0bd2d28e71001f603c03e4c395272a84890f58` (`4c0bd2d2`)  
**Confidence:** HIGH source-trace confidence; runtime/live-fire not required for missing-feature proof.

---

## 1. Layman Summary

Buyers who select a trip tier with `tier_metadata.installments` are locked into the organiser's deposit plus future-installment schedule. The buyer UI shows the schedule and changes the payment CTA to the deposit amount, but there is no buyer-controlled choice to pay the full price now. The server reinforces the lockout: when `biz_ticket_checkout_create_session` sees a valid installment object on the selected trip tier, it automatically rewrites the checkout session total from full price to the deposit price and persists `ticket_checkout_sessions.installment_schedule`.

The pay-in-full path already exists for trips without `tier_metadata.installments`: the same checkout pipeline charges `totalCents` once, leaves `ticket_checkout_sessions.installment_schedule` null, finalizes an order with `orders.installment_plan_root=false`, and creates zero `order_installments` rows. ORCH-0915 should make that non-installment path explicitly selectable even when the tier has a plan configured.

Important current-truth nuance: ORCH-0921 did close the missing-installment-row revenue leak with migration `20260724000000_orch_0921_finalize_compare_and_correct.sql`, but ORCH-0924 later rolled the two non-webhook edge callers back to 5-param finalize calls. ORCH-0925 then made `ticket-checkout-create` attach Stripe Customers for payment-plan PIs, and live evidence says the webhook plus compare-and-correct path now self-heals plan orders. ORCH-0915 must not worsen that state. The safest scope is to leave confirm/reconcile behavior alone and make the opt-out branch produce a true non-installment checkout session (`installment_schedule = NULL`).

---

## 2. Phase 0 Ingest Receipts

| Required input | Read | Key truth used |
|---|---:|---|
| Dispatch | Yes | Save paths, no-fix guard, open operator questions, ORCH-0921/0914 dependencies. |
| `WORLD_MAP.md` ORCH-0915 banner | Yes | S1 missing-feature/UX/revenue-risk; buyer-anon-web primary; consumer app to confirm. |
| ORCH-0921 close artifacts | Yes | Root cause was finalize callers missing installment params; compare-and-correct migration exists; strict-grep invariant exists. |
| ORCH-0914 close artifacts | Yes | Money tab includes paid-in-full row variant for paid orders with zero installments. |
| ORCH-0924/0925 current-source follow-up | Yes, because current code references them | Confirm/reconcile are currently ORCH-0924 allowlisted 5-param callers; ORCH-0925 Customer attachment is current. |
| Constitution | Yes | README rules #1, #3, #9, #12 are relevant. |
| Invariant registry | Yes | `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` is active in registry and enforced by strict-grep allowlist pattern. |
| Memory | Partial | Root `MEMORY.md` absent in this worktree; read relevant Claude memories for worktrees, anon buyer routes, and cross-surface inspection. |

Phase 0 limitation: this worktree has no root `MEMORY.md`; the investigation used artifact indexes plus `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/`.

---

## 3. Investigation Manifest

| Order | File / artifact | Why |
|---:|---|---|
| 1 | `Mingla_Artifacts/WORLD_MAP.md` | ORCH-0915 intake and sequencing. |
| 2 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0921_*`, `specs/SPEC_ORCH-0921_*`, QA/implementation reports | Revenue-leak substrate and finalize invariant. |
| 3 | `supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql` | Current latest finalize RPC definition. |
| 4 | `supabase/functions/ticket-checkout-confirm/index.ts`, `reconcile-stuck-checkouts/index.ts`, `_shared/stripeWebhookRouter.ts` | Current finalize caller truth after ORCH-0924/0925. |
| 5 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0914_*`, `specs/SPEC_ORCH-0914_*`, `IMPLEMENTATION_ORCH-0914_*` | Money tab coupling and paid-in-full row readiness. |
| 6 | `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | Tier selection and first buyer-visible plan lockout. |
| 7 | `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx`, `intake.tsx`, `payment.tsx` | Disclosure, CTA, payment call site, terms/copy area. |
| 8 | `mingla-business/src/services/ticketCheckoutService.ts` | Request payload sent to edge function. |
| 9 | `supabase/functions/ticket-checkout-create/index.ts` | Stripe hosted/native creation and `isInstallmentPlan` branch. |
| 10 | `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql` | Latest create-session schedule behavior. |
| 11 | `supabase/functions/process-scheduled-installments/index.ts` + `_shared/installments/createInstallmentPI.ts` | Cron skip behavior and saved PM requirements. |
| 12 | `app-mobile/src/payments/nativeCheckoutFlow.ts` + `ExpandedBusinessEventSheet.tsx` | Consumer app purchase surface confirmation. |

---

## 4. Findings

### F-1 - confirmed UX gap / missing feature: buyer checkout renders payment plan as active state with no pay-in-full choice

**File/line:** `mingla-business/app/checkout-trip/[tripEventId]/index.tsx:324-366` and `payment.tsx:503-599`.

**Exact behavior:** Tier selection maps every selected plan-active tier to `projectInstallmentSchedule(...)` and renders `<InstallmentScheduleDisplay />`. Payment screen repeats the plan disclosure, renders a sticky "Payment plan active" banner, and changes the CTA to `Pay {depositCents} deposit`.

**Current behavior:** The buyer sees "Deposit today / future dates / total", then proceeds through buyer details/intake/payment. There is no state variable, segmented control, radio group, checkbox, or service payload that can choose full payment when `projectedSchedule !== null`.

**Expected behavior:** A plan-active tier should present two mutually exclusive choices before Stripe creation: pay full amount now, or use the organiser's payment plan.

**Causal chain:** `index.tsx` only controls quantity. `buyer.tsx` and `intake.tsx` only disclose the plan. `payment.tsx` derives `isPlanActive` from selected tier metadata, and `handlePay` sends only `{ eventId, buyer, lines, surface, intake_form_data }` through `createTicketCheckout`. Because no user choice exists in React state or the service payload, the edge/RPC layer cannot know the buyer wanted full payment.

**Verification step:** Source grep for payment-choice nouns in checkout-trip routes returns no opt-out state or payload. `createTicketCheckout` interface has no payment choice field.

**Classification:** UX gap + missing feature.

### F-2 - confirmed data/Stripe lockout: create-session automatically converts any valid tier installment metadata into a deposit checkout

**File/line:** `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:262-381`, `397-415`, `433-455`; `supabase/functions/ticket-checkout-create/index.ts:307-317`, `489-567`, `788-821`.

**Exact behavior:** The RPC checks `v_is_trip`, reads `trip_pricing_tiers.tier_metadata -> 'installments'`, validates the object, computes deposit/installment amounts, overrides `v_total` to `v_deposit_cents`, and writes `ticket_checkout_sessions.installment_schedule` only when `v_installments_out <> '[]'`. The edge then treats non-null `session.installmentSchedule` as `isInstallmentPlan`.

**Trigger condition:**

| Tier config | Current result |
|---|---|
| `installments` key absent/null | no plan; full single charge |
| `installments` key not an object | no plan; full single charge |
| object with `deposit_pct <= 0` or `> 100` | RPC exception `installment_deposit_pct_out_of_range` |
| object with missing/non-array inner `installments` | RPC exception `installment_schedule_malformed` |
| object with inner `installments.length < 1` or `> 11` | RPC exception `installment_count_out_of_range` |
| valid object with `deposit_pct > 0`, 1..11 installments, pct sum 100 | forced deposit checkout + persisted `installment_schedule` |
| multi-ticket-type cart where first tier has a valid plan | RPC exception `ticket_lines_mixed_with_installments` |

**Expected behavior:** A valid tier plan should make the installment branch available, but not mandatory. When buyer opts out, the server should preserve `v_total` as the full cart price and write `installment_schedule = NULL`.

**Causal chain:** UI sends no choice. RPC has no parameter to override plan selection. Edge computes `isInstallmentPlan` from the RPC response alone. Stripe Checkout Sessions get `line_items.unit_amount = totalCents`, so for plan-active tiers the hosted page charges only the deposit; native PaymentIntent path also creates amount `totalCents`, therefore the deposit.

**Verification step:** Read create-session migration; line 381 rewrites `v_total` to deposit and line 407 builds schedule. Read edge; line 314 detects `session.installmentSchedule`, line 502 adds `mingla_installment_plan_root`, line 507 adds `setup_future_usage`, line 566 adds `customer_creation: "always"`, and lines 793/800 do the same for native PaymentIntent.

**Classification:** confirmed lockout root cause.

### F-3 - confirmed existing full-pay architecture: non-installment trips already charge once and finalize as non-plan orders

**File/line:** `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:404-455`; `supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql:150-180`, `180-209`; `ticket-checkout-create/index.ts:489-567`, `788-821`.

**Current behavior:** If the selected trip tier does not produce `installment_schedule`, the checkout session total remains the full line-item total. The Stripe branch does not set `mingla_installment_plan_root`, does not save PM for future installment charges, and does not force Customer creation for hosted Checkout. Finalize writes `orders.installment_plan_root=false` because `p_installment_plan_root` is false, and it inserts no `order_installments` because the insert loop is gated by `p_installment_plan_root AND v_schedule IS NOT NULL`.

**Expected ORCH-0915 reuse:** Pay-in-full opt-out should reuse this path by making `ticket_checkout_sessions.installment_schedule` null even when the parent tier has a valid plan configured.

**Classification:** architecture observation.

### F-4 - confirmed coupling: ORCH-0914 Money tab is already compatible with paid-in-full rows

**File/line:** `mingla-business/app/trip/[id]/money/index.tsx:255-294`, `682-693`, `840-843`; `useTripOrders.ts:65-83`; `orderInstallmentsService.ts:158-205`.

**Current behavior:** Money tab reads installment rows via `useInstallmentsForBrandTrips`, groups them by order, and separately reads all trip orders via `useTripOrders`. Any paid order with no installment rows becomes a `TravelerMoneyRow` with `isPaidInFull=true`, `paidToDateCents=order.totalCents`, `outstandingCents=0`, `lastChargeStatus="collected"`, and `planSchedule=null`. `PlanCell` renders "Paid in full"; expanded ledger says "Paid in full at booking. No installment ledger for this traveller."

**Expected ORCH-0915 result:** Pay-in-full opt-out orders should render truthfully without Money-tab redesign as long as the order has full-price `total_cents` and zero child installment rows.

**Risk:** A leaked deposit-only order with zero child rows also renders paid in full; ORCH-0921/0925 history covered that. ORCH-0915 must ensure opted-out orders have full-price `total_cents`, not deposit `total_cents`.

**Classification:** compatibility confirmation + invariant risk.

### F-5 - current-truth invariant nuance: ORCH-0921 invariant exists, but current confirm/reconcile code still uses ORCH-0924 allowlisted 5-param calls

**File/line:** `ticket-checkout-confirm/index.ts:278-299`; `reconcile-stuck-checkouts/index.ts:85-99`; `_shared/stripeWebhookRouter.ts:777-796`; `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs`; `WORLD_MAP.md` ORCH-0924/0925 banners.

**Current behavior:** Confirm/reconcile finalize calls are allowlisted 5-param calls due to ORCH-0924 rollback. Webhook router is still the correct 8-param caller. The strict-grep gate passes with 4 finalize callers, 1 free caller skip, and 0 violations because the rollback comments are allowed. ORCH-0925 live-fire says the webhook + ORCH-0921 compare-and-correct migration now produces correct plan rows despite the rolled-back confirm path.

**Expected ORCH-0915 behavior:** Do not touch confirm/reconcile as part of this opt-out ORCH. The full-pay branch does not need installment params. The installment branch must keep existing metadata/Customer behavior so the webhook/compare-and-correct path remains sound until ORCH-0927 re-ships strict 8-param callers.

**Verification step:** Ran `node .github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs`: scanned 191 files, 4 finalize callers, 1 free caller skip, 0 violations.

**Classification:** invariant/production-hardening observation.

### F-6 - confirmed surface scope: consumer app does not have a trip checkout surface today

**File/line:** `app-mobile/src/payments/nativeCheckoutFlow.ts:1-17`, `ExpandedBusinessEventSheet.tsx:195-243`; grep result for `checkout-trip|usePublicTrip|TripCheckoutFlow|Reserve my spot` under `app-mobile/src app-mobile/app`.

**Current behavior:** Consumer app native checkout is wired from `ExpandedBusinessEventSheet` for business events. It passes `data.eventId` and ticket lines to `ticket-checkout-create` with `surface:"native"`. There is no app-mobile trip checkout route, `checkout-trip` usage, `usePublicTrip` purchase surface, or "Reserve my spot" flow.

**Expected scope:** ORCH-0915 implementation does not need consumer iOS/Android UI changes unless a later operator decision introduces consumer trip booking. The shared edge/RPC change must remain backward-compatible with app-mobile event checkout because it uses the same edge function.

**Classification:** scope confirmation.

---

## 5. Five-Truth-Layer Cross-Check

| Layer | Truth | Evidence |
|---|---|---|
| Docs/artifacts | ORCH-0915 asks for buyer choice; ORCH-0921/0925 make payment-plan substrate mostly sound; ORCH-0914 Money tab should render paid-in-full rows. | Dispatch; WORLD_MAP ORCH-0915/0914/0921/0924/0925; ORCH-0914/0921 artifacts. |
| Schema/RPC | `ticket_checkout_sessions.installment_schedule` non-null means payment plan; finalize only creates installment rows when `p_installment_plan_root AND v_schedule IS NOT NULL`. | `20260610000002`, `20260724000000`. |
| Code | Checkout-trip UI has disclosure but no choice; service has no choice payload; create-session auto-builds schedule from tier metadata. | `checkout-trip/*.tsx`, `ticketCheckoutService.ts`, `ticket-checkout-create/index.ts`. |
| Runtime/test evidence | Source-only proof is sufficient for missing-feature. ORCH-0925 live-fire separately proves plan orders can finalize correctly after Customer attachment. | WORLD_MAP ORCH-0925 upgraded PASS; strict-grep command result. |
| Data assumptions | A pay-in-full order should have full-price `orders.total_cents`, `installment_plan_root=false`, and zero `order_installments`. Existing Money tab derives paid-in-full from that state. | Money route grouping logic + orders/installments schema. |

Contradiction found: ORCH-0921 close artifact says strict 8-param callers shipped, but current source intentionally rolled two callers back under ORCH-0924. Current code, not historical close text, must drive ORCH-0915.

---

## 6. Architecture Trace: Pay-In-Full Path That Must Exist

1. Buyer selects a trip tier with a valid `installmentSchedule`.
2. UI stores `paymentPlanChoice = "full" | "installments"` for the checkout session.
3. `createTicketCheckout` sends the explicit choice only when a plan-active tier exists.
4. `ticket-checkout-create` validates the choice and passes it to `biz_ticket_checkout_create_session`.
5. `biz_ticket_checkout_create_session`:
   - if choice is `installments` or default/backward-compatible auto, current behavior persists schedule and total becomes deposit;
   - if choice is `full`, skip schedule generation, leave total as full price, persist `installment_schedule = NULL`.
6. Stripe:
   - full branch: single full-price Checkout Session/PaymentIntent; no `mingla_installment_plan_root`, no `setup_future_usage`, no Customer/PM requirement for future installments;
   - installment branch: existing deposit Checkout Session/PaymentIntent plus saved PM/Customer behavior unchanged.
7. Finalize:
   - full branch: `orders.installment_plan_root=false`, `orders.total_cents=full price`, zero `order_installments`;
   - installment branch: existing ORCH-0921/0925 behavior preserved.
8. Cron:
   - full branch: zero rows means `process-scheduled-installments` skips naturally because it only queries `order_installments.status IN ('scheduled','failed')`.

Recommended data shape for opt-out: `ticket_checkout_sessions.installment_schedule = NULL`. Do not store `{ fullPriceCents, depositCents=fullPriceCents, installments: [] }` because current edge logic treats non-null schedule as an installment plan and would incorrectly set `setup_future_usage`, Customer creation, and installment metadata.

---

## 7. UX Trace

| Route | Sections | Current plan handling |
|---|---|---|
| `/checkout-trip/{tripEventId}` | mini trip card, tier quantity rows, per-tier schedule disclosure, sticky subtotal + Continue | Plan disclosure appears once quantity >= 1. No choice. |
| `/checkout-trip/{tripEventId}/buyer` | buyer details, phone validation, optional plan disclosure | Plan disclosure only; no choice. |
| `/checkout-trip/{tripEventId}/intake` | required intake forms, optional plan disclosure | Plan disclosure only; no choice. |
| `/checkout-trip/{tripEventId}/payment` | order summary, schedule card, payment copy, sticky plan banner, total row, pay CTA | Best place for final choice because it is immediately before Stripe and already owns pre-Stripe terms/disclosure. |

Recommended placement: add the two-choice control on `payment.tsx`, directly after the Order Summary and before the existing schedule/payment cards. Keep earlier pages as disclosure-only.

Required two-state copy:

| Choice | Primary copy | Secondary copy | CTA |
|---|---|---|---|
| Pay full | `Pay full {fullPrice} now` | `One charge today. No future automatic installment bills for this booking.` | `Pay {fullPrice}` |
| Use payment plan | `Use payment plan` | `{deposit} deposit today + {N} future payment(s) on the dates shown.` | `Pay {deposit} deposit` |

Terms/refund copy should differ by branch, but only as copy. Full pay says one immediate full-price charge. Payment-plan says deposit today, future scheduled card charges, and future uncollected installments may be cancelled under the organiser's refund policy. Refund UX and refund math remain out of scope.

---

## 8. Open Operator Questions With Recommendations

1. **Default selection:** Should plan-active tiers default to pay-in-full or payment plan?  
   **Recommendation:** default to pay full now. It is safest for revenue, simplest for buyers who can afford it, and still leaves the organiser's payment plan one tap away.

2. **Eligibility:** Should all payment-plan tiers offer opt-out, or should a future `tier_metadata.allow_pay_in_full` flag control it?  
   **Recommendation:** all existing payment-plan tiers offer opt-out by default in ORCH-0915. Defer organiser-controlled disablement to a future tier-creator ORCH.

3. **Refund-policy copy diff:** Should branch copy mention refund mechanics differently?  
   **Recommendation:** yes, but only as copy. Do not change refund calculation.

4. **Organiser-controlled opt-out disable:** Should organisers be able to force payment plans and hide pay-in-full?  
   **Recommendation:** no for this ORCH. Register a follow-up only if operators need it after dogfooding.

5. **Native business mobile hosted vs PaymentSheet path:** Should ORCH-0915 add the choice to both web and native business checkout surfaces inside `mingla-business`?  
   **Recommendation:** yes for `mingla-business` shared checkout route because `payment.tsx` has both web and native branches. Consumer app remains out of scope because it has no trip checkout surface.

---

## 9. Blast Radius

| Surface | Impact |
|---|---|
| buyer-anon-web (`mingla-business` `/checkout-trip/{tripEventId}/payment`) | Primary UI and service payload. |
| business iOS/Android (`mingla-business`) | Same route code has a native PaymentSheet branch; must honor the choice when trip checkout runs in native app. |
| business web preview | Same RN-Web route; needs visual smoke. |
| consumer iOS/Android (`app-mobile`) | No trip checkout surface found; no UI work. Shared edge/RPC must remain backward-compatible with event checkout. |
| admin-web | Not in scope. |
| database/RPC | Replace `biz_ticket_checkout_create_session` with backward-compatible optional choice parameter; no new table needed. |
| Stripe | Full branch is one full-price payment; installment branch unchanged. |
| Money tab | Reads resulting order truth; no redesign required. |

---

## 10. Regression Prevention Needed In Spec

1. Buyer-web/UI source test: plan-active checkout payment page renders two choices and changes CTA/copy by choice.
2. Service/edge test: `createTicketCheckout` passes `payment_plan_choice` and edge maps it to RPC param.
3. SQL/RPC test: choosing `full` with valid tier installments yields `installment_schedule = NULL` and full-price `totalCents`.
4. Stripe contract test: full branch does not set `mingla_installment_plan_root`, `setup_future_usage`, or `customer_creation:"always"` solely because the tier has a plan.
5. Installment branch regression: current ORCH-0921/0925 behavior remains intact.
6. Money-tab test: paid-in-full opt-out order renders `Plan = "Paid in full"` and no installment action buttons.

---

## 11. Next Handoff

SPEC is written separately at `Mingla_Artifacts/specs/SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`.
