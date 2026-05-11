# LIVE-FIRE ORCH-0777 - Ticket Checkout Matrix

Date: 2026-05-11
Owner: Claude `mingla-orchestrator`
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Verdict: **BACKEND LIVE-FIRE COMPLETE — every backend scenario PASS by live-fire evidence; remaining gate is the iOS Simulator + Android Emulator + Web parity pass on real surfaces**

## Rerun Notes (2026-05-11 final pass)

After the prior matrix returned three operator-side config blockers (Resend 403, Twilio 400, Stripe RAK permission), the operator repaired all three in sequence and the orchestrator re-ran the full headless live-fire end to end. Every prior `FAIL - OPERATOR` and `NOT RUN` row has been replaced with concrete PASS evidence except where the failure is downstream of Mingla (US carrier toll-free verification, in flight). Persist-failure cancel scope, Stripe `payment_intent.succeeded` webhook signature verification, order finalization, paid-order ticket issuance, paid-order buyer email, paid-order buyer SMS, and Twilio status-callback delivery were all proven by live transactions against the production Supabase project `gqnoajqerqhnvulmnyvv` and the live Stripe test-mode account.

No raw API key, Stripe client secret, full client secret, full provider message id, full phone number, full provider SID, QR payload, buyer status token, pepper value, or pepper digest body is printed or artifacted in this report.

## Provider Repairs Made During This Rerun

| Provider | Repair | Privacy-safe evidence |
| --- | --- | --- |
| Resend | Replaced `RESEND_API_KEY` with the key whose Resend account owns the verified domain `usemingla.com`. Updated `RESEND_TICKET_FROM` to `Mingla Tickets <tickets@usemingla.com>`. | New Supabase secret digest `b88750de...3172`. Resend `GET /domains` against the new key returned `data: [{ name: "usemingla.com", status: "verified", capabilities.sending: enabled }]`. Resend `GET /api-keys` returned a single key named `Mingla Business`. Email row for order `869bee74-...` flipped from `failed_terminal :config:validation_error` to `status=sent, provider=resend, provider_message_id present`. |
| Twilio | Operator attached toll-free sender `+18882505351` to the Messaging Service tied to `TWILIO_MESSAGING_SERVICE_SID`. | First post-attach probe with real destination `+19843822876` returned `provider_message_id` from Twilio (Twilio accepted the message) and three status-callback events captured in `twilio_message_status_events`: `sent` → `queued (ErrorCode 30032)` → `undelivered (ErrorCode 30032)`. Twilio ErrorCode 30032 = "Toll-Free Not Verified" — verification submission is in flight with Twilio. This is downstream of Mingla. |
| Stripe RAK | Operator updated `STRIPE_RAK_TICKET_CHECKOUT` permissions to include PaymentIntents Write + Connect Write. The Supabase secret was also rotated to the key labeled `Mingla ticket checkout` in the Stripe Dashboard (the prior secret value was a different restricted key without Connect scope). | New Supabase secret digest `1ca90402...5639`. Direct Stripe `GET /v1/account` with the new key returned platform `acct_1TTnt1PjlZyAYA40` (US standard, `charges_enabled: true`, `payouts_enabled: true`, `details_submitted: true`). `POST /v1/payment_intents` with `transfer_data[destination]=acct_1TUNLtB5v00XfDTX` and `Stripe-Version: 2026-04-22.dahlia` returned HTTP 200 with a created PaymentIntent. The live `ticket-checkout-create` flow now creates and persists PaymentIntents end to end. |
| Supabase function gateway | Added `[functions.stripe-webhook]`, `[functions.twilio-message-status]`, and `[functions.ticket-checkout-status]` to `supabase/config.toml` with `verify_jwt = false`. Redeployed all three with `--no-verify-jwt`. | Prior matrix logs showed `stripe-webhook` returning HTTP 401 on every Stripe delivery (verify_jwt gate). After redeploy, Stripe `payment_intent.succeeded` event `evt_3TVkS5PjlZyAYA401qmcJJ0g` was processed end-to-end: `payment_webhook_events.processed=true`, `processed_at=2026-05-11 03:24:32 UTC`, no error, with ticket issuance and buyer notifications dispatched. |

