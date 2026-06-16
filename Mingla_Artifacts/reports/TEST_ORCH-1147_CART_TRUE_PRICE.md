# TEST — ORCH-1147 [cart does not reflect the TRUE price of a trip/event/experience]

**Phase:** TEST (mingla-tester). **Worktree:** `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]` on branch `ORCH-1147-cart-true-price` (rebased on origin/main, 0 behind).
**Project ref:** `gqnoajqerqhnvulmnyvv`.
**Inputs verified:** SPEC + amendment (§E2 test contract), investigation, implementation report (core `96120f458` + amendment `e968e00b3`, post-rebase hashes).
**Comms:** COMMS_LEDGER read on entry — no OPEN BLOCK rows for mingla-tester / ORCH-1147 / ALL. The tester-targeted OPEN rows (COMMS-0028 GIPHY, 0032 HEIC) are WARN/FYI on unrelated upload/OTA surfaces — read, no action.

---

## 1. VERDICT

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 · P3: 0 · P4: 2.

The implementation is **source-correct and math-correct across all three offering types and the web charge**, proven by live DB/RPC evidence, the real shared pricing engine, and fails-on-revert. Two conditions cap it below an unconditional PASS, both **CLOSE-gated and operator-owned** (not code defects):

1. **The web-charge fix is NOT live in prod.** Deployed `ticket-checkout-create` is **v206**, which still bills `unit_amount: totalCents` (the bug). SC-6-Web is correct in source but inert until the operator deploys from merged main at CLOSE. (Expected per the implementor note + `feedback_edge_deploy_and_migration_apply_hazards`.)
2. **The display fix ships via OTA** and was NOT pixel-rendered at runtime: the local buyer-web dev server crashes on a **pre-existing, unrelated** motion-token error (`durations.duration` in `BusinessNotificationsScreen.tsx` — a file ORCH-1147 never touched), and the business-app native checkout requires a logged-in account + multi-step navigation not reachable autonomously this pass. Display cells are **SUSPECTED** (source + data + engine-math proven), not runtime-PASS.

No P0/P1. The math that the buyer is QUOTED equals what the server CHARGES (proven against the live RPC and the real engine). The fixture exercised the pass-fee path for all three types. Fixture fully cleaned up.

---

## 2. SC-by-SC matrix

