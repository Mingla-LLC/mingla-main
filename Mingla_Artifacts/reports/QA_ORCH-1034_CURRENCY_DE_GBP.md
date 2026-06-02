# QA — ORCH-1034 [de-GBP-ify the currency layer — charge in seller currency]

- **Mode:** TARGETED (orchestrator dispatch). Verifying against the LIVE production deploy.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1034-[currency-de-gbp]/` on branch `ORCH-1034-currency-de-gbp`, HEAD at QA start `395c3b50b` (+ QA commit adding the two adversarial tests).
- **Tester:** `mingla-tester` (Claude), 2026-06-02. Skills invoked in order: `stripe-best-practices`, then `mingla-tester`. Read `COMMS_LEDGER.md` on entry.
- **Inputs:** SPEC `Mingla_Artifacts/specs/SPEC_ORCH-1034_CURRENCY_DE_GBP.md`; impl report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1034_CURRENCY_DE_GBP.md`; tax investigation `INVESTIGATION_ORCH-1034_TAX_TIE_IN.md`.
- **Ledger:** No BLOCK row addressed to ORCH-1034 or `mingla-tester`. WARN context factored: COMMS-0013 (web vs native tax-basis divergence — explicitly OUT of scope per SPEC §2.2; web charge currency NOT regressed), COMMS-0014/0016 (experience checkout routing — not this ORCH). COMMS-0017 reserves the physical Samsung A72 (`R58R54YV7JT`) for ORCH-1016 — I used `emulator-5554` for the Android leg, NOT the reserved physical device.

---

## VERDICT: CONDITIONAL PASS

The charge-currency change (the headline of this ORCH) is **PROVEN** against live production: a US brand charges USD (not GBP) with exclusive tax behavior; a GBP brand charges GBP inclusive; a NULL-currency brand is cleanly rejected (no silent GBP charge); the migration is correctly applied. The display cross-rate fix is **proven correct at the unit/behavioral level** (passing tests + fails-on-revert) and is **provably observationally identical to the shipped `main` build on every consumer surface**. The ONLY reason this is CONDITIONAL rather than full PASS: the iOS+Android *authenticated-buyer UI screenshot* leg could not be driven to a price-bearing screen — the reviewer OTP path is gated behind Apple/Google OAuth that a bare sim/emulator cannot complete, and the dev build pointed at anchor Metro was unstable (ANR + blank bundle). This is a `probable`-level blocker on the display UI leg, NOT a defect. Requires Seth's explicit deferral acceptance of the display sim screenshot, OR a follow-up on a real device with a live session.

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 | **P4:** 2

---

## 1. Live-deploy verification (the dispatch's primary asks)

### 1.1 Migration applied + verified (SC-MIGRATE 1–4) — PROVEN

Live remote DB probe (Supabase Management API, read-only, 2026-06-02):

```
default_currency | pricing_currency | pricing_region |  n | with_stripe
-----------------+------------------+----------------+----+------------
 NULL            | GBP              | GB             | 21 | 0
 USD             | USD              | US             | 15 | 13
 GBP             | GBP              | GB             | 11 | 3
 EUR             | EUR              | EU             |  2 | 2
 CHF             | CHF             | CH             |  1 | 1
```

- **SC-MIGRATE-1:** 0 mismatches — every non-NULL `default_currency` row has `pricing_currency = upper(default_currency)`. (USD→USD, GBP→GBP, EUR→EUR, CHF→CHF.)
- **SC-MIGRATE-2:** 21 NULL-`default_currency` rows untouched, still NULL, still `pricing_currency='GBP'` default (they have 0 Stripe accounts — cannot charge anyway).
- **SC-MIGRATE-3:** region map correct (USD→US, GBP→GB, EUR→EU, CHF→CH).
- **SC-MIGRATE-4:** `brands_pricing_currency_allowlist` CHECK is GONE; `brands_pricing_region_allowlist` = `CHECK (pricing_region = ANY (ARRAY['GB','US','EU','CH']))`.
- **Migration version recorded:** `supabase_migrations.schema_migrations` contains `20260816000000` (the post-collision-bump version; `20260815000000` is NOT present — consistent with the rename commit `395c3b50b`).

> NOTE (P3): the impl report §1/§8 still cites the pre-bump filename `20260815000000`; the live file + applied version + allowlist are all the correct `20260816000000`. Doc-only stale reference; the code/DB are correct. Flag for the report, not a code defect.

### 1.2 Charge currency = seller settlement currency (SC-CHARGE-1/2, T-06) — PROVEN against the LIVE deployed function

