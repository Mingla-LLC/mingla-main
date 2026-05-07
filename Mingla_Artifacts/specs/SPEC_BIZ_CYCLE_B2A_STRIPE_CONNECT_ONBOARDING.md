# SPEC — Cycle B2a: Stripe Connect onboarding wired live (web-SDK + in-app-browser pattern)

**Status:** BINDING. The implementor must execute this SPEC verbatim. Deviations require a SPEC amendment dispatched by the orchestrator.

**Mode:** SPEC (investigation + spike both complete and approved by orchestrator REVIEW)
**Severity:** S0 — MVP critical-path; B2a unblocks B3 (checkout) + B4 (door payments) + every revenue-attached feature
**Surface:** `mingla-business/` Expo Web (`business.mingla.com`) + native iOS/Android · `supabase/` edge functions + migrations
**Estimated IMPL effort:** ~28 hrs
**Author:** Mingla Forensics (SPEC mode)
**Date:** 2026-05-06
**Dispatch:** [`Mingla_Artifacts/prompts/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md`](../prompts/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md)

---

## 1. Plain English summary (≤300 words)

Today, when a brand admin clicks "Set up payments" inside `mingla-business`, the flow is theatrical — a 1.5-second simulated loading spinner that auto-advances to a fake "Onboarding submitted" screen with no real Stripe handshake. `brand.stripeStatus` is purely client-side Zustand fiction. Five §B.6 tables are migrated but no service writes to them. Zero Stripe edge functions exist out of 58 total.

B2a wires the real flow. The brand admin (rank ≥ `finance_manager`) clicks "Set up payments" → app calls `brand-stripe-onboard` edge function which creates a Stripe Connect v2 account (controller properties matching Express UX intent per DEC-112) and an AccountSession → app opens `business.mingla.com/connect-onboarding?session={client_secret}&...` via `expo-web-browser.openAuthSessionAsync` → Mingla-hosted page renders `<ConnectAccountOnboarding>` from `@stripe/react-connect-js` → brand completes KYC + business info + tax ID + bank account + ID upload entirely inside the Mingla-branded form → on `onExit`, web page redirects to deep link or success page → Stripe webhook fires `account.updated` → `stripe-webhook` edge function verifies signature + idempotently records + updates `stripe_connect_accounts` → DB trigger mirrors flags to `brands.stripe_*` denormalized cache → Supabase Realtime broadcasts → React Query invalidates → UI banner refreshes. Brand can now publish events that accept real payment.

**What ships:** J-B2.1 onboarding (embedded via in-app browser) + J-B2.2 brand routing (DB-already-enforced) + J-B2.3 status surfacing (server-derived, NOT Zustand fiction). One additive DB migration, three new edge functions, three `_shared/` utilities, two new hooks, one rewritten component, one new web bundle page, one Realtime channel.

**What does NOT ship in B2a:** J-B2.4 stall recovery, J-B2.5 detach (both deferred to B2b). B3 checkout. Live-mode launch (sandbox-only).

**Who benefits:** brand admins on `mingla-business` web + native get real Stripe Connect onboarding inside Mingla branding; the buyer side (B3) inherits the SDK upgrade work; downstream cycles unblock.

---

## 2. Backward dependencies + locked decisions

### 2.1 Investigation + spike artifacts (mandatory reading for IMPL)