Pass-fee fixture (D-3): temporarily toggled `default_pass_mingla_fee=true` + `default_pass_service_fee=true` on 3 charges-enabled brands (Leggo This / Travel Brand / Lantern & Vine; take 150bps, service 300bps → 4.5% gross-up), proved the RPC gross-up, **restored all 3 to absorb** (verified). 0/8 prod brands pass a fee normally, so this fixture is mandatory.

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1-iOS | native event Total = fee-grossed all-in sync | SUSPECTED | source: `payment.tsx` headline=`allInFloorCents` from `totals.allInTotal`; hook math proven (jest T-1/T-2); native sim leg not driven (login+nav) |
| SC-1-Android | same, Android | SUSPECTED | shared RN code (auto-parity); not driven on device |
| SC-1-Web | web event Total = fee-grossed all-in (not base) | SUSPECTED | source-correct (web takes the floor branch, no Platform hide); buyer-web dev render blocked by pre-existing unrelated crash (§7) |
| SC-2 (iOS/And/Web) | single combined "Fees & tax" line, never split | SUSPECTED→PASS(math) | `summaryFeesTaxRow` rendered iff `showFeesTaxLine`; label exactly `Fees & tax`; line=`headline−base`; jest proves the value; render not pixel-verified |
| SC-3 (event) | event satisfies SC-1/SC-2 | PASS (data+math) | live RPC `a3f71d85`: base 5000 → all_in **5225**, fees 225; cart math `feesTaxCents=225` (jest A); display source-correct |
| SC-4 (trip) | trip satisfies SC-1/SC-2 | PASS (data+math) | live RPC `060d0483`: 50000 → **52250**, fees 2250; source `getPublicTripById` populates `priceAllInGbp`; jest T-7a + fails-on-revert |
| SC-5 (experience) | experience satisfies SC-1/SC-2 | PASS (data+math) | live RPC `b8bd995b`: 7000 → **7315**, fees 315; source `mapExperience` via `loadExperienceSidecars`; jest T-7b + fails-on-revert |
| SC-6-Web (D-1) | web Checkout line item bills `buyerSubtotalCents` | PASS (source) / **NOT LIVE** | source `:1096 unit_amount: buyerSubtotal.buyerSubtotalCents`; gate green + fails-on-revert (EXIT=1). **Deployed v206 still bills `totalCents` — deploy required at CLOSE.** |
| SC-7 (NGN parity) | NGN cart shows all-in; charge bills all-in | PASS (source+data) w/ caveat | NGN RPC `…2076`: 500000 → **522500** (fee gross-up; shared CartContext display). Charge: `computeConfigVat(psSubtotal.buyerSubtotalCents)` → all-in incl. VAT (DO-NOT-TOUCH, unchanged). **P2: NGN is exclusive-tax → display floor understates by VAT (OQ-2; non-zero on this fixture, unlike GB/EU/CH).** |
| SC-8 (invariant) | no buyer tax form; `orch-1130-no-buyer-tax-form.mjs` green | PASS | gate EXIT=0 (run §6) |
| SC-9 (absorb no-regression) | absorb → feesTax=0, no line, Total==base | PASS (data+math) | baseline RPC all_in==base for all 3 types; jest T-4; `showFeesTaxLine=false` |
| SC-10 (free) | free → Total Free/0, no fees line | PASS (math) | jest T-5; seed null→0 base fallback |
| SC-11 (single owner) | `pg_public_event_tier_allin` called from one place | PASS | only caller = `fetchTierAllInCents` (`publicEventsService.ts:846`); trip+exp reuse it; new gate green + fails-on-revert |

**"data+math PASS"** = proven via live prod RPC output (the exact number the cart reads) + the cart's pure reduce math (jest, fails-on-revert) + the real shared engine. This is runtime-grade for the MONEY CORRECTNESS, short of a pixel screenshot of the rendered string (capped SUSPECTED for the on-screen render).

---

## 3. Findings

### P2-1 — NGN (exclusive-tax) cart display understates by VAT on a pass-tax brand (OQ-2 residual, non-zero on the NG fixture)
- **Evidence:** NGN brand `a0000000-…-001076` passes tax; its event `…2076` base 500000 → RPC all_in **522500** (fee-only). The NGN CHARGE adds 7.5% exclusive VAT on `buyerSubtotalCents=522500` → buyer total ≈ **561688**. The cart DISPLAY floor (`priceAllInGbp`=522500) omits the 39188 VAT.
- **Impact:** On the Paystack/NGN arm the displayed Total is below the charged Total by the VAT (WYSIWYP gap), exactly the OQ-2 exclusive-tax residual. The SPEC's "blast radius ZERO today" holds for the Stripe arm (GB/EU/CH inclusive) but the **NG test brand is exclusive-tax and DOES exercise the gap**.
- **Required fix:** None in ORCH-1147 (OQ-2 is operator-PARKED). **Discovery for orchestrator:** OQ-2's scope statement names "US pass_tax=true"; it must also name **NG** (also exclusive). Track the exclusive-tax display understatement as the named follow-on ORCH; confirm NG is in-scope of the parked decision.
- **Retest:** when OQ-2 is taken up, assert NGN display == NGN charge (incl. VAT).

### P4-1 (praise) — clean one-owner structural fix
`fetchTierAllInCents` is the single caller of `pg_public_event_tier_allin`; trip + experience reuse it (no duplicated RPC/fee math); the cart performs only Σ and subtract. Constitution #2 honored and gate-enforced (SC-11).

### P4-2 (praise) — display == charge proven against the REAL engine
The DB RPC `compute_all_in_cents` and the TS `computeBuyerSubtotal` use byte-identical fee math (`base + round(base*take/10000) + round(base*svc/10000)`), so the quoted Total equals the web charge basis to the cent. My adversarial test asserts this against the genuine `_shared/allInPricingEngine.ts` — no mock.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert

