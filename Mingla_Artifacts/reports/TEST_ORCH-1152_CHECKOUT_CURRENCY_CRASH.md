# TEST — ORCH-1152 [business checkout crashed on mount — `RangeError: Currency is invalid`]

**Verdict: PASS** — 0 P0 · 0 P1 · 0 P2 · 1 P3 (junk-ISO-code formatter boundary, out of scope) · 1 P4 (clean defense-in-depth).

**Class:** S0 regression introduced by ORCH-1147R2; this fix verified.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1152-[checkout-currency-crash]/` on branch `ORCH-1152-checkout-currency-crash`.
**HEAD:** `95567b0a5` (rebased onto origin/main `9b6d34b1d` — clean, origin/main made zero changes to the touched files since merge-base).
**Mode:** TARGETED + adversarial render-proof.

The empty-state no-crash cells reach **PASS via REAL component render** (react-test-renderer + RTL mount of the REAL `CartProvider` in the empty state), which is the dispatch's mandatory bar.

---

## 1. Empty-state no-crash RENDER matrix (the priority — the exact shipped crash state)

Proof method: my adversarial render test mounts the REAL `CartProvider` EMPTY (no seed → `useCartTotals()` returns `currency === ""`, `allInTotal === 0`, `isEmpty === true`) and renders a bottom-bar that reproduces the **original pre-1152 unconditional** screen headline (`formatCurrency(totals.allInTotal, totals.currency)`). react-test-renderer throws synchronously from `render()` on any commit-time throw, so reaching the assertions IS the no-crash proof.

| Screen (empty cart) | Renders without throwing | Shows "—" placeholder | No "Fees & tax" line | Verdict |
|---|---|---|---|---|
| event `checkout/[eventId]/index.tsx` | YES (REAL mount) | YES (`bar-value` === "—") | YES | **PASS (render-proven)** |
| trip `checkout-trip/[tripEventId]/index.tsx` | YES (REAL mount) | YES | YES | **PASS (render-proven)** |
| experience `checkout-experience/[experienceEventId]/index.tsx` | YES (REAL mount) | YES | YES | **PASS (render-proven)** |
| qty→0 transition (populated → remove last ticket → empty) | YES — no re-crash on the way back to empty | YES (back to "—") | YES | **PASS (render-proven)** |
| NON-GBP (USD) cart emptied back out | YES — `$52.25` populated, `—` when emptied | YES | YES | **PASS (render-proven)** |

Source parity confirmed across all three `index.tsx`: each renders `totals.isEmpty ? "—" : totals.isFree ? "Free" : headlineAllIn` and gates the "Fees & tax" line on `!totals.isEmpty`. The trip screen's extra `"Due today"` branch is also under `!totals.isEmpty`, so empty still renders "—". Single shared `useCartTotals` + `formatCurrency`, single RN codebase → automatic iOS / Android / web parity.

Test: `mingla-business/src/components/checkout/__tests__/orch_1152_empty_cart_currency_crash.adversarial.render.test.tsx`
Config: `mingla-business/jest.orch1152.render.cjs` → **9/9 PASS**.

---

## 2. Shared-util hardening (Layer 1) assertions

`mingla-business/src/utils/currency.ts` — `formatCurrency`/`formatCurrencyRound`/`formatMoney` now route the code through `normalizeCurrency` (trim+upper, empty/blank/undefined → "GBP") before Intl.

| Assertion | Result |
|---|---|
| `formatCurrency(x, "")` does not throw, returns "£0.00"/"£65.00" | PASS |
| `formatCurrency(x, undefined as any)` does not throw | PASS |
| `formatCurrency(x, "   ")` (whitespace) does not throw → "£0.00" | PASS |
| `formatCurrency(x, "\t\n")` (tab/newline) does not throw → "£0.00" | PASS (my adversarial extension) |
| lowercase `"gbp"` → "£10.00"; mixed-case `"UsD"` → "$99.00" (normalises) | PASS (my adversarial extension) |
| `formatCurrencyRound(x, "")` / `formatMoney({currency:""})` safe | PASS |
| Valid codes format IDENTICALLY: `"GBP"`→"£156.20", `"USD"`→"$99.00", `"EUR"`→"€8,420.00", round "GBP"→"£24,180" | PASS |

Implementor test (`orch_1152_empty_cart_currency_crash.test.ts`) **10/10 PASS**.

**P3 boundary (out of scope, Discovery):** `normalizeCurrency` only guards EMPTY/BLANK — it does NOT validate against ISO 4217. So a junk non-empty symbol like `"$"` still reaches Intl and throws `RangeError: Invalid currency code`. My test asserts this CURRENT behavior honestly (`formatCurrency(5,"$")` throws). This is correctly out of scope: the shipped S0 was the empty-string case (a real cart state); a cart currency always comes from a valid DB ISO code, never `"$"`. Routed as a Discovery.

---

## 3. R2 non-regression

| Check | Result |
|---|---|
| Populated pass-fee cart leads with the all-in headline (£67.93-class) across event/trip/experience | PASS (R2 render 12/12) |
| Single combined "Fees & tax" line renders the delta (£2.93) | PASS |
| `orch_1147r2_selection_allin.test.ts` (R2 jest) | PASS 17/17 |
| `orch-1147r2-selection-shows-allin.mjs` strict-grep gate | PASS |
| `orch-1147-cart-total-is-allin` / `orch-1147-allin-single-owner` / `orch-1147-web-charge-allin` gates | PASS (all 3) |
| `orch-1130-no-buyer-tax-form` gate | PASS |

The Layer-2 guard deliberately preserves the `const headlineAllIn = formatCurrency(totals.allInTotal, …)` head, so the R2 source-text gate stays green. No existing R2 test modified (append-only).

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Re-ran on `currency.ts` at committed HEAD by TRUE line deletion (`const code = normalizeCurrency(currency)` → `const code = currency.toUpperCase()`, both call sites):

- **Layer-1 reverted → implementor's `orch_1152_empty_cart_currency_crash.test.ts`: 5 failed / 5 passed.** The 5 Layer-1 assertions throw `RangeError: Invalid currency code : ` (empty code). Confirmed independently.
- **Restored → 10/10 PASS.**

The implementor's `selectionHeadline` helper test stays GREEN on a Layer-1-only revert because that helper carries the Layer-2 `isEmpty ? "GBP"` guard — confirming the implementor's stated claim that reproducing the shipped headline crash in THEIR test needs BOTH layers reverted. (My render test improves on this — see §5.)

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/components/checkout/__tests__/orch_1152_empty_cart_currency_crash.adversarial.render.test.tsx`
- **Config:** `mingla-business/jest.orch1152.render.cjs` (RN preset + RTL + react-test-renderer; excluded from the default node config via the `jest.config.cjs` ignore-list entry — no RTL there).
- **Commit:** `95567b0a5` (on-branch, in `git diff origin/main...HEAD`).
- **Different angle:** the implementor's test is math-replication + a hand-rolled STRING helper that never mounts React; the R2 render test mounts the bottom bar but ONLY against a POPULATED cart (its CartSeeder gates on `lines.length > 0`), so it never enters the crash state. Mine MOUNTS the REAL `CartProvider` EMPTY with the ORIGINAL unconditional screen headline — the exact shipped crash shape — plus a live qty0→empty transition and a non-GBP-cart-emptied path.
- **fails-on-revert verified at `95567b0a5`:** reverting Layer 1 (`normalizeCurrency` → `currency.toUpperCase()`) makes all 5 empty-cart REAL mounts throw `RangeError: Invalid currency code : ` from `render()` (6 failed / 3 passed); restoring → 9/9 PASS. The crash is reproduced via actual component render, not a string helper.
- **Both tests in closing diff:** implementor `orch_1152_empty_cart_currency_crash.test.ts` + tester `…adversarial.render.test.tsx` both appear in `git diff origin/main...HEAD --name-only`.

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No new control; Continue still `disabled={isEmpty}`. |
| 2 | One owner per truth | PASS | `formatCurrency`/`normalizeCurrency` remain single-owner; no second formatter introduced. |
| 3 | No silent failures | PASS | Crash REMOVED; safe fallback is display-only ("—" shown on empty), never a swallowed error. |
| 4 | One query key per entity | N/A | No data fetching touched. |
| 5 | Server state server-side | N/A | Cart is in-memory React Context (no Zustand/server-state change). |
| 6 | Logout clears everything | N/A | Untouched. |
| 7 | `[TRANSITIONAL]` labelled | N/A | No transitional code added. |
| 8 | Subtract before adding | PASS | Hardening reuses existing `normalizeCurrency`; no parallel helper added. |
| 9 | No fabricated data | PASS | Empty fallback is "GBP" used ONLY for the never-displayed empty computation; "—" is rendered, never a fake price/charge. |
| 10 | Currency-aware | PASS | Valid codes format IDENTICALLY (£/$/€ verified); USD non-GBP path render-proven. |
| 11 | One auth instance | N/A | Anon/buyer checkout; no `useAuth` added. |
| 12 | Validate at the right time | N/A | No datetime logic. |
| 13 | Exclusion consistency | N/A | N/A. |
| 14 | Persisted-state startup | N/A | Cart not persisted. |

