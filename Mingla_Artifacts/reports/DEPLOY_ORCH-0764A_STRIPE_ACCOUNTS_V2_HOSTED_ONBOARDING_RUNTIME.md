# DEPLOY ORCH-0764A: Stripe Accounts v2 Hosted Onboarding Runtime

Date: 2026-05-08  
Mode: authorized deploy  
Status: deployed, awaiting tester runtime retest

## Scope

Deployed the two edge functions required by the accepted ORCH-0764A runtime rework:

- `brand-stripe-onboard`
- `brand-mingla-tos-accept`

No DB migration was involved.

## Pre-Deploy Gates

Focused Supabase tests:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Result:

- PASS
- 6 passed
- 0 failed

Focused Supabase check:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts
```

Result:

- PASS
- command exited 0 with no diagnostics.

Forbidden-string sweep:

```bash
rg -n "STRIPE_API_VERSION|apiVersion:|Stripe-Version|stripe\\.accounts\\.create|accountSessions\\.create|connect-onboarding\\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

Result:

- Product path clean.
- Matches only intentional negative assertions in `supabase/functions/brand-stripe-onboard/index.test.ts`.

## Deploy Commands

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

Result:

- Bundled function `brand-stripe-onboard`
- Deployed successfully to project `gqnoajqerqhnvulmnyvv`

```bash
/Users/sethogieva/bin/supabase functions deploy brand-mingla-tos-accept --project-ref gqnoajqerqhnvulmnyvv
```

Result:

- Bundled function `brand-mingla-tos-accept`
- Deployed successfully to project `gqnoajqerqhnvulmnyvv`

## Post-Deploy Metadata

Command:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg "brand-stripe-onboard|brand-mingla-tos-accept"
```

Observed:

- `brand-stripe-onboard` ACTIVE version `6`, updated `2026-05-08 21:27:51`
- `brand-mingla-tos-accept` ACTIVE version `4`, updated `2026-05-08 21:27:58`

## Remaining Gate

Dispatch tester with:

- `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`

Expected output:

- `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`

Tester must prove:

- repeat ToS acceptance no longer returns generic HTTP 500,
- deployed `brand-stripe-onboard` returns `client_secret: null`,
- deployed `brand-stripe-onboard` returns a Stripe-hosted `onboarding_url`,
- no `/connect-onboarding` runtime path is returned,
- `STRIPE_RAK_ONBOARD` Accounts v2/account-link scope works or the exact permission failure is captured without secrets,
- ORCH-0764B checkout remains gated until account readiness is proven.
