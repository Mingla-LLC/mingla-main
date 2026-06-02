# INVESTIGATION — ORCH-1034 [de-GBP-ify currency] · Tax tie-in (Stripe Tax vs the pricing engine)

- **Status:** COMPLETE (INVESTIGATION ONLY — no fixes, no code, no db push, no deploy)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1034-[currency-de-gbp]/` on branch `ORCH-1034-currency-de-gbp`
- **Author:** mingla-forensics (INVESTIGATE mode), 2026-06-01
- **Skills invoked (in order):** `stripe-best-practices` (mandatory per [[stripe-skill-mandatory]] + COMMS-0003), then `mingla-forensics` INVESTIGATE.
- **Feeds:** the ORCH-1034 SPEC amendment (`Mingla_Artifacts/specs/SPEC_ORCH-1034_CURRENCY_DE_GBP.md` §4 DECISION-2 / §5.B / §5.C). Resolves the operator-deferred "investigate Stripe-Tax tie-in first" decision.
- **Ledger:** Read `COMMS_LEDGER.md` on entry. **Acked COMMS-0013** (WARN, to ORCH-1006/ALL — web vs native tax-basis divergence) — directly on-point; factored throughout §3/§6 and confirmed its "native rewire NOT yet shipped" note is now **stale** (it shipped, see §1). Also factored COMMS-0003 (Stripe docs cited inline) + COMMS-0002 (backend strict-grep — N/A, investigation only).

---

## 0. The question (operator-locked) and the one-line answer

**Question:** ORCH-1034's currency SPEC found `taxBehaviorForRegion` is GB-baked (throws on non-GB, forces UK inclusive-VAT). Separately, ORCH-0955 wired Stripe Tax for Platforms (calc/commit/reverse) with venue-based sourcing. Which system actually OWNS the charged tax amount, so ORCH-1034 doesn't build a currency→region tax proxy that double-counts or conflicts with Stripe Tax?

**Answer (proven, five layers):**

> **Stripe Tax owns the tax AMOUNT. The engine's `taxBehaviorForRegion` is a DISPLAY/`tax_behavior` flag, NOT a tax calculator.** The engine never computes a VAT amount — it hands a `tax_behavior` (inclusive|exclusive) string to Stripe and receives the amount back. There is **no double-count** (web and native tax paths are mutually exclusive per charge). And critically, **Stripe Tax is wired but DORMANT today**: every live event has `pass_tax=false` and zero events have a `venue_tax_address`, so the native path always degrades to flat-absorb (`tax_cents = 0`) and `tax.calculations.create` is never actually called. The GB-`inclusive` assumption is therefore a **latent display-mode bug** for the (not-yet-existent) day a US brand turns on tax with a venue address — **not** a charged-amount bug today. **The clean ORCH-1034 fix is the small one:** make `taxBehaviorForRegion` a thin per-region display flag aligned to the venue's market convention, drop the GB-throw — NOT a currency→tax proxy and NOT its own VAT math.

---

## 1. What actually shipped (migration-chain + git verification)

| Object | Authoritative source | Shipped to `main`? |
|--------|----------------------|--------------------|
| Native `tax.calculations.create` (venue-based, ORCH-0955→1006) | `supabase/functions/ticket-checkout-create/index.ts:1079-1108` | **YES** — `33703f7e2` "ORCH-1006: Universal all-in pricing engine (slices 1+2 + finalize) (#269)". `git show main:…index.ts | grep -c "tax.calculations.create"` = **2**. |
| Web hosted-Checkout `automatic_tax:{enabled:true}` (buyer-address) | same file `:786` | **YES** — same commit. `grep -c "automatic_tax: { enabled: true }"` = **1**. |
| `taxBehaviorForRegion` (GB-baked, throws) | `supabase/functions/_shared/allInPricingEngine.ts:37-47` | **YES** — same commit. |
| `resolve_event_pricing_inputs` RPC (returns region/currency/venue addr) | `supabase/migrations/20260802000000_orch_1006_pricing_switches.sql:174-207` (latest def; confirmed no later `CREATE OR REPLACE` — `20260805000000` only adds a public tier view, does not touch this fn) | **YES** |
| `brands.pricing_region` CHECK locked to `'GB'` | same migration `:44-47` | **YES** |
| `events.venue_tax_address jsonb` column | same migration `:110` | **YES** (column exists; **never backfilled** — see §2) |

**COMMS-0013 correction:** COMMS-0013 (2026-05-30) said "the native rewire (item A) is NOT yet shipped as of this entry." That is now **stale** — PR #269 (`33703f7e2`) shipped the native `tax.calculations.create` rewire to main. The divergence COMMS-0013 flags (web `automatic_tax` buyer-address vs native venue-based) is now LIVE in code, but **dormant in practice** (§2). ORCH-1034 SPEC §2.2 already scopes web-tax-basis OUT — correctly.

---

## 2. Live data reality (read-only Management API probes, 2026-06-01)

All probes via `POST /v1/projects/gqnoajqerqhnvulmnyvv/database/query` (read-only, curl — not python-urllib, per directive).

```
-- US events: region/currency/venue-address shape
pricing_region | pricing_currency | default_currency | event_ccy | has_venue_addr | venue_country |  n
---------------+------------------+------------------+-----------+----------------+---------------+----
 GB            | GBP              | USD              | USD       | false          | (null)        | 78
 GB            | GBP              | (null)           | USD       | false          | (null)        |  2