- [`Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md`](../reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md)
- [`Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md`](../reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md)
- [`Mingla_Artifacts/prompts/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md`](../prompts/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md) (this SPEC's dispatch)

### 2.2 Locked decisions (binding — do NOT re-litigate)

| ID | Decision | Source |
|---|---|---|
| **DEC-112** | Stripe Connect type intent = EXPRESS (Stripe owns KYC + 1099-K + chargebacks; brand sees Express dashboard for payouts) | DECISION_LOG.md |
| **DEC-113** | Routing = BRAND-LEVEL (`stripe_connect_accounts.brand_id` FK; one Connect account per brand) | DECISION_LOG.md |
| **DEC-114** | Charge model = MARKETPLACE (Mingla = merchant-of-record; `transfer_data.destination` to brand's account; `application_fee_amount` for platform fee) | DECISION_LOG.md |
| **D-B2-1** | Permission rank = `biz_can_manage_payments_for_brand_for_caller` (account_owner + brand_admin + finance_manager) | DB schema 2026-05-05 |
| **D-B2-2** | Stub deletion = full delete on B2a IMPL (no flag, no fallback) | spike memo |
| **D-B2-3** | Dual Stripe state reconciliation = DB-trigger-synced cache (`stripe_connect_accounts` canonical; `brands.stripe_*` mirrors via trigger) | spike memo |
| **D-B2-4** | `account_type` column = DEFAULT 'express' (already in baseline-squash; internal classification label only) | DB schema |
| **D-B2-5** | Stripe API version pin = `2026-04-30.preview` (Accounts v2 is public preview; verify-and-update at IMPL Phase 0 if newer `.preview` exists) | spike + Stripe blog |
| **D-B2-7** | Add `idx_payment_webhook_events_created_at` for cron retry queries | spike OBS-4 |
| **D-B2-8** | Extend `payouts.status_check` enum = include `'in_transit'` + `'canceled'` | spike OBS-6 |
| **D-B2-9** | Add `detached_at timestamptz NULL` column to `stripe_connect_accounts` (additive prep for B2b) | spike |
| **D-B2-10** | Embedded onboarding wrapper UI = full-page route at `/brand/[id]/payments/onboard` (route exists; replace stub body) | existing code |
| **D-B2-11** | Status refresh = webhook → Realtime broadcast → React Query invalidate + 30s poll fallback | spike + Stripe skill |
| **D-B2-12** | Event publish blocked by `charges_enabled=true` ONLY (NOT `payouts_enabled`; events sell tickets while payout routing verifies) | R2 mitigation |
| **D-B2-13** | Currency/region scope = UK-only at MVP | Q9 RESOLVED |
| **D-B2-14** | Concurrent-onboard lock = DB unique idx on `stripe_connect_accounts.brand_id` (already exists) | DB schema |
| **D-B2-15** | `Brand.stripeStatus` derivation = server-side SQL helper `pg_derive_brand_stripe_status(brand_id)` | spike R-3 fix |
| **D-B2-16** | Mapper Stripe field mapping = `mapBrandRowToUi` reads denormalized cache; React Query separately fetches full row + requirements | spike R-3 fix |
| **D-B2-22** | Idempotency-Key generation = `{brand_id}:{operation}:{epoch_ms}` | spike CF-cluster |
| **D-B2-23** | SDK strategy = **Path B** — in-app browser via `expo-web-browser.openAuthSessionAsync` opens Mingla-hosted page rendering `@stripe/connect-js` + `@stripe/react-connect-js`. NOT private preview SDK (Path A) and NOT WebView wrap (explicitly prohibited by Stripe). | spike + operator confirmation 2026-05-06 |

### 2.3 Decisions DEFERRED to B2b (do NOT spec)

D-B2-6, D-B2-17, D-B2-18, D-B2-19, D-B2-20, D-B2-21 — stall recovery + detach. The `detached_at` column from D-B2-9 ships in B2a as additive prep but no app code reads/writes it in B2a.

### 2.4 Verified context at SPEC writing time

| Item | Value | Source |
|---|---|---|
| Mingla brand primary color (for Stripe `appearance.variables.colorPrimary`) | `#eb7825` (warm orange) | `mingla-business/src/constants/designSystem.ts:147` `accent: "#eb7825"` |
| `audit_log` schema | id, user_id, brand_id (nullable), event_id (nullable), action, target_type, target_id, before (JSONB), after (JSONB), ip, user_agent, created_at — append-only via `trg_audit_log_block_update` trigger | baseline-squash line 7422 |
| Existing `expo-web-browser` version | `~15.0.10` | `mingla-business/package.json` |
| Existing `@stripe/stripe-react-native` version | `0.50.3` (B3 inherits SDK upgrade; B2a does NOT use this SDK) | `mingla-business/package.json` |
| Sandbox publishable key (for env reference; do NOT commit value) | `pk_test_51TTnt1...` | operator-provided 2026-05-06 |
| Stripe Marketplace platform model + Express dashboard + UK + GBP | configured per Phase 1-3 setup | Stripe Dashboard 2026-05-06 |

---

## 3. Scope, non-goals, assumptions

### 3.1 In scope

- **J-B2.1** Stripe Connect onboarding (embedded via in-app browser pattern) + `account.updated` webhook handling
- **J-B2.2** Brand-level account routing (DB-already-enforced via unique idx; B2a verifies app code respects)
- **J-B2.3** Connect status surfacing in UI (banner refresh from webhook events; `useBrandStripeStatus` hook; `BrandPaymentsView.tsx` reads derived status from server)

### 3.2 Non-goals (explicit)

- J-B2.4 stall recovery — B2b
- J-B2.5 detach flow — B2b (`detached_at` column is additive prep here; no read/write in B2a)
- B3 checkout — separate cycle
- B4 door payments — separate cycle
- Live-mode launch — B2a ships to Stripe sandbox; live-mode toggle happens after Stripe Marketplace review completes (parallel calendar gate)
- Refunds writeback — `RefundSheet.tsx` continues writing Zustand-only (DISC-2 forensics)
- Hard-coded fee constant replacement in `BrandFinanceReportsView.tsx` (DISC-1 forensics; deferred to B5)
- App-mobile (consumer app) Stripe wiring — DISC-4 forensics; deferred to B3/B4 forensics

### 3.3 Assumptions (must verify at IMPL Phase 0)

- A1 — `business.mingla.com` Expo Web bundle compiles `@stripe/connect-js` + `@stripe/react-connect-js` cleanly (no React-Native-Web shim conflicts). **Mitigation if false:** fall back to wrapping in a thin web-only entry point that bypasses RN-Web; document in IMPL report.
- A2 — `expo-web-browser.openAuthSessionAsync` deep-link callback handles iOS + Android + Expo Web; redirect URL captured correctly.
- A3 — Stripe `2026-04-30.preview` API version supports `POST /v2/core/accounts` with the controller properties shape in §4.2.2. Verify; if newer `.preview` exists, pin newest.
- A4 — Operator has Stripe sandbox secret key (`sk_test_*`) and webhook signing secret available for Supabase env vars. (Webhook signing secret is created when operator configures the webhook endpoint URL during IMPL Phase 5.)
- A5 — Operator has the Mingla LLC Stripe account from Phase 1-3 setup (verified 2026-05-06).
- A6 — Mingla's deep link scheme `mingla-business://` is registered in `app.config.ts`. **Verify at IMPL Phase 0**; if missing, register before component layer build.

---

## 4. Layer-by-layer specification

### 4.1 Database layer

#### 4.1.1 Single additive migration

**File:** `supabase/migrations/<TIMESTAMP>_b2a_stripe_connect_onboarding.sql`

Where `<TIMESTAMP>` follows the project convention (e.g., `20260507000002` if shipped after `20260507000001_orch_0737_v3_cron_filter_cancelling.sql`).

**Verbatim SQL contents (binding):**

```sql
-- B2a Stripe Connect onboarding — additive migration
-- See SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.1

-- 1. Add detached_at column (additive prep for B2b detach flow; no read/write in B2a)
ALTER TABLE "public"."stripe_connect_accounts"
  ADD COLUMN IF NOT EXISTS "detached_at" timestamp with time zone NULL;

COMMENT ON COLUMN "public"."stripe_connect_accounts"."detached_at" IS
  'NULL while account is active; set by B2b detach flow when brand admin disconnects Stripe. B2a writes never set this column.';

-- 2. Extend payouts.status_check to include in_transit + canceled (Stripe webhooks emit these)
ALTER TABLE "public"."payouts"
  DROP CONSTRAINT IF EXISTS "payouts_status_check";

ALTER TABLE "public"."payouts"
  ADD CONSTRAINT "payouts_status_check"
  CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'in_transit'::text, 'canceled'::text]));

-- 3. Add idx for cron retry queries on stuck webhook rows
CREATE INDEX IF NOT EXISTS "idx_payment_webhook_events_created_at"
  ON "public"."payment_webhook_events" USING "btree" ("created_at");

-- 4. Document service-role-only RLS pattern on payment_webhook_events (HF-1 fix)
COMMENT ON TABLE "public"."payment_webhook_events" IS
  'Idempotent Stripe webhook inbox. RLS enabled with NO POLICY by design — service role only. Do NOT add RLS policies; service role bypasses RLS. Application/authenticated callers have no access by intent.';

-- 5. Helper function: derive brand stripe status from canonical stripe_connect_accounts row
CREATE OR REPLACE FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid")
RETURNS "text"
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN sca.detached_at IS NOT NULL THEN 'not_connected'::text
          WHEN sca.charges_enabled = true AND sca.payouts_enabled = true THEN 'active'::text
          WHEN sca.charges_enabled = true AND sca.payouts_enabled = false THEN 'active'::text
          WHEN sca.requirements ? 'disabled_reason' AND (sca.requirements->>'disabled_reason') IS NOT NULL THEN 'restricted'::text
          ELSE 'onboarding'::text
        END
      FROM public.stripe_connect_accounts sca
      WHERE sca.brand_id = p_brand_id
      LIMIT 1
    ),
    'not_connected'::text
  );
$$;

ALTER FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") TO "anon", "authenticated", "service_role";

COMMENT ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") IS
  'Returns one of (not_connected, onboarding, active, restricted) per B2a SPEC §4.1.1 and DEC-15. TS twin lives in mingla-business/src/utils/deriveBrandStripeStatus.ts; both must stay byte-for-byte equivalent (verified by unit tests).';

-- 6. Trigger to mirror stripe_connect_accounts state to brands.stripe_* denormalized cache (D-B2-3)
CREATE OR REPLACE FUNCTION "public"."tg_sync_brand_stripe_cache"()
RETURNS "trigger"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
BEGIN
  -- On INSERT or UPDATE of stripe_connect_accounts, mirror to brands.stripe_*
  -- This is the ONLY code path that should write brands.stripe_connect_id /
  -- stripe_charges_enabled / stripe_payouts_enabled — direct app writes are
  -- forbidden by I-PROPOSED-P (B2a CLOSE).
  UPDATE public.brands
  SET
    stripe_connect_id = NEW.stripe_account_id,
    stripe_charges_enabled = NEW.charges_enabled,
    stripe_payouts_enabled = NEW.payouts_enabled
  WHERE id = NEW.brand_id;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."tg_sync_brand_stripe_cache"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trg_sync_brand_stripe_cache"
  AFTER INSERT OR UPDATE ON "public"."stripe_connect_accounts"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."tg_sync_brand_stripe_cache"();

COMMENT ON TRIGGER "trg_sync_brand_stripe_cache" ON "public"."stripe_connect_accounts" IS
  'Mirrors charges_enabled/payouts_enabled/stripe_account_id to brands.stripe_* denormalized cache per D-B2-3. App code MUST NOT write brands.stripe_* directly (I-PROPOSED-P).';
```

#### 4.1.2 Existing RLS policies preserved

The four existing RLS policies on §B.6 tables are correct and unchanged:

- `Brand admin plus can manage stripe_connect_accounts`
- `Brand admin plus can manage payouts`
- `Brand admin plus can manage refunds`
- `Brand admin plus can manage door_sales_ledger`

`payment_webhook_events` has RLS enabled with NO policy by design (service-role only). Step 4 of the migration above documents this intent in a table comment.

#### 4.1.3 TS twin of helper

**File:** `mingla-business/src/utils/deriveBrandStripeStatus.ts`

```typescript
import type { Brand, BrandStripeStatus } from "../store/currentBrandStore";

/**
 * TS twin of pg_derive_brand_stripe_status.
 * MUST stay byte-for-byte equivalent to the SQL helper per B2a SPEC §4.1.1.
 *
 * Inputs:
 *   - charges_enabled, payouts_enabled, requirements (JSONB-shaped object), detached_at
 *
 * Returns: one of "not_connected" | "onboarding" | "active" | "restricted"
 *
 * Used by mapBrandRowToUi for fast list rendering from brands.stripe_* cache.
 * For full payments-page state, useBrandStripeStatus hook reads
 * stripe_connect_accounts directly + calls pg_derive_brand_stripe_status SQL helper.
 */
export function deriveBrandStripeStatus(input: {
  charges_enabled: boolean | null | undefined;
  payouts_enabled: boolean | null | undefined;
  requirements?: { disabled_reason?: string | null } | null;
  detached_at?: string | null;
  has_account: boolean;
}): BrandStripeStatus {
  if (!input.has_account) return "not_connected";
  if (input.detached_at != null) return "not_connected";
  if (input.requirements?.disabled_reason) return "restricted";
  if (input.charges_enabled === true) return "active";
  return "onboarding";
}
```

A unit test at `mingla-business/src/utils/__tests__/deriveBrandStripeStatus.test.ts` MUST cover at minimum 12 cases mirroring the SQL CASE branches. The test file MUST be added in IMPL Phase 3.

### 4.2 Edge function layer

#### 4.2.1 New shared utilities

**`supabase/functions/_shared/stripe.ts`**

```typescript
import Stripe from "https://esm.sh/stripe@<TBD pinned beta>?target=denonext";

// PIN: B2a SPEC §2.2 D-B2-5 — Accounts v2 is public preview.
// Verify at IMPL Phase 0 that this is the latest .preview version.
// To upgrade, register a separate ORCH cycle with regression test of B2a + B3 + B4.
export const STRIPE_API_VERSION = "2026-04-30.preview" as const;

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
if (!STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY environment variable is not set");
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  appInfo: {
    name: "Mingla",
    version: "1.0.0",
    url: "https://mingla.com",
  },
});

export type StripeClient = typeof stripe;
```

**Constraints:**
- Stripe SDK package version: pinned to a specific beta version (operator picks at IMPL Phase 0; latest stable beta supporting `.preview` API).
- Throws if env var missing — fail-fast, no silent default.
- App info string sent on every request for Stripe support traceability.

**`supabase/functions/_shared/idempotency.ts`**

```typescript
/**
 * Generates a Stripe Idempotency-Key per B2a SPEC §2.2 D-B2-22.
 * Format: `${brand_id}:${operation}:${epoch_ms}`
 *
 * Operations enumerated:
 * - "onboard_create" — first-time stripe_connect_accounts.create
 * - "onboard_session" — AccountSession.create for embedded onboarding
 * - "refresh_status" — accounts.retrieve refetch
 *
 * Reuse the same key only for a logically-identical retry of the same call.
 * Different operations on the same brand at the same instant get different keys.
 */
export function generateIdempotencyKey(
  brandId: string,
  operation: "onboard_create" | "onboard_session" | "refresh_status"
): string {
  const epochMs = Math.floor(Date.now());
  return `${brandId}:${operation}:${epochMs}`;
}
```

**`supabase/functions/_shared/audit.ts`**

```typescript
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Append-only writer for the audit_log table per BUSINESS_PROJECT_PLAN §B.7.
 * Throws on insert failure (no silent swallow per Const #3).
 *
 * The audit_log table has trg_audit_log_block_update trigger preventing
 * non-service-role UPDATE/DELETE; only service-role INSERT is the supported
 * mutation. Edge functions running with service role can call this freely.
 */
export interface AuditWriteInput {
  user_id: string | null;
  brand_id: string | null;
  event_id?: string | null;
  action: string; // e.g., "stripe_connect.onboard_initiated"
  target_type: string; // e.g., "stripe_connect_account"
  target_id: string;
  before?: object | null;
  after?: object | null;
  ip?: string | null;
  user_agent?: string | null;
}

export async function writeAudit(
  supabase: SupabaseClient,
  input: AuditWriteInput
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    user_id: input.user_id,
    brand_id: input.brand_id,
    event_id: input.event_id ?? null,
    action: input.action,
    target_type: input.target_type,
    target_id: input.target_id,
    before: input.before ?? null,
    after: input.after ?? null,
    ip: input.ip ?? null,
    user_agent: input.user_agent ?? null,
  });
  if (error) throw error;
}
```

#### 4.2.2 `brand-stripe-onboard` edge function

**File:** `supabase/functions/brand-stripe-onboard/index.ts`

**HTTP:** POST
**Auth:** Bearer JWT (Supabase auth)

**Request body schema:**

```typescript
{
  brand_id: string; // UUID of the brand initiating onboarding
  return_url: string; // Deep link or web URL to return to after onboarding
}
```

**Response shape (200 OK):**

```typescript
{
  client_secret: string; // AccountSession client_secret for the embedded component
  account_id: string; // Stripe Connect account ID (acct_*)
  onboarding_url: string; // Mingla-hosted URL: business.mingla.com/connect-onboarding?session=...&brand_id=...&return_to=...
}
```

**Error responses:**

| HTTP | Body | Cause |
|---|---|---|
| 400 | `{ error: "validation_error", detail: "..." }` | Missing/malformed brand_id or return_url |
| 401 | `{ error: "unauthenticated" }` | No JWT |
| 403 | `{ error: "forbidden", detail: "permission_denied" }` | `biz_can_manage_payments_for_brand_for_caller` returned false |
| 409 | `{ error: "conflict", detail: "duplicate_brand_account" }` | DB unique idx violation (race; second admin's request) |
| 502 | `{ error: "stripe_api_error", detail: "..." }` | Stripe API call failed |
| 500 | `{ error: "internal_error" }` | Unhandled |

**Logic (numbered steps the implementor must follow):**

1. Verify request method is POST; reject 405 otherwise.
2. Parse JSON body; validate `brand_id` is a valid UUID; validate `return_url` starts with either `mingla-business://` or `https://business.mingla.com/`. Reject 400 if invalid.
3. Extract `Authorization: Bearer <jwt>` header. Decode JWT to get `user_id` (use Supabase JWT validation or `jose` library against the project's JWT secret).
4. Create Supabase service-role client (SERVICE_ROLE_KEY env var).
5. Call RPC `biz_can_manage_payments_for_brand` with (brand_id, user_id). If `false`, reject 403.
6. Read existing `stripe_connect_accounts` row for `brand_id` via service-role client.
   - If exists AND `detached_at IS NULL`: reuse the existing `stripe_account_id`. Skip account creation; jump to step 9.
   - If exists AND `detached_at IS NOT NULL`: return 409 (B2b will handle re-onboarding detached accounts; B2a does not).
   - If not exists: proceed to step 7.
7. Read brand row via service-role client to get `default_currency` (default `'GBP'`) and country (default `'GB'` per Q9).
8. Create new Stripe v2 account:
   - `POST /v2/core/accounts`
   - Headers: `Stripe-Version: 2026-04-30.preview`, `Idempotency-Key: ${generateIdempotencyKey(brand_id, "onboard_create")}`
   - Body:
     ```json
     {
       "country": "GB",
       "default_currency": "GBP",
       "controller": {
         "losses": { "payments": "application" },
         "fees": { "payer": "application" },
         "stripe_dashboard": { "type": "express" },
         "requirement_collection": "stripe"
       },
       "capabilities": {
         "card_payments": { "requested": true },
         "transfers": { "requested": true }
       },
       "metadata": {
         "mingla_brand_id": "<brand_id>"
       }
     }
     ```
   - Capture `account.id` (the new `acct_*` value).
9. INSERT into `stripe_connect_accounts`:
   ```sql
   INSERT INTO stripe_connect_accounts (
     brand_id, stripe_account_id, account_type,
     charges_enabled, payouts_enabled, requirements
   ) VALUES (
     $brand_id, $stripe_account_id, 'express',
     false, false, '{}'::jsonb
   )
   ON CONFLICT (brand_id) DO UPDATE
   SET stripe_account_id = EXCLUDED.stripe_account_id, updated_at = now()
   RETURNING id, stripe_account_id;
   ```
   The `ON CONFLICT` handles the race where two admins click simultaneously — the unique idx returns the existing row's account_id which is the same one Stripe just gave us (idempotency-key on Stripe side ensures same account, not new).
   The INSERT trigger `trg_sync_brand_stripe_cache` fires automatically, mirroring `stripe_account_id` to `brands.stripe_connect_id`.
10. Create AccountSession:
    - `POST /v1/account_sessions`
    - Headers: `Stripe-Version: 2026-04-30.preview`, `Idempotency-Key: ${generateIdempotencyKey(brand_id, "onboard_session")}`
    - Body:
      ```json
      {
        "account": "<stripe_account_id>",
        "components": {
          "account_onboarding": {
            "enabled": true,
            "features": {
              "external_account_collection": true
            }
          }
        }
      }
      ```
    - Capture `session.client_secret`.
11. Build the onboarding URL:
    ```
    https://business.mingla.com/connect-onboarding?session=<client_secret>&brand_id=<brand_id>&return_to=<encoded return_url>
    ```
12. Write audit_log entry: `action="stripe_connect.onboard_initiated", target_type="stripe_connect_account", target_id="<sca_row_id>", after={ stripe_account_id, account_type: "express" }`.
13. Return 200 OK with `{ client_secret, account_id, onboarding_url }`.

**Constraints:**
- All Stripe API calls MUST include `Idempotency-Key` header (SC-15).
- All exceptions caught and mapped to error response shapes above; NO unhandled stack trace returned to client (Const #3 + security).
- service-role client reused across all DB operations within the request.
- No service-role key ever returned to client (security).

#### 4.2.3 `brand-stripe-refresh-status` edge function

**File:** `supabase/functions/brand-stripe-refresh-status/index.ts`

**HTTP:** POST
**Auth:** Bearer JWT

**Request body schema:**

```typescript
{
  brand_id: string;
}
```

**Response shape (200 OK):**

```typescript
{
  status: "not_connected" | "onboarding" | "active" | "restricted";
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements: object;
  detached_at: string | null;
}
```

**Logic:**

1. Verify POST + parse body + decode JWT (same as §4.2.2 steps 1-3).
2. Service-role client.
3. Verify `biz_can_manage_payments_for_brand`. 403 if false.
4. Read `stripe_connect_accounts` row. If not exists, return `{ status: "not_connected", ... }`.
5. Call Stripe `accounts.retrieve(stripe_account_id)` with `Idempotency-Key: ${generateIdempotencyKey(brand_id, "refresh_status")}` (idempotent reads OK).
6. UPDATE `stripe_connect_accounts` with fresh `charges_enabled`, `payouts_enabled`, `requirements`. The trigger `trg_sync_brand_stripe_cache` fires automatically, mirroring to `brands.stripe_*`.
7. Call `pg_derive_brand_stripe_status(brand_id)` SQL function for the canonical derived status.
8. Return the response shape.

**Constraints:** same as §4.2.2.

#### 4.2.4 `stripe-webhook` edge function

**File:** `supabase/functions/stripe-webhook/index.ts`

**HTTP:** POST
**Auth:** NO JWT — Stripe signature verification ONLY.

**Logic:**

1. Verify request method is POST; reject 405 otherwise.
2. Get `Stripe-Signature` header. If missing, reject 400 immediately.
3. Get raw request body (must read as text, NOT JSON-parse before signature check).
4. Get `STRIPE_WEBHOOK_SECRET` env var. If missing, throw 500.
5. Verify signature: `stripe.webhooks.constructEvent(rawBody, signature, secret)`. If verification fails, reject 400 with `{ error: "invalid_signature" }`. **DO NOT process the event.**
6. INSERT into `payment_webhook_events`:
   ```sql
   INSERT INTO payment_webhook_events (
     stripe_event_id, type, payload, processed
   ) VALUES (
     $event_id, $event_type, $payload, false
   )
   ON CONFLICT (stripe_event_id) DO NOTHING
   RETURNING id;
   ```
   The unique idx on `stripe_event_id` provides idempotency. If `RETURNING id` is empty, this is a replayed event — skip processing and return 200.
7. Process inline (B2a uses inline-process; if processing > 100ms or risk emerges in IMPL Phase 0 testing, escalate to NOTIFY-based async per orchestrator review):
   - For event type `account.updated`:
     - Extract `account_id` from event payload (`event.data.object.id`).
     - UPDATE `stripe_connect_accounts SET charges_enabled = ..., payouts_enabled = ..., requirements = ..., updated_at = now() WHERE stripe_account_id = $account_id`.
     - The `trg_sync_brand_stripe_cache` trigger fires.
     - Call `writeAudit` with `action="stripe_connect.account_updated", target_type="stripe_connect_account", target_id="<account_id>", before=<prior state>, after=<new state>`.
   - For other event types (`payout.*`, `charge.*`, `refund.*`, `application_fee.*`): record in `payment_webhook_events` and mark `processed=true` with no further action (B3 + B4 wire those types).
8. UPDATE the `payment_webhook_events` row: `SET processed = true, processed_at = now()`.
9. On any processing error: UPDATE row: `SET error = <error_message>` and return 200 to Stripe (avoid retry storms; Stripe also retries on 5xx).
10. Return 200 OK with empty body to Stripe.

**Critical:**
- Signature verification BEFORE any other processing (security).
- Body must be raw bytes/text, not JSON-parsed, until after verification.
- 200 returns even on processing error (durable queue pattern; cron/manual replay handles unprocessed rows; B2b adds the cron).

#### 4.2.5 Webhook endpoint configuration (operator action — not code)

After IMPL Phase 5 deploys `stripe-webhook` edge function, operator must:

1. Go to `https://dashboard.stripe.com/test/webhooks` (sandbox)
2. Click "Add endpoint"
3. URL: `https://<supabase-project>.supabase.co/functions/v1/stripe-webhook` (replace with actual project URL)
4. Events to subscribe to (B2a-relevant):
   - `account.updated` (CRITICAL for J-B2.3 status flow)
   - `account.application.deauthorized` (informational; B2b uses for detach detection)
   - `payout.created`, `payout.paid`, `payout.failed` (recorded but not processed in B2a)
5. Capture the webhook signing secret (`whsec_*`)
6. Set in Supabase: Project Settings → Edge Functions → Secrets → `STRIPE_WEBHOOK_SECRET = whsec_*`
7. Test: send a test event from Stripe Dashboard; verify it lands in `payment_webhook_events` table with `processed=true`

This is documented as part of IMPL Phase 5 in §6 below.

### 4.3 Service layer

#### 4.3.1 New `mingla-business/src/services/brandStripeService.ts`

```typescript
import { supabase } from "./supabase";

export type BrandStripeStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

export interface StartOnboardingResult {
  client_secret: string;
  account_id: string;
  onboarding_url: string;
}

export interface RefreshStatusResult {
  status: BrandStripeStatus;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements: Record<string, unknown>;
  detached_at: string | null;
}

/**
 * Initiates Stripe Connect Express onboarding for a brand.
 * Calls brand-stripe-onboard edge function.
 * Throws on Postgrest/edge-fn error per Const #3.
 */
export async function startBrandStripeOnboarding(
  brandId: string,
  returnUrl: string
): Promise<StartOnboardingResult> {
  const { data, error } = await supabase.functions.invoke<StartOnboardingResult>(
    "brand-stripe-onboard",
    { body: { brand_id: brandId, return_url: returnUrl } }
  );
  if (error) throw error;
  if (data === null) throw new Error("startBrandStripeOnboarding: null response");
  return data;
}

/**
 * Refreshes brand Stripe status from Stripe API + DB.
 * Calls brand-stripe-refresh-status edge function.
 */
export async function refreshBrandStripeStatus(
  brandId: string
): Promise<RefreshStatusResult> {
  const { data, error } = await supabase.functions.invoke<RefreshStatusResult>(
    "brand-stripe-refresh-status",
    { body: { brand_id: brandId } }
  );
  if (error) throw error;
  if (data === null) throw new Error("refreshBrandStripeStatus: null response");
  return data;
}
```

#### 4.3.2 Update `mingla-business/src/services/brandMapping.ts`

**Existing function `mapBrandRowToUi` at lines 189-222** does NOT map `stripe_*` fields. Update:

- ADD reading of `row.stripe_connect_id`, `row.stripe_charges_enabled`, `row.stripe_payouts_enabled` (already in `BrandRow` type at lines 40-42).
- Compute `Brand.stripeStatus` via `deriveBrandStripeStatus({ has_account: row.stripe_connect_id !== null, charges_enabled: row.stripe_charges_enabled, payouts_enabled: row.stripe_payouts_enabled, requirements: null /* not in cache */, detached_at: null /* B2b */ })`.
- Set on returned Brand: `stripeStatus: derivedStatus`.

The denormalized cache reads do NOT include `requirements` JSONB (kept on `stripe_connect_accounts` only). The TS twin handles a null `requirements` gracefully (returns `'onboarding'` or `'active'` as appropriate).

#### 4.3.3 No change to `mingla-business/src/services/brandsService.ts`

`getBrand` already does `.select("*")` which pulls all `stripe_*` columns. The mapper change picks them up.

### 4.4 Hook layer

#### 4.4.1 New `mingla-business/src/hooks/useBrandStripeStatus.ts`

```typescript
import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import {
  type BrandStripeStatus,
  type RefreshStatusResult,
  refreshBrandStripeStatus,
} from "../services/brandStripeService";

const STALE_TIME_MS = 30 * 1000; // 30s — matches webhook + poll fallback per D-B2-11

export const brandStripeStatusKeys = {
  all: ["brand-stripe-status"] as const,
  detail: (brandId: string): readonly ["brand-stripe-status", string] =>
    [...brandStripeStatusKeys.all, brandId] as const,
};

/**
 * Reads canonical Stripe Connect status for a brand.
 * Subscribes to Realtime for webhook-driven invalidation.
 * Per D-B2-11: webhook → Realtime broadcast → invalidate; 30s poll fallback.
 */
export function useBrandStripeStatus(
  brandId: string | null
): UseQueryResult<RefreshStatusResult> {
  const queryClient = useQueryClient();
  const enabled = brandId !== null;

  // Realtime subscription per D-B2-11
  useEffect(() => {
    if (!enabled || brandId === null) return;
    const channelName = `stripe-status-${brandId}`;
    const channel = supabase.channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "stripe_connect_accounts",
          filter: `brand_id=eq.${brandId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: brandStripeStatusKeys.detail(brandId),
          });
          queryClient.invalidateQueries({
            queryKey: ["brands", "detail", brandId],
          });
        }
      )
      .subscribe();
    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, brandId, queryClient]);

  return useQuery<RefreshStatusResult>({
    queryKey: enabled
      ? brandStripeStatusKeys.detail(brandId)
      : ["brand-stripe-status-disabled"],
    enabled,
    staleTime: STALE_TIME_MS,
    refetchInterval: STALE_TIME_MS, // 30s poll fallback per D-B2-11
    queryFn: async (): Promise<RefreshStatusResult> => {
      if (brandId === null) {
        throw new Error("useBrandStripeStatus: brandId is null but enabled");
      }
      return refreshBrandStripeStatus(brandId);
    },
  });
}
```

#### 4.4.2 New `mingla-business/src/hooks/useStartBrandStripeOnboarding.ts`

```typescript
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import {
  startBrandStripeOnboarding,
  type StartOnboardingResult,
} from "../services/brandStripeService";
import { brandStripeStatusKeys } from "./useBrandStripeStatus";

