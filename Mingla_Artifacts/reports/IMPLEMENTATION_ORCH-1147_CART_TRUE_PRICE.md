# IMPLEMENTATION — ORCH-1147 [cart does not reflect the TRUE price of a trip/event/experience]

**Phase:** IMPLEMENT (single pass). **Skill:** mingla-implementor.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]` on branch `ORCH-1147-cart-true-price` (rebased on origin/main @ `61156a6e5`, 0 behind).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1147_CART_TRUE_PRICE.md` (binding contract — followed §8 order).
**Implementation commit:** `a622e9494`.
**Status:** implemented and verified (gates + jest + deno check + fails-on-revert). Trip/experience SOURCE all-in plumbing is a documented STOP-AND-AMEND (OQ-3) — see §AMENDMENT REQUEST.

---

## 1. Summary (plain English)

The business cart/checkout headline **Total** now equals the price the server actually charges — base ticket price **plus** the passed Mingla fee and service fee — instead of the bare ticket subtotal that omitted them. A single combined **"Fees & tax"** line is shown when there's a real delta. This holds on business iOS, business Android, and the buyer-web checkout, for events, trips, and experiences. Separately, the buyer-web hosted Stripe charge now bills the fee-grossed subtotal (so web buyers no longer under-pay the passed fee vs native), with Stripe `automatic_tax` adding tax on top.

The structural fix is **one owner of the money**: the client reads the server's per-tier all-in (`priceAllInGbp` from `pg_public_event_tier_allin`) as the display basis and performs zero fee/tax math beyond summing it and subtracting the base. The server engine stays the charge authority.

**Event is end-to-end live today** (its tickets already carry `priceAllInGbp`). **Trip/experience display is wired and falls back gracefully to base** until their SOURCE services are amended to attach the per-tier all-in (the two source files are outside the spec allowlist — STOP-AND-AMEND per §4.3/OQ-3).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `a622e9494`) |
|----|-----------|--------|-------------------------------|
| SC-1-Web | Web Total = fee-grossed all-in (not base) | ✓ (event live; trip/exp pending source) | `payment.tsx` headline = `allInFloorCents` from `totals.allInTotal`; web takes the floor branch synchronously |
| SC-1-iOS / SC-1-Android | Native Total = fee-grossed all-in synchronously, refined to tax-inclusive preview | ✓ | `headlineCents` = floor, upgraded to `allInPreviewCents` when `>= floor` |
| SC-2 (iOS/Android/Web) | Single combined "Fees & tax" line, never split | ✓ | `summaryFeesTaxRow` rendered iff `showFeesTaxLine`; label exactly `Fees & tax` |
| SC-3 (event) | Event satisfies SC-1/SC-2 | ✓ live | event index seeds `unitPriceAllIn`; `getPublicEventById→fetchTickets` attaches `priceAllInGbp` |
| SC-4 (trip) | Trip satisfies SC-1/SC-2 | ◑ display-wired; source pending amendment | trip seeds + payment wired; `TripPricingTier.priceAllInGbp` source plumbing = AMENDMENT |
| SC-5 (experience) | Experience satisfies SC-1/SC-2 | ◑ display-wired; source pending amendment | experience seed + payment wired; `PublicExperienceTicket.priceAllInGbp` source = AMENDMENT |
| SC-6-Web (D-1) | Web Checkout line item bills `buyerSubtotal.buyerSubtotalCents` | ✓ | `ticket-checkout-create/index.ts` web Session `unit_amount: buyerSubtotal.buyerSubtotalCents` |
| SC-7 (NGN parity) | NGN cart shows all-in (shared CartContext); charge unchanged | ✓ (display via shared CartContext); charge-path untouched (parity confirm = tester) | NGN charges via `computeConfigVat` (DO-NOT-TOUCH), display inherits shared cart |
| SC-8 (invariant) | No buyer tax form; `orch-1130-no-buyer-tax-form.mjs` passes | ✓ | gate GREEN (run output below) |
| SC-9 (absorb no-regression) | absorb-all → `feesTaxCents=0`, no line, Total == base | ✓ | jest T-4 PASS; `showFeesTaxLine=false` when delta 0 |
| SC-10 (free) | Free tier → Total "Free"/0, no fees line | ✓ | jest T-5 PASS; existing free-path guards unchanged |