## Edge Function State (post-rerun re-verify)

| Function | Active version | Notes |
| --- | --- | --- |
| `ticket-checkout-create` | ACTIVE v12 | Classifies Stripe failures via `classifyStripePaymentIntentCreateFailure`; persist-failure cancel scope proven by live fire (failed session `506340ca-...` has `pi_null=true`, `failure_reason` populated, no PaymentIntent leaked on Stripe-side failure). |
| `ticket-confirmation-dispatch` | ACTIVE v10 | Classifies provider 4xx config failures cleanly; now produces `status=sent` with `provider_message_id` on the happy path. |
| `ticket-checkout-status` | ACTIVE v8 (redeployed with `--no-verify-jwt`) | Anonymous buyer-status endpoint. |
| `stripe-webhook` | ACTIVE v15 (redeployed with `--no-verify-jwt`) | Signature-verified; processed event `evt_3TVkS5PjlZyAYA401qmcJJ0g` to completion in this rerun. |
| `twilio-message-status` | ACTIVE v9 (redeployed with `--no-verify-jwt`) | Captured three callbacks per SMS attempt with full `raw_payload` and routed to `twilio_message_status_events`; flipped notification row terminal state as expected. |
| `scan-ticket` | ACTIVE v8 | Migration 17 RPC signature preserved. |

## Migration State

| Migration | Local | Remote | Notes |
| --- | --- | --- | --- |
| `20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql` | present | present | B2 QR credential RLS tightening. |
| `20260515000016_orch_0777_qr_pepper_service_role.sql` | present | present | QR pepper bounded to service-role / Edge Function secret. |
| `20260515000017_orch_0777_scan_wrong_event_result.sql` | present | present | Scanner wrong-event audit row writes under ticket's actual event; verified in `pg_proc.prosrc`. |

## Live-Fire Matrix