I traced the **deployed** `ticket-checkout-create` source (fetched via Supabase MCP `get_edge_function`) and confirmed it carries the full ORCH-1034 wiring (NOT stale): `settlementCurrencyRaw = pricing.pricing_currency`, the `pricing_currency_missing` 409, `regionUnmappedForceFlatAbsorb`, generalized `taxBehaviorForRegion` (US→exclusive), and `inclusiveVatDivisorForRegion`. Live deploy = worktree code.

I then called the LIVE `resolve_event_pricing_inputs` RPC (the authoritative charge-currency input the edge fn reads at index.ts:560-610) for one real event of each brand class (read-only, NO order created):

| Class | Event | RPC `pricing_currency` | RPC `pricing_region` | `stripe_account_id` | ⇒ deployed-fn charge currency | ⇒ tax_behavior |
|-------|-------|------------------------|----------------------|---------------------|------------------------------|----------------|
| **US brand** | `b1ba3422-…` | **USD** | **US** | `acct_1TUNLtB5v00XfDTX` | **`usd`** (NOT gbp) | **exclusive** |
| **GB brand** | `9a9c406c-…` | GBP | GB | `acct_1TYrMmPjlZPwH2Lj` | `gbp` | inclusive |
| **NULL brand** | `ab91c618-…` | GBP (column default) | GB | **`null`** | **n/a — 409 stripe_account_not_ready BEFORE charge** | n/a |

**SC-CHARGE-1 (the headline proof):** a US brand's checkout sources `currency = "USD".toLowerCase() = "usd"` → `piCreateBody.currency = "usd"` (index.ts:1295) and `tax.calculations.create({ currency: "usd" })`, with `taxBehaviorForRegion("US") = "exclusive"`. **The charge flows in the seller's currency (USD), zero Stripe FX — NOT GBP.** This is the direct refutation of the original bug.

**SC-CHARGE-2 / T-06 (GBP-path no regression):** a GB brand sources `gbp` + `taxBehaviorForRegion("GB") = "inclusive"` — still correct, no regression.

### 1.3 NULL-currency brand graceful (T-05) — PROVEN, no GBP fabrication

The deployed fn's `stripe_account_not_ready` 409 fires at index.ts:546-547 **BEFORE** the pricing resolve (L560) and before any charge-currency selection (L597). A NULL-`default_currency` brand has no Stripe account, so its checkout is rejected with a clean 409 and never reaches a charge path. Although the resolver returns the column-default `pricing_currency='GBP'` for such a brand, that GBP is never used to charge real money — the request is blocked first. **No crash, no silent GBP charge, no fabrication.** (The 21 NULL brands all have `with_stripe = 0`, confirming none can transact.)

### 1.4 Unmapped/NULL region degrades, never throws (SC-CHARGE-3, T-07) — PROVEN

Call-site clamp (index.ts:624-633): a region not in `['GB','US','EU','CH']` (NULL, lowercase, padded, unknown) coerces to `"GB"` AND sets `regionUnmappedForceFlatAbsorb = true`, which the tax gate (L1127-1134) honors to force flat-absorb BEFORE `taxBehaviorForRegion` is ever called on an unmapped literal. The engine's exhaustive-`never` throw is kept only as a programming-error catch and is unreachable on a real checkout. Proven by my adversarial Deno test ADV-B/B2 (mirrors the exact clamp) + the engine's own no-throw test.

---

## 2. Display cross-rate (SC-DISPLAY-*, SC-NODISCLOSE) — proven at unit level; UI screenshot leg blocked

### 2.1 Cross-rate helper + formatters — PROVEN correct (root-cause C fixed)

`currencyService.convertBetween(amount, from, to) = amount * (rate[to] / rate[from])`, same-currency identity, divide-by-zero guard. Both formatters (`formatters.ts`, `preferences.ts`) route through it with an optional `sourceCurrency` (default `'USD'`).

- Implementor node check: 8/8 PASS (T-02 GBP→EUR cross-rate 23.2877 not the buggy USD-base 17.0; T-03 same-currency identity).
- Implementor Deno engine test: 15/15 PASS (7 ORCH-1034 + 8 existing, no regression).
- **My adversarial node check (6/6 PASS):** round-trip symmetry (GBP→EUR→GBP = original), triangle path-independence (GBP→CHF == GBP→EUR→CHF), buggy-vs-correct disagreement sentinel, divide-by-zero/unknown-source guard, + source fails-on-revert guards.
- **My adversarial Deno test (4/4 PASS):** inclusive-VAT divisor *applied* to extract the tax portion per region (the implementor only asserted the constant), region-clamp degrade, mapped-region pass-through, engine currency-neutrality (EUR==GBP==USD for identical cents).

### 2.2 CRITICAL FORENSIC FINDING (P4 — not a defect, a scope clarification)

