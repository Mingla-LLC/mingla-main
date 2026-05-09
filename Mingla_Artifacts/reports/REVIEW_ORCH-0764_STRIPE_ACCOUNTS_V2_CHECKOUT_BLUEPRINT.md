# REVIEW ORCH-0764: Stripe Accounts v2 + Checkout Blueprint

Date: 2026-05-08  
Mode: `$orchestrator`  
Reviewed artifacts:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`

## Plain-English Impact

This work is about making Mingla's paid ticketing chain real: organiser payout onboarding, buyer card checkout, Mingla platform fee capture, and durable QR ticket issuance after Stripe confirms payment. Without this, Mingla can show ticketing UI but cannot safely claim live paid GMV readiness.

## Process Finding

Due process was partially compressed.

Expected lifecycle:

`INTAKE -> FORENSIC INVESTIGATION -> ORCHESTRATOR REVIEW -> SPEC -> ORCHESTRATOR REVIEW -> IMPLEMENTATION`

Actual lifecycle:

`INTAKE -> FORENSIC INVESTIGATION + SPEC -> ORCHESTRATOR REVIEW`

No product code, Stripe data, Supabase data, or deployment state was mutated during the compressed step. The process defect is therefore recoverable by formally reviewing the returned investigation and spec before any implementation dispatch.

## Review Verdict

Approved for implementation dispatch, with orchestration correction:

- Do not dispatch as one giant implementation task.
- Split into two implementation prompts.
- Require ORCH-0764A to land before ORCH-0764B unless the user explicitly accepts parallel implementation risk.
- Keep the live application-fee policy as an explicit product/business decision before live mode, while allowing test/staging implementation through server-side fee configuration.

## Evidence Sufficiency

The investigation sufficiently proves:

- Current organiser onboarding does not satisfy the supplied Accounts v2 blueprint.
- Current onboarding uses Account Sessions/embedded onboarding, not Accounts v2 Account Links.
- Current buyer checkout is still local/stubbed.
- Current webhook routing does not handle `checkout.session.completed`.
- Current shared Stripe client pins an API version, conflicting with the user's blueprint instruction.
- Durable order/ticket schema exists but needs Checkout identifiers and fulfillment hardening.

The spec sufficiently defines:

- Required Stripe API operations and payload shape.
- Server-side account/link/checkout boundaries.
- Webhook fulfillment requirements.
- Migration requirements with a monotonic prefix greater than `20260515000004`.
- Regression tests for onboarding, checkout creation, webhook replay, and business app behavior.
- Runbook and secret placeholder updates.

## Required Implementation Split

### ORCH-0764A: Stripe Accounts v2 Hosted Onboarding

Purpose:

- Replace the current embedded/v1-style onboarding path for this blueprint with Accounts v2 account creation and hosted Account Links.
- Introduce the unpinned Stripe blueprint client boundary.
- Preserve existing auth, role, ToS, brand, and country gates.

Prompt:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING.md`

### ORCH-0764B: Stripe Checkout Session + Webhook Fulfillment

Purpose:

- Create server-side paid ticket Checkout Sessions.
- Add durable order/session/payment metadata.
- Fulfill paid orders and QR tickets from verified Stripe webhooks.
- Remove the paid online ticketing dependency on the local payment stub.

Prompt:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0764B_STRIPE_CHECKOUT_WEBHOOK_FULFILLMENT.md`

## Blocking Decisions

Not blocked for test/staging implementation:

- The live Mingla application fee can be implemented as server-side configuration with placeholders.

Blocked before live paid GMV:

- Product/leadership must choose the live fee policy. The blueprint's `application_fee_amount: 123` is an example and must not become Mingla's hard-coded fee.

## Orchestrator Decision

Proceed to user-controlled `$implementor` dispatch for ORCH-0764A first.

Do not close ORCH-0764 until:

- ORCH-0764A implementation report is reviewed.
- ORCH-0764A tester verification passes or accepted conditions are recorded.
- ORCH-0764B implementation report is reviewed.
- ORCH-0764B tester verification passes or accepted conditions are recorded.
- Supabase migration push/deploy requirements are satisfied under the standing deploy split.
- Runbooks and product readiness artifacts are synced.

