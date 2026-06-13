# IMPLEMENTATION — ORCH-1130 ADDENDUM: CTA-adjacent price = amount due today

**ORCH:** ORCH-1130 [public trip page payment-structure + installments UX redesign] — ADDENDUM (rework)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on branch `ORCH-1130-trip-pay-structure`
**Base commit:** `da7222178`
**Status:** implemented and verified (source + real-logic gates; device proof deferred — see §Operator)

---

## 1. Summary (plain English)

When a buyer picks **"Pay over time"** on a trip with an installment plan, every price next to a
"Reserve / Continue / Pay" button now shows the **amount due today (the deposit)**, not the full
trip price. When they pick **"Pay in full"**, the same buttons show the full price. A trip with **no
plan** is unchanged (full price only, no toggle). The deposit number is always read from the same
projected installment schedule the toggle itself renders — never recomputed or fabricated — and all
amounts go through the existing currency formatters (EUR + GBP verified).

This was the binding Seth addendum: the toggle already existed (shipped in `068eb72ed`), but the
CTA-adjacent prices still showed the full amount under "Pay over time" on most surfaces.

---

## 2. Per-surface before → after CTA copy

Example trip: **€500, 25% deposit** → deposit due today **€125** (qty 1). GBP example: £800, 20% → £160.

| Surface | State | BEFORE | AFTER |
|---|---|---|---|
| **Path A — public page floating Reserve bar** (`app/t/[brandSlug]/[tripSlug].tsx`) | pay-over-time | `€500 total` (static) | `€125 today` (deposit) |
| | pay-in-full | `€500 total` | `€500 total` (full) |
| | no-plan single tier | `€500` | `€500` (unchanged) |
| | multi-tier (no prod) | `From €500` | `From €500` (unchanged) |
| **Path A — checkout index Subtotal** (`app/checkout-trip/[tripEventId]/index.tsx`) | pay-over-time | `Subtotal  €500` | `Due today  €125` |
| | pay-in-full / no-plan | `Subtotal  €500` | `Subtotal  €500` (unchanged) |
| **Path A — Review & pay Pay button** (`app/checkout-trip/[tripEventId]/payment.tsx`) | pay-over-time (web) | `Pay €125 deposit` (already correct) | `Pay €125 deposit` (unchanged) |
| | pay-over-time (**native**) | `Pay €500` ❌ (contradicted its own "charged €125 today" banner) | `Pay €125 deposit` ✅ |
| | pay-in-full | `Pay €500` | `Pay €500` (unchanged) |
| **Path B — consumer Reserve bar** (`ConsumerTripDetailScreen.tsx`) | pay-over-time | `From €500` | `€125.00 today` (deposit) |
| | pay-in-full / no-plan | `From €500` | `From €500` (unchanged) |
| **Path B — consumer cart sheet sticky bar** (`TicketCartSheet.tsx` via `ExpandedBusinessEventSheet.tsx`) | pay-over-time | `Subtotal  €500.00` | `Due today  €125.00` |
| | pay-in-full / no-plan / events | `Subtotal  …` | `Subtotal  …` (unchanged) |

