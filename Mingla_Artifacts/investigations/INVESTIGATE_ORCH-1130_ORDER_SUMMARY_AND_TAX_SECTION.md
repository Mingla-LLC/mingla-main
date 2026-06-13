# INVESTIGATE — ORCH-1130 — Trip-checkout order-summary "due today" + vestigial Calculate-tax section

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on branch `ORCH-1130-trip-pay-structure` (commit `d3fc65037`).
**Mode:** INVESTIGATE (read-only). No fix proposed; direction only.
**Date:** 2026-06-13.
**Comms ledger:** Read. No BLOCK/OPEN row targeting forensics or ORCH-1130. Relevant context-only rows: COMMS-0013 (web vs native tax basis differ — FEE unified, TAX not), COMMS-0014/0016 (experience/trip checkout routes through `ticket-checkout-create`, the all-in engine). No new cross-ORCH discovery to register.

---

## Symptom summary (expected vs actual)

**Issue #1.** When the buyer selects "Pay over time", the order-summary box on **buyer.tsx** ("Your details") and **payment.tsx** ("Review & pay") still shows the FULL amount as **Total**. Expected: BOTH a **Total** (full price) AND a **Total due today** (deposit) as distinct, clearly-labeled lines. Pay-in-full / no-plan: unchanged.

**Issue #2.** On the trip checkout as an ANONYMOUS buyer (native), Seth still sees a "Calculate tax" section with a billing-address form. Expected (per the MINGLA-WIDE all-in policy): buyer never types an address or taps "Calculate tax"; the all-in total (incl. tax) is shown upfront.

---

## Investigation manifest (files read, in trace order)