Re-run at the merged branch HEAD (post-rebase). True line-deletion, not comment-out:

1. **Hook revert** — deleted `allInTotal += (line.unitPriceAllIn ?? line.unitPrice)*qty` and forced `feesTaxCents=0` in `useCartTotals` (`CartContext.tsx`):
   `✕ T-1, ✕ T-1b, ✕ T-4, ✕ missing-fallback, ✕ T-7a, ✕ T-7b, ✕ T-7c` → **7 failed, 11 passed**. Restored → **18 passed**.
2. **Web-charge gate revert** — `unit_amount: buyerSubtotal.buyerSubtotalCents` → `unit_amount: totalCents` at `index.ts:1096`:
   `orch-1147-web-charge-allin` gate **EXIT=1** ("web Checkout Session bills `unit_amount: totalCents` — it MUST bill `buyerSubtotal.buyerSubtotalCents`"). Restored → **EXIT=0**.
3. **Trip stub pass-through revert** — deleted `priceAllInGbp: tier.priceAllInGbp ?? null` from `tierToTicketStub`:
   `✕ T-7a source: tierToTicketStub passes priceAllInGbp through` → **1 failed**. Restored → **18 passed**.

The implementor's happy-path test and the amendment's source assertions exercise the actual fix lines. Confirmed independently.

---

## 5. Adversarial test added (tester-owned, DIFFERENT angle)

