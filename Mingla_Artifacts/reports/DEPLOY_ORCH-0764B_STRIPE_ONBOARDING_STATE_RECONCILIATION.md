# DEPLOY ORCH-0764B — Stripe Onboarding State Reconciliation

## Verdict

Deployment gate cleared for tester dispatch.

## Operator Confirmation

Operator reported `supabase db push` was run.

Codex verified the linked remote migration list:

```text
20260515000007 | 20260515000007 | 2026-05-15 00:00:07
```

Migration now remote-applied:

- `supabase/migrations/20260515000007_orch_0764b_stripe_status_derivation_parity.sql`

## Edge Functions Deployed

Commands run:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy brand-stripe-refresh-status --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy brand-mingla-tos-accept --project-ref gqnoajqerqhnvulmnyvv
```

Results:

- `brand-stripe-onboard`: deployed, no change found, ACTIVE version `9`
- `brand-stripe-refresh-status`: deployed, ACTIVE version `5`
- `brand-mingla-tos-accept`: deployed/no change found, ACTIVE version `4`

Function list verification:

```text
brand-stripe-onboard        ACTIVE  9
brand-stripe-refresh-status ACTIVE  5
brand-mingla-tos-accept     ACTIVE  4
```

## Next Gate

Dispatch:

- `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`

Tester should verify:

1. Remote migration `20260515000007` remains present.
2. Fresh runtime uses the deployed edge functions.
3. Payments screen no longer shows contradictory cached/live Stripe states.
4. Actionable restricted KYC opens Mingla Account Link continuation.
5. `requirements.past_due` maps to `More information needed`, not `Stripe couldn't verify`.
6. `/stripe-onboarding-return` remains available in the web bundle/deploy path.
