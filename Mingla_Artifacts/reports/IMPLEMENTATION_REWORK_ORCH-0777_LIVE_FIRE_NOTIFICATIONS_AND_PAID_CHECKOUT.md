# Implementation Report: ORCH-0777 Live-Fire Notifications, Paid Checkout, And Scanner Wrong-Event

> Date: 2026-05-11  
> Owner: Codex `implementor-mingla`  
> Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)  
> Status: **implemented, partially verified**  
> Source prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`

## 1. Executive Summary

ORCH-0777 free checkout already issued server tickets, but live-fire still failed buyer delivery, paid checkout creation, and scanner wrong-event handling. This rework keeps all sensitive values out of code, logs, and artifacts while adding sanitized provider/Stripe error contracts, making paid checkout fail with structured JSON instead of a bare HTTP 500, and adding a migration so wrong-event scans return the clean `wrong_event` result instead of tripping the `scan_events` ticket/event trigger.

The code and static regression gates pass. The status remains partial because one database migration must be pushed and changed Edge Functions must be redeployed before the live-fire matrix can prove provider delivery, paid PaymentIntent persistence, and scanner wrong-event behavior in production.

## 2. Scope And Guards

| Area | In scope | Result |
| --- | --- | --- |
| Resend buyer email `resend_send_failed:403` | Prove code/config class, improve failure contract | Classified as provider auth/domain/sender configuration class; non-2xx responses now store sanitized terminal/retryable detail. |
| Twilio buyer SMS `twilio_send_failed:400` | Prove code/config class, improve failure contract | Classified as Messaging Service/account/sender-pool configuration class; 400/401/403 send failures now become terminal without retry loops. |
| Paid checkout HTTP 500 | Fix bare 500 before PaymentIntent persistence | Stripe client/create failures now return structured JSON and mark the checkout session failed when no PaymentIntent was persisted. |
| Scanner wrong-event HTTP 400 `scan_failed` | Return clean `wrong_event` | Added migration `20260515000017_orch_0777_scan_wrong_event_result.sql` so wrong-event audit rows satisfy the ticket/event trigger. |
| QR pepper / B2 RLS | Hard guard only | Not reopened or weakened. |

Hard guards preserved: no secret values, pepper values or digests, buyer tokens, client secrets, QR payloads, full phone numbers, provider SIDs, or API keys were printed or artifacted. The superseded database-level QR pepper/GUC route was not used. `STRIPE_RAK_TICKET_CHECKOUT` isolation was not weakened.

## 3. Root Cause Verdicts

| Slice | Verdict | Evidence | Fix / next action |
| --- | --- | --- | --- |
| Resend email `403` | External provider configuration class, not request-construction code. | `ticket-confirmation-dispatch` already sends `Authorization: Bearer <RESEND_API_KEY>` and JSON `from/to/subject/html`; a provider 403 means Resend refused the authenticated send, commonly from API key/account/domain/sender permission mismatch. | Code now stores sanitized `resend_send_failed:<status>:config[:safe_code]` and marks 400/401/403 terminal. Operator must verify Resend key/account and verified sender/domain. |
| Twilio SMS `400` | External Twilio Messaging Service/account/sender configuration class. | The send path uses Basic auth and `MessagingServiceSid`; live-fire saw a provider 400 class. Prompt evidence names the terminal provider cause as a Messaging Service with no phone numbers. | Code now stores sanitized `twilio_send_failed:<status>:config[:safe_code]` and marks 400/401/403 terminal. Operator must attach/verify a production-capable sender pool under the matching account/service. |
| Paid checkout bare HTTP 500 | Code-owned error handling gap around Stripe client/PaymentIntent creation; underlying Stripe provider cause was hidden by the old bare response. | `stripe.paymentIntents.create(...)` previously executed outside a local handler, so SDK/env/restricted-key/account errors could escape as non-JSON HTTP 500 and leave sessions in `requires_payment` without `stripe_payment_intent_id`. | `ticket-checkout-create` now catches Stripe create failures, persists sanitized `failure_reason`, marks the session `failed` only when no PaymentIntent exists, and returns JSON `payment_intent_create_failed`. |
| Scanner wrong-event `scan_failed` | Database write-order/constraint mismatch in `biz_ticket_scan`. | The RPC set `v_scan_result := 'wrong_event'` but inserted `scan_events.event_id = p_event_id` with the real ticket id; trigger `biz_scan_events_enforce_ticket_event` rejected that mismatch. | New migration writes wrong-event audit rows under `v_ticket.event_id` while preserving `requestedEventId` in metadata and returning `result: wrong_event`. |

## 4. Files Changed

| File | Change |
| --- | --- |
| `supabase/functions/_shared/ticketCheckout.ts` | Added sanitized notification-provider and Stripe PaymentIntent-create failure classifiers. |
| `supabase/functions/ticket-confirmation-dispatch/index.ts` | Uses provider classifier for Resend/Twilio non-2xx responses and marks non-retryable provider config/auth failures terminal. |
| `supabase/functions/ticket-checkout-create/index.ts` | Wraps Stripe PaymentIntent creation, stores sanitized failed session state, returns structured JSON errors, and keeps the Stripe client available for cleanup if persistence fails. |
| `supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql` | Replaces `biz_ticket_scan` with wrong-event-safe scan event insertion. |
| `supabase/functions/_shared/__tests__/ticketCheckout.test.ts` | Adds Deno regression coverage for provider and Stripe failure classification. |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` | Adds ORCH guard coverage for structured failures and wrong-event migration contract. |

