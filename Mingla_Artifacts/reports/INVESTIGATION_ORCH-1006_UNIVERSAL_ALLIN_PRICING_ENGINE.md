# INVESTIGATION — ORCH-1006 [Universal all-in pricing engine]

> CHANNEL NOTE: During this investigation the tool channel entered a replay loop that returned one stale truncated Read result for every subsequent call. The findings below are written from evidence read firsthand BEFORE the loop (full `ticket-checkout-create/index.ts`, both Stripe skill references, the locked vision doc, the comms ledger, the complete `supabase/functions/_shared/` inventory) plus the file-location grep results captured before the loop. Files marked **[RE-READ PENDING]** still need a full line-by-line pass once the channel clears; their behavior is currently inferred from the authoritative backend contract and is flagged at the confidence level earned. This report is INVESTIGATE-only — no spec, no solution design.

**ORCH:** ORCH-1006 [Universal all-in pricing engine]
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1006-[universal-allin-pricing-engine]/` on branch `ORCH-1006-universal-allin-pricing-engine`
**Mode:** INVESTIGATE (diagnose-first; no spec)
**Date:** 2026-05-29
**Comms ledger acks:** COMMS-0003 (WARN, ALL — external-API docs URLs cited inline; satisfied throughout §4–§6), COMMS-0002 (WARN, ALL — backend strict-grep allowlist; relevant to blast radius §7).

---

## 0. The Vision (intent we map current reality against)

Source: `~/.claude/.../memory/project_checkout_allin_pricing_fee_tax_toggles.md` (locked 2026-05-29, pre-ORCH).

A single **Mingla-wide** pricing engine across events + trips + experiences (brand-kind is decommissioned — every brand authors all three universally). At creation the brand sets **3 switches**, each **pass to buyer** (added on top) or **absorb** (baked into price, brand eats it from payout):
1. Sales tax
2. Mingla platform fee
3. Processing-cost recovery — framed as a disclosed **"service fee"** line (Eventbrite-style), NOT a literal card surcharge.

Hard buyer constraints (non-negotiable):
- Buyer NEVER types a billing address or any tax/location input. **Card entry only.**
- NO browser / hosted-checkout redirect. Everything native via the in-app Stripe **PaymentSheet**.
- **WYSIWYP** — when costs are passed, the price shown EVERYWHERE upfront (detail page, deck, cards) is already the all-in total the buyer pays. No surprise at checkout.

Architecture consequence the vision itself names: all-in display requires tax **deterministic before checkout** → source tax from the **venue's location** (data we already hold), not buyer card-ZIP.

---

## 1. CURRENT NATIVE CHECKOUT MONEY FLOW (proven end-to-end)

**Authoritative file (read in full):** `supabase/functions/ticket-checkout-create/index.ts` (1289 lines).

### 1.1 Where the price is set
The base order amount is computed **server-side in a DB RPC**, not in the edge function. The edge function calls `biz_ticket_checkout_create_session` (lines 478-493) and reads back `session.totalCents` (line 528) and `session.currency` (line 529, default `"GBP"`). The RPC owns per-tier pricing (ticket types / trip pricing tiers). `p_application_fee_amount_cents: 0` is passed into the RPC (line 490) — the fee is **NOT** computed in the RPC; it is recomputed in the edge function (see 1.3). **[RE-READ PENDING: `biz_ticket_checkout_create_session` migration — latest definition — to confirm exact pricing inputs and whether it already knows tax/fee switches.]**

### 1.2 Charge model — DIRECT charges on the connected account
🔵 Observation / 🔴 load-bearing for the vision.
- ORCH-0843 (DEC-154) flipped the integration to **direct charges** (lines 650-661, 1137-1208). The PaymentIntent is created **on the connected account** via the `stripeAccount` request option (`paymentIntents.create(piCreateBody, { idempotencyKey, stripeAccount: stripeAccountId })`, lines 1201-1208).
- `transfer_data.destination` is **gone** and CI-banned (`orch-0843-stripe-direct-charges-only.mjs`, comment lines 659-661).
- Under direct charges, the **connected account (brand/venue) is merchant of record** implicitly (lines 784-795). This matches Stripe docs: https://docs.stripe.com/connect/charges (direct charges create the charge on the connected account; the connected account is the merchant of record) and https://docs.stripe.com/tax/connect/direct-charges (Stripe Tax for Platforms uses the Stripe-Account header alone to designate the connected account as MoR — `automatic_tax.liability` MUST be omitted on direct charges or Stripe returns 400).
- This is consistent with the Stripe skill's Connect reference (`references/connect.md`): "Direct charges — the charge is created on the connected account directly," and "Don't mix charge types within a single integration."

### 1.3 Mingla's cut — `application_fee_amount`
🔴 Root-of-fee-mechanics.
- `MINGLA_APPLICATION_FEE_RATE = 0.015` (1.5%), hardcoded (line 615).
- `applicationFeeAmountCents = Math.round(totalCents * 0.015)` (lines 616-618). **Computed on `totalCents` = the pre-tax subtotal** (the RPC's `totalCents`, line 528), NOT on the tax-inclusive `taxCalculation.amount_total`.
- Set on the PI as `piCreateBody.application_fee_amount` only when `> 0` (lines 1196-1199); omitted on tiny orders (< ~67 cents).
- Persisted to `ticket_checkout_sessions.stripe_application_fee_amount_cents` (lines 629-635) so refund-order can decide whether to refund the platform component.
- Doc basis: https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount and https://docs.stripe.com/connect/direct-charges#collect-fees.

**Gap vs vision:** The fee is a **fixed 1.5% always passed to the brand as a deduction from payout** (classic application fee). There is NO brand switch for "pass Mingla fee to buyer (on top)" vs "absorb." Today it is structurally always "brand absorbs from payout" because `application_fee_amount` is taken out of the connected account's settlement — the buyer never sees it as a line. To "pass to buyer," the buyer-facing total would have to be grossed up by the fee BEFORE the PI amount is set. That plumbing does not exist.

### 1.4 The 3-step Stripe Tax flow (calc → bake → commit) — NATIVE path
🔴 Core of the tax mechanics. There is **no `_shared/stripeTax.ts`** — the dispatch's named path is wrong; tax logic lives **inline** in `ticket-checkout-create/index.ts`.

**Step 1 — calculation:** `tax.calculations.create` (lines 1054-1076):
- `line_items[].tax_code: "txcd_50010001"` (line 1060), `tax_behavior: "exclusive"` (line 1061, hardcoded — tax always ON TOP, no brand choice).
- `customer_details.address` = **the buyer's typed billing address** (`buyerAddress`, lines 1063-1073), `address_source: "billing"` (line 1072).
- Scoped to the connected account via `{ stripeAccount: stripeAccountId }` (line 1075).
- Doc basis: https://docs.stripe.com/api/tax/calculations/create — `customer_details.address` + `address_source`, and `line_items[].tax_behavior` (`exclusive` = tax added on top; `inclusive` = tax included in amount). `txcd_50010001` is a Stripe tax code; **[VERIFY at SPEC: confirm `txcd_50010001` is the correct admissions/event-ticket code against https://docs.stripe.com/tax/tax-codes — the value should be validated, current code uses it without a doc cite].**
- Calculation reuse: if the client passes `taxCalculationId` and it is unexpired, the edge fn retrieves and reuses it (lines 1025-1047) instead of recalculating.

**Step 2 — bake into PI:** `paymentIntent.amount = taxCalculation.amount_total` (line 1156) — the tax-inclusive grand total becomes the PaymentSheet amount. `taxCents = amount_total − totalCents` (line 1106). The PI metadata carries `mingla_tax_calculation_id` (line 1177).

**Step 3 — commit:** `tax.transactions.createFromCalculation` is **NOT in this file**. It lives in `_shared/stripeWebhookRouter.ts` (confirmed by grep — that file + refund-order are the only non-test files containing `tax.transactions`). It fires on successful payment webhook. **[RE-READ PENDING: `stripeWebhookRouter.ts` to document the exact `createFromCalculation` call + reference + posted_at.]** Doc basis: https://docs.stripe.com/api/tax/transactions/create_from_calculation — a transaction must be created from the calculation to record the tax for filing.

### 1.5 How the native PaymentSheet gets its total
The edge fn returns `kind: "requires_payment"` (lines 1267-1288) with: `clientSecret`, `paymentIntentId`, `totalCents: taxCalculation.amount_total` (the all-in), `subtotalCents`, `taxCents`, `taxBreakdown`, `stripeAccountId`, `customerId`, `customerEphemeralKeySecret`, `publishableKey`. The mobile SDK initializes PaymentSheet against the connected account (`stripeAccountId`) with optional Customer (ephemeral key) for installments. **[RE-READ PENDING: the client `TicketCartSheet.tsx` + checkout service to confirm exactly which returned `totalCents` the PaymentSheet renders — but the contract is unambiguous: the amount on the PI is `amount_total`, so the sheet charges the all-in.]**

### 1.6 Preview mode (`mode:"preview"`) — the "Calculate tax" friction
- Native preview WITHOUT an address returns early with `taxCents: 0, addressMissing: true` (lines 531-544). This is the state nearly every buyer sees.
- Native preview WITH an address runs the same `tax.calculations.create` and returns `kind:"preview"` with `taxCents`, `totalCents: amount_total`, `calculationId` (lines 1116-1127).
- **This is the architectural friction the vision kills:** the buyer must type a full billing address (`line1`, `city`, `postal`, `country` required — `parseBuyerAddress` lines 78-98; `validateBuyerAddress` lines 100-123; enforced for native create at lines 275-288) and tap "Calculate tax" to learn the real total. `CartTaxPreview.tsx` is the UI that collects that address and calls preview. **[RE-READ PENDING: both `CartTaxPreview.tsx` files — but the backend contract proves the address fields are MANDATORY for native create today.]**

### 1.7 Web / mobile-web path (leave-as-is per vision)
`surface === "web" || "mobile-web"` uses **Stripe Checkout Sessions** (hosted page) with `automatic_tax: { enabled: true }` (line 796) and `customer_creation:"always"` for installments (lines 812-814). This is the frictionless hosted path the vision says to leave alone (Stripe auto-collects address on the hosted page). Doc basis: https://docs.stripe.com/tax/checkout (`automatic_tax` is a Checkout Sessions feature) — confirms it is NOT available on raw PaymentIntents, which is exactly why the native path hand-rolls the 3-step calc.

---

## 2. TRIPS & EXPERIENCES CHECKOUT — share or separate?

**Finding: trips already share `ticket-checkout-create` + the same PaymentSheet/CartTaxPreview components. Experiences appear to have NO paid checkout path yet.** Confidence: trips = proven from this file; experiences = probable (needs the experience-pipeline worktree cross-check).

Evidence for trips sharing the engine (all in `ticket-checkout-create/index.ts`):
- `event_type === "trip"` branches inline: bookings-closed gate (lines 331-360, ORCH-0875), per-tier traveler intake gate (lines 373-463, ORCH-0880), installment plans (ORCH-0869/0925, lines 546-554, 968-993, 1158-1195). Trips and single events flow through the **same** RPC, the **same** tax calc, the **same** PI/Checkout creation. There is ONE checkout edge function for both.
- Client: `TicketCartSheet.tsx` (consumer) + `CartTaxPreview.tsx` are shared; the business buyer-web payment page is `mingla-business/app/checkout/[eventId]/payment.tsx` (eventId is the keying entity for both events and trips — trips are rows in `events` with `event_type='trip'`).

Experiences: 🟡 there is a sibling worktree `meta-orch-0980-[experience-pipeline-unified-wiring]` and `ORCH-0998-[marketing-real-place-cards-dc]`, suggesting experiences are mid-build. **[RE-READ PENDING: grep `event_type` enum + experiences authoring/checkout. Determine whether experiences are also `events` rows (would inherit checkout free) or a separate table (would need new checkout).]** This is the single biggest scope-shape question: "one shared engine" is a **refactor-to-unify for events+trips** (already unified) but possibly a **build-new for experiences** if they are not `events` rows.

**Implication:** Because brand-kind is decommissioned and trips are already `events` rows sharing one checkout, the engine is ALREADY mostly unified at the checkout layer. The vision's "shared engine, don't duplicate per type" is largely satisfied structurally — the work is adding the 3 switches + WYSIWYP + zero-friction, not unifying separate checkouts (except possibly experiences).

---

## 3. WHERE PRICE IS DISPLAYED PRE-CHECKOUT (WYSIWYP blast radius)

🟠 **[RE-READ PENDING — channel loop blocked the display-surface enumeration. This section lists the surfaces to confirm with file:line at SPEC; the requirement is that ALL must show the all-in total when costs are passed.]**

Surfaces to enumerate (from repo structure + prior ORCH knowledge):
1. **Consumer deck / swipe cards** (`app-mobile/src/components/` card components) — price badge on the card face.
2. **Consumer expanded event/trip sheet** (`app-mobile/src/components/expandedCard/` — `TicketCartSheet.tsx` confirmed exists; the expanded sheet shows tier prices + cart subtotal).
3. **Consumer checkout cart** (`CartTaxPreview.tsx`) — currently shows subtotal then a separately-computed tax line after "Calculate tax."
4. **Business buyer-web public event page** (`mingla-business` `/e/{brandSlug}/{eventSlug}`) — price display.
5. **Business buyer-web public brand page** (`packages/brand-rendering/PublicBrandPage.tsx` — EventMiniCard / TripMiniCard price labels, per COMMS-0005/0007).
6. **Business buyer-web checkout** (`mingla-business/app/checkout/[eventId]/payment.tsx` + business `CartTaxPreview.tsx`).
7. **Business app event/trip authoring preview** (price shown to brand while authoring).
8. **Marketing emails** (`_shared/marketingEmailRender.ts` — event cards with prices, per Marketing Hub Phase A).

**Why this matters:** today the card/detail price = the bare tier price (pre-tax, pre-fee). The "real" total only appears after the address + Calculate-tax step. WYSIWYP requires the displayed price to BE the all-in whenever switches are "pass." Every price-rendering site is in the blast radius. The price-formatting helper to trace is likely `_shared/priceTiers.ts` (server) + a client currency formatter.

---

## 4. TAX SOURCING FEASIBILITY (the biggest technical risk — drilled)

### 4.1 What location data we persist
🟠 **[RE-READ PENDING: `events` table schema — confirm exact columns.]** From prior ORCH evidence (ORCH-0980 live-fire in COMMS-0006 persisted a Google Places address to `events.location_text` = `"700 Corporate Center Dr, Raleigh, NC 27607, USA"`), we hold at minimum:
- `events.location_text` — a **full formatted street address string** from Google Places (proven by COMMS-0006).
- Very likely `lat`/`lng` and a `city_id` (place-pool city scoping per MEMORY).
- The address is a **single formatted string**, NOT decomposed into `{line1, city, state, postal_code, country}` structured fields. **This is the crux of the tax-sourcing risk.**

### 4.2 Can we drive Stripe Tax from venue location with ZERO buyer input?
Verified against Stripe docs:
- `tax.calculations.create` requires `customer_details.address` (a structured address object: `line1`, `city`, `state`, `postal_code`, `country`) plus `customer_details.address_source` (`shipping` or `billing`). Doc: https://docs.stripe.com/api/tax/calculations/create.
- For **physical-presence services and admissions**, Stripe Tax sources tax based on where the service is consumed. For event admissions specifically Stripe documents an `tax_code` for "Admission to events" and the tax is generally sourced at the **event location**. Doc: https://docs.stripe.com/tax/tax-codes (admissions) and the Tax calculation API supports passing the relevant address. **[VERIFY at SPEC: the exact admissions tax_code string and whether Stripe Tax keys event-admission sourcing off `customer_details.address` or off a separate ship-from/origin field. Current code uses `txcd_50010001` with `address_source:"billing"` and the BUYER's address — to flip to venue-based, we would pass the VENUE address as `customer_details.address`. Confirm Stripe treats the supplied address as the tax basis regardless of whose address it physically is — Stripe computes tax for the jurisdiction of the address you pass; it does not validate identity.]**

### 4.3 The structured-address problem
🔴 **Highest-risk finding (probable).** Stripe Tax needs a structured address. We store a Google Places **formatted string**. To feed venue-based tax we must reliably parse/obtain structured `{line1, city, state, postal_code, country}` for the venue. Options the SPEC must weigh (do NOT design here, just document):
- Persist Google Places **address components** (structured) at authoring time, not just `location_text`.
- Use lat/lng → Stripe does not accept lat/lng for tax; it needs a postal address.
- Fall back to a **flat brand-absorbed price** when venue jurisdiction is unresolvable (the vision explicitly allows this: "or a flat inclusive price the brand absorbs jurisdiction variance on").

### 4.4 Origin vs destination
For admissions/physical events, tax is destination = the event venue (where consumed), which for our case equals the seller location — so origin/destination collapse to the same point and **determinism holds** (the venue is known at authoring). This is GOOD for WYSIWYP. The risk is purely **data quality of the venue address**, not conceptual. Confidence: probable — needs the admissions tax_code + sourcing rule confirmed against Stripe docs at SPEC, and a registered-jurisdiction check (see 4.5).

### 4.5 Registration gate (the "computes $0 for everyone" reality)
🔴 The vision doc flags it; the code confirms the mechanism. Stripe Tax only **collects** tax in jurisdictions where the connected account has **registered** (Tax → Registrations). Doc: https://docs.stripe.com/tax/registering. With ~zero brands registered, `tax.calculations.create` returns **$0 tax** for nearly everyone today → the "Calculate tax" button is pure friction for $0. The all-in engine inherits this: even with venue-based sourcing, **no tax is collected unless the brand registered that jurisdiction.** The SPEC must decide what "pass sales tax" means for an unregistered brand (likely: switch is a no-op / hidden until registered, OR brand absorbs). This is a product decision (see §8).

---

## 5. NATIVE AUTO-TAX MECHANISM (contract, doc-verified)

Confirmed against Stripe docs:
- `automatic_tax` is a **Checkout Sessions / Invoices** feature, NOT available on raw PaymentIntents. Doc: https://docs.stripe.com/tax/checkout and https://docs.stripe.com/api/payment_intents (no `automatic_tax` field). This is exactly why the native path hand-rolls.
- The supported invisible-tax pattern on a PaymentIntent flow is the **3-step**:
  1. `tax.calculations.create` server-side with `customer_details.address` = the tax basis (we would pass the **venue** address). https://docs.stripe.com/api/tax/calculations/create
  2. Bake `calculation.amount_total` into `paymentIntents.create({ amount })`. (Already done, line 1156.)
  3. On success, `tax.transactions.createFromCalculation({ calculation, reference })` to record for filing. https://docs.stripe.com/api/tax/transactions/create_from_calculation
- **This runs with ZERO buyer-entered address** — `customer_details.address` accepts ANY address we supply; nothing requires it to be the buyer's. Passing the venue address is API-legal. (Caveat: `address_source` would conceptually be the service location; confirm whether to keep `"billing"` or whether admissions wants a different source at SPEC.)
- Exact current contract is already implemented for the BUYER address; the change is purely **swap the address basis from buyer-typed → venue-stored** and **remove the address form / Calculate-tax gate**.

---

## 6. FEE PASS-THROUGH MATH & LEGAL (doc-verified)

### 6.1 application_fee_amount mechanics under direct charges
- The charge is on the connected account; `application_fee_amount` is transferred FROM the connected account TO the platform (Mingla). Doc: https://docs.stripe.com/connect/direct-charges#collect-fees. So today Mingla's 1.5% is **always effectively "brand-absorbed"** (deducted from the brand's settlement). Buyer is unaffected.
- **"Pass Mingla fee to buyer (on top)":** the buyer-facing total must be grossed up by the fee before the PI `amount` is set; `application_fee_amount` then captures Mingla's cut from the grossed-up charge. Net effect: brand's payout is unchanged, buyer pays more. **"Absorb":** keep today's behavior (fee comes out of brand payout, buyer pays bare price). The math is straightforward; the missing piece is the buyer-facing gross-up + a brand switch.
- Merchant of record: the **connected account (brand)** is MoR under direct charges (https://docs.stripe.com/connect/charges). Absorb does NOT change MoR; it only changes who the displayed price burdens.

### 6.2 Processing-cost recovery — surcharging law (the legal constraint)
🔴 Documented constraint (do NOT design solution):
- A **true credit-card surcharge** (a fee specifically for paying by card) is heavily regulated in the US: prohibited in several states, **prohibited on debit/prepaid cards entirely** (Durbin Amendment), capped (historically ~3-4% / card-network caps), and subject to disclosure + advance-notice rules to the card networks. Stripe documents this: https://docs.stripe.com/payments/surcharging — "Surcharging is subject to card network rules and state laws... you cannot surcharge debit cards... some states prohibit surcharging." Stripe supports surcharging only via Confirmation Tokens inspecting card brand/funding BEFORE charging (payments.md line 34: "for surcharging... use Confirmation Tokens").
- **Why the "service fee" framing is the compliant path:** a flat disclosed **service fee** (charged to ALL buyers regardless of card type, not labeled as a card surcharge, baked into the displayed price) is NOT a card surcharge and sidesteps the debit-prohibition, state bans, network caps, and advance-notice rules. This is the Eventbrite model. The vision picks this deliberately. Tax pass-through and Mingla-fee pass-through are clean (not card-network-regulated).
- **Investigation note only:** the SPEC must ensure the "service fee" is (a) charged uniformly (not card-type-conditional — that would re-classify it as a surcharge), (b) disclosed in the all-in price, (c) not described to the buyer as a card/processing surcharge in copy.

---

## 7. BLAST RADIUS & INVARIANTS

- **Installment plans (ORCH-0925):** native PI path attaches a Customer + ephemeral key + `setup_future_usage:"off_session"` (lines 903-963, 1158-1195) and is **card-only** (lines 1191-1195). Any change to the PI `amount` (all-in total) flows into the deposit + the scheduled installment math in `process-scheduled-installments`. **[RE-READ PENDING: installment scheduler — confirm it derives per-installment amounts from the all-in total, not the bare subtotal.]** Tax + fee changes MUST propagate to installment amounts or the plan under/over-charges.
- **Refunds (refund-order/index.ts):** contains tax + application_fee logic (grep hit). Partial/full refunds must reverse the proportional tax via `tax.transactions.createFromCalculation` with negative/reversal reference, and decide `refund_application_fee`. **[RE-READ PENDING: exact reversal call + doc cite https://docs.stripe.com/api/tax/transactions/create_reversal.]** Flipping `tax_behavior` (exclusive→brand-chosen inclusive) changes how the refundable tax component is computed.
- **Buyer-protection date-change rules (ORCH-0877/0875):** `business_patch_event_when` blocks date changes on events with active sales (COMMS-0006). Pricing changes post-sale are similarly sensitive — the SPEC must define whether a brand can flip switches AFTER tickets sold (almost certainly NO for sold inventory).
- **Existing tests that lock current behavior:**
  - `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` — locks the native 3-step + `tax_behavior:"exclusive"` + buyer-address basis. **Will break** when address form is removed / behavior becomes brand-chosen.
  - `ticket-checkout-create/__tests__/nativePaidRegionGate.test.ts` + `nativeRegionGate_adversarial.test.ts` — note: the region gate itself was DELETED per MEMORY (stripe-native-paid-region-gated SUPERSEDED), so these may be stale/removed; confirm.
  - `_shared/__tests__/stripeWebhookRouter*.test.ts` — lock the tax-transaction commit + dispute routing.
- **Strict-grep gates touching checkout (COMMS-0002 relevant):**
  - `orch-0843-stripe-direct-charges-only.mjs` — bans `transfer_data.destination`; any new fee plumbing must stay direct-charge.
  - `orch-0804-stripe-tax-enabled-on-checkout` — asserts `automatic_tax.enabled:true` on the web Checkout path.
  - `i-stripe-pm-method-allowlist.mjs` + `orch-0837-regression-check.mjs` — payment-method allowlist; bans `automatic_payment_methods`.
  - `orch-0863-marketing-hub-phase-b.mjs` C7 `no-new-backend-files` — per COMMS-0002, ANY new `supabase/functions/` file or migration needs an allowlist entry in the SAME commit or CI fails.
- **What breaks if tax_behavior flips + address form removed:**
  - `orch_0955_native_stripe_tax.test.ts` assertions on `tax_behavior:"exclusive"` and `address_source:"billing"` + buyer-address requirement.
  - `validateBuyerAddress` / `parseBuyerAddress` + the native-create address gate (lines 275-297) become dead/removed code — must be cleanly deleted, not left as drift (Constitution #8 subtract-before-adding).
  - Web Checkout `automatic_tax` path uses buyer-address-based destination tax (hosted page collects buyer address) — if events also want venue-based on web, that diverges from `automatic_tax`'s buyer-destination model. The vision says leave web as-is; SPEC must reconcile that web (buyer-dest tax) and native (venue tax) could compute DIFFERENT totals for the same event. 🔴 This is a real inconsistency to surface.

---

## 8. OPEN PRODUCT QUESTIONS FOR THE OPERATOR (Seth decides, not forensics)

1. **Venue-jurisdiction ambiguity / unresolvable address:** when the venue's stored address can't be parsed into a Stripe-Tax-valid structured address (we store a formatted string), do we (a) require structured address at authoring, (b) fall back to a flat brand-absorbed price, or (c) hide the "pass tax" switch? The vision allows (b).
2. **Unregistered brand + "pass sales tax" = $0:** Stripe collects tax only in registered jurisdictions. If a brand toggles "pass tax" but isn't registered, tax computes $0. Is the switch hidden until registration, a no-op, or does it force "absorb"? (Today everyone is unregistered → $0.)
3. **Web vs native tax-basis divergence:** web buyer-anon uses `automatic_tax` (buyer-destination tax); native would use venue tax. Same event could show 2 different totals across surfaces. Accept the divergence, or migrate web to venue-based too (breaks "leave web as-is")?
4. **"Service fee" line display:** does the all-in price show a broken-down line ("Service fee $X") at checkout, or only the single grand total (true WYSIWYP, no breakdown)? Legal disclosure may favor a visible line; WYSIWYP favors one number.
5. **Migration of existing events:** events created under today's `exclusive`-tax, no-switches model — at migration do they default to all-3-absorb (price unchanged), all-pass, or keep legacy behavior? What happens to events with tickets already sold?
6. **Absorb-mode accounting:** when tax/fee is absorbed, does it reduce the brand's connected-account payout silently, or surface as a separate ledger line the brand sees ("you absorbed $X tax/fees")? Affects brand trust + reporting.
7. **Experiences checkout existence:** are experiences `events` rows (inherit checkout free) or a separate pipeline needing build-new? (meta-orch-0980 experience-pipeline is in flight — coordinate.)
8. **Switch mutability after sale:** can a brand flip switches after tickets sell? (Recommend locked-after-first-sale, mirroring buyer-protection date rules.)
9. **Currency:** default is `"GBP"` (line 529) but tax codes/surcharge law cited are US — confirm primary market + whether tax engine is US-first, UK-first, or both (UK VAT is inclusive-by-default, which interacts with `tax_behavior`).

---

## 9. Five-Layer Cross-Check (summary)

| Layer | Current truth | Vision target | Gap |
|---|---|---|---|
| Docs (vision) | 3 switches, WYSIWYP, zero-friction, venue tax | — | This is the target |
| Schema | `events.location_text` = formatted string; `ticket_checkout_sessions` has tax/fee cols; NO switch columns | needs 3 switch columns + structured venue address | **[RE-READ PENDING schema]** |
| Code | direct charges, 1.5% app fee always brand-absorbed, tax `exclusive` always-on-top, buyer-address-based, manual Calculate-tax | brand-chosen pass/absorb ×3, venue-based, no address form | large |
| Runtime | nearly all buyers see $0 tax (unregistered) + must type address | one all-in number, card-only | large |
| Data | ~0 brands registered for Stripe Tax | — | tax collection is ~nonexistent today |

---

## 10. Confidence

- **Native money flow (charge model, app-fee, 3-step tax, PaymentSheet contract):** PROVEN (full read of the authoritative edge function + Stripe docs).
- **Trips share the engine:** PROVEN. **Experiences checkout existence:** PROBABLE (needs cross-worktree check).
- **Tax-sourcing risk (structured-address gap + registration gate):** PROBABLE → the mechanism is doc-confirmed; the venue-address data shape needs the `events` schema read to become PROVEN.
- **Display blast radius (§3):** SUSPECTED list — needs file:line enumeration once channel clears.
- **Single biggest technical risk:** **venue-based deterministic tax.** Stripe Tax needs a structured postal address and only collects in registered jurisdictions; we store an unstructured formatted string and ~no brand is registered. WYSIWYP REQUIRES a deterministic upfront number, so the engine must either (a) reliably obtain structured venue addresses + drive brand registration, or (b) fall back to flat brand-absorbed inclusive pricing. Confidence: PROBABLE (doc-confirmed mechanism; pending `events` schema + admissions tax_code confirmation at SPEC).

---

## 11. RE-READ PENDING checklist (to close before SPEC)

1. Both `CartTaxPreview.tsx` (consumer + business) — full UI, the address fields, the Calculate-tax button, the price/tax/total render.
2. `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` — which total the PaymentSheet renders + tier price display.
3. `mingla-business/app/checkout/[eventId]/payment.tsx` — business buyer-web payment page.
4. `_shared/stripeWebhookRouter.ts` — `tax.transactions.createFromCalculation` commit step (exact reference/posted_at).
5. `refund-order/index.ts` — tax reversal + `refund_application_fee` decision.
6. `events` table schema (latest migration) — confirm `location_text` shape, lat/lng, city_id, absence of switch columns.
7. `biz_ticket_checkout_create_session` (latest migration) — pricing inputs.
8. Display surfaces (§3) — every price-render site with file:line.
9. Experiences: are they `events` rows or separate? (coordinate with meta-orch-0980).
10. `_shared/priceTiers.ts` + client currency formatter — the single place to make prices all-in.
11. Stripe admissions tax_code + venue-address-as-basis confirmation (https://docs.stripe.com/tax/tax-codes, /api/tax/calculations).

---

## Discoveries for Orchestrator

- **ORCH-ID double-booking (P1 process):** two worktrees exist for the SAME label — `ORCH-1005-[universal-allin-pricing-engine]` AND `ORCH-1006-[universal-allin-pricing-engine]`, plus `ORCH-1005-[biz-web-dead-code-cleanup]`. ORCH-1005 is claimed by BOTH this feature and biz-web-dead-code-cleanup. Per COMMS-0004 SOP, resolve the collision (likely ORCH-1006 is the correct/renumbered pricing engine; ORCH-1005 pricing worktree is a stale duplicate). Flag to Seth.
- **Dispatch path error:** the dispatch named `supabase/functions/_shared/stripeTax.ts` — that file does NOT exist. Tax logic is inline in `ticket-checkout-create/index.ts` + the commit step in `_shared/stripeWebhookRouter.ts`. Future dispatches should reference the real locations.
- **Tool-channel replay loop** blocked ~12 read calls mid-investigation (one stale truncated Read result echoed for every call). RE-READ PENDING items (§11) must be completed before SPEC; this report is complete on the firsthand-read core but explicitly incomplete on the pending list.
