# SPEC - ORCH-0915 [Buyer/traveller pay-in-full opt-out at payment-plan checkout]

**Author:** Codex `forensics` parity mirror  
**Date:** 2026-05-24  
**Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]/` on branch `orch-0915-buyer-pay-in-full-opt-out`  
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`  
**Status:** SPEC READY for orchestrator review and operator answers to section 4.4 questions.

---

## 1. Scope

### In scope

1. Add buyer-controlled pay option on trip checkout payment page for plan-active tiers:
   - `Pay full {fullPrice} now`
   - `Use payment plan: {deposit} deposit + {N} future installments`
2. Thread selected choice through `createTicketCheckout` -> `ticket-checkout-create` -> `biz_ticket_checkout_create_session`.
3. Replace `biz_ticket_checkout_create_session` with a backward-compatible optional payment-plan-choice parameter.
4. Full-pay branch must produce a single full-price Stripe charge and a non-installment order.
5. Existing payment-plan branch must continue to produce a deposit charge and scheduled `order_installments` rows.
6. Preserve ORCH-0914 Money tab rendering by relying on existing paid-in-full row handling.
7. Add regression tests and one new strict-grep invariant for opt-out semantics.

### Out of scope

- No refund UX redesign.
- No refund calculation changes.
- No tier-creator changes.
- No organiser-side disable/enable toggle in this ORCH.
- No admin-web changes.
- No consumer app trip checkout UI, because investigation found no consumer trip checkout surface today.
- No ORCH-0927 re-ship of strict 8-param confirm/reconcile finalize callers. Do not remove ORCH-0924 rollback allow-comments in this ORCH.
- No `supabase db push`, edge deploy, EAS OTA, or Vercel `[deploy]` decision during implementation handoff; orchestrator owns deploy steps after review.

### Assumptions

1. Operator accepts the default recommendation unless overridden after review: default selection is pay-in-full.
2. All existing payment-plan tiers offer pay-in-full opt-out by default; organiser-controlled disabling is a future ORCH.
3. `ticket_checkout_sessions.installment_schedule = NULL` is the canonical full-pay opt-out state.
4. ORCH-0925 Customer attachment remains live for installment branches.

---

## 2. UX Contract

### 2.1 Route and placement

File: `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx`.

Insert the choice control after the Order Summary card and before the existing payment-plan disclosure card/payment card. This page is the final pre-Stripe step and already controls the payment CTA, sticky plan banner, and `createTicketCheckout` call.

Do not add the choice to:

- `/checkout-trip/{tripEventId}` tier selection
- `/checkout-trip/{tripEventId}/buyer`
- `/checkout-trip/{tripEventId}/intake`

Those earlier pages may keep read-only disclosure of the plan.

### 2.2 Control shape

Use an accessible two-option segmented/radio control:

| State value | Label | Description |
|---|---|---|
| `full` | `Pay full {fullPrice} now` | `One charge today. No future installment bills for this booking.` |
| `installments` | `Use payment plan` | `{deposit} deposit today + {N} future payment(s).` |

Accessibility:

- Group label: `Payment option`.
- Full option label: `Pay full {fullPrice} now`.
- Installment option label: `Use payment plan, {deposit} deposit today plus {N} future payments`.
- Selected state must be exposed via `accessibilityState={{ selected: true }}` or equivalent.

### 2.3 Default

Default recommended value: `full`.

If the operator overrides default to `installments`, only the initial state changes. All contracts below remain the same.

### 2.4 State transitions

| From -> to | Required UI update |
|---|---|
| `installments` -> `full` | Hide/replace sticky "Payment plan active" banner with full-pay confirmation copy; CTA becomes `Pay {fullPrice}`; total row remains full price. |
| `full` -> `installments` | Show existing plan schedule and sticky plan banner; CTA becomes `Pay {deposit} deposit`. |

Do not reset buyer details, intake answers, cart lines, or sessionStorage restore payload when switching.

### 2.5 Terms/refund-policy copy

Add branch-aware copy near the choice/CTA.

Full branch:

`You'll be charged {fullPrice} today. No future installment bills will be scheduled for this booking. Cancellations follow the organiser's refund policy.`

Installment branch:

`You'll be charged {deposit} today. The remaining {remaining} will auto-charge from the same card on the schedule shown. Cancellations follow the organiser's refund policy and may cancel future uncollected installments.`

Hard guard: copy only. Do not change refund math, refund endpoints, or cancellation routes.

---

## 3. Data Contract

### 3.1 Client/service payload

Add to `TicketCheckoutCreateInput` in `mingla-business/src/services/ticketCheckoutService.ts`:

```ts
paymentPlanChoice?: "full" | "installments";
```

`createTicketCheckout` sends:

