# SPEC — ORCH-1147 [cart does not reflect the TRUE price of a trip/event/experience]

**Phase:** SPEC ONLY (binding build contract — no product code in this turn).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]` on branch `ORCH-1147-cart-true-price` (rebased on origin/main @ `61156a6e5`, 0 behind).
**Project ref:** `gqnoajqerqhnvulmnyvv`.
**Skill:** mingla-forensics (SPEC mode).
**Inputs ingested:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1147_CART_TRUE_PRICE_FEE_TAX_OMISSION.md` (root cause, six-field evidence, per-surface matrix); `COMMS_LEDGER.md` (COMMS-0013 / 0014 / 0016 factored — see §1).
**Comms ack:** COMMS-0013 (WARN, OPEN — web-vs-native tax basis divergence, ORCH-1006) + COMMS-0014 + COMMS-0016 (WARN — experience checkout MUST stay on `ticket-checkout-create`) read + factored into §2/§4/§6. This SPEC is the partial discharge of COMMS-0013's planned "follow-up web-checkout sub-ORCH" for the fee-gross-up leg (the web CHARGE under-bill), and explicitly leaves the residual exclusive-tax web/native divergence as a NAMED, scoped caveat (§4.3, OQ-2) rather than silently shipping it.

---

## 1. Executive summary

The buyer-facing **cart / checkout "Total"** on the business app and on buyer-web shows the **bare ticket subtotal** (base price × qty) with **no Mingla fee, no service fee, and no tax folded in** — while the server actually charges the full all-in (base + passed Mingla fee + passed service fee + tax). Display and charge therefore diverge: a buyer can be **charged more than the quoted Total** (business iOS/Android + buyer-web), violating Mingla's all-in / WYSIWYP promise (ORCH-1025/1130, `feedback_cart_combined_fees_tax_line`).

Three distinct defects, one promise:
- **F-1/F-2 (display):** the business cart total (`useCartTotals.total`) is the base subtotal; the payment-screen `displayAllIn` only shows the server all-in via a fragile, native-only, buyer-details-gated async preview, and falls back to the base subtotal on web (always) and on any native preview miss.
- **D-1 / F-4 (web CHARGE under-bill):** the buyer-web hosted Stripe Checkout line item is `unit_amount: totalCents` (BASE only) — the passed Mingla/service-fee gross-up is **dropped from the charge itself**, so web buyers UNDER-pay vs native for the same passed-fee offering. This is an economic/revenue bug, not just display.
- **D-2 / F-6 (tax term):** the per-tier all-in RPC (`compute_all_in_cents` → `pg_public_event_tier_allin`) folds FEES but **excludes TAX**, so a fee-grossed display still understates by the tax amount in **exclusive-tax regions** (US sales tax, `pass_tax=true`).

This SPEC makes the displayed cart/checkout **Total equal the server all-in** across **event / trip / experience** on business iOS, business Android, and buyer-web; renders the single combined **"Fees & tax"** line; and fixes the web CHARGE to bill the fee-grossed subtotal. The structural fix is **one owner of the money**: the per-tier server all-in (`priceAllInGbp`, fee-grossed) becomes the cart's display basis (synchronous, no buyer form, web + native parity), and the server engine remains the charge authority — the client stops re-deriving the total from the bare base subtotal.

**Currently masked:** 0 of 8 charges-enabled brands pass any fee/tax toggle today (all are inclusive-tax GB/EU/CH), so no live checkout shows the divergence — it is a launch-time landmine the instant any charges-enabled brand flips a toggle. Tester MUST stand up a synthetic pass-fee fixture (§D-3 / §7).

---

## 2. Scope & non-goals

### In scope
- Make the **business cart/payment displayed Total** equal the server fee-grossed all-in (`priceAllInGbp`), across event / trip / experience, on business iOS + business Android + buyer-web — synchronously, with no buyer-detail precondition and no buyer tax form.
- Add the single combined **"Fees & tax"** line (all-in − base) to the business cart/payment order summary, per `feedback_cart_combined_fees_tax_line` (one line, NOT split service-fee + VAT).
- Fix the **buyer-web CHARGE** (`ticket-checkout-create` web/mobile-web Checkout Session) so the line item bills the **fee-grossed pre-tax subtotal** (`buyerSubtotal.buyerSubtotalCents`), letting Stripe `automatic_tax` add tax on top — so the web charge equals the native charge for the fee gross-up (closes D-1/F-4).
- Establish the per-tier server all-in as the SINGLE display authority the cart reads; remove the client's independent re-derivation of the headline Total from the bare base subtotal.
- Pre-stage DRAFT invariants + the strict-grep/test enforcement family (§6).
- Per-offering-type coverage proven separately (trip / event / experience use different checkout routes; §3, §5).

