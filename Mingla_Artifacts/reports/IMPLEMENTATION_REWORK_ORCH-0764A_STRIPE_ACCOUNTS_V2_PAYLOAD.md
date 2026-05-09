# IMPLEMENTATION REWORK ORCH-0764A: Stripe Accounts v2 Payload

Date: 2026-05-08  
Mode: `$implementor`  
Status: `implemented and verified locally; operator RAK fix still required`

## Summary

Implemented the code-side fix proven by direct Stripe probes: Mingla's Accounts v2 account-create payload now requests `configuration.merchant.capabilities.card_payments` alongside recipient `stripe_balance.stripe_transfers`.

No deploy was performed. No Stripe Dashboard settings were changed. ORCH-0764B checkout remains paused.

## Evidence Source

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`
- Spec: `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`
- Implementor prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_PAYLOAD_AND_RAK_EVIDENCE.md`

Direct probes proved:

- current payload + full test secret returned `capability_not_available_without_other_capability`;
- corrected payload + full test secret returned HTTP `200`;
- `rak_mingla_onboard` still returned `403 forbidden` for both `/v2/core/accounts` and `/v2/core/account_links`;
- Account Link configuration `["recipient", "merchant"]` succeeded with the full test secret.

## Files Changed

### `supabase/functions/_shared/stripeBlueprintClient.ts`

Updated `createRecipientAccount(...)` request body.

Old configuration shape:

```ts
configuration: {
  recipient: {
    capabilities: {
      stripe_balance: {
        stripe_transfers: {
          requested: true,
        },
      },
    },
  },
},
```

New configuration shape:

```ts
configuration: {
  recipient: {
    capabilities: {
      stripe_balance: {
        stripe_transfers: {
          requested: true,
        },
      },
    },
  },
  merchant: {
    capabilities: {
      card_payments: {
        requested: true,
      },
    },
  },
},
```

Preserved:

- `POST /v2/core/accounts`;
- `POST /v2/core/account_links`;
- `Stripe-Version: 2026-04-22.preview`;
- idempotency key behavior;
- env selection order `["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]`;
- `dashboard: "express"`;
- application responsibility fields;
- existing `include` list;
- Account Link configurations `["recipient", "merchant"]`.

### `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`

Updated the account-create payload test to assert both:

- recipient `stripe_balance.stripe_transfers`;
- merchant `card_payments`.

The Account Link test already asserted:

- `use_case.type === "account_onboarding"`;
- `configurations === ["recipient", "merchant"]`;
- return and refresh URLs.

## Verification

### Deno Tests

Command:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Result:

```text
ok | 6 passed | 0 failed
```

### Deno Check

Command:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts
```

Result:

```text
Check brand-stripe-onboard/index.ts
Check _shared/stripeBlueprintClient.ts
Check brand-mingla-tos-accept/index.ts
```

Exit code: `0`.

### Legacy Path Sweep

Command:

```bash
rg -n "stripe\\.accounts\\.create|accountSessions\\.create|connect-onboarding\\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

Result: only intentional negative assertions in `brand-stripe-onboard/index.test.ts`.

```text
supabase/functions/brand-stripe-onboard/index.test.ts:19
supabase/functions/brand-stripe-onboard/index.test.ts:20
supabase/functions/brand-stripe-onboard/index.test.ts:22
```

### Formatting

Command:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno fmt _shared/stripeBlueprintClient.ts _shared/__tests__/stripeBlueprintClient.test.ts
```

Result:

```text
Checked 2 files
```

## Not Implemented

Did not add `Stripe-Context` support. Direct probe with `Stripe-Context: acct_1TTnt1PjlZyAYA40` still returned `403`, while the full-secret corrected payload succeeded. The active context issue is not proven; the RAK permission issue is proven.

Did not implement diagnostics hardening. The request was scoped to the proven payload fix; diagnostic response shaping can remain a separate hardening item if the next retest still needs clearer runtime classification.

## Remaining Required Operator Step

`rak_mingla_onboard` still must be updated in Stripe Dashboard before deployed runtime can pass.

Required permission intent:

- allow `POST /v2/core/accounts`;
- allow `POST /v2/core/account_links`;
- include any Accounts v2/Core Accounts resources Stripe Workbench reports as required by request ids already captured in the investigation.

Known failing RAK request ids from forensics:

- `req_v2nzirvxkRTNpBsH3`
- `req_v2li5e6mHGuG4xzqm`
- `req_v28HEcg1uvi7Zg8ve`

## Deploy Note

After orchestrator review and after the operator confirms the RAK permission fix, deploy only:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

Then dispatch tester to retest `Stripe Wise 2`.