```ts
...(input.paymentPlanChoice !== undefined
  ? { payment_plan_choice: input.paymentPlanChoice }
  : {})
```

Only `checkout-trip/[tripEventId]/payment.tsx` should pass this field for plan-active trip checkouts. Event checkout and app-mobile event checkout must remain unchanged.

### 3.2 Edge request validation

In `supabase/functions/ticket-checkout-create/index.ts`:

- Parse `body.payment_plan_choice`.
- Accepted values: `"full"`, `"installments"`.
- Invalid values return HTTP 400 `{ error: "payment_plan_choice_invalid" }`.
- Omitted value maps to `"auto"`/legacy behavior server-side.

Pass to RPC as `p_payment_plan_choice`.

### 3.3 RPC signature

Create a monotonic migration after current max local migration `20260724000005_profile_circle_relationship_source.sql`:

`supabase/migrations/20260724000006_orch_0915_pay_in_full_opt_out.sql`

Replace `public.biz_ticket_checkout_create_session` with the same parameters plus:

```sql
p_payment_plan_choice text DEFAULT 'auto'
```

Allowed values inside the RPC:

```sql
IF p_payment_plan_choice NOT IN ('auto', 'full', 'installments') THEN
  RAISE EXCEPTION 'payment_plan_choice_invalid';
END IF;
```

Backward compatibility:

- `auto` preserves current behavior for all existing callers.
- `installments` forces the existing plan branch when a valid plan exists.
- `full` suppresses schedule generation for this checkout even when tier metadata has valid installments.

### 3.4 `ticket_checkout_sessions.installment_schedule`

| Branch | Value |
|---|---|
| No tier plan | `NULL` |
| Plan tier + buyer chooses full | `NULL` |
| Plan tier + buyer chooses installments | Existing shape: `{ fullPriceCents, depositCents, currency, installments: [{ ordinal, pct, amountCents, dueAt }] }` |

Do not store `{ installments: [] }` for full-pay opt-out. Non-null schedule means installment plan to current edge code.

### 3.5 `orders` and `order_installments`

| Branch | `orders.total_cents` | `orders.installment_plan_root` | Customer/PM fields | `order_installments` |
|---|---:|---:|---|---|
| Full-pay opt-out | full price | `false` | `NULL` unless unrelated future feature adds saved-card use | zero rows |
| Payment plan | deposit amount | `true` after webhook/compare-correct or strict caller | connected account Customer + saved PM | one row per future installment |
| No-plan full pay | full price | `false` | existing behavior | zero rows |

Money tab must render full-pay opt-out as existing paid-in-full row.

### 3.6 Tier metadata

No new `tier_metadata.allow_pay_in_full` flag in ORCH-0915.

Default behavior for tiers without the flag: allow opt-out. If the operator later wants organiser-controlled disabling, open a follow-up ORCH that touches tier creator/edit UI and server validation.

---

## 4. Stripe Contract

### 4.1 Full-pay branch

Hosted Checkout (`surface:"web"` / `surface:"mobile-web"`):

- `line_items[0].price_data.unit_amount = fullPriceCents`.
- No `payment_intent_data.metadata.mingla_installment_plan_root`.
- No `payment_intent_data.setup_future_usage`.
- No `customer_creation:"always"` solely because the parent tier has installments.
- Existing `customer_email`, automatic tax, application fee, direct-charge `stripeAccount` behavior preserved.

Native PaymentIntent branch:

- `amount = fullPriceCents`.
- No `mingla_installment_plan_root`.
- No `setup_future_usage`.
- No installment-only `customer: customerId` requirement.
- Existing full-pay guest-mode fallback remains.

### 4.2 Installment branch

Preserve existing behavior:

- `amount/line_items.unit_amount = depositCents`.
- Metadata includes `mingla_installment_plan_root:"true"`.
- `setup_future_usage:"off_session"` set.
- Hosted Checkout sets `customer_creation:"always"`.
- Native PaymentIntent provisions/attaches Customer per ORCH-0925 and sets `customer`.
- Payment method types for installment plans remain card-only via `getInstallmentPaymentMethodTypes()`.

### 4.3 Finalize/RPC invariant

Do not modify `ticket-checkout-confirm` or `reconcile-stuck-checkouts` under ORCH-0915. They are currently ORCH-0924 allowlisted 5-param callers and ORCH-0927 owns re-shipping strict 8-param calls.

Full-pay opt-out must finalize as `p_installment_plan_root=false` by omission/default or by webhook-derived `false`. Installment branch must keep webhook metadata so `_shared/stripeWebhookRouter.ts` continues to pass `p_installment_plan_root=true` when appropriate.

---

## 5. Edge Function Changes

### 5.1 `ticket-checkout-create`

Required changes:

