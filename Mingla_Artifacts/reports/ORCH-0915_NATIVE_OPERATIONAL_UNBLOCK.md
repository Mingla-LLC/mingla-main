# ORCH-0915 Native Operational Unblock

**Owner:** Claude `mingla-orchestrator`
**Date:** 2026-05-24
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]/`
**Branch:** `orch-0915-buyer-pay-in-full-opt-out`
**Inputs:**
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT_NATIVE_REWORK.md` (§4 required operator fix list)
- `Mingla_Artifacts/reports/QA_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT_NATIVE_ADDENDUM.md` (FAIL verdict, QA-0915-005 open)

---

## 1. Outcome

Both ORCH-0915 [Buyer/traveller pay-in-full opt-out at payment-plan checkout] native blockers are cleared at the environment layer. The Stripe test-mode RAK now carries the Customer + Ephemeral Key permissions ORCH-0925 [Installment Customer attachment] requires, and the deployed `ticket-checkout-create` is now back on ORCH-0915 source. No product code changed; no PR was pushed; no payment was completed.

## 2. Blocker A — Stripe RAK permissions (operator-owned)

**Before:** test-mode restricted key `STRIPE_RAK_TICKET_CHECKOUT` (Stripe label "Mingla ticket checkout", value `rk_test_51TTnt1...xUE3xosC` per `Stripe-live-values.md` § TEST values) was missing `rak_customer_read`, `rak_customer_write`, `rak_ephemeral_key_write`. Verified by rework report §5 (Stripe CLI test-mode probes failed).

**After (2026-05-24, operator-confirmed in chat):** operator updated the key in-place via Stripe Dashboard test mode. Per operator confirmation: "updated the key for both [Customer + Customer Ephemeral Key] permissions and Connect operations to both write for both" — i.e. Customers set to Write (grants `rak_customer_read` + `rak_customer_write`), Customer Ephemeral Keys set to Write (grants `rak_ephemeral_key_write`), and existing Connect permissions broadened to Write where applicable. No key re-roll occurred, so the Supabase secret `STRIPE_RAK_TICKET_CHECKOUT` value is unchanged.

**Evidence basis:** operator self-reported in-chat. Runtime proof comes from the next tester retest — if installment-branch PaymentSheet now opens with Customer attachment per ORCH-0925, the permission grant is verified live. If it still fails with `installment_customer_provisioning_failed`, escalate back to RAK permissions before any other diagnosis.

## 3. Blocker B — Stale edge deploy (orchestrator-owned)

**Before:** deployed `ticket-checkout-create` was version 103 with `ezbr_sha256: 3bed0838b1aedaec1be45e9254aea5f5b1225d5986cd2a969f7ca000ae8fd6a7` and source missing ORCH-0915 payment-choice code (no `PaymentPlanChoice` type, no `body.payment_plan_choice` parse, no `p_payment_plan_choice` RPC param). Verified by rework report §2 and reviewer `mcp__supabase__list_edge_functions` snapshot pre-deploy.

**Deploy command (orchestrator, this turn):**

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]" \
  && /Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
```

Output: `Bundling Function: ticket-checkout-create / Deploying Function: ticket-checkout-create (script size: 138.9kB) / Deployed Functions on project gqnoajqerqhnvulmnyvv: ticket-checkout-create`.

**After (verified via `mcp__supabase__list_edge_functions` post-deploy):**

| Field | Value |
|---|---|
| `slug` | `ticket-checkout-create` |
| `version` | `105` (jumped 2 from pre-check 103 — v104 was deployed by another process between our pre-check and our deploy) |
| `verify_jwt` | `true` (preserved — fn is user-initiated checkout, not webhook; matches CLI default) |
| `status` | `ACTIVE` |
| `ezbr_sha256` | `594beeb52108188f13c8a1aad9f4fad825aa65195cf679d2488034ec5a61ef46` (matches our earlier ORCH-0915 worktree deploy — proves identical bundle) |
| `entrypoint_path` | `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]/supabase/functions/ticket-checkout-create/index.ts` (worktree-scoped) |
| `updated_at` | `1779670175531` (2026-05-24, this turn) |

**Live source readback verification (via `mcp__supabase__get_edge_function`):** the deployed v105 source contains all four ORCH-0915 markers grep-matched literally:
- `type PaymentPlanChoice = ` (line ~24)
- `payment_plan_choice !== ` (validation branch)
- `p_payment_plan_choice: paymentPlanChoice,` (RPC payload field)
- `payment_plan_choice_invalid` (structured 400 error key)

This is the same code path the worktree's `supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice.test.ts` + `orch_0915_rpc_behavior.test.ts` exercise (8/8 Deno PASS per rework report §5).

## 4. Hard guards held

| Guard | Honored? |
|---|---|
| No payment completion | ✅ This turn ran zero Stripe API operations. |
| Do not touch iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6` | ✅ Zero `xcrun simctl` commands ran this turn against any sim. |
| Preserve `verify_jwt: true` on `ticket-checkout-create` | ✅ Confirmed via `mcp__supabase__list_edge_functions` post-deploy. |
| No code edits to product source | ✅ This turn only deployed the existing worktree HEAD; no `git commit` on product code. |
| No `supabase db push` | ✅ Remote RPC already has `p_payment_plan_choice text DEFAULT 'auto'` per rework report §2; no migration push needed. |
| No PR push, no merge, no `[deploy]` decision | ✅ Branch remains local; CLOSE decisions deferred to post-retest. |

