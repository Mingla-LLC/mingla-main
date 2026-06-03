# SPEC — ORCH-1034 [de-GBP-ify the currency layer — charge in seller currency]

- **Status:** DRAFT (SPEC ONLY — no code, no db push, no deploy)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1034-[currency-de-gbp]/` on branch `ORCH-1034-currency-de-gbp`
- **Author:** mingla-forensics (SPEC mode), 2026-06-01
- **Skills invoked:** `stripe-best-practices` (mandatory per [[stripe-skill-mandatory]] + COMMS-0003), then `mingla-forensics` SPEC.
- **Ledger:** Read COMMS_LEDGER.md on entry. Factored COMMS-0002 (backend strict-grep allowlist) + COMMS-0003 (external-API docs cited inline). Relevant residual: COMMS-0013 (web vs native tax basis divergence — NOT this ORCH's lane; see Non-Goals).

---

## 0. One-paragraph problem statement

Mingla's platform currency layer is GBP-centric and internally inconsistent. `brands.pricing_currency` and `brands.pricing_region` are both hard-locked to GBP/GB by ORCH-1006 CHECK constraints, and the ORCH-1006 all-in pricing engine (`_shared/allInPricingEngine.ts`) has GB-baked *logic* (the `PricingRegion` type is the literal `"GB"`, and `taxBehaviorForRegion` throws on anything but `"GB"`, forcing inclusive-VAT tax behavior on every brand). Meanwhile `brands.default_currency` already carries each brand's real Stripe-synced commerce currency (ORCH-0769), and `events.currency` consistently tracks it. The result: a US-Stripe brand shows USD on commerce surfaces (events/tickets/orders) but its cart/checkout runs through a GB-inclusive-VAT tax model. **Goal:** charge each seller in their own currency (the Stripe settlement currency = zero Stripe FX), make tax behavior follow the seller's real region, and convert *display only* to the buyer's local currency — fixing the formatter's USD-base bug. No "charged in X" disclosure (operator-removed); same-currency buyers see one clean number.

---

## 1. Investigation summary — what was verified against live code + DB (five layers)

All claims below were verified against the worktree code and the **live remote DB** (Management API, read-only).

### 1.1 Live data shape (verified 2026-06-01, read-only probe)

```
default_currency | pricing_currency | pricing_region |  n | brands_with_stripe_connect_id
-----------------+------------------+----------------+----+------------------------------
 NULL            | GBP              | GB             | 21 | 0      ← 21 NULL brands have ZERO Stripe accounts
 USD             | GBP              | GB             | 15 | 13
 GBP             | GBP              | GB             | 11 | 3
 EUR             | GBP              | GB             |  2 | 2
 CHF             | GBP              | GB             |  1 | 1
```

Event-currency cross-check (events JOIN brands):
```
brand default_currency | events.currency | n
-----------------------+-----------------+----
 USD                   | USD             | 78
 EUR                   | EUR             | 31
 GBP                   | GBP             |  6
 CHF                   | CHF             |  2
 EUR                   | NULL            |  3   (drafts)
 NULL                  | USD             |  2   (no-Stripe brand, event ccy still set)
 NULL                  | GBP             |  1
