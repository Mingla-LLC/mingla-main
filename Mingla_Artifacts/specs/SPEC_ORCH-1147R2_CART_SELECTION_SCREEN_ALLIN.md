# SPEC — ORCH-1147R2 [cart SELECTION screen still shows the bare base price, not the all-in]

**Phase:** INVESTIGATE-THEN-SPEC (forensics). **Skill:** mingla-forensics.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1147R2-[cart-selection-screen-allin]/` on branch `ORCH-1147R2-cart-selection-screen-allin` (rebased on origin/main @ `676369448`, 0 behind).
**Predecessor:** ORCH-1147 R1 (CLOSE `676369448`) — fixed the payment.tsx headline Total + combined "Fees & tax" line + seeded `unitPriceAllIn`/`allInTotal`/`feesTaxCents` into CartContext; did NOT touch the ticket-SELECTION step.
**Comms:** `COMMS_LEDGER.md` read on entry. No OPEN BLOCK row targets mingla-forensics / ORCH-1147R2 / ALL. The matching `ALL`-targeted rows (COMMS-0027/0028/0029/0031/0032/0033/0035) concern `biz_update_live_trip` migration coordination, HEIC/expo-image-manipulator native drift, and OTA cache hygiene — none touch checkout-display code; read, no action this turn.

---

## PART I — INVESTIGATION CONFIRMATION

The R1 dispatch's root cause is **CONFIRMED by code on merged-main `676369448`**. This is a display gap on the selection step, not OTA lag and not a data gap — the all-in data is present at every relevant render boundary and is simply not bound to the UI.

### Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/src/components/checkout/CartContext.tsx` | confirm the all-in fields exist (R1) and base stays base |
| 2 | `mingla-business/src/components/checkout/QuantityRow.tsx` | the business-app per-tier wrapper — does it pass the all-in? |
| 3 | `packages/event-rendering/QuantityRow.tsx` | the SHARED row the public page uses — does it already render all-in? |
| 4 | `mingla-business/src/components/event/PublicEventPage.tsx` | parity reference — how the public page feeds the all-in to the shared row |
| 5 | `mingla-business/src/store/draftEventStore.ts` (`TicketStub`) | does the stub the wrapper receives carry `priceAllInGbp`? |
| 6 | `mingla-business/app/checkout/[eventId]/index.tsx` | event selection bottom bar + QuantityRow stub seed |
| 7 | `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | trip selection bottom bar (+ `dueTodayCents` installments branch) + stub |
| 8 | `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | experience selection bottom bar + stub |
| 9 | `mingla-business/app/checkout/[eventId]/payment.tsx` | R1 reference — exact all-in + "Fees & tax" presentation to match |
| 10 | `mingla-business/src/utils/currency.ts` | `formatCurrency(value, currency, minor=false)` signature |
| 11 | `.github/scripts/strict-grep/orch-1147-cart-total-is-allin.mjs` | gate pattern to model the R2 gate on |

### Q-scorecard

**Q1 — Does the selection-step bottom bar render base or all-in?**
**Verdict: BASE — CONFIRMED (`proven`, source on merged main).** All three index.tsx bottom bars bind the displayed value AND the Continue accessibility label to `formatCurrency(totals.total, totals.currency)`. `totals.total === subtotal === Σ(unitPrice×qty)` = BASE (CartContext.tsx:478-479, `DO-NOT-REPURPOSE`).
- Event `checkout/[eventId]/index.tsx:305` (value) + `:320` (a11y label).
- Trip `checkout-trip/[tripEventId]/index.tsx:496` (value, the non-deposit branch) + `:513` (a11y label).
- Experience `checkout-experience/[experienceEventId]/index.tsx:306` (value) + `:321` (a11y label).