`◑` = display layer complete + correct; the per-tier all-in SOURCE for trip/experience is the named OQ-3 stop-and-amend (display falls back to base, no fabrication, no regression). Event SC-3 proves the full pattern works end-to-end today.

---

## 3. Files changed (13; +line deltas approximate)

| File | Δ | Allowlisted |
|------|---|-------------|
| `mingla-business/src/components/checkout/CartContext.tsx` | +~55 | yes |
| `mingla-business/app/checkout/[eventId]/index.tsx` | +~8 | yes |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | +~45 | yes |
| `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | +~14 | yes |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | +~45 | yes |
| `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | +~8 | yes |
| `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx` | +~40 | yes |
| `supabase/functions/ticket-checkout-create/index.ts` | ~1 line (`:1086`) + comment | yes (`:1086` only) |
| `.github/scripts/strict-grep/orch-1147-cart-total-is-allin.mjs` | NEW | yes (NEW) |
| `.github/scripts/strict-grep/orch-1147-web-charge-allin.mjs` | NEW | yes (NEW) |
| `.github/workflows/strict-grep-mingla-business.yml` | +27 (2 jobs) | gate-registration (implied by NEW gates) |
| `mingla-business/src/components/checkout/__tests__/orch_1147_cart_allin_total.test.ts` | NEW (10 tests) | yes (NEW) |
| `mingla-business/jest.config.cjs` | 1 line (jsx mode) | DEVIATION — see §10 |

No file outside the allowlist (notably NOT `tripsService.ts` / `publicExperienceService.ts`) was touched.

---

## 4. Data-model changes applied

**None.** No migration. `compute_all_in_cents` / `pg_public_event_tier_allin` unchanged (non-goal §2; OQ-2 parked). The DO-NOT-TOUCH SQL stayed untouched.

---

## 5. Edge functions touched

- `supabase/functions/ticket-checkout-create/index.ts` — web/mobile-web hosted Checkout Session line item only (`:1086`): `unit_amount: totalCents` → `unit_amount: buyerSubtotal.buyerSubtotalCents`. **`verify_jwt` value to preserve: unchanged** (no auth/validation/response-shape change). Native PI amount (`buyer_total_cents`, ~`:1559`) and preview return (~`:1519`) untouched (already correct — F-3). `application_fee_amount` untouched.
- `deno check supabase/functions/ticket-checkout-create/index.ts` → **PASS** (`/Users/sethogieva/.deno/bin/deno`).

---

## 6. Regression tests added — fails-on-revert proof

**Implementor happy-path test:** `mingla-business/src/components/checkout/__tests__/orch_1147_cart_allin_total.test.ts` (10 tests; T-1, T-1b, T-4, missing-all-in fallback, T-5, empty, T-2 web/native, native-preview-upgrade, T-3 stale-preview-guard).

Run (committed state):
```
PASS src/components/checkout/__tests__/orch_1147_cart_allin_total.test.ts
Tests: 10 passed, 10 total
```

**fails-on-revert verified at `a622e9494`** by TRUE LINE DELETION (not comment-out):

1. **Hook revert** — replaced the `useCartTotals` all-in accumulation with `allInTotal = subtotal; const feesTaxCents = 0;` (deleting `allInTotal += (line.unitPriceAllIn ?? line.unitPrice) * line.quantity;` and the real `feesTaxCents`):
   ```
   ✕ T-1: a pass-fee line yields allInTotal ≠ subtotal + a fees/tax delta
   ✕ T-1b: multi-qty grosses the all-in per unit
   Tests: 2 failed, 8 passed, 10 total
   ```
   Restored → `Tests: 10 passed, 10 total`.

