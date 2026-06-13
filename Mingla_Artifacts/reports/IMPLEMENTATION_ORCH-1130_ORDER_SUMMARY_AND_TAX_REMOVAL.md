# IMPLEMENTATION — ORCH-1130 — Order-summary "Total due today" + vestigial Calculate-tax removal

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on branch `ORCH-1130-trip-pay-structure`.
**Commit:** `0c7a0638ccc26b8a45185c6e2861c1483c766918`.
**Date:** 2026-06-13.
**Investigation honored:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1130_ORDER_SUMMARY_AND_TAX_SECTION.md` (F-1..F-4 + the SAFE-to-remove proof).
**Status:** implemented and self-verified (source + jest + strict-grep). Native checkout Pay end-to-end on a TEST card (trip + event + experience) needs device proof — see Operator action.

---

## 1. Summary (plain English)

Two trip/checkout fixes, both Seth-approved.

- **Fix #1** — On the trip checkout, when the buyer picks "Pay over time", the order-summary box (and the sticky bar) now shows TWO clear lines: the full **Total** and a **Total due today** (the deposit). Pay-in-full / no-plan is unchanged (Total only). On both the "Your details" step and the "Review & pay" step.
- **Fix #2** — Removed the leftover "Calculate tax" billing-address form from the native checkout. The buyer no longer types an address or taps "Calculate tax" — Pay is available immediately and the all-in total (including tax) shows upfront, matching Mingla's all-in / WYSIWYP policy. Tax is still charged (computed venue-sourced on the server). The dead form component is deleted, and a CI gate stops it from coming back. Applied to the **trip**, **event**, AND **experience** native checkouts (all three shared the identical dead form — see scope note).

---

## 2. SPEC success-criteria coverage

| SC | Description | Status | Commit |
|----|-------------|--------|--------|
| SC-1 Fix#1 buyer | trip buyer.tsx order-summary + sticky bar show Total + Total due today under installments; Total-only otherwise | ✓ | `0c7a0638c` |
| SC-2 Fix#1 payment | trip payment.tsx recap + sticky bar show Total + Total due today under installments (from existing `projectedSchedule.depositCents`) | ✓ | `0c7a0638c` |
| SC-3 Fix#2 trip remove | trip payment.tsx renders no CartTaxPreview / Calculate-tax gate; Pay not disabled awaiting tax calc | ✓ | `0c7a0638c` |
| SC-4 Fix#2 event remove | event payment.tsx renders no CartTaxPreview / Calculate-tax gate; Pay not disabled awaiting tax calc; event Pay flow preserved | ✓ | `0c7a0638c` |
| SC-5 Fix#2 no-address create | native create routed through the no-address path (silent `mode:"preview"` for the all-in + calculationId; create sends no buyer address) | ✓ | `0c7a0638c` |
| SC-6 Fix#2 delete | `CartTaxPreview.tsx` deleted; no live references remain | ✓ | `0c7a0638c` |
| SC-7 Fix#2 gate | strict-grep gate `orch-1130-no-buyer-tax-form.mjs` blocks reintroduction; registered in the workflow | ✓ | `0c7a0638c` |
| SC-8 no-native-stripe | ORCH-0839-B no-native-Stripe-import gate still green (no native Stripe import added) | ✓ | `0c7a0638c` |

---

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` | +~70 | Fix #1: re-added `dueTodayCents` memo + due-today line in order-summary box + sticky bar + styles |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | +~95 / −~30 | Fix #1: due-today line (box + sticky bar) from `projectedSchedule.depositCents`. Fix #2: removed CartTaxPreview + Pay-gate; silent no-address preview; `displayAllIn` |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | +~60 / −~25 | Fix #2: removed CartTaxPreview + Pay-gate; silent no-address preview; `displayAllIn` |
| `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx` | +~60 / −~25 | Fix #2: removed CartTaxPreview + Pay-gate; silent no-address preview; `displayAllIn` (3rd identical call site — scope note §10) |
| `mingla-business/src/payments/nativeCheckoutFlow.ts` | +5 / −1 | `buyer.address` made optional (stub) |
| `mingla-business/src/payments/nativeCheckoutFlow.native.ts` | +9 / −2 | `buyer.address` optional; forward `address` only if supplied (no-address create) |
| `mingla-business/src/components/checkout/CartTaxPreview.tsx` | −301 (DELETED) | dead component (both/all call sites gone) |
| `.github/scripts/strict-grep/orch-1130-no-buyer-tax-form.mjs` | +~100 (NEW) | strict-grep gate (I-PROPOSED-1130-NO-BUYER-TAX-FORM) |
| `.github/workflows/strict-grep-mingla-business.yml` | +11 | register the new gate job |
| `mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_1130_order_summary_and_tax_removal.test.ts` | +~150 (NEW) | append-only regression test (Fix #1 + Fix #2) |

---

## 4. Data-model changes applied

None. No migration. No server/edge tax-engine change.

---

## 5. Edge functions touched

None deployed/changed. The client now calls the EXISTING `ticket-checkout-create` `mode:"preview"` (no-address) path — already supported server-side (`index.ts:230` `mode` parse; `:269-271` no address gate; `:1513-1527` preview returns the all-in `totalCents` + `calculationId`). `verify_jwt` unchanged (this fn is anon-tolerant for buyer checkout). The server tax engine (venue-sourced, `events.venue_tax_address`) is untouched.

---

## 6. How Pay works without the form, per checkout

**All three native checkouts (trip / event / experience):**
1. On mount (native only, once buyer name+email present), a silent `ticket-checkout-create` `mode:"preview"` call runs with NO buyer address → server returns the venue-sourced all-in `totalCents` (incl. tax) + a `calculationId`. Stored in `allInPreviewCents` / `previewCalculationId`. Non-blocking; any failure leaves the base Total and a no-address create.
2. The order-summary box + sticky bar + Pay button show `displayAllIn` = the previewed all-in (cents) when resolved, else the base `totals.total`.
3. **Pay** (`handlePay`) is enabled immediately (`disabled={processing}` only — the old `taxPreview === null` gate is gone). It calls `nativeCheckout({...buyer WITHOUT address, taxCalculationId: previewCalculationId?})`. `nativeCheckoutFlow.native.ts` forwards the create with NO address; the server recomputes (or reuses the `calculationId`) the same venue-sourced all-in and returns `requires_payment` → PaymentSheet. **Tax stays in the charge.**
4. **Web** path is unchanged (Stripe hosted Checkout, `automatic_tax` on the hosted page); it never showed the form (`Platform.OS !== "web"` guarded).

**Event Pay preservation:** the event screen's web branch, the native PaymentSheet branch, the ORCH-0852 fire-and-forget confirm, and navigation are all byte-identical except the removed tax-gate + the address drop. No regression to the high-traffic event Pay flow.

---

## 7. Old → New receipts

### checkout-trip/[tripEventId]/buyer.tsx
- **Before:** order-summary box + sticky bar showed `totals.total` only; no deposit value on this step (the projection was removed).
- **Now:** re-added a `dueTodayCents` memo (mirror of index.tsx, reads `projectInstallmentSchedule(...).depositCents`, never recomputed); renders a "Total due today" line under the Total in both the box and the sticky bar when `paymentPlanChoice === "installments"` + a plan-active tier is present.
- **Why:** SC-1 (Fix #1 buyer leg).

### checkout-trip/[tripEventId]/payment.tsx
- **Before:** recap + sticky bar showed `displayTotalCents` (full) only; deposit shown only in the Pay button + banner. CartTaxPreview rendered native-only; Pay hard-gated on `taxPreview === null`; native create passed `address` + `calculationId` from the form.
- **Now:** "Total due today" line added to the box + sticky bar from `projectedSchedule.depositCents`. CartTaxPreview + all `taxPreview` gates removed; silent no-address preview drives `displayAllIn` + the create's `taxCalculationId`; native create sends no address.
- **Why:** SC-2, SC-3, SC-5.

### checkout/[eventId]/payment.tsx
- **Before:** CartTaxPreview native-only; Pay gated on `taxPreview === null`; native create passed the form's address + calculationId; `displayTotalCents` flipped to `taxPreview.totalCents`.
- **Now:** CartTaxPreview + gates removed; silent no-address preview drives `displayAllIn` + `taxCalculationId`; native create sends no address. Web + PaymentSheet + confirm flow preserved.
- **Why:** SC-4, SC-5.

### checkout-experience/[experienceEventId]/payment.tsx
- Same transform as the event leg (single-charge). Migrated so the shared component could be deleted (scope note §10).

### src/payments/nativeCheckoutFlow.ts + .native.ts
- **Before:** `buyer.address` was REQUIRED in `NativeCheckoutInput`; `.native.ts` always forwarded `address`.
- **Now:** `buyer.address` is OPTIONAL; `.native.ts` forwards `address` only if a (legacy) caller supplies one. Server ignores it regardless (venue-sourced tax).
- **Why:** SC-5 (no-address create).

### src/components/checkout/CartTaxPreview.tsx — DELETED
- The BILLING ADDRESS + "Calculate tax" form. All call sites removed. **Why:** SC-6.

---

## 8. Cross-surface impact

| Surface | Affected? | What / why |
|---------|-----------|------------|
| Consumer iOS | No | app-mobile checkout already all-in (ORCH-1025); untouched |
| Consumer Android | No | same |
| Buyer/anon Web | No (behavior) | web path was already all-in via Stripe hosted `automatic_tax`; the form was native-only |
| Business iOS | **Yes** | Fix #1 (trip due-today) + Fix #2 (form removed, all-in preview) — trip/event/experience native Pay |
| Business Android | **Yes** | same (shared RN code — parity automatic) |
| Admin Web | No | not a checkout surface |
| Business Web preview | No (behavior) | `Platform.OS === "web"` branch unchanged |

Parity iOS↔Android is automatic (one RN codebase).

---

## 9. Gate / test results

- **New regression test** `app/checkout-trip/[tripEventId]/__tests__/orch_1130_order_summary_and_tax_removal.test.ts` — **11/11 PASS** (source-structural, mirror of `native_checkout_flow_parity.test.ts`).
- **New strict-grep gate** `orch-1130-no-buyer-tax-form.mjs` — **PASS** on the cleaned tree; **FAILS** on a re-created component fixture AND on a "Calculate tax" string fixture (both proven).
- **Adjacent strict-grep** — ORCH-0778 no-native-stripe **PASS**; orch-0964-checkout-no-brand-theme, i-consumer-payment-flow-frozen, orch-0843-direct-charges, i-stripe-paymentsheet-parity, orch-0955-native-tax-coverage all **PASS**.
- **Adjacent jest** — `native_checkout_flow_parity` PASS, `ticketCheckoutService(.orch0915)` PASS, `orch_1130_auto_skip_latch` PASS.
- **tsc** — no errors in any touched payment screen / projection util / nativeCheckoutFlow change. Pre-existing baseline errors only (unresolved `@mingla/phone-input` / `@mingla/payments-native` workspace packages + unrelated test/util modules — present on origin/main, isolated-worktree package linkage, NOT my code).
- **eslint** — only pre-existing issues on the touched files (unresolved `@mingla/*` imports, pre-existing `react/no-unescaped-entities` on banner copy, `Array<T>` warnings, the pre-existing web-restore `exhaustive-deps` disable). No new lint errors introduced.

### Pre-existing baseline failures (proven, NOT mine)
`orch_0915_pay_in_full_choice(.adversarial)` — **7 fail / 2 pass IDENTICAL with and without my changes** (stash-verified). These assert `useState<PaymentPlanChoice>("full")` / `type PaymentPlanChoice` strings in trip payment.tsx that the WORKTREE BASE (`d3fc65037`, prior ORCH-1130 work) already removed by moving `paymentPlanChoice` into CartContext. origin/main's trip payment.tsx still has those strings (2 matches); the worktree base has 0 → the tests were already red on the base before this implement pass. Out of scope; flagged for the orchestrator.

### fails-on-revert (TRUE line deletion)
- **Fix #1** — deleted the "Total due today" JSX from buyer.tsx + payment.tsx → the 2 Fix-#1 assertions FAIL; restored → 11/11 pass. Verified at `0c7a0638c`.
- **Fix #2** — re-introduced `<CartTaxPreview />` + "Calculate tax" into event payment.tsx → 1 Fix-#2 assertion FAILS **and** the strict-grep gate FAILS (exit 1); restored → 11/11 + gate pass. Verified at `0c7a0638c`.

---

## 10. Known issues / deferred / scope notes

- **Scope note — experience checkout (3rd call site).** The investigation found the vestigial form on trip + event only; a THIRD identical call site exists at `app/checkout-experience/[experienceEventId]/payment.tsx` (added by META-ORCH-1059). The dispatch required DELETING `CartTaxPreview.tsx` ("both call sites gone"), which is impossible while the experience screen still imports it. I migrated the experience leg with the IDENTICAL transform (same all-in policy, same SAFE-to-remove proof) so the deletion is valid and the all-in policy is consistent app-wide. This is in-family, not scope-widening — flagging for the orchestrator/tester to confirm.
- **Display all-in vs base Total.** `totals.total` from CartContext is the BASE subtotal (tax/fee-exclusive); the all-in only ever came from the server. The silent `mode:"preview"` fetch supplies the all-in for display (WYSIWYP). If the preview is slow/fails, the base Total briefly shows, but the charge is always the server-computed all-in (no money risk). The pre-existing latent bug where `taxPreview.totalCents` (cents) was formatted as major units in `displayTotalCents` is removed by this change.
- **Native-only verification.** All sim/device behavior is UNVERIFIED here (source + jest + grep proven). The native PaymentSheet path requires `@mingla/payments-native` (not linked in this typecheck/lint env).

---

## 11. Operator action required

- **No migration, no edge deploy, no OTA.** Pure client RN change.
- **Device proof needed (tester):** native checkout Pay end-to-end on a TEST card for **trip**, **event**, AND **experience**: (a) the all-in total (incl. tax) shows upfront with NO billing-address form / "Calculate tax" button; (b) Pay is tappable immediately and the PaymentSheet opens and charges the all-in; (c) trip pay-over-time shows "Total" + "Total due today" on both the buyer step and the Review step, and charges the deposit. Verify the silent preview populates the all-in (and that a preview failure still lets Pay charge the all-in).
- Route back to the orchestrator for REVIEW → tester dispatch.

---

## 12. Discoveries for Orchestrator

1. **Experience checkout shared the same vestigial form** — migrated here (scope note §10); confirm acceptance.
2. **`orch_0915_pay_in_full_choice(.adversarial)` is RED on the worktree base** (pre-this-pass) because the worktree's prior ORCH-1130 refactor moved `paymentPlanChoice` into CartContext while the tests still assert the old local `useState<PaymentPlanChoice>` strings. These tests are stale and should be updated (append-only / `[TEST-MOD-APPROVED]`) or the worktree base reconciled with origin/main. Not touched by this pass.
3. **DRAFT invariant** `I-PROPOSED-1130-NO-BUYER-TAX-FORM` — "mingla-business native checkout payment screens never render a buyer-facing address / Calculate-tax form; tax is venue-sourced server-side." Gate: `orch-1130-no-buyer-tax-form.mjs`. Register in `INVARIANT_REGISTRY.md` at CLOSE.