export interface UseStartBrandStripeOnboardingInput {
  brandId: string;
  returnUrl: string;
}

export function useStartBrandStripeOnboarding(): UseMutationResult<
  StartOnboardingResult,
  Error,
  UseStartBrandStripeOnboardingInput
> {
  const queryClient = useQueryClient();
  return useMutation<
    StartOnboardingResult,
    Error,
    UseStartBrandStripeOnboardingInput
  >({
    mutationFn: async ({ brandId, returnUrl }) =>
      startBrandStripeOnboarding(brandId, returnUrl),
    onSuccess: (_data, { brandId }) => {
      queryClient.invalidateQueries({
        queryKey: brandStripeStatusKeys.detail(brandId),
      });
    },
    onError: (error, { brandId }) => {
      // Const #3: surface to UI; caller subscribes via mutation.error
      // eslint-disable-next-line no-console
      console.error("[useStartBrandStripeOnboarding] failed", {
        message: error.message,
        brandId,
      });
    },
  });
}
```

#### 4.4.3 Update `mingla-business/src/hooks/useBrands.ts` (cascade preview HF-8 fix)

In `useBrandCascadePreview` at lines 326-388:

- Replace `hasStripeConnect: stripeResult.data !== null && stripeResult.data.stripe_connect_id !== null` (line 382-384) with logic that reads the derived status from the brand record instead.
- Specifically: change the cascade-preview query to use `Brand.stripeStatus !== "not_connected"` for the `hasStripeConnect` boolean.
- This requires the calling component to pass the brand record OR query it; alternatively, do `pg_derive_brand_stripe_status` RPC call here with `head: true`.
- Recommended approach: replace the 5th parallel query (the `brands.stripe_connect_id` select) with an RPC call:
  ```typescript
  supabase.rpc("pg_derive_brand_stripe_status", { p_brand_id: brandId })
  ```
- `hasStripeConnect: stripeStatusResult.data !== "not_connected"`.

### 4.5 Component layer

#### 4.5.1 Replace `mingla-business/src/components/brand/BrandOnboardView.tsx`

**Existing 327-line stub** is fully replaced. New behavior:

**Props (unchanged contract):**

```typescript
export interface BrandOnboardViewProps {
  brand: Brand | null;
  onCancel: () => void;
  onAfterDone: () => void;
}
```

**State machine (replaces the stub's loading/complete/failed):**

```
idle → starting → in-flight → complete | cancelled | failed
```

| State | Trigger | UI |
|---|---|---|
| `idle` | Initial mount | Show "Connect Stripe" CTA (rare; if brand=null show not-found) |
| `starting` | User taps "Start onboarding" → `useStartBrandStripeOnboarding.mutate()` is pending | Spinner + "Preparing onboarding…" |
| `in-flight` | Mutation succeeded → `WebBrowser.openAuthSessionAsync(onboarding_url, return_url)` invoked | Spinner + "Complete onboarding in the browser…" + "I'm done" button (manual refresh) |
| `complete` | Browser session returned with `type: "success"` OR refreshed status returned `active`/`onboarding` | Check icon + "Onboarding submitted" + "Done" button calling `onAfterDone` |
| `cancelled` | Browser session returned with `type: "cancel"` OR `type: "dismiss"` (user closed without completing) | Flag icon + "Onboarding cancelled" + "Try again" button (re-runs mutation) + "Cancel" button (calls `onCancel`) |
| `failed` | Mutation `onError` OR returned status `restricted` | Flag icon + Stripe error message + "Try again" + "Cancel" buttons |

**Implementation pattern (state machine via local `useState` + `useStartBrandStripeOnboarding` mutation + `useBrandStripeStatus` query):**

```typescript
import * as WebBrowser from "expo-web-browser";
import { useStartBrandStripeOnboarding } from "../../hooks/useStartBrandStripeOnboarding";
import { useBrandStripeStatus } from "../../hooks/useBrandStripeStatus";