The public-page bar updates **live** when the buyer flips the toggle (the toggle's `paymentPlanChoice`
is the route component's own state, already threaded into `TripCheckoutFlow`).

---

## 3. Files changed (7 = 6 product + 1 test)

| File | Lines Δ | What |
|---|---|---|
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | ~+24 / −7 | bar price projects the deposit; installments → `{deposit} today`, full → `{price} total` |
| `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | ~+34 | reads cart `paymentPlanChoice`; projects deposit; Subtotal → "Due today {deposit}" on installments; a11y updated |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | ~+15 / −12 | deposit branch hoisted ABOVE the web/native split so the **native** Pay button shows `Pay {deposit} deposit` under installments |
| `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | ~+20 | Reserve-bar price = `{deposit} today` on installments; forwards `dueTodayCents` into the cart sheet |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | ~+15 | new optional `dueTodayCents` prop, forwarded to `TicketCartSheet` only when choice = installments |
| `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` | ~+22 | new optional `dueTodayCents` prop → sticky bar shows "Due today {deposit}" instead of all-in total |
| `mingla-business/src/components/trip/__tests__/TripPaymentChoice_orch_1130_addendum_cta_price.test.ts` | +135 (new) | happy-path regression (real-logic + per-surface source contract) |

No DB / edge-function / migration / RLS changes. No DO-NOT-TOUCH or root-layout files touched.

---

## 4. Invariants & rules honored

- **No fabricated numbers (Const #9):** every deposit reads `projectInstallmentSchedule(...).depositCents`
  (business) / `projectConsumerSchedule(...).depositCents` (consumer) — the SAME source the toggle renders.
- **Currency-aware (Const #10):** all amounts via `formatCurrency` / `formatTripPrice` / `formatMoneyExact`
  (`Intl.NumberFormat`). EUR + GBP verified in the test. No hardcoded glyph or amount.
- **No-plan unchanged:** every change is gated on a non-null projected schedule → no-plan trips show full
  price, no toggle, no deposit branch.
- **Free / closed / unavailable states unchanged.**
- **No dead taps:** only price labels changed; the buttons' `onPress` targets are untouched.
- **Subtract cleanly:** the static `€500 total` bar wiring was REPLACED, not layered.
- **Optional props:** the two new app-mobile props are optional → events / experiences / other callers
  of `ExpandedBusinessEventSheet`/`TicketCartSheet` are byte-identical (undefined → old all-in total).

---

## 5. Gates

| Gate | Result |
|---|---|
| `tsc --noEmit` (mingla-business) — my non-test files | CLEAN (0 errors in the 5 touched files; pre-existing repo-wide noise unrelated) |
| `tsc --noEmit` (app-mobile) — my files | CLEAN (0 errors in the 3 touched files) |
| `eslint` (touched files) | No NEW findings. Pre-existing-only: `[tripSlug].tsx` unused `glass` warning (line 36, pre-existing) + `payment.tsx` line-686 `no-unescaped-entities` (pre-existing copy I didn't touch) + app-mobile `@mingla/event-rendering` import/no-unresolved (pre-existing workspace-alias artifact). All confirmed identical on base via stash. |
| `jest` addendum suite | **6 passed / 6** |
| `jest` ORCH-1130 regression suite | **all pass** (unchanged) |
| `jest` full trip + checkout-trip set | base = 15 suites / 38 tests fail (pre-existing stale source-characterization, incl. superseded ORCH-0915); with my changes = **14 / 36** (my addendum suite passes; **net −1 suite / −2 tests; ZERO new failures**) |

Pre-existing failing suites (e.g. `orch_0915_pay_in_full_choice*`, `PaymentPlanEditor*`, `TripVisualParity*`)
assert OLD strings that the ORCH-1130 redesign (`068eb72ed`) already removed; updating them needs
`[TEST-MOD-APPROVED]` and is OUT of this addendum's scope.

---

## 6. Regression test — fails-on-revert proof

- **Path:** `mingla-business/src/components/trip/__tests__/TripPaymentChoice_orch_1130_addendum_cta_price.test.ts`
- **Passing:** 6/6 with the fix in place.
- **Fails-on-revert (TRUE deletion, not comment-out):** reverted all 3 business files to `HEAD`
  (`da7222178`, pre-addendum) via `git show HEAD:<file>` overwrite → the addendum suite reported
  **3 failed / 3 passed** (the 3 per-surface source-contract tests FAIL: public bar, checkout index,
  payment Pay button; the 3 pure-projection real-logic tests stay green by design as the shared-util
  backstop). Restored from backups → **6 passed / 6**.
- **fails-on-revert verified at `da7222178`** (the pre-addendum base the files were reverted to).

---

## 7. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS | YES (Reserve bar + cart sheet) | shared RN code → automatic across iOS/Android |
| Consumer Android | YES | automatic |
| Buyer/anon Web (business) | YES (public bar + checkout index + payment) | shared RN-web code → automatic |
| Business iOS | YES (same checkout-trip screens) | automatic |
| Business Android | YES | automatic |
| Admin Web | NO — no trip checkout there | — |
| Business Web preview | NO — preview only | — |

Path A and Path B were updated to the SAME deposit-due-today semantics (manual parity across the two
codebases, both implemented this turn).

---

## 8. Operator action required

- **Device proof (deferred):** the source + real-logic gates prove the wiring; a physical/sim pass is
  recommended for the runtime live-toggle on (1) the public `/t/` bar flipping €500 total ⇄ €125 today,
  (2) the consumer Reserve bar + cart sheet, and (3) the **native** payment Pay button now reading
  `Pay €125 deposit`. mingla-business Jest has no RN renderer, so button-render is source-verified, not
  runtime-verified here.
- **No deploy / migration / OTA** — none required (pure client UI).

## 9. Discoveries for Orchestrator

- The **native** trip payment Pay button previously showed the full tax-inclusive total under
  "Pay over time", directly contradicting its own "Payment plan active — charged €125 today" banner.
  Fixed here as part of the binding addendum (deposit shown). The deposit at this preview stage is
  tax-exclusive (matching the web path's existing deposit copy); Stripe charges only the deposit first
  server-side regardless.
- Pre-existing stale suites assert superseded ORCH-0915 strings — flag for a future `[TEST-MOD-APPROVED]`
  cleanup ORCH (out of scope here).
