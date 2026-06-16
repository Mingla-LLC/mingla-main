# IMPLEMENTATION — ORCH-1152 [business checkout crashes on mount — `RangeError: Currency is invalid`]

**Status:** implemented and verified (jest + fails-on-revert; UI mount unverified on device — gated on REVIEW → tester).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1152-[checkout-currency-crash]/` on branch `ORCH-1152-checkout-currency-crash` (rebased on origin/main `7eaab06ea`).
**HEAD:** `7602f7bd3`.
**Class:** S0 regression introduced by ORCH-1147R2.

---

## 1. Summary

On entering any of the three business-app checkout selection screens the cart is EMPTY, so
`useCartTotals()` returns `currency = ""` (`CartContext.tsx:464` `let currency = ""`). ORCH-1147R2
added an UNCONDITIONAL `const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency)` at
the top of all three checkout `index.tsx` components. `formatCurrency("")` did
`new Intl.NumberFormat(locale, { currency: "" })`, which throws `RangeError: Currency is invalid` —
crashing the screen on mount. `headlineAllIn` is only *displayed* inside `!isEmpty`-guarded JSX, but
the *computation* ran every render and crashed first.

Two-layer fix (defense in depth):

- **LAYER 1 (root class).** `formatCurrency` and `formatCurrencyRound` now route their currency code
  through the existing `normalizeCurrency` safe-fallback helper (empty/blank/undefined → "GBP")
  instead of the bare `currency.toUpperCase()`. No caller can ever feed an empty code into Intl
  again. Valid codes format IDENTICALLY (e.g. `formatCurrency(156.20,"GBP")` → "£156.20").
- **LAYER 2 (specific trigger).** The three checkout screens guard the empty-cart currency:
  `const headlineAllIn = formatCurrency(totals.allInTotal, totals.isEmpty ? "GBP" : totals.currency)`.
  This deliberately keeps the `const headlineAllIn = formatCurrency(totals.allInTotal, …)` head so
  the ORCH-1147R2 source-text gate (`orch_1147r2_selection_allin.test.ts` +
  `orch-1147r2-selection-shows-allin.mjs`, which pin that exact expression) stays green, while still
  never feeding "" into Intl on the empty cart. `headlineAllIn` is only displayed when `!isEmpty`
  (empty renders the "—" placeholder), so the guard is purely belt-and-braces against the crash.

The ORCH-1147R2 populated-state behavior is intact: the selection bottom bar still leads with the
server fee-grossed all-in (e.g. £67.93) and shows the gated combined "Fees & tax" line.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-1 | `formatCurrency`/`formatCurrencyRound` never throw on empty/blank/undefined code (route through `normalizeCurrency`) | ✓ | `80b91cad0` |
| SC-2 | Valid codes format IDENTICALLY (no behavior change) | ✓ | `80b91cad0` (test asserts £156.20 / $99.00 / €8,420.00 / £24,180) |
| SC-3 | Three checkout `index.tsx` `headlineAllIn` no longer crash on the empty cart | ✓ | `7602f7bd3` (event/trip/experience) |
| SC-4 | ORCH-1147R2 populated selection still leads with the all-in (`I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN`) | ✓ | `7602f7bd3` — R2 jest 40/40 + R2 strict-grep gate pass |
| SC-5 | Empty-state happy-path test (currency "") does NOT throw, renders "—"; `formatCurrency(x,"")`/`(x,undefined)` return safe strings | ✓ | `80b91cad0` / `7602f7bd3` |
| SC-6 | Fails-on-revert proven by true line-deletion | ✓ | `7602f7bd3` (see §6) |

---

## 3. Files changed (vs origin/main)

```
mingla-business/src/utils/currency.ts                                         | 16 +- (+14/-2)
mingla-business/app/checkout/[eventId]/index.tsx                              | 11 +- (+10/-1)
mingla-business/app/checkout-trip/[tripEventId]/index.tsx                     | 11 +- (+10/-1)
mingla-business/app/checkout-experience/[experienceEventId]/index.tsx         | 11 +- (+10/-1)
mingla-business/src/components/checkout/__tests__/orch_1152_empty_cart_currency_crash.test.ts | +173 (NEW)
```
5 files, +217 / -5.

---

## 4. Data-model changes applied

None. Pure client display-layer + util hardening. No migration, no edge function, no schema/RLS.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

**Path:** `mingla-business/src/components/checkout/__tests__/orch_1152_empty_cart_currency_crash.test.ts` (NEW, append-only — no existing test modified or deleted).

**Run (committed HEAD `7602f7bd3`):**
```
ORCH-1152 LAYER 1 — formatCurrency never throws on a blank/invalid code
  ✓ formatCurrency(x, "") returns a safe string, does NOT throw
  ✓ formatCurrency(x, undefined as any) returns a safe string, does NOT throw
  ✓ formatCurrency(x, "   ") (blank/whitespace) does NOT throw
  ✓ formatCurrencyRound never throws on a blank code either
  ✓ formatMoney (the public wrapper) is safe on a blank code
  ✓ valid codes format IDENTICALLY to before the fix
