# B2a Path C V3 — Restricted API Key (RAK) Migration Runbook

**Status:** Operator-side runbook — NO code changes needed in this phase
**Phase:** 0'' (between Sub-dispatch A code+migration commits and Sub-dispatch B backend work)
**Estimated effort:** 1-2 hours operator time
**Per:** [outputs/SPEC_B2_PATH_C_V3.md §2 D-V3-15](../../outputs/SPEC_B2_PATH_C_V3.md) + [Stripe best-practices audit A5](../../Mingla_Artifacts/reports/STRIPE_BEST_PRACTICES_AUDIT_B2_PATH_C_V2.md)

---

## Why this runbook exists

Stripe's #1 security recommendation is to use Restricted API Keys (RAKs, prefix `rk_`) instead of full secret keys (`sk_`) wherever possible — with least-privilege scoping per service. From [https://docs.stripe.com/keys/restricted-api-keys](https://docs.stripe.com/keys/restricted-api-keys):

> "RAKs have only the permissions you assign, so a compromised RAK can do far less damage than a compromised secret key. Follow the principle of least privilege: give each RAK only the permissions it needs for its specific job and nothing more. Create a separate RAK for each service or use case."

Mingla currently uses ONE full secret key (`STRIPE_SECRET_KEY`) for all 6 Stripe edge functions. This is a single point of compromise. V3 migrates to **6 RAKs**, one per fn, each with only the scopes that fn needs.

A compromised onboarding-fn key shouldn't let an attacker exfiltrate balance data. A compromised balance-fn key shouldn't let an attacker create accounts. RAKs enforce this structurally.

---

## Pre-flight (do this first)

