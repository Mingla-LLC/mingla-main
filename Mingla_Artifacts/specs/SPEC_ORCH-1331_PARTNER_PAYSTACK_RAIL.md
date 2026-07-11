# SPEC — ORCH-1331 [partner program Nigeria/Paystack payout rail]

- **Date:** 2026-07-10
- **Mode:** SPEC (binding build contract; follows `Mingla_Artifacts/investigations/INVESTIGATION_PARTNER_PROGRAM_NIGERIA_SUPPORT.md`, whose citations were re-verified line-by-line for this SPEC)
- **Working tree:** `~/Desktop/mingla-orchs/orch-1331-[partner-paystack-rail]/` on branch `orch-1331-partner-paystack-rail` (rebased onto `origin/main` @ `7ae4966e1`)
- **Severity/class:** S2, missing-feature + architecture-flaw
- **Approved by Seth:** BUILD the Nigeria rail (not the hide-the-CTA scoping option)

---

## 1. Executive summary

Mingla partners earn a recurring split on brands they set up — but only on the Stripe rail. Nigeria settles exclusively through Paystack, so a Nigerian partner cannot add a bank and an NGN brand's ticket sales can never produce a partner split (the money leg fails silently; the partner lifecycle freezes at `awaiting_stripe`).

This SPEC builds the **Paystack partner payout rail**:

1. A Nigerian partner connects a **Paystack Transfer Recipient** (bank picker → 10-digit NUBAN → verified-name confirm) via a new `partner-paystack-onboard` edge function, stored in a new `partner_paystack_accounts` table (the Paystack twin of `partner_stripe_connect_accounts`).
2. When an NGN brand's ticket sale finalizes (`charge.success` → `biz_ticket_checkout_finalize`), a new fail-soft split engine (`_shared/paystackPartnerSplits.ts`) records a `partner_splits` row and pays the partner **10% of Mingla's persisted platform fee** via a **post-hoc Paystack Transfer from Mingla's balance** — the exact commercial math of the Stripe rail, mirrored to the kobo, always out of Mingla's cut and never the brand's.
3. The `partner_brand_links` lifecycle advances for Paystack owners: a new trigger stamps `owner_stripe_connected_at` (column NOT renamed — client contract) when `brands.paystack_subaccount_code` flips non-NULL; `first_split_at` fires from the existing `partner_splits` trigger unchanged.
4. The partner earnings screen (post-ORCH-1344 re-skin structure) offers **Nigeria** through the `BrandStripeCountryPicker` `extraOptions` slot, routing to a new NG bank-details form; `/partner/brands` labels go provider-neutral.

**Constitutional rule:** the split machinery is fail-soft end-to-end — a split failure can NEVER fail or delay a checkout, a webhook ack, or an order finalize.

---

## 2. Scope & non-goals

### In scope
- Partner Paystack identity (DB + edge fn + client onboarding form + status card).
- Paystack partner split engine (Option B — post-hoc Transfer; §4.1) + reversal/compensation story + retry sweep.
- `partner_brand_links` lifecycle for Paystack owners (trigger + backfill; no column renames).
- `paystack-webhook` wiring: fail-soft split fan-out on `charge.success`; routing for `transfer.success|failed|reversed` and `refund.processed`.
- Mutual-exclusivity guard: one payout rail per partner (Stripe XOR Paystack) — small additive guards in `partner-stripe-onboard` and the new `partner-paystack-onboard`.
- Client: earnings screen NG path, split badge for `blocked_no_paystack`, provider-neutral copy on `/partner/brands` + earnings.

### Non-goals (explicit — DO NOT build)
- **No consumer-app (`app-mobile/`) changes.**
- **No change to Stripe-rail behavior** — `_shared/partnerSplits.ts`, `stripeWebhookRouter.ts` charge.succeeded/refund routing, `partner-stripe-account-session`, `partner-stripe-detach` are functionally untouched (only the additive exclusivity guard in `partner-stripe-onboard`).
- **No NGN↔other-currency FX** — the Paystack rail is NGN-only, zero FX (mirrors I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY).
- **No change to brand-owner payouts** — the checkout `subaccount` + `transaction_charge` deferred-split in `ticket-checkout-create` is NOT modified.
- **ORCH-1332 [dead `partner_can_accept_brand` currency gate] is OUT OF SCOPE.** The live accept RPC calls no gate; we change nothing there. **Forward note for ORCH-1332:** when the gate is restored it MUST be provider-aware — an NGN brand + a partner with an active `partner_paystack_accounts` row (currency NGN) MUST pass; keying the restored gate solely on `partner_stripe_connect_accounts.external_account_currencies` would re-break Nigeria.
- **No ticket `refund-order` Paystack support** (a separate gap — `refund-order/index.ts` has zero Paystack branches today). We only handle the `refund.processed` webhook defensively (dashboard-issued refunds fire it regardless).
- **No admin-console surface** for Paystack partner rows (admin reads `partner_splits` through existing paths; META-ORCH-1237 owns admin).
- **No Ghana/GHS** — NG/NGN only.

### Assumptions
- Paystack integration is LIVE mode (real money). No live API calls during build/test — mocked fetch only (§ Verification cap).
- `resolve_partner_for_brand_at_time`, `record/mark_partner_split_*` RPCs, and the ORCH-1081 `first_split` triggers are provider-agnostic where noted and are reused, not duplicated.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | Behavior demanded | Files touched | Parity |
|---|---------|----------|-------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NOT covered | none — partner program is business-app only | — | n/a |
| 2 | Consumer Android (`app-mobile/`) | NOT covered | none — same | — | n/a |
| 3 | Buyer/anonymous Web (checkout `/checkout/{eventId}`, `/e/…`) | NOT covered (must be UNCHANGED) | NGN buyer checkout behaves byte-identically; split engine runs after finalize, fail-soft | none client-side; `paystack-webhook` backend only | automatic (backend) |
| 4 | Business iOS | **Covered** | NG appears in partner country picker → NG bank form → status card; `blocked_no_paystack` badge; provider-neutral labels | `app/partner/earnings.tsx`, `app/partner/brands.tsx`, new `src/components/partner/PartnerPaystackOnboardForm.tsx`, new service/hook, `partnerSplitsService.ts` | automatic with Android (shared RN code) |
| 5 | Business Android | **Covered** | same as iOS (shared code); bank-picker keyboard clearance per I-KEYBOARD-DONE-BAR pattern already in `BrandPaystackOnboardView` — mirror it | same files | automatic (shared code) |
| 6 | Admin Web (`mingla-admin/`) | NOT covered | admin continues reading `partner_splits` via existing definer RPCs; new columns are additive so `admin_get_order` etc. are unaffected | — | n/a (additive schema) |
| 7 | Business Web preview | **Covered incidentally** | earnings screen renders on web via the same RN code; Paystack form works (plain form, no WebBrowser dependency) | same files | automatic (shared code) |

Backend (edge fns + DB) is a shared substrate: `supabase/` changes below.

---

## 4. Layered specification

### 4.1 CORE ARCHITECTURE DECISION — Option B: post-hoc Transfer from Mingla's Paystack balance (BINDING)

**Option A (rejected): charge-time dynamic multi-split.** Paystack supports a dynamic `split` object on `POST /transaction/initialize` (`{type, currency, subaccounts:[{subaccount, share}], bearer_type, …}`) — docs: https://paystack.com/docs/payments/multi-split-payments/ and https://paystack.com/docs/api/split/. Rejected because:

1. **It rewrites the LIVE NGN checkout.** The production initialize call (`ticket-checkout-create/index.ts:753-776`) uses the single-`subaccount` + flat-`transaction_charge` form. `transaction_charge`/`bearer` are companions of the single-subaccount form; a partner share requires switching to the multi-split `split` object — a structural change to the live money path, conditional on per-partner onboarding state. A malformed split (partner not yet onboarded, share rounding, subaccount inactive) fails the **initialize** call → breaks ticketing. That violates the constitutional fail-soft rule by construction.
2. **It breaks accounting parity.** The Stripe rail's ledger (`partner_splits`) records the partner share as a **post-charge payment out of Mingla's fee** (`partnerSplits.ts:270`), with `blocked_no_stripe` / `blocked_currency_mismatch` rows when the partner isn't payable and reversal rows on refund. A charge-time split has no "blocked" concept (the share is either carved at initialize or lost), pins the partner at initialize-time rather than charge-time, and makes the partner's cut come out of the *split* (i.e. reduces what routes through Mingla's own share only if `share` math is perfect per transaction — with subaccount settlement directly to the partner's bank and no ledger row of ours in the loop).
3. **Refund semantics are opaque.** Paystack claws refunds from the merchant balance (`deducted_amount`/`fully_deducted`); how a third split-party's already-settled share is recovered is not controllable by us. Post-hoc transfers give us the exact Stripe-mirror reversal ledger (with one honest exception, §4.5.6).