1. Parse `payment_plan_choice`.
2. Pass `p_payment_plan_choice` to `biz_ticket_checkout_create_session`.
3. Keep `isInstallmentPlan` derived from returned `session.installmentSchedule`.
4. For full opt-out, `session.installmentSchedule` must be null, so the existing non-installment branch runs.
5. Add structured 400 mapping for `payment_plan_choice_invalid` if the RPC raises it.

Do not change:

- Success/cancel URL branching.
- ORCH-0925 Customer attachment behavior for installment plans.
- Payment method allowlist.
- Application fee formula.
- Intake schema validation.

### 5.2 `ticket-checkout-confirm`

No change in ORCH-0915.

### 5.3 `reconcile-stuck-checkouts`

No change in ORCH-0915.

### 5.4 `stripeWebhookRouter`

No change required. Full-pay PIs do not carry installment metadata; existing webhook caller passes `p_installment_plan_root=false`. Installment PIs keep metadata and pass `true`.

### 5.5 `process-scheduled-installments`

No change required. It only queries `order_installments` rows. Full-pay opt-out creates zero rows, so it is naturally skipped.

---

## 6. New Strict-Grep Invariant

Add DRAFT invariant, promoted at close if tests pass:

`I-PROPOSED-PAY-IN-FULL-OPT-OUT-NO-INSTALLMENT-ROWS`

**Rule:** When a trip tier has a configured payment plan and buyer chooses `payment_plan_choice:"full"`, the checkout session and resulting order MUST be non-installment: `ticket_checkout_sessions.installment_schedule IS NULL`, `orders.installment_plan_root=false`, `orders.total_cents=full price`, and zero `order_installments` rows.

**Suggested enforcement:**

`.github/scripts/strict-grep/i-proposed-pay-in-full-opt-out-no-installment-rows.mjs`

The gate should source-scan:

- `ticketCheckoutService.ts` includes `paymentPlanChoice`.
- `checkout-trip/[tripEventId]/payment.tsx` passes `paymentPlanChoice`.
- `ticket-checkout-create/index.ts` parses `payment_plan_choice` and passes `p_payment_plan_choice`.
- newest ORCH-0915 migration contains `p_payment_plan_choice text DEFAULT 'auto'` and the full-choice branch prevents schedule generation.

Also add functional tests below; do not rely on strict-grep alone for SQL behavior.

---

## 7. Cross-Surface Impact

| Surface | Covered? | Contract |
|---|---:|---|
| Buyer-anon-web | Yes | Main UI on `/checkout-trip/{tripEventId}/payment`; web hosted Checkout gets full/deposit amount correctly. |
| Business iOS | Yes | Same `mingla-business` route has native branch; PaymentSheet amount and metadata follow choice. |
| Business Android | Yes | Same as iOS. |
| Business web preview | Yes | Same RN-Web route; visual smoke required. |
| Consumer iOS | No UI | No consumer trip checkout surface found. Shared edge/RPC remains backward-compatible with event checkout. |
| Consumer Android | No UI | Same as consumer iOS. |
| Admin web | Out of scope | No buyer checkout surface. |

---

## 8. Success Criteria

| SC | Criterion | Layer |
|---|---|---|
| SC-01 | On a plan-active trip tier, payment page renders exactly two payment options: full and installments. | UI |
| SC-02 | Default selection follows operator answer; default recommended is full. | UI |
| SC-03 | Switching choices updates terms copy, sticky banner, and CTA amount without clearing cart/buyer/intake state. | UI/state |
| SC-04 | Full branch sends `payment_plan_choice:"full"` to `ticket-checkout-create`. | service/edge |
| SC-05 | Installment branch sends `payment_plan_choice:"installments"` to `ticket-checkout-create`. | service/edge |
| SC-06 | Omitted choice preserves legacy auto behavior for event checkout and old clients. | edge/RPC |
| SC-07 | Full branch on a plan-configured tier creates `ticket_checkout_sessions.installment_schedule=NULL` and `totalCents=fullPriceCents`. | RPC |
| SC-08 | Full branch Stripe hosted/native requests are single-charge requests with no installment metadata/setup_future_usage/customer_creation forced by plan metadata. | Stripe |
| SC-09 | Full branch final order has `installment_plan_root=false`, full-price `total_cents`, and zero `order_installments`. | DB/finalize |
| SC-10 | Installment branch still creates deposit checkout, non-null `installment_schedule`, installment metadata, Customer/PM attachment, and scheduled child rows after finalize. | end-to-end |
| SC-11 | ORCH-0921 compare-and-correct migration and current strict-grep gate still pass. | invariant |
| SC-12 | ORCH-0914 Money tab renders full-pay opt-out as `Paid in full`, outstanding `0`, no charge/reminder action. | business UI |
| SC-13 | No consumer app trip UI is changed; app-mobile event checkout still compiles/tests. | cross-surface |
| SC-14 | Invalid `payment_plan_choice` returns structured 400 and does not create a checkout session. | edge/RPC |
| SC-15 | Regression tests ship in the same scoped commit/push as the feature. | process |

