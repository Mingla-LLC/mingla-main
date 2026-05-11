# DEPLOY REWORK ORCH-0777 - Persist-Failure Cancel Scope

Date: 2026-05-11
Owner: Codex `orchestrator-mingla`
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Mode: Deploy after focused TEST PASS
Verdict: **DEPLOY COMPLETE - checkout create bumped; confirmation dispatch redeploy command completed with no visible version bump**

## Plain-English Summary

The focused P2 fix for paid-checkout PaymentIntent cleanup passed independent TEST, so the deploy guard lifted for the two ORCH-0777 functions named by the QA return. Codex deployed only `ticket-checkout-create` and `ticket-confirmation-dispatch` to Supabase project `gqnoajqerqhnvulmnyvv`, then verified the active function list. `ticket-checkout-create` is now ACTIVE v9; `ticket-confirmation-dispatch` remains ACTIVE v7 in the function list after a successful deploy command, which indicates Supabase did not expose a new version bump for that unchanged bundle.

## Inputs

- `Mingla_Artifacts/reports/QA_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`
- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`

## Commands Run

```bash
/Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg 'ticket-checkout-create|ticket-confirmation-dispatch|scan-ticket|stripe-webhook|twilio-message-status'
```

## Deploy Evidence

| Function | Deploy command result | Active version after deploy | Updated at from function list |
| --- | --- | --- | --- |
| `ticket-checkout-create` | `Deployed Functions on project gqnoajqerqhnvulmnyvv: ticket-checkout-create` | ACTIVE v9 | `2026-05-11 02:47:14` |
| `ticket-confirmation-dispatch` | `Deployed Functions on project gqnoajqerqhnvulmnyvv: ticket-confirmation-dispatch` | ACTIVE v7 | `2026-05-10 22:18:44` |
| `twilio-message-status` | Not deployed in this step | ACTIVE v7 | `2026-05-10 22:18:50` |
| `scan-ticket` | Not deployed in this step | ACTIVE v8 | `2026-05-11 00:24:57` |
| `stripe-webhook` | Not deployed in this step | ACTIVE v12 | `2026-05-11 00:29:00` |

## Hard-Guard Compliance

- No database migration was applied.
- No Supabase secret value was read or printed.
- No Stripe Dashboard, Resend account, Twilio account, or provider configuration was mutated.
- No live-fire checkout, webhook replay, email send, SMS send, scanner probe, or buyer journey was run in this deploy step.
- No raw API key, Stripe client secret, QR pepper, QR payload, buyer status token, full phone number, or full provider SID was printed or artifacted.
- No product code was edited by this orchestrator deploy step.

## Required Next Gate

The operator must clear provider configuration before the full live-fire rerun:

- Resend: verify `RESEND_API_KEY` belongs to the intended account and `RESEND_TICKET_FROM` uses a verified domain/sender.
- Twilio: add the SMS/MMS sender to the Messaging Service that matches `TWILIO_ACCOUNT_SID`.

After provider cleanup, rerun `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` end to end. ORCH-0777 must not CLOSE until every prior `FAIL` and `NOT RUN` row is replaced with concrete PASS evidence. Any new code-side regression routes back to Codex `implementor-mingla` for a bounded follow-up dispatch.