**Option B (BINDING): on verified `charge.success` + successful finalize, record a `partner_splits` row and pay the partner via `POST /transfer` (source: `balance`) to a pre-created Transfer Recipient.** This mirrors `_shared/partnerSplits.ts` semantics 1:1: same share math, same ledger table, same block reasons, same idempotency discipline, checkout untouched.

**Known costs of B (accepted, mitigated):**
- **Balance funding.** Paystack validates `amount + transfer fee ≤ balance` before a transfer (https://paystack.com/docs/api/transfer/, corroborated via the PaystackHQ GitHub docs mirror `sending-money/initiating-a-transfer.md`). Mingla's `transaction_charge` cut settles per the integration's settlement schedule — with default auto-settlement it lands in the **bank**, not the balance. Operational prerequisite (OPS-1, §10): either enable **Manual Payouts** (funds held in Paystack Balance — https://support.paystack.com/en/articles/2131074) or maintain an NGN float via top-up. The engine is built so this never strands money: insufficient-balance transfer failures leave the row `pending` and the retry sweep (§4.7) re-attempts.
- **OTP.** Single API transfers require OTP unless disabled ("Confirm transfers before sending" on the Dashboard Preferences page, or the Transfer Control API `POST /transfer/disable_otp` → `POST /transfer/disable_otp_finalize`; https://paystack.com/docs/transfers/single-transfers/ + https://paystack.com/docs/api/transfer-control/). Operational prerequisite (OPS-2, §10). If a transfer returns `status: "otp"` the engine treats it as a **retryable operational block**: row stays `pending`, ops-alert email fires once per row.
- **Transfer fees.** Paystack charges ₦10/₦25/₦50 per NGN transfer by amount tier (https://paystack.com/pricing — verify tier bounds in-browser); borne by Mingla's balance on top of the share. At 10%-of-1.5% share sizes this is material on tiny orders — accepted for launch (parity > optimization); flagged in the risk register.
- **No claw-back for completed transfers.** Paystack has no transfer-reversal API (`transfer.reversed` is a *bank-initiated* return). Honest compensation path bound in §4.5.6.

**Paystack API surface used (each verified against official sources; `paystack.com/docs/*` pages 403 automated fetchers — facts corroborated via the PaystackHQ GitHub docs mirror, the official Postman workspace, and support.paystack.com, per the established convention in `Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md`):**

| Endpoint | Params we send | Doc URL |
|---|---|---|
| `GET /bank?country=nigeria&currency=NGN&type=nuban` | — (existing helper `paystackListBanks`) | https://paystack.com/docs/api/miscellaneous/#bank |
| `GET /bank/resolve?account_number=&bank_code=` | — (existing helper `paystackResolveAccount`) | https://paystack.com/docs/api/verification/#resolve-account |
| `POST /transferrecipient` | `type:"nuban"`, `name` (= resolved `account_name`), `account_number`, `bank_code`, `currency:"NGN"` → `recipient_code` (`RCP_…`) | https://paystack.com/docs/api/transfer-recipient/ (mirror: `sending-money/initiating-a-transfer.md`) |
| `DELETE /transferrecipient/{code}` | best-effort on disconnect | https://paystack.com/docs/api/transfer-recipient/#delete |
| `POST /transfer` | `source:"balance"`, `amount` (kobo), `recipient` (`RCP_…`), `reason`, `reference` (OUR idempotency key), `currency:"NGN"` → `transfer_code` (`TRF_…`), `status` (`pending`\|`success`\|`otp`) | https://paystack.com/docs/api/transfer/ |
| `GET /transfer/{code}` | reconcile in sweep | https://paystack.com/docs/api/transfer/#fetch |
| Webhooks `transfer.success` / `transfer.failed` / `transfer.reversed` | routed in `paystack-webhook` | https://paystack.com/docs/payments/webhooks/ |
| Webhook `refund.processed` (+ `refund.failed` ignored-with-audit) | routed in `paystack-webhook` | https://paystack.com/docs/payments/webhooks/ + https://paystack.com/docs/api/refund/ |

**Transfer idempotency contract:** Paystack has no `Idempotency-Key` header; the transfer `reference` IS the idempotency key ("If you are retrying a transfer, use the same reference" — single-transfers doc). BINDING: `reference = "psplit_" + partner_splits.id + "_a" + attempt_count`. `attempt_count` increments ONLY after a *definitive* failure (`transfer.failed` webhook, or a synchronous non-ambiguous 4xx that names the transfer unprocessable); ambiguous outcomes (timeout, 5xx, 429) re-use the same reference so a duplicate can never pay twice.

### 4.2 Database — migration `20261228000000_orch_1331_partner_paystack_rail.sql` (ONE file)

**Version-prefix collision scan (performed 2026-07-10):** latest migration on merged `origin/main` = `20261227000000_orch_1338_p2_revoke_anon_execute.sql`; scanned every active worktree under `~/Desktop/mingla-orchs/*/supabase/migrations/` — highest in-flight version anywhere is `20261227000000` (all other trees are stale ≤ `20261210000000`). **Chosen prefix: `20261228000000`** (monotonic, unclaimed). Implementor MUST re-run the scan (`git fetch origin && ls` across worktrees) at implementation time and bump to the next free day-prefix if claimed by a parallel session.

All DDL idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / guarded `DO $$`). Wrapped in `BEGIN; … COMMIT;` with read-only probes at the end (ORCH-1081 pattern).

#### 4.2.1 `partner_paystack_accounts` (new table — the Paystack twin of `partner_stripe_connect_accounts`)

```sql
CREATE TABLE IF NOT EXISTS public.partner_paystack_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.creator_accounts(id) ON DELETE CASCADE,
  recipient_code text NOT NULL,            -- Paystack RCP_…
  bank_code text NOT NULL,
  bank_name text,
  account_number_last4 text NOT NULL,      -- NEVER the full NUBAN
  account_name text NOT NULL,              -- resolved holder name snapshot
  country text NOT NULL DEFAULT 'NG' CHECK (country = 'NG'),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  detached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- Constraints (DROP IF EXISTS + ADD, ORCH-1052 pattern): `UNIQUE (account_id)` (one Paystack payout identity per partner) and `UNIQUE (recipient_code)`.
- Index: `partner_paystack_accounts_account_id_idx ON (account_id)`.
- **PII rule:** the FULL account number is NEVER stored — only `account_number_last4`. The full NUBAN lives only in Paystack (recipient object). Table + column COMMENTs must say so.
- **RLS** (inline EXISTS per `feedback_rls_returning_owner_gap.md`; mirrors `partner_stripe_self_select` in `20260822000000_…:102-114` as reconciled by META-ORCH-1237 to `is_admin_user()`):

```sql
ALTER TABLE public.partner_paystack_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_paystack_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY partner_paystack_self_select ON public.partner_paystack_accounts
  FOR SELECT USING (account_id = auth.uid() OR public.is_admin_user());
-- NO INSERT/UPDATE/DELETE policies — service role only (edge fn mediates).
```

#### 4.2.2 `partner_splits` — provider generalization (additive ONLY; no renames)

```sql
ALTER TABLE public.partner_splits
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe','paystack')),
  ADD COLUMN IF NOT EXISTS payout_reference text,     -- Paystack transfer reference (psplit_<id>_a<n>); NULL on stripe rows
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reversal_owed_at timestamptz;  -- §4.5.6 honest no-claw-back marker
```

- Widen the status CHECK (DROP the existing `partner_splits_status_check` constraint by introspected name via `DO $$` + re-ADD) to: `('pending','transferred','blocked_currency_mismatch','blocked_no_stripe','blocked_no_paystack','failed','reversed','reversed_pending')`. **Widen-only; every existing row remains valid.**
- **Column reuse (BINDING, precedented by the Paystack rail reusing `stripe_payment_intent_id`/`stripe_event_id` slots):**
  - `stripe_application_fee_id` (the UNIQUE idempotency key) holds `'paystack:' || <transaction reference>` for Paystack rows. The Paystack transaction reference is unique per charge (persisted as `ticket_checkout_sessions.stripe_payment_intent_id`, UNIQUE — `ticket-checkout-create/index.ts:708-713`), so uniqueness holds. Update the column COMMENT.
  - `stripe_transfer_id` holds the Paystack `transfer_code` (`TRF_…`) for Paystack rows. Update the column COMMENT.
- All four existing state-transition RPCs (`record_partner_split_attempt`, `mark_partner_split_transferred`, `mark_partner_split_failed`, `mark_partner_split_reversed` — `20260823000000_…:179-337`) key on the UNIQUE text column and are **reused unchanged**, EXCEPT:
  - `mark_partner_split_failed` (`:280-303`): the CASE allowlist must learn `'blocked_no_paystack'` — `CREATE OR REPLACE` with `p_reason IN ('blocked_currency_mismatch','blocked_no_stripe','blocked_no_paystack','failed')`. Same signature; latest definition wins.
  - **New RPC** `record_paystack_partner_split_attempt(p_reference text, p_order_id uuid, p_brand_id uuid, p_partner_account_id uuid, p_mingla_fee_cents integer, p_partner_share_cents integer) RETURNS jsonb` — SECURITY DEFINER, `SET search_path TO 'public','pg_temp'`, GRANT EXECUTE to `service_role` ONLY (REVOKE FROM PUBLIC). Body mirrors `record_partner_split_attempt` (`:179-233`) but inserts `provider='paystack'`, `transfer_currency='ngn'`, `stripe_application_fee_id = 'paystack:'||p_reference`, `ON CONFLICT DO NOTHING`, returns `{id, status, stripe_transfer_id, attempt_count, payout_reference}`.
  - **New RPC** `mark_paystack_partner_split_attempted(p_key text, p_payout_reference text, p_transfer_code text) RETURNS void` — stamps `payout_reference` + `stripe_transfer_id` (transfer_code) while status stays `pending` (transfer initiated, awaiting `transfer.success`). Service-role only.
  - **New RPC** `bump_paystack_partner_split_attempt(p_key text, p_error text) RETURNS void` — `attempt_count = attempt_count + 1`, `error_message = p_error`, status unchanged (`pending`). Service-role only.

#### 4.2.3 `partner_brand_links` lifecycle for Paystack owners (NO renames — client `deriveLinkStatus` reads `owner_stripe_connected_at` at `partnerBrandLinksService.ts:55-63`)

**Decision (BINDING):** stamp the SAME column. `owner_stripe_connected_at` semantically becomes "owner payout rail connected"; renaming would break the deployed client. Update the column COMMENT to document the generalized meaning.

New trigger, mirroring `partner_brand_links_mark_stripe_connected` (`20260920000000_…:182-207`):

```sql
CREATE OR REPLACE FUNCTION public.partner_brand_links_mark_paystack_connected()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF NEW.paystack_subaccount_code IS NOT NULL
     AND (OLD.paystack_subaccount_code IS DISTINCT FROM NEW.paystack_subaccount_code)
     AND OLD.paystack_subaccount_code IS NULL
  THEN
    UPDATE public.partner_brand_links
       SET owner_stripe_connected_at = COALESCE(owner_stripe_connected_at, now())
     WHERE brand_id = NEW.id AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS partner_brand_links_paystack_connected_trigger ON public.brands;
CREATE TRIGGER partner_brand_links_paystack_connected_trigger
  AFTER UPDATE OF paystack_subaccount_code ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.partner_brand_links_mark_paystack_connected();
```

- **Backfill (one statement, defensive):** stamp `owner_stripe_connected_at = COALESCE(owner_stripe_connected_at, now())` on active `partner_brand_links` rows whose brand already has `paystack_subaccount_code IS NOT NULL` (expected 0 rows today).
- **`first_split_at`: NO CHANGE.** The ORCH-1081 triggers fire on `partner_splits.status → 'transferred'` regardless of provider (`20260920000000_…:117-172`) — a Paystack split marked transferred stamps it automatically.

#### 4.2.4 Retry-sweep cron (in the same migration)

Mirror `20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql:62-82` exactly: `cron.schedule('orch_1331_partner_paystack_split_retry', '*/30 * * * *', … net.http_post(vault supabase_url || '/functions/v1/partner-paystack-split-retry', Authorization: Bearer vault service_role_key …))`. Guarded `DO $$` probe that the schedule row exists.

#### 4.2.5 Probes (end of migration)

`DO $$` checks: table exists; `partner_splits.provider` column exists; the widened CHECK admits `'blocked_no_paystack'` (assert via `pg_constraint` definition text); both triggers exist; cron row exists. RAISE EXCEPTION on any miss.

### 4.3 Shared Paystack client helpers — MODIFY `supabase/functions/_shared/paystack.ts` (additive)

Follow the exact house shape (secret via `resolvePaystackSecretKey()`, `recordApiCall("paystack", …)` timing hook, `{status,message,data}` envelope check, throw `Error` with status+message):

- `paystackCreateTransferRecipient(params: { name: string; accountNumber: string; bankCode: string }): Promise<{ recipient_code: string; details?: … }>` — `POST /transferrecipient` body `{type:"nuban", name, account_number, bank_code, currency:"NGN"}`.
- `paystackDeleteTransferRecipient(recipientCode: string): Promise<void>` — `DELETE /transferrecipient/{code}`; caller treats failure as non-fatal.
- `paystackInitiateTransfer(params: { amountSubunits: number; recipientCode: string; reference: string; reason: string }): Promise<{ transfer_code: string; status: string; reference: string }>` — `POST /transfer` body `{source:"balance", amount, recipient, reference, reason, currency:"NGN"}`.
- `paystackFetchTransfer(codeOrId: string): Promise<Record<string, unknown>>` — `GET /transfer/{code}` (sweep reconcile).

### 4.4 Edge function — NEW `supabase/functions/partner-paystack-onboard/index.ts`

Multiplexed by `action` (mirrors `brand-paystack-onboard` structure + `partner-stripe-onboard` gates). **Auth:** Bearer JWT → `resolveUserId` (getUser) → load `creator_accounts` → `partner_enabled === true` gate (`403 {error:"forbidden", detail:"not_a_partner"}` — exact parity with `partner-stripe-onboard/index.ts:187-192`). CORS headers: same literal object as `brand-paystack-onboard/index.ts:52-56` (`authorization, x-client-info, apikey, content-type` — the x-client-info entry is mandatory). OPTIONS → 200. Non-POST → 405.

| action | Input | Behavior | Success response | Errors |
|---|---|---|---|---|
| `list_banks` | — | `paystackListBanks({country:"nigeria",currency:"NGN",type:"nuban"})`, slim to `{name,code}` | `{banks:[…]}` | 502 `banks_unavailable` on Paystack error |
| `resolve_account` | `account_number` (10-digit NUBAN regex, exact `isValidNuban` from brand fn), `bank_code` (non-empty string) | `paystackResolveAccount` | `{account_name, account_number}` | 400 `account_number_must_be_10_digits` / `bank_code_required`; 422 `account_unresolved` |
| `create_recipient` | `account_number`, `bank_code` | (1) **exclusivity guard**: active `partner_stripe_connect_accounts` row (`stripe_account_id` non-null AND `detached_at IS NULL`) → `409 {error:"conflict", detail:"stripe_already_connected"}`. (2) resolve name (422 on fail). (3) `paystackCreateTransferRecipient` (`name` = resolved `account_name`). (4) service-role UPSERT `partner_paystack_accounts` `onConflict:"account_id"` (recipient_code, bank_code, bank_name from the picker echo param `bank_name` optional, account_number_last4, account_name, detached_at:null, updated_at). (5) UPDATE `creator_accounts.partner_country='NG'` (non-fatal on error, log — parity with `partner-stripe-onboard:277-287`). (6) `writeAudit` `partner_paystack.recipient_created` (no full account number in payload — last4 only). | `{recipient_code, account_name, account_number_masked:"••••<last4>", currency:"NGN"}` | 502 `recipient_create_failed`; 500 `internal_error` |
| `status` | — | read own `partner_paystack_accounts` row (service role, keyed `account_id=userId`) | `{connected, bank_name, bank_code, account_number_masked, account_name, detached_at}` (`connected:false` shape when absent/detached) | 500 |
| `disconnect` | — | soft-detach: `detached_at=now()`, best-effort `paystackDeleteTransferRecipient` (log-only on failure — mirrors `partner-stripe-detach` semantics), audit `partner_paystack.recipient_detached` | `{disconnected:true}` | 500 |

- **Idempotency:** `create_recipient` re-run replaces the row via UPSERT (recipient re-created; the old recipient is deleted best-effort first when a previous `recipient_code` exists). `disconnect` on absent row → `{disconnected:true}` (no-op success).
- **config.toml:** add `[functions.partner-paystack-onboard] verify_jwt = true` (mirrors `partner-stripe-onboard`, `config.toml:224-225`).

**MODIFY `partner-stripe-onboard/index.ts` (additive guard only):** after the partner_enabled gate and before account create/reuse, read `partner_paystack_accounts` for `userId`; if a row exists with `recipient_code` non-null AND `detached_at IS NULL` → `409 {error:"conflict", detail:"paystack_already_connected"}`. Nothing else changes.

### 4.5 Split engine — NEW `supabase/functions/_shared/paystackPartnerSplits.ts`

Deno module, dependency-injected `fetch`-level Paystack helpers (mirrors `PaystackVerifier` injection in `paystackWebhookRouter.ts:27-29`) so tests stub the network deterministically. Exports:

#### 4.5.1 `handlePaystackPartnerSplit(supabase, args: { reference: string; orderId: string; paidAtIso: string | null }): Promise<PaystackSplitResult>`

Called from `paystack-webhook` AFTER a `charge.success` finalize resolves (`finalized` OR `replayed` — replay re-entry is safe and gives us webhook-redelivery retries; the ledger UNIQUE key dedupes). Steps (each mirrors `partnerSplits.handleChargeSucceeded`, `partnerSplits.ts:216-453`):

1. **Fee lookup (the commercial source of truth):** read `orders.stripe_application_fee_amount_cents` for `orderId` (populated by `biz_ticket_checkout_finalize` copying `ticket_checkout_sessions.stripe_application_fee_amount_cents` — latest finalize definition `20261117000001_orch_1188_…:180-199`; the session value is `psSubtotal.miglaFeeCents`, i.e. Mingla's take-rate skim, set at `ticket-checkout-create/index.ts:699,713` and ridden as the Paystack flat `transaction_charge` at `:773`). If NULL/0 → return `{status:"no_application_fee"}` (mirror of `partnerSplits.ts:229-233`: no Mingla fee → nothing to split; **the partner share NEVER comes from the brand's share** — I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE).
2. **Brand:** `orders → events → brands.id` — reuse the identical join used at `partnerSplits.ts:128-148` (orders has NO brand_id column; do not invent one).
3. **Partner pin:** `resolve_partner_for_brand_at_time(p_brand_id, p_at = paidAtIso ?? now())` (`20260823000000_…:142-164` — provider-agnostic). NULL → `{status:"no_partner"}`.
4. **Share math (EXACT Stripe mirror, to the kobo):** `partnerShareKobo = Math.round(minglaFeeKobo * PARTNER_SHARE_OF_FEE)` where `PARTNER_SHARE_OF_FEE` is **imported from `_shared/partnerSplits.ts:45`** (`0.10`) — ONE constant, never duplicated. `Math.round`, not floor (`partnerSplits.ts:269-270` "so we don't steal a cent").
5. **Record attempt first:** `record_paystack_partner_split_attempt(reference, orderId, brandId, partnerAccountId, minglaFeeKobo, partnerShareKobo)`. If prior status is `transferred`/`reversed`/`reversed_pending` → return (webhook replay, mirrors `partnerSplits.ts:289-293`).
6. **Eligibility:** read `partner_paystack_accounts` for the partner. No row / no `recipient_code` / `detached_at` non-null → `mark_partner_split_failed(key, 'blocked_no_paystack', 'Partner has no active Paystack payout account.')` → `{status:"blocked_no_paystack"}`. Verified charge currency ≠ `NGN` (defensive; checkout already hard-gates NGN at `ticket-checkout-create/index.ts:659-669`) → `mark_partner_split_failed(key,'blocked_currency_mismatch',…)`. **Zero FX:** `transfer_currency` is always `'ngn'` = the charge currency.
7. **Transfer attempt:** `attemptTransferForSplit` (below). Any throw is caught by the CALLER's fail-soft wrapper — this module may throw internally but the webhook wiring (§4.6) guarantees ticketing is never affected.

`PaystackSplitResult.status ∈ {"transferred","pending","blocked_no_paystack","blocked_currency_mismatch","no_partner","no_application_fee","no_order","failed"}`.

#### 4.5.2 `attemptTransferForSplit(supabase, paystack, row): Promise<"transferred"|"pending"|"failed">`

1. `reference = "psplit_" + row.id + "_a" + row.attempt_count` (§4.1 idempotency contract).
2. `paystackInitiateTransfer({ amountSubunits: row.partner_share_cents, recipientCode, reference, reason: "Mingla partner share for order <orderId>" })`.
3. Response `status === "success"` → `mark_partner_split_transferred(key, transfer_code)` (existing RPC; flips `pending→transferred`, trigger stamps `first_split_at`) → fire the first-split push EXACTLY as the Stripe rail does (`partnerSplits.ts:351-430`): same `stampedRecently` 30s window on `partner_brand_links.first_split_at`, same `dispatchNotification` call (`business.partner_first_split`, idempotencyKey `business.partner_first_split:<partner>:<brand>`, deepLink `mingla-business://partner/earnings`), wrapped in its own best-effort try/catch.
4. Response `status === "pending"` → `mark_paystack_partner_split_attempted(key, reference, transfer_code)`; row remains `pending` until `transfer.success` arrives (§4.5.4).
5. Response `status === "otp"` → OTP not disabled (OPS-2 unmet): `bump` is NOT called (do not burn an attempt); leave `pending` with `error_message='otp_required'` via `bump_paystack_partner_split_attempt(key,'otp_required')` **without** incrementing? — NO: BINDING: write the error via a direct service-role update of `error_message` only; `attempt_count` unchanged; send ONE ops-alert email via `sendOpsAlertEmail` (`_shared/stripeOpsAlertEmail.ts:37`) with subject `"[Mingla ops] Paystack partner transfer blocked: OTP enabled"` (dedupe: only when `error_message` was not already `otp_required`).
6. Synchronous error containing an insufficient-balance/insufficient-funds message or HTTP 5xx/429 → retryable: leave `pending`, `error_message` updated (no attempt bump — ambiguous/ retryable failures keep the same reference).
7. Synchronous definitive 4xx (invalid recipient, malformed) → `bump_paystack_partner_split_attempt(key, msg)`; if `attempt_count + 1 >= 5` → `mark_partner_split_failed(key, 'failed', msg)` + ops alert; else leave `pending` (sweep retries with the NEW reference).

#### 4.5.3 `handlePaystackTransferEvent(supabase, eventName, data): Promise<void>`

Match `data.reference` (prefix `psplit_`) → parse split row id → load row (service role). Non-matching references: no-op (future non-partner transfers unaffected).
- `transfer.success` → `mark_partner_split_transferred(key, data.transfer_code)` (idempotent — RPC only flips `pending|failed`) + the first-split push block (same as §4.5.2.3; the idempotent notify key collapses duplicates).
- `transfer.failed` → definitive failure: `bump_paystack_partner_split_attempt(key, reason)`; if `attempt_count >= 5` → `mark_partner_split_failed(key,'failed',reason)` + ops alert; else row stays `pending` (sweep retries with new reference).
- `transfer.reversed` (bank returned funds AFTER success) → funds are back in Mingla's balance: if row is `transferred`, set it back to `pending` via direct service-role update (`status='pending'`, `transferred_at` preserved-nulled? — BINDING: `status='pending'`, `error_message='transfer_reversed_by_bank'`, `transferred_at=NULL`, `stripe_transfer_id=NULL`, `attempt_count+1`) + ops alert; the sweep re-attempts (partner may need to fix their bank; after cap → `failed`). NOTE: if `first_split_at` was already stamped it stays (COALESCE semantics; acceptable — the money will be re-sent or ops-resolved).

#### 4.5.4 `handlePaystackRefundProcessed(supabase, data): Promise<void>`

`data.transaction_reference` (verify the exact field name against a live payload during implementation; the refund object carries the parent transaction reference — flag `[verify-in-webhook-log]`) → key = `'paystack:'||reference` → load split row; absent → return.
- Row status ∈ `{pending, blocked_*, failed}` → `mark_partner_split_reversed(key, NULL)` → `'reversed_pending'` (money never left; the sweep only selects `pending`, so payment is permanently prevented — mirrors `partnerSplits.ts:562-569`).
- Row status = `transferred` → **NO claw-back exists** (honest statement: Paystack cannot reverse a completed transfer; `transfer.reversed` is bank-initiated only). Compensating action (BINDING): stamp `reversal_owed_at = COALESCE(reversal_owed_at, now())` (direct service-role update), `writeAudit` `paystack.partner_split_reversal_owed` with `{split_id, order_id, partner_account_id, partner_share_cents}`, and `sendOpsAlertEmail` to `seth@usemingla.com` — subject `"[Mingla ops] Partner split reversal owed (NGN refund after payout)"`. Recovery (netting against the partner's future splits or off-platform recovery) is an ops action, NOT automated in this ORCH. The row's partner-visible status remains `transferred` (the ledger never lies).
- `refund.failed` / `refund.pending` / `refund.processing` → audit no-op rows only (`paystack.webhook_unhandled_refund_state`).

### 4.6 Webhook wiring — MODIFY `supabase/functions/paystack-webhook/index.ts` (fail-soft, BINDING)

1. **`charge.success` split fan-out.** In the existing routing block, AFTER `handlePaystackChargeSuccess` returns (`index.ts:167-175`), when `result.status === "finalized" || result.status === "replayed"`, and an `orderId` resolved: call `handlePaystackPartnerSplit` **inside its own try/catch whose catch ONLY logs** (`console.error("[paystack-webhook] partner split fan-out failed (non-fatal)", …)`). It MUST NOT set `processingError`, MUST NOT change the ack status, MUST NOT run before `dispatchTicketConfirmation`. Pass `reference`, `orderId`, and `paidAtIso` from the verified txn (`txn.paid_at`) — plumb `paidAt` through `PaystackChargeResult` (additive optional field in `paystackWebhookRouter.ts:31-40`) or re-derive from `data.paid_at`; BINDING: extend `PaystackChargeResult` with optional `paidAtIso?: string`.
   - **Constitutional restatement:** a split failure NEVER breaks ticketing. The ONLY code allowed to throw into `processingError` for `charge.success` remains the existing finalize path.
2. **New event routing** (same `try` block that sets `processingError` — these events have no ticketing consequence, so inbox-retry semantics are safe and desirable):
   - `transfer.success` | `transfer.failed` | `transfer.reversed` → `handlePaystackTransferEvent`.
   - `refund.processed` → `handlePaystackRefundProcessed`.
   - All other events keep the existing `paystack.webhook_unhandled_event` audit no-op.
   - Inbox idempotency keys already derive as `paystack:<event>:<reference>` (`index.ts:114`) — transfer events carry their own `data.reference` (our `psplit_…`), so keys are stable. NO change to signature verification (`x-paystack-signature`, HMAC-SHA512, raw body — untouched).

### 4.7 Retry sweep — NEW `supabase/functions/partner-paystack-split-retry/index.ts`

Mirror `reconcile-stuck-checkouts` exactly for auth + shape: `verify_jwt = false` in config.toml, first statement guards `req.headers.authorization` contains `SUPABASE_SERVICE_ROLE_KEY` (`reconcile-stuck-checkouts/index.ts:29-31`), else 401. Logic:

1. Select up to 20 `partner_splits` rows: `provider='paystack' AND status='pending' AND created_at < now()-'10 minutes' AND attempt_count < 5`, oldest first.
2. For each row: if `stripe_transfer_id` (transfer_code) present → `paystackFetchTransfer(code)` reconcile first (status `success` → mark transferred + push block; `failed`/`reversed` → per §4.5.3; `pending`/`otp` → skip). Else → `attemptTransferForSplit`.
3. Per-row try/catch; one row's failure never stops the sweep. Response `{scanned, transferred, retried, skipped, failed}` for cron observability.
4. Rows at `attempt_count >= 5` are finalized `failed` + single ops alert (idempotent via `error_message` marker).

Cron cadence `*/30 * * * *` (§4.2.4). This is the mechanism that absorbs T+1 balance funding (§4.1) — a split created at sale time is typically paid by the sweep within one cycle after settlement lands.

### 4.8 Client — services & hooks (mingla-business)

**NEW `src/services/partnerPaystackService.ts`** (mirror `brandPaystackService.ts` shape incl. `unwrapError`):
- `partnerPaystackKeys = { all:["partnerPaystack"], status:()=>[…,"status"] }` (query-key factory — no hardcoded strings at call sites).
- `getPartnerPaystackStatus(): Promise<PartnerPaystackStatusRow>` → invoke `partner-paystack-onboard` `{action:"status"}`. Row: `{connected:boolean; bank_name:string|null; bank_code:string|null; account_number_masked:string|null; account_name:string|null; detached_at:string|null}`.
- `listPartnerPaystackBanks(): Promise<PaystackBankOption[]>` → `{action:"list_banks"}` (reuse the `PaystackBankOption` type by import from `brandPaystackService.ts`).
- `resolvePartnerPaystackAccount(accountNumber, bankCode)` → `{action:"resolve_account", …}`.
- `createPartnerPaystackRecipient(accountNumber, bankCode, bankName)` → `{action:"create_recipient", …}`.
- `disconnectPartnerPaystack()` → `{action:"disconnect"}`.

**NEW `src/hooks/usePartnerPaystack.ts`** (mirror `usePartnerStripe.ts`): `usePartnerPaystackStatus()` (enabled on `isAuthReady`, `staleTime:0`, `refetchOnWindowFocus`, `refetchOnMount:"always"` — same rationale comment), `usePartnerPaystackBanks()`, `useResolvePartnerPaystackAccount()`, `useCreatePartnerPaystackRecipient()` (onSuccess → invalidate `partnerPaystackKeys.status()` AND `partnerStripeKeys.status()`), `useDisconnectPartnerPaystack()` (same invalidations). Every mutation has `onError` logging (static-analysis rule).

**MODIFY `src/services/partnerSplitsService.ts`:** add `"blocked_no_paystack"` to `PartnerSplitStatus` (line 15-22) and optional `provider?: "stripe" | "paystack"` + `payout_reference?: string | null` to `PartnerSplitRow` (select list additions are optional — the existing select works because new columns are additive; ADD `provider` to the select for the badge).

### 4.9 Client — components & screens (CONTRACT only; a separate mingla-designer pass will pixel-spec; keep visuals minimal + consistent with the ORCH-1344 re-skin: `canvas.discover`, `GlassCard`, shared `<Button>` pill, close-left ChromeRow — DO NOT re-introduce removed hero/eyebrow elements)

**NEW `src/components/partner/PartnerPaystackOnboardForm.tsx`** — partner-scoped twin of `BrandPaystackOnboardView.tsx` (read it; mirror its UX contract):
- Fields/flow: bank picker (modal sheet, search, dedupe-by-code — reuse the exact dedupe + Android 42dp keyboard-clearance patterns from `BrandPaystackOnboardView.tsx:74-111,266-326`), 10-digit NUBAN `Input variant="number"`, primary CTA `Verify account` → resolved-name confirm block ("Account name / Make sure this is correct — payouts go to this account.") → primary CTA `Connect bank & get paid`. Re-editing digits or bank invalidates the verification (mirror `onAccountChange`).
- Props: `{ onConnected?: () => void; onCancel?: () => void }` (`onCancel` renders the "‹ Choose a different country" ghost button, top-left, matching the brand view).
- States: banks loading (spinner) / banks error (retry) / idle / verifying / verified / connecting / inline error text (`semantic.error` caption). All Pressables carry accessibilityLabel; touch targets ≥44pt (I-38/I-39).
- Copy (title/subtitle): `Get paid in Nigeria` / `Connect your bank account to receive your partner earnings. Splits are paid in NGN directly to this account.`

**MODIFY `app/partner/earnings.tsx`** (honor the re-skinned structure exactly — `StatusBlock`, `countryPickerWrap`, shared `<Button>`):
1. Mount `usePartnerPaystackStatus()` alongside `usePartnerStripeStatus()`.
2. **Picker:** pass `extraOptions={[{ code:"NG", name:"Nigeria", currency:"NGN", sublabel:"Paystack" }]}` to the existing `<BrandStripeCountryPicker>` mount (`earnings.tsx:769-776`) — the designed slot (`BrandStripeCountryPicker.tsx:61-75`). NG is NEVER added to `STRIPE_SUPPORTED_COUNTRIES` (I-PROPOSED-T; the strict-grep gate `i-proposed-t-stripe-country-allowlist.mjs` stands).
3. **Provider fork in `StatusBlock` (not_connected state only):** when `selectedCountry === "NG"` → replace the "Connect bank" CTA + Stripe copy with `<PartnerPaystackOnboardForm/>` inside the same card position; `currencyHelper` for NG: `Paystack will settle you in NGN. You'll only be able to partner with brands that sell in NGN.` The picker stays mounted above the form (user can switch back — `onCancel` clears `selectedCountry`).
4. **Connected (Paystack) state:** when `paystackStatus.connected && !detached` → render a status card in the same slot as the Stripe `active` card: dot `semantic.success`, label `PAYOUTS READY`, title `You're earning`, body `Your partner payouts go to <bank_name> ••••<last4> (NGN).`, secondary `<Button>` `Disconnect bank` (destructive confirm via `Alert.alert`, mirroring `handleDisconnectStripe`). Country picker hidden/locked in this state (`countryLocked` computed as `stripeStatus !== "not_connected" || paystackConnected`).
5. **Exclusivity in UI:** when Paystack is connected the Stripe flow is not offered (and vice-versa — the picker lock covers it; the backend 409s are the hard gate).
6. **Copy generalization (exact strings):** `earnings.tsx:394-396` welcome toast `…once they connect Stripe and sell their first ticket.` → `…once they connect payouts and sell their first ticket.`; `:464` `…as soon as their Stripe is connected and tickets sell.` → `…as soon as their payouts are connected and tickets sell.`
7. **`StatusBadge` map (`:576-593`):** add `blocked_no_paystack: { label:"Blocked — Paystack", color: semantic.error, bg: semantic.errorTint }`.

**MODIFY `app/partner/brands.tsx` (labels only; `deriveLinkStatus` and the timestamp columns are UNTOUCHED):** `statusLabel` `"Awaiting Stripe"` → `"Awaiting payouts"` (`brands.tsx:248-249`); `subTextFor` active-case `"Stripe connected"` → `"Payouts connected"` (`:270`). Doc-comment line 7-8 updated to match.

### 4.10 Realtime / cache
No realtime channels. Status freshness via the existing `staleTime:0 + refetchOnWindowFocus` pattern. Splits appear through the existing `usePartnerSplits` reads (RLS self-read already covers Paystack rows — same table).

---

## 5. Success criteria (all testable; business iOS/Android/web parity is automatic via shared RN code)

- **SC-1** A flagged NG partner on `/partner/earnings` sees "Nigeria (NGN — Paystack)" in the country picker; selecting it renders the NG bank form (bank picker populated from the live banks list via the edge fn; mocked in tests). Non-partners still get the "Not a Mingla partner yet" card.
- **SC-2** Entering a valid bank + 10-digit NUBAN and tapping `Verify account` shows the resolved holder name; changing any digit clears it. An unresolvable account shows the inline error and NO recipient is created.
- **SC-3** `Connect bank & get paid` creates the Paystack recipient, upserts `partner_paystack_accounts` (last4 only — the full NUBAN appears NOWHERE in the DB or audit log), sets `creator_accounts.partner_country='NG'`, and the screen flips to the `PAYOUTS READY` Paystack card after refetch.
- **SC-4** A partner with an ACTIVE Stripe account calling `partner-paystack-onboard action=create_recipient` gets `409 detail:"stripe_already_connected"`; a partner with an active Paystack recipient calling `partner-stripe-onboard` gets `409 detail:"paystack_already_connected"`.
- **SC-5** On a verified NGN `charge.success` whose order carries `stripe_application_fee_amount_cents = F`, exactly one `partner_splits` row is created with `provider='paystack'`, `mingla_fee_cents=F`, `partner_share_cents=round(F*0.10)`, `transfer_currency='ngn'`, key `paystack:<reference>`; webhook replay creates NO second row.
- **SC-6** With a connected partner and a (mocked) transfer returning `status:"success"`, the row flips `transferred`, `partner_brand_links.first_split_at` stamps (existing trigger), and the `business.partner_first_split` push dispatches once.
- **SC-7 (FAIL-SOFT, constitutional)** When the split engine throws (any stage — DB error, Paystack 500, malformed row), the `paystack-webhook` response for `charge.success` is IDENTICAL to today: order finalizes, confirmation dispatches, ack is 200, `payment_webhook_events.processed=true`. Proven by an adversarial test that force-throws inside the split path.
- **SC-8** A sale for a partner with NO Paystack recipient produces a `blocked_no_paystack` row (visible in the earnings ledger with the "Blocked — Paystack" badge) and ticketing is unaffected.
- **SC-9** An insufficient-balance (mocked) transfer failure leaves the row `pending` with the error recorded and the SAME reference on the next sweep attempt; a (mocked) `transfer.failed` webhook bumps `attempt_count` so the next sweep uses a NEW reference; attempt 5 finalizes `failed` + ops alert.
- **SC-10** A (mocked) `refund.processed` for a still-`pending` split flips it `reversed_pending` and the sweep never pays it; for a `transferred` split it stamps `reversal_owed_at`, writes the audit row, and sends the ops-alert email — the split status remains `transferred`.
- **SC-11** When `brands.paystack_subaccount_code` transitions NULL→non-NULL for a brand with an active partner link, `owner_stripe_connected_at` stamps (once; COALESCE) and `/partner/brands` shows the link as `Active` with `Payouts connected` subtext. Column names unchanged — the deployed client keeps working against the new backend.
- **SC-12** The Stripe rail is bit-identical: `orch-1052`/`1054`/`1081` tests all green; `_shared/partnerSplits.ts` diff = 0 lines; `stripeWebhookRouter.ts` diff = 0 lines.
- **SC-13** `STRIPE_SUPPORTED_COUNTRIES` (client + backend mirrors) contains NO `NG` entry; the `i-proposed-t` strict-grep gate passes.

---

## 6. Invariants

### Preserved (with the mechanism that preserves them)
- **I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY** (ORCH-1054): extended to the Paystack rail — transfer currency = charge currency = NGN, zero FX; enforced by the NGN-only checkout gate + §4.5.1 step 6; test T-6.
- **I-PROPOSED-T — STRIPE-COUNTRY-FROM-CANONICAL-ALLOWLIST-ONLY:** NG rides `extraOptions`, never the allowlist; existing strict-grep gate; SC-13.
- **RSVP chip-in provider-aware invariants** (registry lines ~238-248): untouched — no changes to `pg_brand_can_collect` or `finalize_rsvp_contribution`.
- **I-38 / I-39** (WCAG AA kit): all new Pressables labeled, ≥44pt.
- **ORCH-1188 finalize contract:** `biz_ticket_checkout_finalize` unmodified; split engine only READS its outputs.

### New (DRAFT `I-PROPOSED-*`; the orchestrator flips ACTIVE on CLOSE)
- **I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT** — *Rule:* the partner-split machinery (record/eligibility/transfer/push) can never fail, delay, or alter the ack of a ticket checkout, order finalize, or `charge.success` webhook. The split fan-out call in `paystack-webhook` MUST be wrapped in a dedicated try/catch that only logs and MUST NOT write `processingError`. *Enforcement:* adversarial test (T-8) + strict-grep gate `orch-1331-partner-split-fail-soft.mjs` (asserts the `handlePaystackPartnerSplit` call site in `paystack-webhook/index.ts` sits inside a catch-and-log block and that no code path assigns `processingError` from it).
- **I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE** — *Rule:* a partner share is computed ONLY from Mingla's persisted platform fee (`orders.stripe_application_fee_amount_cents`, = the Paystack `transaction_charge` skim) and paid from Mingla's balance; it never reduces the brand's settlement and is never added to the buyer's total. Share rate = `PARTNER_SHARE_OF_FEE` imported from `_shared/partnerSplits.ts` (single source). *Enforcement:* T-4/T-5 + strict-grep `orch-1331-share-single-source.mjs` (fails if `0.10`/`0.1` share literals appear in `paystackPartnerSplits.ts` instead of the import, or if `ticket-checkout-create`'s Paystack initialize block gains a `split`/`split_code` param).
- **I-PROPOSED-1331-PARTNER-PAYOUT-RAIL-EXCLUSIVE** — *Rule:* a partner has at most ONE active payout rail; both onboard fns 409 on the other rail's active row. *Enforcement:* T-3.
- **I-PROPOSED-1331-NUBAN-NEVER-PERSISTED** — *Rule:* the full bank account number never lands in any Mingla table, log line, or audit payload — last4 only. *Enforcement:* T-2 + code review checklist item; audit writes reviewed in tests.
- **I-PROPOSED-1331-LINK-COLUMNS-FROZEN** — *Rule:* `partner_brand_links` timestamp column NAMES are frozen (client `deriveLinkStatus` contract); provider generalization happens by stamping the existing columns, never renaming. *Enforcement:* migration contains no `RENAME`; client test pins `deriveLinkStatus` behavior.

---

## 7. Test cases

Deno tests live in `supabase/functions/_shared/__tests__/` (mock `fetch`/injected paystack helpers; NO live Paystack calls — LIVE mode, real money). Client tests in `mingla-business/src/**/__tests__/`. Append-only token honored.

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 happy | NG onboarding end-to-end (mocked Paystack) | resolve→create_recipient | 200, row upserted, last4 stored, partner_country='NG' | edge (Deno) |
| T-2 adversarial | PII leak hunt | create_recipient with full NUBAN | full number absent from upsert payload + audit `after` (assert on captured service-client calls) | edge (Deno) |
| T-3 error | exclusivity both directions | active Stripe row → paystack create; active Paystack row → stripe onboard | 409 / 409 with bound detail strings | edge (Deno) |
| T-4 happy | split math parity | fee=15000 kobo (₦150) | share=1500 kobo; `Math.round` parity case fee=15005 → 1501 (round, not floor) | engine (Deno) |
| T-5 edge | no fee / no partner / no order | fee NULL; resolve returns NULL | `no_application_fee` / `no_partner`; ZERO rows | engine (Deno) |
| T-6 edge | currency guard | verified currency "USD" | `blocked_currency_mismatch` row | engine (Deno) |
| T-7 happy | replay idempotency | same reference twice | one row; second call returns early on prior status | engine (Deno) |
| T-8 adversarial (SC-7) | fail-soft | split engine throws (stubbed) inside webhook flow | webhook result identical to pre-ORCH behavior: finalize + 200 ack + processed=true | webhook (Deno) |
| T-9 happy | transfer lifecycle | create returns `pending`, then `transfer.success` event | attempted→transferred; first-split push fired once | engine (Deno) |
| T-10 error | insufficient balance → sweep | create throws balance error; sweep runs | row `pending`, same reference reused; after `transfer.failed` attempt bumps → new reference; 5th → `failed` + alert | engine+sweep (Deno) |
| T-11 edge | OTP enabled | create returns `status:"otp"` | row `pending`, `error_message='otp_required'`, ops alert once, attempt not burned | engine (Deno) |
| T-12 happy/edge | refund reversal | refund.processed vs pending / vs transferred | `reversed_pending` / `reversal_owed_at`+audit+alert, status stays `transferred` | engine (Deno) |
| T-13 SQL | link trigger | UPDATE brands.paystack_subaccount_code NULL→'ACCT_x' with active link | `owner_stripe_connected_at` stamped once; second update no-op | DB (SQL wall test) |
| T-14 SQL | status widen + RPCs | insert paystack row via new RPC; mark failed 'blocked_no_paystack' | CHECK admits; RPC allowlist maps correctly | DB |
| T-15 client | badge + labels | split row status blocked_no_paystack; link awaiting_stripe | "Blocked — Paystack" badge renders; "Awaiting payouts" label | client (jest) |
| T-16 client | picker + fork | extraOptions NG selected | Paystack form renders in StatusBlock; Stripe CTA absent; onCancel restores picker flow | client (jest) |
| T-17 regression | Stripe rail untouched | run existing orch-1052/1054/1081 suites | all green; `partnerSplits.ts` + `stripeWebhookRouter.ts` zero diff (grep gate) | CI |

**Fails-on-revert:** T-8 (remove the try/catch → red), T-4 (change share source/rate → red), T-13 (drop trigger → red), strict-grep gates red on revert of their guarded structure.

---

## 8. Implementation order

1. **DB** — `supabase/migrations/20261228000000_orch_1331_partner_paystack_rail.sql` (§4.2, all parts incl. cron) + SQL wall tests (T-13/T-14).
2. **Shared helpers** — `_shared/paystack.ts` additions (§4.3).
3. **Engine** — `_shared/paystackPartnerSplits.ts` (§4.5) + Deno tests T-4…T-12.
4. **Webhook wiring** — `paystack-webhook/index.ts` (§4.6) + T-8.
5. **Onboard fn** — `partner-paystack-onboard/index.ts` + config.toml entries + T-1/T-2/T-3; the `partner-stripe-onboard` guard.
6. **Sweep fn** — `partner-paystack-split-retry/index.ts` + T-10 sweep leg.
7. **Client services/hooks** — `partnerPaystackService.ts`, `usePartnerPaystack.ts`, `partnerSplitsService.ts` additions.
8. **Client UI** — `PartnerPaystackOnboardForm.tsx`, `earnings.tsx`, `brands.tsx` + T-15/T-16.
9. **Gates** — strict-grep scripts + CI wiring (paths-gated: `supabase/functions/**` + `mingla-business/**` + the new scripts).

## Scoped allowlist (implementor may change ONLY these)

**New files:** `supabase/migrations/20261228000000_orch_1331_partner_paystack_rail.sql` (+ its `__tests__` SQL), `supabase/functions/partner-paystack-onboard/index.ts`, `supabase/functions/partner-paystack-split-retry/index.ts`, `supabase/functions/_shared/paystackPartnerSplits.ts`, `supabase/functions/_shared/__tests__/paystackPartnerSplits*.test.ts`, `mingla-business/src/services/partnerPaystackService.ts`, `mingla-business/src/hooks/usePartnerPaystack.ts`, `mingla-business/src/components/partner/PartnerPaystackOnboardForm.tsx`, client `__tests__` files, `scripts/orch-1331-partner-split-fail-soft.mjs`, `scripts/orch-1331-share-single-source.mjs`, CI workflow additions for the new tests.

**Modified files:** `supabase/functions/_shared/paystack.ts` (additive exports only), `supabase/functions/paystack-webhook/index.ts` (§4.6 only), `supabase/functions/_shared/paystackWebhookRouter.ts` (ONLY the optional `paidAtIso` field on `PaystackChargeResult`), `supabase/functions/partner-stripe-onboard/index.ts` (exclusivity guard only), `supabase/config.toml` (two entries), `mingla-business/app/partner/earnings.tsx`, `mingla-business/app/partner/brands.tsx` (labels/comments only), `mingla-business/src/services/partnerSplitsService.ts` (type + select additions only).

**DO-NOT-TOUCH:** `supabase/functions/_shared/partnerSplits.ts`, `_shared/stripeWebhookRouter.ts`, `_shared/ticketCheckout.ts`, `ticket-checkout-create/index.ts` (the LIVE checkout — ANY need to touch it = stop-and-amend), `biz_ticket_checkout_finalize` (all migrations), `accept-brand-invitation` + `accept_invite_and_transfer_brand_ownership` (ORCH-1332 territory), `invite-brand-member`, `partner-stripe-account-session`, `partner-stripe-detach`, `brand-paystack-onboard`, `BrandPaystackOnboardView.tsx`, `BrandStripeCountryPicker.tsx` (the `extraOptions` slot already exists — consume, don't modify), `stripeSupportedCountries.ts` (both mirrors), `partnerBrandLinksService.ts` (`deriveLinkStatus` frozen), consumer app, admin app. Anything outside the allowlist → STOP and request a SPEC amendment.

---

## 9. Regression prevention (fails-on-revert contracts)

1. **Fail-soft gate** — `scripts/orch-1331-partner-split-fail-soft.mjs`: parses `paystack-webhook/index.ts`; FAILS if the `handlePaystackPartnerSplit` call is not inside a catch-and-log block or if the block writes `processingError`. Reverting the try/catch = red.
2. **Share-single-source gate** — `scripts/orch-1331-share-single-source.mjs`: FAILS if `paystackPartnerSplits.ts` contains a numeric share literal instead of the `PARTNER_SHARE_OF_FEE` import, or if `ticket-checkout-create/index.ts`'s Paystack block gains `split`/`split_code` (Option-A creep = red).
3. **T-8 adversarial Deno test** — force-throw inside the engine; asserts the webhook contract is byte-stable. Reverting fail-soft = red.
4. **T-13 SQL test** — dropping the brands trigger = red.
5. **Protective comments** — the webhook fan-out block and the trigger carry a `// I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT — a split failure must NEVER break ticketing (constitutional)` / `-- I-PROPOSED-1331-LINK-COLUMNS-FROZEN` comment explaining the why.
6. **CI paths-gating note:** the new Deno tests must be wired into a named CI job (docs-only-CLOSE hazard — `feedback_docs_only_close_skips_paths_gated_suite.md`); include `supabase/functions/_shared/paystackPartnerSplits.ts` and `paystack-webhook/**` in the job's path filters.

---

## 10. Open questions / operational prerequisites (for Seth — none block implementation)

- **OPS-1 (Paystack balance funding — required before first real payout):** choose (a) email Paystack support to enable **Manual Payouts** on the Mingla NG integration (collections accrue in the Paystack Balance; you sweep to bank manually), or (b) keep auto-settlement and maintain a small NGN float via dashboard top-up. The engine works either way (sweep retries until funded); until one is done, splits sit `pending` with insufficient-balance errors.
- **OPS-2 (disable transfer OTP — required):** Dashboard → Settings → Preferences → uncheck "Confirm transfers before sending" (or the Transfer Control API flow). Until done, transfers return `status:"otp"` and rows wait `pending` with one ops alert.
- **OPS-3 (webhook events):** confirm the LIVE webhook endpoint receives `transfer.*` and `refund.*` events (Paystack sends all events to the single URL by default — no dashboard change expected; verify in the webhook log during the smoke test).
- **PRODUCT-1 (default, decided unless overridden):** one payout rail per partner (Stripe XOR Paystack). A dual-rail partner (e.g. UK partner also serving Lagos brands) requires detach + re-onboard. Parity-consistent with the Stripe country lock; revisit only if a real partner hits it.
- `[verify-in-webhook-log]` the exact refund-event field carrying the parent transaction reference (§4.5.4) — pin during implementation from a captured payload or the docs page in-browser.

---

## 11. Downstream routing

1. **mingla-implementor** — build exactly this SPEC in `~/Desktop/mingla-orchs/orch-1331-[partner-paystack-rail]/` on branch `orch-1331-partner-paystack-rail` (rebase onto `origin/main` first; re-run the migration-prefix scan). NO deploys, NO migration apply, NO live Paystack calls. Optional: orchestrator may run a `mingla-designer` pixel pass for `PartnerPaystackOnboardForm` + the NG status card BEFORE implementation; the §4.9 contract is the floor either way.
2. **mingla-tester** — adversarial pass per §7 (mocked Paystack only; live-fire NGN is NOT permitted — see Verification cap). Cap the verdict accordingly.
3. **mingla-orchestrator CLOSE** — migration apply via the safe-migration protocol (drift check `supabase migration list --linked` against `gqnoajqerqhnvulmnyvv`, monotonic prefix confirm, apply, read-only probes), edge deploys ride `deploy-functions.yml` on merge (verify `partner-paystack-onboard` + `partner-paystack-split-retry` + `paystack-webhook` versions with a curl probe post-deploy), business web via Vercel `[deploy]` tag, **native rides the NEXT business build — NO `eas update` for mingla-business (COMMS-0052/0063)**. Flip the DRAFT invariants ACTIVE. Manual smoke (below) after OPS-1/OPS-2.

### Verification cap (honest) + manual smoke plan
- **Cannot be tested before merge:** real Paystack recipient creation, real transfers, real balance behavior, real webhook event shapes for `transfer.*`/`refund.*` — LIVE mode, real money, no test-mode NG integration wired in prod. All engine/webhook tests are mocked-fetch Deno tests; the tester's ceiling is **PASS (mocked) + post-deploy live smoke required**.
- **Manual smoke (Seth, post-deploy, after OPS-1+OPS-2):** (1) flag a test partner account (`admin_toggle_partner`), open `/partner/earnings` on the business app → pick Nigeria → connect a real NG bank (small-value target); (2) create a partner-setup NGN brand, owner connects Paystack subaccount, publish a min-price ticket; (3) buy one ticket live (₦ small); (4) watch `partner_splits` for the `paystack:` row → `pending` → `transferred` after the sweep/settlement; confirm the first-split push + `/partner/brands` shows Active; (5) refund the charge from the Paystack dashboard → confirm the ops-alert email + `reversal_owed_at` (if already transferred) or `reversed_pending` (if not). Total real-money exposure: one min-price ticket.

### Risk register
| Risk | Likelihood | Blast | Mitigation |
|---|---|---|---|
| Split code path breaks live NGN checkout | Low (by construction) | Critical | Fail-soft wrapper + T-8 + strict-grep gate + DO-NOT-TOUCH on checkout files |
| Balance never funded → splits strand `pending` | Medium until OPS-1 | Partner trust | Sweep retries forever below attempt-cap on balance errors (balance errors do NOT bump attempts); ops alert at cap; OPS-1 called out |
| OTP left enabled | Medium until OPS-2 | Splits stall | `otp_required` handling + single ops alert |
| Transfer fee erodes tiny shares | Certain on small orders | Marginal cost | Accepted for launch; note for a future min-batch optimization ORCH |
| Refund-after-payout claw-back gap | Low volume | Money owed | `reversal_owed_at` + audit + ops email (SC-10); ops recovers manually |
| Duplicate payout via reference misuse | Low | Money | Stable `psplit_<id>_a<n>` reference contract; attempts bump only on definitive failure; T-9/T-10 |
| Parallel-session migration prefix collision | Medium | CI/deploy | Re-scan at implementation; bump day-prefix |
| `refund.processed` payload field drift | Low | Reversal miss | `[verify-in-webhook-log]` pin + audit fallback row on unmatched refunds |

### Delivery plan (phasing)
Single-PR delivery is acceptable (backend is dark until a partner onboards; client NG option is inert until the edge fn exists — deploy order within the PR merge: migration → functions → client is handled by the standard CLOSE protocol). No feature flag needed: the rail activates per-partner on onboarding, and the LIVE checkout path is untouched.

---

## Evidence appendix (verified citations)

- Share math: `supabase/functions/_shared/partnerSplits.ts:45` (`PARTNER_SHARE_OF_FEE = 0.10`), `:270` (`Math.round(applicationFeeAmount * PARTNER_SHARE_OF_FEE)`).
- Paystack-side fee source: `supabase/functions/ticket-checkout-create/index.ts:699` (`psApplicationFeeCents = psSubtotal.miglaFeeCents`), `:713` (persisted to session), `:770-774` (ridden as flat `transaction_charge`); finalize copy into `orders.stripe_application_fee_amount_cents`: `supabase/migrations/20261117000001_orch_1188_finalize_persist_event_date_id.sql:180-199`.
- Ledger + RPCs: `supabase/migrations/20260823000000_orch_1054_partner_splits.sql:34-83` (table+CHECK), `:142-164` (resolve_partner_for_brand_at_time), `:179-233`/`:252-337` (state RPCs).
- Lifecycle triggers: `supabase/migrations/20260920000000_orch_1081_partner_brand_links.sql:117-207`; client contract `mingla-business/src/services/partnerBrandLinksService.ts:55-63`.
- Webhook fail points: `supabase/functions/paystack-webhook/index.ts:167-233` (routing + post-finalize block), `_shared/paystackWebhookRouter.ts:52-227`.
- Picker slot: `mingla-business/src/components/brand/BrandStripeCountryPicker.tsx:61-75` (`extraOptions`); earnings mount `mingla-business/app/partner/earnings.tsx:769-776`.
- Cron pattern: `supabase/migrations/20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql:62-82`; fn guard `supabase/functions/reconcile-stuck-checkouts/index.ts:29-31`.
- Paystack API: doc URLs in §4.1 table (paystack.com/docs pages 403 automated fetch — corroborated via PaystackHQ/documentation GitHub mirror `sending-money/initiating-a-transfer.md`, the official Paystack Postman workspace "Initiate Transfer"/"Finalize Transfer", and support.paystack.com articles 2131074 (Manual Payouts), 2131394 (Payout on Demand), 2132866 (Transfers), per the convention established in `Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md`).