- **Path:** `mingla-business/src/components/checkout/__tests__/orch_1147_cart_charge_parity.tester-adversarial.test.ts`
- **Commit:** `57056d238` (on branch, in `git diff origin/main...HEAD --name-only`).
- **Angle (distinct from the implementor's display-math / source-mapping tests):** the **economic display==charge invariant** — imports the REAL server money engine (`supabase/functions/_shared/allInPricingEngine.ts`, pure TS) and asserts the cart's quoted Total (`useCartTotals.allInTotal`) equals the web-charge basis (`computeBuyerSubtotal.buyerSubtotalCents`) to the cent. Plus a fee-rounding boundary base (5037c), a quantity>1 per-unit-grossing case (333c × 7, where qty×round(perUnit) is the contract), an absorb→pass toggle flip (the toggle is the sole driver of the delta), and a pre-tax-basis guard (`pass_tax` must NOT change `buyerSubtotal` → no double-tax).
- **Result:** 5 passed. **fails-on-revert verified at `57056d238`** — deleting the cart all-in accumulation fails 4/5 (the engine-only double-tax guard D survives, correctly).
- **In closing diff:** both the implementor `orch_1147_cart_allin_total.test.ts` AND this tester file appear in `git diff origin/main...HEAD --name-only`. Append-only (no existing test file modified).

---

## 6. Gates + jest (committed state)

```
ORCH-1147 cart-total-is-allin gate passed.        EXIT=0   (self-test EXIT=0)
ORCH-1147 web-charge-allin gate passed.           EXIT=0   (self-test EXIT=0)
ORCH-1147 allin-single-owner gate passed.         EXIT=0   (self-test EXIT=0)   (SC-11)
ORCH-1130 no-buyer-tax-form gate passed.          EXIT=0                        (SC-8)

jest src/components/checkout:  55 passed (incl. implementor 18 + tester adversarial 5).
  2 "failed suites" = pre-existing Playwright specs (throwIfRunningInsideJest) — present on origin/main, unrelated.

tsc --noEmit: ZERO new type errors in the 8 touched product files (pre-existing buyer.tsx TS7006 untouched).
deno check ticket-checkout-create: PASS (per impl report; web-charge line is a 1-line in-scope swap).
```

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS / Android | N/A | not in scope (app-mobile untouched; already correct) |
| **Buyer / anon Web** (event/trip/exp display) | **SUSPECTED** (BLOCKED render) | source + live-RPC + engine-math proven. Local buyer-web dev server (`expo start --web`) crashes on a **pre-existing unrelated** motion-token error: `Cannot read properties of undefined (reading 'duration')` at `LinearTransition.duration(durations.entry)` originating in `BusinessNotificationsScreen.tsx` (NOT an ORCH-1147 file; no motion/duration file touched). Route never renders the payment Total in dev. Real web ships via Vercel prod build, not this dev server. |
| **Buyer / anon Web** (CHARGE, SC-6) | **PASS (source) / NOT LIVE** | deployed `ticket-checkout-create` v206 still bills `totalCents`; fix inert until deploy-from-merged-main at CLOSE |
| **Business iOS** (native display) | **SUSPECTED** | iPhone 17 Pro sim booted but the native business checkout needs a logged-in business account + multi-step nav not reachable autonomously; hook+display source proven |
| **Business Android** | **SUSPECTED** | Samsung device attached; shared RN code (auto-parity); not driven |
| Admin Web / Business Web preview | N/A | non-buyer surfaces |

**Live deploy state (read-only):** `ticket-checkout-create` v206, `verify_jwt: true`, ACTIVE. The merged-main deploy at CLOSE preserves `verify_jwt`. **Physical iPhone HITL:** not requested this pass; the buyer-web blocker is environmental (dev-bundle), and the charge fix needs deploy first — driving a stale bundle would prove nothing. If Seth wants a pixel-render confirmation, the cleanest path is post-OTA on the dev channel + a 1-brand pass-fee toggle (instructions in §B handoff).

---

## 8. Pass-fee fixture used + cleanup confirmation

- **Toggled (temporary):** `default_pass_mingla_fee=true, default_pass_service_fee=true` on brands `22a18413` (Leggo This / event), `becddd00` (Travel Brand / trip), `53aaea42` (Lantern & Vine / experience). Original state for all three: false/false (recorded before mutation).
- **Exercised:** RPC gross-up proven per type — event 5000→5225 (fees 225), trip 50000→52250 (fees 2250), experience 7000→7315 (fees 315), all 4.5% (150bps take + 300bps service). NGN brand (already pass-fee) 500000→522500.
- **Cleanup:** all 3 brands RESTORED to false/false; RPC re-verified all_in==base for all three. **No prod brand left mutated.** (Web dev server killed; port 8097 free.)

---

## 9. Stripe charge-amount evidence (web)

- Source: web Checkout Session line item `unit_amount: buyerSubtotal.buyerSubtotalCents` (`ticket-checkout-create/index.ts:1096`), with `automatic_tax: { enabled: true }` (`:1115`). `buyerSubtotalCents = base + (pass_mingla? round(base*take/10000):0) + (pass_service? round(base*svc/10000):0)` (`_shared/allInPricingEngine.ts:182-189`) — fee-grossed PRE-TAX. Billing `buyer_total_cents` instead would double-tax (it already includes tax) — correctly avoided. `application_fee_amount = buyerSubtotal.miglaFeeCents` unchanged.
- **For the live fixture (event 5000, pass both):** the web line item would bill **5225** (= the cart's quoted Total to the cent), Stripe adds tax on top. This equals the native fee gross-up. My adversarial test A pins `quotedChargeCents === billedChargeCents === 5225`.
- **NOT YET LIVE:** deployed v206 still bills `totalCents` (5000) — operator must deploy from merged main at CLOSE for the charge fix to take effect.

---

## 10. NGN / Paystack parity (D-4 / SC-7)

- **Display:** shared `CartContext` → NGN cart reads `priceAllInGbp` (RPC, fee-grossed) like every other arm. RPC for the NGN fixture: 500000 → 522500 (fees 22500). Display shows the fee-grossed floor.
- **Charge:** `computeConfigVat(psSubtotal.buyerSubtotalCents, …)` → `psBuyerTotalCents` is the Paystack `amount` (`ticket-checkout-create.ts:~686/755`). DO-NOT-TOUCH, unchanged by ORCH-1147 — already bills base+fees+VAT. No under-bill of the fee gross-up.
- **Caveat (P2-1):** NG is exclusive-tax, so the display floor (fee-only) is below the charge (fee+VAT) by the VAT. This is the OQ-2 residual, non-zero on the NG arm. Named, parked.

---

## 11. Constitution 14-rule matrix (vs the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | no new interactive control (display + 1 line) |
| 2 | One owner per truth | **PASS** | single `pg_public_event_tier_allin` caller = `fetchTierAllInCents`; SC-11 gate |
| 3 | No silent failures | **PASS** | RPC miss → empty map → base fallback (never blank/throw); experience guards kept on the 3 Supabase reads |
| 4 | One query key per entity | N/A | no new query key |
| 5 | Server state server-side | **PASS** | all-in is server-computed (RPC); cart only sums/subtracts |
| 6 | Logout clears everything | N/A | no auth/persistence change |
| 7 | `[TRANSITIONAL]` labeled | **PASS** | none introduced |
| 8 | Subtract before adding | **PASS** | reused existing `computeBuyerSubtotal`/RPC; no parallel money path added |
| 9 | No fabricated data | **PASS** | null/free all-in → base fallback (`?? priceGbp ?? 0`), never an invented markup |
| 10 | Currency-aware | **PASS** | all-in seed carries the same `currency` as base; no new `?? "GBP"` (ORCH-1034 boundary respected) |
| 11 | One auth instance | N/A | none |
| 12 | Validate at the right time | N/A | no datetime logic |
| 13 | Exclusion consistency | N/A | none |
| 14 | Persisted-state startup | N/A | no hydration change |

No violations.

---

## 12. Discoveries for Orchestrator

1. **SC-6-Web not live:** deployed `ticket-checkout-create` is **v206** still billing `totalCents`. The web under-bill persists in prod until the CLOSE deploy-from-merged-main. (Expected, but it means the D-1 economic fix is inert until then — call it out in the close banner.)
2. **OQ-2 scope must name NG:** the exclusive-tax display residual is non-zero on the NGN/Paystack arm (the NG test brand passes tax). The parked OQ-2 decision names only "US pass_tax=true" — extend it to NG, or the follow-on ORCH will miss the Paystack arm.
3. **Pre-existing buyer-web dev crash:** `expo start --web` crashes on `durations.duration` (`LinearTransition` / `BusinessNotificationsScreen.tsx`) before any checkout route renders — blocks autonomous buyer-web live-fire. Unrelated to ORCH-1147 (no motion file touched). Latent dev-tooling gap; flag if the team relies on local web checkout testing.
4. **jest.config.cjs jsx flip (`react-native`→`react-jsx`)** is a test-infra deviation (not on the explicit allowlist) — minimal and Metro-build-irrelevant. Already flagged by the implementor; noting for the close reconciliation.

---

## 13. Accepted conditions (CONDITIONAL PASS)

This verdict is CONDITIONAL on two **operator-owned CLOSE actions** (not code rework):

- **C1:** deploy `ticket-checkout-create` from **merged main** at CLOSE (the only way SC-6-Web becomes live; preserves `verify_jwt: true`).
- **C2:** OTA the business app (runtime 1.0.0, pure RN/JS) at CLOSE so the display fix reaches devices; a post-OTA pixel-render spot-check (1 pass-fee brand toggled briefly) would upgrade the SUSPECTED display cells to runtime-PASS.

Both are the standard CLOSE deploy/OTA per `feedback_edge_deploy_and_migration_apply_hazards` + `reference_eas_cli_ota_publish_gotchas`. No P1 requires implementor rework. If Seth wants display cells at runtime-PASS before CLOSE, route a short post-OTA device spot-check back to tester.

---

## 14. Downstream routing

- **No REWORK needed** (zero P0/P1). → orchestrator CLOSE with conditions C1/C2.
- At CLOSE: flip `I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN` + `I-PROPOSED-1147-WEB-CHARGE-BILLS-FEE-GROSSED-SUBTOTAL` ACTIVE; commit the tester adversarial test (already on branch `57056d238`); deploy `ticket-checkout-create` from merged main; OTA business app; extend OQ-2 scope to NG; reconcile COMMS-0013/0014/0016.
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]/` on branch `ORCH-1147-cart-true-price`.
