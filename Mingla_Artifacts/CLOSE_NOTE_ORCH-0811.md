# ORCH-0811 — Ticket Pay button non-2xx regression (Stripe customer_update)

**Closed:** 2026-05-12
**Severity:** S0-critical (entire ticket purchase flow down in production)
**Class:** regression (introduced same day, 2026-05-12 10:12 EDT, commit `95d2061a` ORCH-0804)
**Pipeline:** INTAKE → INVESTIGATE (orchestrator code-trace) → IMPLEMENT (orchestrator, delegated) → DEPLOY → SMOKE PASS (operator live-fire) → CLOSE
**Verdict:** PASS — operator confirmed Pay flow works on live web checkout with Stripe test card.

## What was broken

Every buyer tap on **Pay** for a ticket returned the React Native "edge function returned non-2xx" error. The `ticket-checkout-create` edge function was calling `stripe.checkout.sessions.create()` with `customer_update: { address: "auto" }` alongside `customer_email`. Stripe rejects this combination — `customer_update` requires an existing `customer` id, and Mingla creates a fresh Customer per buyer from the email. Stripe error: *"You cannot use customer_update without setting customer."*

## Root cause

ORCH-0804 (Stripe Tax enablement, closed 2026-05-12 10:12 EDT) added the `customer_update` block to satisfy what was believed to be a Stripe Tax requirement for jurisdiction lookup. In fact, `automatic_tax: { enabled: true }` already triggers Checkout's auto-collect billing address behavior on new Customers — no `customer_update` needed. The strict-grep gate `orch-0804-stripe-tax-enabled-on-checkout` codified the broken pattern as a CI invariant (Check 3 required `customer_update: { address: "auto" }`), which would have blocked any fix attempt.

## Fix

1. `supabase/functions/ticket-checkout-create/index.ts:237-244` — removed `customer_update` block. `automatic_tax` + `liability.account=stripeAccountId` retained (the Stripe Tax invariant).
2. `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` Check 3 — inverted from "must contain `customer_update`" to "must NOT contain `customer_update` in active code lines" (comments stripped before scan).
3. Inline rationale comments updated in both files so future engineers do not re-add it.

## Verification

- Strict-grep gate: **PASS 6/6** (orchestrator, local run).
- Deploy: `ticket-checkout-create` version 33 → 34 on project `gqnoajqerqhnvulmnyvv` (`verify_jwt: true` preserved).
- Live-fire smoke: operator tapped Pay on production web checkout with Stripe test card 4242 4242 4242 4242 → Stripe Checkout page loaded cleanly.

## Root-cause class

`headless-QA-RPC-gap` — ORCH-0804 tester PASS was based on code-level review + mocked Stripe calls; the live `checkout.sessions.create` API call was never exercised against real Stripe. Codified prior in `feedback_headless_qa_rpc_gap.md`. This regression is the third documented instance of the pattern (after ORCH-0540 plpgsql wrappers, ORCH-0776D notification dispatcher). Tester memory `feedback_tester_canonical_and_platform_parity.md` already mandates live-fire smoke; the ORCH-0804 tester pass predates strict adherence to that mandate on Stripe-touching code.

## New systemic risk surfaced — STRICT-GREP-CODIFIES-BUG

The strict-grep gate `orch-0804-stripe-tax-enabled-on-checkout` Check 3 enshrined the broken parameter as a CI invariant. Had we fixed the code without also fixing the gate, every CI run would have failed and blocked the hotfix. Pattern to watch for in future strict-grep gates: **CI gates must enforce the API contract (what Stripe accepts), not the literal token shape that ORCH-NNNN happened to ship.** Logged in ROOT_CAUSE_REGISTER as a candidate invariant; no new ORCH yet — flag-and-track until a second instance appears.

## Files touched

- `supabase/functions/ticket-checkout-create/index.ts`
- `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs`

No DB migration. No native module change. No mobile bundle change. OTA-eligible.

## Next action

Operator commits with message provided in chat and publishes EAS OTA to iOS + Android. No further dispatch pending.
