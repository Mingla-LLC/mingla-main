# TEST — ORCH-1147R2 [cart SELECTION screen must show the all-in price, not the bare base]

**Verdict: PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2
Render-level runtime proof delivered for the selection screen (the R1 blind spot is closed).
Regression gate satisfied: implementor happy-path test + tester adversarial **render** test both on-branch, in closing diff, fails-on-revert proven.

- Worktree: `~/Desktop/mingla-orchs/ORCH-1147R2-[cart-selection-screen-allin]/`
- Branch: `ORCH-1147R2-cart-selection-screen-allin`
- Impl commit under test: `f03cd66c3`
- Tester adversarial test commit: `eed4448b2`
- Branch is current with origin/main (0 behind).

---

## 1. What the change does (verified against the actual diff)

Pure DISPLAY bind of R1-computed data. Three checkout SELECTION screens
(`checkout/[eventId]`, `checkout-trip/[tripEventId]`, `checkout-experience/[experienceEventId]`)
+ the shared per-tier `QuantityRow` wrapper:

- **Per-tier row** — `QuantityRow.tsx` wrapper forwards `priceAllInGbp: ticket.priceAllInGbp ?? null`
  into the shared `@mingla/event-rendering` row, which already (ORCH-1006) renders the all-in +
  a quiet "incl. VAT & fees" caption when `priceAllInGbp > priceGbp`. Null → falls back to base, no caption.
- **Bottom bar** — `headlineAllIn = formatCurrency(totals.allInTotal, totals.currency)`; label
  relabeled `Subtotal → Total`; a single combined `Fees & tax` line gated on
  `!isEmpty && !isFree && hasFeesTaxDelta` (`+ dueTodayCents === null` on trip); Continue a11y uses the all-in.
- **Trip deposit branch** — `dueTodayCents !== null` still renders `Due today` + the deposit; the
  Fees & tax line is suppressed on the installments path.

---

## 2. SC-by-SC matrix (render/runtime evidence per row)

| SC | Criterion | Surface | Verdict | Evidence |
|----|-----------|---------|---------|----------|
| SC-1 | Event selection bottom bar leads with the all-in | event | **PASS (render)** | RTL mount: bar-label="Total", bar-value="£67.93", fees-tax contains "£2.93"; "Subtotal" absent |
| SC-2 | Trip full-total binds all-in; deposit branch untouched | trip | **PASS (render)** | full-total: Total/£67.93/£2.93; installments (dueTodayCents=2000): label="Due today", value="£20.00", NO fees line |
| SC-3 | Experience selection bottom bar leads with the all-in | experience | **PASS (render)** | RTL mount: Total/£67.93/£2.93; "Subtotal" absent |
| SC-4 | Per-tier QuantityRow shows the all-in + caption | event/trip/experience | **PASS (render)** | REAL <QuantityRow> wrapper mount renders "£67.93" + "incl. VAT & fees"; "£65.00" NOT rendered |
| SC-5 | Single combined "Fees & tax" line, never split | all | **PASS (render)** | exactly one fees-tax node rendering the combined delta; no separate service-fee/VAT node |
| SC-6 | Continue a11y uses the all-in | all | **PASS (source+impl-test)** | a11yLabel binds headlineAllIn; implementor test asserts it; gate enforces it |
| SC-7 (T-5) | Absorb: Total==base, no fees line, no caption | event | **PASS (render)** | base==all-in (65/65): "Total £65.00", NO fees-tax, NO caption |
| SC-8 (T-6) | Free: "Free", no fees line, no caption | all | **PASS (render)** | free tier: "Free", NO fees-tax, NO caption |
| SC-9 (T-7) | RPC miss: falls to base, no fabrication | all | **PASS (render)** | priceAllInGbp=null: renders "£65.00", NO caption, "£67.93" NOT rendered |
| SC-10 (T-9) | Strict-grep gate fails on revert | CI | **PASS** | gate exit 1 on bare-base revert; exit 0 restored |
| SC-11 (T-10) | Pass-fee real-data case renders all-in | prod data | **PASS (DB-anchored)** | prod event 09b4ece6… tier "The paid": base 6500 → all-in 6793 → delta 293 (USD) — exactly the synthetic fixture |

All 12 render assertions green under `jest.orch1147r2.render.cjs`
(RN preset + react-test-renderer 19.1.0 + @testing-library/react-native 13.3.3, react pinned to the business 19.1.0 install).