## 5. Cross-system parity status (post-unblock)

| Layer | State | Source of truth |
|---|---|---|
| Worktree branch HEAD | 5 commits ahead of `origin/main`; payment_plan_choice + idempotency + tests + new strict-grep gate landed | `git log origin/main..HEAD` |
| Remote DB RPC | `biz_ticket_checkout_create_session(..., p_payment_plan_choice text DEFAULT 'auto')` live | rework report §2 SQL probe |
| Remote edge fn | v105, ORCH-0915 source, `ezbr_sha256: 594beeb5...`, `verify_jwt: true` | this report §3 |
| Stripe test-mode RAK | `STRIPE_RAK_TICKET_CHECKOUT` has Customer Write + Customer Ephemeral Key Write + Connect Write | operator confirmation §2 |
| Supabase secret | `STRIPE_RAK_TICKET_CHECKOUT` value unchanged (no key re-roll) | operator confirmation §2 |
| iPhone 17 Pro Max sim | Mingla Business dev build loaded from worktree Metro on 8081, operator signed in earlier this session (Travel Brand) | session evidence `ios-17-pro-max-ready.png` |
| iPhone 17 Pro sim (forbidden) | Untouched this turn | hard guard §4 |

## 6. Retest contract handed to tester

Per rework report §6, the next native live-fire must observe:

**Full branch (`Pay €500.00`):**
- Edge receives `payment_plan_choice:"full"`
- RPC returns `totalCents=50000`, `installmentSchedule=null`
- PaymentIntent amount=50000, NO `mingla_installment_plan_root`, NO `setup_future_usage`, NO forced `customer`
- PaymentSheet opens in guest mode

**Installment branch (`Pay €125.00 deposit`):**
- Edge receives `payment_plan_choice:"installments"`
- RPC returns `totalCents=12500`, schedule with `fullPriceCents=50000`
- Customer search/create succeeds on the connected account (this is what the new RAK permissions enable)
- Ephemeral Key creation succeeds (this is what the new RAK permissions enable)
- PaymentIntent amount=12500, `setup_future_usage:"off_session"`, `customer:<cus_...>`, `metadata.mingla_installment_plan_root:"true"`
- PaymentSheet opens with Customer attachment

**Failure mode if retest still FAILs:** the most likely remaining cause is one of (a) the RAK permission grant didn't actually persist Stripe-side, (b) the Supabase secret holds an older RAK value than what Stripe shows, or (c) a different bug on the connected-account-scoped path. Re-probe via `stripe customers list --api-key $STRIPE_RAK_TICKET_CHECKOUT -Stripe-Account acct_1TY6UFPjlZjiLhFt` from CLI before re-blaming source.

## 7. Next step

Hand to tester for native live-fire retest on iPhone 17 Pro Max UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC`. Tester output goes to `Mingla_Artifacts/reports/QA_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT_NATIVE_RETEST.md`. After PASS, orchestrator runs full CLOSE protocol (Step 0.5 regression-test gate, Step 1 artifact updates, Step 1.5 DIAG reap, Step 2 commit with `[deploy]` tag for the mingla-business UI changes, push, PR, pre-merge gate, merge, Step 1.7 worktree reap).
