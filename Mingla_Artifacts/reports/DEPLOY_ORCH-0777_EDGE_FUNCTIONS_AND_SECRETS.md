# DEPLOY ORCH-0777 - Edge Functions and Production Config

Status: deployed, partially verified - live-fire still blocked by two production config gaps  
Date: 2026-05-10  
Owner: Codex `implementor-mingla`

Superseded note (2026-05-10): this historical deploy report documents the
failed database-level QR pepper route only. The live runtime contract is now the
bounded service-role RPC argument path implemented in
`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`;
do not follow database-level Postgres configuration instructions from this
report.

## Scope

Deploy-only rework for ORCH-0777 against Supabase project `gqnoajqerqhnvulmnyvv`.
No product code, tests, or migrations were changed. This report covers the five
missing Edge Functions, required Supabase Edge Function secret presence, Stripe
webhook event subscription, and `app.qr_token_pepper` verification.

Inputs:

- `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`

## Pre-Deploy Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Deno check for five target functions | PASS | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/ticket-checkout-status/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts supabase/functions/twilio-message-status/index.ts supabase/functions/scan-ticket/index.ts` |
| Deno tests for five target function dirs | NO TEST MODULES | `/Users/sethogieva/.deno/bin/deno test ...` returned `error: No test modules found`; no test files exist in these function directories. |
| Pre-deploy function list | CONFIRMED GAP | `supabase functions list --project-ref gqnoajqerqhnvulmnyvv` showed the five ORCH-0777 functions absent before deploy. |

## Edge Function Deploy Receipts

Commands executed from `/Users/sethogieva/Desktop/mingla-main`:

```bash
/Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv --no-verify-jwt
/Users/sethogieva/bin/supabase functions deploy ticket-checkout-status --project-ref gqnoajqerqhnvulmnyvv --no-verify-jwt
/Users/sethogieva/bin/supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy twilio-message-status --project-ref gqnoajqerqhnvulmnyvv --no-verify-jwt
/Users/sethogieva/bin/supabase functions deploy scan-ticket --project-ref gqnoajqerqhnvulmnyvv --no-verify-jwt
```

Post-deploy verification:

| Function | Status | Version | Updated At UTC |
| --- | --- | ---: | --- |
| `ticket-checkout-create` | ACTIVE | 1 | 2026-05-10 22:18:30 |
| `ticket-checkout-status` | ACTIVE | 1 | 2026-05-10 22:18:36 |
| `ticket-confirmation-dispatch` | ACTIVE | 1 | 2026-05-10 22:18:44 |
| `twilio-message-status` | ACTIVE | 1 | 2026-05-10 22:18:50 |
| `scan-ticket` | ACTIVE | 1 | 2026-05-10 22:18:56 |
| `stripe-webhook` | ACTIVE | 5 | 2026-05-07 14:05:06 |

## Secrets Verification

Verification command used `supabase secrets list --project-ref gqnoajqerqhnvulmnyvv`
and recorded secret names only. Values were not printed in this report.

Four missing deploy-support secrets were set from locally available operator
material or generated values:

- `RESEND_TICKET_FROM`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_STATUS_CALLBACK_SECRET`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Current required-secret status:

| Secret | Status |
| --- | --- |
| `STRIPE_RAK_TICKET_CHECKOUT` | MISSING - BLOCKS PAID CHECKOUT |
| `STRIPE_RAK_WEBHOOK` | PRESENT |
| `RESEND_API_KEY` | PRESENT |
| `RESEND_TICKET_FROM` | PRESENT |
| `TWILIO_ACCOUNT_SID` | PRESENT |
| `TWILIO_AUTH_TOKEN` | PRESENT |
| `TWILIO_MESSAGING_SERVICE_SID` | PRESENT |
| `TWILIO_STATUS_CALLBACK_SECRET` | PRESENT |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | PRESENT |

Important: `STRIPE_SECRET_KEY` is present in Supabase secrets, but I did not copy
or alias it into `STRIPE_RAK_TICKET_CHECKOUT`. The target function explicitly
expects a restricted API key name, and substituting a broad secret key would
weaken the key-isolation contract.

## Stripe Webhook Verification

Stripe endpoint checked and updated:

- Endpoint: `we_1TUJaAPjlZyAYA40JfrGOZzW`
- Status: `enabled`
- Mode observed by Stripe CLI: `livemode=false`
- URL: `https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/stripe-webhook`

The endpoint now includes:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

Existing platform events preserved:

- `application_fee.created`
- `application_fee.refunded`

## QR Pepper GUC Verification

Read-only verification query against the linked production project returned:

```text
qr_token_pepper_status=missing value_length=0
```

I attempted to set a fresh 64-hex-character database-level value without
printing it:

```sql
alter database postgres set app.qr_token_pepper = '<generated strong secret>';
```

Supabase Management API rejected the write:

```text
ERROR: 42501: permission denied to set parameter "app.qr_token_pepper"
```

Result: the historical database-GUC route remained unconfirmed. That route is
superseded by
`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`,
which removes the SQL fallback dependency and uses the existing Edge Function
secret through a bounded service-role RPC argument.

Reference checked: Supabase's custom Postgres config docs state user-context
settings can be changed at role/database level, but this project rejected the
custom `app.*` setting through the available Management API role.

## Remaining Gates Before Live-Fire

1. Create/provide a least-privilege Stripe restricted API key for ticket checkout
   and set it as `STRIPE_RAK_TICKET_CHECKOUT` in Supabase Edge Function secrets.
2. Apply the bounded QR pepper migration and redeploy the affected Edge
   Functions from
   `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`.
3. Operator adjudicates B2: accept brand-team SELECT on `tickets.qr_code` as
   in-scope, or dispatch a tightening rework before live-fire.
4. Run the operator-assisted live-fire matrix from the retest report:
   free checkout, paid checkout, webhook latency, webhook replay, Resend,
   Twilio, organizer order surfaces, and cross-device scanner.

## Final Assessment

The original P0 Edge Function deploy gap is fixed: all five missing functions
are now deployed and ACTIVE on `gqnoajqerqhnvulmnyvv`. The Stripe webhook event
subscription gap is fixed for the available Stripe endpoint. The deployment is
not live-fire-ready because `STRIPE_RAK_TICKET_CHECKOUT` is still missing and
`app.qr_token_pepper` could not be set with the available credentials.