---

## 9. Regression-Test Surface For Implementor

### Required repo-running tests

1. `mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_0915_pay_in_full_choice.test.tsx`
   - asserts two choices render on plan-active payment page;
   - asserts default choice;
   - asserts CTA/copy changes for both branches;
   - asserts no choice renders for non-plan tier.

2. `mingla-business/src/services/__tests__/ticketCheckoutService.orch0915.test.ts`
   - asserts `paymentPlanChoice` maps to `payment_plan_choice`;
   - asserts omitted value preserves old request shape.

3. `supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice.test.ts`
   - asserts valid values accepted and invalid value rejected;
   - asserts RPC payload includes `p_payment_plan_choice`;
   - asserts full branch does not set installment Stripe metadata/setup flags.

4. `supabase/functions/_shared/__tests__/orch_0915_create_session_choice_sql.test.ts`
   - source or SQL fixture test proving `p_payment_plan_choice='full'` suppresses `installment_schedule` and keeps full total;
   - proves `p_payment_plan_choice='installments'` preserves current schedule behavior.

5. `mingla-business/app/trip/[id]/money/__tests__/money-redesign.test.tsx`
   - add ORCH-0915 case proving paid order with zero installment rows renders `Paid in full` and no installment action.

6. `.github/scripts/strict-grep/i-proposed-pay-in-full-opt-out-no-installment-rows.test.mjs`
   - positive scan passes;
   - synthetic bad fixture where full branch still writes schedule fails.

### Existing tests to re-run

- `node .github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs`
- `node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs`
- ORCH-0914 Money tab tests:
  - `mingla-business/app/trip/[id]/money/__tests__/money-redesign.test.tsx`
  - `mingla-business/app/trip/[id]/money/__tests__/money-redesign-adversarial.test.tsx` if present
- ORCH-0882 disclosure tests:
  - `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts`
  - `InstallmentScheduleDisplay_wiring_adversarial.test.ts`
- Focused Deno check for touched edge functions.

All regression tests must fail against pre-ORCH-0915 behavior and pass after implementation. Any exception must be explicit and converted into a tester manual gate.

---

## 10. Implementation Order

1. Add tests/gate first where feasible and verify at least one fails on current source.
2. Add `paymentPlanChoice` type and service payload mapping.
3. Add payment-page state/control/copy/CTA behavior.
4. Add edge parse/validation/RPC payload.
5. Add migration `20260724000006_orch_0915_pay_in_full_opt_out.sql` replacing `biz_ticket_checkout_create_session`.
6. Verify full branch does not set installment Stripe fields because returned `installmentSchedule` is null.
7. Update Money tab test for paid-in-full row if needed.
8. Run focused tests and strict-grep gates.
9. Write implementation report.

Deploy order after review:

1. Operator applies migration.
2. Orchestrator deploys `ticket-checkout-create`.
3. Orchestrator handles Vercel/EAS decisions after implementation diff is known.
4. Tester verifies buyer-web + business iOS + business Android + business web preview parity.

---

## 11. Hard Guards

1. Preserve ORCH-0921/0925 installment path. Do not change confirm/reconcile rollback state under this ORCH.
2. Preserve `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS`: current gate must still pass.
3. Full-pay opt-out must never create `order_installments`.
4. Full-pay opt-out must never create a deposit-only order.
5. Payment-plan choice must not be accepted for multi-tier plan carts that current server rejects; keep current `ticket_lines_mixed_with_installments` guard.
6. No refund UX/math changes.
7. No tier-creator UI/metadata flag changes.
8. No admin-web changes.
9. No consumer mobile rebuild unless a later review finds an actual consumer trip checkout surface.
10. No `supabase db push` or edge deploy from implementor.
11. Migration filename must remain monotonic-greater than local and remote heads; if remote head exceeds `20260724000005`, choose a higher prefix.

---

## 12. Operator Decision Register

The implementor should not start until orchestrator captures operator answers or accepts these defaults:

| Question | Recommended default |
|---|---|
| Default option | Pay full now |
| Eligibility | All payment-plan tiers allow opt-out |
| Refund-policy copy | Branch-specific copy only; no math changes |
| Organiser disable toggle | Defer |
| Native business checkout | Covered automatically via shared `payment.tsx`; no consumer app UI |

---

## 13. Next Handoff

After orchestrator review and operator answers, dispatch Codex `implementor-mingla` to implement this spec in the ORCH-0915 worktree.