---

## 3. Findings

**P4-1 (NOTE — praise).** The R2 change reuses the shared row's existing ORCH-1006 all-in/caption path
rather than reimplementing it, and the trip deposit gate (dueTodayCents === null) is exactly right — the
installments "Due today" deposit is a partial figure and must not carry a "Fees & tax" delta line. No
fabrication on the RPC-miss path (Constitution rule 9 honoured).

**P4-2 (NOTE — discovery, not a finding against R2).** The dispatch's masking-gotcha "0/8 live
charges-enabled brands pass any fee" is now **stale**: prod has 8 charges-enabled brands and **1 passes
a fee** (event 09b4ece6-eabc-4734-8ce3-3a25d90417e4 "Vibes and Stuff", USD, pass_mingla_fee=pass_service_fee=true,
tier base $65.00 → all-in $67.93). A prod render of THAT brand's selection screen is now probative.

No P0/P1/P2/P3.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Re-ran the implementor's `orch_1147r2_selection_allin.test.ts` (committed at `f03cd66c3`) against a TRUE
line-deletion revert (not a comment-out):

- **Restored (HEAD):** `Tests: 17 passed, 17 total`.
- **Revert** (deleted the priceAllInGbp wrapper forward + rebound the event bottom bar to
  formatCurrency(totals.total, …)): `Tests: 2 failed, 15 passed` — RED assertions:
  `the business wrapper forwards priceAllInGbp into ticketForPackage` and
  `the full-total headline + a11y no longer bind to the bare base`.

Implementor fails-on-revert independently **confirmed** at restored commit `f03cd66c3`.

---

## 5. Adversarial test added (tester-owned, DIFFERENT ANGLE)

- **Path:** `mingla-business/src/components/checkout/__tests__/orch_1147r2_selection_allin.render.test.tsx`
- **Commit:** `eed4448b2`
- **Angle:** the implementor's test is **math-replication + source-text grep** (never mounts a React
  tree — the exact R1 blind spot). This test is a **true component RENDER proof**: it MOUNTS the REAL
  mingla-business <QuantityRow> wrapper (→ shared @mingla/event-rendering row) and the bottom-bar
  derivation driven by the REAL useCartTotals over a REAL CartProvider, then asserts the ACTUAL RENDERED
  TEXT (getByText("£67.93"), getByText(/incl. VAT & fees/), testID bar-value/fees-tax).
- **Config / infra (worktree-local, in closing diff):** `jest.orch1147r2.render.cjs` +
  `jest.orch1147r2.blur-stub.cjs` + `jest.orch1147r2.haptics-stub.cjs`; registered in `jest.config.cjs`
  testPathIgnorePatterns so the default node/ts-jest run skips it (requires RN preset + RTL — same
  pattern as ORCH-1118/1122/1143). RTL deps live in gitignored node_modules
  (provision: `cd .orch1118-testdeps && npm i react-test-renderer@19.1.0 @testing-library/react-native@^13 --legacy-peer-deps`).
- **fails-on-revert verified at `eed4448b2`:** with both binds line-deleted, the render test goes
  `Tests: 3 failed, 9 passed` — three RED cells are the event/trip/experience per-tier rows, each failing
  at `expect(screen.getByText("£67.93")).toBeTruthy()`. Restored → `12 passed, 12 total`.
- **Both tests appear in `git diff origin/main...HEAD --name-only`:** confirmed.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | display-only; no new tap |
| 2 | One owner per truth | PASS | all-in single-owned by R1 useCartTotals.allInTotal; R2 only reads it |
| 3 | No silent failures | PASS | null all-in falls back to base visibly; no swallowed error |
| 4 | One query key per entity | N/A | no query change |
| 5 | Server state server-side | PASS | no Zustand; cart provider-local; all-in server-sourced |
| 6 | Logout clears everything | N/A | no auth/persistence touch |
| 7 | Label [TRANSITIONAL] | N/A | none introduced |
| 8 | Subtract before adding | PASS | reused shared row + R1 totals; net additive display only |
| 9 | No fabricated data | **PASS** | RPC-miss render test proves base shown, NO grossed-up number invented |
| 10 | Currency-aware | PASS | formatCurrency(value, totals.currency); GBP test, USD prod both correct |
| 11 | One auth instance | N/A | buyer/selection screen anon-tolerant; untouched |
| 12 | Validate at right time | N/A | no validation change |
| 13 | Exclusion consistency | N/A | none |
| 14 | Persisted-state startup | N/A | cart not persisted (CartContext doc: no AsyncStorage) |

No violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Evidence |
|---------|---------|----------|
| Business iOS (selection screen) | **PASS (component-render)** | RTL haste.defaultPlatform="ios"; real <QuantityRow> + bottom-bar rendered, all-in text asserted (event/trip/experience) |
| Business Android | **PASS (parity, render)** | same shared row + same useCartTotals derivation; render proof platform-agnostic (RN preset). No Android-specific branch in the changed lines |
| Buyer/anonymous Web (/checkout/{eventId}) | **BLOCKED (bonus, deferred)** | no expo-web dev server (localhost:19006=000; metro 8081=200). Synthetic pass-fee web fixture + seeded brand + buyer-web build out of reach this run, as the dispatch anticipated. MANDATORY component-render proof stands in its place; shared row + derivation render identically on web (same RN codebase). Real prod brand 09b4ece6… exists for a future web spot-check. |
| Consumer iOS/Android | N/A | change is business-app checkout only |
| Admin Web | N/A | not a checkout surface |
| Physical iPhone (HITL) | NOT REQUESTED | render-level proof + DB anchor sufficient for this display bind; no hardware-keyboard/gesture path |

Byte-unchanged guard (DO-NOT-TOUCH): `payment.tsx ×3`, `CartContext.tsx`, and the shared
`packages/event-rendering/QuantityRow.tsx` are **byte-identical to origin/main** (confirmed via
git diff + a direct diff of payment.tsx against origin/main). No money-engine / payment regression possible.

---

## 8. Gate + jest results

- **Strict-grep orch-1147r2-selection-shows-allin.mjs** — exit 0 (restored); exit 1 on bare-base revert. Fails-on-revert proven.
- **Strict-grep orch-1130-no-buyer-tax-form.mjs** (required) — **exit 0 (green).**
- **R1 gates** orch-1147-allin-single-owner / orch-1147-cart-total-is-allin / orch-1147-web-charge-allin — all exit 0.
- **Tester render test** (jest.orch1147r2.render.cjs) — 12/12 PASS.
- **Implementor test** (orch_1147r2_selection_allin.test.ts) — 17/17 PASS.
- **R1 cart-allin test** (orch_1147_cart_allin_total.test.ts) — PASS.
- **Default jest no longer matches the render test** — `No tests found` (correctly ignored); the committed render test does not break the default CI jest run.

### Pre-existing suite noise (NOT R2 — Discovery for Orchestrator)

The full mingla-business default jest run shows **~85 failed suites / 388 passed** — PRE-EXISTING, outside R2's blast radius:
- meta_orch_0952_carousel_browser.test.ts is a **Playwright** test mis-run under Jest ("Playwright Test needs to be invoked via npx playwright test") — config issue, unrelated to R2.
- The orch_0911 / orch_0915 source-text tests (readFileSync the byte-unchanged payment.tsx) fail with empty Received:"" under heavy parallel contention, yet **PASS in isolation** (orch_0915_pay_in_full_choice_adversarial → RC 0, 7.85 s). Failures hit many unrelated domains (keyboard, brands, cover media, social preview, trip visual parity).
- Every R2-relevant suite passes in isolation and runInBand. No failing suite reads a file R2 changed except the R1/R2 cart tests, which pass.

---

## 9. Discoveries for Orchestrator

1. **Stale masking-gotcha** — prod now has 1/8 charges-enabled brands passing a fee (event
   09b4ece6-eabc-4734-8ce3-3a25d90417e4, tier base $65.00 → all-in $67.93). Update the "0/8 → green run
   non-probative" framing; a real probative web/device spot-check is now possible.
2. **mingla-business jest health** — ~85 suites fail under the full parallel run (Playwright-under-jest
   misconfig + source-read flakiness under contention). Pre-dates R2; worth a dedicated cleanup ORCH.
   Related to the stale-node_modules / COMMS-0035 class of environment drift.

---

## Routing

PASS → CLOSE (orchestrator). Tester adversarial render test committed at `eed4448b2`; both regression
tests in the closing diff; all required gates green; byte-unchanged guard confirmed.