1. `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` — Issue #1 step 1 order-summary.
2. `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` — Issue #1 step 2 order-summary + Issue #2 tax section.
3. `mingla-business/src/components/checkout/CartTaxPreview.tsx` — the "Calculate tax" / billing-address component (Issue #2).
4. `mingla-business/app/checkout/[eventId]/payment.tsx` — EVENT-side comparison (ownership tell for Issue #2).
5. `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` (greps) — the existing `dueTodayCents` source-of-truth.
6. `mingla-business/src/utils/installmentScheduleProjection.ts` (greps) — projection util shape.
7. `supabase/functions/ticket-checkout-create/index.ts` (greps) — server-side tax basis (safe-to-remove gate).
8. Git history: ORCH-1025 PR #291 (`2966406d0`), CartTaxPreview blame, event/trip payment blame.

---

## Q-scorecard

- **Q1 — Where does buyer.tsx render Total, and is a deposit available there?** Verdict (proven, source): order-summary Total at `buyer.tsx:464-469` and sticky-bar Total at `buyer.tsx:606-611` both read `totals.total`. No deposit value is computed on this step — the installment projection was deliberately removed (`buyer.tsx:178-180`). The inputs to recompute it (`trip` via `usePublicTripById:173-174`, `lines`, `paymentPlanChoice` from `useCart`) ARE present. → F-1.
- **Q2 — Where does payment.tsx render Total, and is a deposit available there?** Verdict (proven, source): order-summary Total at `payment.tsx:643-648` and sticky-bar Total at `payment.tsx:767-772` both read `displayTotalCents` (= full total). The deposit is ALREADY in scope as `projectedSchedule.depositCents` (`payment.tsx:132-155`) — used by the Pay button (784-791) and pre-Stripe banner (718-749) but NOT by the order-summary box. → F-2.
- **Q3 — What is the Calculate-tax section in the trip path, exactly?** Verdict (proven, source): `<CartTaxPreview>` rendered native-only at `payment.tsx:668-681`; the component renders the "BILLING ADDRESS" label + 6-field address form + "Calculate tax" button (`CartTaxPreview.tsx:165-245`). buyer.tsx has NO tax/address UI — Issue #2 lives only on payment.tsx. → F-3.
- **Q4 — Why does it still show for trips: never-migrated, or regressed?** Verdict (proven, git): pre-existing never-migrated gap. ORCH-1025 PR #291 (`2966406d0`) deleted ONLY `app-mobile/.../checkout/CartTaxPreview.tsx` (consumer) — `git show --stat 2966406d0` touches `mingla-business` in **0** files. The mingla-business `CartTaxPreview.tsx` was last touched by ORCH-0955 (`0c1b637ce`, 2026-05-25) and never since. The EVENT-side `app/checkout/[eventId]/payment.tsx:579-592` renders the IDENTICAL `CartTaxPreview` with identical gating — so the section is a SHARED business-app pre-existing pattern, present on BOTH event and trip native checkout. → F-3.
- **Q5 — Is removing the tax section SAFE (tax still charged)?** Verdict (proven, source): SAFE. `ticket-checkout-create/index.ts` already computes tax **venue-sourced server-side** with NO buyer address — ORCH-1006 Slice 2 deleted the address-required/invalid gates (lines 106-107, 226, 269-271) and the preview path "always computes the full venue-sourced all-in with NO buyer address (WYSIWYP)" (lines 560-562). Tax basis = `events.venue_tax_address` (lines 56-58, 1347-1352). The address the form collects is **ignored** by the server. → F-4.
- **Q6 — Ownership of each issue: pre-existing or ORCH-1130 regression?** Verdict: Issue #1 is an ORCH-1130 INCOMPLETENESS (1130 added due-today to the index Subtotal + Pay button but did not extend it to the order-summary boxes). Issue #2 is a PRE-EXISTING never-migrated gap (predates 1130 by ~3 weeks; shared with event checkout). → F-2, F-3.

---

## Findings (six-field evidence)

### F-1 — buyer.tsx order-summary + sticky bar show full total only, no due-today line
1. **Symptom.** "Pay over time" selected → "Your details" order-summary box shows full Total only.
2. **Layer.** Code (component).
3. **Probe.** Read `buyer.tsx` verbatim.
4. **Evidence.** Order-summary Total — `buyer.tsx:464-469`:
   ```tsx
   <View style={styles.summaryTotalRow}>
     <Text style={styles.summaryTotalLabel}>Total</Text>
     <Text style={styles.summaryTotalValue}>
       {totals.isFree ? "Free" : formatCurrency(totals.total, totals.currency)}
     </Text>
   </View>
   ```
   Sticky bar Total — `buyer.tsx:606-611` (same `totals.total`). The passive installment projection was REMOVED on this step (`buyer.tsx:178-180`). `paymentPlanChoice` is NOT read here at all. `usePublicTripById` (`:173-174`) + `lines` + `useCart().paymentPlanChoice` are all available.
5. **Mechanism.** buyer.tsx has no deposit memo and renders `totals.total` unconditionally → buyer paying over time never sees the amount due today on this step.
6. **Severity.** `CONFIRMED ROOT CAUSE` (Issue #1, buyer.tsx leg).

### F-2 — payment.tsx order-summary + sticky bar show full total despite deposit being in scope
1. **Symptom.** "Pay over time" selected → "Review & pay" order-summary box shows full Total only (the deposit shows only in the Pay button + banner).
2. **Layer.** Code (component).
3. **Probe.** Read `payment.tsx` verbatim.
4. **Evidence.** Order-summary Total — `payment.tsx:643-648`:
   ```tsx
   <View style={styles.summaryTotalRow}>
     <Text style={styles.summaryTotalLabel}>Total</Text>
     <Text style={styles.summaryTotalValue}>
       {formatCurrency(displayTotalCents, totals.currency)}
     </Text>
   </View>
   ```
   Sticky bar Total — `payment.tsx:767-772` (same). The deposit is ALREADY computed: `projectedSchedule` (`:132-155`) returns `{ fullPriceCents, depositCents, currency }` from `projectInstallmentSchedule(...)`, `isUsingInstallments` (`:156`) is `isPlanActive && paymentPlanChoice === "installments"`. The Pay button reads `projectedSchedule.depositCents` (`:784-791`) and the pre-Stripe banner reads it (`:718-749`) — but the order-summary box does not.
5. **Mechanism.** The order-summary box renders `displayTotalCents` (full) regardless of `isUsingInstallments`; the deposit value exists in the same component scope but is not surfaced there → buyer paying over time sees a full Total in the recap that contradicts the "charged {deposit} today" banner directly below it.
6. **Severity.** `CONFIRMED ROOT CAUSE` (Issue #1, payment.tsx leg).

### F-3 — Vestigial "Calculate tax" billing-address section on trip (and event) native payment
1. **Symptom.** Anonymous native buyer sees "BILLING ADDRESS" + 6-field form + "Calculate tax" button.
2. **Layer.** Code (component) + git (ownership).
3. **Probe.** Read `payment.tsx:668-681`, `CartTaxPreview.tsx`, `app/checkout/[eventId]/payment.tsx`; `git show --stat 2966406d0`; `git log` on CartTaxPreview.
4. **Evidence.** Trip render — `payment.tsx:668-681` `Platform.OS !== "web"` → `<CartTaxPreview eventId={tripEventId} ... />`. Component — `CartTaxPreview.tsx:167` `<Text>BILLING ADDRESS</Text>`, `:168-231` address inputs, `:232-245` `accessibilityLabel="Calculate tax"` button. Pay is HARD-GATED on it: `payment.tsx:301-304` + `:376-379` `setPaymentError("Calculate tax before paying.")`; button `disabled` `:800-801` `(Platform.OS !== "web" && taxPreview === null)`. EVENT parity — `app/checkout/[eventId]/payment.tsx:579-592` renders the SAME `CartTaxPreview` with the SAME gating (`:270-273`, `:353-356`, `:642-643`). Git — ORCH-1025 `2966406d0` `--stat`: only `app-mobile/.../CartTaxPreview.tsx | 300 ---` deleted; `grep -c mingla-business` = **0**. mingla-business `CartTaxPreview.tsx` last touched by ORCH-0955 `0c1b637ce` (2026-05-25), untouched since.
5. **Mechanism.** ORCH-1025's all-in removal was scoped to the CONSUMER app-mobile cart only; the mingla-business native checkout (events AND trips) was never migrated, so the pre-all-in address/Calculate-tax form persists on both. The trip chain (ORCH-0876, a mirror of event payment.tsx) inherited the form by design parity.
6. **Severity.** `CONFIRMED ROOT CAUSE` (Issue #2) — pre-existing, never-migrated; NOT an ORCH-1130 regression.

### F-4 — Server already computes tax venue-sourced with NO buyer address → form is purely vestigial → removal is SAFE
1. **Symptom.** N/A (positive finding establishing safety).
2. **Layer.** Code (edge function).
3. **Probe.** `grep -nE "preview|address|venue|venue_tax_address|automatic_tax" supabase/functions/ticket-checkout-create/index.ts`.
4. **Evidence.** `index.ts:56-58` "the buyer never types an address in the native flow. The tax basis is events.venue_tax_address". `:106-107` "the native flow no longer captures or validates a buyer address." `:226` / `:269-271` ORCH-1006 Slice 2 — "native create/preview no longer gate on a buyer address. The address-required + address-invalid gates are DELETED." `:560-562` "Preview now always computes the full venue-sourced all-in with NO buyer address (WYSIWYP)." `:1347-1352` tax basis = venue_tax_address. Web path uses Stripe `automatic_tax.enabled:true` on the hosted page (`:1102-1120`), independent of this form. `CartTaxPreview.tsx:123-137` posts `mode:"preview"` with `buyer.address` — but per the server comments that address is ignored; the venue-sourced total is returned regardless.
5. **Mechanism.** The address the form collects is dead input server-side; tax is already in the returned all-in total without it. Removing the form does NOT drop tax from the charge — the all-in engine continues to compute venue-sourced tax. The only coupling to remove is the client-side `taxPreview`-gate on the Pay button (which currently blocks payment until the buyer fills the now-vestigial form); the native create call must still obtain the all-in total/`taxCalculationId` via a no-address preview (the server already supports `mode:"preview"` with no address).
6. **Severity.** `SECONDARY ROOT CAUSE` / safety confirmation for Issue #2 — **SAFE TO REMOVE** (tax stays server-side).

---

## Five-Truth-Layer reconciliation

| Layer | Issue #1 | Issue #2 |
|-------|----------|----------|
| **Docs** | MEMORY: due-today must surface; ORCH-1130 ADDENDUM made Pay button = due-today | MEMORY: MINGLA-WIDE all-in, buyer never types address/taps Calculate-tax (ORCH-1025/1006) |
| **Schema** | n/a | `events.venue_tax_address` is the tax basis (server) |
| **Code** | buyer/payment order-summary render `totals.total`/`displayTotalCents` (full) | mingla-business `CartTaxPreview` still mounted native-only; server ignores its address |
| **Runtime** | not live-fired (see below) — source-proven contradiction with the deposit banner | not live-fired — but Seth device-confirmed the form is visible |
| **Data** | n/a | venue-sourced tax computed regardless of form input |

**Contradiction flagged (Issue #1, payment.tsx):** the order-summary "Total" (full) sits directly above the banner that says "You'll be charged {deposit} today" — same screen, two different load-bearing numbers, the recap being the misleading one. Code holds the truth that the box was simply never updated.

**Contradiction flagged (Issue #2):** Docs (all-in, no address) vs Code (address form still mounted in business app). Docs hold the product truth; the code is stale because the migration never reached mingla-business. Server (venue-sourced tax) already matches Docs.

---

## Repro evidence

**Not live-fired on simulator.** Both issues are source-proven from verbatim reads + git `--stat`, and Seth device-confirmed Issue #2's visibility and Issue #1's full-amount display in the dispatch. Issue #1 is a pure render-binding fact (the order-summary `<Text>` reads `totals.total`/`displayTotalCents`, never the deposit) — confidence **proven** at source level for the render binding; **probable** for the exact on-screen pixels absent a sim run. Issue #2 is **proven** (git `--stat` is definitive on ownership; Seth confirmed the on-device symptom). A sim repro would add nothing to the ownership/safety verdicts; recommend the tester live-fire at TEST.

## Blast radius / cross-surface map

- **Issue #1 — IN SCOPE:** `checkout-trip/[tripEventId]/buyer.tsx`, `checkout-trip/[tripEventId]/payment.tsx` (business iOS + Android; web shows full total only — web has no over-time deposit UI on this surface, confirm with Seth whether web needs the line too). **OUT:** event checkout (events have no installment plans), consumer app-mobile.
- **Issue #2 — IN SCOPE (trip, per dispatch):** `checkout-trip/[tripEventId]/payment.tsx` + its `CartTaxPreview` usage. **ADJACENT, NOT in this dispatch but identical:** `app/checkout/[eventId]/payment.tsx:579-592` has the SAME vestigial form — fixing trip-only leaves event native checkout still showing it. Flag to Seth: this is shared dead code; a clean fix removes both call sites (and possibly the component). The web path is already all-in (Stripe hosted `automatic_tax`) and is unaffected. **OUT:** consumer app-mobile (already migrated by ORCH-1025).

## Invariant impact (flagged, not resolved)

- ORCH-0839-B no-native-Stripe gate (`orch-0839-b-mingla-business-no-native-stripe.mjs`) — unaffected; no Stripe SDK import is added by either fix.
- WYSIWYP / all-in policy (MEMORY: native all-in, MINGLA-WIDE) — Issue #2 removal brings trip native checkout INTO compliance; today it VIOLATES it.
- A potential NEW invariant (for SPEC to propose, not decide): "mingla-business native checkout never renders a buyer-facing address/Calculate-tax form; tax is venue-sourced server-side." Tag `I-PROPOSED-*` DRAFT in SPEC.

## Discoveries for Orchestrator

1. **Event native checkout has the identical vestigial Calculate-tax form** (`app/checkout/[eventId]/payment.tsx:579-592` + `CartTaxPreview.tsx`). The same all-in non-compliance Seth saw on trips exists on events. Out of this dispatch's literal scope (trip) but should be fixed together or the inconsistency persists. Recommend Seth widen scope or register a sibling ORCH.
2. **`CartTaxPreview.tsx` becomes dead code** if both call sites are removed — candidate for deletion + a strict-grep gate to prevent re-introduction.

## Confidence level

- **Issue #1:** root cause **proven** (render binding read verbatim; deposit source already in scope). Ownership = ORCH-1130 incompleteness — proven (1130 added due-today only to index Subtotal + Pay button).
- **Issue #2:** root cause **proven** (git `--stat 2966406d0` = 0 mingla-business files; event parity identical; server venue-sourced tax confirmed). Safe-to-remove = **proven** (server ignores the address; tax stays venue-sourced).

## Recommended next phase + scope (direction only — NO fix here)

**SPEC**, scoped to:
- **Issue #1:** surface a "Total due today" deposit line in the order-summary box (and/or sticky bar) on buyer.tsx + payment.tsx, shown ONLY when `paymentPlanChoice === "installments"` and a plan-active tier is in the cart, reading the deposit from the SAME `projectInstallmentSchedule(...).depositCents` source already used by index.tsx (`dueTodayCents` memo `:147-167`) / payment.tsx `projectedSchedule` (`:132-155`) — never recomputed. Keep "Total" = full price as a distinct labeled line. Pay-in-full / no-plan: unchanged (Total only). Currency-aware via `formatCurrency`. buyer.tsx needs the deposit memo re-added (mirror index.tsx's `dueTodayCents`); payment.tsx already has `projectedSchedule` in scope.
- **Issue #2:** remove the buyer-facing `CartTaxPreview` (BILLING ADDRESS + Calculate-tax) from trip native payment.tsx and remove its Pay-gate (`taxPreview === null` checks at `:301-304`, `:376-379`, button `disabled` `:800-801`), routing the native create through a no-address preview to obtain the all-in total + `taxCalculationId` (server already supports `mode:"preview"` with no address). Tax stays venue-sourced server-side — **SAFE**. SPEC must decide whether to fix the event leg in parallel (Discovery #1) and whether to delete `CartTaxPreview.tsx` + add a strict-grep gate.

**Open question for Seth (do not pre-resolve):** include the event native checkout (same vestigial form) in this ORCH, or split it out?