type ViewState = "idle" | "starting" | "in-flight" | "complete" | "cancelled" | "failed";

const [viewState, setViewState] = useState<ViewState>("idle");
const [errorMessage, setErrorMessage] = useState<string | null>(null);
const onboardMutation = useStartBrandStripeOnboarding();
const statusQuery = useBrandStripeStatus(brand?.id ?? null);

const handleStart = async (): Promise<void> => {
  if (brand === null) return;
  setViewState("starting");
  setErrorMessage(null);
  try {
    const result = await onboardMutation.mutateAsync({
      brandId: brand.id,
      returnUrl: "mingla-business://onboarding-complete",
    });
    setViewState("in-flight");
    const browserResult = await WebBrowser.openAuthSessionAsync(
      result.onboarding_url,
      "mingla-business://onboarding-complete"
    );
    if (browserResult.type === "success") {
      // Refetch status to verify
      const refreshed = await statusQuery.refetch();
      if (refreshed.data?.status === "active" || refreshed.data?.status === "onboarding") {
        setViewState("complete");
      } else if (refreshed.data?.status === "restricted") {
        setViewState("failed");
        setErrorMessage("Stripe needs additional information.");
      } else {
        setViewState("cancelled");
      }
    } else if (browserResult.type === "cancel" || browserResult.type === "dismiss") {
      setViewState("cancelled");
    } else {
      setViewState("failed");
      setErrorMessage("Onboarding session ended unexpectedly.");
    }
  } catch (error) {
    setViewState("failed");
    setErrorMessage(
      error instanceof Error ? error.message : "Couldn't start onboarding."
    );
  }
};
```

**Critical removals:**

- **DELETE the long-press dev gesture** (`handleHeaderLongPress` at lines 81-83 of stub). Per spike R-NEW-6 and SC-14, this is a production back-door that must be removed.
- **DELETE the simulated 1.5s delay** (`SIMULATED_LOADING_MS` at line 51 of stub).
- **DELETE the `[TRANSITIONAL] This will be a real WebView in B2.` comment** (line 164 of stub).

**Accessibility (I-38 + I-39 invariants):**

- Every Pressable MUST have explicit `accessibilityLabel`.
- IconChrome usages MUST follow I-38 touch-target compliance (auto-handled by primitive's `hitSlop` default).
- "Start onboarding" Pressable: `accessibilityLabel="Start Stripe Connect onboarding"`.
- "I'm done" Pressable: `accessibilityLabel="I have completed onboarding"`.
- "Try again" Pressable: `accessibilityLabel="Retry onboarding"`.
- "Cancel" Pressable: `accessibilityLabel="Cancel onboarding"`.
- Long-press accessibility action on the header (formerly used for the dev gesture): REMOVED.

**Keyboard discipline:** N/A for this view (no text input fields).

**Toast discipline:** N/A for this view (uses inline state messaging, not toasts).

**Pre-flight `/ui-ux-pro-max` requirement:** YES. Implementor MUST run `/ui-ux-pro-max` before final commit per `feedback_implementor_uses_ui_ux_pro_max.md`. Pass the new state machine + error copy + visual hierarchy for design polish review.

#### 4.5.2 Update `mingla-business/src/components/brand/BrandPaymentsView.tsx`

**Lines 161-166** (the `handleResolveBanner` TRANSITIONAL toast):

- Replace the toast `"Stripe support lands in B2."` with a deep link to the brand's Stripe Express dashboard at `https://dashboard.stripe.com/<account_id>` (need account_id from `useBrandStripeStatus` query).
- For `restricted` state CTA: open Stripe-hosted "resolve issue" page (Stripe provides this URL via the Account session or via a separate `account_links.create` with `type: "account_update"`). For B2a, defer the Stripe-hosted resolve page wiring; instead, link to the Express dashboard which has its own resolve flow.
- Implementor flexibility: if the deep link approach proves brittle in IMPL Phase 0, fall back to a toast with explicit "Contact support@mingla.com" — document in IMPL report.