I traced every consumer caller of the converting formatters. **No shipped consumer commerce surface displays a *converted* seller-currency price:**

- The consumer **cart / checkout** (`TicketCartSheet.tsx`, ORCH-1025) renders prices via its OWN local `Intl.NumberFormat` in the **event's own seller currency** (`totals.currency` / `seedTicket.currency`) — NO conversion, NO call to `convertBetween`. The buyer sees the seller-currency number that matches the PaymentSheet charge (WYSIWYP by design). `TripCard.tsx` likewise renders the event's native currency directly.
- The **deck / curated cards** (`CuratedExperienceSwipeCard`, `ExpandedCardModal`, `SavedTab`) call `formatCurrency(amount, buyerCurrency)` with only TWO args ⇒ `sourceCurrency` defaults to `'USD'`. These are USD-base place-pool *estimates*, so the USD-source default is correct and their behavior is UNCHANGED.

I proved (30/30 equivalence harness) that the ORCH-1034 formatter is **observationally identical to the anchor `main` build for every actual consumer call pattern** — the cross-rate only diverges on a 3-arg seller-source call, which no consumer screen makes. **Consequence:** the SPEC §6 SC-DISPLAY scenario ("£20 GBP event shown to a EUR buyer as cross-rate") does not occur on any shipped surface today; the cart shows GBP natively. This is consistent with SPEC §5.D (threading `sourceCurrency` through commerce callers is explicitly OPEN/deferred) and the §2.2 Non-Goal. The fix correctly REMOVES the latent USD-base bug at the helper level and is forward-ready, but is currently dormant on commerce prices. **No user-visible display regression is possible** because the shipped app already renders exactly what an ORCH-1034 build renders.

### 2.3 SC-NODISCLOSE — PASS

No "you will be charged in X" string anywhere; the cart shows only the seller-currency number. Confirmed by grep + the cart code path.

### 2.4 iOS + Android UI screenshot leg — PROBABLE (blocked, named)

- **iOS sim (iPhone 17 Pro `17091E60-…`):** app launches to the Apple/Google login (screenshots `ios_01_launch.png`, `ios_02_after_google.png`). Google OAuth opens an external web flow that cannot complete on a bare simulator; the reviewer OTP `+12015550199` lives behind that OAuth gate (no phone-login button on the WelcomeScreen; phone-OTP is an in-onboarding step reached only after Apple/Google succeeds). Could not reach an authenticated price-bearing screen.
- **Android emu (`emulator-5554`):** reached the in-onboarding phone-country picker (screenshots `android_01`–`android_06`), drove US selection, but the dev build (pointed at anchor Metro :8109 over adb-reverse) threw an ANR then a blank-bundle screen on relaunch (`android_06`–`android_08`). adb-reverse :8109 was present; the instability is the dev-build-on-anchor-Metro bundle fetch, not a code fault.
- **Resolution attempted, per gate:** relaunched, recovered the iOS SpringBoard crash, dismissed the Android stylus popup + ANR, re-set adb-reverse — the residual blocker (OAuth-gated session + unstable anchor-Metro bundle) is not a Metro-cache/cwd issue I can fix without either applying the 3 display files onto the anchor checkout (shared-anchor staging hazard, COMMS-0015/anchor-hazard rule) or a real device with a live reviewer session.
- **Why this does not change correctness:** the display behavior is provably identical to the shipped `main` build (§2.2), so an authenticated screenshot would show identical prices; the cross-rate is unit-proven (§2.1). Confidence on the display *behavior* is `proven`; confidence on the *UI screenshot* is `probable`.

Evidence screenshots: `Mingla_Artifacts/reports/qa_evidence_orch_1034/` (ios_01, ios_02, android_01–08).

---

## 3. Adversarial regression test (Step 0.5 (b)) — different angle, passing, fails-on-revert

| File | Angle (vs implementor happy-path) | Run | Fails-on-revert |
|------|-----------------------------------|-----|-----------------|
| `supabase/functions/_shared/__tests__/orch_1034_currency_de_gbp.tester-adversarial.test.ts` | Implementor asserted the tax flag + divisor CONSTANTS. Mine APPLIES the divisor to extract the VAT portion per region, exercises the call-site region-CLAMP/degrade-not-throw decision, and proves engine currency-NEUTRALITY (EUR==GBP==USD). | 4/4 PASS (`deno test`) | YES — against base `3d56c9b6e` engine the `"EU"/"US"/"CH"` union + `inclusiveVatDivisorForRegion` don't exist ⇒ type-check FAILS (cannot pass). |
| `app-mobile/scripts/ci/orch-1034-currency-de-gbp.tester-adversarial.mjs` | Implementor checked one cross-rate value + identity. Mine checks cross-rate MATH PROPERTIES: round-trip symmetry, triangle path-independence, buggy-vs-correct disagreement sentinel, divide-by-zero guard, + source guards. | 6/6 PASS (`node`) | YES — against base source: exit 1 (ADV-5a/5b fail — `convertBetween` absent + buggy `amount*rate` present). |