No violations.

---

## 7. Device / parity matrix

| Surface | Status | Notes |
|---|---|---|
| Business iOS | PASS (component-render proven) | Empty-cart mount no longer crashes; render-proof mounts the real provider + screen headline shape. Sim mount not separately driven — gated below. |
| Business Android | PASS (parity) | Shared RN codebase; identical `useCartTotals`/`formatCurrency` path; automatic parity. |
| Buyer/anonymous Web (mingla-business web) | PASS (parity) | Same 3 routes render via the same code. |
| Business Web preview (adjacent) | PASS (parity) | Same shared code. |
| Consumer iOS/Android (app-mobile) | N/A | Separate codebase; consumer cart already correct (ORCH-1025); untouched. |
| Admin Web (adjacent) | N/A | No checkout/currency surface touched. |

**Sim/device note:** the mandatory empty-state proof was achieved at the strongest available rung — a REAL react-test-renderer mount of the production `CartProvider` + the original crashing screen headline shape (`proven`-class for the crash logic). A full Expo sim mount of the three route screens was not separately driven; the component-render proof is the dispatch's stated mandatory bar and it reproduces and refutes the exact shipped `RangeError`. If a belt-and-braces sim mount is wanted, drive `/checkout/<eventId>` from an empty cart on a booted business sim and confirm "—" + no redbox.