**Lines 175-187** (sortedPayouts + sortedRefunds):

- B2a does NOT migrate these to real `payouts` + `refunds` tables; continue reading from `brand.payouts` and `brand.refunds` (Zustand fields). B2b/B3 will replace.
- Add a JSDoc note: `// TRANSITIONAL: payouts/refunds still read from Zustand stub. B2b/B3 wires real DB queries.`

**`brand.stripeStatus` source:**

- Continues being read from `brand` prop (which now flows through the updated `mapBrandRowToUi` → derived from `brands.stripe_*` cache).
- The `useBrandStripeStatus` hook can ALSO be used here for live invalidation; recommended pattern: render banner from `brand.stripeStatus` (cached, fast) + invalidate via the hook's Realtime subscription (handled automatically when component is mounted).

#### 4.5.3 Update `mingla-business/app/brand/[id]/payments/onboard.tsx`

**Lines 55-81** (the `handleAfterDone` callback):

- DELETE the `useUpdateBrand.mutateAsync({ patch: { stripeStatus: "onboarding" } })` call. This was the stub's fictional state advance.
- Replace with: simple `handleBack()` call. The real status flow is webhook-driven via `useBrandStripeStatus` Realtime subscription.

**Update the `<BrandOnboardView>` invocation:**

```typescript
<BrandOnboardView
  brand={brand}
  onCancel={handleBack}
  onAfterDone={handleBack}
/>
```

(Both callbacks now do the same thing: navigate back. Status updates flow via Realtime.)

#### 4.5.4 New `mingla-business/app/connect-onboarding.tsx` (Expo Web bundle page)

**Route:** `business.mingla.com/connect-onboarding?session={client_secret}&brand_id={id}&return_to={deep_link}`

**Lives outside `app/(tabs)/`** — confirmed not anon-buyer-conflicting per Cycle 8a invariant (this is brand-authenticated, but at a route Expo Router serves on web).

**Implementation:**