```

**Findings from the data:**
- `events.currency` already tracks `brands.default_currency` 1:1 for every populated case → **`default_currency` is the established truth**; aligning `pricing_currency := default_currency` makes cart/checkout match what events/tickets/orders already display. (CONFIRMS operator diagnosis.)
- **NEW FACT not in the operator diagnosis:** all **21 NULL-`default_currency` brands have NO Stripe Connect account** (`with_stripe = 0`). Re-syncing them from Stripe settlement currency is **impossible** — there is nothing to sync from. This decides the 21-NULL recommendation (see §4).
- `pricing_region` is ALSO uniformly `'GB'` and equally wrong for the 18 non-GBP brands.

### 1.2 The charge-currency path — operator diagnosis refined (🔵 → 🔴)

The operator diagnosis said `ticket-checkout-create` "charges in `pricing_currency`." **Verified: it does NOT.** The charge currency is sourced from `session.currency`:

- `supabase/functions/ticket-checkout-create/index.ts:481` — `const currency = String(session.currency ?? "GBP").toLowerCase();`
- `session.currency` originates from the session RPC `biz_ticket_checkout_create_session` (latest def: `supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql:252-254`), which sets `v_currency := v_ticket_type.currency` (ticket → event currency) with a `COALESCE(v_currency, 'GBP')` fallback (lines 395/402/431/441).
- `currency` then flows to the PaymentIntent (`piData.currency`, `piCreateBody`, lines 762/766/1224) AND to `stripe.tax.calculations.create({ currency, … })` (line 1081).
- `pricing.pricing_currency` returned by `resolve_event_pricing_inputs` (migration `20260802000000_orch_1006_pricing_switches.sql:198`) is **resolved but never used** as the charge currency. It is effectively dead today.

🔴 **Root cause A (charge currency):** The charge currency is the *ticket/event* currency (e.g. `usd`), which is correct for the amount — BUT it diverges from the tax model, which is GB-baked (root cause B). The buyer is NOT force-charged GBP today for brands whose events carry a non-GBP currency; they are charged in the event currency with a GBP-inclusive *tax behavior* applied on top. The "force-charged GBP" symptom only manifests for brands/events that fell through to the `?? "GBP"` / `COALESCE(…, 'GBP')` fallback (NULL event currency = drafts).

### 1.3 The engine is GBP/GB-BAKED in logic, not just the constraint (🔴)

`supabase/functions/_shared/allInPricingEngine.ts`:
- L27: `export type PricingRegion = "GB";` — literal union, the ONLY allowed region.
- L37-47: `taxBehaviorForRegion(region)` — `case "GB": return "inclusive";` and the `default` branch is an exhaustive-`never` guard that **throws** `unsupported_pricing_region`. Any non-GB region is a hard runtime error.
- Call site `ticket-checkout-create/index.ts:579` `const pricingRegion = (pricing.pricing_region ?? "GB") as PricingRegion;` then L1032 `const taxBehavior = taxBehaviorForRegion(pricingRegion); // GB → "inclusive"`.

🔴 **Root cause B (tax behavior):** Tax behavior is hardcoded to GB-inclusive for every brand because `pricing_region` is constraint-locked to `'GB'` AND the engine throws on anything else. A US brand's USD charge gets inclusive-VAT treatment (US tax is exclusive). **This is GBP-BAKED LOGIC — generalization is required, not just dropping a CHECK.** (CORRECTS operator's "verify whether it's only the column constraint" — it is NOT; it is real logic.)

### 1.4 The buyer-display USD-base bug (🔴)

`app-mobile/src/services/currencyService.ts` fetches **USD-based** rates (`/v4/latest/USD`, L7): `getRate(code)` returns "1 USD = rate units of `code`".

Two formatters consume it assuming the input amount is **already USD**:
- `app-mobile/src/components/utils/formatters.ts:38-51` `formatCurrency(amount, currencyCode)` → `convertedAmount = amount * getRate(currencyCode)`. Comment L34 literally says `@param amount - Amount in USD`.
- `app-mobile/src/components/utils/preferences.ts:58-61` `convertCurrency(amountInUSD, targetCurrency)` → `amountInUSD * (rate || 1)`.

🔴 **Root cause C (display):** When the source amount is the *seller's* currency (e.g. a £20 GBP base price) and the buyer's currency is EUR, the formatter computes `20 * (USD→EUR rate)` = nonsense, because it skipped the seller→USD leg. Correct cross-rate is `amount * (rate[buyer] / rate[seller])`. Same-currency (`buyer == seller`) must return the amount unchanged (no conversion, one clean number).

### 1.5 ORCH-0769 is the safe-migration template (🔵)

`supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql` is the proven idempotent pattern: NULL-tolerant `WHERE … IS NOT NULL`, order-protecting `NOT EXISTS (… orders … total_cents > 0 … paid/refunded)`, `stripe_connect_accounts.default_currency` as the Stripe-synced settlement source mirrored into `brands.default_currency`. ORCH-1034's migration follows this exact shape.

---

## 2. Scope / Non-Goals / Assumptions

### 2.1 In scope
1. **Migration on `brands`** — drop the `pricing_currency` GBP-only CHECK; drop (or widen) the `pricing_region` GB-only CHECK; backfill `pricing_currency := default_currency` and `pricing_region := <region derived from currency>` for every brand where `default_currency` is non-NULL. Safe, idempotent, NULL-tolerant.
2. **The 21 NULL-`default_currency` brands** — handling + operator recommendation (§4).
3. **All-in pricing engine generalization** — `PricingRegion` widened beyond `"GB"`; `taxBehaviorForRegion` returns a real per-region behavior (no throw on US/EU/CH); charge currency wired to the seller currency so Stripe charges in the settlement currency (zero FX).
4. **Buyer display** — pure UX conversion FROM seller currency TO buyer profile currency; fix the USD-base bug; same-currency = identity; NO charge-currency disclosure.