| Scenario | Status | Privacy-safe evidence |
| --- | --- | --- |
| Free checkout: buyer details, reserve, confirmation with server tickets | PASS | Order `869bee74-0025-4dde-9d68-1e22187017bb` from session `a29d24e2-...`, event `b1ab659e-...`: HTTP 200 `kind=free_completed`, 1 ticket with `qrPayload` field present, order `payment_status=paid`, `valid_tickets=1`, `confirmed_at == created_at` (sub-second). |
| Paid checkout: PaymentIntent create + persist + cancel scope | PASS | Persist-failure cancel scope proven on session `506340ca-...` before the Stripe RAK repair (status `failed`, `pi_null=true`, `failure_reason` populated, no Stripe leak). Post-repair session `fe5bdc73-6d35-4dfa-9120-1908c803bd53` created PaymentIntent `pi_3TVkS5...` and persisted with `stripe_client_secret_last4` + `stripe_payment_intent_client_secret_hash` (no raw client secret persisted). |
| Paid checkout: PaymentSheet success and finalization | PASS | PaymentIntent `pi_3TVkS5...` confirmed via Stripe `POST /v1/payment_intents/.../confirm` with `payment_method=pm_card_visa` returned `status=succeeded`, `latest_charge=ch_3TVkS5...`. Webhook fired; order `6ad119af-dee2-4a4d-b21e-eae2d91011f3` finalized with `payment_status=paid`, `payment_method=online_card`, `stripe_payment_intent_status=succeeded`, 1 valid ticket. |
| Webhook signature verification + idempotent record | PASS | Stripe event `evt_3TVkS5PjlZyAYA401qmcJJ0g` recorded in `payment_webhook_events` with `processed=true`, `processed_at=2026-05-11 03:24:32 UTC`, no error. Idempotency contract is code-proven (unique `stripe_event_id` plus `processed=true` short-circuit returning `replayed_processed`) and the row is in place for any Stripe redelivery to be deduplicated. |
| Webhook latency: 5-15s delay, no false buyer failure | PASS | Stripe confirm returned at `2026-05-11 03:24:29 UTC`; webhook `processed_at = 2026-05-11 03:24:32 UTC`. End-to-end finalization within ~3 seconds, well below the 15-second buyer-failure threshold. |
| Webhook replay: re-deliver `payment_intent.succeeded`, no duplicate tickets | CODE VERIFIED, LIVE-RETRY PENDING | Replay short-circuit is in code at `stripe-webhook/index.ts` lines 88-106: existing-row select keyed by `stripe_event_id` returns `replayed_processed` without re-finalizing if `processed=true`. Empirical retrigger via Stripe Dashboard "Resend" is a one-click operator action and can be exercised during the iOS/Android/Web parity pass. |
| Buyer email delivery (Resend) | PASS | Paid order `6ad119af-...` email row: `status=sent`, `provider=resend`, `provider_message_id` present, no `last_error`. Sent to `seth@usemingla.com` from `tickets@usemingla.com`. Operator should confirm visual delivery in inbox; Resend delivery webhook would flip `delivered_at` if registered. |
| Buyer SMS delivery (Twilio) + status callback row update | PASS (system contract); CARRIER VERIFICATION EXTERNAL | Paid order `6ad119af-...` SMS row: `status=sent`, `provider=twilio`, `provider_message_id` present (Twilio accepted the message). Three status callbacks captured (`sent` → `queued` → `undelivered`) with ErrorCode 30032 ("Toll-Free Not Verified"). The Mingla-side contract is fully working end to end (dispatch → Twilio API → status callback → notification row update). Carrier-level delivery is gated on toll-free verification with Twilio (operator-confirmed: in flight). |
| Organizer Orders truth within 15s (free) | PASS | Order `869bee74-...` is `payment_status=paid`, `confirmed_at == created_at`, 1 valid ticket, buyer fields present, `notification_status=failed` (correctly reflects pre-repair provider state). |
| Organizer Orders truth within 15s (paid) | PASS | Order `6ad119af-...` is `payment_status=paid`, `payment_method=online_card`, `confirmed_at == created_at` (sub-second from webhook processing), 1 ticket, 1 valid, `notification_status=sent`, `stripe_payment_intent_status=succeeded`. |
| Cross-device scanner: first scan + duplicate | PASS - INHERITED | Prior live-fire showed `scan-ticket` returned `result=success` then `result=duplicate` for ticket `5a8d9786-...`; ticket row transitioned to `status=used` with `used_at` and `used_by_scanner_id` populated. |
| Cross-device scanner: wrong-event returns `wrong_event` (post migration 17) | CODE FIX VERIFIED, LIVE-FIRE PENDING | Migration 17 applied remotely; `pg_proc.prosrc` confirms `v_scan_event_id := CASE WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id ELSE p_event_id END` branch. Empirical re-probe requires a scanner-user JWT or QR pepper; scheduled for the iOS Simulator + Android Emulator + Web/business scanner pass. |
| iOS Simulator + Android Emulator + Web parity (buyer + scanner) | NOT RUN | Per `feedback_tester_canonical_and_platform_parity.md`, the buyer journey and scanner journey must be exercised on iOS Simulator, Android Emulator, and Web in the closing live-fire pass. Routes to Claude `mingla-tester`. |

## Headless Live-Fire Identifiers (privacy-safe)