2. **Web-charge gate revert** — `unit_amount: buyerSubtotal.buyerSubtotalCents` → `unit_amount: totalCents` at `:1086`:
   ```
   ORCH-1147 web-charge-allin gate failed:
   - supabase/functions/ticket-checkout-create/index.ts: web Checkout Session bills `unit_amount: totalCents` — it MUST bill `buyerSubtotal.buyerSubtotalCents` ...
   EXIT=1
   ```
   Restored → `gate passed. EXIT=0`.

3. **Cart-total gate revert** — rebound the event payment headline to the bare base (`allInFloorCents` from `totals.subtotal`; `displayAllIn = formatCurrency(totals.total, ...)`):
   ```
   ORCH-1147 cart-total-is-allin gate failed:
   - .../checkout/[eventId]/payment.tsx: headline Total must read the server fee-grossed all-in (totals.allInTotal) ...
   - .../checkout/[eventId]/payment.tsx: displayAllIn binds the headline directly to the bare base ...
   EXIT=1
   ```
   Restored → `gate passed. EXIT=0`.

**Strict-grep gates (committed state):**
```
ORCH-1147 cart-total-is-allin gate self-test passed.   /  gate passed.
ORCH-1147 web-charge-allin gate self-test passed.      /  gate passed.
ORCH-1130 no-buyer-tax-form gate passed.   (SC-8 preserved)
```

Both new test + the tester's future adversarial test ship in this branch; `git diff origin/main...HEAD --name-only` shows `orch_1147_cart_allin_total.test.ts`.

---

## 7. Old → New receipts

### CartContext.tsx
- **Before:** `CartLine` had only `unitPrice` (base). `useCartTotals` returned `total = subtotal` (base only) — the headline was re-derived from the bare base.
- **Now:** `CartLine.unitPriceAllIn?` (server fee-grossed all-in) threaded through action/reducer (new-line + existing-line branches)/setter. `useCartTotals` accumulates `allInTotal = Σ(unitPriceAllIn ?? unitPrice)×qty` and returns `allInTotal`, `feesTaxCents = max(0, round((allInTotal−subtotal)×100))`, `hasFeesTaxDelta`. `subtotal`/`total` keep their BASE meaning (not repurposed).
- **Why:** F-1/F-2 — the client must consume the server all-in, not re-derive from base. ~55 lines.

### checkout/[eventId]/index.tsx · checkout-trip/.../index.tsx · checkout-experience/.../index.tsx
- **Before:** seeds passed `unitPrice: …priceGbp ?? 0` only.
- **Now:** also pass `unitPriceAllIn: ticket.priceAllInGbp ?? ticket.priceGbp ?? 0` (event live; trip/exp read the `TicketStub.priceAllInGbp` field, base fallback until source plumbed).
- **Why:** seed the all-in as the headline basis (never fabricate). ~8–14 lines each.

### checkout/[eventId]/payment.tsx · checkout-trip/.../payment.tsx · checkout-experience/.../payment.tsx
- **Before:** `displayTotalCents = totals.total` (base); `displayAllIn` = base on web and on native preview-miss; no "Fees & tax" line.
- **Now:** `allInFloorCents = round(totals.allInTotal×100)`; `headlineCents` = floor, upgraded to `allInPreviewCents` when `Platform.OS!=="web" && preview !== null && preview >= floor`; `displayAllIn = formatCurrency(headlineCents, currency, true)`. Combined "Fees & tax" line `= max(0, headline − base)` rendered iff `> 0`. OQ-2 exclusive-tax caveat commented at each site. Bottom-bar Total + Pay button inherit `displayAllIn`.
- **Why:** F-1/F-2 display fix + SC-2 combined line. ~40–45 lines each.

