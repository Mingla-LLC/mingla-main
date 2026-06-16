# IMPLEMENTATION — ORCH-1147R2 [cart SELECTION screen must show the all-in price, not the bare base]

**Status:** implemented and verified (source + gate + jest; runtime device proof deferred to tester on a synthetic pass-fee fixture per SPEC §11).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1147R2-[cart-selection-screen-allin]/` on branch `ORCH-1147R2-cart-selection-screen-allin` (rebased on origin/main `676369448`, 0 behind).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1147R2_CART_SELECTION_SCREEN_ALLIN.md` (followed exactly; touched ONLY the §"Scoped allowlist").
**Implementation commit:** `f03cd66c3`.
**Comms ledger:** read on entry. No `BLOCK`+`OPEN` row targets mingla-implementor / ORCH-1147R2 / ALL. The OPEN `ALL` rows (COMMS-0002/0003/0004/0011/0012/0013/0015/0016/0018/0019/0021/0024/0025/0027/0028/0032/0035) are WARN/FYI — `biz_update_live_trip` migration coordination, HEIC/expo-image-manipulator native drift, OTA cache hygiene — none touch checkout-display code. Read, no action this turn. No new COMMS discovered.

---

## 1. Summary

The business-app ticket-SELECTION step ("Get tickets · Select your tickets · 1 OF 3") now leads with the TRUE all-in price (e.g. `$67.93`) — the same number the public page shows — instead of the bare base (`$65`), for event / trip / experience. R1 already computed and seeded the all-in (`allInTotal`, `feesTaxCents`, per-tier `priceAllInGbp`) and bound it on the payment step; R2 is a pure DISPLAY bind of that existing data onto the selection screen's two surfaces:

- **Per-tier QuantityRow** — the business wrapper now forwards `priceAllInGbp` into the adapter object, so the shared row renders the per-tier all-in + the quiet "incl. VAT & fees" caption (falls back to base + no caption when null/free — no fabrication).
- **Sticky bottom bar** — the headline relabels "Subtotal" → "Total" bound to `totals.allInTotal`, with a single combined "Fees & tax" line gated on `feesTaxCents > 0` (never split service-fee + VAT); the Continue accessibility label uses the all-in. The trip installments "Due today" deposit branch is untouched, and the Fees & tax line is suppressed on the installments path.

No math/engine/RPC/migration/edge change. `payment.tsx` ×3 and `CartContext.tsx` are byte-unchanged (`total`/`subtotal` stay base).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-1 (event) | Selection headline == `allInTotal` (not base); label "Total" | ✓ verified (jest T-1 + source-text + gate) | `f03cd66c3` |
| SC-1-iOS / -Android / -Web | identical (shared RN files) | ✓ auto (one codebase) | `f03cd66c3` |
| SC-2 (trip) | Full-total branch all-in; installments "Due today" deposit UNCHANGED, no Fees & tax line | ✓ verified (jest T-2/T-3 + source-text) | `f03cd66c3` |
| SC-3 (experience) | Same as SC-1 for experience selection | ✓ verified (jest T-4 + source-text + gate) | `f03cd66c3` |
| SC-4 (per-tier, all 3) | QuantityRow price == tier all-in + caption; base + no caption when null/free | ✓ verified (wrapper forward + gate + jest source-text) | `f03cd66c3` |
| SC-5 (combined Fees & tax) | Exactly ONE "Fees & tax" line when `feesTaxCents > 0`; none + Total==base when 0 | ✓ verified (jest T-1/T-5/T-6/T-7) | `f03cd66c3` |
| SC-6 (Continue a11y) | a11y label uses the all-in (full-total branch); free/empty/deposit unchanged | ✓ verified (source-text + gate) | `f03cd66c3` |
| SC-7 (no payment regression) | `payment.tsx` ×3 byte-unchanged | ✓ verified (not in commit; R1 gate green) | n/a |
| SC-8 (no buyer tax form) | `orch-1130-no-buyer-tax-form.mjs` GREEN | ✓ verified (ran: passed) | n/a |
| SC-9 (base not repurposed) | `useCartTotals.total`/`.subtotal` still base; CartContext untouched | ✓ verified (CartContext not in commit; R1 test 18/18) | n/a |

---

## 3. Files changed (commit `f03cd66c3`)

| File | Type | Δ |
|------|------|---|
| `mingla-business/src/components/checkout/QuantityRow.tsx` | source | +6 (1 field + comment) |
| `mingla-business/app/checkout/[eventId]/index.tsx` | source | +~35 (derived vars, fees line, relabel, a11y, 3 styles) |
| `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | source | +~35 |
| `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | source | +~40 (installments-aware) |
| `mingla-business/src/components/checkout/__tests__/orch_1147r2_selection_allin.test.ts` | NEW test | +~250 |
| `.github/scripts/strict-grep/orch-1147r2-selection-shows-allin.mjs` | NEW gate | +~210 |
| `.github/workflows/strict-grep-mingla-business.yml` | gate registration | +12 |