1. ✅ Sub-dispatch A code committed (this runbook itself is in Sub-dispatch A; you've shipped it).
2. ⏳ Verify Stripe Connect platform is activated in your sandbox. Confirm at https://dashboard.stripe.com/test/connect/accounts/overview.
3. ⏳ Confirm operator has Stripe Dashboard admin access (RAK creation is a Dashboard-only operation; no API/CLI for it).
4. ⏳ Confirm operator has Supabase project admin access (to update Edge Function Secrets).

---

## RAK scope map (the 6 RAKs to create)

For each edge function, the required scopes are listed below. Create each RAK in Stripe Dashboard → Developers → Restricted Keys with EXACTLY these scopes (no more, no less).

### RAK #1 — `rak_mingla_onboard`

**Used by:** `supabase/functions/brand-stripe-onboard/index.ts`

**Stripe API calls:** `POST /v1/accounts` (create), `POST /v1/account_links` (onboard URL), `POST /v1/account_sessions` (Embedded Components session). May call `POST /v1/accounts/{id}/persons` for representative info.

**Scopes (least privilege):**
- Connect → Accounts: **Write**
- Connect → Account links: **Write** (no Read endpoint exists; Write is the operative scope)
- Connect → Account sessions: **Write**
- Connect → Persons: **Write**
- Connect → Accounts: **Read** (for re-checking existing account state during reactivation flow per D-V3-2)

### RAK #2 — `rak_mingla_webhook`

**Used by:** `supabase/functions/stripe-webhook/index.ts`

**Stripe API calls:** Receives signed webhook events; may call `GET /v1/accounts/{id}` to refresh on `account.updated`, `GET /v1/payment_intents/{id}`, `GET /v1/charges/{id}/refunds`, `GET /v1/disputes/{id}` (B3+ scope — flag), `GET /v1/payouts/{id}`, `GET /v1/application_fees/{id}`.

**Scopes (read-only across most resources):**
- Webhook endpoints: **Read**
- Connect → Accounts: **Read**
- Connect → Capabilities: **Read**
- Connect → External accounts: **Read**
- Connect → Persons: **Read**
- Charges: **Read**
- PaymentIntents: **Read**
- Refunds: **Read**
- Disputes: **Read** (for B3 dispute events; can omit if disputes deferred)
- Payouts: **Read**
- Application fees: **Read**
- Events: **Read**
- Balance transactions: **Read**

### RAK #3 — `rak_mingla_refresh_status`

**Used by:** `supabase/functions/brand-stripe-refresh-status/index.ts`

**Stripe API calls:** `GET /v1/accounts/{id}` (fetch fresh state), `GET /v1/accounts/{id}/persons` (refresh persons state), `GET /v1/accounts/{id}/capabilities` (refresh capabilities), `GET /v1/accounts/{id}/external_accounts` (refresh bank accounts).

**Scopes:**
- Connect → Accounts: **Read**
- Connect → Persons: **Read**
- Connect → Capabilities: **Read**
- Connect → External accounts: **Read**

### RAK #4 — `rak_mingla_detach`

**Used by:** `supabase/functions/brand-stripe-detach/index.ts` (NEW in Sub-dispatch B)

**Stripe API calls:** `DELETE /v1/accounts/{id}` (best-effort hard delete; soft-delete in DB happens regardless).

**Scopes (minimal):**
- Connect → Accounts: **Write**

**Note:** Soft-delete pattern (`UPDATE stripe_connect_accounts SET detached_at = now()`) is the primary detach action; Stripe `accounts.del` is best-effort. If operator wants to forbid even the best-effort Stripe delete (and rely entirely on local soft-delete + waiting for `account.application.deauthorized` webhook), this RAK can be omitted entirely (use service-role-only Supabase client, no Stripe API call). Default V3 behavior: keep this RAK for the best-effort Stripe-side cleanup.

### RAK #5 — `rak_mingla_balances`

**Used by:** `supabase/functions/brand-stripe-balances/index.ts` (NEW in Sub-dispatch B)

**Stripe API calls:** `GET /v1/balance` with `Stripe-Account` header (per-connected-account balance), `GET /v1/balance_transactions` (optional; for ledger detail), `GET /v1/payouts` (for upcoming payouts list).

**Scopes:**
- Balance: **Read**
- Balance transactions: **Read**
- Payouts: **Read**
- Connect → Accounts: **Read** (to verify the connected account exists + is active)

### RAK #6 — `rak_mingla_kyc_reminder`

**Used by:** `supabase/functions/stripe-kyc-stall-reminder/index.ts` (extended in Sub-dispatch B Phase 4)

**Stripe API calls:** `GET /v1/accounts/{id}` (read currently_due + current_deadline + disabled_reason), `POST /v1/account_links` (issue fresh resume link for stalled accounts).

**Scopes:**
- Connect → Accounts: **Read**
- Connect → Account links: **Write**

---

## Migration procedure (do these in order)

### Step 1 — Create RAKs in Stripe TEST mode

For each of the 6 RAKs above:

1. Open https://dashboard.stripe.com/test/apikeys (sandbox mode)
2. Click "Create restricted key"
3. Name: `<rak_name>` (exactly as listed above)
4. Select ONLY the scopes listed for that RAK; leave everything else as "None"
5. Click "Create key"
6. Copy the `rk_test_...` key value
7. Save the key value somewhere temporarily safe (will paste into Supabase env vars in Step 2)

⚠️ **Do NOT skip the "least-privilege" check.** If the dashboard shows additional scopes beyond what's listed, set them to "None" before creating. Over-permissioned RAKs defeat the purpose.

### Step 2 — Set Supabase Edge Function Secrets (TEST keys)

For each fn, set its specific RAK env var. In Supabase Dashboard → Project Settings → Edge Functions → Secrets:

| Secret name | Value |
|---|---|
| `STRIPE_RAK_ONBOARD` | `rk_test_...` from RAK #1 |
| `STRIPE_RAK_WEBHOOK` | `rk_test_...` from RAK #2 |
| `STRIPE_RAK_REFRESH_STATUS` | `rk_test_...` from RAK #3 |
| `STRIPE_RAK_DETACH` | `rk_test_...` from RAK #4 (or skip if hard-delete disabled) |
| `STRIPE_RAK_BALANCES` | `rk_test_...` from RAK #5 |
| `STRIPE_RAK_KYC_REMINDER` | `rk_test_...` from RAK #6 |

Keep the existing `STRIPE_SECRET_KEY` env var in place for now (will be removed in Step 5 after verification).

### Step 3 — Update `_shared/stripe.ts` (Sub-dispatch B Phase 1 work)

The `_shared/stripe.ts` helper currently exports a single `stripe` client constructed from `STRIPE_SECRET_KEY`. In Sub-dispatch B Phase 1, the implementor will refactor this to a **factory function** that accepts a `STRIPE_RAK_*` env var name and returns a fn-specific Stripe client.

This step is implementor work; the runbook captures it for completeness:

```ts
// _shared/stripe.ts (V3 refactored shape — to be implemented in Sub-dispatch B Phase 1)
import Stripe from "https://esm.sh/stripe@18.0.0?target=denonext";

export const STRIPE_API_VERSION = "2026-04-30.preview" as const;

export function createStripeClient(rakEnvVar: string): Stripe {
  const key = Deno.env.get(rakEnvVar);
  if (!key) {
    throw new Error(`${rakEnvVar} environment variable is not set.`);
  }
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "Mingla", version: "1.0.0", url: "https://mingla.com" },
  });
}

// Per-fn convenience exports (each fn imports its own):
// export const stripeOnboard = createStripeClient("STRIPE_RAK_ONBOARD");
// (See per-fn import pattern in each function's index.ts)
```

### Step 4 — Test each fn with new RAK in sandbox

Deploy each edge fn (Sub-dispatch B builds the new fns; existing fns get the new client import). Trigger each via a sandbox happy-path call:

| Fn | How to trigger sandbox test |
|---|---|
| `brand-stripe-onboard` | Sign in as brand admin in sandbox; tap "Connect Stripe" → verify success |
| `stripe-webhook` | Stripe Dashboard → Webhooks → "Send test webhook" `account.updated` → verify 200 |
| `brand-stripe-refresh-status` | Refresh BrandPaymentsView → verify status updates |
| `brand-stripe-detach` | Tap "Disconnect Stripe" on a sandbox brand → verify soft-delete |
| `brand-stripe-balances` | Open BrandPaymentsView KPIs → verify balance loads |
| `stripe-kyc-stall-reminder` | Manually invoke fn (Supabase Dashboard → Edge Functions → Invoke) with test brand → verify reminder fires |

If any fn returns **403 Forbidden** from Stripe API: the RAK is missing a required scope. Go to Stripe Dashboard, edit the RAK, add the missing scope, save. Re-test.

If 403 persists after granting the obvious scope: cross-reference with the RAK scope tables in Sub-dispatch B Phase 1 IMPL report (when it lands).

### Step 5 — Verify NO 403 errors in Supabase logs over 24 hours

Run the sandbox in normal use for 24 hours. Tail edge fn logs:

```bash
supabase functions logs brand-stripe-onboard --tail | grep -i "403\|forbidden"
supabase functions logs stripe-webhook --tail | grep -i "403\|forbidden"
# ... etc for all 6 fns
```

Expected: zero 403 errors. If any appear, the corresponding RAK needs a scope addition.

### Step 6 — Create LIVE RAKs

Repeat Step 1 in **LIVE mode** at https://dashboard.stripe.com/apikeys (no /test/ prefix). Same names, same scopes, save the `rk_live_*` keys.

### Step 7 — Plan production env var swap (do NOT execute yet)

This step is for production rollout planning, not now. When you're ready to ship V3 to production:

1. In production Supabase, set the 6 `STRIPE_RAK_*` env vars to the LIVE RAK values from Step 6.
2. Verify edge fns deployed with the new code (Sub-dispatch B + C committed).
3. Test in production with a single brand admin (cooperative real-money brand) before broad rollout.
4. After 7 days of stability, proceed to Step 8.

### Step 8 — Rotate the full secret key out

Once 6 RAKs are confirmed working in production:

1. Stripe Dashboard → Developers → API keys → next to the full secret key, click "Roll key" → confirm.
2. The old `sk_live_*` is now invalid.
3. In Supabase production env vars, **delete** `STRIPE_SECRET_KEY` (no longer needed).
4. Confirm no edge fn references `STRIPE_SECRET_KEY` anymore (Sub-dispatch B's `_shared/stripe.ts` refactor removed all references). The CI gate I-PROPOSED-Q (Q gate) catches any inline literal `apiVersion:` outside `_shared/stripe.ts`; this also catches any orphan `STRIPE_SECRET_KEY` reference if the gate is extended (optional V3 follow-up).

---

## Rollback procedure

If a RAK has insufficient scope and a production fn 403s:

1. Stripe Dashboard → Restricted Keys → edit the RAK → add missing scope → save (no key value change; updates in place)
2. Wait ≤30 seconds for Stripe propagation
3. Retry the fn call

If RAK pattern entirely fails (unexpected scope-name mismatch, etc.):

1. Set `STRIPE_RAK_<purpose>` env var to the value of `STRIPE_SECRET_KEY` temporarily (full key has all permissions; defeats RAK purpose but unblocks)
2. Investigate scope mismatch
3. Revert to RAK once fixed

---

## Verification checklist (Step 5 expanded)

After 24-hour soak test:

- [ ] Zero 403 errors in any edge fn log
- [ ] All 6 sandbox happy paths still succeed
- [ ] `_shared/stripe.ts` refactored to factory pattern (Sub-dispatch B Phase 1 deliverable)
- [ ] No fn references the old single `stripe` client export pattern
- [ ] Each fn's RAK env var name matches the table in this runbook
- [ ] Stripe Dashboard restricted-key audit log shows expected fn-specific traffic patterns

---

## Cross-references

- SPEC v3 D-V3-15: [outputs/SPEC_B2_PATH_C_V3.md §2](../../outputs/SPEC_B2_PATH_C_V3.md)
- Stripe best-practices audit A5 (RAK migration recommendation): [Mingla_Artifacts/reports/STRIPE_BEST_PRACTICES_AUDIT_B2_PATH_C_V2.md](../../Mingla_Artifacts/reports/STRIPE_BEST_PRACTICES_AUDIT_B2_PATH_C_V2.md)
- Investigation Thread 26 (RAK scope research): [Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md](../../Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md)
- Stripe RAK docs: https://docs.stripe.com/keys/restricted-api-keys
- Stripe best practices for keys: https://docs.stripe.com/keys-best-practices

---

**End of runbook.**

After completing Step 5 (sandbox verified), proceed to Sub-dispatch B (backend implementation). Steps 6-8 happen during V3 production rollout (post-CLOSE).