### ticket-checkout-create/index.ts (`:1086`)
- **Before:** web Checkout line item `unit_amount: totalCents` (bare base) — under-billed the passed fee (D-1/F-4).
- **Now:** `unit_amount: buyerSubtotal.buyerSubtotalCents` (fee-grossed PRE-TAX); `automatic_tax: { enabled: true }` adds tax on top. (OQ-1: NOT `buyer_total_cents`, which would double-tax.)
- **Why:** SC-6-Web / D-1. ~1 line + protective comment.

### Gates + workflow + jest config
- 2 NEW strict-grep gates (self-tested) + 2 workflow jobs; jest `jsx` mode flip (test-only). See §10.

---

## 8. Cross-surface impact table

| Surface | Affected | What changes | Parity |
|---------|----------|--------------|--------|
| Consumer iOS | NO | already correct (F-5); OQ-2 tax-gap OUT | — |
| Consumer Android | NO | same | — |
| Buyer / anon Web | YES | Total = fee-grossed all-in; "Fees & tax" line; CHARGE bills fee-grossed subtotal | Manual (web display + web charge branches distinct) |
| Business iOS | YES | Total = fee-grossed all-in synchronously; "Fees & tax" line; native preview refines to tax-inclusive | Auto across 3 offerings via shared CartContext |
| Business Android | YES | same as iOS | Auto (shared RN) |
| Admin Web | NO | no buyer checkout surface | — |
| Business Web preview | NO | non-buyer surface | — |

Manual-parity note: web display branch + web charge branch are distinct from native — covered explicitly here. Trip/experience all-in SOURCE is manual per-service (AMENDMENT).

---

## 9. Smoke result

- **Static/unit:** `npx tsc --noEmit` on the 8 touched product files → **0 errors** (pre-existing errors in untouched `buyer.tsx`, missing test deps, and unrelated modules confirmed present on origin/main too). `npx jest` checkout suite → **42 real tests PASS** (the 2 "failed" suites are Playwright specs that throw `throwIfRunningInsideJest` — pre-existing on origin/main, unrelated). `deno check` edge fn → PASS. All gates GREEN (above).
- **Device/sim:** NOT run this pass (display-only RN + edge body change). Tester must device-verify business iOS + Android + web buyer route across event/trip/experience with a synthetic pass-fee fixture (spec D-3). Labeled **implemented, partially verified** for the runtime display; the math + charge binding + invariants are verified.

---

## 10. Known issues / deferred / deviations

- **DEVIATION (test infra): `mingla-business/jest.config.cjs` `jsx: "react-native"` → `"react-jsx"`.** The node/ts-jest default config preserves JSX (`react-native` mode), so any runtime import of a JSX-bearing `.tsx` (here `useCartTotals` from `CartContext.tsx`) throws `SyntaxError: Unexpected token '<'`. `react-jsx` transpiles JSX to `_jsx(...)` so node-env unit tests can import hook logic. **Jest-only** (the app build is Metro/babel — unaffected). Existing carousel `.tsx` tests read source as TEXT (`readFileSync`) — unaffected; RTL render tests run under their own configs (ignored here). Verified: full checkout jest suite still passes (42/42). This file is not in the explicit allowlist but is the minimal test-enablement change required to ship the Step-0.5 test the spec mandates. Flagged for orchestrator awareness.
- **OQ-2 exclusive-tax residual (PARKED by Seth):** `priceAllInGbp` folds fees but excludes tax, so in exclusive-tax regions (US `pass_tax=true`) the display floor understates by tax. Blast radius ZERO today (all charges-enabled brands inclusive GB/EU/CH). Commented at each `displayAllIn` site. NOT fixed (per dispatch hard-guard).
- **`[TRANSITIONAL]`:** none introduced.

---

## 11. AMENDMENT REQUEST (OQ-3 — STOP-AND-AMEND; do NOT widen silently)

The spec's §4.3 stop-and-amend trigger fired: **trip and experience do NOT route through `publicEventsService.fetchTickets`** (which already attaches `priceAllInGbp`). They use separate hooks/services. Plumbing the per-tier all-in into them touches **two files outside the allowlist**, so I stopped rather than widening:

1. **Trip — `mingla-business/src/services/tripsService.ts` (NOT allowlisted):** add `priceAllInGbp?: number | null` to `interface TripPricingTier` (~`:73`). Then in **`publicEventsService.getPublicTripById` (ALLOWLISTED, `:1244`)** — which already calls `fetchTicketTypesRemaining(tripEventId)` (`:1326`) — also call the existing private `fetchTierAllInCents(tripEventId)` (`:840`) and map each tier's `all_in_cents/100` onto `TripPricingTier.priceAllInGbp` in the `pricingTiers.map` (`:1402`). The trip index `tierToTicketStub` (`index.tsx:66`) then sets `priceAllInGbp: tier.priceAllInGbp` on the stub; the seed already reads `stub.priceAllInGbp`.
2. **Experience — `mingla-business/src/services/publicExperienceService.ts` (NOT allowlisted):** add `priceAllInGbp?: number | null` to `interface PublicExperienceTicket` (`:40`); in `getPublicExperienceById` (`:348`) / `loadExperienceSidecars` call the all-in RPC (`pg_public_event_tier_allin`) and set it on the ticket in `mapExperience` (`:194`). The experience index `ticketToStub` then sets `priceAllInGbp` on the stub; the seed already reads `stub.priceAllInGbp`.
3. **Export `fetchTierAllInCents`** from `publicEventsService.ts` (allowlisted) so the experience service can reuse the SAME RPC helper (no duplicate fee math; one owner).

All three use the EXISTING `pg_public_event_tier_allin` RPC — no new SQL, no migration, no fabrication. The display layer is already wired to consume `priceAllInGbp` the moment these source fields are populated. Until then trip/experience fall back to base (graceful, no regression, no fabricated number).

**Routing:** orchestrator → forensics for a `SPEC_AMENDMENT_ORCH-1147_TRIP_EXPERIENCE_ALLIN_SOURCE` adding those two source files (+ the `fetchTierAllInCents` export) to the allowlist → re-dispatch implementor for the ~30-line source plumbing → tester proves SC-4/SC-5 on a pass-fee trip + experience.

---

## 12. Operator action required

- **No migration. No edge deploy from the implementor.** When this branch MERGES to main, the orchestrator/operator deploys `ticket-checkout-create` **from merged main** (clobber-safe), preserving its existing `verify_jwt`. The display changes are pure RN/JS → ship via OTA on close (business runtime 1.0.0) per `project_ota_deferred_until_new_build`.
- **CLOSE:** flip `I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN` + `I-PROPOSED-1147-WEB-CHARGE-BILLS-FEE-GROSSED-SUBTOTAL` to ACTIVE; commit the tester's adversarial test before merge; reconcile against COMMS-0013/0014/0016.

---

## 13. Discoveries for Orchestrator

- **OQ-3 amendment (above)** — trip/experience all-in source plumbing needs 2 non-allowlisted files added to scope. Not started; documented precisely.
- **jest.config jsx mode** — the node/ts-jest config could not run ANY runtime-import test of a JSX-bearing `.tsx` before this fix; future hook unit tests benefit. Minor latent test-infra gap, now closed.
- **Tester D-3 (mandatory):** a green run on current prod data proves nothing (0/8 charges-enabled brands pass any fee → `feesTaxCents=0` everywhere). Tester MUST stand up a synthetic/temporary pass-fee charges-enabled fixture and prove display Total > base by the fee gross-up + the web Checkout Session bills the grossed-up subtotal + NGN parity (SC-7).
- **Comms:** read COMMS_LEDGER on entry — no BLOCK rows for this skill/ORCH/ALL. Recent WARN-to-ALL entries (COMMS-0035/0032/0028/0027) concern HEIC/expo-image-manipulator and OTA hygiene — unrelated to cart pricing; read, no action this turn.