```typescript
import React, { useEffect, useMemo, useState } from "react";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useLocalSearchParams, useRouter } from "expo-router";

// Per B2a SPEC §4.5.4
export default function ConnectOnboardingPage(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    session: string | string[];
    brand_id: string | string[];
    return_to: string | string[];
  }>();

  const sessionClientSecret = Array.isArray(params.session)
    ? params.session[0]
    : params.session;
  const brandId = Array.isArray(params.brand_id)
    ? params.brand_id[0]
    : params.brand_id;
  const returnTo = Array.isArray(params.return_to)
    ? params.return_to[0]
    : params.return_to;

  const stripeConnectInstance = useMemo(() => {
    if (typeof sessionClientSecret !== "string") return null;
    const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST;
    if (publishableKey === undefined) {
      throw new Error(
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST not configured"
      );
    }
    return loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: async () => sessionClientSecret,
      appearance: {
        variables: {
          colorPrimary: "#eb7825", // Mingla accent.warm per designSystem.ts:147
        },
      },
    });
  }, [sessionClientSecret]);

  const [hasExited, setHasExited] = useState(false);

  const handleExit = (): void => {
    setHasExited(true);
    if (typeof returnTo === "string" && returnTo.startsWith("mingla-business://")) {
      // Native app deep link
      window.location.href = returnTo;
    } else if (typeof brandId === "string") {
      // Web direct completion → navigate to payments page
      router.replace(`/brand/${brandId}/payments`);
    } else {
      router.replace("/");
    }
  };

  if (typeof sessionClientSecret !== "string") {
    return <div>Invalid onboarding session — missing session parameter.</div>;
  }

  if (stripeConnectInstance === null) {
    return <div>Initializing onboarding…</div>;
  }

  if (hasExited) {
    return <div>Onboarding session ended. Redirecting…</div>;
  }

  return (
    <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
      <ConnectAccountOnboarding onExit={handleExit} />
    </ConnectComponentsProvider>
  );
}
```

**Style note:** This file uses plain `<div>` (Expo Web target — React DOM) NOT React Native primitives. Stripe's `ConnectAccountOnboarding` renders into the DOM directly. This is one of the few Expo Web-only files in `mingla-business/`.

**Bundle compatibility (A1 assumption):** Verify at IMPL Phase 0 that the Expo Web bundle compiles and loads `@stripe/connect-js` without React-Native-Web shim conflicts. If conflicts emerge, document the workaround in IMPL report.

### 4.6 Web bundle SDK installation

`mingla-business/package.json` ADD:

```json
{
  "dependencies": {
    "@stripe/connect-js": "<EXACT_VERSION_PIN at IMPL Phase 0>",
    "@stripe/react-connect-js": "<EXACT_VERSION_PIN at IMPL Phase 0>"
  }
}
```

Pin EXACT versions (no `^` or `~`) per D-B2-5 / G-5 and I-PROPOSED-O discipline. Document chosen versions in IMPL report.

### 4.7 Realtime layer

Already specified in §4.4.1's `useBrandStripeStatus` hook. Channel name `stripe-status-${brandId}`, filter `stripe_connect_accounts WHERE brand_id={id}`, event `UPDATE`, cleanup on unmount.

### 4.8 Environment variables

| Variable | Storage | Used by | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` | `mingla-business/.env` (frontend-readable) + EAS Secrets for native builds | `loadConnectAndInitialize` in web bundle | `pk_test_*`; safe to expose to client |
| `STRIPE_SECRET_KEY` | Supabase Edge Functions Secrets only | All edge functions via `_shared/stripe.ts` | `sk_test_*` for sandbox; CRITICAL: never expose to client |
| `STRIPE_WEBHOOK_SECRET` | Supabase Edge Functions Secrets only | `stripe-webhook` edge fn signature verification | `whsec_*`; created when operator configures webhook endpoint |
| `STRIPE_API_VERSION` | Hard-coded constant in `_shared/stripe.ts` (NOT env var) | All edge functions | Pinned per G-5 |

**Operator-side D-CYCLE-B2A-FOR-1 follow-up (RAK):** Stripe security skill recommends Restricted API Keys (RAK, prefix `rk_`) over secret keys (`sk_`). For B2a sandbox, `sk_test_*` is acceptable (low-risk environment). For LIVE-mode launch (post-B2a), operator should create a RAK with permissions limited to Connect operations + PaymentIntents + AccountSessions, and replace `sk_live_*` with `rk_live_*`. Documented in §17 discoveries; not blocking B2a IMPL.

---

## 5. Success criteria (numbered, observable, testable)

| # | Criterion | Test layer |
|---|---|---|
| **SC-01** | Brand admin (rank ≥ finance_manager) on `mingla-business` taps "Set up payments" → in-app browser opens `business.mingla.com/connect-onboarding?...` URL | Component + Web |
| **SC-02** | Onboarding form renders Mingla branding (`appearance.variables.colorPrimary = "#eb7825"`) — NOT Stripe purple | Visual smoke |
| **SC-03** | Brand can fill in business name, tax ID, address, bank account, ID document upload, and submit successfully (sandbox happy path) | E2E sandbox |
| **SC-04** | After submission, in-app browser closes → app re-fetches status → banner updates from "Connect Stripe" to "Onboarding submitted — verifying" within 5 seconds | Hook + Component |
| **SC-05** | Stripe webhook `account.updated` arrives → `stripe-webhook` edge fn verifies signature → inserts into `payment_webhook_events` (idempotently) → updates `stripe_connect_accounts.charges_enabled=true` → DB trigger mirrors to `brands.stripe_charges_enabled=true` | Edge fn + DB |
| **SC-06** | Realtime broadcast fires → frontend invalidates React Query → banner updates from "Onboarding submitted" to "Active" (no banner — matches existing BANNER_CONFIG[active]=null) | Realtime + Hook |
| **SC-07** | Event-publish guard reads `useBrandStripeStatus` and ALLOWS publish when status='active' | Hook + Component |
| **SC-08** | Event-publish guard BLOCKS publish when status='not_connected' or 'onboarding' or 'restricted'; surfaces banner directing to `/brand/[id]/payments/onboard` | Hook + Component |
| **SC-09** | Replayed `account.updated` webhook (same `stripe_event_id`) does NOT double-process — INSERT silently fails on unique idx; no duplicate audit_log row | Edge fn + DB |
| **SC-10** | Concurrent onboard initiation for same brand_id: first proceeds; second hits unique idx 23505 → ON CONFLICT DO UPDATE returns same account_id; no duplicate Stripe accounts | Edge fn + DB |
| **SC-11** | Marketing-manager-rank user (below finance_manager) cannot access `/brand/[id]/payments/onboard`; UI shows permission denied | Component + RLS |
| **SC-12** | `mapBrandRowToUi` populates `Brand.stripeStatus` from server data — NOT defaulted to 'not_connected' (R-3 fix) | Service layer |
| **SC-13** | `useBrandCascadePreview.hasStripeConnect` returns `true` only when stripeStatus !== 'not_connected' (HF-8 fix) | Hook |
| **SC-14** | `BrandOnboardView` long-press dev gesture from stub is REMOVED (R-NEW-6 mitigation) | Component grep |
| **SC-15** | All edge function Stripe API calls use `Idempotency-Key` header per `_shared/idempotency.ts` (D-B2-22) | Edge fn grep |
| **SC-16** | All Stripe Connect state transitions write to `audit_log` via `_shared/audit.ts` (CF-7 fix) | Edge fn grep |
| **SC-17** | Stripe webhook signature verification rejects unsigned/bad-signature requests with HTTP 400 | Edge fn |
| **SC-18** | iOS native smoke (DISC-S4) — full onboarding flow on iPhone simulator | E2E iOS |
| **SC-19** | Android native smoke (DISC-S4) — full onboarding flow on Android emulator | E2E Android |
| **SC-20** | Expo Web smoke (DISC-S4) — full onboarding flow in browser at `business.mingla.com` | E2E Web |
| **SC-21** | Stripe API version is pinned to `2026-04-30.preview` (or current `.preview` per IMPL Phase 0 verification) in `_shared/stripe.ts` (D-B2-5 / G-5) | Code grep |
| **SC-22** | New invariants I-PROPOSED-O + I-PROPOSED-P ratified post-CLOSE with CI grep gates (per `feedback_strict_grep_registry_pattern.md`) | Invariant + CI |

---

## 6. Implementation order (binding sequence)

1. **IMPL Phase 0 — pre-flight** (≤2 hrs)
   - Verify `@stripe/connect-js` loads in Expo Web bundle (A1)
   - Verify `expo-web-browser.openAuthSessionAsync` works iOS + Android + Web (A2)
   - Verify Stripe `2026-04-30.preview` is current latest `.preview` (A3); update SPEC §4.2.1 constant if newer
   - Verify deep link scheme `mingla-business://` registered in `app.config.ts` (A6)
   - Curl-test against Stripe sandbox: `POST /v2/core/accounts` with `Stripe-Version: 2026-04-30.preview` and controller properties — verify 200 OK + account creation works
   - Document findings in IMPL report §0