Both adversarial tests + the implementor's happy-path tests appear in `git diff origin/main...HEAD --name-only`. The new adversarial Deno test was added to `ORCH_1034_BACKEND_ALLOWLIST`; strict-grep C7 gate re-run = **All checks PASS**.

Implementor fails-on-revert (cited in impl report §3): happy-path Deno + node both fail at base `3d56c9b6e`. Independently corroborated by my base-commit extraction (no `convertBetween`, no US case, buggy `amount * rate` at base formatters L40-43).

---

## 4. Gates captured

- `deno test` engine (implementor + existing): 15 passed | 0 failed.
- `deno test` tester-adversarial: 4 passed | 0 failed.
- `node` implementor display check: 8 PASS. `node` tester-adversarial: 6 PASS.
- Fails-on-revert: implementor (node exit 1 / Deno type-fail at base) + tester (node exit 1 confirmed; Deno type-fail at base).
- `npx tsc --noEmit` (app-mobile): **0 errors in the 3 touched display files** (no caller breakage from the new optional `sourceCurrency`).
- ORCH-0863 strict-grep gate: **All checks PASS** (C7 with the updated ORCH-1034 allowlist incl. the new adversarial test).
- Deployed `ticket-checkout-create` source = worktree ORCH-1034 code (grep-confirmed live).

---

## 5. Constitution (relevant rules)

- #2 One owner per truth — PASS (engine is sole money-math owner; charge currency single-sourced from `pricing_currency`).
- #3 No silent failures — PASS (NULL `pricing_currency` ⇒ clean 409 `pricing_config_unavailable`; no-Stripe ⇒ 409 `stripe_account_not_ready`).
- #9 No fabricated data — PASS (21 NULL brands left NULL, not guessed; NULL brand cannot charge a fabricated GBP).
- #10 Currency-aware — PASS at the charge layer (seller currency); display cross-rate present but dormant on commerce surfaces (P4, by SPEC design).
- Others N/A (backend + formatter math; no nav/auth/cache change).

---

## 6. Findings

- **P3-1** — Impl report stale migration filename (`20260815000000` cited; live + applied + allowlist are `20260816000000`). Doc-only; correct everywhere in code/DB. Fix: update the report or note at CLOSE.
- **P4-1** — The display cross-rate fix is dormant on all shipped consumer commerce surfaces (cart shows seller currency natively; deck cards are USD-base). Correct per SPEC §5.D OPEN + §2.2 Non-Goal, but the SC-DISPLAY "GBP event → EUR buyer cross-rate" is not exercised in-app today. Forward-ready only. (Flag for the deferred client-currency follow-up ORCH.)
- **P4-2 (praise)** — Charge-currency wiring is clean: settlement-currency single-sourced, degrade-not-throw before the engine, clean 409s, Stripe docs cited inline, and the deployed function genuinely matches the branch (no clobber drift à la COMMS-0010).

## 7. Discoveries for orchestrator

- Display sim screenshot leg is `probable`-blocked by the OAuth-gated reviewer session on bare sim/emu + unstable anchor-Metro dev build. A full PASS upgrade needs either a real device with a live reviewer OTP session, or applying the 3 display files onto the anchor + restart Metro (anchor-hazard caution). Given the equivalence proof, the risk of deferring is effectively zero.
- The impl report's own discovery stands: `events.venue_tax_address` is 0/123 populated, so Stripe Tax is dormant regardless of region — the US `exclusive` flag is correct but tax never fires until the venue-address follow-up ORCH ships. Not 1034's job.

---

## Completion-condition status (machine-verified)

1. Every independent test green — YES (15 deno + 4 deno-adv + 8 node + 6 node-adv), output captured §4.
2. `tsc` clean on touched display files — YES (0 errors); deno check clean (impl §4 + my tests compiled).
3. Both regression tests in `git diff origin/main...HEAD`; adversarial attacks a different angle; implementor fails-on-revert at `3d56c9b6e` — YES (§3).
4. UI/runtime legs at `proven` on every platform — **PARTIAL**: backend `proven` (live RPC + deployed source + live DB); display behavior `proven` (unit + equivalence); display UI screenshot `probable` (OAuth/Metro blocker named, not a fixable cache/cwd issue without anchor-hazard or a real device).
5. Zero open P0/P1 — YES (0 P0, 0 P1).

Clause 4 is the sole reason this is CONDITIONAL not PASS. Legal as a deferral Seth explicitly accepts.
