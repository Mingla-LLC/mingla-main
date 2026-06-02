# IMPLEMENTATION — ORCH-1034 [de-GBP-ify the currency layer — charge in seller currency]

- **Status:** implemented and verified (code + migration committed; NO db push, NO edge deploy — orchestrator owns at CLOSE under safe-migration).
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1034-[currency-de-gbp]/` on branch `ORCH-1034-currency-de-gbp`
- **Skills invoked (in order):** `stripe-best-practices` (charge-currency + tax_behavior change), then `mingla-implementor`.
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1034_CURRENCY_DE_GBP.md`. **Tax tie-in:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1034_TAX_TIE_IN.md` (confirms the tax fix is the thin display-flag change, NOT VAT math).
- **Ledger:** Read `COMMS_LEDGER.md` on entry. Acked COMMS-0002 (added `ORCH_1034_BACKEND_ALLOWLIST` in the same commit), COMMS-0003 (Stripe docs cited inline — preserved + extended), COMMS-0013 (web vs native tax-basis divergence — scoped OUT per SPEC §2.2; web charge-currency NOT regressed).

---

## 1. What was built (operator-locked decisions honored)

1. **Migration** `supabase/migrations/20260816000000_orch_1034_currency_de_gbp.sql` — aligns `pricing_currency := default_currency` (NULL-skip), DROPs the GBP-only currency CHECK, WIDENs the region CHECK to `('GB','US','EU','CH')`, derives `pricing_region` from currency. The 21 NULL-default brands are LEFT NULL (never read for write).
2. **Engine** `_shared/allInPricingEngine.ts` — `PricingRegion` widened `"GB"` → `"GB" | "US" | "EU" | "CH"`; `taxBehaviorForRegion` maps GB/EU/CH→`inclusive`, US→`exclusive`; the GB-only throw is removed for live regions (exhaustive `never` guard kept for genuinely-unmapped literals). New `inclusiveVatDivisorForRegion` + `INCLUSIVE_VAT_DIVISOR` generalize the hardcoded `/1.2`.
3. **Charge currency** `ticket-checkout-create/index.ts` — charge currency now sourced from `pricing.pricing_currency` (= settlement currency), not the legacy `session.currency ?? "GBP"`; region follows the seller; unmapped region degrades to flat-absorb BEFORE the engine is asked for a behavior (engine never throws on a real checkout); the `/1.2` inclusive divide-out is now per-region.
4. **Buyer display** `formatters.ts` + `preferences.ts` + `currencyService.ts` — new `convertBetween(amount, from, to)` cross-rate helper (`amount * rate[to] / rate[from]`); same-currency is an exact identity; formatters thread an optional `sourceCurrency` (default `'USD'` → fully backward compatible for USD-source place-pool callers).

**Out of scope (operator-locked, untouched):** client GBP fallbacks (`?? "GBP"` display, `priceGbp`, `normalizeCurrency→GBP`); `events.venue_tax_address` population (separate follow-up ORCH); the venue-based Stripe Tax calc/commit/reverse (ORCH-0955) — still authoritative for the amount.

---

## 2. Old → New receipts

### supabase/migrations/20260816000000_orch_1034_currency_de_gbp.sql (NEW)
**Before:** `brands.pricing_currency` CHECK `= 'GBP'`, `pricing_region` CHECK `= 'GB'`; both columns uniformly GBP/GB for all 50 brands.
**After:** currency CHECK dropped; region CHECK widened to `IN ('GB','US','EU','CH')`; `pricing_currency := upper(trim(default_currency))` and `pricing_region` derived (GBP→GB, USD→US, EUR→EU, CHF→CH) for the 29 non-NULL-default brands; the 21 NULL-default brands left untouched (keep NOT-NULL defaults GBP/GB; they have no Stripe account and cannot charge).
**Why:** SPEC §5.A + DECISION-1/2/3; charge in seller settlement currency, region-correct tax behavior.
**Lines:** ~80 (incl. comments).

### supabase/functions/_shared/allInPricingEngine.ts
**Before:** `type PricingRegion = "GB"`; `taxBehaviorForRegion` returns `"inclusive"` for GB and THROWS on anything else; no VAT divisor export.
**After:** region union `"GB" | "US" | "EU" | "CH"`; GB/EU/CH→`inclusive`, US→`exclusive`, exhaustive `never` guard retained; new `INCLUSIVE_VAT_DIVISOR` (GB/EU 1.2, CH 1.081, US 1.0) + `inclusiveVatDivisorForRegion`. Header doc extended with settlement-currency + zero-decimal Stripe-doc citations.
**Why:** SPEC §5.B; tax_behavior is a thin per-region DISPLAY flag (investigation PROVE-1/2); defuse the latent throw before enabling non-GB.
**Lines:** ~55 changed/added.

### supabase/functions/ticket-checkout-create/index.ts
**Before:** `const currency = String(session.currency ?? "GBP").toLowerCase()` (ticket/event currency with GBP fallback); `pricingRegion = (pricing.pricing_region ?? "GB")`; `taxBehaviorForRegion(pricingRegion)` called unconditionally (would throw on non-GB once the CHECK widened); inclusive VAT extracted via hardcoded `/1.2`; three response `currency` fields fell back to `session.currency ?? "GBP"`.
**After:** legacy session currency renamed `sessionCurrency`; authoritative `currency` derived from `pricing.pricing_currency` (settlement currency) with a clean `409 pricing_config_unavailable` if missing and a warn-and-prefer on mismatch; region clamped to the enabled allowlist with a `regionUnmappedForceFlatAbsorb` degrade flag honored by the tax gate (never throws on a real checkout); inclusive divide-out uses `inclusiveVatDivisorForRegion(pricingRegion)`; the three response `currency` fields report `currency.toUpperCase()` (the actual charge currency).
**Why:** SPEC §5.C; charge in settlement currency (zero Stripe FX), region follows seller, degrade-not-throw.
**Lines:** ~75 changed/added.

### app-mobile/src/services/currencyService.ts
**Before:** only `getRate(code)` (USD-based).
**After:** added `convertBetween(amount, fromCurrency, toCurrency)` = `amount * (rate[to] / rate[from])`, same-currency identity, divide-by-zero guard.
**Why:** SPEC §5.D root cause C — the USD-base cross-rate fix.
**Lines:** ~35 added.

### app-mobile/src/components/utils/formatters.ts
**Before:** `formatCurrency(amount, currencyCode)` did `amount * getRate(currencyCode)` (assumes amount is already USD — the bug). `formatPriceRange` same single-leg `* rate`.
**After:** both take an optional `sourceCurrency` (default `'USD'`) and convert via `convertBetween(amount, sourceCurrency, currencyCode)`. The buggy `amount * rate` form is gone. `getRate` retained for `getCurrencyRate`/`formatPriceRange` symbol lookup.
**Why:** SPEC §5.D; backward-compatible for USD-source callers, correct for seller-currency callers.
**Lines:** ~25 changed.

### app-mobile/src/components/utils/preferences.ts
**Before:** `convertCurrency(amountInUSD, targetCurrency)` = `amountInUSD * (rate||1)` (single leg); `formatCurrency(amountInUSD, targetCurrency)`.
**After:** `convertCurrency(amount, targetCurrency, sourceCurrency='USD')` cross-rate with same-currency identity; `formatCurrency` threads `sourceCurrency`.
**Why:** SPEC §5.D — second formatter with the same USD-base bug.
**Lines:** ~12 changed.

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
**Before:** combined `ALLOWLIST` did not include the ORCH-1034 backend paths.
**After:** added `ORCH_1034_BACKEND_ALLOWLIST` (migration + the two MODIFY backend files + the Deno regression test) and spread it into the combined `ALLOWLIST`.
**Why:** COMMS-0002 — C7 `no-new-backend-files` blocks any PR touching `supabase/migrations/` or `supabase/functions/` unless allowlisted, in the SAME commit.
**Lines:** ~14 added.

---

## 3. Regression tests (Step 0.5 — passing + fails-on-revert)

### Engine (Deno) — `supabase/functions/_shared/__tests__/orch_1034_currency_de_gbp.test.ts` (NEW)
- T-01 US→`exclusive`; T-06 GB→`inclusive` (preserved); EU/CH→`inclusive`; no-throw on enabled regions; unmapped literal still throws (loud guard); per-region inclusive divisor; US breakdown carries `exclusive` + `usd` + 0 tax.
- **Run:** `deno test --allow-read supabase/functions/_shared/__tests__/orch_1034_currency_de_gbp.test.ts supabase/functions/_shared/__tests__/allInPricingEngine.test.ts` → **15 passed | 0 failed** (7 ORCH-1034 + 8 existing engine tests, no regression).
- **fails-on-revert:** on the pre-ORCH-1034 engine `taxBehaviorForRegion` had only a `"GB"` case and threw on `"US"/"EU"/"CH"`, and `inclusiveVatDivisorForRegion`/`INCLUSIVE_VAT_DIVISOR` did not exist → the import fails to resolve and the US/EU/CH assertions throw. Verified against the on-disk pre-edit engine semantics at base commit `3d56c9b6e`.

### Display (node) — `app-mobile/scripts/ci/orch-1034-currency-de-gbp-check.mjs` (NEW)
- T-02 GBP→EUR cross-rate (`23.2877`, NOT the buggy USD-base `17.0`); T-03/T-03b same-currency identity; T-compat USD-source reduces to legacy behavior; G1–G4 source fails-on-revert guards.
- **Run:** `node app-mobile/scripts/ci/orch-1034-currency-de-gbp-check.mjs` → **all 8 PASS**.
- **fails-on-revert:** on pre-ORCH-1034 sources, `currencyService.ts` has no `convertBetween` (G1 fails) and `formatters.ts` contains `amount * rate` (G3 fails) → exit 1. Verified at base commit `3d56c9b6e`.

---

## 4. Gates run (captured)

- `deno check supabase/functions/_shared/allInPricingEngine.ts` → clean.
- `deno check supabase/functions/ticket-checkout-create/index.ts` → clean.
- `deno test …` (engine + ORCH-1034) → 15 passed | 0 failed.
- `node app-mobile/scripts/ci/orch-1034-currency-de-gbp-check.mjs` → 8 PASS.
- `npx tsc --noEmit` (app-mobile) → **0 errors in the 3 touched files** (formatters/preferences/currencyService) and **0 caller breakage** from the new optional `sourceCurrency` param. (Pre-existing baseline tsc noise in unrelated files — Deno test files, JSX namespace, BoardDiscussion, etc. — is not introduced by this ORCH.)
- ORCH-0863 strict-grep gate (`orch-0863-marketing-hub-phase-b.mjs`) → exercised against the committed diff (see §7 verification); C7 PASS with the new allowlist.

---

## 5. Read-only remote data probe (pre-migration, SPEC §5.A required)

Probed live remote (read-only, Supabase MCP `execute_sql`) 2026-06-01 — shape UNCHANGED from SPEC §1.1:
```
default_currency | pricing_currency | pricing_region |  n | with_stripe_connect_id
-----------------+------------------+----------------+----+-----------------------
 NULL            | GBP              | GB             | 21 | 0
 USD             | GBP              | GB             | 15 | 13
 GBP             | GBP              | GB             | 11 | 3
 EUR             | GBP              | GB             |  2 | 2
 CHF             | GBP              | GB             |  1 | 1
