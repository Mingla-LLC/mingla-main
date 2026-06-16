# INVESTIGATE — ORCH-1147 [cart does not reflect the TRUE price of a trip/event/experience]

**Phase:** INVESTIGATE ONLY (no product code, no SPEC).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]` on branch `ORCH-1147-cart-true-price` (rebased on origin/main @ `61156a6e5`, up to date).
**Project ref:** `gqnoajqerqhnvulmnyvv`.
**Skill:** mingla-forensics. **COMMS ledger:** read on entry; no OPEN entry addressed to forensics / ORCH-1147 / ALL — no ack required.

---

## Symptom summary (expected vs actual)

- **Expected (Mingla all-in / WYSIWYP, ORCH-1025/1130):** the cart/checkout summary the buyer sees BEFORE paying equals the amount the server actually charges — base + any passed-through Mingla fee + service fee + tax, shown as one all-in Total with a single combined "Fees & tax" line.
- **Actual:** on the business app and buyer-web, the displayed Total is the **bare ticket subtotal** (base price × qty), with **fees and tax NOT folded in**, so the buyer can be charged MORE than the quoted Total. Confirmed repro anchor: business app own checkout, across trip / event / experience.

---

## Investigation manifest (files read, in trace order)

1. `COMMS_LEDGER.md` — entry scan (no forensics/1147/ALL OPEN row).
2. `.github/scripts/strict-grep/orch-1130-no-buyer-tax-form.mjs` — the 3 native checkout payment-screen roots.
3. `mingla-business/app/checkout/[eventId]/index.tsx` — event ticket-select cart (subtotal).
4. `mingla-business/src/components/checkout/CartContext.tsx` — `useCartTotals` (the client total math).
5. `mingla-business/app/checkout/[eventId]/payment.tsx` — event payment screen `displayAllIn`.
6. `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` — trip payment `displayAllIn`.
7. `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx` — experience payment `displayAllIn`.
8. `mingla-business/app/checkout-trip/.../index.tsx`, `checkout-experience/.../index.tsx` — cart seed (`unitPrice`).
9. `supabase/functions/ticket-checkout-create/index.ts` (1705 lines) — the charge authority (web Checkout Session + native PI + preview).
10. `supabase/functions/_shared/allInPricingEngine.ts` — `computeBuyerSubtotal`, `buildPricingBreakdown`, `buyer_total_cents`.
11. `mingla-business/src/services/publicEventsService.ts` — `fetchTierAllInCents` / `pg_public_event_tier_allin` (per-tier all-in IS fetched).
12. `mingla-business/src/hooks/usePublicEvents.ts` — query wrapper.
13. `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` — consumer cart (per-tier `priceAllInGbp` client all-in).
14. `app-mobile/src/payments/nativeCheckoutFlow.ts` — consumer native charge path (surface:"native").
15. DB (read-only): `resolve_event_pricing_inputs`, `compute_all_in_cents`, `pg_public_event_tier_allin` defs; brand pass-toggle + region distribution; the one pass-fee brand's tier numbers.

---

## Q-scorecard

**Q1 — Does the business-app cart/payment display equal the server charge?**
Verdict: **NO — display omits the passed-fee gross-up (and tax). PROBABLE (source-strong + DB numeric proof), masked in current prod data.** See F-1, F-2, F-7.

**Q2 — Do display and charge share ONE pricing engine, or does display re-derive independently?**
Verdict: **They DIVERGE. The charge uses the server engine (`buyer_total_cents`); the business display re-derives the total client-side from the bare base subtotal (`useCartTotals.total`), ignoring the per-tier all-in it already fetched.** PROBABLE. See F-1, F-3.

**Q3 — Same bug on web buyer funnel as on native?**
Verdict: **WORSE on web. Web never even attempts the all-in: `displayAllIn` is forced to the base subtotal (`Platform.OS === "web"` branch), and the hosted Stripe Checkout line item is `unit_amount: totalCents` (base only) — the passed Mingla/service-fee gross-up is silently dropped from the WEB CHARGE itself, not just the display.** PROBABLE. See F-2, F-4.

**Q4 — Trip vs event vs experience — same behavior?**
Verdict: **IDENTICAL across all three. All route through `ticket-checkout-create`; all three checkout indexes seed `unitPrice: priceGbp` (base); all three payment screens use the same `displayAllIn` fallback pattern.** PROBABLE. See F-3.

**Q5 — Does the consumer app (app-mobile) have the same bug?**
Verdict: **PARTIAL. Consumer displays a correct FEE-grossed all-in (`priceAllInGbp` from `pg_public_event_tier_allin`) — so it matches the charge when tax is inclusive (GB/EU/CH) or pass_tax=false. But the all-in RPC EXCLUDES tax, so consumer UNDERSTATES by the tax amount when pass_tax=true AND the region adds tax on top (exclusive / US sales tax).** PROBABLE. See F-5, F-6.

**Q6 — Is the discrepancy brand-toggle dependent, and is it masked today?**
Verdict: **YES on both. The gross-up only appears when a brand PASSES a fee/tax. In current prod, 0 of 8 charges-enabled brands pass any toggle → the discrepancy is invisible in any live checkout today. The lone pass-fee brand is NGN/Paystack, charges-disabled.** PROBABLE→numeric-PROVEN at DB layer. See F-7.

---

## Findings (six-field evidence)

### F-1 — `useCartTotals.total` is the bare subtotal: NO fees, NO tax (business client total math)
- **Symptom:** business cart/payment "Total" = base × qty; fees/tax absent.
- **Layer:** code (client).
- **Probe:** read `mingla-business/src/components/checkout/CartContext.tsx:402-426`.
- **Evidence:**
  ```ts
  // CartContext.tsx:404-423
  let subtotal = 0;
  for (const line of lines) { subtotal += line.unitPrice * line.quantity; ... }
  return { ...subtotal, total: subtotal, ... }; // total === subtotal, no fee/tax term
  ```
  And the cart is seeded with the BASE, not the all-in:
  ```ts
  // checkout/[eventId]/index.tsx:274   unitPrice: ticket.priceGbp ?? 0,
  // checkout-trip/.../index.tsx:246    unitPrice: sole.priceGbp ?? 0,
  // checkout-experience/.../index.tsx:277 unitPrice: stub.priceGbp ?? 0,
  ```
- **Mechanism:** `total` is defined as the raw base subtotal → every business surface that renders `totals.total` shows a number with no fee/tax gross-up.
- **Severity:** **CONFIRMED ROOT CAUSE** (the display total computation site).

### F-2 — Business payment screen `displayAllIn` falls back to the bare subtotal; web ALWAYS shows it
- **Symptom:** buyer sees the base Total on web always, and on native whenever the async preview hasn't resolved/failed.
- **Layer:** code (client).
- **Probe:** read `checkout/[eventId]/payment.tsx:558-561` (event); identical at trip `payment.tsx:573-576` and experience `payment.tsx:476-480`.
- **Evidence:**
  ```ts
  // payment.tsx:558-561
  const displayTotalCents = totals.total;                       // bare subtotal
  const displayAllIn = Platform.OS !== "web" && allInPreviewCents !== null
    ? formatCurrency(allInPreviewCents, totals.currency, true)  // server all-in (native only)
    : formatCurrency(displayTotalCents, totals.currency);       // FALLBACK = bare subtotal
  ```
  `allInPreviewCents` is set only by a NON-BLOCKING `mode:"preview"` round-trip that requires buyer name+email and silently no-ops on any error (`payment.tsx:272-313`). On web the `Platform.OS !== "web"` guard forces the base-subtotal branch unconditionally.
- **Mechanism:** the "all-in" display depends on a fragile native-only async fetch; web and any native fast-path / preview-failure show the base subtotal as the headline `Total` and on the `Pay {displayAllIn}` button.
- **Severity:** **CONFIRMED ROOT CAUSE** (the divergent display computation site; web is unconditional).

### F-3 — Charge authority: server engine charges `buyer_total_cents` = base + passed fees + tax
- **Symptom:** the amount the buyer is actually billed.
- **Layer:** code (edge) + schema.
- **Probe:** read `supabase/functions/ticket-checkout-create/index.ts:899-927, 1488-1559` + `_shared/allInPricingEngine.ts:173-267`.
- **Evidence:**
  ```ts
  // allInPricingEngine.ts:182-189
  let buyerSubtotal = input.baseCents;
  if (input.switches.pass_mingla_fee)  buyerSubtotal += miglaFeeCents;
  if (input.switches.pass_service_fee) buyerSubtotal += serviceFeeCents;
  // ticket-checkout-create.ts:1361  taxAmountCents = buyerSubtotal.buyerSubtotalCents (tax computed ON the grossed-up subtotal)
  // ticket-checkout-create.ts:1559  amount: pricingBreakdown.buyer_total_cents  (NATIVE PI amount = all-in incl. tax)
  // allInPricingEngine.ts:254       buyer_total_cents: amountTotalCents  (= Stripe tax calc amount_total)
  ```
- **Mechanism:** the server is the single charge authority and bills the full all-in; the business display (F-1/F-2) re-derives the total from the base subtotal independently → divergence whenever any pass-toggle is on (and, on the exclusive-tax path, whenever tax is added on top).
- **Severity:** **CONFIRMED ROOT CAUSE** (ground-truth charge site; the divergence counterpart to F-1/F-2).

### F-4 — WEB charge itself drops the passed fee gross-up (not just the display)
- **Symptom:** on the buyer-web hosted Stripe page the buyer is charged base + Stripe-auto-tax, with the passed Mingla/service fee gross-up MISSING from the line item.
- **Layer:** code (edge).
- **Probe:** read `ticket-checkout-create/index.ts:1078-1092`.
- **Evidence:**
  ```ts
  // ticket-checkout-create.ts:1082-1091  (web / mobile-web Checkout Session)
  line_items: [{ price_data: { currency, unit_amount: totalCents, ... }, quantity: 1 }],
  // unit_amount = totalCents = BASE subtotal (NOT buyerSubtotal.buyerSubtotalCents / buyer_total_cents)
  automatic_tax: { enabled: true },          // Stripe adds tax on top
  // application_fee_amount = Mingla's skim — comes OUT of the merchant cut, NOT added to the buyer
  ```
  Contrast with the native PI which uses `amount: pricingBreakdown.buyer_total_cents` (F-3). The web Checkout Session is built from `totalCents` (base) only.
- **Mechanism:** on web the passed fee gross-up never reaches Stripe at all → the buyer is UNDER-charged the fee on web (revenue/economic mismatch) while the native buyer is charged the full all-in. The web display and the web charge agree with each other on base+tax, but BOTH disagree with the native charge and with the intended all-in.
- **Severity:** **SECONDARY ROOT CAUSE** — a second, distinct divergence on web: the charge omits the passed fee. (Note: this is a charge-side bug, not only a display bug; flag for SPEC scope.)

### F-5 — Consumer cart shows a FEE-grossed all-in (correct mechanism) — proves the right pattern exists
- **Symptom:** consumer "Total" + "Fees & tax" line reflect base + passed fees.
- **Layer:** code (client) + schema.
- **Probe:** read `app-mobile/.../TicketCartSheet.tsx:286-330, 434, 706-722` + `pg_public_event_tier_allin` def.
- **Evidence:**
  ```ts
  // TicketCartSheet.tsx:314-323
  const allInMajor = ticket?.priceAllInGbp != null ? ticket.priceAllInGbp : null; // server all-in per tier
  const lineAllInCents = allInMajor != null ? Math.round(allInMajor*100)*qty : lineBaseCents;
  const feesTaxCents = Math.max(0, allInCents - baseCents);   // ONE combined "Fees & tax" line
  // :434  totalCents: pricing.allInCents  (display total = server all-in)
  ```
- **Mechanism:** consumer reads a server-computed per-tier `all_in_cents` (`pg_public_event_tier_allin`) and displays the all-in client-side with zero local fee math → display matches the FEE portion of the charge. This is the contract the business app is missing.
- **Severity:** **RULED OUT** as a fee-omission root cause on consumer; **reference pattern** for the fix.

### F-6 — The all-in RPC (`compute_all_in_cents`) folds FEES but EXCLUDES tax → consumer (and any all-in display) understates by tax on exclusive-tax regions
- **Symptom:** consumer/business all-in display can still be below the charge by the tax amount.
- **Layer:** schema (DB function).
- **Probe:** `pg_get_functiondef('compute_all_in_cents')`, `pg_get_functiondef('pg_public_event_tier_allin')` (live prod introspection).
- **Evidence:**
  ```sql
  -- compute_all_in_cents(base, pass_mingla, pass_service, take_rate_bps, service_fee_bps=300):
  --   base + (pass_mingla ? mingla_fee : 0) + (pass_service ? service_fee : 0)
  --   NO TAX TERM.
  -- pg_public_event_tier_allin → calls compute_all_in_cents; all_in_cents excludes tax.
  ```
  The server CHARGE (F-3) computes Stripe Tax on the grossed-up subtotal: for inclusive regions (GB/EU/CH) tax is inside the base (so `all_in_cents` matches `buyer_total_cents`); for **exclusive** regions (US sales tax) the charge ADDS tax on top → `buyer_total_cents > all_in_cents` by the tax amount when `pass_tax=true`.
- **Mechanism:** even a "correct" all-in display sourced from this RPC will understate the charge by the tax when pass_tax + exclusive region. The combined "Fees & tax" line currently captures only the fee delta, never the tax delta, on this path.
- **Severity:** **SECONDARY ROOT CAUSE** (latent; bites the moment a US/exclusive brand sets pass_tax=true). Distinct from F-1/F-2/F-4 — the RPC needs a tax-aware all-in or the display needs the server preview's tax-inclusive `buyer_total_cents`.

### F-7 — DB numeric proof + masking condition (brand-toggle dependency)
- **Symptom:** the discrepancy is invisible in current prod because no charges-enabled brand passes a fee/tax.
- **Layer:** data (read-only prod).
- **Probe:** SQL against prod `gqnoajqerqhnvulmnyvv`:
  ```sql
  select count(*) total, count(*) filter (where stripe_charges_enabled) charges_enabled,
    count(*) filter (where default_pass_tax or default_pass_mingla_fee or default_pass_service_fee) any_pass
  from brands;
  -- → total=59, charges_enabled=8, any_pass=1  (and the 1 pass-brand is NOT charges-enabled)

  select pg_public_event_tier_allin('a0000000-0000-4000-8000-000000002076');
  -- Paystack NG Test Brand, base=500000 → all_in_cents=522500 (+22500 = 4.5% passed fees), pass_tax=true, NGN
  ```
- **Evidence:** region split — GB 40 (3 charges-enabled, 0 pass_tax), US 15 (2 ce, 0 pass_tax), EU 2 (2 ce), CH 1 (1 ce), NG 1 (0 ce, pass_tax=1). The single fee-grossed example (base 500000 → all-in 522500) shows the +₦225 fee delta the business cart would drop; that brand also passes tax, which `all_in_cents` does NOT add.
- **Mechanism:** the bug requires `pass_mingla_fee` / `pass_service_fee` / `pass_tax = true` to be observable. Today every sellable brand absorbs all three → "absorb-brands look fine, masking it." The discrepancy is a live launch-time landmine the instant any charges-enabled brand flips a toggle on.
- **Severity:** **CONFIRMED CONTRIBUTOR / masking condition** (numeric-proven at DB layer).

---

## Five-truth-layer reconciliation

| Layer | Finding | Contradiction |
|---|---|---|
| **Docs** | MEMORY + ORCH-1025/1130: all-in/WYSIWYP, one "Fees & tax" line, tax venue-sourced server-side, ALL surfaces. | Business + web display contradict the doc: they show base subtotal. |
| **Schema** | `compute_all_in_cents` folds fees, NOT tax; `resolve_event_pricing_inputs` resolves per-event pass = COALESCE(event, brand default). | The all-in RPC's no-tax term contradicts the "all-in incl. tax" promise on exclusive regions (F-6). |
| **Code** | Charge = `buyer_total_cents` (base+fees+tax) native; web Checkout line item = base only (F-4). Business display = base subtotal (F-1/F-2); consumer display = fee-grossed all-in (F-5). | Web charge ≠ native charge for the fee gross-up (F-4). Display ≠ charge on business everywhere (F-1/F-2). |
| **Runtime** | Not live-fired to a real charge (see Repro). DB numeric proof stands in. | Masked: no charges-enabled pass-brand exists to drive a live divergence (F-7). |
| **Data** | 0/8 sellable brands pass any toggle; 1 NGN test brand passes all three. | The bug is currently dormant in prod data. |

---

## Repro evidence

- **Source trace:** complete, with verbatim file:line evidence (F-1…F-6) and the live-prod function defs (F-3 engine, F-6 RPC).
- **DB numeric proof (read-only, prod):** `pg_public_event_tier_allin` returns `522500` for a `500000` base (the +4.5% passed-fee gross-up the business cart drops); the same brand passes tax which the RPC excludes (F-6/F-7).
- **Live-fire to a real charge: NOT performed — and not reachable without creating test data or triggering a real charge.** No charges-enabled brand passes any fee/tax (F-7), so no existing public buyer-web checkout demonstrates the divergence live; standing up such a brand/offering or forcing a toggle is a write + a real Stripe charge, both barred under the INVESTIGATE hard guards. Per Prime Directive 7, source-only + DB-numeric evidence caps the surface×offering verdicts at **PROBABLE** (not CONFIRMED). The masking condition is itself the reason a live repro is blocked, and is reported as such.

---

## Per-surface × per-offering-type matrix

Legend: cell = displayed-Total-vs-charged-Total verdict. **BROKEN** = display < charge possible. Confidence in parens. Divergent computation sites named.

| Offering → / Surface ↓ | trip | event | experience |
|---|---|---|---|
| **Business iOS** | BROKEN (PROBABLE) | BROKEN (PROBABLE) | BROKEN (PROBABLE) |
| **Business Android** | BROKEN (PROBABLE) | BROKEN (PROBABLE) | BROKEN (PROBABLE) |
| **Buyer Web** | BROKEN×2 (PROBABLE) | BROKEN×2 (PROBABLE) | BROKEN×2 (PROBABLE) |
| **Consumer iOS** | PARTIAL — tax-gap only (PROBABLE) | PARTIAL — tax-gap only (PROBABLE) | PARTIAL — tax-gap only (PROBABLE) |
| **Consumer Android** | PARTIAL — tax-gap only (PROBABLE) | PARTIAL — tax-gap only (PROBABLE) | PARTIAL — tax-gap only (PROBABLE) |

Divergent computation sites per cell:

- **Business iOS/Android (all 3 offerings):** DISPLAY = `mingla-business/src/components/checkout/CartContext.tsx:415-423` (`total = subtotal`, base only) seeded by `checkout*/.../index.tsx` `unitPrice: priceGbp`, surfaced via `checkout*/.../payment.tsx` `displayAllIn` fallback (event `:558-561`, trip `:573-576`, exp `:476-480`). CHARGE = `ticket-checkout-create/index.ts:1559` (`amount: buyer_total_cents`). Native preview (`payment.tsx:272-313`) papers over it only when it resolves; the base subtotal shows otherwise.
- **Buyer Web (all 3): two divergences.** (1) DISPLAY forced to base subtotal — `payment.tsx` `Platform.OS !== "web"` guard (same lines as above). (2) CHARGE itself drops the fee gross-up — `ticket-checkout-create/index.ts:1086` (`unit_amount: totalCents`) vs the intended `buyer_total_cents`.
- **Consumer iOS/Android (all 3):** DISPLAY = `TicketCartSheet.tsx:314-323,434` (fee-grossed all-in, correct for fees). CHARGE = `ticket-checkout-create/index.ts:1559` (all-in incl. tax). Gap = TAX only, on exclusive regions with `pass_tax=true`, because `compute_all_in_cents` has no tax term (F-6).

---

## Do display and charge share one engine?

**No — they diverge.** The CHARGE has one authority: the server `allInPricingEngine` (`buyer_total_cents`). The DISPLAY:
- **Business app/web:** re-derives independently from the bare base subtotal (`useCartTotals`), ignoring the per-tier `priceAllInGbp` it already fetches in `publicEventsService.fetchTickets`. Classic divergence root cause.
- **Consumer app:** derives from the server `pg_public_event_tier_allin` RPC — same fee math as the engine, but that RPC OMITS tax, so it is a *partial* shared source (fees shared, tax not).

Single minimal set of computation sites that must change (for the SPEC to scope — not decided here):
1. Business cart/display total — stop using the base subtotal as the headline Total; consume a server all-in (the `priceAllInGbp` already fetched, or the preview's `buyer_total_cents`). Sites: `CartContext.tsx:415-423`, the three `index.tsx` cart seeds, the three `payment.tsx` `displayAllIn` blocks.
2. Web CHARGE — the hosted Checkout line item must bill the grossed-up `buyer_total_cents`, not `totalCents`. Site: `ticket-checkout-create/index.ts:1086`.
3. The all-in source's TAX term — `compute_all_in_cents` / `pg_public_event_tier_allin` exclude tax; either make the all-in tax-aware or drive the display off the tax-inclusive server preview/`buyer_total_cents`. Sites: the two DB functions and/or the display's reliance on the no-tax RPC.

---

## Blast radius / cross-surface map

- **In scope (broken):** business iOS, business Android, buyer-web — all three offering types (event/trip/experience), all sharing `CartContext` + `ticket-checkout-create`.
- **In scope (partial — tax gap):** consumer iOS/Android — all three offering types, on exclusive-tax regions with pass_tax.
- **Adjacent / out of scope:** Admin Web (`mingla-admin`) — no buyer checkout. Business Web preview — non-buyer. Paystack/NGN arm shares the same `pg_public_event_tier_allin` (so the business cart bug applies to NGN too) but the Paystack charge path uses `computeConfigVat` (`ticket-checkout-create.ts:686`) — note for SPEC, not re-investigated here.
- **Recurring pattern:** display re-deriving money instead of consuming the server's single authority — the exact class ORCH-1025/1130 set out to kill; it was killed on consumer (`all_in_cents`) and on the native business *preview*, but never on the business *cart total* or the *web charge*.

---

## Invariant impact (flagged, not resolved)

- **I-PROPOSED-1130-NO-BUYER-TAX-FORM (DRAFT):** preserved — this investigation proposes no buyer tax form; the gate still passes. The fix direction (consume server all-in) does not reintroduce a form.
- **WYSIWYP / all-in (ORCH-1025/1006/1130):** currently VIOLATED on business + web (display) and on web (charge). The combined single "Fees & tax" line contract (memory `feedback_cart_combined_fees_tax_line.md`) is only honored on consumer.
- **ORCH-1034 de-GBP:** the cart still seeds `currency: ticket.currency ?? event.currency ?? "GBP"` (`index.tsx:275`) and field names carry `Gbp`. This is the SEPARATE, not-yet-started ORCH-1034 fallback — NOT the fee/tax-omission root cause. Flagged distinct per dispatch.

## Discoveries for Orchestrator (side issues)

- **D-1 (web charge under-bills the passed fee, F-4):** distinct from the display bug — it is a real revenue/economic mismatch (web buyers pay less than native buyers for the same passed-fee offering). The SPEC should explicitly cover the web CHARGE, not only the display.
- **D-2 (all-in RPC has no tax term, F-6):** affects the *consumer* (which otherwise looks correct) and any business fix that reuses `pg_public_event_tier_allin` — the tax delta will still be dropped on US/exclusive regions. Decide at SPEC whether to make the all-in tax-aware or drive display off the tax-inclusive preview.
- **D-3 (masking, F-7):** because 0/8 sellable brands pass a toggle, any TEST of the fix MUST stand up (or temporarily toggle) a charges-enabled pass-fee brand/offering — otherwise a green test proves nothing. Flag for the tester.
- **D-4 (Paystack/NGN arm):** shares the business cart display bug; its charge path is `computeConfigVat`, not the Stripe engine — confirm parity when the SPEC lands.

---

## Confidence level

**PROBABLE** (source-strong + DB-numeric-proven), capped below CONFIRMED only because a live-fire charge is unreachable without creating test data / triggering a real charge (both barred), and that unreachability is itself the masking condition (F-7). Every divergent computation site is named with verbatim file:line; the charge authority and the display derivations are both read in full; the brand-toggle dependency is numerically demonstrated against prod.

## Recommended next phase + scope (direction only — no fix proposed)

- **Next:** SPEC. Scope = make the business cart + buyer-web display the server all-in (consume the already-fetched `priceAllInGbp` and/or the tax-inclusive `buyer_total_cents` preview) across event/trip/experience on business iOS/Android/web; fix the web CHARGE line item to bill `buyer_total_cents` (D-1); decide tax-inclusivity of the all-in source for exclusive regions (D-2, also closes the consumer tax gap). Honor the single combined "Fees & tax" line. Keep ORCH-1034 GBP fallbacks OUT of scope.
- **Do NOT** re-introduce a buyer tax form (I-1130). **Do NOT** widen into ORCH-1034 currency work.