Only these 7 files staged/committed. The spec (`Mingla_Artifacts/specs/SPEC_ORCH-1147R2_...md`) and this report are orchestrator-owned and left untracked in the worktree.

---

## 4. Data-model changes applied

None. No tables / columns / constraints / indexes / RLS touched. R2 is component-layer-only.

---

## 5. Edge functions touched

None. No edge functions, RPCs, or `_shared/` touched. Nothing to deploy.

---

## 6. Regression tests added

- **Path:** `mingla-business/src/components/checkout/__tests__/orch_1147r2_selection_allin.test.ts` (NEW, append-only).
- **Count:** 17 tests, all green. Two layers: (1) pure cart-math against the real `useCartTotals` reduce (T-1..T-7 — headline reads `allInTotal`, fees line gated on `hasFeesTaxDelta`, RPC-miss/absorb/free fall to base, no fabrication, trip deposit suppresses the line); (2) source-text fails-on-revert across all four changed files.
- **Strict-grep gate:** `.github/scripts/strict-grep/orch-1147r2-selection-shows-allin.mjs` (NEW, `--self-test` supported, comment-stripping). Registered as job `orch-1147r2-selection-shows-allin` in `strict-grep-mingla-business.yml`.

### Fails-on-revert — PROVEN by TRUE LINE DELETION at commit `f03cd66c3`

**Axis 1 — per-tier forward (QuantityRow.tsx):** deleted the line `priceAllInGbp: ticket.priceAllInGbp ?? null,` from `ticketForPackage` (grep confirmed 0 occurrences post-delete).
- Gate output: `ORCH-1147R2 selection-shows-allin gate failed: - …/QuantityRow.tsx: ticketForPackage must forward priceAllInGbp …` → **exit 1**.
- Jest: `✕ the business wrapper forwards priceAllInGbp into ticketForPackage` → **1 failed, 16 passed**.
- Restored via `git checkout -- …/QuantityRow.tsx` → grep 1, gate + test green again.

**Axis 2 — bottom-bar all-in bind (event index.tsx):** rebound the full-total value branch from `: headlineAllIn}` to `: formatCurrency(totals.total, totals.currency)}` (true edit deleting the all-in bind; grep confirmed base bind present).
- Gate output: `…/checkout/[eventId]/index.tsx: the full-total headline/a11y binds to the bare base (formatCurrency(totals.total, …)). …` → **exit 1**.
- Jest: `✕ the full-total headline + a11y no longer bind to the bare base` → **1 failed, 16 passed**.
- Restored via `git checkout -- '…/checkout/[eventId]/index.tsx'` → gate **exit 0**, jest **17 passed**.

`fails-on-revert verified at f03cd66c3` on both axes (per-tier forward AND bottom-bar all-in bind). Working tree clean after restore (only the untracked orchestrator-owned spec remains).

---

## 7. Old → New receipts

### mingla-business/src/components/checkout/QuantityRow.tsx
**Before:** the `ticketForPackage` memo built the shared-row adapter with `priceGbp` but OMITTED `priceAllInGbp` entirely → the shared row fell to its base branch → per-tier base shown, no "incl. VAT & fees" caption.
**Now:** forwards `priceAllInGbp: ticket.priceAllInGbp ?? null` (the `TicketStub` already carries it; populated by all three index seeds) → the shared row renders the per-tier all-in + caption, exact parity with the public page.
**Why:** F-2 root cause (the single dropper). SC-4.
**Lines:** +6 (1 field + 4-line scoped comment).

### mingla-business/app/checkout/[eventId]/index.tsx
**Before:** bottom-bar headline labeled "Subtotal" bound to `formatCurrency(totals.total, …)` (base); Continue a11y `…total ${formatCurrency(totals.total, …)}`.
**Now:** derives `headlineAllIn = formatCurrency(totals.allInTotal, …)` and `showFeesTaxLine = !isEmpty && !isFree && hasFeesTaxDelta`; renders a gated "Fees & tax" line (`formatCurrency(totals.feesTaxCents, currency, true)`) above a "Total" row bound to `headlineAllIn`; a11y `…total ${headlineAllIn}`. Empty (`"—"`) / free (`"Free"`) branches unchanged.
**Why:** F-1 root cause; SC-1/SC-5/SC-6.
**Lines:** +~35.

