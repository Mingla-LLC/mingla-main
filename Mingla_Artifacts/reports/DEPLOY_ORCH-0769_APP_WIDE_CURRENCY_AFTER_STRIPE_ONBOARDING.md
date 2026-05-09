# Deploy: ORCH-0769 app-wide currency after Stripe onboarding

**Date:** 2026-05-09
**Status:** DB migration applied; touched edge functions deployed; business app/runtime proof pending.

## DB Push

Operator reported `supabase db push` completed successfully after two migration rework fixes.

Remote migration verification:

```text
20260515000009 | 20260515000009 | 2026-05-15 00:00:09
```

Verified with:

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

## Pre-Deploy Gates

Passed:

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-refresh-status/index.ts
/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-balances/index.ts
```

Both commands exited 0.

## Edge Function Deploys

Deployed:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-refresh-status --project-ref gqnoajqerqhnvulmnyvv
```

Result:

```text
Deployed Functions on project gqnoajqerqhnvulmnyvv: brand-stripe-refresh-status
```

Deployed:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-balances --project-ref gqnoajqerqhnvulmnyvv
```

Result:

```text
Deployed Functions on project gqnoajqerqhnvulmnyvv: brand-stripe-balances
```

## Remaining Gates

- Business app JS/TS deploy or OTA is still required for client-side currency propagation changes.
- Independent tester verification is still required with `prompts/TESTER_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`.
- Runtime proof is still required for at least one non-GBP Stripe/default-currency fixture, including visible currency on Home, Events, public pages, checkout/order/door/refund/reconciliation/finance/export surfaces.

## Close Status

ORCH-0769 is not close-ready. Current next lifecycle gate remains `$tester`.