ORCH-1152 LAYER 2 — checkout selection screen on the EMPTY cart
  ✓ empty cart yields currency '' (the crash trigger reproduced)
  ✓ selection headline does NOT throw on the empty cart + renders '—'
  ✓ populated cart still renders the all-in headline (ORCH-1147R2 intact)
  ✓ free cart renders 'Free', not a currency string
Tests: 10 passed, 10 total
```

**fails-on-revert verified at `7602f7bd3`** (TRUE line deletion, not comment-out): reverting Layer 1
(`const code = normalizeCurrency(currency)` → `const code = currency.toUpperCase()`) AND Layer 2 (the
test helper's `totals.isEmpty ? "GBP" : totals.currency` → bare `totals.currency`, mirroring the
pre-fix screen shape) produces:
```
  ✕ formatCurrency(x, "") returns a safe string, does NOT throw      → RangeError: Currency is invalid
  ✕ formatCurrency(x, undefined as any) ...                          → RangeError: Currency is invalid
  ✕ formatCurrency(x, "   ") ...                                     → RangeError: Currency is invalid
  ✕ formatMoney (the public wrapper) is safe on a blank code         → RangeError: Currency is invalid
  ✕ selection headline does NOT throw on the empty cart + renders '—' → RangeError: Currency is invalid  ← the exact shipped S0 crash
