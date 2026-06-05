# SPEC — META-ORCH-1076 Phase 1: Paystack Buyer Checkout for Nigerian Brands

- **ORCH:** META-ORCH-1076 [Paystack Africa] — **Phase 1 (Buyer checkout, Nigeria/NGN)**
- **Worktree:** `~/Desktop/mingla-orchs/meta-orch-1076-[paystack-nigeria]/` on branch `meta-orch-1076-paystack-nigeria`
- **Author:** mingla-forensics+claude (SPEC mode)
- **Date:** 2026-06-04
- **Mode:** SPEC (investigate-then-spec; no production code written this turn)
- **Inputs read in full:** `PAYSTACK_INTEGRATION_REFERENCE.md`, `META-ORCH-1076_PAYSTACK_AFRICA_SHARED_UNDERSTANDING.md`, the proof-slice (`_shared/paystack.ts`, `paystack-checkout-create/index.ts`, `paystack-webhook/index.ts`), the entire Stripe money path (`ticket-checkout-create`, `ticket-checkout-status`, `_shared/allInPricingEngine.ts`, `stripe-webhook/index.ts`, `_shared/stripeWebhookRouter.ts`), the finalize RPC (`20260724000000_orch_0921_finalize_compare_and_correct.sql`), the session-create RPC + pricing resolver (`20260727000000_orch_0955_native_stripe_tax.sql`, `20260802000000_orch_1006_pricing_switches.sql`), the `payment_webhook_events` inbox + `ticket_checkout_sessions`/`orders` schema, both client checkout flows.
- **Comms acks:** COMMS-0002 (backend strict-grep allowlist same-commit), COMMS-0003 (Paystack docs URLs inline). Both factored throughout §3/§7.

> **HARD CONSTRAINT (non-negotiable):** the existing Stripe checkout path stays **behaviorally byte-for-byte unchanged** for every non-Paystack brand. The Paystack branch is **purely additive** — it activates only when `brands.payment_provider = 'paystack'`. There are **zero existing NG/NGN brands** (Stripe Connect does not support Nigeria as a payout country), so this branch can only ever fire for brands that could not have existed before.

---

## 1. CURRENT-STATE MAP — the Stripe checkout flow (file:line authoritative)

### 1.1 The journey (intent → finalized order)

```
Buyer taps "Buy" (TicketCartSheet / ExpandedBusinessEventSheet)
  → useNativeCheckoutFlow()  [app-mobile/src/payments/nativeCheckoutFlow.ts:115]
  → supabase.functions.invoke("ticket-checkout-create", { surface:"native", eventId, buyer, lines })
      → ticket-checkout-create/index.ts:184 (serve)
          validate buyer/lines/eventId (236-247)
          event_dates future-date gate (259-276)
          trip bookings-closed + intake gates (284-417)  [trip-only]
          biz_ticket_checkout_create_session RPC (431-446)  → session row + items + stripeAccountId
          totalCents===0 → biz_ticket_checkout_finalize (free path, 504-541) → order, return free_completed
          else require session.stripeAccountId (543-548)  ← STRIPE-SPECIFIC GATE
          resolve_event_pricing_inputs RPC (560-563)       → switches, region, currency, take-rate, venue addr, stripe_account_id
          settlement currency resolve (597-616)
          all-in gross-up: computeBuyerSubtotal (645-662)   [allInPricingEngine.ts]
          persist application_fee on session (673-685)
          surface web/mobile-web → Stripe Checkout Session (706-932)  [hosted]
          native → Customer+ephemeralKey (949-1009) → Stripe Tax calc (1057-1197) → buildPricingBreakdown (1223-1246)
          native → paymentIntents.create on connected acct (1290-1347)
          persist PI on session, status="processing_payment" (1371-1380)
          return { kind:"requires_payment", clientSecret, paymentIntentId, stripeAccountId, customerId, ephemeralKey, pricingBreakdown }
  → client: initStripe(stripeAccountId) → initPaymentSheet → presentPaymentSheet (nativeCheckoutFlow.ts:193-276)
  → on success: return { outcome:"succeeded", orderId: checkoutSessionId }  (client navigates to a polling confirmation surface)

ASYNC (source of truth):
Stripe → POST stripe-webhook/index.ts:61 (stripeWebhookHandler)
  verify stripe-signature (84-103) → idempotent inbox payment_webhook_events keyed on stripe_event_id (133-186)
  routeStripeEvent (190) [stripeWebhookRouter.ts:1184]
    case "payment_intent.succeeded" (1273) → handleTicketCheckoutPaymentIntent (860)
      lookup session by stripe_payment_intent_id (870-876)  (metadata fallback 887-920)
      biz_ticket_checkout_finalize(session.id, PI id, charge id, method type, qrPepper, ...) (949-963)  ← ORDER CREATED HERE
      tax.transactions.createFromCalculation (985) [tax commit]
      ticket-confirmation-dispatch (1023)
      AppsFlyer first-ticket S2S (1037)
  mark inbox processed (210-213)

Buyer's confirmation surface polls ticket-checkout-status/index.ts:10
  { checkoutSessionId, buyerStatusToken } → session lookup → order_id != null → returns tickets+QR
```

### 1.2 The finalize-RPC contract (THE reuse target — `biz_ticket_checkout_finalize`)

Authoritative current definition: `supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql:5` (grep-confirmed latest of 8 migrations touching this function; `pg_proc` self-verify at line 314 asserts exactly **one 8-param overload**).

```
biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,                              -- positional 1 (required)
  p_stripe_payment_intent_id text,                        -- positional 2  ← Paystack: the Paystack reference
  p_stripe_charge_id text,                                -- positional 3  ← Paystack: data.id (txn id) as text, or NULL
  p_stripe_payment_method_type text,                      -- positional 4  ← Paystack: data.channel ('card'|'bank'|'ussd'|'bank_transfer')
  p_qr_token_pepper text,                                 -- positional 5 (required; qrTokenPepper())
  p_stripe_customer_id_on_connected_account text = NULL,  -- 6 (Paystack: NULL — installments deferred)
  p_saved_payment_method_id text = NULL,                  -- 7 (Paystack: NULL)
  p_installment_plan_root boolean = false                 -- 8 (Paystack: false)
) RETURNS jsonb  -- { orderId, checkoutSessionId, eventId, paymentStatus:'paid', totalCents, currency, tickets[], notificationStatus, installmentPlanRoot }
```