**Q2 — Does the per-tier QuantityRow render base or all-in?**
**Verdict: BASE — CONFIRMED (`proven`).** The mingla-business wrapper `QuantityRow.tsx` builds `ticketForPackage` (`:86-104`) with `priceGbp: ticket.priceGbp` and **omits `priceAllInGbp` entirely**. The shared `PackageQuantityRow` therefore receives no all-in and falls to its base branch (`effectivePrice = ticket.priceAllInGbp ?? ticket.priceGbp ?? 0`, `packages/event-rendering/QuantityRow.tsx:245`). The wrapper is the single dropper.

**Q3 — Is the all-in data already present at both render boundaries (i.e. is this purely a display bind, not a data gap)?**
**Verdict: YES — CONFIRMED (`proven`).** Two independent proofs:
- **Bottom bar:** `useCartTotals()` already returns `allInTotal` (Σ `unitPriceAllIn×qty`), `feesTaxCents` (= `max(0, round((allInTotal−subtotal)×100))`), and `hasFeesTaxDelta` (CartContext.tsx:439-447, 467-482). All three index files already SEED `unitPriceAllIn` into the cart on every quantity change (event `:279-280`, trip `:253` + `:460-461`, experience `:284`). The headline all-in is one field read away.
- **Per-tier:** `TicketStub` carries `priceAllInGbp?: number | null` (draftEventStore.ts:94). The stubs the wrapper receives already populate it: event passes the live `ticket` (which has it), trip `tierToTicketStub` sets `priceAllInGbp: tier.priceAllInGbp ?? null` (index.tsx:72), experience `ticketToStub` sets `priceAllInGbp: ticket.priceAllInGbp ?? null` (index.tsx:57). The wrapper just doesn't forward it into `ticketForPackage`.

**Q4 — Does the PUBLIC page (the reference) prove the desired presentation is already a solved pattern?**
**Verdict: YES — CONFIRMED (`proven`).** The public page's `mapTicket` threads `priceAllInGbp: t.priceAllInGbp ?? null` into the SAME shared `PackageQuantityRow` (PublicEventPage.tsx:84-87). That row then renders the all-in number + a quiet "incl. VAT & fees" caption when `priceAllInGbp > priceGbp` (`packages/event-rendering/QuantityRow.tsx:245-255, 399-401`). The selection screen shows base ONLY because the business wrapper drops the field the public path forwards.

**Q5 — Did R1 already make the payment step correct (so R2 must not double-change it)?**
**Verdict: YES — CONFIRMED (`proven`).** `payment.tsx` (all three) source the headline from `totals.allInTotal` → `allInFloorCents` → `displayAllIn`, render the combined "Fees & tax" line off `feesTaxLineCents`, and bind Pay + a11y to `displayAllIn` (event payment.tsx:569-582, 645-720). R2 does NOT touch any payment.tsx.

### Findings (six-field)

**F-1 — Selection bottom bar binds the headline number + Continue a11y to the bare base. CONFIRMED ROOT CAUSE.**
1. **Symptom:** "Get tickets · Select your tickets · 1 OF 3" shows `$65` while the public page shows `$67.93`; Seth screenshotted twice.
2. **Layer:** code (RN component).
3. **Probe:** `grep -n "totals\.total\|formatCurrency\|Subtotal" app/checkout/[eventId]/index.tsx` (+ trip + experience).
4. **Evidence:** event `index.tsx:299` `<Text>Subtotal</Text>` / `:305` `formatCurrency(totals.total, totals.currency)` / `:320` `…total ${formatCurrency(totals.total, …)}`. Trip `:484-496` (label "Subtotal" / value `totals.total` in the non-deposit branch) / `:513` a11y. Experience `:300/:306/:321`. CartContext.tsx:478-479 `subtotal/total = Σ(unitPrice×qty)` (base).
5. **Mechanism:** the bottom bar reads `totals.total` (deliberately base) instead of `totals.allInTotal` (the R1 all-in) → the buyer sees base on the lead screen, contradicting the public page's all-in.
6. **Severity:** `CONFIRMED ROOT CAUSE`.

