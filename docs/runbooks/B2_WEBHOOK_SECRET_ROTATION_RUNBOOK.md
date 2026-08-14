# Stripe webhook signing-secret rotation

**Status:** operator runbook
**Scope:** the existing LIVE Connect and platform webhook endpoints only
**Owner:** a Stripe Dashboard and Supabase project administrator
**Security authority:** issue #2084 and Stripe's provider-native delayed-expiry contract

## Why this runbook exists

Each Stripe webhook endpoint and environment has its own signing secret. The LIVE Connect endpoint and LIVE platform endpoint both deliver to Mingla's production `stripe-webhook` function, but their secrets remain separate:

| Endpoint | Supabase slot |
|---|---|
| LIVE Connect | `STRIPE_WEBHOOK_SECRET` |
| LIVE platform | `STRIPE_WEBHOOK_SECRET_PLATFORM` |

Rotate **one endpoint at a time** with Stripe's provider-native delayed expiry. During the overlap Stripe signs each delivery with every still-valid secret, so the old Supabase value preserves continuity until the replacement reaches its exact slot. `STRIPE_WEBHOOK_SECRET_PREVIOUS` must remain absent; one generic fallback cannot safely own two endpoint identities.

Stripe can retry LIVE webhook deliveries for up to three days. That retry horizon is not permission to retain a compromised secret: the provider-native overlap is at most 24 hours and must be kept as short as practical. Stripe creates a fresh signature and timestamp for every retry.

## Hard safety rules

- Never place a signing value, digest, signature, request body, or authorization header in a command argument, shell history, issue, chat, log, screenshot, repository file, temporary file, or clipboard logger.
- Move replacement material only through an approved no-output channel or direct human entry outside captured automation.
- Record endpoint IDs, slot names, timestamps, status codes, and `MATCH`/`NO_MATCH` results only.
- Do not change endpoint URLs, event subscriptions, API versions, payment modes, checkout capabilities, worker flags, or unrelated Supabase secrets.
- A 2xx during overlap proves continuity, not new-only authority. Final acceptance requires post-expiry new-only delivery.
- Never rotate both LIVE endpoints concurrently.

## Preflight

1. Confirm the target account and mode are exactly `acct_1TU23… LIVE`.
2. Identify the exact target endpoint ID and whether it is Connect or platform.
3. Record the target Supabase slot and the sibling slot. Any endpoint/slot ambiguity is a stop.
4. Confirm `STRIPE_WEBHOOK_SECRET_PREVIOUS` is absent.
5. Capture names/status only for both endpoint slots and an in-memory digest for the sibling slot so unchanged-sibling proof is possible.
6. Review Stripe delivery attempts and production Edge/audit/inbox evidence from the applicable incident or maintenance window. An unexplained signature-valid receipt is an incident stop, not a clean rotation signal.
7. Confirm production capability and worker holds required by the active incident or release issue remain unchanged.

## Rotation procedure

Complete every step for one endpoint before beginning the other.

### 1. Start provider-native delayed expiry

In Stripe Workbench, open only the exact existing endpoint and roll its signing secret with the shortest delayed expiry that allows propagation, never more than 24 hours.

Do not change the Supabase slot first. While the old secret is still valid, Stripe includes a valid old-secret signature and the current deployment continues to verify deliveries.

### 2. Install the replacement in the exact slot

Transfer the replacement through the approved no-output path into only the target slot:

- Connect rotation updates only `STRIPE_WEBHOOK_SECRET`.
- Platform rotation updates only `STRIPE_WEBHOOK_SECRET_PLATFORM`.

Compare the replacement and hosted target in isolated process memory and emit only `MATCH` or `NO_MATCH` with the predeclared slot name. Prove the sibling slot's in-memory digest is unchanged. Wait for Supabase secret propagation without revealing either value.

### 3. Prove overlap continuity

Use Stripe's exact endpoint delivery view to send or resend a harmless provider-authentic event. Require:

- delivery to the exact endpoint returns 2xx;
- production signature verification succeeds;
- the event is processed or follows the idempotent replay path;
- no new order, ticket, QR, chat, receipt, refund, notification, split, release, payout, account, capability, or other value/fan-out is created by the verification event;
- the sibling endpoint and slot remain unchanged.

A delivery to the shared URL without exact endpoint identity is not sufficient evidence.

### 4. Wait for old-secret expiry

Keep monitoring the exact endpoint through the bounded provider overlap. Do not extend the overlap to Stripe's three-day retry horizon. Once the old secret is expired, it must never be restored or copied into another slot.

### 5. Prove post-expiry new-only delivery

After provider-confirmed old-secret expiry, resend a previously processed harmless event to the exact endpoint. Require 2xx, signature-valid idempotent replay, and zero new value/fan-out. This is the required **post-expiry new-only** proof.

Reconcile the provider delivery attempt one-to-one with the production Edge invocation, applicable IP-soft-fail audit row, and `payment_webhook_events` identity. A duplicate event ID alone does not prove provider origin.

### 6. Close this endpoint before rotating its sibling

Record only:

- endpoint ID and Connect/platform class;
- target slot name;
- roll, propagation, old-expiry, and proof timestamps;
- target `MATCH`, sibling unchanged, delivery status, and idempotent/no-value booleans;
- any safe request/event IDs needed for review.

Only after this endpoint has post-expiry new-only proof may the sibling rotation begin from a fresh preflight.

## Rollback and failure

Before old-secret expiry, if the replacement-to-slot digest or continuity proof fails, restore only the target slot's still-valid old value through the no-output channel. Do not touch the sibling slot, do not extend expiry, and do not rotate the second endpoint.

After old-secret expiry, never resurrect the compromised value. Correct the replacement mapping or roll a fresh signing secret, then repeat the new-only proof.

Any unexplained direct receipt, wrong account/endpoint, sibling-slot change, persistent signature failure, missing log retention, or unexpected value/fan-out is a security escalation. Preserve safe IDs and timestamps, keep production activation holds dark, and follow the active incident specification; this runbook does not authorize repair or broader provider changes.

## Post-rotation verification

- [ ] Both endpoint rotations were sequential, never overlapping each other.
- [ ] `STRIPE_WEBHOOK_SECRET_PREVIOUS` remains absent.
- [ ] Each old secret is provider-terminal.
- [ ] Each endpoint has exact post-expiry new-only 2xx proof.
- [ ] Every accepted receipt in the review interval reconciles one-to-one to a provider attempt or is escalated.
- [ ] No unexplained signature-failure spike or value/fan-out exists.
- [ ] Production capabilities, worker flags, payment modes, endpoint URLs, and event subscriptions are unchanged.

Provider references: [Stripe webhook verification and retries](https://docs.stripe.com/webhooks) and [Workbench event deliveries](https://docs.stripe.com/workbench/event-destinations).