Tests: 5 failed, 5 passed, 10 total
```
The "selection headline does NOT throw on the empty cart" failure reproduces the shipped crash
precisely. Both files restored via `git checkout` → 10/10 GREEN again.

Layer 1 was ALSO independently proven RED in isolation (revert Layer 1 only → 4 Layer-1 assertions
throw `RangeError`).

---

## 7. Old → New receipts

### `mingla-business/src/utils/currency.ts`
- **Before:** `formatCurrency` / `formatCurrencyRound` set `const code = currency.toUpperCase()`; an
  empty/blank/undefined code reached `Intl.NumberFormat({ currency: code })` and threw
  `RangeError: Currency is invalid`.
- **Now:** both set `const code = normalizeCurrency(currency)` (the existing safe-fallback helper:
  trim+upper, empty → "GBP"). No code can crash currency formatting. Doc-comments updated with the
  `(0, "") → "£0.00"` safe-fallback example.
- **Why:** SC-1/SC-2 — root-class hardening (Constitution #3 no silent failure, AND no crash; #10
  currency-aware). ~14 lines (mostly comments; 2 logic lines).

### `mingla-business/app/checkout/[eventId]/index.tsx`, `…/checkout-trip/[tripEventId]/index.tsx`, `…/checkout-experience/[experienceEventId]/index.tsx`
- **Before:** `const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency)` — unconditional,
  ran on the empty cart with `totals.currency === ""` → crash on mount.
- **Now:** `const headlineAllIn = formatCurrency(totals.allInTotal, totals.isEmpty ? "GBP" : totals.currency)`
  — passes a safe code on the empty cart; the `formatCurrency(totals.allInTotal, …)` head is preserved
  so the R2 source-text gate stays green. `headlineAllIn` is still only displayed when `!isEmpty`.
- **Why:** SC-3/SC-4 — specific-trigger guard while preserving I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.
  ~10 lines each (mostly the 6-line explanatory comment).

The guarded in-JSX calls (`formatCurrency(totals.feesTaxCents, …)` under `showFeesTaxLine`, the trip
`dueTodayCents` calls under the `!isEmpty && !isFree` ternary) were already empty-safe and were left
unchanged; Layer 1 backstops them regardless.

---

## 8. Cross-surface impact

| Surface | Affected? | Detail / parity |
|---------|-----------|-----------------|
| Business iOS | YES | Checkout selection screens no longer crash on mount. Files: the 3 `index.tsx` + `currency.ts`. Parity automatic (shared RN codebase). |
| Business Android | YES | Same as iOS — shared code, automatic parity. |
| Buyer/anonymous Web (mingla-business web) | YES | Same 3 checkout routes render via the same code; automatic parity. |
| Business Web preview (adjacent) | YES | Same shared code. |
| Consumer iOS | NO | Consumer cart already correct (ORCH-1025); separate `app-mobile` codebase, untouched. |
| Consumer Android | NO | Same — untouched. |
| Admin Web (adjacent) | NO | No currency-checkout surface touched. |

`formatCurrency`/`formatCurrencyRound` are shared across the whole business app (J-A balances, KPI
tiles, payouts, etc.) — the hardening makes ALL of them blank-code-safe with zero behavior change for
valid codes. Parity is automatic everywhere (single util, single RN codebase).

---

## 9. Smoke result

Not run on device (gated on REVIEW → tester). Verified via jest: the empty-cart computation that
crashed on mount no longer throws and renders "—"; the populated cart still renders the all-in
(£52.25 in T-test; the real prod case is £67.93). Device mount of the three checkout screens from an
empty cart is the tester's runtime confirmation.

---

## 10. Known issues / deferred

- The empty-cart safe fallback uses `"GBP"` (matching `normalizeCurrency`'s existing default). This is
  a DISPLAY-ONLY value that is never shown (empty cart renders "—") and never charged/persisted — not
  a fabricated charge currency. Consistent with the established `normalizeCurrency` contract.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

- **No migration. No edge-function deploy.** Pure client display + util.
- **Route to REVIEW, then tester dispatch.** Tester should device-mount all three checkout screens
  (event / trip / experience) from an EMPTY cart on business iOS + Android and confirm no crash +
  "—" placeholder, then add a tier and confirm the all-in headline (R2) is intact.

---

## 12. Discoveries for Orchestrator

1. **PRE-EXISTING (not mine): `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts`
   fails to compile** — `TS2353: 'category' does not exist in type 'DraftEvent'` at line 70. Fails on
   clean origin/main independent of this ORCH (confirmed). Unrelated to ORCH-1152; flag for triage.
2. **PRE-EXISTING (not mine): whole-project `tsc -p tsconfig.json` reports 326 errors** on origin/main
   (e.g. `buyer.tsx` `implicit any` params) — the business app does NOT have a clean whole-project tsc
   gate; type safety is enforced per-suite via ts-jest. My touched files have ZERO tsc errors. Noting
   that the project-level tsc is not green as a standing baseline.
3. **Comms ledger:** no OPEN BLOCK/WARN entry addressed to implementor / ORCH-1152 / ALL required
   action this turn. COMMS-0027 (concurrent-OTA cache poisoning) is FYI-relevant only to sessions that
   OTA; this ORCH does not OTA.