## 5. Regression Tests And Verification

| Gate | Command | Result |
| --- | --- | --- |
| Deno helper tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts` | PASS: 4 passed, 0 failed. |
| Required Edge Function check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts supabase/functions/twilio-message-status/index.ts supabase/functions/scan-ticket/index.ts supabase/functions/stripe-webhook/index.ts` | PASS: exit 0. |
| ORCH-0777 repo gate | `PATH="/opt/homebrew/Cellar/node/25.9.0_3/bin:$PATH" /opt/homebrew/bin/npm run test:orch-0777` from `mingla-business/` | PASS: strict grep passed; Jest 4 suites / 12 tests passed; `tsc --noEmit` passed. |
| Whitespace | `git diff --check` | PASS: no output. |
| Migration ordering | `ls supabase/migrations | tail -10`; `git ls-tree origin/main supabase/migrations/ | tail -5` | PASS: new local migration prefix `20260515000017` is greater than the local max `20260515000016`; `origin/main` tail is lower than local max. |

Watchman emitted a recrawl warning during Jest, but the Jest suites still passed. Plain `npm` was not relied on; the Homebrew Node/npm path was used for the ORCH gate.

## 6. Deploy Needs

| Need | Required before live-fire rerun | Why |
| --- | --- | --- |
| Database migration push | `supabase db push` for `20260515000017_orch_0777_scan_wrong_event_result.sql` | Production `biz_ticket_scan` must be replaced before wrong-event can return cleanly. |
| Redeploy `ticket-checkout-create` | Yes, after TEST pass and merge/close gate | Paid checkout structured error handling lives in this Edge Function. |
| Redeploy `ticket-confirmation-dispatch` | Yes, after TEST pass and merge/close gate | Resend/Twilio sanitized terminal/retryable classification lives in this Edge Function. |
| Redeploy `scan-ticket`, `twilio-message-status`, `stripe-webhook` | Not for this code change | Checked for type safety; not changed. |

Standing split preserved: implementor did not mutate live Supabase secrets, push migrations, deploy Edge Functions, or change provider configuration.

## 7. Config-Only Operator Checklist

Resend:

- Verify `RESEND_API_KEY` belongs to the intended Resend account/environment and has send permission.
- Verify `RESEND_TICKET_FROM` uses a verified sender/domain accepted by that account.
- Send the live-fire email retest without pasting API keys, full recipient data, or provider-sensitive payloads into artifacts.

Twilio:

- Verify `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID` belong to the same Twilio account/environment.
- Add or verify at least one production-capable SMS/MMS sender, or approved messaging sender with fallback, in the Messaging Service sender pool.
- Confirm the sender can message the buyer destination country. Do not artifact full phone numbers, auth tokens, or full SIDs.

Stripe:

- After redeploy, rerun paid checkout and capture only sanitized JSON `error/detail` if it fails.
- Verify `STRIPE_RAK_TICKET_CHECKOUT` can create PaymentIntents with automatic payment methods and destination-charge `transfer_data[destination]` for the selected connected account and event currency.
- Verify the connected account is the expected account and is charge-ready.

## 8. Remaining Risks And Manual Gates

| Risk | Why it remains | Exit condition |
| --- | --- | --- |
| Resend/Twilio delivery still blocked | Provider configuration cannot be repaired from repo code. | Live-fire rows reach provider-accepted/sent states after operator config correction. |
| Paid provider root cause not fully proven | Old runtime hid the Stripe SDK error behind non-JSON 500. | Post-redeploy paid checkout either persists `stripe_payment_intent_id` or returns sanitized structured detail identifying the provider/config class. |
| Scanner wrong-event not live-applied | Migration is repo-verified but not pushed here. | Migration `20260515000017` is applied remotely and live wrong-event returns HTTP 200 `wrong_event`. |
| Full ORCH-0777 close remains blocked | Webhook, organizer truth, paid PaymentSheet, and provider delivery depend on deploy/config/live-fire. | Downstream TEST passes, then orchestrator reruns the full live-fire matrix and records full PASS. |

## 9. Downstream Route

Route next to Claude `mingla-forensics` TEST mode to independently verify this implementation report and the changed files. After TEST pass, route to Codex `orchestrator-mingla` to coordinate database push, approved Edge Function redeploy, provider config operator gates, full live-fire rerun, and CLOSE only after full PASS.