Behaviour (`SECURITY DEFINER`, `service_role` only):
- `SELECT ... FOR UPDATE` the session (43-47). **If `order_id IS NOT NULL` → idempotent early return** of the existing order (53-134). This is the **double-fulfillment guard** the Paystack callback+webhook race needs FOR FREE.
- Guard `total_cents > 0 AND COALESCE(p_stripe_payment_intent_id, session.stripe_payment_intent_id) IS NULL → RAISE 'payment_intent_required'` (136-138). **Implication:** the Paystack reference MUST be persisted on the session (as `stripe_payment_intent_id`) before finalize, OR passed as `p_stripe_payment_intent_id`.
- INSERT `orders` (150-178): `payment_method` derived from `p_stripe_payment_method_type` (apple_pay/google_pay/online_card — Paystack channels fall to `online_card`, acceptable v1); `payment_status='paid'`; `stripe_payment_intent_id` ← the Paystack reference; `stripe_charge_id` ← Paystack txn id; copies `stripe_application_fee_amount_cents` + `stripe_account_id` (NULL for Paystack v1) from the session.
- INSERT `order_line_items` from `ticket_checkout_session_items` (211-216).
- Mint `tickets` + QR per line item (218-252).
- `add_buyer_to_event_chat` (254-259); enqueue email+SMS `ticket_order_notifications` (261-280).
- UPDATE session `order_id`, `status='paid_completed'`, `completed_at` (282-288).

**Conclusion:** the finalize RPC is provider-agnostic at the column level. `stripe_payment_intent_id` and `stripe_charge_id` are plain text columns with a `UNIQUE(stripe_payment_intent_id)` index — reusing them for the Paystack reference/txn-id gives idempotency without a schema change. **No finalize-RPC change is required for Phase 1.** (Optional cosmetic rename is explicitly OUT of scope.)

### 1.3 The session-create RPC contract + THE BLOCKER

Authoritative: `biz_ticket_checkout_create_session` in `20260727000000_orch_0955_native_stripe_tax.sql:58` (11-param, grep-confirmed latest).

- Resolves `stripe_account_id` + `charges_enabled` via `LEFT JOIN stripe_connect_accounts ON brand_id` (176-184).
- 🔴 **BLOCKER (line 380):** `IF v_total > 0 AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN RAISE 'stripe_account_not_ready'`. A Paystack brand has **no** `stripe_connect_accounts` row → `stripe_account_id IS NULL` → **every paid Paystack checkout is rejected at session creation, before the edge function can branch.** This is the single largest complication; §3.3 resolves it.
- Returns camelCase jsonb incl. `stripeAccountId`, `totalCents`, `currency`, `installmentSchedule`. Currency is `trim(COALESCE(v_currency,'GBP'))`.

### 1.4 The all-in engine contract (reuse as-is — COMMS-0014)