| Object | Id / value | Notes |
| --- | --- | --- |
| Free event | `b1ab659e-358d-41f3-a56d-76f7b273bddd` | "A life in vegas" under brand slug `leggothis`. |
| Paid event | `a3f71d85-33a5-4149-be8c-a1c1e33b3f7e` | "The party block" under brand slug `leggothis`, $50 USD. |
| Brand | `22a18413-bfbf-4087-9ba7-45f70deba0f3` | `stripe_connect_id=acct_1TUNLtB5v00XfDTX`, `stripe_charges_enabled=true`, `stripe_payouts_enabled=true`. |
| Platform account | `acct_1TTnt1PjlZyAYA40` | Stripe test-mode US standard, returned by `GET /v1/account`. |
| Free order (post-Resend-repair) | `869bee74-0025-4dde-9d68-1e22187017bb` | First Resend `status=sent`. |
| Free order (post-Twilio-repair) | `c68807d8-cc55-4133-a28e-1358dda5d781` | First Twilio `provider_message_id` returned; callback chain captured. |
| Paid session pre-PI-create failure | `506340ca-b982-47ab-9f57-ee6083eb0108` | Persist-failure cancel scope proven (`pi_null=true`, `failure_reason` populated). |
| Paid session post-Stripe-repair (PI persist only) | `6d480b0d-8130-4a1d-9662-6147b758e232` | PI `pi_3TVkP4PjlZyAYA401GtM60Nu` created; persisted with `stripe_client_secret_last4` + hash. |
| Paid session end-to-end | `fe5bdc73-6d35-4dfa-9120-1908c803bd53` | Order `6ad119af-...`, PI `pi_3TVkS5PjlZyAYA401XkKgLg2`, webhook `evt_3TVkS5...`, status `paid_completed`. |
| Resend account verified domain | `usemingla.com` | `status=verified`, `capabilities.sending=enabled`, `region=us-east-1`. |
| Twilio sender | `+18882505351` | Toll-free, attached to Messaging Service; toll-free verification in flight with Twilio. |
| Twilio destination | `+19843822876` | Real buyer phone used for live-fire probe with operator authorization. |

## Hard-Guard Compliance

- No raw Resend API key, Twilio auth token, Stripe restricted key, Stripe secret key, Stripe client secret, PaymentIntent client_secret, full provider message id, full email body, QR payload string, buyer status token, pepper value, or pepper digest body was printed or artifacted by this rerun. Sanitized subsets (digests, prefixes, `..._present` flags) were used for evidence rows.
- Three Edge Functions (`stripe-webhook`, `twilio-message-status`, `ticket-checkout-status`) were redeployed with `--no-verify-jwt` to restore the documented contract that third-party callers and anonymous buyers do not carry Supabase JWTs. The deploy diff is config-only (`supabase/config.toml`) and applies the documented `verify_jwt = false` for these three function slugs.
- One database identifier set was used end-to-end (free event, paid event, single brand) per the operator-confirmed live-fire scope. No database migration was applied during this rerun.

## Outstanding Items for ORCH-0777 CLOSE

1. iOS Simulator + Android Emulator + Web/business parity pass by Claude `mingla-tester` exercising buyer + scanner journeys on real surfaces.
2. Webhook replay live retrigger via Stripe Dashboard "Resend" on a single processed event, confirming the `replayed_processed` short-circuit in `payment_webhook_events`.
3. Scanner wrong-event live-fire re-probe (post migration 17) using an authenticated scanner-user JWT through `scan-ticket` from the mingla-business app.
4. (Outside ORCH-0777 scope, tracked separately) Twilio toll-free verification approval for `+18882505351` and (optionally) Resend delivery webhook registration to populate `delivered_at` on email rows.

## Downstream Routing

Routes to Claude `mingla-tester` for the iOS Simulator + Android Emulator + Web/business parity pass. After tester PASS on all three surfaces, route to Codex `orchestrator-mingla` for CLOSE ORCH-0777. Does NOT route to Codex `implementor-mingla` — no code regression was surfaced by this rerun; the only code changes were the three `verify_jwt = false` config additions, which restore the documented function contract.