**F-2 — The business-app QuantityRow wrapper drops `priceAllInGbp`. CONFIRMED ROOT CAUSE (per-tier).**
1. **Symptom:** per-tier row shows `$65` not `$67.93`; no "incl. VAT & fees" caption (the public row has both).
2. **Layer:** code.
3. **Probe:** read `mingla-business/src/components/checkout/QuantityRow.tsx:86-104`; compare to `PublicEventPage.tsx:80-88`.
4. **Evidence:** wrapper `ticketForPackage` memo sets `priceGbp: ticket.priceGbp` and has NO `priceAllInGbp` key (`:90`). The shared row supports it (`packages/event-rendering/QuantityRow.tsx:66, 245, 251-255, 399-401`). The stub already carries it (`TicketStub.priceAllInGbp`, draftEventStore.ts:94; populated by all three index seeds).
5. **Mechanism:** the wrapper omits one field on the adapter object → shared row falls to its base branch → per-tier base shown.
6. **Severity:** `CONFIRMED ROOT CAUSE`.

**F-3 — R1 fields exist and are correctly base/all-in separated. RULED OUT as a defect (this is the enabler).**
1. **Symptom:** none (positive finding).
2. **Layer:** code.
3. **Probe:** read CartContext.tsx:421-489.
4. **Evidence:** `allInTotal`, `feesTaxCents`, `hasFeesTaxDelta` exist; `subtotal/total` keep base meaning with a `DO-NOT-REPURPOSE` comment (`:426-431`).
5. **Mechanism:** R2 reads these existing fields; no engine/math change.
6. **Severity:** `RULED OUT` (no defect — the data is present, only the bind is missing).

### Five-truth-layer reconciliation

| Layer | Reads as | Contradiction? |
|-------|----------|----------------|
| Docs | `feedback_cart_combined_fees_tax_line` (ONE combined line); R1 IMPLEMENTATION report says payment step done, selection NOT in scope | none — confirms R2 is the open follow-on |
| Schema | `pg_public_event_tier_allin` is the per-tier all-in authority; unchanged | none — R2 touches no SQL |
| Code | selection binds `totals.total` (base); wrapper drops `priceAllInGbp` | **THIS IS THE BUG (F-1/F-2)** vs payment.tsx already binding `allInTotal` |
| Runtime | not live-fired this pass (see below) | n/a |
| Data | `allInTotal`/`unitPriceAllIn`/`priceAllInGbp` all populated on pass-fee tiers; 0/8 prod brands pass a fee today | masking gotcha for the tester (synthetic fixture required) |

### Repro evidence