2. **DB migration** (≤2 hrs) — create + apply additive migration per §4.1.1; verify triggers fire via SQL probe; deploy via `supabase db push`
3. **`_shared/` utilities** (≤3 hrs) — `stripe.ts` + `idempotency.ts` + `audit.ts`; unit test for idempotency key format; mock test for Stripe wrapper
4. **`brand-stripe-onboard` edge fn** (≤4 hrs) — implement per §4.2.2; deploy; curl-test against sandbox brand
5. **`stripe-webhook` edge fn** (≤4 hrs) — implement per §4.2.4; deploy; configure webhook endpoint URL in Stripe Dashboard (operator action per §4.2.5); test signature verification with both valid + invalid signatures
6. **`brand-stripe-refresh-status` edge fn** (≤2 hrs) — implement per §4.2.3; deploy; curl-test
7. **Service layer** (≤2 hrs) — `brandStripeService.ts` + update `brandMapping.ts` + `deriveBrandStripeStatus.ts` TS twin + 12-case unit test
8. **Hook layer** (≤2 hrs) — `useBrandStripeStatus` + `useStartBrandStripeOnboarding` + Realtime subscription + update `useBrandCascadePreview`
9. **Component layer** (≤4 hrs) — replace `BrandOnboardView.tsx` per §4.5.1 (DELETE long-press gesture; DELETE simulated delay) + update `BrandPaymentsView.tsx` + update `app/brand/[id]/payments/onboard.tsx`. **MANDATORY `/ui-ux-pro-max` pre-flight before final commit** per `feedback_implementor_uses_ui_ux_pro_max.md`.
10. **Web bundle page** (≤2 hrs) — `app/connect-onboarding.tsx` per §4.5.4 + install `@stripe/connect-js` + `@stripe/react-connect-js` + verify Expo Web bundle compiles
11. **End-to-end smoke** (≤2 hrs) — all 22 SCs verified across iOS + Android + Expo Web sandbox (DISC-S4)
12. **CI grep gates** (≤2 hrs) — register I-PROPOSED-O + I-PROPOSED-P in strict-grep registry per Cycle 17b pattern + update `INVARIANT_REGISTRY.md` with DRAFT entries