### Non-goals (explicitly OUT — with reason)
- **Making the SQL all-in RPC tax-aware for exclusive-tax regions.** `compute_all_in_cents` is a pure IMMUTABLE fee-only SQL function with no region/venue/registration input; faithfully replicating Stripe Tax's jurisdiction calculation in SQL is impossible (Stripe Tax is the authority, venue+registration dependent). The residual exclusive-tax (US `pass_tax=true`) display understatement is left as a **named, scoped caveat** (§4.3, OQ-2), NOT fixed here — fixing it requires routing display off the server preview's tax-inclusive `buyer_total_cents`, which gates on buyer details and is a larger redesign. **Today's blast radius is ZERO** (all charges-enabled brands are inclusive-tax GB/EU/CH where tax is inside the base and `all_in_cents == buyer_total_cents`).
- **ORCH-1034 GBP currency-fallback work** (`?? "GBP"`, `priceGbp` field naming, `normalizeCurrency→GBP`). The cart still seeds `currency: ticket.currency ?? event.currency ?? "GBP"` and field names carry `Gbp` — this is the separate, not-yet-started ORCH-1034 and is NOT the fee/tax-omission root cause. Display reads `totals.currency` already; do not touch the GBP fallbacks. (Interaction noted: the all-in seed must carry the SAME `currency` as the base seed; no new currency fallback introduced.)
- **Paystack/NGN charge-path rewrite.** The NGN arm shares the business cart DISPLAY bug (fixed here via the shared cart) but charges via `computeConfigVat` (`ticket-checkout-create.ts:686`), not the Stripe engine. This SPEC requires **parity confirmation** only (§D-4 / §5 SC-7) — no NGN charge-path change.
- **Buyer tax form / billing-address re-introduction** — barred by I-PROPOSED-1130-NO-BUYER-TAX-FORM (§6). The fix consumes server-computed numbers; it adds NO form.
- **Consumer app (app-mobile) display change.** Consumer already shows a fee-grossed all-in correctly (F-5, the reference pattern). The consumer tax-gap (F-6) is the SAME exclusive-tax caveat as OQ-2 and is OUT for the same reason. No consumer file is touched.
- **Checkout redesign / new screens / new payment methods.** Total-display + charge-correctness only.

### Assumptions
- `pg_public_event_tier_allin` / `priceAllInGbp` is already fetched on every business checkout ticket record (`publicEventsService.fetchTickets:879-895`) for event; the trip and experience checkout index screens must source the same per-tier all-in (verify each path in §4 — trip/experience seed from their own stubs and may need the all-in plumbed through).
- The server `mode:"preview"` round-trip stays as the native upfront tax-inclusive confirmation (it gates on buyer name/email/phone — lines 257/261/264 — so it CANNOT be the cart-screen source; it remains the late, native-only tax-inclusive refinement). The cart-screen display basis is the synchronous per-tier `priceAllInGbp`.

---

## 3. Cross-Surface Impact Declaration (MANDATORY per-surface table)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | NO | Already correct (fee-grossed all-in, F-5). Tax-gap = OQ-2 caveat, OUT. | none | — |
| 2 | **Consumer Android** (`app-mobile/` Android) | NO | Same as #1. | none | — |
| 3 | **Buyer / anon Web** (`mingla-business` `/checkout/{eventId}`, `/checkout-trip/...`, `/checkout-experience/...`) | YES | Displayed Total = fee-grossed all-in (NOT base); combined "Fees & tax" line shown; **the CHARGE bills the fee-grossed subtotal** (D-1 fixed) + Stripe adds tax. | `CartContext.tsx`, 3× `index.tsx`, 3× `payment.tsx`, `ticket-checkout-create/index.ts:1086` | Manual (web display branch + web charge branch are distinct from native) |
| 4 | **Business iOS** | YES | Displayed Total = fee-grossed all-in synchronously (no buyer-detail gate); combined "Fees & tax" line; native preview still refines to tax-inclusive when buyer details present. | `CartContext.tsx`, 3× `index.tsx`, 3× `payment.tsx` | Auto across the 3 offerings via shared `CartContext`; manual vs web |
| 5 | **Business Android** | YES | Same as #4. | same as #4 | Auto (shared RN code) |
| 6 | **Admin Web** (`mingla-admin/`, adjacent) | NO | No buyer checkout surface. | none | — |
| 7 | **Business Web preview** (adjacent) | NO | Non-buyer surface. | none | — |