**Not live-fired this pass (source-confirmed only).** Rationale exemption: the defect is a static display bind proven by reading merged-main source at exact lines, and a runtime repro requires a SYNTHETIC pass-fee charges-enabled brand fixture (0/8 prod brands pass a fee → base==all-in on all prod data, so a sim run on prod data would render `$65 == $65` and prove nothing — the same masking gotcha R1's tester flagged). Confidence is `proven` for the source bind (the lines are unambiguous and match the screenshot symptom exactly) and the runtime visual proof is the downstream tester's job on the synthetic fixture. No fix proposed in this section.

### Blast radius / cross-surface map

- **In scope (selection step display only):** business iOS, business Android, buyer/anon Web — all three offering types (event/trip/experience), via the 3 `index.tsx` bottom bars + the one shared business `QuantityRow.tsx` wrapper. Web and native share these RN files, so parity is automatic except where the trip deposit branch differs (manual care, see SPEC §4).
- **Out of scope:** consumer app-mobile (its own `TicketCartSheet`, already all-in — F-5 in R1); admin web + business-web preview (non-buyer); the payment step (R1, correct — must not be re-touched); the money engine / RPCs / edge functions (unchanged).

### Invariant impact

- Preserves `I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN` (DRAFT) — extends its reach from payment to selection.
- Preserves `orch-1130-no-buyer-tax-form` (no buyer tax form added).
- Establishes new DRAFT `I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN` (see SPEC §6).

### Discoveries for orchestrator

- **OQ-2 (US/NG exclusive-tax) stays PARKED** — `priceAllInGbp` folds fees but excludes tax in exclusive-tax regions; identical residual to R1, zero blast today (all charges-enabled brands inclusive GB/EU/CH). Do not fix here.
- **Tester masking gotcha (mandatory):** a green visual test on prod data is non-probative — needs a synthetic pass-fee charges-enabled fixture so base ≠ all-in. Carry forward from R1.

### Confidence

`proven` (source) for F-1/F-2/F-3 on merged-main `676369448`; runtime visual proof deferred to the tester on a synthetic pass-fee fixture. Recommended next phase: **IMPLEMENT** the SPEC below (display-only, ~scoped files), then **TEST** on the synthetic fixture across all three types × 3 surfaces.

---

## PART II — BUILD SPEC (11 sections)

### 1. Executive summary

The business-app ticket-SELECTION step ("Get tickets · Select your tickets · 1 OF 3") must lead with the TRUE all-in price — the same `$67.93` the public page shows — instead of the bare base `$65`. R1 already computed and stored the all-in (`allInTotal`, `feesTaxCents`, per-tier `priceAllInGbp`) and uses it on the payment step; R2 simply BINDS the existing all-in data to the selection screen's two display surfaces (the sticky bottom bar and the per-tier QuantityRow), with the single combined "Fees & tax" line gated on a real delta. No new math, no engine change, no payment-step change.

### 2. Scope & non-goals

**In scope:**
- The selection bottom bar (the headline number + the Continue button's accessibility label) → all-in.
- An optional small "Fees & tax" breakdown line in the bottom bar, gated on `feesTaxCents > 0`.
- The per-tier QuantityRow price → all-in per unit, via threading `priceAllInGbp` through the business wrapper.
- All three offering types: event / trip / experience selection index screens + the one shared business `QuantityRow.tsx` wrapper.

**Non-goals (explicit):**
- The payment step (`payment.tsx` ×3) — correct from R1, MUST NOT be touched.
- The money engine, `pg_public_event_tier_allin`, `compute_all_in_cents`, any RPC/edge function/migration — unchanged.
- `useCartTotals.total`/`.subtotal` semantics — STAY base (`DO-NOT-REPURPOSE`). R2 READS `allInTotal`/`priceAllInGbp`; it never repurposes base.
- The trip **installments "Due today" deposit branch** — that is a separate Seth-binding truth (`dueTodayCents`); R2 swaps ONLY the non-deposit "full total" branch to all-in and leaves the deposit branch exactly as-is.
- OQ-2 (US/NG exclusive-tax residual) — PARKED.
- The shared `packages/event-rendering/QuantityRow.tsx` — already correct (renders all-in when fed `priceAllInGbp`); NOT touched.

**Assumptions:** the all-in fields populated by R1 are present at runtime for all three types (proven by source); free / RPC-miss tiers carry `priceAllInGbp == null` → fall back to base with `feesTaxCents == 0` (no fabrication).

### 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched there | Parity |
|---|---------|---------|--------------------------------|---------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | already all-in (own `TicketCartSheet`) | none | — |
| 2 | Consumer Android (`app-mobile`) | NO | same | none | — |
| 3 | Buyer / anon Web (`mingla-business` `/checkout/*`) | YES | selection bottom bar + per-tier row show all-in; "Fees & tax" line when delta>0 | the 3 `index.tsx` + `QuantityRow.tsx` wrapper | Auto (shared RN), except the trip deposit branch (manual, §4) |
| 4 | Business iOS | YES | same | same | Auto via shared CartContext + wrapper |
| 5 | Business Android | YES | same | same | Auto (shared RN) |
| 6 | Admin Web | NO | no buyer checkout surface | none | — |
| 7 | Business Web preview | NO | non-buyer surface | none | — |

Manual-parity note: the trip selection bottom bar has TWO branches (full-total vs installments deposit). R2 changes ONLY the full-total branch to all-in; the deposit branch is unchanged. This is the single manual-care point.

### 4. Layered specification

Only the **Component** layer is touched. No DB / edge / service / hook / realtime changes.

#### 4.1 Component — business `QuantityRow.tsx` wrapper (per-tier all-in)

**File:** `mingla-business/src/components/checkout/QuantityRow.tsx`
**Change:** in the `ticketForPackage` memo (`:86-104`), add the all-in field so the shared row receives it:
```ts
priceAllInGbp: ticket.priceAllInGbp ?? null,
```
inserted alongside `priceGbp: ticket.priceGbp` (the shared `QuantityRowTicket` already declares `priceAllInGbp?: number | null` at `packages/event-rendering/QuantityRow.tsx:66`). Add `ticket.priceAllInGbp` to the memo dependency note only if lint requires (the memo deps on `[ticket]`, so no new dep entry needed — the whole `ticket` is already a dep).
**Resulting behavior (no further change needed):** the shared row already computes `effectivePrice = ticket.priceAllInGbp ?? ticket.priceGbp ?? 0` and renders the quiet "incl. VAT & fees" caption when `priceAllInGbp > priceGbp` — exact parity with the public page. Free / null all-in → base, no caption (existing behavior).
**States:** unchanged (sale window, capacity, sold-out, waitlist all preserved — this is a single added field on the adapter object). Free tier: `isFree` → "Free" (shared row, unchanged).

#### 4.2 Component — event selection bottom bar

**File:** `mingla-business/app/checkout/[eventId]/index.tsx`
**RECOMMENDED presentation — lead with the all-in Total, with the combined "Fees & tax" line when there's a delta** (matches the public page's lead-with-all-in feel and `feedback_cart_combined_fees_tax_line`):

Replace the single base "Subtotal" row (`:298-307`) with a two-or-three-row block. Derive once near the existing `totals` read:
```ts
const showFeesTaxLine = !totals.isEmpty && !totals.isFree && totals.hasFeesTaxDelta;
const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency);
```
Render:
- WHEN `showFeesTaxLine` (a real pass-fee delta): show a small two-line breakdown —
  - row "Fees & tax" → `formatCurrency(totals.feesTaxCents, totals.currency, true)` (the `true` = minor units; `feesTaxCents` is cents), styled as a secondary/tertiary small row;
  - row "Total" → `headlineAllIn`, as the prominent headline value (re-use `subtotalValue` style; relabel "Subtotal" → "Total").
- ELSE (no delta — absorb / free / empty): a single row labeled **"Total"** with value = `headlineAllIn` (or "Free"/"—" for the free/empty branches, unchanged). Do NOT show a "Fees & tax" line when `feesTaxCents == 0` (no zero-fee noise).

The empty (`totals.isEmpty → "—"`) and free (`totals.isFree → "Free"`) branches stay as-is; only the populated paid branch changes from `formatCurrency(totals.total, …)` to `headlineAllIn`. The label changes from "Subtotal" to "Total" so the lead number is honestly the all-in (it no longer is a pre-fee subtotal).

**Continue a11y label (`:315-321`):** the populated-paid branch changes from
`…total ${formatCurrency(totals.total, totals.currency)}` → `…total ${headlineAllIn}` (free/empty branches unchanged).

#### 4.3 Component — experience selection bottom bar

**File:** `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx`
Identical change to §4.2 (no installments branch). Bottom-bar value (`:301-307`) populated-paid branch → `headlineAllIn`; relabel "Subtotal" → "Total"; add the `showFeesTaxLine` "Fees & tax" row; a11y label (`:316-322`) populated-paid branch → `headlineAllIn`.

#### 4.4 Component — trip selection bottom bar (installments-aware)

**File:** `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`
The trip bar has the extra `dueTodayCents` deposit branch (`:150-170`, render `:483-514`). Change ONLY the **full-total** (non-deposit) leg:
- Value (`:489-496`): the `dueTodayCents !== null ? formatCurrency(dueTodayCents, …, true)` deposit branch is **unchanged**; the trailing `: formatCurrency(totals.total, totals.currency)` full-total branch → `: headlineAllIn`.
- Label (`:483-488`): when the deposit branch is active the label stays "Due today" (unchanged); the else label "Subtotal" → "Total".
- a11y (`:506-514`): deposit branch (`due today …`) unchanged; full-total branch `…total ${formatCurrency(totals.total, …)}` → `…total ${headlineAllIn}`.
- "Fees & tax" line: show it under the SAME gate as event/experience BUT only on the full-total path — i.e. `showFeesTaxLine = !totals.isEmpty && !totals.isFree && totals.hasFeesTaxDelta && dueTodayCents === null`. When the deposit branch is active, do NOT add a Fees & tax line (the deposit is a partial figure with its own semantics; keep R2 strictly to the full-total presentation). The deposit branch's all-in accuracy is out of scope for R2 (it is governed by the R1/ORCH-1130 deposit logic, untouched).

#### 4.5 Shared styles

Each index file already has `subtotalRow` / `subtotalLabel` / `subtotalValue`. Add ONE small style per file for the secondary "Fees & tax" row (e.g. `feesTaxRow` mirroring `subtotalRow` with `marginBottom: spacing.xs`, label/value at `textTokens.tertiary`, smaller font) — or reuse `subtotalLabel`/value at a tertiary tint. Keep visual weight: Total is the prominent number; "Fees & tax" is the quiet line above it. No new design tokens; reuse the existing checkout spacing/text tokens (matches payment.tsx's `summaryFeesTaxRow` treatment).

### 5. Success criteria (per-surface where parity is manual)

- **SC-1 (event):** On a pass-fee event, the selection bottom-bar headline value == `formatCurrency(allInTotal)` (e.g. `$67.93`), NOT `totals.total` base (`$65`); label reads "Total".
  - SC-1-iOS / SC-1-Android / SC-1-Web: identical (shared RN).
- **SC-2 (trip):** On a pass-fee trip in pay-in-full, the full-total branch shows the all-in; in installments the "Due today" deposit branch is UNCHANGED (deposit figure, label "Due today", no Fees & tax line).
- **SC-3 (experience):** Same as SC-1 for the experience selection screen.
- **SC-4 (per-tier, all 3 types):** Each QuantityRow price == the tier's all-in (`priceAllInGbp`) when present (e.g. `$67.93`), with the quiet "incl. VAT & fees" caption; falls to base + no caption when `priceAllInGbp` is null/free. Identical to the public page.
- **SC-5 (combined Fees & tax line):** When `feesTaxCents > 0` the bottom bar shows exactly ONE line labeled "Fees & tax" = `formatCurrency(feesTaxCents, currency, true)`; never split into service-fee + VAT (`feedback_cart_combined_fees_tax_line`). When `feesTaxCents == 0` (absorb / free) NO such line renders and Total == base (no regression).
- **SC-6 (Continue a11y):** The Continue button's accessibility label uses the all-in (full-total branch); free/empty/deposit branches unchanged.
- **SC-7 (no payment-step regression):** `payment.tsx` ×3 are byte-unchanged; the payment headline + Fees & tax line stay correct (R1).
- **SC-8 (no buyer tax form):** `orch-1130-no-buyer-tax-form.mjs` stays GREEN.
- **SC-9 (base not repurposed):** `useCartTotals.total`/`.subtotal` are still base; the per-line "Tickets" recap on the payment step (which reads `l.unitPrice`) is unaffected.

### 6. Invariants

- **NEW — `I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN` (DRAFT; flips ACTIVE on CLOSE by the orchestrator):** the three business checkout SELECTION index screens' bottom-bar headline value + Continue a11y label MUST bind the displayed full-total to the server all-in (`totals.allInTotal`), NOT the bare base (`totals.total`/`totals.subtotal`); AND the business `QuantityRow.tsx` wrapper MUST forward `priceAllInGbp` into the shared row. Enforced by the strict-grep gate `orch-1147r2-selection-shows-allin.mjs` (§9). (Trip's installments deposit branch — `dueTodayCents` — is explicitly exempt.)
- **PRESERVES `I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN` (DRAFT)** — extends its reach from payment to selection; the R1 payment gate stays GREEN.
- **PRESERVES `orch-1130-no-buyer-tax-form`** — no buyer tax form introduced.
- **PRESERVES `feedback_cart_combined_fees_tax_line`** — one combined "Fees & tax" line, never split.

### 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy, event) | pass-fee event, 1×$65 tier (all-in $67.93) | seed `unitPriceAllIn=67.93`, `priceAllInGbp=67.93` | bottom-bar Total == $67.93; "Fees & tax" line == $2.93; per-tier row $67.93 + "incl. VAT & fees" | component/source |
| T-2 (happy, trip pay-in-full) | pass-fee trip, full | `paymentPlanChoice="full"` | full-total branch == all-in; "Fees & tax" shown | component |
| T-3 (edge, trip installments) | pass-fee trip, installments | `paymentPlanChoice="installments"`, `dueTodayCents` set | "Due today" deposit branch UNCHANGED; NO Fees & tax line | component |
| T-4 (happy, experience) | pass-fee experience | `priceAllInGbp` set | bottom-bar Total + per-tier == all-in | component |
| T-5 (edge, absorb) | absorb-all event (all-in == base) | `unitPriceAllIn==unitPrice` | Total == base; NO Fees & tax line; no per-tier caption | component |
| T-6 (edge, free) | free tier | `isFree` | "Free"; no fees line; no caption | component |
| T-7 (edge, RPC miss) | tier with null `priceAllInGbp` | `priceAllInGbp=null` | per-tier falls to base, no caption; bottom-bar all-in == base for that tier (no fabrication) | component |
| T-8 (a11y) | pass-fee event | as T-1 | Continue a11y label contains the all-in string, not base | component |
| T-9 (fails-on-revert, gate) | revert the bind | rebind bottom bar to `totals.total` / drop `priceAllInGbp` from wrapper | gate EXIT=1 | CI strict-grep |
| T-10 (tester adversarial) | synthetic pass-fee charges-enabled fixture on device | real brand passing fee | selection screen on business iOS+Android+web for event/trip/experience shows all-in matching the public page; base==all-in prod brand renders cleanly (no double-charge, no fabricated delta) | runtime/device |

### 8. Implementation order

1. `mingla-business/src/components/checkout/QuantityRow.tsx` — add `priceAllInGbp: ticket.priceAllInGbp ?? null` to `ticketForPackage` (§4.1). (Fixes per-tier on all 3 types at once.)
2. `mingla-business/app/checkout/[eventId]/index.tsx` — bottom bar → all-in + Fees & tax line + a11y (§4.2) + `feesTaxRow` style.
3. `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` — same (§4.3).
4. `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` — full-total branch → all-in, deposit branch untouched, gated Fees & tax line (§4.4).
5. Add the Step-0.5 test `orch_1147r2_selection_allin.test.ts` (§7 T-1..T-8) + extend the tester adversarial test (T-10 stub).
6. Add the strict-grep gate `orch-1147r2-selection-shows-allin.mjs` + register it in `.github/workflows/strict-grep-mingla-business.yml`.

### 9. Regression prevention (fails-on-revert)

**Structural safeguard:** strict-grep gate `.github/scripts/strict-grep/orch-1147r2-selection-shows-allin.mjs`, modeled on `orch-1147-cart-total-is-allin.mjs` (comment-stripping + `--self-test`). It FAILS (EXIT=1) if any of:
- (a) any of the 3 `index.tsx` bottom-bar files does NOT reference `totals.allInTotal`; OR
- (b) any binds the populated-paid headline value or Continue a11y directly to the bare base in the **full-total branch** (`formatCurrency(totals.total …)` / `totals.subtotal`) — the gate must allow the trip deposit branch (`dueTodayCents`) which legitimately uses neither; key the check on "an `allInTotal` reference exists AND no `totals.total`-bound headline remains outside a `dueTodayCents` guard"; OR
- (c) `mingla-business/src/components/checkout/QuantityRow.tsx` does NOT forward `priceAllInGbp` into `ticketForPackage`.
**Plus** the happy-path Step-0.5 test (T-1..T-8) which the implementor MUST prove fails-on-revert by TRUE LINE DELETION (not comment-out): delete the `priceAllInGbp` forward → T-1/T-4 per-tier assertions fail; rebind a bottom bar to `totals.total` → that type's headline assertion fails; restore → all green. Protective comment at each changed site cites `I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN` + "selection leads with all-in to match the public page (ORCH-1147R2)".

### 10. Open questions

- **OQ-R2-1 (presentation, RECOMMENDED resolved):** lead with the all-in **Total** + a quiet "Fees & tax" line when `feesTaxCents > 0`, relabeling the old "Subtotal" to "Total". This matches the public page's lead-with-all-in feel and `feedback_cart_combined_fees_tax_line`. (Recommended in §4; implementor builds this unless Seth overrides.) Alternative considered and rejected: keeping "Subtotal / Fees & tax / Total" three-row breakdown always-visible — rejected because the public page leads with the single all-in number, and a permanent zero-fee "Fees & tax: $0.00" row is noise on the 0/8 absorb-brands.
- **OQ-R2-2 (PARKED, do not resolve):** US/NG exclusive-tax residual — identical to R1's OQ-2; `priceAllInGbp` folds fees but not exclusive tax. Zero blast today. PARKED per dispatch.

### 11. Downstream routing

NEXT = **mingla-implementor** (business side) in this worktree → build §4 in the §8 order, add the §7 test + §9 gate, prove fails-on-revert, write the IMPLEMENTATION report. THEN = **mingla-tester** → device-verify all three offering types on business iOS + Android + buyer-web on a SYNTHETIC pass-fee charges-enabled fixture (a green run on prod data is non-probative — 0/8 brands pass a fee). THEN = **mingla-orchestrator** CLOSE → flip `I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN` ACTIVE, OTA the business app (pure RN/JS, runtime 1.0.0), commit the tester test before merge.

### Scoped allowlist (implementor may change ONLY these)

- `mingla-business/src/components/checkout/QuantityRow.tsx`
- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`
- `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx`
- `mingla-business/src/components/checkout/__tests__/orch_1147r2_selection_allin.test.ts` (NEW)
- `.github/scripts/strict-grep/orch-1147r2-selection-shows-allin.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (gate registration only)

### DO-NOT-TOUCH

- `mingla-business/app/checkout/**/payment.tsx` (all 3) — R1, correct, byte-frozen.
- `mingla-business/src/components/checkout/CartContext.tsx` — the all-in fields already exist; `total`/`subtotal` stay base. (READ only.)
- `packages/event-rendering/QuantityRow.tsx` — shared row already renders all-in; not touched.
- The trip installments deposit logic (`dueTodayCents` derivation, `projectInstallmentSchedule`) — only the full-total render branch changes.
- Any RPC / migration / edge function / `compute_all_in_cents` / `pg_public_event_tier_allin` — unchanged. No ORCH-1034 GBP fallbacks reintroduced. OQ-2 parked.

Stop-and-amend (request a SPEC amendment) before touching anything outside the allowlist.
