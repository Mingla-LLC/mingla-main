# Implementation Rework Report: ORCH-0915 Native Pay-In-Full Opt-Out

> Date: 2026-05-25  
> Mode: Rework after native QA failure  
> Status: blocked before implementation  
> Working tree: `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]` on branch `orch-0915-buyer-pay-in-full-opt-out`  
> Input failure: `Mingla_Artifacts/reports/QA_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT_NATIVE_ADDENDUM.md`

## 1. Layman Summary

The native failure is not caused by the checked-in ORCH-0915 app/source code. The simulator hit deployed `ticket-checkout-create` version 103, and that deployed function is stale: it does not parse or pass `payment_plan_choice`, so even the full-pay UI tap created an installment checkout session for EUR 125.00.

The installment branch has a second independent blocker. The current Stripe test-mode restricted key used by `STRIPE_RAK_TICKET_CHECKOUT` is missing the Customer and Ephemeral Key permissions required by ORCH-0925, so installment PaymentSheet setup fails before card entry.

## 2. Root Cause

| Finding | Evidence | Impact |
|---|---|---|
| Deployed `ticket-checkout-create` is stale | Supabase MCP `get_edge_function(ticket-checkout-create)` returned version 103 source with no `PaymentPlanChoice` type, no `body.payment_plan_choice` parse, no `p_payment_plan_choice`, and legacy `checkoutIdempotencyKey({ eventId, buyerEmail, buyerPhoneE164, lines })`. | Native full-pay requests are ignored server-side and become legacy `auto`, which creates an installment session. |
| Remote RPC is already migrated | Read-only SQL showed `biz_ticket_checkout_create_session(..., integer, text)` with `p_payment_plan_choice text DEFAULT 'auto'`. | DB is not the stale layer; the edge deploy is. |
| QA full-pay sessions were actually installment sessions | Read-only SQL for `codex0915test2@example.com` showed failed sessions with `total_cents=12500`, `installment_schedule` present, and `fullPriceCents=50000`. | Confirms the full UI tap never reached the full branch on the deployed edge function. |
| Stripe restricted key cannot provision installment Customer | Stripe CLI test-mode probes against connected account `acct_1TY6UFPjlZjiLhFt` returned missing `rak_customer_read`, missing `rak_customer_write`, and missing `rak_ephemeral_key_write`. | Native installment branch cannot open PaymentSheet until the key permissions are fixed. |

## 3. Code Decision

No product-code edit was made in this rework because the working tree already contains the required ORCH-0915 and ORCH-0925 source contracts:

- `ticket-checkout-create/index.ts` parses `payment_plan_choice`, passes `p_payment_plan_choice`, and derives installment behavior from returned `session.installmentSchedule`.
- `checkoutIdempotencyKey` separates explicit `full` and `installments` sessions while preserving legacy `auto`.
- Native business checkout forwards `payment_plan_choice` from the trip payment screen.
- ORCH-0925 native installment code is correctly fatal when Customer/Ephemeral Key provisioning fails, because future off-session charges would otherwise be unrecoverable.

Using `STRIPE_SECRET_KEY` as a code fallback was rejected. Stripe best practice is to keep least-privilege restricted keys and add the missing permissions to the checkout RAK rather than broadening this payment path to a full secret key.

## 4. Required Operator Fix

Before another native live-fire retest, the operator/orchestrator must:

1. Update the test-mode `STRIPE_RAK_TICKET_CHECKOUT` restricted key in Stripe to include:
   - `rak_customer_read`
   - `rak_customer_write`
   - `rak_ephemeral_key_write`
   - existing PaymentIntent/Checkout permissions must remain.
2. Confirm the corresponding Supabase secret still points to the updated test-mode RAK.
3. Redeploy `ticket-checkout-create` from this ORCH worktree after authorization.

No DB push is needed for this rework. The remote RPC signature already has `p_payment_plan_choice`.

## 5. Verification Run This Turn

| Check | Result |
|---|---|
| `deno check supabase/functions/ticket-checkout-create/index.ts` | PASS |
| ORCH-0915 + ORCH-0925 Deno tests | PASS: 23 passed, 0 failed |
| ORCH-0915 trip payment/service Jest tests | PASS: 3 suites, 12 tests |
| Supabase deployed edge source readback | FAILS deployment parity: deployed version 103 is missing ORCH-0915 payment-choice code |
| Remote RPC signature probe | PASS: `p_payment_plan_choice text DEFAULT 'auto'` exists |
| Remote failed-session probe | CONFIRMED stale edge behavior: full retest sessions stored installment schedule and EUR 125.00 total |
| Stripe RAK customer search probe | FAIL: missing `rak_customer_read` |
| Stripe RAK customer create probe | FAIL: missing `rak_customer_write` |
| Stripe RAK ephemeral key probe | FAIL: missing `rak_ephemeral_key_write` |

## 6. Expected Retest Contract After Operator Fix

Native full selected:

- Edge receives `payment_plan_choice:"full"`.
- RPC returns `totalCents=50000` and `installmentSchedule=null`.
- PaymentIntent body uses `amount=50000`.
- No `mingla_installment_plan_root`.
- No `setup_future_usage`.
- No `customer`.
- PaymentSheet opens in guest mode.

Native installments selected:

- Edge receives `payment_plan_choice:"installments"`.
- RPC returns `totalCents=12500` and non-null schedule with `fullPriceCents=50000`.
- Customer search/create succeeds on the connected account.
- Ephemeral Key creation succeeds.
- PaymentIntent body uses `amount=12500`, `setup_future_usage:"off_session"`, `customer:<cus_...>`, and `metadata.mingla_installment_plan_root:"true"`.
- PaymentSheet opens with Customer attachment, but tester must not complete payment.

## 7. Transition Items

- This rework did not push, PR, merge, redeploy, apply migrations, or complete any payment.
- The forbidden iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6` was not touched.
- A temporary Stripe test-mode customer used only to probe ephemeral-key permission was deleted; no payment was created or completed.
- Route to orchestrator/operator first for the Stripe RAK permission update and authorized edge redeploy, then back to tester for native live-fire retest.