**Total IMPL effort:** ~30 hrs (matches dispatch's ~28 hrs estimate; small overage for unit testing + Phase 0 verification).

---

## 7. Test cases matrix

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Happy path onboarding (sandbox) | Brand admin + valid sandbox Stripe account | Form completes; status flips active; banner gone | E2E |
| T-02 | Cancel mid-onboarding | User dismisses in-app browser before completion | Status stays not_connected; "Try again" button shown | Component |
| T-03 | Onboarding fails (Stripe rejects) | Sandbox brand with intentionally bad business info | Status flips restricted; banner shows red "Action required" | E2E |
| T-04 | Webhook account.updated → status flip | Stripe sends `account.updated` event | `stripe_connect_accounts` updated; `brands.stripe_*` mirrored; Realtime fires | Edge fn + DB |
| T-05 | Event publish blocked when not active | Brand with status='onboarding' tries to publish event | Publish blocked; banner directs to onboarding | Hook + Component |
| T-06 | Event publish allowed when active | Brand with status='active' publishes event | Publish succeeds | Hook + Component |
| T-07 | Idempotency: replayed webhook | Same `stripe_event_id` arrives twice | Second insert silently fails on unique idx; no double-processing | Edge fn |
| T-08 | Trigger sync: cache mirror | Webhook updates `stripe_connect_accounts.charges_enabled=true` | `brands.stripe_charges_enabled=true` mirrored within same transaction | DB |
| T-09 | Unique constraint: 1 account per brand | Two admins click "Set up payments" simultaneously | First succeeds; second hits ON CONFLICT DO UPDATE; same `stripe_account_id` returned | Edge fn + DB |
| T-10 | RLS: marketing_manager (rank below finance_manager) | Marketing manager tries `brand-stripe-onboard` | 403 forbidden; UI shows permission denied | Edge fn + RLS |
| T-11 | Deep link return: in-app browser → app | iOS native: complete onboarding → return | App re-opens to `/brand/[id]/payments` with refreshed status | E2E iOS |
| T-12 | Realtime invalidation | webhook event fires while user on payments page | UI updates without manual refresh | Realtime + Hook |
| T-13 | Mapper R-3 fix | `getBrand` returns row with `stripe_charges_enabled=true` | `Brand.stripeStatus` = 'active' (NOT 'not_connected' default) | Service |
| T-14 | TS twin parity | `deriveBrandStripeStatus` (TS) vs `pg_derive_brand_stripe_status` (SQL) | Same input → same output across 12+ test cases | Unit + DB |
| T-15 | Webhook signature verification | Send unsigned/bad-signature webhook | 400 rejected; no DB write | Edge fn |
| T-16 | Idempotency-Key on Stripe API | Inspect outbound HTTP request to Stripe | `Idempotency-Key` header present, format `{brand_id}:onboard_create:{epoch}` | Edge fn |
| T-17 | Audit log writes | Onboarding session created | `audit_log` row exists with action=`stripe_connect.onboard_initiated` | DB |
| T-18 | iOS smoke | Full onboarding on iPhone simulator | All 17 above pass on iOS | E2E iOS |
| T-19 | Android smoke | Full onboarding on Android emulator | All 17 above pass on Android | E2E Android |
| T-20 | Expo Web smoke | Full onboarding in Chrome browser at business.mingla.com | All 17 above pass on web | E2E Web |
| T-21 | Long-press gesture removed | Grep `BrandOnboardView.tsx` for `onLongPress` | Zero hits | Code grep |
| T-22 | API version pin | Grep `_shared/stripe.ts` for hardcoded API version | Exact `2026-04-30.preview` (or current `.preview` per Phase 0) | Code grep |

---

## 8. Invariants

### 8.1 Existing invariants preserved

- **I-31** (UI-only TRANSITIONAL) — released as actual EXIT post-B2a (Stripe onboarding is the EXIT)
- **I-32** (mobile-RLS rank parity) — `useBrandStripeStatus` permission gate matches DB RLS via `biz_can_manage_payments_for_brand_for_caller`
- **I-33** (`permissions_override` jsonb shape) — unchanged
- **I-37** (TopBar default cluster) — unchanged
- **I-38** (IconChrome touch target ≥44pt) — new BrandOnboardView Pressables comply via primitive default
- **I-39** (interactive Pressable accessibility label) — new BrandOnboardView Pressables comply
- **Constitutional #2** (one owner per truth) — `stripe_connect_accounts` canonical; `brands.stripe_*` mirror
- **Constitutional #3** (no silent failures) — every edge fn error surfaces to UI
- **Constitutional #4** (one query key per entity) — `brand-stripe-status` key prefix consistent
- **Constitutional #5** (server state stays server-side) — `Brand.stripeStatus` derived from server via React Query
- **Constitutional #8** (subtract before adding) — DELETE BrandOnboardView stub state machine before adding new flow
- **Constitutional #13** (exclusion consistency) — RLS gates Connect mutations identically across all 3 edge functions

### 8.2 New invariants ratified post-B2a CLOSE

#### I-PROPOSED-O — STRIPE-EMBEDDED-COMPONENTS-VIA-OFFICIAL-SDK-ONLY

**Text:** Mingla MUST NOT DIY-wrap `@stripe/connect-js` in `react-native-webview` / `WKWebView` / Android WebView. Connect Embedded Components are exposed via either: (a) Stripe's prescribed native preview SDK component (`@stripe/stripe-react-native` `<ConnectAccountOnboarding>` once GA), OR (b) Mingla-hosted web page rendering web SDK opened via `expo-web-browser` (system browser, sandboxed).

**Rationale:** Stripe explicitly prohibits embedded WebView wrapping per [docs.stripe.com/connect/get-started-connect-embedded-components](https://docs.stripe.com/connect/get-started-connect-embedded-components). Violations risk technical disable + Connect Platform Agreement breach.

**CI gate (per `feedback_strict_grep_registry_pattern.md`):**

- Allowlist 1: zero hits for `@stripe/connect-js` import paired with `react-native-webview` import in same file
- Allowlist 2: zero hits for `@stripe/connect-js` import in `app-mobile/` (consumer app — different scope)
- Allowed: `@stripe/connect-js` only in `mingla-business/app/connect-onboarding.tsx`; `@stripe/stripe-react-native` only in B3 PaymentSheet consumer (B3 future)

**Status:** DRAFT (pre-written) → ACTIVE on B2a CLOSE.

#### I-PROPOSED-P — STRIPE-STATE-CANONICAL-IS-CONNECT-ACCOUNTS

**Text:** `stripe_connect_accounts` is the SINGLE canonical source of truth for Connect state. `brands.stripe_charges_enabled`, `brands.stripe_payouts_enabled`, `brands.stripe_connect_id` are denormalized cache columns mirrored via DB trigger from `stripe_connect_accounts`. Direct UPDATE of `brands.stripe_*` by application code is FORBIDDEN — only the DB trigger writes them.

**CI gate:**

- Allowlist: zero hits for `update.*brands.*stripe_(connect_id|charges_enabled|payouts_enabled)` in `supabase/functions/` or `mingla-business/src/`
- Exemption: the trigger function `tg_sync_brand_stripe_cache` itself

**Status:** DRAFT (pre-written) → ACTIVE on B2a CLOSE.

---

## 9. Regression prevention

### 9.1 For the class of bugs B2a fixes

- **Class:** "stub UI hides missing backend" — Stripe state purely client-side fiction
- **Structural safeguard:** I-PROPOSED-P codifies single-source-of-truth via CI gate; eliminates accidental direct-write to denormalized cache. The DB trigger is the only writer.
- **Test catches recurrence:** SC-12 + T-13 verify `mapBrandRowToUi` populates from server; T-21 verifies long-press dev gesture removed (both code grep gates blocking PRs).

### 9.2 For the class of bugs B2a structurally prevents

- **Class:** "WebView wrap of @stripe/connect-js" — DIY embedding violation
- **Structural safeguard:** I-PROPOSED-O codifies official-SDK-only via CI gate; future cycle attempts blocked at PR.
- **Protective comment:** B2a SPEC + new invariant + DEC-114 all reference Stripe's published prohibition; comment in `app/connect-onboarding.tsx` cites I-PROPOSED-O.

### 9.3 For the class of bugs B2a structurally prevents (cont.)

- **Class:** "audit_log not written for state-changing operations" — orphan state transitions invisible to audit reviews
- **Structural safeguard:** SC-16 + dedicated `_shared/audit.ts` helper; pattern propagates to B3/B4 edge functions.
- **Test catches recurrence:** Edge function code review checklist (orchestrator REVIEW mode includes "are all state transitions audited?").

---

## 10. Discoveries surfaced during SPEC writing

These are observations the spec-writer surfaced during writing; some may need operator lock pre-IMPL:

### D-CYCLE-B2A-FOR-1 (S1, OPERATOR ACTION) — Restricted API Keys

Stripe security skill recommends using Restricted API Keys (RAK, prefix `rk_`) over secret keys (`sk_`) for the principle of least privilege. For B2a sandbox, `sk_test_*` is acceptable. For LIVE-mode launch (post-B2a), operator should:

1. Visit Stripe Dashboard → Developers → API Keys → "Restricted keys"
2. Create a RAK with permissions: `connect.write` + `payment_intents.write` + `account_sessions.write` + read scopes
3. Replace `STRIPE_SECRET_KEY` env var value with `rk_live_*` when going live

**Action:** Document in launch-readiness checklist; not blocking B2a sandbox IMPL.

### D-CYCLE-B2A-FOR-2 (S2, INFORMATIONAL) — Skill divergence on Express vs Standard

Stripe security skill states: *"Do not recommend Custom or Express accounts unless the user has a specific need — Standard is the safer default."* Mingla's DEC-112 explicitly chose Express equivalent (via controller properties in v2). **Rationale (already documented in DEC-112):** Standard requires brands to redirect to stripe.com for onboarding (violates R2 "embedded onboarding, not redirect"); Express+v2 controller pattern lets Mingla offer embedded onboarding while keeping brand-friendly Express dashboard.

**Action:** No action — DEC-112 is intentional + load-bearing. Documenting the divergence here so future agents reading the skill don't second-guess.

### D-CYCLE-B2A-FOR-3 (S2, IMPL HINT) — Webhook event types beyond account.updated

For B2a, `stripe-webhook` recognizes these event types but defers processing to B3/B4:

- `payout.created`, `payout.paid`, `payout.failed`, `payout.canceled`
- `charge.succeeded`, `charge.failed`, `charge.refunded`
- `application_fee.created`, `application_fee.refunded`
- `transfer.created`, `transfer.updated`

For each: insert into `payment_webhook_events` and mark `processed=true` with no further action. B3 IMPL adds the actual processing.

**Action:** B2a IMPL writes the recognition logic but no-ops the processing. B3 SPEC adds processing per event family.

### D-CYCLE-B2A-FOR-4 (S2, A1 verification) — Expo Web `@stripe/connect-js` compatibility

Untested at SPEC writing time. IMPL Phase 0 must verify that `@stripe/connect-js` loads cleanly under the Expo Web bundle (which uses React-Native-Web's React DOM compatibility shim). If conflicts emerge, fall back to either:

1. Bundling the connect-onboarding page as a standalone web entry (bypass RN-Web)
2. Hosting the onboarding page on a separate static-served URL (e.g., `mingla.com/connect-onboarding` instead of `business.mingla.com/...`)

**Action:** IMPL Phase 0 verification; if fallback needed, document in IMPL report and update web bundle page accordingly.

### D-CYCLE-B2A-FOR-5 (S1, A6 verification) — Deep link scheme

Mingla Business app deep link scheme `mingla-business://` must be registered in `app.config.ts`. Verify at IMPL Phase 0:

```typescript
// app.config.ts
export default {
  expo: {
    scheme: "mingla-business",
    // ...
  }
}
```

If scheme is missing OR uses a different value, register/update before component layer build (IMPL Phase 9).

**Action:** IMPL Phase 0 verification; trivial fix if missing.

### D-CYCLE-B2A-FOR-6 (S2, IMPL HINT) — Deep link with Stripe Account Session

Stripe's Account Session may have its own redirect-on-complete URL configuration that competes with `expo-web-browser.openAuthSessionAsync`'s deep-link handling. The flow specified in §4.2.2 step 11 builds a Mingla-hosted URL with `return_to` query param; Stripe's onExit callback fires on the Mingla-hosted page, which then redirects to the deep link. This is the cleanest pattern.

**Action:** IMPL Phase 10 verifies Stripe doesn't auto-redirect on completion in a way that breaks this flow; if it does, configure session with `return_url` pointing back to the same Mingla-hosted page.

### D-CYCLE-B2A-FOR-7 (S2, IMPL HINT) — `stripe_account_id` format

Stripe Connect v2 accounts use a different ID format than v1 — verify at IMPL Phase 0 whether v2 IDs are still `acct_*` or use a new `acc_*` prefix. The `stripe_connect_accounts.stripe_account_id` column is `text` so accommodates either; spec-aware code in mappers and CI gates may need adjustment if format differs.

**Action:** IMPL Phase 0 verification via curl response inspection.

### D-CYCLE-B2A-FOR-8 (S3, B5 PREP) — Hard-coded fee rates

`BrandFinanceReportsView.tsx` lines 27-30 reference hard-coded Mingla fee + Stripe fee rates that will become wrong post-B2a (real Stripe Connect Express UK is 2.9%+£0.30, not the placeholder 1.5%+£0.20). **NOT in scope for B2a per §3.2 non-goals.** Bundle into B5 marketing analytics rebuild OR a small ride-along ORCH if operator priorities shift.

**Action:** Tagged for B5; no B2a change.

### D-CYCLE-B2A-FOR-9 (S2, B3 PREP) — `currentBrandStore` orphan storage

Per spike DISC-7, post-B2a's React Query reads from `payouts`/`refunds` tables (B2b/B3), the `currentBrandStore` Zustand fields `payouts: BrandPayout[]` + `refunds: BrandRefund[]` + `availableBalanceGbp` + `pendingBalanceGbp` + `lastPayoutAt` become orphan storage. Persistent migration v12 → v13 should drop or repurpose. **NOT in scope for B2a; bundle into B3.**

**Action:** Flagged for B3 SPEC author.

### D-CYCLE-B2A-FOR-10 (S1, IMPL HINT) — Webhook async-vs-inline processing decision

§4.2.4 step 7 specifies inline processing for `account.updated` events. If IMPL Phase 0 reveals processing time ≥ 100ms (DB UPDATE + audit_log write + Realtime broadcast can be slow under load), escalate to async pattern: insert into `payment_webhook_events` and return 200 to Stripe immediately; separate processor edge function or pg_cron job handles `processed=false` rows.

**Action:** IMPL Phase 5 measures; if escalation needed, document in IMPL report and add async processor (small extension; ≤2 hrs).

---

## 11. Confidence summary

| Area | Confidence | What would raise it |
|---|---|---|
| Layer-by-layer SPEC completeness | **High** | All 7 layers + envvars covered with verbatim SQL, function bodies, hook signatures, component state machines |
| Schema migration correctness | **High** | Verified existing baseline-squash schema; additive-only migration; no breaking changes |
| Edge function logic | **High** | Mirrors Stripe official quickstart pattern + Stripe-best-practices skill recommendations |
| `@stripe/connect-js` Expo Web compatibility | **Medium** | A1 untested; fallback documented in §10 D-CYCLE-B2A-FOR-4 |
| Stripe API version pin (`2026-04-30.preview`) | **Medium** | Pinned at SPEC writing time; IMPL Phase 0 verification + bump if newer `.preview` exists |
| Deep link scheme registered | **Medium** | A6 untested; quick verification + fix in IMPL Phase 0 |
| Webhook async-vs-inline decision | **Medium** | Inline proposed; A0 measurement decides; fallback documented |
| Live POC against Stripe sandbox | **Low** (not done) | IMPL Phase 0 will run curl tests + deploy edge functions for live verification |
| Stripe Connect v2 account ID format | **Medium** | D-CYCLE-B2A-FOR-7 — verify in Phase 0 |

**Overall confidence: High-Medium.** The SPEC is comprehensive and binding for the implementor. Three medium-confidence items (A1, A3, A6) have explicit IMPL Phase 0 verification gates with documented fallbacks. No High-Risk gaps that block IMPL dispatch.

---

## 12. Done criteria for IMPL dispatch

The orchestrator REVIEW protocol must verify before dispatching IMPL:

- [ ] Operator has reviewed §10 discoveries and locked any S1+ items requiring decision (D-CYCLE-B2A-FOR-1 RAK timing; D-CYCLE-B2A-FOR-5 deep link verification timing)
- [ ] Operator has confirmed Stripe sandbox secret key + webhook signing secret available (D-CYCLE-B2A-FOR-1 + §4.8 environment variables)
- [ ] Operator has acknowledged 30-hour IMPL effort vs. 28-hour estimate
- [ ] Orchestrator REVIEW APPROVED on this SPEC

Once approved, orchestrator writes the IMPLEMENTOR dispatch prompt and operator dispatches.

---

**End of SPEC. BINDING — implementor cannot misinterpret.**
