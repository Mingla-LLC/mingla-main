# QA Native Addendum - ORCH-0915 Buyer Pay-In-Full Opt-Out

**Date:** 2026-05-24  
**Tester:** Codex `tester` parity mirror  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]`  
**Branch:** `orch-0915-buyer-pay-in-full-opt-out`  
**Device used:** iPhone 17 Pro Max simulator, UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC`  
**Forbidden parallel device not touched:** iPhone 17 Pro simulator, UDID `17091E60-C3B6-4167-980D-60C348E177F6`  
**Verdict:** FAIL

**Retest update:** Re-ran after operator reverted Stripe back to test mode. Result remains FAIL.

## Scope

This addendum retests open finding `QA-0915-001` from `Mingla_Artifacts/reports/QA_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` by running the native iOS trip checkout on the already-booted iPhone 17 Pro Max simulator.

Inputs read before execution:

- `Mingla_Artifacts/specs/SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` sections 2 and 4.
- `Mingla_Artifacts/reports/QA_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`, including open `QA-0915-001`.
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`, including the Stripe shape statements around the native path.

## Fixture

| Field | Value |
|---|---|
| Trip id | `060d0483-50db-48d1-840b-73d9fc59356a` |
| Trip | `The DC Adventure` |
| Brand | `travelbrand` |
| Tier id | `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e` |
| Tier | `Standard` |
| Full price | `EUR 500.00` |
| Installment plan | `EUR 125.00` deposit + 2 future installments |

## Evidence Files

| Required evidence | Local path | Result |
|---|---|---|
| Full branch payment screen | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-payment-full.png` | Captured. Shows full option selected, CTA `Pay €500.00`, and full-pay copy. |
| Full branch Stripe PaymentSheet | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-stripe-paymentsheet-full.png` | Captured failure state. PaymentSheet did not open; UI showed `installment_customer_provisioning_failed`. |
| Installment branch payment screen | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-payment-installments.png` | Captured. Shows installment option selected, CTA `Pay €125.00 deposit`, and payment-plan copy/schedule. |
| Installment branch Stripe PaymentSheet | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-stripe-paymentsheet-installments.png` | Captured failure state. PaymentSheet did not open. Accessibility evidence confirms `installment_customer_provisioning_failed` after the tap. |
| Accessibility evidence after installment tap | `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-accessibility-after-installment-tap.txt` | Captured. Contains the visible payment controls plus the error label. |

## Runtime Observations

| Tap | Expected by SPEC section 4 | Observed runtime result | Stripe shape verdict |
|---|---|---|---|
| Full branch, CTA `Pay €500.00` | Native PaymentIntent amount `50000`, no `mingla_installment_plan_root`, no `setup_future_usage`, no installment-only Customer requirement. | PaymentSheet did not open. The app displayed `installment_customer_provisioning_failed` on the full-pay-selected screen. | FAIL. The native full path did not prove a single full-price PaymentIntent; the edge/native flow reached the installment customer-provisioning failure path instead of guest/full PaymentSheet. |
| Installment branch, CTA `Pay €125.00 deposit` | Native PaymentIntent amount `12500`, Customer attachment per ORCH-0925, `setup_future_usage:"off_session"`, installment metadata. | PaymentSheet did not open. After the tap, accessibility hierarchy contained `installment_customer_provisioning_failed`. | FAIL. The native installment path did not prove a deposit PaymentIntent or metadata/Customer attachment because Customer provisioning failed before PaymentSheet presentation. |

No Stripe payment was completed. No PaymentSheet card-entry step was reached.

## Retest After Stripe Test-Mode Revert

| Check | Result |
|---|---|
| Environment claim | Operator stated the temporary Stripe live-production test was reverted back to test mode before this retest. |
| Device guard | Continued on iPhone 17 Pro Max UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC` only. |
| Fresh flow | Re-opened `mingla-business://checkout-trip/060d0483-50db-48d1-840b-73d9fc59356a`, selected 1 x Standard, and used fresh buyer details with email `codex0915test2@example.com`. |
| Full branch retest | Full branch still showed the correct `Pay €500.00` UI, but tapping the CTA did not open PaymentSheet. The screen showed `installment_customer_provisioning_failed`; screenshot overwritten at `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-stripe-paymentsheet-full.png`. |
| Installment branch retest | Installment branch still showed the correct `Pay €125.00 deposit` UI, but tapping the CTA did not open PaymentSheet. The accessibility evidence still contains `installment_customer_provisioning_failed`; screenshot overwritten at `Mingla_Artifacts/evidence/orch-0915-live-fire/ios-stripe-paymentsheet-installments.png`. |
| Payment completion guard | No card entry was reached and no Stripe payment was completed. |

Retest conclusion: reverting Stripe back to test mode did not clear the native failure. `QA-0915-005` remains P1 Open.

## Finding Update

| ID | Previous status | Updated status | Update |
|---|---|---|---|
| `QA-0915-001` | P2 Open | Closed as executed; replaced by `QA-0915-005` | Native iOS live-fire was no longer blocked by Metro/device availability. The run completed on the required iPhone 17 Pro Max UDID, but it failed before PaymentSheet presentation. |
| `QA-0915-005` | New | P1 Open | Native iOS PaymentSheet cannot be presented for the ORCH-0915 trip checkout. Full-pay selected state shows the correct €500 UI but tapping it returns `installment_customer_provisioning_failed`, which violates SPEC section 4.1 because the full branch must not require installment Customer provisioning. Installment selected state shows the correct €125 deposit UI but also fails before PaymentSheet, so SPEC section 4.2 remains unproven at runtime. |

## Updated Parity Matrix Row

| Required Surface | Previous Verdict | Updated Verdict | Notes |
|---|---|---|---|
| Business iOS | BLOCKED | FAIL | Runtime gate executed on iPhone 17 Pro Max UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC`. The UI branch states are correct, but native PaymentSheet presentation fails before card entry for both full and installment branches. |

## Final Native iOS Decision

FAIL. ORCH-0915 cannot proceed to CLOSE from native iOS evidence because the required PaymentSheet runtime contract was not proven and the full-pay branch specifically surfaced an installment-customer provisioning failure.