### 2.2 Non-Goals (operator-locked deferrals — DO NOT spec or implement these)
- **Client-side hardcoded GBP fallbacks** — `?? "GBP"`, the literal `priceGbp` field name, `normalizeCurrency(null) → "GBP"` (~dozen files across app-mobile + mingla-business). Deferred to a separate follow-up ORCH (operator decision 2026-06-01). **Accepted residual:** drafts / unsaved / unpopulated-currency rows may still render `£` until that cleanup ships (narrow business-side draft edge).
- **Web hosted-Checkout tax basis** (COMMS-0013) — the web branch uses `automatic_tax` (buyer-address) vs native venue-inclusive. Out of this ORCH; native app is the primary buyer surface. ORCH-1034 must NOT regress the web fee/currency path but does not unify its tax basis.
- **Multi-currency carts** — `mixed_currency_cart` already rejects mixed-currency carts (ORCH-0955 RPC L254). ORCH-1034 keeps single-currency-per-cart; not changed.
- **Re-deriving `default_currency` from Stripe for brands that already have it** — `default_currency` is treated as the trusted Stripe-synced truth (operator-locked; no re-sync of populated rows).

### 2.3 Assumptions
- `default_currency` values are valid ISO-4217 uppercase codes (verified: USD/GBP/EUR/CHF only in live data). The migration uppercases defensively.
- The `tax_country_unsupported` degrade path (engine flat-absorb) already exists and correctly catches Stripe-unsupported regions; generalization relies on it for any region whose tax model we do not explicitly map.

---

## 3. Cross-Surface Impact (Phase 2.5 — mandatory)

| # | Surface | Covered? | Behaviour ORCH-1034 demands | Files | Parity |
|---|---------|----------|------------------------------|-------|--------|
| 1 | Consumer iOS (`app-mobile`) | YES | Cart/checkout charges in seller currency; PaymentSheet shows seller-currency total; deck/event/cart display converts FROM seller currency TO buyer currency (USD-base bug fixed); same-currency = one number, no conversion. | `app-mobile/src/components/utils/formatters.ts`, `.../preferences.ts`, `app-mobile/src/services/currencyService.ts` (rate cross-leg helper) | Shared RN — iOS+Android parity automatic, but VERIFY both (SC per platform). |
| 2 | Consumer Android (`app-mobile`) | YES | Same as iOS. | Same. | Shared code → SC-DISPLAY-Android mirrors SC-DISPLAY-iOS. |
| 3 | Buyer/anon Web (`mingla-business` `/checkout`, `/e/…`, `/b/…`) | PARTIAL | The shared `ticket-checkout-create` charge-currency + engine generalization apply (web routes through the same edge fn). Web tax-basis unification is OUT (COMMS-0013). Web buyer display conversion is NOT in this ORCH's display scope (web reads its own formatter). | `supabase/functions/ticket-checkout-create/index.ts`, `_shared/allInPricingEngine.ts` | Charge currency: shared. Display: web NOT touched (residual). |
| 4 | Business iOS (`mingla-business`) | NO (display residual) | Brand sees its own commerce currency on dashboards (already correct via `default_currency`). Draft £-fallback residual accepted (Non-Goal). | — | — |
| 5 | Business Android (`mingla-business`) | NO | Same as Business iOS. | — | — |
| 6 | Admin Web (`mingla-admin`) | NO | Admin pricing/ take-rate UI is currency-agnostic (bps). No change. | — | admin doesn't render buyer currency. |
| 7 | Business Web preview | NO | No buyer-currency surface. | — | — |

**Manual-parity success criteria** are split per surface in §5 (SC-DISPLAY-iOS / SC-DISPLAY-Android; SC-CHARGE shared edge).

---

## 4. OPERATOR DECISIONS TO SURFACE (flag at REVIEW)

### DECISION-1 — The 21 NULL-`default_currency` brands (RECOMMENDED path below)

Live fact: **all 21 have NO Stripe Connect account** (`with_stripe = 0`). Therefore:
- Stripe re-sync is **impossible** (no account → no settlement currency to read). The ORCH-0769 mechanism (`stripe_connect_accounts.default_currency`) cannot help them.
- They cannot take a paid checkout anyway (`ticket-checkout-create` returns `stripe_account_not_ready` (409) when `stripeAccountId` is null — verified L540-542). So their cart can never charge real money in the current architecture.