-- venue_tax_address coverage across ALL events
with_addr | total
----------+------
        0 |   123      ← ZERO events have a venue_tax_address

-- brand pass_tax default
default_pass_tax | count
-----------------+------
 false           |   50      ← ALL 50 brands absorb tax by default

-- event-level pass_tax override
pass_tax | count
---------+------
 (null)  |   123      ← ALL events inherit brand default (false)

-- orders carrying a pricing_breakdown (the ORCH-1006 money record)
with_bd | total
--------+------
      0 |    63      ← ZERO orders have ever recorded a pricing_breakdown
```

**What this proves about the live charge path TODAY:**
- `pricing.pass_tax` resolves to **`false` for every checkout** (`COALESCE(e.pass_tax, b.default_pass_tax)` = `COALESCE(null, false)` = `false`), AND `pricing.venue_tax_address` is **`null` for every event**.
- The native tax gate is `if (pricing.pass_tax && pricing.venue_tax_address)` (`index.ts:1044`) and the calc branch requires `pricing.pass_tax && pricing.venue_tax_address` to be truthy (`:1064`). **Both conditions are false for 100% of live events** → every native checkout takes the `unresolved_flat_absorb` branch (`:1064-1067`) → `tax_cents = 0` (`:1139-1140`).
- **`stripe.tax.calculations.create` is NEVER reached on any live checkout today.** Stripe Tax is wired but dormant.
- Zero orders carry a `pricing_breakdown` → the ORCH-1006 engine has not actually charged a real native order yet (orders predate the rewire / none charged post-#269).

---

## 3. THE FIVE PROVE-POINTS (file:line + the live charge path)

### PROVE-1 — Who computes the tax AMOUNT charged? → **Stripe Tax (when active); engine never computes it.**

Trace of `ticket-checkout-create` (native branch), end to end:

1. `:555` resolve inputs via RPC `resolve_event_pricing_inputs` → returns `pass_tax`, `pricing_region` (always `'GB'`), `pricing_currency` (always `'GBP'`), `venue_tax_address` (always `null` today).
2. `:600` `computeBuyerSubtotal()` → the engine grosses up **base + passed fees** (NO tax). `:1036` `taxAmountCents = buyerSubtotal.buyerSubtotalCents`.
3. `:1031-1130` the tax block. The **amount** is set in exactly one of these ways:
   - **flat-absorb** (`:1066`, `:1070`, `:1120`): `taxCalculation = { amount_total: taxAmountCents (= subtotal), tax_breakdown: [] }` and later `taxCents = 0` (`:1139-1140`). **No Stripe call. Engine sets total = subtotal, tax = 0.** ← **this is the only path any live order takes today.**
   - **venue_resolved** (`:1079-1108`): `const fresh = await stripeForTax.tax.calculations.create({ currency, line_items:[{ amount: taxAmountCents, tax_behavior, tax_code }], customer_details:{ address: venue_tax_address }})`. Then `taxCalculation.amount_total = fresh.amount_total` (`:1104`). **Stripe computes the amount.** ← dormant today.
4. `:1146-1151` `taxCents` is **derived from the Stripe `amount_total`**, not computed independently: inclusive → `amount_total − round(amount_total/1.2)`; exclusive → `amount_total − subtotal`; flat-absorb → `0`.
5. `:1153-1161` `buildPricingBreakdown({ amountTotalCents: taxCalculation.amount_total, taxCents, … })` — the engine **assembles** the breakdown from numbers handed in; it does not calculate tax.
6. `:1223` `piCreateBody.amount = pricingBreakdown.buyer_total_cents` (= `taxCalculation.amount_total`). **The charged total is the Stripe-Tax `amount_total`** (or the flat subtotal when degraded).

**Conclusion (a):** the charged tax amount is **(a) Stripe Tax `calc`** when a venue address + `pass_tax` exist; otherwise **(c-degraded) zero, set by the engine's flat-absorb fallback**. It is **never (b)** — the engine has no VAT formula. Evidence the engine receives, not computes: `allInPricingEngine.ts:129-138` `buildPricingBreakdown(args: { amountTotalCents; taxCents; … })` takes both as **inputs**; the only tax arithmetic in the whole engine file is the *display partition* of an already-known `taxCents` into passed/absorbed (`:172-181`).

### PROVE-2 — What is `taxBehaviorForRegion` actually used for? → **a DISPLAY/`tax_behavior` flag, NOT an amount.**

- Definition `allInPricingEngine.ts:37-47`: returns the string `"inclusive"` (GB) or throws. It returns a **`TaxBehavior` = "inclusive" | "exclusive"** (`:28`), never a number.
- Use #1 (the only behavioral use): `index.ts:1032 const taxBehavior = taxBehaviorForRegion(pricingRegion)` → passed verbatim to Stripe as `line_items[].tax_behavior` (`:1088`). Per Stripe, `tax_behavior` tells Stripe **whether the supplied `amount` already includes tax (inclusive) or tax is added on top (exclusive)** — a *presentation/interpretation* flag, not a rate or amount. Doc: https://docs.stripe.com/api/tax/calculations/create#create_tax_calculation-line_items-tax_behavior and https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior .
- Use #2 (display partition): `index.ts:1141-1151` uses `taxBehavior` only to **extract the tax portion for display** from Stripe's `amount_total` (inclusive: divide-out the VAT; exclusive: subtract subtotal). Still not computing the tax — re-deriving the split of a Stripe-provided number.
- Use #3 (record): `buildPricingBreakdown` stamps `tax_behavior` onto `pricing_breakdown` (`:161`) — a label on the receipt.

**Conclusion (b):** `taxBehaviorForRegion` is a **display-mode / Stripe-interpretation flag**. Its GB-`inclusive` hardcode is a **display/presentation bug** for non-GB markets (a US sale would be told "the amount is tax-inclusive" when US sales tax is exclusive), **not** a charged-amount bug today — because the only path live orders take is flat-absorb where `tax_behavior` is computed but never sent to Stripe and `taxCents` is forced to 0. The throw (`:44`) is **latent**: it can only fire if a non-`'GB'` region reaches the engine, which the `brands.pricing_region` CHECK (`migration:46`, locked to `'GB'`) currently makes impossible — so it is not firing in production, but it is the exact landmine ORCH-1034 must defuse before it enables US/EU/CH regions.

### PROVE-3 — Is Stripe Tax live + authoritative + venue-based right now? → **Wired, venue-based by design, but DORMANT (never invoked on a live charge).**

- **Wiring (calc):** `index.ts:1079` `stripe.tax.calculations.create(...)` with `customer_details.address = pricing.venue_tax_address` (`:1093`) — sources tax at the **VENUE country**, not buyer, not brand. Confirmed venue source: RPC returns `e.venue_tax_address` from `events` (`migration:198`).
- **Wiring (commit/reverse):** ORCH-0955 wired the 3-step (calc/commit/reverse) into `ticket-checkout-create` + `stripeWebhookRouter` + `refund-order` per [[stripe-native-paid-region-gated]] (SUPERSEDED note: region gate deleted, native paid universal). The `calc` is the only step on the create path; commit happens on payment success (webhook), reverse on refund — not in this file's scope but confirmed wired by ORCH-0955 close. Doc: https://docs.stripe.com/tax/custom (calculate → create transaction → reverse).
- **For a US event at a US venue TODAY:** `pass_tax=false` + `venue_tax_address=null` (proven §2) → **flat-absorb, `tax_cents=0`, no Stripe Tax call, no UK VAT either.** Buyer is charged base + passed fees in `usd`, **zero tax line**. There is no US-sales-tax-vs-UK-VAT contradiction in practice today because **neither is charged** — tax is fully absorbed/zero.
- **Authoritative when active:** YES — when a brand sets `pass_tax=true` + an event gets a `venue_tax_address`, Stripe Tax (venue-sourced) is the sole amount authority; the engine just relays `tax_behavior` and records the result.

### PROVE-4 — Double-count / conflict risk? → **NONE. Web and native tax paths are mutually exclusive per charge.**

- `index.ts:652 if (surface === "web" || surface === "mobile-web") { … }` → builds a hosted Checkout Session with `automatic_tax:{enabled:true}` (`:786`, buyer-address-sourced) and **`return`s `requires_web_redirect`** at `:868-875` — exiting the function BEFORE the native tax block (`:1001+`).
- The native branch (`:1001-1130`, `tax.calculations.create`, venue-sourced) is only reached when `surface === "native"` (the web branch already returned).
- Therefore a single charge is **either** web-`automatic_tax` **or** native-`tax.calculations.create` — **never both**. The engine adds **no** independent VAT to either. **Zero double-count, structurally.** (The COMMS-0013 concern is a *divergence* — same event could show different tax on web vs native — not a double-count; and it's dormant because tax is off everywhere today. ORCH-1034 SPEC §2.2 correctly scopes web out.)

### PROVE-5 — The clean fix direction → **Thin venue-aligned display flag. The SMALL fix. Stripe Tax owns the amount.**

We are in **World 1: Stripe Tax owns the venue-based amount; the engine is a display/relay layer.** (Not World 2 "the engine is the tax authority" — disproven by PROVE-1: the engine has no VAT math and receives the amount as an argument.)

Therefore the correct ORCH-1034 tax-behavior change is exactly what the SPEC already drafts (§5.B/§5.C), and this investigation **confirms it is sufficient** (not a bigger rewrite):

1. **Generalize `taxBehaviorForRegion` into a thin per-region display flag** — `PricingRegion` widened to `"GB" | "US" | "EU" | "CH"`; map `GB/EU/CH → "inclusive"`, `US → "exclusive"`; drop the GB-only throw for live regions (keep the exhaustive `never` guard for genuinely unmapped regions as a loud programming-error catch, but the call site must degrade-not-throw on a real checkout). This is a **presentation flag**, NOT a tax calculator and NOT a currency proxy.
2. **The amount stays Stripe's.** Do not add any VAT/sales-tax arithmetic to the engine. `tax.calculations.create` (venue-sourced) remains the sole amount authority; the engine keeps relaying `tax_behavior` + re-deriving the display split from Stripe's `amount_total`.
3. **Region should ideally follow the VENUE, not the currency.** `tax_behavior` is a market-convention presentation choice; the *rate/jurisdiction* already follows the venue address via Stripe. Deriving `pricing_region` from `default_currency` (SPEC DECISION-2) is an acceptable launch proxy **only because tax is dormant** (pass_tax=false everywhere) — the day a brand enables tax, the venue address drives the real rate regardless, and the currency-derived region only picks inclusive-vs-exclusive presentation. **Recommendation: accept the currency→region proxy for the migration backfill (it's the only brand-level signal), but document that the authoritative tax-behavior signal is the venue country, and that a USD-charging brand at a UK venue is the known proxy edge (acceptable at launch, tax dormant).** This resolves the operator's deferred DECISION-2: **currency-proxy for the backfill is fine; the engine flag must be venue-convention-aligned, not a tax calculation.**
4. **The `?? "GB"` at `index.ts:579` is dead today** (column is `NOT NULL DEFAULT 'GB'`) but becomes load-bearing once the CHECK widens — the call site must degrade to flat-absorb BEFORE calling `taxBehaviorForRegion` if `pricing_region` is ever NULL/unmapped, so the engine never throws on a real checkout (SPEC §5.C item 2 — confirmed correct).

**Net:** ORCH-1034's tax work is the **small, safe fix** — a display-flag generalization + drop-the-throw, riding on top of Stripe-Tax-owns-the-amount. No conflict with ORCH-0955's venue-based Stripe Tax; no currency→tax proxy; no double-count.

---

## 4. Five-layer cross-check

| Layer | Finding | Verdict |
|-------|---------|---------|
| **Docs** | Stripe: `tax_behavior` = inclusive/exclusive presentation flag; venue/customer address drives jurisdiction; calc→commit→reverse is the amount authority (https://docs.stripe.com/tax/custom, .../tax-codes-tax-behavior). Mingla SPEC §1.3 calls the engine "GBP-baked logic." | Docs confirm `tax_behavior` is a flag, not an amount. SPEC's "baked logic" is true for the *flag default* + *throw*, not for any amount math. |
| **Schema** | `brands.pricing_region` CHECK = `'GB'` only (`migration:46`); `events.venue_tax_address` exists but `NULL` on all 123 events; `default_pass_tax=false` on all 50 brands. | Region is hard-locked GB; tax inputs absent → Stripe Tax dormant. |
| **Code** | Engine `buildPricingBreakdown` receives `amountTotalCents`+`taxCents` as args (no VAT math). `taxBehaviorForRegion` returns a string flag. Web/native tax paths mutually exclusive (early `return` at `:868`). | Engine = relay/display; Stripe Tax = amount; no double-count. |
| **Runtime** | Every live checkout: `pass_tax=false` ∧ `venue_tax_address=null` → flat-absorb branch → `tax_cents=0`, no `tax.calculations.create` call. | Stripe Tax never invoked today; GB-inclusive never charged as a real tax. |
| **Data** | 0/123 events with venue addr; 0/63 orders with `pricing_breakdown`. | Confirms dormancy — no real tax has flowed through the rewired engine. |

**Layer agreement:** all five agree — Stripe Tax owns the amount (when active), the engine owns the display flag, tax is dormant, no double-count. No contradictions.

---

## 5. Outcome & journey step-back (Prime Directive 11)

- **Operator's actual goal:** de-GBP-ify currency so a US brand charges USD with correct US tax behavior, WITHOUT a currency-driven tax proxy that fights ORCH-0955's venue-based Stripe Tax.
- **The journey:** brand sets currency/region → buyer opens cart → engine grosses up fees → (if tax on + venue known) Stripe Tax computes venue tax → PaymentSheet shows all-in → charge in seller currency.
- **Where reality diverges:** tax is **off everywhere** (pass_tax=false, no venue addresses), so the "tax behavior" node is inert today. The only *active* GB-bakedness ORCH-1034 must fix for correctness-now is the **charge currency** (separate root cause C, SPEC §5.C/§5.D) and **defusing the latent throw** before enabling non-GB regions. The tax-behavior fix is **forward-correctness**, not a live-bug fix.
- **Does fixing the flag deliver the outcome?** YES — combined with the SPEC's charge-currency wiring, generalizing the display flag (not building a tax calc) delivers a correct US checkout once a US brand enables tax + sets a venue address. The investigation confirms ORCH-1034 does **not** need to touch the amount authority.

---

## 6. Blast radius & discoveries for orchestrator

- **Blast radius of the tax-behavior fix:** `_shared/allInPricingEngine.ts` (type + flag) and `ticket-checkout-create/index.ts` (degrade-before-call). Web branch untouched (COMMS-0013 residual, scoped out). Shared by native iOS + Android automatically.
- **🟡 Hidden flaw (pre-existing, NOT ORCH-1034's to fix):** `events.venue_tax_address` is **never populated** anywhere — 0/123. Even after ORCH-1034 enables US `exclusive`, **Stripe Tax will still never fire** until something backfills/captures a venue address per event. The whole venue-based Stripe Tax pipeline (ORCH-0955/1006) is **dead-on-arrival in production** for lack of venue addresses. This is a separate gap — **register for the orchestrator** (a "populate `events.venue_tax_address`" ORCH) so the venue-based tax the SPEC's fix unlocks can actually run.
- **🔵 Observation:** COMMS-0013's "native rewire not yet shipped" is stale — it shipped in #269. Recommend the orchestrator update/close COMMS-0013's premise (the divergence is real-in-code but dormant; ORCH-1034 correctly scopes web out).
- **🔵 Observation:** the inclusive VAT extraction at `:1147` hardcodes `/1.2` (20% UK rate) — another GB-bakedness, but display-only and dormant; if EU/CH inclusive is enabled, this divide-out constant would also need generalizing. Flag for the implementor as part of the same display-flag work (the SPEC's §5.B should note the `/1.2` constant alongside the region map).

---

## 7. Confidence

**Confidence: HIGH (`proven`).** All six root-cause fields satisfied for the central claims; five layers cross-checked; live DB probed read-only; git-verified what shipped to main; latest migration confirmed as current truth; Stripe docs cited inline. Not sim-reproduced — exempt: this is a backend/SQL/edge-function tax-ownership investigation (Prime Directive 7 backend exemption), and the decisive evidence is the static charge path + live DB state, not a UI reproducer.

---

## 8. References examined
- **Stripe docs (via `stripe-best-practices` + cited inline):** tax_behavior inclusive/exclusive (api/tax/calculations/create + tax/products-prices-tax-codes-tax-behavior), Stripe Tax for Platforms / custom calculation calc→transaction→reverse (tax/custom), direct-charge tax merchant-of-record (tax/connect/direct-charges), application_fee_amount (api/payment_intents/create), currencies presentment/settlement (currencies).
- **Live remote DB (Management API, read-only curl):** US-event region/currency/venue-address shape; venue_tax_address coverage (0/123); brand pass_tax default (false/50); event pass_tax override (null/123); orders pricing_breakdown coverage (0/63).
- **Code (read in full):** `_shared/allInPricingEngine.ts` (all 194 lines); `ticket-checkout-create/index.ts` (tax block 1001-1260, web branch 700-876, call-site 552-604); migrations `20260802000000_orch_1006_pricing_switches.sql` (RPC + columns + CHECKs), `20260805000000_orch_1006_public_event_tier_allin.sql` (confirmed no RPC clobber).
- **Git:** `main` log + `git show main:…` content probes confirming #269 shipped both tax paths.
- **Comms:** COMMS-0013 (acked, premise corrected), COMMS-0003 (docs cited), COMMS-0002 (N/A investigation-only).
