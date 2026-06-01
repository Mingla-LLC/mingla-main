# SPEC — ORCH-1025 [Seamless native consumer cart — remove billing/tax form → all-in → PaymentSheet]

**Status:** SPEC — ready for IMPLEMENT
**Author:** mingla-orchestrator + claude (forensics SPEC)
**Date:** 2026-05-31
**Severity:** S1-high (`missing-feature` — the seamless WYSIWYP buyer surface that ORCH-1006's engine exists to power was never built)
**Affected Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`).
**Surfaces explicitly NOT in scope:** Buyer/anon Web (`mingla-business/` `/checkout/{eventId}`) — its tax basis diverges (automatic_tax from buyer address; see COMMS-0013) and is a separate follow-up; Business iOS/Android/web — authoring already shipped (ORCH-1006 Surfaces 1–5); Admin web — no checkout surface.
**Stripe-touching:** YES — `stripe-best-practices` skill invoked at SPEC start (memory [[stripe-skill-mandatory]]). NOTE: the SPEC changes **no Stripe API call** — the backend money path is unchanged and already live.

---

## 0. One line
The consumer cart still makes the buyer type a billing address and tap "Calculate tax" before paying. ORCH-1006 already shipped the backend so tax is computed from the **venue** (server-side) and the **all-in price is already available client-side per tier** — so the cart should show one all-in price upfront and go straight to the native PaymentSheet, no address typed.

## 1. Why this exists (root cause, evidence-backed)
ORCH-1006 [Universal all-in pricing engine] shipped (merged to main, PR #269/#270):
- `ticket-checkout-create` rewired to compute all-in + **venue-based** Stripe Tax via `resolve_event_pricing_inputs` and write `orders.pricing_breakdown` — **live as edge fn v130** (`supabase/functions/ticket-checkout-create/index.ts:38,555,1173`).
- `nativeCheckoutFlow` made `buyer.address` and `taxCalculationId` **optional** (Surface 6) — `app-mobile/src/payments/nativeCheckoutFlow.ts:33–36,137,144` ("the buyer no longer types a billing address").
- Per-tier all-in is exposed to the app via the anon RPC `pg_public_event_tier_allin` and mapped to `all_in_cents` in `publicEventTicketsService.ts:66–103` (same `compute_all_in_cents` math the charge uses → WYSIWYP parity by construction). The trip/event **detail page already renders this all-in** ("incl. VAT & fees").

But the **consumer cart UI was never rewritten.** The Slice-3 handoff *claims* "cart rewritten, no address form — committed on branch," but that commit **does not exist in branch history** (it was the "half-applied edit that was reverted" the handoff warns about). On-device (iOS + Android, 2026-05-31) the cart still renders the full `CartTaxPreview` billing-address + "Calculate tax" gate.

**Current cart contract (the thing to change):**
- `TicketCartSheet.tsx` imports + renders `CartTaxPreview` (`:65–67,554`), holds `taxPreview` state (`:219`), and **gates Continue-to-Payment on `taxPreview !== null`** (`:323,422`). The buyer cannot pay until they fill an address and calculate tax.
- The `onCheckout` payload carries `totalCents`/`taxCalculationId`/`address` from the tax preview (`:364–366`).
- `CartTaxPreview.tsx` collects a `BuyerAddress`, validates it, calls an edge fn to compute tax, returns `{ address, calculationId, totalCents }`.

## 2. Target behaviour (WYSIWYP)
1. Buyer opens the cart → sees the **all-in total** immediately (sum of per-tier `all_in_cents` × quantity), with a tappable **"What's included"** panel: **Tickets / Service fee / Total / "Includes £X VAT"** (the **Mingla fee is folded** into the ticket subtotal — ORCH-1006 locked decision; the service fee is its own line). No address field. No "Calculate tax" button.
2. Buyer taps **Continue to Payment** → native PaymentSheet opens directly (the existing `nativeCheckoutFlow` path), with **no address and no `taxCalculationId`** in the payload. The backend computes the exact charge (venue-based all-in tax) and returns the PaymentIntent `client_secret`.
3. The amount charged equals the all-in total shown (both derive from the same server `compute_all_in_cents`). The receipt/`pricing_breakdown` already records the inclusive split.

## 3. Scope of change (frontend only — NO backend, NO Stripe API change)
1. **`app-mobile/src/components/expandedCard/TicketCartSheet.tsx`**
   - Remove the `CartTaxPreview` import + render, the `taxPreview` state, and the `taxPreview !== null` gating on Continue-to-Payment.
   - Compute the displayed all-in total from the ticket types' already-present `all_in_cents` (× quantity). **No client-side fee/tax math** — if a tier's `all_in_cents` is null (RPC miss), fall back to base `price_cents` and omit the "includes VAT & fees" affordance for that tier (never invent a number).
   - Add the **"What's included"** breakdown panel (Tickets subtotal / Service fee / Total / "Includes £X VAT" when all-in > base). Source the VAT line from the server breakdown where available; otherwise show the qualitative "Includes VAT & fees" note without a fabricated figure.
   - `onCheckout` payload: drop `address` and `taxCalculationId` (pass neither); keep `totalCents` for display/telemetry only (the authoritative charge is the PI amount).
2. **`app-mobile/src/components/checkout/CartTaxPreview.tsx`** — retire. If no other consumer surface imports it, delete the file; otherwise reduce to the still-used export. (Verify usages first; it is NOT a test file, so deletion is allowed by the append-only gate.)
3. **`app-mobile/src/payments/nativeCheckoutFlow.ts`** — no change required (already accepts address-less, taxCalculationId-less). Confirm the address-less path is exercised.
4. **Email receipt** — ORCH-1006 already specced the inclusive-VAT note in `_shared/email/ticketBody.ts`; only touch if the cart removal changes the order fields it reads (it should not). Out of scope unless a regression surfaces.

## 4. Stripe contract (from `stripe-best-practices`; nothing to change)
- The backend uses **PaymentIntents** (correct for "model checkout state independently and just create a charge" — native PaymentSheet), **Stripe Tax for Platforms** (calculation/commit/reverse) sourced from the **venue** address, **Connect destination** charges, **idempotency keys**, and `application_fee` from the configurable take-rate — all live in v130, **untouched by this ORCH**.
- Removing the buyer-address form is **safe**: tax is computed server-side from the venue, not the buyer's address. The old `CartTaxPreview` address→`taxCalculationId` path is superseded; passing no `taxCalculationId` lets the backend own the calculation (the path it already takes for address-less checkout).
- WYSIWYP parity holds **by construction**: the displayed all-in (`pg_public_event_tier_allin` → `compute_all_in_cents`) and the charged amount (PI built from the same engine) share one server function.

## 5. Hard guards / invariants
- **G-1 WYSIWYP:** the all-in total displayed == the amount charged. No client-side fee/tax arithmetic; the app only does `cents/100` and sums server-provided `all_in_cents`.
- **G-2 No buyer address:** the buyer never types an address; the checkout payload carries neither `address` nor `taxCalculationId`.
- **G-3 No fabricated numbers:** if `all_in_cents` is null for a tier, fall back to base and drop the all-in affordance — never compute or guess a tax/fee figure client-side.
- **G-4 PaymentSheet path preserved:** reuse the existing `nativeCheckoutFlow` init→present flow (per-PI connected-account `initStripe`); do not introduce a new Stripe call path.
- **G-5 Build timing:** consumer buyers won't see this until the next native build ships (memory [[ota-deferred-until-new-build]]); the RPC + backend are already live, so it "just works" when the build lands.

## 6. Success criteria + verification
- **On-device (sim + physical iOS + Android):** open a paid event/trip cart → all-in total shows immediately, no address field, no "Calculate tax"; tap "What's included" → Tickets / Service fee / Total / Includes £X VAT (Mingla fee folded); tap Continue to Payment → native PaymentSheet opens directly; complete a Stripe **test-mode** payment → charged amount == displayed all-in; order row's `pricing_breakdown` records the inclusive split.
- **Parity probe:** for a sample tier, assert `displayed all-in == PI amount` (both from `compute_all_in_cents`).
- **Regression test:** source-assertion that `TicketCartSheet` no longer imports/renders `CartTaxPreview`, no longer gates on `taxPreview`, and the checkout payload omits `address`/`taxCalculationId`; plus a guard that the all-in total derives only from `all_in_cents`/`price_cents` (no inline `* taxRate`/`* feeBps`).

## 7. Cross-ORCH coordination
- Builds on **ORCH-1016** (merged to main `31e6c39e0`, PR #290) — the cart's scroll/nav root-cause fix + `bottomNavStore`/`hidesBottomNav` are now on main; this ORCH edits the same `TicketCartSheet.tsx` on top of them.
- **COMMS-0013** (web↔native tax divergence): the web buyer checkout keeps `automatic_tax` (buyer-address basis) and is explicitly OUT of scope; flag for a follow-up web sub-ORCH.
- **ORCH-1006 locked decisions** preserved: Mingla fee folded; brand-side wording "You covered £X" (not "absorbed") — unaffected here (buyer-side).

## 8. Out of scope (this ORCH)
- Web buyer checkout tax model (COMMS-0013).
- Brand authoring switches (ORCH-1006 Surfaces 1–5 — shipped).
- The service-fee economics question (handoff §3) — does not block the buyer-side all-in display.