### mingla-business/app/checkout-experience/[experienceEventId]/index.tsx
**Before/Now:** identical to the event file (no installments branch).
**Why:** SC-3.
**Lines:** +~35.

### mingla-business/app/checkout-trip/[tripEventId]/index.tsx
**Before:** non-deposit label "Subtotal", full-total value + a11y bound to `formatCurrency(totals.total, …)`; deposit branch rendered `dueTodayCents`.
**Now:** the FULL-TOTAL (non-deposit) branch only — label "Total", value + a11y bound to `headlineAllIn`; `showFeesTaxLine` additionally gated on `dueTodayCents === null` so the Fees & tax line shows only on the full-total path. The installments "Due today" deposit branch (`formatCurrency(dueTodayCents, …, true)`) and its label are BYTE-UNCHANGED.
**Why:** SC-2; the single manual-care parity point (deposit branch is a separate Seth-binding truth).
**Lines:** +~40.

---

## 8. Cross-surface impact

| # | Surface | Affected | Behavior | Parity |
|---|---------|----------|----------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | own `TicketCartSheet`, already all-in | — |
| 2 | Consumer Android | NO | same | — |
| 3 | Buyer / anon Web (`mingla-business` `/checkout/*`) | YES | selection bottom bar + per-tier row all-in; Fees & tax line on delta | Auto (shared RN), except trip deposit branch (manual — handled) |
| 4 | Business iOS | YES | same | Auto via shared CartContext + wrapper |
| 5 | Business Android | YES | same | Auto (shared RN) |
| 6 | Admin Web | NO | no buyer checkout surface | — |
| 7 | Business Web preview | NO | non-buyer surface | — |

Manual-parity point: the trip bottom bar's two branches (full-total vs installments deposit) — only the full-total branch changed; deposit branch unchanged. Verified by jest T-2/T-3 + source-text assertions.

---

## 9. Smoke result

- **Strict-grep gate** `orch-1147r2-selection-shows-allin.mjs`: `--self-test` PASS; live run PASS.
- **R1 gate** `orch-1147-cart-total-is-allin.mjs`: PASS (no payment-step regression).
- **orch-1130-no-buyer-tax-form.mjs**: PASS (SC-8).
- **Jest** `orch_1147r2_selection_allin.test.ts`: 17/17 PASS. **R1 jest** `orch_1147_cart_allin_total.test.ts`: 18/18 PASS (no regression).
- **tsc** (`mingla-business`): 325 pre-existing errors (project-wide baseline), ZERO in any of the 4 touched source files — the errors are all in `buyer.tsx` / unrelated files. No new type error introduced.
- **Runtime device proof:** NOT run this pass. Per SPEC §Repro-evidence + §11, runtime visual proof requires a SYNTHETIC pass-fee charges-enabled fixture (0/8 prod brands pass a fee → base==all-in on prod data, so a sim run on prod data renders `$65==$65` and proves nothing). Deferred to the tester (T-10).

---

## 10. Known issues / deferred

- **OQ-R2-2 (PARKED):** US/NG exclusive-tax residual — `priceAllInGbp` folds fees but excludes exclusive tax. Zero blast today (all charges-enabled brands inclusive GB/EU/CH). Not fixed here, per dispatch.
- No `[TRANSITIONAL]` code introduced.
- `I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN` enforcement is WIRED (gate references it by name; test + site comments cite it) but the registry ROW is orchestrator-owned (`INVARIANT_REGISTRY.md` is a global index, not in the implementor allowlist) and stays DRAFT — the orchestrator flips it ACTIVE at CLOSE.

---

## 11. Operator action required

- **Migration `db push`:** NONE (no migration).
- **Edge-fn deploy:** NONE.
- **Next phase:** tester device-verify on a synthetic pass-fee charges-enabled fixture (SPEC §11 T-10) across event/trip/experience × business iOS + Android + buyer-web; a green run on prod data is non-probative.
- **At CLOSE (orchestrator):** flip `I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN` DRAFT→ACTIVE in `INVARIANT_REGISTRY.md`; OTA the business app (pure RN/JS, runtime 1.0.0); ensure both the implementor happy-path test and the tester adversarial test are in the closing PR diff.

---

## 12. Discoveries for orchestrator

- **Tester masking gotcha (carry forward from R1):** a green visual test on prod data is non-probative — 0/8 prod brands pass a fee → base==all-in. The tester MUST use a synthetic pass-fee charges-enabled brand fixture so base ≠ all-in, otherwise the all-in bind is unproven at runtime.
- No unrelated bugs found in the touched files. The 325 pre-existing `tsc` errors (implicit-`any` in `buyer.tsx` and others) are a project-wide baseline, untouched by R2 — flagged only as context, not introduced here.