**Hard gate note:** surfaces 3/4/5 are the ONLY covered surfaces. Web (3) is the only surface with a CHARGE change (D-1); native (4/5) is display-only (the native charge already bills `buyer_total_cents` — F-3 — correctly).

---

## 4. Layered specification

### 4.1 Data flow (the structural fix — read this first)

**Before (broken):**
```
ticket record .priceGbp ──seed──▶ CartLine.unitPrice ──Σ×qty──▶ useCartTotals.total (BASE) ──▶ "Total" display
                                                                                            (re-derived, no fee/tax)
server engine buyer_total_cents ──────────────────────────────────────────────────────────▶ CHARGE (native)
server Checkout line unit_amount: totalCents (BASE) ───────────────────────────────────────▶ CHARGE (web)  ← under-bills
```

**After (one owner):**
```
ticket record .priceAllInGbp (server fee-grossed, pg_public_event_tier_allin)
        │
        ├─seed──▶ CartLine.unitPrice (BASE, unchanged — for the per-line "Tickets" subtotal)
        └─seed──▶ CartLine.unitPriceAllIn (NEW — server fee-grossed all-in)
                          │
                          ▼
            useCartTotals → { subtotal (base), allInTotal (Σ allIn×qty), feesTaxCents = allInTotal − subtotal }
                          │
                          ▼
       payment.tsx: "Total" = allInTotal; "Fees & tax" line = feesTaxCents; Pay button = allInTotal
                     (native: optional tax-inclusive refinement from preview when buyer details present)

server CHARGE (web): unit_amount: buyerSubtotal.buyerSubtotalCents (fee-grossed pre-tax) + automatic_tax → equals native fee gross-up
server CHARGE (native): amount: buyer_total_cents  (UNCHANGED — already correct)
```

The display now reads a **server-computed** per-tier all-in (`priceAllInGbp`) instead of re-deriving from base. The client performs ZERO fee/tax math beyond `Σ(serverAllIn × qty)` and `allIn − base` (the same two ops the consumer reference pattern uses — `TicketCartSheet.tsx:305-328`).

### 4.2 Client layer — business cart (`CartContext.tsx`)

**File:** `mingla-business/src/components/checkout/CartContext.tsx`