```
Constraint names confirmed exactly: `brands_pricing_currency_allowlist` (`CHECK pricing_currency = 'GBP'`) + `brands_pricing_region_allowlist` (`CHECK pricing_region = 'GB'`). `default_currency` is a `character` (CHAR) column → migration uses `upper(trim(default_currency::text))` defensively. `pricing_currency`/`pricing_region` are `NOT NULL DEFAULT 'GBP'/'GB'` → the 21 NULL rows keep those defaults (acceptable; they cannot charge). No drift; safe to apply.

---

## 6. Spec success-criteria traceability

| SC | Status | Evidence |
|----|--------|----------|
| SC-MIGRATE-1/2/3/4 | implemented (apply pending) | Migration §3/§4 align non-NULL + leave 21 NULL; drop currency CHECK; widen region CHECK. Post-push verification query in §8. |
| SC-CHARGE-1 (USD brand → PI `usd`) | implemented | charge currency = `pricing.pricing_currency.toLowerCase()`; flows to `piCreateBody.currency` + tax calc. |
| SC-CHARGE-2 (US `exclusive`, GB `inclusive`, no throw) | verified | Deno T-01/T-06; `taxBehaviorForRegion` map. |
| SC-CHARGE-3 (NULL/unmapped region degrades) | verified | `regionUnmappedForceFlatAbsorb` forces flat-absorb before the engine; Deno unmapped-throw guard proves the engine itself still guards. |
| SC-DISPLAY-iOS/Android | implemented | shared RN code; cross-rate proven by node check T-02; sim verification is the tester's adversarial leg (T-04). |
| SC-DISPLAY-SAME | verified | node check T-03/T-03b identity. |
| SC-NODISCLOSE | preserved | no UI string added; display shows only the converted number. |
| SC-RESIDUAL | accepted | draft/unpopulated rows may still render `£` (client-fallback cleanup is a Non-Goal). |

---

## 7. Invariants

- I-PROPOSED-CHARGE-IN-SELLER-CURRENCY (NEW) — preserved: charge currency sourced from `pricing_currency`.
- I-PROPOSED-ALLIN-REGION-TAX-BEHAVIOR — preserved: behavior derived from region, never a call-site literal.
- I-PROPOSED-TAKE-RATE-BPS-INTEGER — preserved: `feeFromBps` untouched.
- I-PROPOSED-DISPLAY-CROSS-RATE (NEW) — preserved: `convertBetween` cross-rate + same-currency identity.

---

## 8. Deploy notes — for the orchestrator (NO db push / deploy run here)

**Step 1 — apply the migration (operator/orchestrator, safe-migration):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1034-[currency-de-gbp]" && /Users/sethogieva/bin/supabase db push --linked
```
(Run `/Users/sethogieva/bin/supabase migration list --linked` from the worktree first to confirm no remote-only versions. The migration only rewrites 2 config columns + swaps 2 CHECKs — low risk, NULL-tolerant, idempotent.)

