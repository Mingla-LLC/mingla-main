# IMPLEMENTATION — ORCH-0956 [Stripe ops alerts → email]

**Status:** implemented and verified  
**Date:** 2026-05-25  
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0956-[stripe-ops-alerts-email]/`  
**Branch:** `ORCH-0956-stripe-ops-alerts-email`  
**Implementation commit:** `eedf32ea` (`Implement ORCH-0956 Stripe ops alert emails`)  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0956_STRIPE_OPS_ALERTS_EMAIL.md`

## Summary

ORCH-0956 replaces the two Stripe operator alert paths that previously used OneSignal push notifications with Resend email alerts:

1. `charge.dispute.created` now emails `STRIPE_DISPUTE_ALERT_EMAILS` with amount, brand name, reason, evidence due timestamp, dispute ID, and a Stripe Dashboard CTA.
2. `charge.dispute.closed` with `status: "lost"` now emails the same operator allowlist before preserving the existing `dispute_lost` AppsFlyer side-effect.
3. `charge.dispute.updated` remains quiet.
4. Stripe webhook signature failures now email `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` with signature prefix, timestamp, remediation guidance, and a Stripe webhooks dashboard CTA while preserving the invalid-signature HTTP 400 response.

No migration, Supabase secret write, Stripe Dashboard mutation, Supabase deploy, or client-surface change was performed.

## Diff Summary

### Created

- `supabase/functions/_shared/stripeOpsAlertEmail.ts`
  - Adds `sendOpsAlertEmail(input)` using `renderTransactionalEmail({ variant: "generic_notification" })`, `EMAIL_SENDERS.system`, `formatSenderHeader`, and direct Resend POSTs to `https://api.resend.com/emails`.
  - Normalizes recipients by trim + lowercase + dedupe + basic `@` filter.
  - Returns `{ attempted, succeeded, failed }`.
  - Missing `RESEND_API_KEY` warns and returns without throwing.
  - `@resend.dev` sandbox sender rejection remains a hard invariant before POST.

### Modified

- `supabase/functions/_shared/stripeDisputeHandlers.ts`
  - Replaced `dispatchNotification` DI with `sendOpsAlertEmail`.
  - Replaced `STRIPE_DISPUTE_ALERT_USERS` with `STRIPE_DISPUTE_ALERT_EMAILS`.
  - Added brand-name lookup from `brands.name`, with warning + `unknown brand` fallback.
  - Added `formatCurrencyAmount`.
  - Reworked `alertDisputeCreated`.
  - Added `alertDisputeLost` and wired it into `charge.dispute.closed && status === "lost"` before the existing AppsFlyer event.
  - Left `charge.dispute.updated` alert-free.

- `supabase/functions/stripe-webhook/index.ts`
  - Replaced `dispatchNotification` import with `sendOpsAlertEmail`.
  - Replaced `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` with `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS`.
  - Reworked `notifyWebhookSignatureFailure` to send operator email alerts and return the succeeded count.
  - Exported `stripeWebhookHandler` and guarded `serve(...)` behind `DENO_TESTING !== "1"` so the exported notification helper can be directly tested without starting a server. Runtime behavior is unchanged outside tests.

- `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts`
  - Mechanical `[TEST-MOD-APPROVED ORCH-0956]` effects mock rename from `dispatchNotification` to `sendOpsAlertEmail`.
  - Added T-01, T-02, and T-03.

- `supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts`
  - Reworked the ORCH-0953 source assertions into ORCH-0956 email assertions.
  - Added direct mocked-send coverage for T-04 and retained a source-level assertion that the invalid-signature branch returns HTTP 400.

## Spec Traceability

| Spec item | Result |
|---|---|
| Phase 7 step 1 — create `_shared/stripeOpsAlertEmail.ts` | Implemented. |
| Phase 7 step 2 — update `_shared/stripeDisputeHandlers.ts` | Implemented. |
| Phase 7 step 3 — update `stripe-webhook/index.ts` | Implemented. |
| Phase 7 step 4 — update dispute handler tests T-01/T-02/T-03 + effects mock rename | Implemented. |
| Phase 7 step 5 — add webhook signature-failure happy-path T-04 | Implemented. |
| Phase 7 step 6 — run Deno tests | Implemented; evidence below. |
| Phase 7 step 7 — run format/lint/check gates | Implemented; evidence below. |
| Phase 7 step 8 — T-05 through T-08 adversarial tests | Not implemented by design; reserved for tester. |
| Phase 7 step 9 — commit/push/PR | Local implementation commit created at `eedf32ea`; report commit follows this file. Push/PR status is recorded in the final chat. |

## Verification Evidence

### Targeted happy-path test run

Command:

```bash
DENO_TESTING=1 deno test --allow-env --allow-net --allow-read supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts
```

Result: **PASS** — `8 passed | 0 failed`.

Covered:

- T-01: `charge.dispute.created` sends operator email alert with rich subject/body/CTA and preserves `dispute_created` AppsFlyer event.
- T-02: `charge.dispute.closed` + `status: "lost"` sends operator email alert and preserves `dispute_lost` AppsFlyer event.
- T-03: `charge.dispute.updated` upserts without sending operator email alert.
- T-04: signature failure routes operator email alert via mocked `sendOpsAlertEmail` and preserves invalid-signature 400 branch.

### Stripe-scoped workflow gate plus ORCH-0956 tests

Command:

```bash
DENO_TESTING=1 SUPABASE_URL=https://example-test.supabase.co SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real STRIPE_WEBHOOK_SECRET=whsec_test STRIPE_WEBHOOK_SECRET_PLATFORM=whsec_test_platform STRIPE_WEBHOOK_SECRET_PREVIOUS= deno test --allow-env --allow-net --allow-read --no-check supabase/functions/_shared/__tests__/stripeIpAllowlist.test.ts supabase/functions/_shared/__tests__/stripeKycRemediation.test.ts supabase/functions/_shared/__tests__/stripeKycReminderSchedule.test.ts supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts
```

Result: **PASS** — `21 passed | 0 failed`.

### Deno check

Command:

```bash
deno check supabase/functions/stripe-webhook/index.ts supabase/functions/_shared/stripeDisputeHandlers.ts supabase/functions/_shared/stripeOpsAlertEmail.ts
```

Result: **PASS**.

### Format and lint

Commands:

```bash
deno fmt --check supabase/functions/_shared/stripeOpsAlertEmail.ts supabase/functions/_shared/stripeDisputeHandlers.ts supabase/functions/stripe-webhook/index.ts supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts
deno lint supabase/functions/_shared/stripeOpsAlertEmail.ts supabase/functions/_shared/stripeDisputeHandlers.ts supabase/functions/stripe-webhook/index.ts supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts
```

Result: **PASS** — `Checked 5 files` for each gate.

### Broad `_shared` suite note

Command:

```bash
DENO_TESTING=1 deno test --allow-env --allow-net --allow-read --no-check supabase/functions/_shared/__tests__/ supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts
```

Result: **FAIL, unrelated existing tests** — `214 passed | 3 failed`.

Failures were outside ORCH-0956 touched code:

- `supabase/functions/_shared/__tests__/bouncer.test.ts`
  - `ORCH-0678 T-03a`
  - `ORCH-0678 T-03b`
- `supabase/functions/_shared/__tests__/scorer.test.ts`
  - `T-31: ORCH-0597 — pre-OTA Brunch, Lunch & Casual alias still unions brunch + casual_food`

The Stripe-scoped workflow gate plus ORCH-0956 tests passed, so these failures are recorded as pre-existing/unrelated and not modified in this ORCH.

## ORCH-0840 Step 0.5 Fails-on-Revert Evidence

Implementation commit tested: `eedf32ea`.

Method: temporarily restored the two implementation source files to `eedf32ea^` while leaving the new ORCH-0956 tests in place, then ran the targeted test command. The branch was restored to `HEAD` immediately afterward and the targeted test command was rerun successfully.

Command:

```bash
DENO_TESTING=1 deno test --allow-env --allow-net --allow-read supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts
```

Expected/observed on revert: **FAIL**.

Failure evidence:

- T-01 failed at type-check because `sendOpsAlertEmail` does not exist in the reverted `DisputeHandlerEffects`.
- T-02 failed at type-check for the same missing `sendOpsAlertEmail` DI seam.
- T-03 failed at type-check for the same missing `sendOpsAlertEmail` DI seam.
- T-04 failed before runtime because the reverted signature-failure module lacks the new email helper/import shape and test seam.

Required lines:

- T-01 fails-on-revert verified at `eedf32ea`.
- T-02 fails-on-revert verified at `eedf32ea`.
- T-03 fails-on-revert verified at `eedf32ea`.
- T-04 fails-on-revert verified at `eedf32ea`.

Post-restore proof: targeted command rerun after restoring `HEAD` returned **PASS** — `8 passed | 0 failed`.

## Guardrail Confirmation

| Guard | Result |
|---|---|
| No migration writes | Confirmed; no files under `supabase/migrations/` changed. |
| No `supabase db push` | Confirmed; not run. |
| No edge-function deploy | Confirmed; not run. |
| No Supabase secret writes | Confirmed; not run. |
| No Stripe Dashboard mutation | Confirmed; not run. |
| No client code touched | Confirmed; no `app-mobile/`, `mingla-business/`, or `mingla-admin/` source files changed. |
| No out-of-scope `dispatchNotification` callers modified | Confirmed; only the two spec swap sites were changed. |
| T-05 through T-08 adversarial tests not written by implementor | Confirmed; reserved for tester. |

## Deviations

None from the implementation scope.

Verification note: `stripe-webhook/index.ts` now exposes `stripeWebhookHandler` behind a `DENO_TESTING` serve guard so the notification helper can be imported and mocked in T-04 without starting an edge-function server during tests. This is testability-only; production/runtime behavior remains `serve(stripeWebhookHandler)`.

## Deployment / Operations Notes

Orchestrator owns post-merge deploy:

```bash
supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv
```

Seth owns post-deploy secret updates:

- Add `STRIPE_DISPUTE_ALERT_EMAILS=seth@usemingla.com` or comma-separated operator allowlist.
- Add `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS=seth@usemingla.com` or comma-separated operator allowlist.
- Remove legacy `STRIPE_DISPUTE_ALERT_USERS` and `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` at his pace.

No `[deploy]` tag is needed at CLOSE because this is backend-only.

## Downstream Routing

Next: orchestrator review, then Claude `mingla-tester` adversarial tests T-05 through T-08 plus independent verification, then orchestrator CLOSE with `[TEST-MOD-APPROVED ORCH-0956]` in the commit subject and no `[deploy]` tag. After close/merge, orchestrator deploys `stripe-webhook`; Seth sets the two email allowlist env vars.