1. **`CartLine` (interface, ~L34-46):** add an OPTIONAL field
   `unitPriceAllIn?: number;` — major units in `currency`, the server fee-grossed all-in per unit (from `priceAllInGbp`). Optional so a missing all-in (free tier, or a path that hasn't plumbed it) falls back to `unitPrice` (base) and contributes 0 to fees/tax — never undefined, never NaN.
2. **`SET_LINE_QUANTITY` action + reducer (~L144-238) + `setLineQuantity` signature (~L270-318):** thread `unitPriceAllIn?: number` through the action, the reducer line-write (both the new-line and existing-line branches must persist it), and the public setter params. When absent, store `unitPriceAllIn: unitPriceAllIn ?? unitPrice`.
3. **`CartTotals` (interface, ~L389-400):** add
   `allInTotal: number;` (Σ `unitPriceAllIn × qty`, fee-grossed),
   `feesTaxCents: number;` (in MINOR units = `round((allInTotal − subtotal) × 100)`, GREATEST(0, …)),
   `hasFeesTaxDelta: boolean;`.
   Keep `subtotal` / `total` as the BASE subtotal for the per-line "Tickets" recap (do NOT repurpose `total`; downstream legacy reads of `total` as base must not silently change meaning — the headline Total is sourced from `allInTotal`).
4. **`useCartTotals` (~L402-426):** in the reduce loop also accumulate `allInTotal += (line.unitPriceAllIn ?? line.unitPrice) × line.quantity`; compute `feesTaxCents` + `hasFeesTaxDelta`; return them. All math in major units then convert the delta to cents once (mirror `TicketCartSheet.tsx:323`). No currency mixing change (existing guard stays).

**Error/empty states:** empty cart → `allInTotal=0, feesTaxCents=0, hasFeesTaxDelta=false`. Free cart (`subtotal===0`) → `allInTotal=0` (free tiers carry `priceAllInGbp=null` → seed falls back to `unitPrice=0`).

### 4.3 Client layer — the three checkout INDEX (cart-seed) screens

Each seeds `CartLine`. Each must additionally pass `unitPriceAllIn` sourced from the SAME ticket record's server all-in.

| Offering | File | Current seed line | Change |
|----------|------|-------------------|--------|
| **Event** | `mingla-business/app/checkout/[eventId]/index.tsx` | `:271-274` `unitPrice: ticket.priceGbp ?? 0` | add `unitPriceAllIn: ticket.priceAllInGbp ?? ticket.priceGbp ?? 0` (record already carries `priceAllInGbp` — `PublicTicketTypeRecord`). |
| **Trip** | `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | `:246` (`sole`) + `:450` (multi) `unitPrice: …priceGbp ?? 0` | add `unitPriceAllIn` from the stub's server all-in. **VERIFY the trip stub carries the per-tier all-in** (`:69` maps `priceGbp` from `priceCents`; confirm `priceAllInGbp`/`allInCents` is fetched on the trip checkout query — if NOT, plumb `pg_public_event_tier_allin` / the same `fetchTierAllInCents` into the trip ticket fetch first, mirroring `publicEventsService.fetchTickets:879-895`). |
| **Experience** | `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | `:277` `unitPrice: stub.priceGbp ?? 0` | add `unitPriceAllIn` from the stub's server all-in. **VERIFY the experience stub carries the per-tier all-in** (`:54` maps `priceGbp`; confirm `priceAllInGbp` present — plumb if missing, same as trip). |

> **Stop-and-amend trigger:** if either trip or experience checkout does NOT already fetch the per-tier all-in and plumbing it requires touching a service/hook outside the allowlist (§ Allowlist), the implementor requests a SPEC amendment naming the exact service/query before widening. The expected source is the same `pg_public_event_tier_allin` RPC the event path uses — confirm whether trip/experience route through `publicEventsService.fetchTickets` (which already adds `priceAllInGbp`) or a separate fetch.

### 4.4 Client layer — the three PAYMENT screens (display)

| Offering | File | displayAllIn block |
|----------|------|--------------------|
| **Event** | `mingla-business/app/checkout/[eventId]/payment.tsx` | `:558-561` |
| **Trip** | `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | `:573-576` |
| **Experience** | `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx` | `:476-480` |

For EACH (identical change, three sites):

1. **Headline Total source.** Replace the bare-subtotal fallback. New rule:
   ```ts
   // base for the "Tickets" line; allInTotal (server fee-grossed) is the headline floor
   const baseTotalCents = Math.round(totals.subtotal * 100);
   const allInFloorCents = Math.round(totals.allInTotal * 100);   // fee-grossed, sync, web+native
   // native refinement: when the preview resolved, it is tax-INCLUSIVE (≥ floor) → prefer it
   const headlineCents = (Platform.OS !== "web" && allInPreviewCents !== null && allInPreviewCents >= allInFloorCents)
     ? allInPreviewCents
     : allInFloorCents;
   const displayAllIn = formatCurrency(headlineCents, totals.currency, /*isMinor*/ true);
   ```
   - **Web** now shows `allInFloorCents` (fee-grossed all-in) instead of the base subtotal — the web display bug is fixed by data, no `Platform.OS` branch hiding the all-in.
   - **Native** still upgrades to the tax-inclusive `allInPreviewCents` when the non-blocking preview resolves; otherwise the fee-grossed floor (never the bare base).
   - The `>= allInFloorCents` guard prevents a stale/lower preview from regressing the headline.
2. **Add the combined "Fees & tax" line** to the ORDER SUMMARY GlassCard (event `:602-630`; trip/experience analogous), rendered ONLY when `totals.hasFeesTaxDelta` (mirror consumer `TicketCartSheet`):
   ```
   Tickets        {formatCurrency(baseTotalCents, currency, minor)}     ← per-line Σ stays as-is
   Fees & tax     {formatCurrency(feesTaxLineCents, currency, minor)}   ← NEW, single combined line
   ─────────
   Total          {displayAllIn}
   ```
   where `feesTaxLineCents = headlineCents − baseTotalCents` (so on native with a tax-inclusive preview the line correctly includes tax; on web/floor it is the fee delta). NEVER split into separate service-fee + VAT lines (`feedback_cart_combined_fees_tax_line`).
3. **Bottom-bar Total (event `:672-677`) + Pay button (event `:678-689`)** already read `displayAllIn` — they inherit the fix automatically. Confirm the same for trip/experience bottom bars.
4. **Copy:** Total label unchanged ("Total"); new line label exactly `Fees & tax`. The `accessibilityLabel` on Pay already interpolates `displayAllIn` — inherits the all-in.

**States (all three screens):** loading/seed-incomplete → existing empty-shell guard unchanged. Preview-miss (native) → fee-grossed floor (NOT base). Web → fee-grossed floor always. Free cart → existing free-path guard (no all-in row).

**Exclusive-tax caveat (OQ-2, documented, NOT fixed):** on web AND on the native floor, the headline omits tax in **exclusive-tax regions** (US `pass_tax=true`) because `priceAllInGbp` excludes tax (F-6). For all current charges-enabled brands (GB/EU/CH inclusive) the floor EQUALS the charge. A code comment at each `displayAllIn` site MUST name this caveat + OQ-2 so it is not mistaken for a complete tax fix.

### 4.5 Edge layer — buyer-web CHARGE fix (D-1 / F-4)

**File:** `supabase/functions/ticket-checkout-create/index.ts`
**Site:** web/mobile-web Checkout Session, `:1082-1090`, specifically `:1086 unit_amount: totalCents`.

Change `unit_amount` from `totalCents` (BASE) to **`buyerSubtotal.buyerSubtotalCents`** — the fee-grossed PRE-TAX subtotal computed at `:919` (`computeBuyerSubtotal`), which is in scope at the web branch (web branch `:971` is after `:919`).

**Why `buyerSubtotalCents`, NOT `buyer_total_cents`:** the web Checkout Session has `automatic_tax: { enabled: true }` (`:1105`) — Stripe ADDS tax on top of the line item. If the line item were `buyer_total_cents` (which already includes tax), Stripe would **double-tax**. The correct web line item is the fee-grossed PRE-TAX subtotal; `automatic_tax` then adds the jurisdiction tax → the web buyer pays base + passed fees + tax, matching the native `buyer_total_cents` for the fee gross-up. (This corrects the dispatch's shorthand "bill `buyer_total_cents`" for the web path specifically — see OQ-1.)

`application_fee_amount` (`:1073-1076 = buyerSubtotal.miglaFeeCents`) is UNCHANGED — it is Mingla's platform skim out of the merchant cut, independent of the buyer gross-up.

**No other edge change.** The native PI amount (`:1559 buyer_total_cents`) and preview return (`:1519 buyer_total_cents`) are already correct (F-3). The `verify_jwt`, auth, validation, and error shapes are untouched.

**Web-vs-native tax basis residual (COMMS-0013):** the web branch uses Stripe `automatic_tax` (buyer-billing-address basis) while native uses venue-sourced `tax.calculations.create`. This SPEC fixes the FEE divergence (the under-bill) but does NOT unify the tax BASIS — that residual stays exactly as COMMS-0013 registered it (operator-accepted at launch; ≈0 live pass-tax brands). Named, not silently shipped.

### 4.6 DB layer

**No migration.** `compute_all_in_cents` / `pg_public_event_tier_allin` are NOT changed (non-goal §2: SQL cannot faithfully compute exclusive-region tax). The display reads the existing fee-grossed RPC output already exposed via `priceAllInGbp`.

### 4.7 Service / Hook layer

- `publicEventsService.fetchTickets` already attaches `priceAllInGbp` (event path) — no change unless §4.3 verification finds trip/experience do NOT route through it, in which case the SAME `fetchTierAllInCents(eventId)` helper (`:840-857`) is added to that path (stop-and-amend if it touches a non-allowlisted file).
- No new hook, no new query key, no React Query change.

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1-iOS / SC-1-Android / SC-1-Web** — On a **pass-fee** event (a brand passing Mingla and/or service fee), the cart/payment **"Total"** displayed EQUALS the server fee-grossed all-in (`Σ priceAllInGbp × qty`), NOT the bare base subtotal. (Web shows it synchronously; native shows it synchronously, refined to tax-inclusive when the preview resolves.)
- **SC-2-iOS / SC-2-Android / SC-2-Web** — The order summary renders a single combined **"Fees & tax"** line = (headline Total − base "Tickets" subtotal), rendered iff `hasFeesTaxDelta`; never split into separate service-fee + VAT lines.
- **SC-3 (event) / SC-4 (trip) / SC-5 (experience)** — Each offering type independently satisfies SC-1/SC-2 (different checkout routes; verified separately).
- **SC-6-Web (D-1)** — The buyer-web hosted Stripe Checkout Session line item bills `buyerSubtotal.buyerSubtotalCents` (fee-grossed pre-tax), so the web charge total (line item + Stripe `automatic_tax`) equals the native charge's fee gross-up. A pass-fee web checkout no longer under-bills the passed fee.
- **SC-7 (D-4 parity)** — On the Paystack/NGN arm, the business cart DISPLAY shows the same fee-grossed all-in (shared `CartContext`), and the NGN CHARGE (`computeConfigVat` path) is confirmed to already bill the all-in (no regression; parity documented, no NGN charge change).
- **SC-8 (invariant preserved)** — No buyer-facing billing-address form or "Calculate tax" control is introduced; `orch-1130-no-buyer-tax-form.mjs` still passes.
- **SC-9 (no-regression on absorb brands)** — On an absorb-all brand (current prod: all 8 charges-enabled), `feesTaxCents=0`, no "Fees & tax" line renders, and the displayed Total equals the base subtotal exactly as before (zero visible change).
- **SC-10 (free)** — Free tiers: Total = "Free"/0, no fees/tax line, unchanged.

Each SC is observable in the running app (display) or via the edge function request body (SC-6) or DB/Paystack config read (SC-7).

---

## 6. Invariants

### Preserved
- **I-PROPOSED-1130-NO-BUYER-TAX-FORM (DRAFT, ACTIVE-enforced via gate):** preserved. The fix consumes server-computed numbers and adds NO buyer form. Verified by the existing `orch-1130-no-buyer-tax-form.mjs` strict-grep gate (must still pass — SC-8).
- **WYSIWYP / all-in single "Fees & tax" line** (`feedback_cart_combined_fees_tax_line`, ORCH-1025/1006/1130): this SPEC brings business + web display into compliance; the combined-line contract is honored (single line, SC-2).
- **ORCH-1034 de-GBP boundary:** untouched. The all-in seed carries the SAME `currency` as the base seed; no new `?? "GBP"` introduced.

### NEW — proposed DRAFT (orchestrator flips ACTIVE on CLOSE)
- **I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN (DRAFT).** The business cart/payment headline "Total" and Pay-button amount MUST be sourced from the server fee-grossed all-in (`priceAllInGbp` → `CartLine.unitPriceAllIn` → `useCartTotals.allInTotal`), never from the bare base subtotal (`totals.subtotal`/`totals.total`) as the headline. **Enforcement family:** strict-grep + jest. Strict-grep `orch-1147-cart-total-is-allin.mjs`: assert the three `payment.tsx` headline `displayAllIn`/Pay sites do NOT bind the headline directly to `totals.total`/`totals.subtotal` without the `allInTotal`/`allInPreviewCents` path; jest on `useCartTotals` proving `allInTotal ≠ subtotal` when `unitPriceAllIn > unitPrice`.
- **I-PROPOSED-1147-WEB-CHARGE-BILLS-FEE-GROSSED-SUBTOTAL (DRAFT).** The buyer-web Checkout Session line item MUST bill `buyerSubtotal.buyerSubtotalCents` (fee-grossed pre-tax), NOT the bare `totalCents`, so the web charge equals the native fee gross-up (with `automatic_tax` adding tax). **Enforcement family:** strict-grep `orch-1147-web-charge-allin.mjs` asserting the web `line_items[].price_data.unit_amount` is `buyerSubtotal.buyerSubtotalCents` (and fails if it reverts to `unit_amount: totalCents`). Comment-anchored fails-on-revert.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy, implementor) | `useCartTotals` with a pass-fee line | line `{ unitPrice: 50, unitPriceAllIn: 52.25, qty: 1, currency: "GBP" }` | `subtotal=50`, `allInTotal=52.25`, `feesTaxCents=225`, `hasFeesTaxDelta=true` | hook (jest) |
| T-2 (happy) | event payment headline source | preview unresolved, `allInTotal=52.25` | `displayAllIn` formats `5225` cents (all-in floor), NOT `5000` | component |
| T-3 (error/edge) | preview resolves LOWER than floor (stale) | `allInPreviewCents=5000`, floor `5225` | headline stays `5225` (`>= floor` guard) | component |
| T-4 (edge) | absorb-all brand (SC-9) | `unitPriceAllIn === unitPrice` | `feesTaxCents=0`, no "Fees & tax" line, Total == base | hook + component |
| T-5 (edge) | free tier (SC-10) | `unitPrice=0, unitPriceAllIn` null→0 | Total "Free"/0, no fees line | hook + component |
| T-6 (web charge, **adversarial — tester**) | web Checkout Session body on a pass-fee event | edge `surface:"web"`, brand passes Mingla fee | `line_items[0].price_data.unit_amount === buyerSubtotal.buyerSubtotalCents` (fee-grossed), NOT `totalCents`; `automatic_tax.enabled===true` | edge |
| T-7 (offering parity) | trip + experience payment screens | pass-fee trip + pass-fee experience | each shows fee-grossed Total + "Fees & tax" line (SC-4/SC-5) | component ×2 |
| T-8 (invariant) | gate run | repo | `orch-1130-no-buyer-tax-form.mjs` PASS; `orch-1147-*` gates PASS | CI |
| T-9 (NGN parity, SC-7) | NGN cart display + charge config | NGN pass-fee brand | display shows all-in; `computeConfigVat` charge confirmed all-in (no under-bill) | component + edge read |

### Step 0.5 regression-test contract (mandatory)
- **Implementor happy-path test (fails-on-revert):** `mingla-business/src/components/checkout/__tests__/orch_1147_cart_allin_total.test.ts` — asserts T-1 + T-2: `useCartTotals.allInTotal` reflects `unitPriceAllIn` and the event payment headline binds to the all-in, not the base. MUST FAIL if `useCartTotals` is reverted to `total: subtotal`-only / the headline rebinds to `totals.total`. Committed BEFORE merge (per `feedback_close_gate_verify_against_merged_main_not_stale_anchor`).
- **Tester adversarial test (DIFFERENT angle):** a pass-fee fixture where the OLD code under-quotes — drive BOTH (a) the **web CHARGE** (T-6: assert the Checkout Session line item bills the fee-grossed subtotal, not the bare base — this catches D-1 directly and fails on revert of `:1086`), AND (b) a business payment render where the displayed Total exceeds the bare base by exactly the fee gross-up. The tester's angle is the CHARGE-side under-bill + a synthetic pass-fee brand, distinct from the implementor's display-math unit test.

### Tester-enablement requirement (D-3 — MANDATORY in the test plan)
No charges-enabled brand passes any fee/tax toggle today (0/8; the lone pass-fee brand is NGN/Paystack, charges-disabled), so **a green test against current prod data proves NOTHING** — every brand absorbs, so `feesTaxCents=0` everywhere. Downstream TEST MUST:
1. Stand up (or temporarily toggle) a **charges-enabled, pass-fee** brand + offering — either a synthetic fixture in the jest tests (preferred; deterministic) OR, for live-fire, temporarily flip `default_pass_mingla_fee=true` on a sandbox charges-enabled brand and revert after.
2. Exercise the discrepancy: confirm display Total > base by the fee gross-up, and confirm the web Checkout Session bills the grossed-up subtotal.
3. Confirm the **Paystack/NGN arm** (D-4/SC-7) shows the all-in in the cart and its `computeConfigVat` charge bills the all-in (no regression).
A test run on absorb-only data is INSUFFICIENT and must be rejected as non-probative.

---

## 8. Implementation order

1. **`CartContext.tsx`** — add `unitPriceAllIn` to `CartLine` + action + reducer + setter; add `allInTotal`/`feesTaxCents`/`hasFeesTaxDelta` to `CartTotals` + `useCartTotals`. (§4.2)
2. **Event checkout** — `checkout/[eventId]/index.tsx` seed `unitPriceAllIn`; `checkout/[eventId]/payment.tsx` headline + "Fees & tax" line. (§4.3/§4.4)
3. **Trip checkout** — verify/plumb per-tier all-in into the trip ticket fetch; `checkout-trip/.../index.tsx` seed; `checkout-trip/.../payment.tsx` display. (§4.3/§4.4)
4. **Experience checkout** — verify/plumb per-tier all-in; `checkout-experience/.../index.tsx` seed; `checkout-experience/.../payment.tsx` display. (§4.3/§4.4)
5. **Web CHARGE** — `ticket-checkout-create/index.ts:1086` `unit_amount: totalCents` → `buyerSubtotal.buyerSubtotalCents`. (§4.5)
6. **Gates + tests** — add `orch-1147-cart-total-is-allin.mjs` + `orch-1147-web-charge-allin.mjs` strict-greps; the Step-0.5 implementor jest. (§6/§7)

---

## 9. Regression prevention (fails-on-revert)

- **Structural safeguard:** the cart consumes a server-computed all-in (`priceAllInGbp`) as its display basis — the client no longer owns the fee/tax math (it only sums and subtracts). The server engine remains the single charge authority. One owner per truth.
- **Display regression test:** `orch_1147_cart_allin_total.test.ts` (T-1/T-2) — FAILS when `useCartTotals` reverts to `total: subtotal`-only or the payment headline rebinds to `totals.total`; PASSES when the all-in path is restored.
- **Charge regression test/gate:** `orch-1147-web-charge-allin.mjs` (+ tester T-6) — FAILS when `ticket-checkout-create:1086` reverts to `unit_amount: totalCents`; PASSES when it bills `buyerSubtotal.buyerSubtotalCents`.
- **Protective comments:** at each `displayAllIn` site and at `:1086`, a comment naming ORCH-1147 + the invariant + the OQ-2 exclusive-tax caveat, so a future editor knows the headline/line-item must stay server-all-in-sourced and why the web uses pre-tax-subtotal (not `buyer_total_cents`).

---

## 10. Open questions

- **OQ-1 (RESOLVED in-spec, flagged for orchestrator awareness):** the dispatch said "bill `buyer_total_cents`" for the web charge. For the WEB hosted-Checkout path specifically, billing `buyer_total_cents` would **double-tax** (the Session has `automatic_tax: enabled`). The SPEC bills `buyerSubtotal.buyerSubtotalCents` (fee-grossed pre-tax) instead — this is the correct discharge of D-1 and matches the native fee gross-up. Confirm the orchestrator accepts this refinement.
- **OQ-2 (exclusive-tax residual — operator decision deferred, NOT blocking):** the fee-grossed display floor (`priceAllInGbp`) excludes tax, so on **exclusive-tax regions** (US `pass_tax=true`) the displayed floor understates the charge by the tax. Today's blast radius is ZERO (all charges-enabled brands are inclusive GB/EU/CH). Closing this requires routing the display off the server preview's tax-inclusive `buyer_total_cents` (which gates on buyer name/email/phone and cannot run on the cart screen) — a larger follow-on. Ship the fee fix now; track exclusive-tax display as a future ORCH. Operator to confirm acceptance at launch (mirrors COMMS-0013's operator-accepted residual).
- **OQ-3 (trip/experience all-in source):** the implementor must verify whether trip + experience checkout already carry the per-tier `priceAllInGbp` (vs only the event path via `publicEventsService.fetchTickets`). If a separate fetch needs the `fetchTierAllInCents` helper added, that is in scope but must be done via the existing RPC (stop-and-amend if it touches a non-allowlisted service).

---

## 11. Downstream routing

- **Next = mingla-implementor.** Build §8 in order in the worktree; add the gates + the Step-0.5 implementor test; run the business jest suite + the two new strict-greps + `orch-1130-no-buyer-tax-form.mjs`; prove the implementor test fails-on-revert; write the implementation report.
- **Then = mingla-tester.** Stand up the synthetic/charges-enabled pass-fee fixture (D-3 — a green run on absorb-only data is rejected); write the DIFFERENT-angle adversarial test (web CHARGE under-bill T-6 + display-exceeds-base); confirm NGN parity (SC-7); device-verify on business iOS + Android + web buyer route across event/trip/experience.
- **Then = mingla-orchestrator CLOSE.** Flip I-PROPOSED-1147-* ACTIVE; sync World Map / invariant registry / decision log; commit the tester test before merge; reconcile against COMMS-0013/0014/0016.
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]/` on branch `ORCH-1147-cart-true-price`.

---

## Scoped allowlist (implementor MAY change)

- `mingla-business/src/components/checkout/CartContext.tsx`
- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/checkout/[eventId]/payment.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx`
- `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx`
- `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx`
- `supabase/functions/ticket-checkout-create/index.ts` (ONLY `:1086 unit_amount`)
- `mingla-business/src/services/publicEventsService.ts` (ONLY IF §4.3 verification proves trip/experience need `fetchTierAllInCents` plumbed — stop-and-amend first)
- NEW: `.github/scripts/strict-grep/orch-1147-cart-total-is-allin.mjs`, `.github/scripts/strict-grep/orch-1147-web-charge-allin.mjs`
- NEW: `mingla-business/src/components/checkout/__tests__/orch_1147_cart_allin_total.test.ts`

## DO-NOT-TOUCH (stop-and-amend before any change)

- `compute_all_in_cents` / `pg_public_event_tier_allin` (no migration; non-goal §2).
- The native PI amount (`ticket-checkout-create:1559`) and preview return (`:1519`) — already correct.
- The Paystack/NGN charge path (`:686 computeConfigVat`) — parity confirm only, no edit.
- Any `app-mobile/` consumer file (consumer display already correct).
- ORCH-1034 GBP fallbacks (`?? "GBP"`, `priceGbp` field renames, `normalizeCurrency`).
- Any buyer billing-address / tax form (I-1130).
- `useCartTotals.total` / `.subtotal` MEANING (keep = base; the headline is a NEW `allInTotal`, do not repurpose `total`).