**Post-push verification (SC-MIGRATE):**
```sql
SELECT count(*) FROM brands WHERE default_currency IS NOT NULL AND pricing_currency <> upper(trim(default_currency::text)); -- expect 0
SELECT count(*) FROM brands WHERE default_currency IS NULL; -- expect 21
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.brands'::regclass AND conname ILIKE '%pricing_%'; -- region IN (GB,US,EU,CH); currency CHECK gone
```

**Step 2 — deploy the edge function (orchestrator, AFTER db push confirmed + PR merged to main per [[ship-verify-merge-before-reap]]):**
```bash
supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
```
(The engine `_shared/allInPricingEngine.ts` is bundled into `ticket-checkout-create` — no separate deploy. Verify-first-call: a curl to the function URL returns non-404.)

---

## 9. Cross-surface impact (Step 3.5)

- **Consumer iOS + Android:** AFFECTED — shared `formatters.ts`/`preferences.ts`/`currencyService.ts`; cross-rate display fix applies to both (parity automatic). Charge currency via the shared edge fn.
- **Buyer/anon Web:** PARTIAL — shares `ticket-checkout-create` charge-currency + engine generalization; web tax-basis unification is OUT (COMMS-0013); web display untouched.
- **Business iOS/Android, Admin Web, Business Web preview:** unaffected (no buyer-currency surface; admin is bps-currency-agnostic).

---

## 10. Discoveries for orchestrator

- **`events.venue_tax_address` is never populated (0/123)** — even after ORCH-1034 enables US `exclusive`, Stripe Tax still never fires until a venue address is captured per event. This is the separate follow-up ORCH the SPEC + investigation flagged (the venue-tax pipeline is dead-on-arrival for lack of addresses). Not 1034's job.
- **COMMS-0013 premise is stale** — the native `tax.calculations.create` rewire shipped (#269); the web/native tax-basis divergence is real-in-code but dormant (tax off everywhere). ORCH-1034 correctly scopes web out and does not regress the web charge currency.
- **21 NULL-default brands** remain NULL by design; when one connects Stripe, ORCH-0769 sync sets `default_currency` and a future refresh can re-run this idempotent alignment.