`_shared/allInPricingEngine.ts`: pure, currency-agnostic integer-minor-unit math. Owner of the all-in total (Constitution #2).
- `computeBuyerSubtotal(input)` (157) → `{ miglaFeeCents, serviceFeeCents, buyerSubtotalCents }`. Adds passed Mingla-fee + passed service-fee to base. **No tax** (tax is the caller's Stripe round-trip).
- `taxBehaviorForRegion(region)` (75) → `'inclusive'|'exclusive'`; `throw` on unmapped region. Region union = `'GB'|'US'|'EU'|'CH'` (44). **NG is not in this union** — §3.2 extends it.
- `buildPricingBreakdown(args)` (182) → the canonical `pricing_breakdown` receipt; calls `taxBehaviorForRegion(input.region)` (193) so it **also throws on NG** until extended.
- The engine's tax handling assumes a Stripe `tax.calculations.create` round-trip produced `amountTotalCents`. **Paystack has no tax API** → §3.2 computes VAT in-engine from config and feeds `amountTotalCents` directly (no external round-trip).

### 1.5 The webhook inbox contract (reuse — COMMS via §3.4)

`payment_webhook_events` (baseline `20260505000000:8619`): `stripe_event_id text NOT NULL UNIQUE` (the dedup key — despite the name it is just a text idempotency key), `type`, `payload jsonb`, `processed`, `processed_at`, `error`. Later migration `20260511000007_b2a_v3` added `retry_count`, `retries_exhausted`. RLS: service-role only. **No schema change needed** — Paystack events dedup on a derived key `paystack:<event>:<reference>` written into `stripe_event_id`.

### 1.6 The client contract

Both apps invoke `ticket-checkout-create` with `surface:"native"` and branch on `data.kind` (`free_completed` | `requires_payment` | `requires_web_redirect`). The `requires_web_redirect` arm is **currently a dead error path** on native (ORCH-0849 removed the `expo-web-browser` hosted-checkout flow). `ticket-checkout-status` is the existing poll endpoint that resolves tickets once `order_id` is set. `expo-web-browser` is already a dependency (used widely; `openAuthSessionAsync` was the pre-ORCH-0849 hosted-checkout primitive — the exact tool Paystack needs).

---

## 2. TARGET ARCHITECTURE — provider branch + `(provider, country)` resolver

### 2.1 The decision

A **thin provider branch inside the existing `ticket-checkout-create` and a new sibling webhook**, NOT a forked money path. Routing is **seller-country-driven**: the brand's `payment_provider` column decides. The shared layer (session schema, items, `order`/`tickets`, finalize RPC, `ticket-checkout-status`, consumer cart UX, the all-in engine) is reused unchanged. Only **mint-payment** (PaymentIntent vs Paystack `initialize`) and **finalize-trigger** (`payment_intent.succeeded` vs `charge.success`) differ per provider, behind a branch keyed on `brands.payment_provider`.

### 2.2 The resolver spine (code, not a new table)

A new `_shared/paymentProvider.ts` exposes the `(provider, country)` resolver the whole program shares:

```ts
export type PaymentProvider = "stripe" | "paystack";
export interface ProviderRouting {
  provider: PaymentProvider;
  country: string;          // ISO-2, e.g. "NG"
  currency: string;         // "NGN" | "GBP" | ...
}
// Phase 1: resolve from the brand row already loaded by resolve_event_pricing_inputs.
// provider := brands.payment_provider (default 'stripe'); country := brands.payment_country;
// currency := brands.pricing_currency. The (provider,country) tuple selects keys
// (resolvePaystackSecretKey already exists) + capabilities (channels) downstream.
export function resolveProviderRouting(brand: {
  payment_provider: PaymentProvider | null;
  payment_country: string | null;
  pricing_currency: string | null;
}): ProviderRouting { /* default-stripe, NG→paystack */ }
// Channel allowlist by (provider,country). NG = card|bank|ussd|bank_transfer (NEVER mobile_money — Ghana-only, ref Part 1.6).
export function paystackChannelsForCountry(country: string): string[];
```

The resolver is the durable spine: Phase 2-5 + Ghana add config + a key pair, never a rewrite.

### 2.3 Branch point

`ticket-checkout-create/index.ts` gains one branch immediately after `resolve_event_pricing_inputs` returns the brand row: if `resolveProviderRouting(...).provider === "paystack"` → the **Paystack arm** (initialize → return `authorization_url`, `kind:"requires_paystack_redirect"`); else → the **Stripe arm UNCHANGED**. The session-create RPC's Stripe gate is relaxed for Paystack provider (§3.3).

---

## 3. LAYER-BY-LAYER CHANGES

Every Paystack endpoint/param/enum/event below carries its canonical docs URL inline (COMMS-0003).

### 3.1 🔒 LOCKED — Migration (additive, safe-default, non-destructive)

**File:** `supabase/migrations/20260818000000_meta_orch_1076_p1_payment_provider.sql` (timestamp strictly above the current max on main + active worktrees — implementor confirms with `ls supabase/migrations | sort | tail -1` at IMPLEMENT and bumps if needed; collision rule per COMMS-0004).

**3.1.a — brand provider columns (additive, defaulted):**
```sql
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS payment_country  text,                       -- ISO-2; NULL=inherit Stripe-country behavior
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code text;               -- ACCT_… (Phase 2 fills; nullable in Phase 1)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='brands_payment_provider_allowlist') THEN
    ALTER TABLE public.brands ADD CONSTRAINT brands_payment_provider_allowlist
      CHECK (payment_provider IN ('stripe','paystack'));
  END IF;
END $$;
```
- `DEFAULT 'stripe'` ⇒ every existing brand keeps Stripe behaviour byte-for-byte (HARD CONSTRAINT satisfied). No backfill, no destructive op.

**3.1.b — widen the GB/GBP allowlists to admit NG/NGN (additive, idempotent):**

The ORCH-1006 CHECKs (`20260802000000_orch_1006_pricing_switches.sql:44-51`) lock `pricing_region IN ('GB')` and `pricing_currency IN ('GBP')`. NG needs `pricing_region='NG'`, `pricing_currency='NGN'`. ORCH-1034 (general de-GBP) is NOT yet started (per memory), so this migration owns the **minimal** NG widening only:
```sql
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_pricing_region_allowlist;
ALTER TABLE public.brands ADD  CONSTRAINT brands_pricing_region_allowlist   CHECK (pricing_region   IN ('GB','NG'));
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_pricing_currency_allowlist;
ALTER TABLE public.brands ADD  CONSTRAINT brands_pricing_currency_allowlist CHECK (pricing_currency IN ('GBP','NGN'));
```
- Idempotent (`DROP … IF EXISTS` then re-`ADD`); only widens the set, never narrows ⇒ no existing row can violate it. **Note for ORCH-1034:** these CHECKs become a coordination point — whoever lands first widens, the other unions (register as a §6 deferred coordination, not a Phase-1 blocker).

**3.1.c — config-driven VAT (new singleton-ish table, service-role-only):**
```sql
CREATE TABLE IF NOT EXISTS public.country_vat_config (
  country     text PRIMARY KEY,                        -- ISO-2
  vat_rate_bps integer NOT NULL CHECK (vat_rate_bps BETWEEN 0 AND 10000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.country_vat_config (country, vat_rate_bps)
  VALUES ('NG', 750)                                   -- 7.5% NG VAT (locked decision #1; Ghana deferred)
  ON CONFLICT (country) DO NOTHING;
ALTER TABLE public.country_vat_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY country_vat_config_service_role_all ON public.country_vat_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```
- **Why a table, not a constant:** locked decision #1 is "config-driven VAT per country"; a row is admin-tunable and Ghana-extensible. The engine reads it via the resolver RPC extension below. (An alternative — a TS constant `COUNTRY_VAT_BPS = { NG: 750 }` in the engine — is acceptable if the implementor prefers zero new tables; tagged 🎨 OPEN below. The table is the LOCKED default.)

**3.1.d — extend `resolve_event_pricing_inputs` to surface provider + VAT (CREATE OR REPLACE, additive columns):**

`resolve_event_pricing_inputs` (`20260802000000_orch_1006_pricing_switches.sql:174`) currently returns 10 columns. Extend the `RETURNS TABLE` with `payment_provider text, payment_country text, paystack_subaccount_code text, vat_rate_bps integer` (LEFT JOIN `country_vat_config` on `b.payment_country`). The existing 10 columns stay identical so the Stripe arm reads them unchanged. Re-`GRANT EXECUTE … TO service_role`. (`CREATE OR REPLACE` of a `RETURNS TABLE` requires identical leading columns — append only.)

**3.1.e — relax the session-create Stripe gate for Paystack (CREATE OR REPLACE the 11-param RPC):**

The `stripe_account_not_ready` RAISE at `20260727000000:380` must NOT fire for a Paystack brand. Re-declare `biz_ticket_checkout_create_session` (byte-faithful copy of the current body — the implementor copies the existing definition verbatim and changes only this block) so the gate reads:
```sql
-- Resolve provider alongside the existing stripe join:
SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
       s.stripe_account_id, s.charges_enabled,
       b.payment_provider
  INTO v_event
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.stripe_connect_accounts s ON s.brand_id = e.brand_id AND s.detached_at IS NULL
 WHERE e.id = p_event_id FOR SHARE OF e;
...
-- Gate: Stripe brands still require a ready connected account; Paystack brands do not.
IF v_total > 0 AND v_event.payment_provider = 'stripe'
   AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'stripe_account_not_ready';
END IF;
v_stripe_account_id := CASE WHEN v_total > 0 AND v_event.payment_provider='stripe'
                            THEN v_event.stripe_account_id ELSE NULL END;
```
- For Paystack the session row is created with `stripe_account_id = NULL` (correct — Paystack has no connected account in Phase 1). Everything else in the RPC (items, currency, idempotency, installment) is unchanged. **This is the ONLY change to the Stripe-path RPC, and it is a no-op for `payment_provider='stripe'`** (the gate condition only adds an `AND payment_provider='stripe'` so the Stripe branch is identical). The `DO $$ … pg_proc` self-verify (param-count = 11) is preserved.
- 🔴 The implementor MUST diff the re-declared body against the current definition and prove only the gate + the `payment_provider` select changed (§7 SC-12).

**3.1.f — session terminal-status note:** the session `status` CHECK already includes `awaiting_web_redirect` (added `20260520000001_orch_0789_0790`). Phase 1 reuses `awaiting_web_redirect` for the Paystack in-browser state (no new enum value, no migration). `processing_payment` / `paid_completed` / `failed` are reused as-is.

> **COMMS-0002:** this migration file + every new/edited `supabase/functions/**` (§3.3, §3.4, §3.5) land their `META_ORCH_1076_BACKEND_ALLOWLIST` entry in the **same commit** (§7).

### 3.2 🔒 LOCKED — All-in engine: config-driven NG VAT (additive, zero GB/Stripe disturbance)

**File:** `_shared/allInPricingEngine.ts` (already on the ORCH-0863 allowlist? — NO; add to META_ORCH_1076_BACKEND_ALLOWLIST).

- Extend `PricingRegion` union to `"GB"|"US"|"EU"|"CH"|"NG"`.
- `taxBehaviorForRegion`: add `case "NG": return "exclusive";` — **NG VAT is added on top of the price** (exclusive), matching Nigerian invoicing convention, and crucially avoiding the inclusive-divisor re-derivation path. (Doc basis: Paystack charges `amount` exactly as given — ref `PAYSTACK_INTEGRATION_REFERENCE.md` §2.4 "the buyer is always charged exactly `amount`"; VAT is Mingla-computed, so we add it before `initialize`.)
- `INCLUSIVE_VAT_DIVISOR`: add `NG: 1.0` (exhaustiveness; exclusive ⇒ divisor unused).
- **New pure function** `computeConfigVat(subtotalCents, vatRateBps, passTax): { taxCents, buyerTotalCents }`:
  - `taxCents = passTax ? feeFromBps(subtotalCents, vatRateBps) : 0` (reuses the existing integer-bps helper `feeFromBps`, line 149).
  - `buyerTotalCents = subtotalCents + taxCents`.
  - When `passTax=false` the brand absorbs VAT → `taxCents=0` added to buyer, but the brand still owes 7.5% on the sale; `pricing_breakdown.absorbed.tax_cents` records it (the engine sets it from `feeFromBps` regardless, mirroring the GB absorbed-tax reporting at lines 226-229).
- `buildPricingBreakdown`: for NG, `tax_basis` is a new literal `"config_vat"` (extend the `TaxBasis` union) so the receipt is self-describing; `amount_total_cents = buyerTotalCents`, `tax_cents = computeConfigVat(...).taxCents`. **GB/EU/CH/US paths are untouched** — the NG branch is reached only when `region==="NG"`, which only a Paystack brand can have.
- **No Stripe round-trip on the NG path.** The engine computes the entire all-in deterministically; this is the WYSIWYP all-in NGN total the buyer sees and is charged.

**Docs cited:** Paystack amount semantics — `https://paystack.com/docs/api/transaction/` (amount in subunits, charged exactly); fee/all-in tie-in — `PAYSTACK_INTEGRATION_REFERENCE.md` §2.4. NG VAT rate 7.5% — locked decision #1 (operator/finance authority, not Paystack).

### 3.3 🔒 LOCKED — `ticket-checkout-create`: the Paystack arm (additive branch; Stripe arm unchanged)

**File:** `supabase/functions/ticket-checkout-create/index.ts` (already on the ORCH-0863 allowlist via ORCH-0869/0875 — but META-ORCH-1076 re-adds it to its own allowlist block for clarity).

Insert the branch immediately after `resolve_event_pricing_inputs` returns (after line 584, before the settlement-currency Stripe logic). Pseudocode contract:

```ts
const routing = resolveProviderRouting({
  payment_provider: pricing.payment_provider,
  payment_country: pricing.payment_country,
  pricing_currency: pricing.pricing_currency,
});
if (routing.provider === "paystack") {
  // ---- PAYSTACK ARM (NGN) ----
  // 1. All-in: reuse computeBuyerSubtotal (Mingla fee + service fee passed/absorbed),
  //    then computeConfigVat for NG VAT. NO Stripe calls anywhere on this arm.
  const engineInput: ComputeAllInInput = { baseCents: totalCents, switches: pricingSwitches,
    region: "NG", currency: "NGN", effectiveTakeRateBps: pricing.effective_take_rate_bps,
    takeRateSource: pricing.take_rate_source, serviceFeeBps: MINGLA_SERVICE_FEE_BPS };
  const subtotal = computeBuyerSubtotal(engineInput);
  const { taxCents, buyerTotalCents } = computeConfigVat(subtotal.buyerSubtotalCents,
    pricing.vat_rate_bps ?? 0, pricingSwitches.pass_tax);
  const breakdown = buildPricingBreakdown({ input: engineInput,
    amountTotalCents: buyerTotalCents, taxCents, taxBasis: "config_vat", stripeTaxCalculationId: null });
  // 2. Persist breakdown + application_fee on session (same UPDATE shape as Stripe arm).
  // 3. Generate a unique reference tied to the session: `mingla_${checkoutSessionId}_${attempt}`
  //    (allowed chars - . = alnum, ref §1.8). Persist as ticket_checkout_sessions.stripe_payment_intent_id
  //    (text column, UNIQUE → free dedup) BEFORE calling Paystack, status="awaiting_web_redirect".
  // 4. paystackInitializeTransaction({ email: buyerEmail, amountSubunits: buyerTotalCents,
  //      currency: "NGN", reference, callbackUrl: <PAYSTACK_CALLBACK_BASE>/pay/callback?cs=<sid>&bst=<token>,
  //      channels: paystackChannelsForCountry("NG"),  // card|bank|ussd|bank_transfer — NEVER mobile_money
  //      metadata: { mingla_checkout_session_id, mingla_event_id, mingla_buyer_email },
  //      subaccount: pricing.paystack_subaccount_code ?? undefined,        // Phase 2 fills; Phase 1 may be absent
  //      transactionChargeSubunits: subtotal.miglaFeeCents,                // flat kobo to Mingla main acct (if subaccount present)
  //    })  →  { authorization_url, reference, access_code }
  // 5. return { kind:"requires_paystack_redirect", checkoutSessionId, buyerStatusToken,
  //      authorizationUrl, reference, totalCents: buyerTotalCents, currency:"NGN", pricingBreakdown }
}
// else: existing Stripe arm, BYTE-FOR-BYTE UNCHANGED (the entire current 543→1432 block).
```

**Contracts & docs:**
- `POST /transaction/initialize` — `https://paystack.com/docs/api/transaction/#initialize` (proof-slice `paystackInitializeTransaction` already implements: amount in subunits, `currency`, `reference`, `callback_url`, `channels`, `metadata` stringified, optional `subaccount` + `transaction_charge` + `bearer`). Response `{ authorization_url, access_code, reference }` — `PAYSTACK_INTEGRATION_REFERENCE.md` §1.1.
- `amount` = `buyerTotalCents` already in **kobo** (the engine works in minor units; NGN minor unit is kobo, base×100 — §1.5). **Do NOT multiply by 100 again** (the proof-slice harness multiplies because it takes major units; the real branch passes the already-minor engine total). 🔴 This is a sharp edge — SC-7 asserts it.
- `reference` uniqueness/idempotency — `https://paystack.com/docs/payments/accept-payments/` + §1.8 ("every reference unique per integration; no `Idempotency-Key` header"). Reusing `ticket_checkout_sessions.stripe_payment_intent_id`'s `UNIQUE` constraint enforces this at the DB.
- `channels` enum — `https://paystack.com/docs/payments/payment-channels/` (§1.6). NG allowlist = `card|bank|ussd|bank_transfer`; `mobile_money` is **forbidden** in Nigeria (§5 Mingla mapping note).
- `subaccount`/`transaction_charge` (Phase 2 split, optional Phase 1) — `https://paystack.com/docs/api/subaccount/` + §2.3 Way A. **Phase 1 deferred-split posture:** if `paystack_subaccount_code` is present, pass it + `transaction_charge` (flat kobo = Mingla take); if absent, charge to the main Mingla account with no split (full amount settles to Mingla; brand payout is Phase 2). Either way the buyer is charged the same all-in total.
- `callback_url` — `https://paystack.com/docs/payments/accept-payments/` §1.4 (overrides dashboard default per-transaction; on success redirects to `callback_url?trxref=&reference=`).

**Stripe-arm invariance proof obligation:** the implementor MUST show the diff touches only the new branch + imports; the `surface==="web"`/`"mobile-web"` and native PaymentIntent blocks are unchanged (SC-1).

### 3.4 🔒 LOCKED — `paystack-webhook`: upgrade proof → idempotent inbox + finalize

**File:** `supabase/functions/paystack-webhook/index.ts` (proof-slice exists; upgrade in place). Deploy config **`verify_jwt: false`** (Paystack sends no Supabase JWT — same as `stripe-webhook`). Add to `supabase/config.toml` `[functions.paystack-webhook] verify_jwt = false` if a per-function config block is used (mirror the stripe-webhook entry).

Upgrade contract (keep the proof-slice's signature verify + IP log; ADD inbox + router):
```
POST → req.text() (raw body, REQUIRED before parse — §4.2)
  verifyPaystackSignature(rawBody, x-paystack-signature, resolvePaystackSecretKey())   [proof-slice helper, HMAC-SHA512]
    invalid → 401 (existing)
  JSON.parse(rawBody) → { event, data }
  IDEMPOTENT INBOX (reuse payment_webhook_events):
    idempotencyKey = `paystack:${event}:${data.reference ?? data.id}`
    SELECT by stripe_event_id = idempotencyKey
      processed=true → 200 { status:"replayed_processed" }   (double-fire guard — §1.4 + callback race)
      retries_exhausted → 200
      absent → INSERT { stripe_event_id: idempotencyKey, type: event, payload: parsed, processed:false, retry_count:0 }
  ROUTE on top-level `event`:
    case "charge.success":   await handlePaystackChargeSuccess(supabase, data)
    default:                 audit-log unhandled (writeAudit), no-op
  mark inbox processed / retry_count++ / error (mirror stripe-webhook:199-216)
  RETURN 200 fast (Paystack expects 200 immediately, 30s timeout, retries on non-200 — §4.1)
```

**`handlePaystackChargeSuccess(supabase, data)` contract (new `_shared/paystackWebhookRouter.ts`):**
```
1. reference = data.reference; if absent → throw (inbox marks retryable).
2. VERIFY-BY-REFERENCE (defense in depth — never trust the webhook body alone, §1.2):
   const txn = await paystackVerifyTransaction(reference)   [proof-slice helper; GET /transaction/verify/:reference]
   require txn.status === "success"                          (NOT top-level status:true — §1.2 step 1)
3. Lookup session by stripe_payment_intent_id == reference (the reference persisted at create).
   absent → audit "orphan", return null (no order to finalize).
4. AMOUNT + CURRENCY MATCH (§1.2 step 2 — "if the amount doesn't match, don't deliver value"):
   require Number(txn.amount) === session.total_cents  (both kobo)
   require String(txn.currency).toUpperCase() === "NGN"
   mismatch → mark session failed + audit, return (do NOT finalize).   🔴 hard gate.
5. FINALIZE via the EXISTING RPC (no new finalize logic):
   biz_ticket_checkout_finalize(
     p_checkout_session_id: session.id,
     p_stripe_payment_intent_id: reference,                 // Paystack reference in the PI-id slot
     p_stripe_charge_id: String(txn.id),                    // Paystack txn id
     p_stripe_payment_method_type: String(txn.channel ?? "card"),  // card|bank|ussd|bank_transfer
     p_qr_token_pepper: qrTokenPepper())
   → order + line items + tickets + chat + notifications, all reused.
6. ticket-confirmation-dispatch(orderId)  (inline fetch, same as stripe-webhook:1019-1032).
7. (AppsFlyer first-ticket S2S — OPTIONAL Phase 1; 🎨 OPEN. Map cleanly later.)
```

**Contracts & docs:**
- Signature — `https://paystack.com/docs/payments/webhooks/` (§4.2): `x-paystack-signature` = HMAC-SHA512 of **raw body** with the **secret key**; the proof-slice `verifyPaystackSignature` is correct (constant-time compare). 🔴 Read raw body before `JSON.parse` (§4.2) — proof-slice already does.
- Verify — `https://paystack.com/docs/api/transaction/#verify` + `https://paystack.com/docs/payments/verify-payments/` (§1.2): gate on `data.status==="success"` AND amount AND currency.
- Event name — `charge.success` (NOT `charge.succeeded`) — `https://paystack.com/docs/payments/webhooks/` §4.4. Envelope `{ event, data }`, route on `event`.
- IP allowlist — static trio `52.31.139.75, 52.49.173.169, 52.214.14.220` (§4.3). **Phase 1: soft IP check (log-only)**, mirroring the proof-slice + the Stripe webhook's soft-IP posture (signature is the hard gate; IP is belt-and-suspenders because Supabase edge may rewrite `x-forwarded-for`). Hardening to a hard IP gate is a §6 deferred item.
- Idempotency — no Paystack `evt_` id; key on `paystack:<event>:<reference>` + the `payment_webhook_events.stripe_event_id` UNIQUE index. The finalize RPC's `order_id IS NOT NULL` early-return is the second idempotency layer (callback verify + webhook can both fire).

### 3.5 🔒 LOCKED — Client: in-app browser → Paystack `authorization_url` → poll

The new `kind:"requires_paystack_redirect"` arm in **both** `nativeCheckoutFlow.ts` (app-mobile) and `nativeCheckoutFlow.native.ts` (mingla-business). Mirror the pre-ORCH-0849 hosted-checkout pattern (`expo-web-browser.openAuthSessionAsync`).

```ts
if (data.kind === "requires_paystack_redirect") {
  const result = await WebBrowser.openAuthSessionAsync(
    data.authorizationUrl,
    /* returnUrl prefix */ "<callback scheme/https Paystack redirects to>"
  );
  // openAuthSessionAsync resolves on the redirect to callback_url?trxref=&reference=
  // result.type === "cancel"|"dismiss" → poll once anyway (webhook may have finalized
  //   before the buyer closed the browser — §1.4 "redirect is unreliable").
  // POLL ticket-checkout-status { checkoutSessionId, buyerStatusToken } until order_id != null
  //   (bounded poll: e.g. up to ~25s, 1.5s interval; webhook charge.success is the truth).
  //   order present → { outcome:"succeeded", orderId }
  //   timeout w/ no order → { outcome:"failed", message:"We couldn't confirm your payment yet…" }  (NOT a fabricated success)
}
```
- `expo-web-browser` is already a dependency. The `callback_url` is the Mingla-hosted `/pay/callback` (the dashboard default per `PAYSTACK_INTEGRATION_REFERENCE.md` Part 0); the in-app browser intercepts the redirect and closes — the client never parses payment state from the URL, it polls the server (which is driven by the verified webhook). This honours the WYSIWYP + "webhook is source of truth" contract.
- **Cross-surface:** identical logic in both flow files (manual parity → separate SCs §7 SC-9-consumer / SC-9-business). Buyer/anon **web** checkout for Paystack is **OUT of Phase 1** (§6) — Phase 1 proves the native in-app-browser path; web hosted Paystack-redirect rides Phase 1's edge contract later with no new edge work.
- Docs: mobile-WebView pattern — `https://paystack.com/docs/guides/using_the_paystack_checkout_in_a_mobile_webview/`; callback behaviour — §1.4.

### 3.6 🎨 OPEN — handed to the implementor's craft
- Exact reference format string (must satisfy §1.8 charset; any unique `mingla_<sid>_<n>` shape).
- VAT config as a table (LOCKED default) vs a TS constant in the engine (acceptable substitute).
- Poll cadence/duration and the in-flight UI copy (Mingla voice; must not fabricate success).
- Whether `_shared/paystackWebhookRouter.ts` is a new file or inlined into `paystack-webhook/index.ts` (both fine; new file mirrors the Stripe router split).
- AppsFlyer first-ticket S2S on the Paystack path (clean to add; optional Phase 1).

---

## 4. SUCCESS CRITERIA (observable, testable, unambiguous)

1. **Stripe path unchanged:** for any `payment_provider='stripe'` brand, `ticket-checkout-create` produces a byte-identical `requires_payment`/`requires_web_redirect`/`free_completed` response and a finalized order exactly as today (diff proof + a Stripe-arm regression test green).
2. A buyer purchasing a `payment_provider='paystack'` (NGN) event receives `kind:"requires_paystack_redirect"` with a non-empty `authorizationUrl` + `reference`, and the session row is `awaiting_web_redirect` with `stripe_payment_intent_id == reference`.
3. The buyer sees an **all-in NGN total** (WYSIWYP) = base + passed Mingla-fee + passed service-fee + (pass_tax ? 7.5% VAT : 0), computed entirely in-engine with no Stripe call.
4. On Paystack `charge.success` (verified `data.status==='success'`, amount==`session.total_cents`, currency=='NGN'), a real **order + line items + tickets + QR + chat + notifications** are created via the existing `biz_ticket_checkout_finalize`, and the session flips to `paid_completed`.
5. **Amount/currency mismatch** on verify → session marked failed, **no order created**, audit row written.
6. The webhook is **idempotent**: replaying the same `charge.success` (or callback+webhook both firing) creates exactly **one** order (`payment_webhook_events` dedup + finalize `order_id` early-return).
7. The Paystack `initialize` `amount` equals the engine's minor-unit total in **kobo** (no double ×100).
8. `mobile_money` is **never** in the Paystack `channels` for NG.
9. The client opens the `authorization_url` in the in-app browser and, after return/cancel, resolves to `succeeded` only when `ticket-checkout-status` reports `order_id != null` (never a fabricated success).
10. The session-create RPC does **not** raise `stripe_account_not_ready` for a Paystack brand, and **does** still raise it for a Stripe brand with no ready account.
11. `paystack-webhook` rejects a bad/absent `x-paystack-signature` with 401 and never finalizes.
12. The re-declared `biz_ticket_checkout_create_session` differs from its prior definition **only** in the provider-aware gate + the added `payment_provider` select (line-diff proof).

---

## 5. CROSS-SURFACE IMPACT (Phase 2.5 — mandatory)

| # | Surface | Covered | Behaviour / files |
|---|---|---|---|
| 1 | Consumer iOS | ✅ | `kind:"requires_paystack_redirect"` arm in `app-mobile/src/payments/nativeCheckoutFlow.ts` (in-app browser → poll). SC-9-consumer. |
| 2 | Consumer Android | ✅ | Same shared file; parity automatic (one code path). Verify `openAuthSessionAsync` on Android. SC-9-consumer. |
| 3 | Buyer/anon Web | ❌ Phase 1 | Web Paystack-redirect deferred (§6). Edge contract is web-ready; no new edge work later. |
| 4 | Business iOS | ✅ | `mingla-business/src/payments/nativeCheckoutFlow.native.ts` mirror. **Manual parity** → SC-9-business (separate gate). |
| 5 | Business Android | ✅ | Same business flow file; parity automatic. SC-9-business. |
| 6 | Admin Web | ❌ | Admin renders Stripe disputes/payouts only; no Paystack admin surface until Phase 4. |
| 7 | Business Web preview | ❌ | No Paystack preview surface; rides the business build. |

Backend (`ticket-checkout-create`, `paystack-webhook`, migration, engine) is shared across all surfaces (one implementation).

---

## 6. EXPLICITLY DEFERRED (do NOT spec here)

- **Brand subaccount onboarding + transaction split (Phase 2):** no bank-details form, no `POST /subaccount`, no `/bank/resolve`. Phase 1 charges to the **main Mingla account** (full settle to Mingla); if a `paystack_subaccount_code` already exists on the brand it is passed + `transaction_charge` applied, but **no onboarding UI** ships. Brand payout is Phase 2.
- **Refunds (Phase 3):** `POST /refund`, `refund.*` webhooks, `refunds` schema mapping.
- **Disputes / installments (Phase 4):** `charge.dispute.*`, evidence API, `paystack_disputes` table, ops alerts, recurring/off-session.
- **Ghana / mobile money:** entirely out (locked decision #4). The `(provider,country)` resolver is built so Ghana is a later config + key add, but no GHS, no `mobile_money`, no `POST /charge` mobile-money flow.
- **Buyer/anon WEB Paystack checkout (surface 3):** native in-app-browser only in Phase 1.
- **General ORCH-1034 de-GBP:** Phase 1 widens only the NG/NGN CHECK minimally; coordinate with ORCH-1034 on whoever lands the allowlist widening first (register a §7 coordination note, not a blocker).
- **Hard IP allowlist on `paystack-webhook`:** Phase 1 is soft (log-only); signature is the hard gate.
- **Finalize-RPC cosmetic rename** of `p_stripe_*` params to provider-neutral names.

---

## 7. MIGRATION APPLY + INVARIANT PROBES + COMMS

### 7.1 Apply command (operator/orchestrator per autonomy posture; safe — additive only)
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1076-[paystack-nigeria]"
supabase db push --linked
```
- All changes are additive (new columns with defaults, widened CHECKs, new table, `CREATE OR REPLACE` of two functions appending columns/relaxing one gate). **No destructive op.** Verify on remote with `mcp__supabase__list_migrations` showing the new version BEFORE deploying edge fns (COMMS-0012 close-gate).

### 7.2 Read-only invariant probes (machine-checkable; no writes)
```sql
-- I-1076-P1-PROVIDER-COLUMN: brand provider column exists + defaults stripe.
SELECT column_default FROM information_schema.columns
 WHERE table_name='brands' AND column_name='payment_provider';        -- expect 'stripe'::text
-- I-1076-P1-PROVIDER-CHECK: allowlist constraint present.
SELECT conname FROM pg_constraint WHERE conname='brands_payment_provider_allowlist';
-- I-1076-P1-NG-CURRENCY: NGN admitted, GBP retained.
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='brands_pricing_currency_allowlist';  -- IN ('GBP','NGN')
-- I-1076-P1-VAT-CONFIG: NG VAT row = 750 bps.
SELECT vat_rate_bps FROM public.country_vat_config WHERE country='NG';  -- expect 750
-- I-1076-P1-SESSION-RPC-PROVIDER-AWARE: re-declared RPC still single 11-param overload.
SELECT count(*) FROM pg_proc WHERE proname='biz_ticket_checkout_create_session' AND pronargs=11;  -- expect 1
-- I-1076-P1-FINALIZE-UNCHANGED: finalize still the single 8-param overload (NOT touched by Phase 1).
SELECT count(*) FROM pg_proc WHERE proname='biz_ticket_checkout_finalize' AND pronargs=8;  -- expect 1
-- I-1076-P1-RESOLVER-EXTENDED: resolver surfaces provider.
SELECT 1 FROM pg_proc WHERE proname='resolve_event_pricing_inputs';     -- exists (cols asserted by a typed call in test)
```

### 7.3 COMMS-0002 backend allowlist (same-commit, modeled on ORCH-1064/1066)
Add `META_ORCH_1076_BACKEND_ALLOWLIST` to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` and spread it into the C7 `ALLOWLIST` array (line ~1543), in the **same commit** as the backend change:
```js
const META_ORCH_1076_BACKEND_ALLOWLIST = [
  "supabase/migrations/20260818000000_meta_orch_1076_p1_payment_provider.sql",
  "supabase/functions/_shared/paymentProvider.ts",
  "supabase/functions/_shared/paystack.ts",
  "supabase/functions/_shared/paystackWebhookRouter.ts",
  "supabase/functions/_shared/allInPricingEngine.ts",
  "supabase/functions/ticket-checkout-create/index.ts",
  "supabase/functions/paystack-checkout-create/index.ts",
  "supabase/functions/paystack-webhook/index.ts",
  // + any new Deno test files under supabase/functions/**/__tests__/
];
```
> Note: the proof-slice already added `_shared/paystack.ts`, `paystack-checkout-create`, `paystack-webhook`; they are currently **un-allowlisted** and would fail C7 on the first PR touching them — this allowlist closes that too.

---

## 8. TEST PLAN

### 8.1 Seed a NG Paystack test brand + event (sandbox)
1. Pick/create a brand owned by a test account; set `payment_provider='paystack'`, `payment_country='NG'`, `pricing_region='NG'`, `pricing_currency='NGN'`, `paystack_subaccount_code=NULL` (Phase 1 no split). All via a one-off admin/SQL update (RLS: service-role).
2. Create a public, scheduled event under that brand with ≥1 paid ticket type priced in NGN (e.g. ₦5,000 → `unit_price_cents=500000` kobo) and a future `event_dates` row.
3. Set Supabase secrets: `PAYSTACK_MODE=test`, `PAYSTACK_SECRET_KEY_TEST=sk_test_…` (already provisioned per shared-understanding A1). Paste the Test Webhook URL `https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/paystack-webhook` + Test Callback `https://business.usemingla.com/pay/callback` in the NG dashboard (A2).

### 8.2 End-to-end (already-working sandbox)
| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Paystack create | Buy 1 ticket on the NG event (native) | `kind:"requires_paystack_redirect"` + `authorizationUrl`; session `awaiting_web_redirect`, `stripe_payment_intent_id=reference` | edge + DB |
| T-02 | Pay with test card | Open `authorization_url`, pay `4084 0840 8408 4081` CVV 408 (§1.7) | Paystack `charge.success` → webhook → `biz_ticket_checkout_finalize` → order+tickets; session `paid_completed` | full stack |
| T-03 | All-in NGN | pass_tax=true, ₦5,000 base | buyer total = 5000 + passed fees + 7.5% VAT, in kobo; `pricing_breakdown.tax_basis='config_vat'` | engine |
| T-04 | Amount mismatch | Forge webhook with `data.amount` ≠ session total (or verify returns mismatch) | session failed, **no order**, audit row | webhook |
| T-05 | Idempotent replay | Re-POST the same `charge.success` | exactly one order (inbox dedup + finalize early-return) | webhook + RPC |
| T-06 | Bad signature | POST with wrong `x-paystack-signature` | 401, no order | webhook |
| T-07 | Stripe regression | Buy on an existing GBP Stripe event | identical `requires_payment` + finalized order as pre-change (diff + green Stripe-arm test) | full stack |
| T-08 | Declined card | `4084 0800 0000 5408` CVV 001 (§1.7) | no `charge.success`, no order; client poll times out → `failed` (no fabricated success) | full stack |
| T-09 | mobile_money guard | Inspect initialize `channels` for NG | `mobile_money` absent | edge |
| T-10 | Session gate | Paystack brand, paid event, create session | no `stripe_account_not_ready`; Stripe brand w/o account still raises it | RPC |

Webhook deno tests (mock with documented Paystack payload shapes per COMMS-0003): feed a `{ event:"charge.success", data:{ reference, status:"success", amount, currency:"NGN", channel:"card", id } }` body + a valid HMAC-SHA512 signature, assert finalize is called and idempotent on replay; feed a mismatched amount, assert no finalize.

---

## 9. INVARIANTS

- **I-PAYSTACK-WEBHOOK-VERIFY-FIRST (new, Phase 1):** `paystack-webhook` MUST verify `x-paystack-signature` (HMAC-SHA512, raw body, secret key) before any state change; finalize only after `paystackVerifyTransaction` returns `data.status==='success'` AND amount+currency match.
- **I-PAYSTACK-NG-NO-MOBILE-MONEY (new):** the NG `channels` allowlist never contains `mobile_money`.
- **I-STRIPE-PATH-UNCHANGED (preserve):** `payment_provider='stripe'` produces byte-identical create/finalize behaviour (SC-1, SC-12).
- **I-ALLIN-ENGINE-SINGLE-OWNER (preserve, Constitution #2 / COMMS-0014):** all-in math stays in `allInPricingEngine.ts`; the Paystack arm adds only `computeConfigVat`, no parallel money math.
- **I-FINALIZE-RPC-REUSED (new):** Paystack orders are created through the existing `biz_ticket_checkout_finalize` (no parallel finalize).
- **I-1076-BACKEND-ALLOWLIST-SAME-COMMIT (COMMS-0002):** the `META_ORCH_1076_BACKEND_ALLOWLIST` lands in the same commit as the backend diff; C7 green.
- **I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (COMMS-0003):** every Paystack endpoint/param/enum/event in this spec carries its docs URL inline.

---

## 10. IMPLEMENTATION ORDER
1. Migration (§3.1) → `supabase db push --linked` → invariant probes (§7.2).
2. `_shared/paymentProvider.ts` resolver + `_shared/allInPricingEngine.ts` NG VAT (§3.2) + Deno tests.
3. `ticket-checkout-create` Paystack arm (§3.3) + Stripe-arm diff proof + tests.
4. `paystack-webhook` upgrade + `_shared/paystackWebhookRouter.ts` (§3.4) + idempotency/mismatch/signature deno tests; deploy `verify_jwt:false`.
5. Client arms in both `nativeCheckoutFlow` files (§3.5).
6. Strict-grep allowlist (§7.3) in the same commit as steps 1/3/4.
7. Seed (§8.1) → E2E (§8.2) in test mode.
