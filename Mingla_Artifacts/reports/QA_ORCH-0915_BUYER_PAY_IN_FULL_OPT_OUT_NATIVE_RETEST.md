# QA Retest - ORCH-0915 Buyer Pay-In-Full Opt-Out Native iOS PaymentSheet

**Date:** 2026-05-25  
**Tester:** Codex `tester` parity mirror  
**Mode:** RETEST after operational unblock  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]`  
**Branch:** `orch-0915-buyer-pay-in-full-opt-out`  
**Device used:** iPhone 17 Pro Max simulator, UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC`  
**Forbidden device guard:** iPhone 17 Pro simulator, UDID `17091E60-C3B6-4167-980D-60C348E177F6`, was not targeted by any retest command.  
**Verdict:** PASS

## Scope

This retest verifies the native iOS runtime contract in `SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` sections 4.1 and 4.2 after the operational unblock in `ORCH-0915_NATIVE_OPERATIONAL_UNBLOCK.md` section 6.

Required fixture:

| Field | Value |
|---|---|
| Trip id | `060d0483-50db-48d1-840b-73d9fc59356a` |
| Trip | `The DC Adventure` |
| Tier id | `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e` |
| Tier | `Standard` |
| Buyer email | `codex0915test3@example.com` |
| Full price | `EUR 500.00` |
| Payment plan | `EUR 125.00` deposit + 2 future installments |

## Evidence Files

| Required evidence | Local path | Result |
|---|---|---|
| Full branch payment screen | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-payment-full-retest.png` | Captured. Shows full option selected and CTA `Pay €500.00`. |
| Full branch Stripe PaymentSheet | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-stripe-paymentsheet-full-retest.png` | Captured. PaymentSheet opened at card-entry step with CTA `Pay €500.00`; no payment was completed. |
| Installment branch payment screen | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-payment-installments-retest.png` | Captured. Shows installment option selected and CTA `Pay €125.00 deposit`. |
| Installment branch Stripe PaymentSheet | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-stripe-paymentsheet-installments-retest.png` | Captured. PaymentSheet opened at card-entry step with CTA `Pay €125.00`; no payment was completed. |

## Runtime Stripe Contract

Supabase read-only session probe for `codex0915test3@example.com` found the two retest sessions created by this run.

| Branch | Checkout session | Session total | Session schedule | PaymentIntent | Stripe runtime shape | Verdict |
|---|---|---:|---|---|---|---|
| Full | `f686818b-bc92-4e66-b86b-88f9d3d0c384` | `50000` / `EUR` | `NULL` | `pi_3TamuJPjlZjiLhFt17nRtRGs` | Stripe CLI connected-account retrieve: `amount=50000`, `currency=eur`, `status=requires_payment_method`, `customer=null`, `setup_future_usage=null`, metadata contains `mingla_buyer_email` + checkout/session/event IDs and does not contain `mingla_installment_plan_root`; `payment_method_types=["card","link"]`. | PASS |
| Installments | `b3a34e55-9d02-4a8d-b875-f52225a818cb` | `12500` / `EUR` | Non-null schedule with `fullPriceCents=50000`, `depositCents=12500`, two future installments. | `pi_3Tamy3PjlZjiLhFt0FAsVIA1` | Stripe CLI connected-account retrieve: `amount=12500`, `currency=eur`, `status=requires_payment_method`, `customer=cus_UZwnVeWHODCiLt`, `setup_future_usage=off_session`, metadata includes `mingla_installment_plan_root=true`; `payment_method_types=["card"]`. | PASS |

Customer attachment proof: Stripe CLI connected-account retrieve for `cus_UZwnVeWHODCiLt` returned `email=codex0915test3@example.com` and metadata `mingla_origin=ticket_checkout_create_native`.

No session from this retest failed with `installment_customer_provisioning_failed`.

## Verification Commands

| Check | Result |
|---|---|
| Native deep link and UI smoke on allowed simulator only | PASS |
| `deno check supabase/functions/ticket-checkout-create/index.ts` | PASS |
| ORCH-0915 + ORCH-0925 edge-function Deno tests | PASS: 23 passed, 0 failed |
| `npx jest --runTestsByPath ...orch_0915... ticketCheckoutService.orch0915.test.ts --runInBand` | PASS: 3 suites, 12 tests |

## Guardrail Results

| Guard | Result |
|---|---|
| Do not complete Stripe payment | PASS. PaymentSheet was dismissed at card-entry step for both branches. Both PaymentIntents remain `requires_payment_method`. |
| Do not touch forbidden iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6` | PASS. All `xcrun simctl` and Maestro commands targeted `2C3312D9-EE52-4EBD-9704-15811D49A2EC`. |
| Do not push, PR, merge, or redeploy | PASS. This retest performed no GitHub push, no PR, no merge, and no Supabase deploy. |
| Stop if PaymentSheet fails with `installment_customer_provisioning_failed` | PASS. The failure did not recur. |

## Finding Update

| ID | Previous status | Updated status | Update |
|---|---|---|---|
| `QA-0915-005` | P1 Open | Closed by retest | Native iOS PaymentSheet now opens for both ORCH-0915 branches. Full-pay proves the €500 guest-mode, non-installment PaymentIntent; installment proves the €125 Customer-attached PaymentIntent with `setup_future_usage:"off_session"` and `mingla_installment_plan_root:"true"`. |

## Final Native iOS Decision

PASS. The native iOS live-fire retest proves SPEC sections 4.1 and 4.2 at runtime on the required iPhone 17 Pro Max simulator. ORCH-0915 is ready to return to orchestrator for full CLOSE protocol.