---

## 8. Discoveries for Orchestrator

1. **P3 — `normalizeCurrency` does not validate ISO 4217.** Empty/blank/undefined are guarded, but a junk non-empty code (`"$"`, `"FOO"`) still reaches Intl and throws `RangeError: Invalid currency code`. Zero live blast radius (cart currencies are DB-sourced valid ISO). A fully crash-proof formatter would try/catch with a fallback. Lower priority; not the shipped S0.
2. **PRE-EXISTING (not ORCH-1152):** `meta_orch_0952_carousel_*.test.ts` are Playwright files that jest mis-collects and reports as failed suites (present on origin/main). And `PaymentPlanEditor_adversarial.test.ts` has 2 failing ORCH-0873 source-grep assertions on `MoneyTabBody` — also failing identically on origin/main (2/18). Neither is touched by or related to ORCH-1152.
3. **PRE-EXISTING (carried from implementor report):** `eventDraftsCurrency.test.ts` TS2353 compile error + whole-project `tsc` not green on origin/main. Standing baseline, not ORCH-1152.

---

## 9. Test/gate results (full)

```
GATES (strict-grep):
  orch-1130-no-buyer-tax-form ............... PASS
  orch-1147r2-selection-shows-allin ......... PASS
  orch-1147-cart-total-is-allin ............. PASS
  orch-1147-allin-single-owner .............. PASS
  orch-1147-web-charge-allin ................ PASS

JEST:
  orch_1152_empty_cart_currency_crash.test.ts (implementor) ... 10/10 PASS
  orch_1152_…adversarial.render.test.tsx (tester) ............. 9/9  PASS
  orch_1147r2_selection_allin.test.ts (R2 jest) .............. 17/17 PASS
  orch_1147r2_selection_allin.render.test.tsx (R2 render) ... 12/12 PASS
  full checkout __tests__ default config .................... 82/82 tests PASS
    (2 "failed suites" = pre-existing Playwright mis-collection, unrelated)

FAILS-ON-REVERT (Layer 1 true line-deletion @ 95567b0a5):
  tester adversarial render: 6 failed / 3 passed → 5 empty-cart REAL mounts throw
    RangeError: Invalid currency code :   (restored → 9/9 PASS)
  implementor happy-path:    5 failed / 5 passed (restored → 10/10 PASS)
```

---

## Verdict: PASS

The shipped S0 `RangeError: Currency is invalid` is fixed and the fix is **render-proven**: all three checkout screens mount on the empty cart without throwing and show "—". Layer 1 (root-class util hardening) and Layer 2 (per-screen guard) both verified; either alone now prevents the crash (defense in depth). R2 all-in behavior intact; all 1147*/1130 gates green; no constitutional violations. The one boundary (junk-ISO-code, P3) is out of scope with zero live blast radius. Routes to CLOSE.
