# SPEC — ORCH-1006 [Universal all-in pricing engine]

**ORCH:** ORCH-1006 [Universal all-in pricing engine]
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1006-[universal-allin-pricing-engine]/` on branch `ORCH-1006-universal-allin-pricing-engine`
**Mode:** SPEC (builds on the proven INVESTIGATE report; no code in this artifact)
**Date:** 2026-05-29
**Author:** mingla-forensics (Claude)
**Inputs:**
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` (this worktree) — proven current-state map.
- Vision + 7 operator-locked decisions: `~/.claude/.../memory/project_checkout_allin_pricing_fee_tax_toggles.md`.
- Comms ledger: `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`.
- `stripe-best-practices` skill (invoked at SPEC start, mandatory per `[[stripe-skill-mandatory]]`).

**Comms ledger acks (this turn):**
- **COMMS-0003** (WARN, ALL — external-API docs URLs cited inline): satisfied — every Stripe enum / payload / endpoint introduced or modified below carries an inline canonical docs URL (§B, §C, §D).
- **COMMS-0002** (WARN, ALL — new backend files need the ORCH allowlist entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`): factored — see §G.6 (CI). This spec introduces new migrations and edits existing edge functions; the allowlist entry is a HARD implementor checklist item.

**⚠ TOOL-CHANNEL NOTE (honesty per Prime Directive 1):** during SPEC authoring the Bash/Read tool channel entered a replay loop after the authoritative edge function was read in full. The contracts below are grounded firsthand in `ticket-checkout-create/index.ts` (read in full, 1289 lines), the investigation report (read in full), the vision doc, and the comms ledger. A small number of file-detail confirmations the investigation listed as RE-READ PENDING could not be re-opened this turn and are tagged **[CONFIRM at IMPLEMENT]** inline — these are line-level confirmations, not design uncertainties. The implementor MUST resolve each before coding the affected line.

---

## 0. Layman summary

Today a buyer must type a full billing address and tap "Calculate tax" before they can pay — and because almost no brand is registered for tax, that button computes £0 for nearly everyone. It is pure friction. This spec replaces that with: the brand sets up to three switches when they create an event/trip/experience (tax, Mingla fee, processing-as-service-fee — each "pass to buyer" or "absorb"), the server computes ONE final price from the venue's location, and the buyer sees that single all-in number everywhere — on the card, the detail page, and at checkout. One tap, no typing, no surprise. UK-first (VAT is baked-in by law), built so the US can be switched on later as config. Existing live events default to "absorb everything" so no price visibly moves.

---

## 1. Scope, Non-Goals, Assumptions

### 1.1 Scope (🔒 LOCKED)
- A region-aware **money engine** computed server-side that turns `(base price tiers, 3 switches, region/currency, venue tax basis)` into ONE buyer total + the money split, with **zero buyer-entered address**.
- **3 brand switches** (sales tax, Mingla platform fee, processing-cost-as-service-fee), each `pass | absorb`, stored as brand-level defaults + per-offering override, on the unified `events` table (events + trips + experiences are all `events` rows — proven §2 of investigation).
- **WYSIWYP display** across every pre-checkout price surface enumerated in §D when costs are passed.
- **Removal of the buyer billing-address form + "Calculate tax" gate** on the native consumer + native business checkout (`CartTaxPreview.tsx` + the `taxPreview===null` CTA gate).
- **Native checkout rewire**: venue-address tax basis (not buyer billing), PaymentSheet receives a single pre-computed total, receipt/confirmation carries the breakdown.
- **Migration** defaulting existing events to all-absorb (decision #4).
- **Lock-after-first-sale** for the switches (decision #5), mirroring the existing buyer-protection date-change mechanism (`business_patch_event_when` / `multi_date_remove_with_sales` — see §A.5).
- **Brand "you absorbed £X" reporting line** (decision #6).
- **Hide "pass tax" switch until the brand registered a Stripe Tax jurisdiction** (decision #2).
- **Jurisdiction-unresolvable → flat brand-absorbed price** fallback (decision #1).
- Preserve the existing installment path (ORCH-0925) and the refund tax-reversal path.

### 1.2 Non-Goals (🔒 LOCKED)
- **US tax turn-on.** UK-first. The data model + tax-behavior mapping MUST accommodate US "add-on-top" semantics (§B.5), but no US jurisdiction is enabled, no US tax_code path is exercised, no US registration UI is built this ORCH. US is a later config turn-on, not a rewrite.
- **Web / mobile-web buyer path** (`mingla-business/` hosted Checkout with `automatic_tax`). OUT of scope per vision — already frictionless. The native↔web tax-basis divergence is documented as a **known gap** (§F.2) for a later sub-ORCH; this spec does NOT change the web path.
- **Building experiences paid-checkout wiring.** That is `meta-orch-0980`'s lane. This spec defines the engine so experiences inherit it for free; coordination contract in §G.7.
- **True card surcharging.** The processing-cost recovery is a flat disclosed **service fee** charged uniformly to ALL buyers (Eventbrite model), never card-type-conditional (that would re-classify it as a regulated surcharge — investigation §6.2, https://docs.stripe.com/payments/surcharging).
- **Dynamic Mingla-fee percentage UI.** The 1.5% stays a constant this ORCH; the only new behavior is whether it is passed or absorbed.

### 1.3 Assumptions (must hold; flagged if not)
- `events` is the single table for all three offering types (PROVEN, investigation §2).
- `biz_ticket_checkout_create_session` returns `totalCents`, `currency`, `stripeAccountId`, `lineItems` (PROVEN from edge fn lines 528-529, 595-597, 1004-1008). **[CONFIRM at IMPLEMENT]** the latest migration definition of this RPC and whether it is the right home to read the switch columns + compute the absorb gross-up (recommended home — §C.3).
- `events.location_text` holds a single formatted Google-Places string; structured components + lat/lng presence **[CONFIRM at IMPLEMENT]** (investigation §4.1). This spec specs BOTH paths (capture-structured vs reverse-geocode) and lets the IMPLEMENT confirmation pick — see §B.

---

## 2. The 7 operator-locked decisions → where each is implemented

| # | Decision | Implemented in |
|---|---|---|
| 1 | Jurisdiction unresolvable → flat brand-absorbed price | §B.4 resolution ladder; §C.5 engine fallback |
| 2 | Unregistered brand → HIDE "pass tax" switch | §E.4 (authoring UI gate) + §C.2 (server registration probe) |
| 3 | ONE all-in number at checkout; breakdown on receipt only | §D.5 (checkout), §D.6 (receipt) |
| 4 | Migration: existing events default to ALL-ABSORB | §A.6 (migration) |
| 5 | Switches LOCK after first sale | §A.5 (`first_sale_at` derivation) + §E.3 (disabled UI) |
| 6 | Absorb mode shows brand "you absorbed £X" line | §A.4 (persisted absorbed amounts) + §E.5 (reporting line) |
| 7 | UK-first, region-extensible (UK inclusive VAT vs US add-on) | §B.5 (region→tax_behavior mapping) + §A.1 (region/currency columns) |

---

## A. DATA MODEL

### A.1 Brand-level defaults (🔒 LOCKED)

New columns on `brands` (brand-wide defaults a brand sets once; per-offering override in A.2):

```
ALTER TABLE public.brands
  ADD COLUMN default_pass_tax            boolean NOT NULL DEFAULT false,
  ADD COLUMN default_pass_mingla_fee     boolean NOT NULL DEFAULT false,
  ADD COLUMN default_pass_service_fee    boolean NOT NULL DEFAULT false,
  ADD COLUMN pricing_region              text    NOT NULL DEFAULT 'GB'
    CHECK (pricing_region IN ('GB')),   -- region allowlist; US added by later ALTER, not now
  ADD COLUMN pricing_currency            text    NOT NULL DEFAULT 'GBP'
    CHECK (pricing_currency IN ('GBP'));
```

- `false` = absorb (the default everywhere — decision #4 + zero-surprise to existing brands).
- `pricing_region` is the engine's behavior selector (§B.5). Region allowlist is intentionally `('GB')` only; turning on US is a one-line `CHECK` widen + a `'US'` branch in §B.5 — **config, not rewrite** (decision #7).
- `pricing_currency` `CHECK` kept in lockstep with region; widened with US.
- 🎨 OPEN-for-designer: nothing here is visual.

**[CONFIRM at IMPLEMENT]** exact `brands` PK + that no later migration already added a `pricing_*` column (grep-all → sort → read-latest per Phase 0c).

### A.2 Per-offering override (🔒 LOCKED)

New columns on `events` (per-offering override of the brand default; NULL = inherit brand default):

```
ALTER TABLE public.events
  ADD COLUMN pass_tax            boolean,    -- NULL = inherit brands.default_pass_tax
  ADD COLUMN pass_mingla_fee     boolean,    -- NULL = inherit brands.default_pass_mingla_fee
  ADD COLUMN pass_service_fee    boolean,    -- NULL = inherit brands.default_pass_service_fee
  ADD COLUMN pricing_locked_at   timestamptz, -- set on first sale; see A.5
  ADD COLUMN venue_tax_address   jsonb;       -- structured {line1,line2?,city,state?,postal_code,country}
                                              -- resolved venue address basis; see B
```

- Three-valued `boolean` (NULL/true/false) is deliberate: NULL = "follow brand default", non-NULL = "this offering overrides". The engine resolves `COALESCE(events.pass_x, brands.default_pass_x)` (§C.1).
- `venue_tax_address` is the structured Stripe-Tax basis (§B). NULL = unresolved → flat-absorb fallback (decision #1).
- Rationale for storing on `events` not a separate `pricing_config` table: events+trips+experiences are ONE table, checkout already keys on `eventId`, and the switches are 1:1 with the offering. A jsonb blob was considered and rejected — discrete boolean columns are queryable by the display views (§D) and by strict-grep, and avoid a jsonb-shape contract drift.

**[CONFIRM at IMPLEMENT]** `events` PK/owner columns + that the public views (`business_public_events_view`, `claimed_venues_public_view`) must be re-`CREATE OR REPLACE`d to expose the resolved switches + all-in price (§D.1). A view-exposing migration is REQUIRED (the investigation found ORCH-0824/0964 precedent for view exposure).

### A.3 Resolved-switch + pricing breakdown on the session/order (🔒 LOCKED)

Extend `ticket_checkout_sessions` and `orders` (the session row already carries `tax_calculation_id`, `tax_amount_cents`, `stripe_application_fee_amount_cents` — edge fn lines 1107-1114, 629-635; finalize copies session→order, investigation §1.3):

```
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN pricing_breakdown jsonb;  -- canonical engine output, see C.6 shape
ALTER TABLE public.orders
  ADD COLUMN pricing_breakdown jsonb;  -- copied from session at finalize (decision #6 receipt source)
```

`pricing_breakdown` is the single canonical money record (shape in §C.6). It is the source for: the receipt breakdown (decision #3/#6), the brand "you absorbed £X" line (decision #6), and refund-time reversal math (§G.4). One owner of truth (Constitution #2).

### A.4 Absorbed-amount surfacing (decision #6) (🔒 LOCKED)
- The absorbed components live inside `pricing_breakdown.absorbed` (per-component cents: `tax`, `mingla_fee`, `service_fee`). They are NOT separate columns — one jsonb owner.
- Brand reporting reads `SUM` of `orders.pricing_breakdown->'absorbed'` per offering (§E.5). No silent payout reduction: absorb still reduces the connected-account settlement exactly as today (the brand eats it), but it is now *surfaced* (decision #6 is "don't silently reduce — surface it", which is a DISPLAY requirement, not a money-flow change).

### A.5 Lock-after-first-sale (decision #5) (🔒 LOCKED)
- **Derivation, not a flag the brand can set.** `events.pricing_locked_at` is stamped (set to `now()`) the first time an order for that event reaches a paid/finalized state.
- **Existing lock mechanism to mirror (cited):** the buyer-protection date-change rule lives in RPC `business_patch_event_when`, which raises `multi_date_remove_with_sales` when an event with active orders attempts a protected mutation (proven in COMMS-0006: event `09b4ece6-…` with 6 orders rejected a date change with exactly that error; ORCH-0877/0875). The pricing-switch lock MUST reuse the SAME "event has ≥1 active order" predicate so the two protections agree (Constitution #13 exclusion consistency).
- **Where stamped:** in `biz_ticket_checkout_finalize` (the RPC that creates the order, edge fn lines 563-572) — on first successful finalize for an event, `UPDATE events SET pricing_locked_at = now() WHERE id = p_event_id AND pricing_locked_at IS NULL`. **[CONFIRM at IMPLEMENT]** the latest `biz_ticket_checkout_finalize` definition is the right insertion point and that it knows `event_id`.
- **Enforcement:** the brand-side switch-mutation RPC (new — §E.6) raises `pricing_switches_locked` when `pricing_locked_at IS NOT NULL`. The authoring UI disables the switches (§E.3).

### A.6 Migration: existing events default to ALL-ABSORB (decision #4) (🔒 LOCKED)
- Columns default to `false` (brands) / `NULL`→inherit-`false` (events) per A.1/A.2, so **existing rows are all-absorb by construction** — no data backfill needed for the switches.
- `venue_tax_address` backfills to `NULL` (unresolved) for existing rows → they take the flat-absorb path (decision #1) until re-resolved at next edit. Because they are all-absorb, tax is £0-passed regardless, so the buyer-facing price is UNCHANGED (decision #4 satisfied: "nothing visibly moves").
- **Migration-filename collision-check rule (🔒 LOCKED — COMMS-0004 + spawn.sh SOP):** before naming the migration, the implementor MUST grep ALL active worktrees (`~/Desktop/mingla-orchs/*/supabase/migrations/`) + `main` for the highest `2026MMDD` prefix and pick a strictly-greater timestamp. The investigation noted sibling worktrees `meta-orch-0980` + `ORCH-0998` may carry later migrations. Do NOT hardcode a timestamp in this spec — resolve at IMPLEMENT against live worktrees. Suggested base name once timestamp chosen: `<TS>_orch_1006_pricing_switches.sql` + `<TS+1>_orch_1006_pricing_views.sql`.

### A.7 RLS (🔒 LOCKED)
- New `brands`/`events` columns inherit existing table RLS (no new tables). Verify the brand-owner UPDATE policy covers the new columns and that the public views expose ONLY the resolved all-in price + booleans, never internal fee math, to anon (mirror ORCH-0964 security-definer view pattern — COMMS-0009).
- The switch-mutation RPC (§E.6) is `SECURITY DEFINER`, owner-gated, and pairs an owner-direct UPDATE predicate (per `[[rls-returning-owner-gap]]`).

---

## B. TAX-SOURCING CONTRACT

### B.1 The problem (PROVEN, investigation §4.3)
Stripe Tax `tax.calculations.create` requires a **structured** `customer_details.address` (`{line1, city, state?, postal_code, country}`) — doc: https://docs.stripe.com/api/tax/calculations/create. We store a single formatted Google-Places string in `events.location_text`. WYSIWYP needs the tax basis deterministic at authoring, from the venue.

### B.2 Resolution path (🔒 LOCKED) — capture structured at authoring, reverse-geocode as fallback
1. **Primary: capture structured address-components at authoring.** When the brand picks a venue via Google Places in the authoring UI, persist the structured components (Places `addressComponents`: `streetNumber+route`→line1, `locality`→city, `administrativeAreaLevel1`→state, `postalCode`→postal_code, `country`→ISO-3166-α2) into `events.venue_tax_address` jsonb (§A.2). Google Places Place Details `addressComponents` doc: https://developers.google.com/maps/documentation/places/web-service/place-details (and the v1 `places.addressComponents` field). **[CONFIRM at IMPLEMENT]** whether the authoring publish RPC (`ORCH-0824` address-accepting RPC, investigation §4.1) already receives structured components or only the formatted string; if only the string, the authoring client must pass components through (new field on the publish RPC).
2. **Fallback: server reverse-geocode** when only `location_text` + lat/lng exist (legacy rows, or a brand who typed a freeform address). The engine attempts a one-time geocode → structured components → persist to `venue_tax_address`. (Stripe Tax does NOT accept lat/lng — investigation §4.3.)
3. **Terminal fallback (decision #1): unresolvable → flat brand-ABSORBED price.** If neither path yields a structured address with at least `{postal_code OR city, country}` sufficient for Stripe Tax, the engine forces `pass_tax = false` for THIS computation (brand absorbs), returns a clean all-in number, and records `pricing_breakdown.tax_basis = "unresolved_flat_absorb"`. The buyer still sees one number; the brand silently absorbs jurisdiction variance.

### B.3 Tax basis for admissions (🔒 LOCKED, doc-verified)
- We pass the **venue** address as `customer_details.address` (NOT the buyer's). Stripe computes tax for the jurisdiction of the address supplied; it does not validate whose address it is. Doc: https://docs.stripe.com/api/tax/calculations/create (`customer_details.address` + `customer_details.address_source`).
- `address_source`: keep `"billing"` (current value, edge fn line 1072) — admissions tax is sourced at the supplied address regardless of source label; flipping to `"shipping"` is unnecessary. **[CONFIRM at IMPLEMENT]** against https://docs.stripe.com/api/tax/calculations/create#create_tax_calculation-customer_details-address_source whether admissions sourcing differs by `address_source`; if Stripe documents a material difference, prefer the value Stripe documents for "place of supply / event location". Cite the chosen value in the implementation report.
- **`tax_code` for admissions:** current code hardcodes `txcd_50010001` (edge fn line 1060) with NO doc cite. The implementor MUST verify the correct admissions/event-ticket code against https://docs.stripe.com/tax/tax-codes and cite the exact string + its product-tax-category name in the implementation report. If `txcd_50010001` is not the admissions code, replace it. (For UK, the rate is the single national VAT rate regardless — see B.5 — but the tax_code still governs category treatment.)

### B.4 Failure points feeding decision #1 (🔒 LOCKED)
At each point below, the outcome is the **flat brand-absorbed** path (one clean number, brand eats variance), NEVER a buyer-facing error and NEVER a £0-tax friction screen:
| Failure point | Engine action |
|---|---|
| `venue_tax_address` NULL and geocode fails | force absorb; `tax_basis="unresolved_flat_absorb"` |
| Structured address missing country | force absorb; same |
| `tax.calculations.create` throws `tax_country_unsupported` (edge fn classifier lines 147-158) | force absorb; `tax_basis="country_unsupported_flat_absorb"` |
| Brand not registered in the venue jurisdiction (decision #2) | "pass tax" switch was HIDDEN at authoring, so `pass_tax` can only be absorb → already absorb |
| `tax.calculations.create` throws other error | force absorb; `tax_basis="calc_failed_flat_absorb"`; log non-fatal |

**Contrast with today (regression note):** today a tax-calc failure sets the session `status="failed"` and returns an error (edge fn lines 1090-1102). Under WYSIWYP that becomes a buyer-blocking failure for a price that should just degrade to absorb. The implementor MUST change the native path so tax-calc failure degrades to flat-absorb (preserving the buyer's single number), NOT a hard checkout failure. (Tax-calc failure on the *commit* step at the webhook stays non-fatal as today.)

### B.5 Region-aware tax_behavior mapping (decision #7) (🔒 LOCKED, doc-verified)
The same engine, switched by `brands.pricing_region`:

| Region | VAT/tax semantics | Stripe `tax_behavior` | Buyer-facing math |
|---|---|---|---|
| **GB (this ORCH)** | VAT inclusive by law; one national rate; price already includes VAT | `"inclusive"` | The displayed/charged number IS the all-in. Tax is *extracted* from it (`amount_total == subtotal` when inclusive; tax is the inclusive portion shown only on the receipt). `pass_tax=true` means "VAT is in this price" (the legal default); `pass_tax=false` (absorb) is effectively identical to the buyer but recorded differently for the brand. |
| **US (later, NOT this ORCH)** | tax added on top; 11,000+ jurisdictions; destination/venue sourced | `"exclusive"` | `pass_tax=true` → tax added on top, `amount_total = subtotal + tax`. `pass_tax=false` (absorb) → brand bakes it into subtotal, buyer pays subtotal. |

- Doc: `line_items[].tax_behavior` `inclusive` vs `exclusive` — https://docs.stripe.com/api/tax/calculations/create#create_tax_calculation-line_items-tax_behavior. `inclusive` = tax included in `amount`; `exclusive` = tax added to `amount`.
- 🔴 **The current code hardcodes `tax_behavior:"exclusive"` (edge fn line 1061).** For UK-first this MUST become `"inclusive"`. The mapping is driven by `brands.pricing_region` (`GB`→`inclusive`), NOT hardcoded. This is the single highest-leverage UK correctness change.
- **UK "pass vs absorb" subtlety (flag — see §H tension T-1):** under inclusive VAT the buyer pays the same number whether the brand "passes" or "absorbs" tax — the difference is purely whether the brand treats the VAT as part of their price (passed/included) or eats it from a notional pre-VAT base (absorbed). Because UK VAT is inclusive-by-law, decision #2's "hide pass-tax until registered" effectively means: unregistered UK brands cannot mark VAT as collected (they show a VAT-inclusive consumer price but remit nothing, which is legal for a non-VAT-registered seller under the threshold). The implementor + designer MUST present this so it is not confusing — see T-1.

### B.6 Removal of buyer-address capture (🔒 LOCKED)
- Native `create` no longer requires `buyer.address` (edge fn lines 275-288 gate DELETED).
- `parseBuyerAddress` / `validateBuyerAddress` / `BuyerAddress` type (edge fn lines 78-123, 25-32) become dead — DELETE them, do not leave drift (Constitution #8). The web path does NOT use them (web collects address on the hosted page), so removal is native-only and safe.
- `tax.calculations.create.customer_details.address` is fed from `events.venue_tax_address`, not the request body.

---

## C. THE MONEY ENGINE

### C.1 Switch resolution (🔒 LOCKED)
Effective switches = `COALESCE(events.pass_x, brands.default_pass_x)` for each of `pass_tax`, `pass_mingla_fee`, `pass_service_fee`. If `pass_tax` resolves true but venue is unresolved or brand unregistered → forced to absorb (§B.4).

### C.2 Registration probe (decision #2) (🔒 LOCKED, doc-verified)
- Stripe Tax only **collects** in jurisdictions where the connected account has a **registration** (Tax → Registrations). Doc: https://docs.stripe.com/tax/registrations and list endpoint https://docs.stripe.com/api/tax/registrations/list.
- Server probe: `stripe.tax.registrations.list({status:"active"}, {stripeAccount: stripeAccountId})` returns the brand's active jurisdictions. If empty → the "pass tax" switch is HIDDEN in authoring (§E.4) and `pass_tax` is forced absorb in the engine. **[CONFIRM at IMPLEMENT]** the exact `status` enum on the registrations list endpoint (`active` vs others) against the doc URL above; cite in the implementation report.

### C.3 Computation home (🔒 LOCKED)
- The engine is a server-side function. It runs inside the native branch of `ticket-checkout-create/index.ts`, reading the resolved switches + `venue_tax_address` from the session RPC (extend `biz_ticket_checkout_create_session` to RETURN the resolved switches + venue address + region/currency alongside `totalCents`). **[CONFIRM at IMPLEMENT]** the latest `biz_ticket_checkout_create_session` definition and extend its return shape (it is the natural single price source — investigation §11.1).
- Order of operations (🔒 LOCKED):
  1. `base = totalCents` (sum of tier prices from the RPC).
  2. `mingla_fee = round(base * 0.015)` (existing `MINGLA_APPLICATION_FEE_RATE`, edge fn line 615).
  3. **Mingla-fee gross-up:** if `pass_mingla_fee` → `buyer_subtotal = base + mingla_fee` (buyer pays the fee on top; brand payout unchanged). If absorb → `buyer_subtotal = base` (fee deducted from payout as today).
  4. **Service-fee gross-up:** if `pass_service_fee` → add a flat disclosed service fee to `buyer_subtotal` (the processing-cost recovery; uniform, not card-conditional — §1.2). If absorb → not added. **[DESIGN/PRODUCT INPUT — see §H tension T-2]** the service-fee AMOUNT formula (flat? % of base? processing-cost estimate?) is NOT specified by the vision; default proposal: a flat % constant mirroring typical processing cost (~2.9%+fixed), uniform across cards. Flag to operator at IMPLEMENT if undecided.
  5. **Tax:** call `tax.calculations.create` with `line_items.amount = buyer_subtotal` (so tax is computed on the grossed-up base), `tax_behavior` per region (§B.5), `customer_details.address = venue_tax_address`. For GB inclusive: `amount_total == buyer_subtotal` (VAT extracted inside). For absorb-tax: still call to RECORD tax for filing, but the buyer total does not increase beyond the inclusive amount.
  6. `buyer_total = taxCalculation.amount_total`.
  7. `application_fee_amount = mingla_fee` (Mingla's cut, ALWAYS via `application_fee_amount` regardless of pass/absorb — pass/absorb only changes the buyer-facing gross-up in step 3, not the mechanism by which Mingla collects; doc: https://docs.stripe.com/connect/direct-charges#collect-fees + https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount).
  8. `connected_account_payout = buyer_total − application_fee − tax_set_aside − absorbed_components`. (The connected account is merchant of record under direct charges — https://docs.stripe.com/connect/charges.)

### C.4 PaymentIntent / PaymentSheet contract (🔒 LOCKED, doc-verified)
- `paymentIntents.create({ amount: buyer_total, currency, application_fee_amount, payment_method_types, metadata:{ mingla_tax_calculation_id, … } }, { idempotencyKey, stripeAccount: stripeAccountId })` — UNCHANGED shape from today (edge fn lines 1155-1209); only `amount` now comes from the engine and the tax basis is the venue. Doc: https://docs.stripe.com/api/payment_intents/create + direct-charge `stripeAccount` request option https://docs.stripe.com/connect/direct-charges.
- The native response `kind:"requires_payment"` (edge fn lines 1267-1288) keeps returning `clientSecret`, `paymentIntentId`, `totalCents`(=buyer_total), `subtotalCents`, `taxCents`, `taxBreakdown`, `stripeAccountId`, `customerId`, `customerEphemeralKeySecret`, `publishableKey`, AND NEW `pricingBreakdown` (§C.6) for the receipt.
- **`mode:"preview"` is repurposed, not removed:** it now returns the all-in `totalCents` computed from the venue with NO buyer address required (today it returns `addressMissing:true` when no address — edge fn lines 531-544; that early-return is DELETED). Preview becomes a pure read-the-all-in call the client can make as soon as the cart is non-empty. This is what feeds WYSIWYP on the cart sheet before the PaymentSheet opens.

### C.5 Tax commit + the 3-step flow preserved (🔒 LOCKED, doc-verified)
- **Step 1 calc** — §C.3.5 above.
- **Step 2 bake** — `PI.amount = amount_total` (edge fn line 1156, unchanged).
- **Step 3 commit** — on payment-success webhook, `tax.transactions.createFromCalculation({ calculation: taxCalculationId, reference: orderId }, {stripeAccount})` (proven `stripeWebhookRouter.ts` lines 958-993). Doc: https://docs.stripe.com/api/tax/transactions/create_from_calculation. UNCHANGED — works for both inclusive and exclusive calculations.
- **Refund reversal** — `tax.transactions.createReversal({ original_transaction, mode:"full"|"partial", reference: refundId, … }, { idempotencyKey })` (proven `refund-order/index.ts` lines 393-411). Doc: https://docs.stripe.com/api/tax/transactions/create_reversal. The reversal reads `orders.stripe_tax_transaction_id`; UNCHANGED, but the implementor MUST verify the partial-reversal math still holds when `tax_behavior` is `inclusive` (inclusive tax is a portion of the total, not added on top — the reversible tax component is derived differently). **[CONFIRM at IMPLEMENT]** inclusive-mode partial reversal against the doc URL; add a regression test (T-09).

### C.6 `pricing_breakdown` jsonb shape (🔒 LOCKED — single canonical money record)
```jsonc
{
  "region": "GB",
  "currency": "GBP",
  "tax_behavior": "inclusive",
  "tax_basis": "venue_resolved" | "unresolved_flat_absorb" | "country_unsupported_flat_absorb" | "calc_failed_flat_absorb",
  "switches": { "pass_tax": true, "pass_mingla_fee": false, "pass_service_fee": true },
  "base_cents": 5000,
  "buyer_subtotal_cents": 5145,
  "buyer_total_cents": 5145,
  "components": { "mingla_fee_cents": 75, "service_fee_cents": 145, "tax_cents": 857 },
  "passed":   { "mingla_fee_cents": 0,  "service_fee_cents": 145, "tax_cents": 857 },
  "absorbed": { "mingla_fee_cents": 75, "service_fee_cents": 0,   "tax_cents": 0 },
  "application_fee_amount_cents": 75,
  "connected_account_payout_cents": 4213,
  "stripe_tax_calculation_id": "taxcalc_…"
}
```
(Numbers illustrative.) `passed` + `absorbed` partition each component. `absorbed` is the decision-#6 reporting source. This single object is persisted to session then copied to order at finalize.

### C.7 Installments preserved (🔒 LOCKED)
- The installment deposit PI amount + the scheduled installment math derive from `buyer_total` (the all-in), NOT bare `base` (edge fn installment path lines 968-993, 1158-1195; `normalizeTaxLineItemsForCurrentCharge` lines 162-185). The engine runs once, produces `buyer_total`, and the installment scheduler splits THAT. **[CONFIRM at IMPLEMENT]** `process-scheduled-installments` derives per-installment amounts from the all-in stored total (investigation §7 + §11.5). Regression T-08.

---

## D. BUYER-FACING DISPLAY CONTRACT (WYSIWYP)

Every surface below renders the **all-in `buyer_total`** when costs are passed (and the inclusive VAT price for GB always). When all switches absorb, the displayed number equals the bare tier price (unchanged) — so existing events look identical (decision #4).

### D.1 Shared event-rendering package (🔒 LOCKED — highest leverage) — file:line touches
- `packages/event-rendering/QuantityRow.tsx` — per-tier price label → render all-in per tier.
- `packages/event-rendering/PublicEventPage.tsx` — detail-page price.
- `packages/event-rendering/types.ts` — `priceGbp` field: add an `allInPriceGbp`/`displayPriceCents` field sourced from the engine-computed value exposed in the public view.
- Requires the public view (`business_public_events_view`) to expose the resolved all-in price (§A.2 view migration).

### D.2 Shared brand-rendering package (🔒 LOCKED)
- `packages/brand-rendering/PublicBrandPage.tsx` + `types.ts` — EventMiniCard / TripMiniCard price labels on `/b/{slug}`.

### D.3 Consumer deck / swipe cards (🔒 LOCKED)
- `app-mobile/src/components/SwipeableCards.tsx`, `CuratedExperienceSwipeCard.tsx`, `ExpandedCardModal.tsx`, `activity/SavedTab.tsx`, `activity/CalendarTab.tsx`, `utils/formatters.ts`.

### D.4 Consumer cart (🔒 LOCKED)
- `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` — the sticky `Subtotal` line (lines 316-320) becomes the all-in total; the `taxPreview===null` CTA gate (lines 259, 314) is REWIRED so CTA is enabled as soon as the cart is non-empty (the all-in comes from the repurposed preview call, §C.4).
- `app-mobile/src/components/expandedCard/CartTaxPreview.tsx` — the billing-address form + "Calculate tax" button + the summary that only appeared post-calc → the address form is DELETED; the component either becomes a thin all-in summary or is removed and its summary folded into the cart sheet. 🎨 OPEN-for-designer: whether to keep a slim "What's included" affordance pre-checkout vs a single number only.

### D.5 Checkout = ONE number (decision #3) (🔒 LOCKED)
- The PaymentSheet shows a single all-in total; NO broken-out "Service fee" line at checkout. The native confirm sticky bar shows only `buyer_total`.
- Business native `payment.tsx` (`mingla-business/app/checkout/[eventId]/payment.tsx`): `displayTotalCents` (lines 506-508) = engine all-in; the `taxPreview===null` gate (lines 270, 643) REWIRED identically to consumer.

### D.6 Receipt / confirmation = full breakdown (decision #3) (🔒 LOCKED)
- The receipt / confirmation surface shows the breakdown from `orders.pricing_breakdown` (subtotal, service fee, tax-included note, total). This is the ONLY place the breakdown appears. **[CONFIRM at IMPLEMENT]** the exact receipt/confirmation file(s) — consumer confirm screen + the email render (`_shared/marketingEmailRender.ts` / ticket-confirmation email). 🎨 OPEN-for-designer: breakdown layout + the UK "includes £X VAT" line copy.

### D.7 Marketing emails + server helper (🔒 LOCKED)
- `_shared/marketingEmailRender.ts` event cards → all-in price.
- `_shared/priceTiers.ts` — confirm it is the single server tier-price source; compute/expose all-in once and propagate (investigation §11.3). **[CONFIRM at IMPLEMENT]**.

### D.8 🎨 OPEN-for-designer (visual contract — REQUIRED separate design pass)
All visual/layout details on every surface above are 🎨 OPEN and MUST be produced by the `mingla-designer` skill before IMPLEMENT (this spec owns the functional contract + acceptance bar; designer owns tokens/typography/spacing/states/motion per `references/spec-granularity-protocol.md`). Designer scope is enumerated in §I.

---

## E. BRAND AUTHORING UI

### E.1 Where the switches live (🔒 LOCKED, functional)
- In the event/trip/experience creation + edit flow (`mingla-business/`), a "Pricing" section with the 3 switches (tax / Mingla fee / service fee), each pass|absorb, plus a brand-level "defaults" screen in brand settings. Per-offering switches default to the brand default (NULL=inherit).

### E.2 Brand-level defaults (🔒 LOCKED, functional)
- Brand settings screen writes `brands.default_pass_*`. New offerings inherit; per-offering toggles override.

### E.3 Lock-after-sale disabled state (decision #5) (🔒 LOCKED, functional)
- When `events.pricing_locked_at IS NOT NULL`, the 3 switches render DISABLED with an explanatory line ("Pricing is locked because tickets have sold"). The mutation RPC also rejects (defense in depth). 🎨 OPEN-for-designer: disabled visual + copy.

### E.4 Hide "pass tax" until registered (decision #2) (🔒 LOCKED, functional)
- The "pass tax" switch is HIDDEN (not just disabled) when the brand has zero active Stripe Tax registrations (§C.2 probe). A nudge/CTA to register replaces it. 🎨 OPEN-for-designer: the nudge copy + whether it links to the existing embedded Tax registrations page (`/connect-tax-registrations`, ORCH-0955). The Mingla-fee + service-fee switches are NOT gated by registration.

### E.5 "You absorbed £X" reporting line (decision #6) (🔒 LOCKED, functional)
- On the offering's brand-side detail/analytics, surface `SUM(orders.pricing_breakdown->'absorbed')` per component as a "You absorbed £X in tax/fees" line. 🎨 OPEN-for-designer: placement + breakdown granularity.

### E.6 Switch-mutation RPC (🔒 LOCKED)
- New `SECURITY DEFINER` RPC `business_set_pricing_switches(p_event_id, p_pass_tax, p_pass_mingla_fee, p_pass_service_fee)` — owner-gated, raises `pricing_switches_locked` when `pricing_locked_at IS NOT NULL`, and (if `p_pass_tax=true`) re-validates active registration server-side (don't trust the hidden-switch client gate). Pairs an owner-direct UPDATE predicate (`[[rls-returning-owner-gap]]`).

---

## F. CROSS-SURFACE IMPACT (Phase 2.5)

| # | Surface | Covered? | Behavior / files / parity |
|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | YES | All-in display (§D.1-D.4) + no-address checkout (§C.4). Shared RN code → auto-parity with Android except native-module behavior. SC-1-iOS. |
| 2 | Consumer Android (`app-mobile/`) | YES | Same shared code; PaymentSheet is native — verify Android PaymentSheet shows the single all-in. SC-1-Android (manual parity gate). |
| 3 | Buyer/anon Web (`mingla-business/` hosted Checkout) | NO | Out of scope (vision). Already frictionless via `automatic_tax`. **Known-gap (§F.2).** |
| 4 | Business iOS (`mingla-business/`) | YES | Authoring switches (§E) + business-native checkout all-in (§D.5). SC-2-iOS. |
| 5 | Business Android (`mingla-business/`) | YES | Same; manual parity gate SC-2-Android. |
| 6 | Admin Web (`mingla-admin/`) | NO | Admin doesn't render buyer pricing; no switch authoring. Register follow-up only if admin needs absorbed-revenue reporting. |
| 7 | Business Web preview | PARTIAL | Authoring switch UI renders in the business web build; the web BUYER path stays hosted-Checkout (out of scope). |

### F.2 KNOWN GAP — native↔web tax-basis divergence (🔒 documented, NOT fixed here)
🔴 The web buyer path uses Stripe Checkout `automatic_tax` (buyer-destination tax, address collected on the hosted page — edge fn line 796). Native now uses VENUE-based tax. The SAME event can therefore show a different total on web vs native. The vision says leave web as-is. This spec documents the divergence as a known gap requiring a later sub-ORCH (either migrate web to venue-based via a server-precomputed price, or accept the divergence with a product decision). The implementor MUST add a code comment at both the web `automatic_tax` block and the native engine pointing to this gap, and the orchestrator should register the follow-up. **A COMMS-NNNN entry should be written** flagging this to `meta-orch-0980` + any in-flight web checkout work (see §J handoff).

---

## G. SUCCESS CRITERIA, INVARIANTS, TEST CASES, CI

### G.1 Success criteria (observable, testable, per-surface where manual)
- **SC-1** (iOS + Android): A consumer opening a paid event whose brand passes fees sees the SAME all-in number on the card, the detail page, the cart sticky bar, and the PaymentSheet — with NO address entry and NO "Calculate tax" tap. (SC-1-iOS, SC-1-Android.)
- **SC-2** (Business iOS + Android): A brand can set the 3 switches at creation; after first sale they are disabled; the "pass tax" switch is hidden when the brand has no active registration. (SC-2-iOS, SC-2-Android.)
- **SC-3**: For a GB brand, the tax calculation uses `tax_behavior:"inclusive"` and the buyer total equals the VAT-inclusive price; the receipt shows an "includes £X VAT" line; the checkout shows NO separate tax line.
- **SC-4**: An event whose venue address is unresolvable still produces ONE clean all-in number (flat brand-absorbed), never a £0-tax friction screen and never a checkout error (decision #1 + §B.4).
- **SC-5**: Existing (pre-migration) events show an UNCHANGED buyer price (all-absorb default, decision #4).
- **SC-6**: When a brand absorbs tax/fees, the brand-side reporting shows a "you absorbed £X" line equal to `SUM(absorbed)` (decision #6).
- **SC-7**: Mingla's cut is collected via `application_fee_amount` in both pass and absorb modes; brand payout is grossed-up-neutral when passed and reduced-by-fee when absorbed (§C.3).
- **SC-8**: Installment deposit + scheduled installments derive from the all-in total.
- **SC-9**: Refund reversal works for inclusive-mode tax (full + partial).

### G.2 Invariants preserved
- I-stripe-direct-charges-only (no `transfer_data.destination`) — the engine keeps the direct-charge shape.
- I-stripe-pm-method-allowlist + no `automatic_payment_methods` — PI body unchanged on methods.
- ORCH-0804 web `automatic_tax.enabled:true` — web path untouched.
- Buyer-protection lock predicate (ORCH-0877) — reused for pricing lock (§A.5, Constitution #13).
- Currency-aware (Constitution #10) — see new invariant.

### G.3 NEW invariants (🔒 LOCKED)
- **I-PROPOSED-ALLIN-VENUE-TAX-BASIS** — native `tax.calculations.create.customer_details.address` MUST be sourced from `events.venue_tax_address`, never from a buyer-supplied address; the buyer-address parse/validate helpers MUST NOT exist in the native create path. Strict-grep: ban `parseBuyerAddress`/`buyer.address` in the native branch.
- **I-PROPOSED-ALLIN-REGION-TAX-BEHAVIOR** — `tax_behavior` MUST be derived from `brands.pricing_region` (GB→inclusive), never a hardcoded literal at the call site. Strict-grep: ban a hardcoded `tax_behavior:"exclusive"` literal in `ticket-checkout-create`.
- **I-PROPOSED-ALLIN-CURRENCY-AWARE** — all displayed prices use the offering's `pricing_currency`/locale formatter; no hardcoded `£`/`$` outside the formatter (Constitution #10).
- **I-PROPOSED-PRICING-LOCKED-AFTER-SALE** — `business_set_pricing_switches` MUST reject when `pricing_locked_at IS NOT NULL`.

### G.4 Test cases (implementor writes happy-path; tester writes adversarial — Step 0.5, different angles)
| Test | Scenario | Input | Expected | Layer | Angle |
|---|---|---|---|---|---|
| T-01 | GB pass-all happy path | event GB, pass tax+fee+service, venue resolved, registered | one all-in = inclusive total; PI.amount = amount_total; no address; receipt breakdown present | Full stack | happy (impl) |
| T-02 | Unresolvable venue | `venue_tax_address` NULL, geocode fails | flat-absorb; one clean number; `tax_basis="unresolved_flat_absorb"`; NO error | Engine+DB | adversarial (test) |
| T-03 | Unregistered brand passes tax | `tax.registrations.list`=[] but `pass_tax=true` submitted to RPC | RPC forces absorb / rejects pass; switch was hidden client-side | Edge+RPC | adversarial |
| T-04 | Existing event unchanged | pre-migration row, all NULL switches | buyer price == bare tier price | Migration+display | happy |
| T-05 | Lock after sale | event with ≥1 order, attempt switch flip | `pricing_switches_locked` | RPC | adversarial |
| T-06 | tax_behavior region | GB brand | calc uses `inclusive`; US-stub (CHECK-blocked) cannot be set | Edge | happy |
| T-07 | Absorbed reporting | brand absorbs tax+fee, 3 orders | reporting sums match `pricing_breakdown.absorbed` | DB+UI | happy |
| T-08 | Installments all-in | installment plan, pass fees | deposit + schedule derive from buyer_total | Edge+cron | adversarial |
| T-09 | Inclusive refund reversal | full + partial refund on inclusive order | tax reversal math correct for inclusive | Edge | adversarial |
| T-10 | Tax-calc throws | force `tax.calculations.create` error | degrade to flat-absorb, NOT session `failed` | Edge | adversarial |
| T-11 | Android PaymentSheet parity | Android native checkout | single all-in, no address | Component | parity (test) |
| T-12 | Web path untouched | web buyer checkout | still hosted Checkout + `automatic_tax`; no regression | Edge | regression |

### G.5 Regression prevention
- Replace/repoint the locked test `orch_0955_native_stripe_tax.test.ts` (asserts `exclusive` + buyer-address — investigation §7). It MUST be re-specced under `[TEST-MOD-APPROVED ORCH-1006]` to assert `inclusive` + venue-address basis. Do NOT weaken; rewrite to the new contract.
- The new strict-grep invariants (§G.3) are the structural safeguards.

### G.6 CI / strict-grep (COMMS-0002) (🔒 LOCKED)
- Any NEW `supabase/functions/` file or migration introduced by this ORCH REQUIRES an `ORCH_1006_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (C7 `no-new-backend-files`) **in the same commit**, or CI fails. This spec edits the existing `ticket-checkout-create` (not new) but ADDS migrations (new files under `supabase/migrations/`) — the allowlist entry is mandatory.
- New strict-grep gate file(s) for §G.3 invariants also need the allowlist entry + a workflow job (mirror ORCH-0963 precedent).

### G.7 Experiences coordination with meta-orch-0980 (🔒 LOCKED)
- Experiences are `events` rows (`event_type='experience'`) not yet routed through paid checkout (investigation §2). When `meta-orch-0980` wires paid experiences through `ticket-checkout-create`, they inherit this engine for free (same `eventId`, same RPC, same PI path) PROVIDED meta-0980 does not introduce a parallel checkout. **Coordination contract:** a COMMS-NNNN entry to `meta-orch-0980` stating the 3-switch + WYSIWYP + venue-tax model is the DEFAULT for experience checkout from day one, and that experiences MUST route through `ticket-checkout-create` (not a new edge function). See §J.

---

## H. TENSIONS / INFEASIBILITY FLAGS (do not paper over)

- **T-1 (UK pass-vs-absorb tax is buyer-identical).** Under inclusive UK VAT the buyer pays the same number whether tax is "passed" or "absorbed" — the switch only changes brand-side accounting and what the brand remits. This is in mild tension with the mental model of "pass = buyer pays more" (which only holds for US exclusive tax). NOT infeasible — but the authoring copy + the "you absorbed £X" line must be UK-accurate (for UK, "absorbed tax" means the brand's notional pre-VAT margin shrinks, not that the buyer pays less). Designer + product must word this so it isn't confusing. Flagged for operator.
- **T-2 (service-fee amount is unspecified).** The vision names the service fee as the processing-cost-recovery framing but does NOT give a formula (flat? %? card-cost-passthrough?). §C.3.4 proposes a uniform flat % constant; the operator must confirm the exact amount/formula before IMPLEMENT. Picking a card-cost-passthrough that varies by card type would re-classify it as a regulated surcharge (§1.2) — so the amount MUST be uniform.
- **T-3 (native↔web divergence).** §F.2 — the same event can show different totals on web (buyer-destination tax) vs native (venue tax). Operator-accepted as a known gap this ORCH; needs a follow-up sub-ORCH decision.
- **T-4 (registration probe latency/cost).** `tax.registrations.list` per authoring-load adds a Stripe round-trip; cache the brand's registration status (short TTL) rather than calling on every keystroke. Not infeasible; an implementation-quality note.

---

## I. 🎨 DESIGNER HANDOFF (mingla-designer — REQUIRED before IMPLEMENT for UI surfaces)

The following are 🎨 OPEN and owned by the designer pass (tokens, typography, spacing, all 9 states, motion, copy, light+dark, contrast, no-AI-slop, "references examined"):
1. The 3-switch Pricing section in event/trip/experience authoring (toggle visual, pass|absorb affordance, inherit-from-brand indicator).
2. The brand-level pricing-defaults screen.
3. The locked-after-sale disabled state + copy.
4. The hidden-pass-tax nudge ("register to pass VAT") + link to `/connect-tax-registrations`.
5. The "you absorbed £X" reporting line placement + breakdown.
6. The consumer cart sheet after the address form is removed — single all-in number vs a slim "what's included" affordance.
7. The receipt/confirmation breakdown layout + the UK "includes £X VAT" line copy.
8. WYSIWYP price treatment on cards/detail/deck (no visual change to the number's prominence; ensure the all-in reads as THE price).

Functional contract + acceptance bar (this spec) is LOCKED; visuals are the designer's, within it.

---

## J. NEXT ROUTING

After designer pass → `mingla-implementor` (IMPLEMENT). The implementor MUST: resolve every `[CONFIRM at IMPLEMENT]` tag, write the migration with a collision-checked timestamp, add the COMMS-0002 backend allowlist entries, write happy-path tests (tester writes adversarial), and write the two COMMS entries (web-divergence + meta-0980 coordination) per §F.2 + §G.7.