**Three options:**
- **(a) Leave `default_currency` NULL + safe display fallback** — and align `pricing_currency` only when `default_currency` is non-NULL (migration already does this). Their `pricing_currency` stays `GBP` (or is set NULL). Cart can't charge anyway. **← RECOMMENDED.** Cleanest, zero false data, honest. When/if they connect Stripe, the existing ORCH-0769 sync sets `default_currency` and a future login/refresh aligns `pricing_currency`. Accepted residual: their drafts may show `£` (covered by the deferred client-fallback cleanup).
- **(b) Default them to a launch currency (USD)** — writes a *guessed* currency. Risk: a brand that later connects a GBP Stripe account now shows USD. Fabricates data (violates Constitution #9 spirit). NOT recommended.
- **(c) Backfill from `events.currency`** — 3 of the 21 have an event currency set (2 USD, 1 GBP). Could backfill those 3 from their event currency and leave 18 NULL. Marginal; adds branching for 3 brands that can't charge. NOT recommended as the primary path; could be a tiny bonus if operator wants it.

**RECOMMENDATION: option (a)** — align only non-NULL `default_currency`; leave the 21 NULL; the migration must NOT abort on them (handled by `WHERE default_currency IS NOT NULL`). Optionally fold (c)'s 3-event-currency backfill if Seth wants; spec'd as OPEN.

### DECISION-2 — `pricing_region` region-mapping policy (engine generalization)

The engine needs a currency→region→tax-behavior map. Two sub-decisions:
- **What regions to enable now?** Live currencies are USD, GBP, EUR, CHF. Recommend mapping: `GBP→GB (inclusive)`, `EUR→EU-inclusive`, `CHF→CH-inclusive`, `USD→US (exclusive)`. Any unmapped currency → degrade to flat-absorb (existing path), never throw.
- **Is tax behavior really per *currency* or per *venue country*?** Stripe Tax sources tax at the **venue address** (`customer_details.address`), independent of charge currency. The `tax_behavior` (inclusive vs exclusive) is a *presentation* choice that should follow the seller's market convention. RECOMMEND: derive `pricing_region` from `default_currency` for the migration backfill (currency is the only signal we have at brand level), and have the engine map region→tax_behavior. Flag to operator: if a brand sells in USD but at a UK venue, the region/currency may disagree — for launch this is acceptable because `pricing_region` is derived from currency and the venue address still drives the actual tax *rate* via Stripe. **Operator: confirm currency→region derivation is acceptable, or specify an explicit venue-country source.**

### DECISION-3 — Drop vs widen the `pricing_region` CHECK

Recommend **widen** to an allowlist of enabled regions (`CHECK (pricing_region IN ('GB','US','EU','CH'))`) rather than drop entirely, so an unmapped region can't silently enter and surprise the engine. Drop the `pricing_currency` CHECK entirely (currency is validated by Stripe at charge time; an allowlist would need constant maintenance as Stripe adds currencies). **Operator: confirm widen-region / drop-currency-check split.**

---

## 5. Layer-by-layer specification

### 5.A — Database migration

**File (collision-checked):** highest existing prefix across anchor `main` + all active worktrees = `20260810000000_orch_1027_launch_cities.sql`. Use:

```
supabase/migrations/20260811000000_orch_1034_currency_de_gbp.sql
```

**Contract (🔒 LOCKED unless tagged OPEN):**

```sql
BEGIN;

-- ─── 1. Drop the GBP-only currency CHECK (currency validated by Stripe at charge) ───
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_pricing_currency_allowlist;

-- ─── 2. Widen the region CHECK to the enabled-region allowlist (DECISION-3) ───
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_pricing_region_allowlist;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_pricing_region_allowlist') THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_pricing_region_allowlist
      CHECK (pricing_region IN ('GB','US','EU','CH'));  -- DECISION-2 enabled set
  END IF;
END$$;

-- ─── 3. Align pricing_currency := default_currency for non-NULL brands (NULL-tolerant) ───
--    Idempotent: re-running is a no-op once aligned. NEVER touches the 21 NULL rows.
UPDATE public.brands
   SET pricing_currency = upper(default_currency::text),
       updated_at       = now()
 WHERE default_currency IS NOT NULL
   AND upper(default_currency::text) IS DISTINCT FROM pricing_currency;

-- ─── 4. Derive pricing_region from currency for non-NULL brands (DECISION-2) ───
UPDATE public.brands
   SET pricing_region = CASE upper(default_currency::text)
                          WHEN 'GBP' THEN 'GB'
                          WHEN 'USD' THEN 'US'
                          WHEN 'EUR' THEN 'EU'
                          WHEN 'CHF' THEN 'CH'
                          ELSE pricing_region        -- leave unmapped as-is (no abort)
                        END,
       updated_at = now()
 WHERE default_currency IS NOT NULL
   AND upper(default_currency::text) IN ('GBP','USD','EUR','CHF');

-- ─── 5. (OPEN — DECISION-1 option c) Optional: backfill the 3 NULL-default brands
--        that have an event currency, from events.currency. Leave the other 18 NULL.
--        Include ONLY if operator approves option (c). Default: OMIT.

COMMIT;
```

**Safe-migration notes (🔒 LOCKED):**
- **NULL-abort guard:** every UPDATE is gated `WHERE default_currency IS NOT NULL`. The 21 NULL rows are never read for write → migration cannot abort on them. Verified shape: 21 rows have NULL `default_currency`.
- **No data loss / no money rows touched:** this migration only rewrites two config columns (`pricing_currency`, `pricing_region`) on `brands`. It does NOT touch `events.currency`, `orders.currency`, `ticket_types.currency`, or any money-bearing row (those already match `default_currency` per §1.1). No order-protection clause needed because no money row is rewritten.
- **Idempotent:** the `IS DISTINCT FROM` guard makes re-runs no-ops; constraint adds are `IF NOT EXISTS`.
- **Read-only pre-probe (required before db push):** implementor MUST run the exact §1.1 distribution query against the linked remote (read-only) and paste the result into the implementation report, confirming the 21-NULL count and the currency distribution are unchanged from this SPEC before applying. If the shape drifted, STOP and re-confirm with operator.

### 5.B — Pricing engine generalization (`_shared/allInPricingEngine.ts`)

🔒 **LOCKED contract:**
1. `PricingRegion` widened from `"GB"` to a union of enabled regions: `"GB" | "US" | "EU" | "CH"`.
2. `taxBehaviorForRegion(region)` returns a real behavior for each: `GB/EU/CH → "inclusive"`, `US → "exclusive"`. The exhaustive-`never` guard remains for genuinely unmapped regions (programming error), BUT the call site (5.C) must NEVER pass an unmapped region — it degrades to flat-absorb first (see 5.C).
3. The Stripe-doc citations already present in the file header (L13-18) are extended to cover the new region/behavior mapping. Cite inline:
   - `tax_behavior` inclusive|exclusive: https://docs.stripe.com/api/tax/calculations/create#create_tax_calculation-line_items-tax_behavior
   - amounts in smallest currency unit (zero-decimal currencies — JPY etc. carry NO minor unit): https://docs.stripe.com/currencies
4. `PricingBreakdown.currency` and `ComputeAllInInput.currency` are unchanged in shape (already a free `string`) — the value now flows from the seller currency (5.C), not a GBP assumption. The integer-bps fee math (`feeFromBps`) is currency-agnostic and unchanged.
5. **Zero-decimal currency safety (🔒 LOCKED, NEW):** `feeFromBps` and all cents math already operate in minor units, which is correct for two-decimal currencies. Add a guard/comment that for zero-decimal currencies (JPY, KRW, etc. per https://docs.stripe.com/currencies) the "cents" are whole units; since none of the live currencies (USD/GBP/EUR/CHF) are zero-decimal this is a forward-safety note, not a launch behavior change. Engine math stays integer-minor-unit throughout.

🎨 **OPEN:** the exact internal structure of the region→behavior map (lookup table vs switch); naming of the new region literals; whether to add a `regionForCurrency(currency)` helper in the engine vs the call site (implementor's call, as long as the call site never throws on a live currency).

### 5.C — Charge-currency wiring (`ticket-checkout-create/index.ts`)

🔒 **LOCKED contract:**
1. **Charge currency = seller settlement currency.** The PaymentIntent `currency`, the Stripe Tax `currency`, and the persisted session/order currency MUST all be the brand's `pricing_currency` (now aligned to `default_currency` = Stripe settlement currency). Today's `session.currency` (ticket/event currency) already equals this for populated rows; after the migration `pricing_currency` is the canonical authority. The implementor MUST source the charge currency from `pricing.pricing_currency` (the resolver already returns it, L573) and assert it equals `session.currency` when both are present; on mismatch, prefer `pricing_currency` and log a warning (the migration should have aligned them). **Rationale + Stripe doc:** charging in the connected account's settlement currency avoids Stripe FX. `on_behalf_of` "Settles charges in the country of the specified account to minimize declines and avoid currency conversions" — https://docs.stripe.com/connect/charges . Presentment currency == settlement currency ⇒ no conversion fee — https://docs.stripe.com/currencies .
2. **Region must follow the seller.** `const pricingRegion = pricing.pricing_region` — remove the `?? "GB"` hardcode at L579 when `pricing_region` is a mapped/enabled region. If `pricing_region` is NULL or unmapped, **degrade to flat-absorb** (`taxBasis = "unresolved_flat_absorb"`, no tax line) BEFORE calling `taxBehaviorForRegion` — never let the engine throw on a real checkout (§1.3 regression).
3. **Remove the `?? "GBP"` charge fallbacks** at L481/874/1185/1343 only insofar as they affect the *charge currency authority* — replace with the resolved `pricing_currency`. (Client-side `?? "GBP"` display fallbacks remain OUT of scope per Non-Goals; this item is the *server charge* fallback, which IS in scope.) If `pricing_currency` is somehow NULL at charge time (should be impossible post-migration for a Stripe-ready brand), return a clean `409 pricing_config_unavailable` rather than silently charging GBP.
4. **Stripe Tax call** (L1079-1101) keeps `currency` = seller currency and `tax_behavior` = `taxBehaviorForRegion(pricingRegion)` (now region-correct). `customer_details.address` stays the venue address. Doc: https://docs.stripe.com/api/tax/calculations/create .
5. **application_fee_amount** stays in the same currency as the charge (it is a sub-amount of the PaymentIntent) — no change needed; doc: https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount .

🎨 **OPEN:** whether the assert-and-prefer between `pricing_currency` and `session.currency` is a hard 409 or a warn-and-prefer (implementor picks the safer of the two given the post-migration guarantee, documents the choice).

### 5.D — Buyer display: pure UX conversion (fix USD-base bug)

🔒 **LOCKED contract:**
1. Conversion is a **cross-rate**: to convert `amount` from `sellerCurrency` to `buyerCurrency` using USD-based rates: `converted = amount * (getRate(buyerCurrency) / getRate(sellerCurrency))`. This corrects the current `amount * getRate(buyerCurrency)` which omits the seller→USD leg.
2. **Same-currency identity:** when `sellerCurrency === buyerCurrency`, return the amount unchanged — no rate math, no rounding drift. This is the US-launch common case (one clean number).
3. **Signature change:** `formatCurrency` and `convertCurrency` (and `formatPriceRange`) MUST take an explicit `sourceCurrency` (the seller currency) in addition to the existing target/`currencyCode`. The current single-arg "amount-is-USD" assumption is DELETED. Default `sourceCurrency` to `"USD"` ONLY where the source genuinely is USD (legacy non-commerce callers) — but every commerce/cart/event-price caller MUST pass the real seller currency. Implementor enumerates callers; commerce callers are LOCKED to pass `sourceCurrency`, non-money display callers are OPEN.
4. **NO charge-currency disclosure** anywhere in the UI (operator-removed). The buyer sees only the converted number in their own currency; no "you'll be charged £X" text. (The actual Stripe charge is in the seller currency — that is a silent backend fact, surfaced only on the card statement, which is acceptable and out of UI scope.)
5. **Rounding:** keep the existing per-currency decimal rules (`wholeNumberCurrencies` list in formatters.ts) applied to the *converted, buyer-currency* amount.

🎨 **OPEN:** exact helper factoring (a new `convertBetween(amount, from, to)` in `currencyService.ts` vs inline in formatters); how aggressively to thread `sourceCurrency` through non-commerce display callers (must not break them; LOCKED only that commerce callers pass it).

**No-AI-slop / visual note:** this layer changes numbers, not chrome. No new UI surface, no new copy, no new components → no design-token contract needed. If any *new* "converted price" affordance is added (it should not be), it must follow existing price-pill tokens — but the LOCKED expectation is zero new visual surface. **References examined:** existing Mingla price-pill rendering (`formatters.ts` consumers); no new design pass required (confirmed with dispatch — display-math only).

---

## 6. Success criteria (observable, testable, unambiguous)

- **SC-MIGRATE-1:** After migration, `SELECT count(*) FROM brands WHERE default_currency IS NOT NULL AND pricing_currency <> upper(default_currency::text)` = 0.
- **SC-MIGRATE-2:** The 21 NULL-`default_currency` rows are unchanged in count and still NULL (migration did not abort or mutate them). `SELECT count(*) FROM brands WHERE default_currency IS NULL` = 21 (or current probed count).
- **SC-MIGRATE-3:** `pricing_region` for every non-NULL brand matches the currency→region map (GBP→GB, USD→US, EUR→EU, CHF→CH).
- **SC-MIGRATE-4:** The `brands_pricing_currency_allowlist` CHECK no longer exists; `brands_pricing_region_allowlist` now permits `('GB','US','EU','CH')`.
- **SC-CHARGE-1:** A USD-Stripe brand's checkout creates a PaymentIntent with `currency: "usd"` (verified in the implementor happy-path test) — seller currency, zero Stripe FX.
- **SC-CHARGE-2:** A US brand's Stripe Tax calculation uses `tax_behavior: "exclusive"` (region US), NOT inclusive; a GB brand uses `"inclusive"`. No `unsupported_pricing_region` throw on any live-currency checkout.
- **SC-CHARGE-3:** A brand whose `pricing_region` is NULL/unmapped degrades to flat-absorb (no tax line, session succeeds) — the engine never throws on a real checkout.
- **SC-DISPLAY-iOS:** On iOS, an event priced £20 (seller GBP) shown to a EUR-profile buyer renders the correct EUR cross-rate (`20 * EUR/GBP`), NOT `20 * USD→EUR`. Verified live on sim.
- **SC-DISPLAY-Android:** Same as SC-DISPLAY-iOS on Android (shared code; verify both per parity rule).
- **SC-DISPLAY-SAME:** When seller currency == buyer currency (US launch: USD seller, USD buyer), the displayed amount equals the source amount exactly, no conversion, one clean number.
- **SC-NODISCLOSE:** No UI string anywhere states the charge currency or "you will be charged in X".
- **SC-RESIDUAL:** A draft/unpopulated-currency row may still render `£` (accepted residual; NOT a failure — documented Non-Goal).

---

## 7. Invariants

| ID | Invariant | Preserved how | Verified by |
|----|-----------|---------------|-------------|
| I-PROPOSED-CHARGE-IN-SELLER-CURRENCY (NEW) | The PaymentIntent + Stripe Tax currency == the brand's settlement currency (`pricing_currency` = `default_currency`). | 5.A aligns the column; 5.C sources charge currency from it. | SC-CHARGE-1; strict-grep optional. |
| I-PROPOSED-ALLIN-REGION-TAX-BEHAVIOR (existing, ORCH-1006) | Tax behavior is derived from region, NEVER a hardcoded literal at the call site. | 5.B widens the map; 5.C passes the resolved region. | SC-CHARGE-2. |
| I-PROPOSED-TAKE-RATE-BPS-INTEGER (existing) | Fee math is integer basis points, no float. | Unchanged; `feeFromBps` untouched. | engine unit test. |
| I-PROPOSED-DISPLAY-CROSS-RATE (NEW) | Display conversion uses the seller→buyer cross-rate; same-currency is identity. | 5.D signature + math. | SC-DISPLAY-*. |
| I-COMMS-LEDGER (process) | COMMS-0002 allowlist + COMMS-0003 docs honored. | §9 checklist. | strict-grep C7 + SPEC doc citations. |

---

## 8. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 (happy, implementor) | US brand charge currency | USD-Stripe brand event checkout | PI `currency:"usd"`; tax_behavior `"exclusive"`; no throw | edge + Stripe TEST/mock |
| T-02 (happy, implementor) | Display converts FROM seller | seller GBP £20, buyer EUR | EUR amount = `20 * rate[EUR]/rate[GBP]` | formatters unit |
| T-03 (happy, implementor) | Same-currency no conversion | seller USD $50, buyer USD | exactly `$50.00`, no rate applied | formatters unit |
| T-04 (adversarial, tester) | Cross-currency buyer end-to-end | GBP brand, EUR buyer, live sim | cart shows EUR cross-rate; PaymentSheet charges GBP; no "charged in" text | full stack, iOS+Android sim |
| T-05 (adversarial, tester) | NULL-currency brand | one of the 21 NULL brands | migration left it NULL; checkout returns `stripe_account_not_ready` (can't charge); no GBP fabrication | DB + edge |
| T-06 (adversarial, tester) | Formerly-GBP-locked path | GB brand checkout post-migration | PI `currency:"gbp"`, tax `"inclusive"` (still correct for GB) | edge |
| T-07 (edge) | Unmapped region degrade | brand with region not in map | flat-absorb, session succeeds, engine does NOT throw | edge |
| T-08 (edge) | Migration idempotency | run migration twice | second run is a no-op (no rows changed) | DB |
| T-09 (regression, fails-on-revert) | USD-base bug regression | revert 5.D → assert T-02 FAILS | the test must fail if the cross-rate fix is reverted | formatters unit |
| T-10 (regression, fails-on-revert) | Charge-currency regression | revert 5.C → assert T-01 FAILS | must fail if charge reverts to GBP/ticket-currency-only | edge |

**Step-0.5 evidence requirements (LOCKED):**
- **Implementor happy-path** (real paths, fails-on-revert): T-01 (charge currency = brand currency, via Stripe TEST API or documented-error mock asserting the payload `currency` + `tax_behavior` per COMMS-0003), T-02 (display converts FROM seller), T-03 (same-currency = no conversion).
- **Tester adversarial** (real paths, fails-on-revert): T-04 (cross-currency buyer, live sim iOS+Android), T-05 (NULL-currency brand), T-06 (formerly-GBP-locked path).

---

## 9. Implementation order + implementor checklist

1. **DB migration** `supabase/migrations/20260811000000_orch_1034_currency_de_gbp.sql` (5.A). Run the read-only §1.1 probe FIRST; paste result in report.
2. **Engine** `_shared/allInPricingEngine.ts` (5.B) — widen region union + behavior map + extend Stripe-doc header.
3. **Call site** `ticket-checkout-create/index.ts` (5.C) — source charge currency from `pricing_currency`; region follows seller; degrade-not-throw; remove server `?? "GBP"` charge fallback.
4. **Display** `formatters.ts` + `preferences.ts` (+ optional `currencyService.ts` helper) (5.D) — cross-rate + same-currency identity + `sourceCurrency` arg threaded through commerce callers.
5. **Tests** T-01..T-10.

**HARD checklist items (LOCKED):**
- [ ] **COMMS-0002 — strict-grep allowlist:** the migration + the two modified backend files trip the ORCH-0863 C7 `no-new-backend-files` gate (it filters ALL changed paths under `supabase/migrations/` and `supabase/functions/`). In the SAME commit, add to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`:
  ```js
  const ORCH_1034_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260811000000_orch_1034_currency_de_gbp.sql",
    "supabase/functions/ticket-checkout-create/index.ts",
    "supabase/functions/_shared/allInPricingEngine.ts",
  ];
  ```
  and add `...ORCH_1034_BACKEND_ALLOWLIST,` to the combined `ALLOWLIST` array (currently ends at L1356 `...ORCH_1030_BACKEND_ALLOWLIST,`). Both modified files AND the new migration must be listed (the gate checks `!ALLOWLIST.includes(p)` for every changed backend path, modified or new).
- [ ] **COMMS-0003 — Stripe docs cited inline** for every Stripe param touched (charge `currency`, `tax_behavior`, `application_fee_amount`, `on_behalf_of` settlement) — URLs in §5.B/§5.C above; carry them into code comments.
- [ ] **db push by operator** (autonomy posture: orchestrator may push if green; this migration only rewrites 2 config columns + 1 constraint swap — low risk, but run the read-only probe first).
- [ ] **Step-0.5 tests** present and fails-on-revert (T-09/T-10).
- [ ] **Cross-surface parity:** SC-DISPLAY verified on iOS AND Android sim (tester).

---

## 10. Regression prevention

- T-09/T-10 are fails-on-revert guards for the two root-cause classes (display USD-base; charge-currency-not-seller).
- Engine `taxBehaviorForRegion` keeps its exhaustive-`never` guard so adding a new currency without mapping a region is a loud compile/runtime error, not a silent GBP fallback.
- Protective comments at the charge-currency source (5.C) and the cross-rate helper (5.D) explain WHY (cite this SPEC + the Stripe settlement-currency doc).
- The widened `pricing_region` CHECK prevents an unmapped region from entering `brands` silently.

---

## 11. References examined
- Stripe docs (verified via `stripe-best-practices` + WebFetch 2026-06-01): connect/charges (on_behalf_of settlement), currencies (presentment vs settlement, zero-decimal), tax/custom (tax_behavior, currency required), payment_intents application_fee_amount.
- Live remote DB (Management API, read-only): brand currency distribution + Stripe linkage + event-currency cross-check.
- Code: `allInPricingEngine.ts`, `ticket-checkout-create/index.ts`, `formatters.ts`, `preferences.ts`, `currencyService.ts`, migrations `20260802000000_orch_1006_pricing_switches.sql`, `20260727000000_orch_0955_native_stripe_tax.sql`, `20260515000011_orch_0769_no_implicit_gbp_currency.sql`, strict-grep `orch-0863-marketing-hub-phase-b.mjs`.
</content>
