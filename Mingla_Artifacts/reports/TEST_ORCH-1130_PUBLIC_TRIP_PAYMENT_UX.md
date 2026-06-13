# TEST — ORCH-1130 [public trip page payment-structure + installments UX redesign]

**Phase:** TEST (mingla-tester). **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on `ORCH-1130-trip-pay-structure`.
**Under test:** commits `068eb72ed` (code+tests) + `a71ab457e` (report). **HEAD at test:** `a71ab457e`.
**Date:** 2026-06-12. **Mode:** TARGETED + SPEC-COMPLIANCE + cross-domain blast.
**Comms ledger:** read on entry. Only relevant active row is COMMS-0030 (iOS build break) — **RESOLVED** (ORCH-1129 merged, commit `3ee37eb75`); no BLOCK to ORCH-1130/tester/ALL. COMMS-0029/0030 scope authoring RPCs (`biz_update_live_trip`) — zero overlap with this buyer/checkout ORCH. No ack required.

---

## 1. VERDICT

**CONDITIONAL PASS** — 0 P0 · 0 unaccepted P1 · 0 P2 · 1 P3 · 2 P4.

The implementation is source-correct and jest-green across the full state matrix, both apps, both paths; the consent fix (DISC-1130-A) is independently proven; cross-domain blast is clean; anon routes preserved. **The verdict cannot reach full PASS without runtime/device proof** — a UI payment change requires `proven`-level live-fire (Constitution #1: no dead taps is runtime proof, not source wiring; Phase 0.A). I cannot drive a physical iOS/Android device or charge a Stripe TEST card in this environment, and a headless web render would prove only "renders," not "the toggle fires and threads the correct charge amount." **The realistic ceiling here is CONDITIONAL PASS pending Seth's device checklist (§7).** No code rework required; the only open items are the physical proofs.

---

## 2. SPEC SUCCESS-CRITERIA MATRIX (SPEC §4)

Source + jest evidence per row. "device" = deferred to §7 checklist.

| # | Surface / State | Result | Evidence |
|---|---|---|---|
| A1 | Public, no-plan paid | PASS (src+jest) | `TripCheckoutFlow.tsx:113` null branch → recap line (`recapHelper`), no toggle; bar `{price}` no "From" (`[tripSlug].tsx:198`). Adversarial test "recap NOT toggle". |
| A2 | Public, plan default | PASS (src+jest) | `TripCheckoutFlow.tsx:132` → `TripPaymentChoice value="full"`; bar `{price} total` (`[tripSlug].tsx:197`). |
| A3 | Public, plan over-time | PASS (src+jest) | `TripPaymentChoice.tsx:176` schedule gated under `isInstallments` + `showScheduleWhenInstallments`. |
| A4 | Public, bookings closed | PASS (src) | `[tripSlug].tsx` closed banner precedence intact (ORCH-0875); selector only on bookable paid trips. **device-confirm tap-block.** |
| A5 | Public, free | PASS (src) | price 0 → recap/free bar; `isPlanActive`/projection null → no toggle. |
| A6 | Funnel, single-tier | PASS (src) | `index.tsx:174` auto-skip → `router.replace(.../buyer)`; guards (closed/sold-out/past) run BEFORE skip. **device-confirm lands "1 OF 2".** |
| A7 | Review & pay | PASS (src+jest) | `payment.tsx:97` header `totalSteps={2}`; selector from CartContext (`:663`); qty stepper (`Increase`/`Decrease`). |
| A8 | qty=2 plan | PASS (jest, real-logic) | **Adversarial test proves** deposit/legs scale ×2 (€250 / €500+€250), reconcile to full; per-unit bug fails-on-revert. `projectInstallmentSchedule(…, qty)`. |
| B1 | Consumer, no-plan | PASS (src+jest) | module gated on `planSchedule!==null` (`ConsumerTripDetailScreen.tsx:701`); request omits key (`hasPlan ? … : undefined`, `:938`). |
| B2 | Consumer, plan default | PASS (src) | module "full" default (`useState("full")`); pre-Reserve "Charged today" copy (`:770/787`); Reserve → `payment_plan_choice="full"`. |
| B3 | Consumer, plan over-time | PASS (src) | over-time → schedule + deposit disclosure (`:738/794`); Reserve → `"installments"`. **device-confirm charge €125.** |
| B4 | Consumer, closed/unavailable | PASS (src+jest) | module gated `!closed && detail.bookable !== false` (`:701-702`). Adversarial test asserts all 4 gate clauses. |
| B5 | Edge fn, plan trip | PASS (src+jest+revert) | `nativeCheckoutFlow.ts:210` conditional body key; never `'auto'` for a plan trip. **Independently fails-on-revert proven (§5).** |

---

## 3. FINDINGS

### P3-1 — qty stepper exists ONLY at Review (payment.tsx), not on the public page
**Evidence:** `payment.tsx` adds the `−/+` qty stepper; the public page `TripPaymentChoice` always projects qty=1 (`TripCheckoutFlow.tsx:83` passes no multiplier). **Impact:** a buyer who wants 2 spots sees the qty-1 deposit on the public page and only the correct ×2 number at Review. SPEC §2.7 explicitly puts the stepper at Review only (single-ticket ORCH-1117 reality, 45/45 single-tier), so this is **spec-compliant by design**, not a defect — logged P3 as a UX watch-item only. **Required fix:** none (in-scope decision). **Retest:** n/a.

### P4-1 (praise) — defensive projection + extraction parsing
`projectInstallmentSchedule` clamps malformed qty (0/NaN/neg/fractional → ≥1 int) and `extractTripInstallmentSchedule` fails safe to null on every malformed-metadata variant — no crash path, no fabricated amounts (Constitution #3/#9). Adversarial test exercises all three.

### P4-2 (praise) — consent fix is end-to-end and conditional
The DISC-1130-A fix threads an explicit choice through 3 hops (`ConsumerTripDetailScreen` hasPlan-gate → `ExpandedBusinessEventSheet` conditional forward → `nativeCheckoutFlow` conditional body key), each present-only so a no-plan trip's request stays byte-identical. Clean, reversible, gated.

**No P0. No P1. No P2.**

---

## 4. STATE-MATRIX / PARITY VERIFICATION (both apps)

| Surface | Ships here | Result | Note |
|---|---|---|---|
| Consumer iOS | YES | PASS (src+jest), device-deferred | shared RN; `ConsumerTripDetailScreen` module |
| Consumer Android | YES | PASS (src+jest), device-deferred | same RN; Android opaque-glass via literal-hex module (consumer screen uses literal hex, NOT GlassCard — see Discoveries) |
| Buyer/anon Web | YES | PASS (src), device-deferred | `/t/` + `/checkout-trip/*`; anon-safe (no `useAuth`), allowlisted (`PUBLIC_BUYER_ROUTE_PREFIXES` has `/t/` + `/checkout-trip/`) |
| Business iOS | YES | PASS (src+jest), device-deferred | same `/checkout-trip/*` RN screens (parity automatic) |
| Business Android | YES | PASS (src+jest), device-deferred | same; business `TripPaymentChoice` uses `GlassCard` (opaque-fallback honored) |
| Admin Web | NO | skipped | no trip checkout surface |
| Business Web preview (authoring) | NO | skipped | authoring, not buyer checkout |

**Invariants preserved (SPEC §5):**
- InstallmentScheduleDisplay null-on-null: PASS (`InstallmentScheduleDisplay.tsx:106` early return; `TripPaymentChoice` early null at `:77`; consumer `projectConsumerSchedule` null-on-null).
- Anon `/t/` no-`useAuth`: PASS (only a doc-comment mention; zero call). `/t/` + `/checkout-trip/` allowlisted at `coldLoadAuthGates.ts:137/141`.
- Trip-specific `/checkout-trip/{id}` routing (never `/checkout/{id}`): PASS — 30/34 routing assertions green in `eventType.filter.audit.test.ts` (4 fails are BASELINE, §6).
- Single-ticket ORCH-1117 lock: PASS — no multi-tier affordance built; bar uses exact price for single-tier, "From" only for >1 tier (no prod data).
- Currency-awareness: PASS — EUR + GBP proven (adversarial test); no hardcoded glyph in `TripPaymentChoice` body.
- Refund ladder + countdown/closed banner (ORCH-0875): PASS — `RefundPolicyDisplay` + countdown intact on `[tripSlug].tsx`.
- FloatingOfferingBar price anchor: PASS — unambiguous `{price} total` on plan trips.
- Funnel 2-step single-tier: PASS — `CheckoutHeader totalSteps={2}` on buyer + payment.

---

## 5. STEP 0.5 — INDEPENDENT RE-RUN OF IMPLEMENTOR'S FAILS-ON-REVERT

I checked out HEAD `a71ab457e` and ran both implementor proofs MYSELF (not trusting the report):

**(a) Business happy-path** `TripPaymentChoice_orch_1130_regression.test.ts`:
- Normal: 12/12 PASS.
- Revert (true line-deletion of the "Pay over time" `<Pressable>` segment, 913 bytes, via python script): **"two segments" test FAILED → 1 failed / 11 passed.** Restored via `git checkout --` → 12/12 PASS, tree clean.
- **Implementor fails-on-revert confirmed at `a71ab457e`** (matches their `068eb72ed` claim; same assertion).

**(b) Consumer consent `.mjs`** `app-mobile/scripts/ci/orch-1130-consumer-payment-choice-check.mjs`:
- Normal: PASS ("explicit payment_plan_choice threaded end-to-end; no silent 'auto'").
- `ORCH1130_SIMULATE_REVERT=1`: **FAILED — all 3 teeth fired** (nativeCheckoutFlow body-key, EBES forward, screen thread).
- **Confirmed at `a71ab457e`.**

Both products' test files appear in `git diff origin/main...HEAD --name-only` (on-branch, in-diff).

---

## 6. ADVERSARIAL TEST ADDED (tester-owned, different angle)

**Path:** `mingla-business/src/components/trip/__tests__/TripPaymentChoice_orch_1130_adversarial.test.ts` (NEW, append-only, 14 tests, all PASS).

**Angle (DIFFERENT from the implementor's source-characterization happy-path):** edge/boundary/invariant — qty=2 scaling reconciliation, GBP currency edge, the EXACT consent-value gating at all 4 sites (no unconditional key, no `'auto'` on a plan trip, omit on no-plan), and closed/free/no-plan suppression invariants.

**Fails-on-revert — proven on TWO independent teeth (true product-code line-deletion, then restored clean):**
- Revert qty scaling (`tier.priceCents * qty` → `tier.priceCents`): **2 tests FAILED** (qty=2 deposit/legs, multiplier-bites).
- Revert consent gate (`...(input.paymentPlanChoice ? {…} : {})` → `payment_plan_choice: input.paymentPlanChoice ?? "auto"`): **1 test FAILED** (omit-on-absent).
- Both restored → 14/14 PASS, `git status` shows only the new untracked test.
- **fails-on-revert verified at `a71ab457e`.**

**ORCH-1130 jest aggregate:** 5 suites (adversarial + happy-path + InstallmentScheduleDisplay_wiring + _adversarial + ORCH-0876.adversarial) = **98/98 PASS.**

---

## 7. NEW vs BASELINE FAILURE SEPARATION

**NEW failures attributable to ORCH-1130:** ZERO.

**Pre-existing BASELINE (proven on anchor `main`, commit `3ee37eb75`, with node_modules):**
- `src/components/trip/__tests__/` broad run: 27 failed / 336 passed. The 10 failing suites (`EditPublishedTripScreen.*`, `PaymentPlanEditor(.test/_adversarial)`, `TripCreatorWizard.cover`, `TripVisualParity(.test/_adversarial)`, `tr2RewordPolish`, `TripPublishStripeBanner`, `IntakeTypePickerSheet_orch_0884`) are all **authoring-side** and **untouched by this branch** (neither the test files nor their source files appear in `git diff origin/main...HEAD`). Ran 3 of them on the anchor `main`: **14 failed / 66 passed — identical.** Confirmed baseline (stale source-characterization: moved file paths / ORCH-1114 Share supersession).
- `eventType.filter.audit.test.ts`: 4 failed / 30 passed on the worktree AND **identical on anchor `main`**; none of the 4 fail-source files touched by ORCH-1130. The 30-assertion trip-routing invariant the SPEC requires is GREEN.
- **typecheck:** worktree 263 `error TS` vs anchor main 260 — the +3 delta is `IconChrome.tsx` / `Sheet.web.tsx` / `normalizeTripDayImage.ts` (an `expo-image-manipulator` module-resolution / worktree dependency-drift issue), **NOT ORCH-1130 files.** The 4 ORCH-1130 component files (`TripPaymentChoice`, `TripCheckoutFlow`, `CartContext`, `CheckoutHeader`) produce **0 type errors.** `buyer.tsx` TS7006 is `@mingla/phone-input` baseline (41 TS7006 on anchor too).
- **lint:** `TripPaymentChoice.tsx` + the new adversarial test: clean (no warnings beyond `@mingla/*` no-unresolved worktree-link baseline).

**Strict-grep gates (ran myself):**
- `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint`: PASS (3 files, all markers). Scope realignment is `[TEST-MOD-APPROVED ORCH-1130]`-documented, supersedes ORCH-0882 passive-disclosure for the redesigned funnel — legitimate, not over-broadened.
- `i-proposed-pay-in-full-opt-out-no-installment-rows`: PASS (5 files, 0 violations).

---

## 8. CROSS-DOMAIN BLAST

- **Event checkout `/checkout/[eventId]`:** UNAFFECTED. Shares CartContext but **never reads `paymentPlanChoice`** (grep: 0 hits in `app/checkout/[eventId]/`). The CartContext change is purely additive (new `SET_PAYMENT_PLAN_CHOICE` action + field default "full"); event reducer paths untouched. `CheckoutHeader totalSteps` widened to `2 | 3` — event side uses `={3}` (valid).
- **ORCH-1025 native cart / event path:** `node app-mobile/.../orch_1025_seamless_native_cart.test.tsx` → **18/18 PASS** (incl. EBES no-longer-forwards-taxCalculationId, payload shape). The shared `nativeCheckoutFlow`/EBES changes do not regress the event/experience path.
- **ORCH-1016 consumer trip detail adversarial:** `node …/orch_1016_consumer_trip_detail.adversarial.test.tsx` → **18/18 PASS.**
- **ORCH-1117 single-ticket floating bar / ORCH-0875 refund+countdown:** preserved (§4).

---

## 9. CONSTITUTION 14-RULE MATRIX

| # | Rule | Result | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS (src) / **device-deferred** | every Pressable (`TripPaymentChoice` 2 segments, qty `−/+`, consumer module segments) has a real `onChange`/`onPress` + reachable target; mounted on each path's own render (not conditionally unmounted — the toggle is INSIDE the rendered branch). **Runtime firing = §7 device proof.** |
| 2 | One owner per truth | PASS | CartContext is sole owner of `paymentPlanChoice` across the funnel; public page owns its local copy and seeds CartContext via route param (documented deviation §8 of impl report). |
| 3 | No silent failures | PASS | projection/extraction fail-safe to null (no crash); checkout errors surfaced via `extractFunctionError`. |
| 4 | One query key per entity | N/A | no new query keys. |
| 5 | Server state server-side | PASS | CartContext is in-memory session (no Zustand/AsyncStorage); choice is client UI state. |
| 6 | Logout clears | N/A | anon checkout; no auth state added. |
| 7 | `[TRANSITIONAL]` labeled | N/A | no transitional code added. |
| 8 | Subtract before adding | PASS | passive projection cards REMOVED (4× → 1 selector-gated); hero dupe removed. |
| 9 | No fabricated data | PASS | every amount derives from the projected schedule; clamps prevent fabricated qty scaling. |
| 10 | Currency-aware | PASS | EUR+GBP via `formatCurrency`/`Intl.NumberFormat`; adversarial test proves no hardcoded glyph. |
| 11 | One auth instance | PASS | no `useAuth` on `/t/` or any new dep. |
| 12 | Validate at right time | PASS | projection anchors on caller-supplied `new Date()`; deposit/dates computed at render. |
| 13 | Exclusion consistency | N/A | no exclusion logic touched. |
| 14 | Persisted-state startup | N/A | cart is non-persisted by design. |

---

## 10. DEVICE-PROOF CHECKLIST (gates the upgrade to full PASS) — for Seth

Stripe is in TEST mode end-to-end (safe; no real money). Do these on your physical iPhone + an Android device/emulator:

**A. Business web (anon, logged-out) — `https://business.usemingla.com/t/travelbrand/the-sone`**
1. Open the URL in a **logged-out** browser (or private window). Expected: the public trip page renders (NOT bounced to sign-in) — anon-reachability proof.
2. Scroll to the "HOW YOU PAY" block. Expected: a two-segment toggle, **"Pay in full" selected by default**, supporting block reads **"Charged today … €500"**, NO schedule ladder visible.
3. Tap **"Pay over time."** Expected: the toggle switches (orange border + fill + dot on the over-time segment), block reveals **€125 today (25% deposit) + the ladder: €250 on ~Jul 12 + €125 on ~Aug 11.** This is the dead-tap firing proof.
4. Tap the floating bar (reads **"€500 total"**, NOT "From €500"). Expected: lands on the funnel header **"1 OF 2 · Your details"** (single-tier auto-skip), NOT a tier-picker.
5. Continue to **"2 OF 2 · Review & pay."** Expected: the selector is **pre-filled to "Pay over time"** (your public-page choice survived the hop); a qty `−/+` stepper is on the order summary; the Pay button reads **"Pay €125 deposit"** (not €500). Switch back to "Pay in full" at Review → Pay button reads **"Pay €500"** (Review choice wins).

**B. Consumer app-mobile — same trip (the-sone)**
6. Open the trip in the consumer app. Expected: a "HOW YOU PAY" module under Pricing (default "Pay in full"), pre-Reserve disclosure "charges €500 today."
7. Pick "Pay over time" → disclosure "charges €125 today, the rest auto-charges." Reserve with a **Stripe TEST card** (`4242…`). Expected charge = **€125** (deposit), and the server received `payment_plan_choice="installments"` (NOT silent `'auto'`).
8. Repeat with "Pay in full" → charge = **€500**, server received `"full"`.

**C. Android (option-block glass)**
9. On Android (business + consumer), the "HOW YOU PAY" card/segments render **opaque** (no glass bleed-through), no square shadow halo, the orange selected-accent is visible.

If A2/A3/A5 (toggle fires, ladder reveals, choice survives + wins at Review), B7/B8 (charge equals €125 vs €500, no silent 'auto'), and C9 (opaque) all hold, this upgrades to **PASS**.

---

## 11. DISCOVERIES FOR ORCHESTRATOR (not fixed here)

1. **Pre-existing baseline jest failures need a sweep ORCH** — `eventType.filter.audit.test.ts` (4) + ~10 authoring trip suites read moved source paths (`app/trip/[id]/index.tsx` → `…/money/index.tsx`) / the ORCH-1114-superseded `Share.share()` assertion. Identical on anchor `main`. Worth a stale-test-realignment ORCH (the implementor flagged this too — Discovery #11). Not a launch blocker; just CI noise.
2. **Worktree `@mingla/*` package-link drift** — 263 vs 260 tsc + import/no-unresolved in the per-ORCH worktree (incl. `expo-image-manipulator` from ORCH-1119). A worktree dependency-state artifact (spawn-from-stale-anchor), not ORCH-1130 code. The closing PR merges to a fresh main where these resolve.
3. **Consumer "HOW YOU PAY" module uses literal hex, not `GlassCard`** — `ConsumerTripDetailScreen.tsx` styles the module with literal hex (consistent with the screen's existing pattern), so the Android opaque-glass policy is satisfied by literal opaque hex rather than the `GlassCard` opaque-fallback. Acceptable (still opaque), but worth noting the consumer module does not route through the shared `ANDROID_GLASS_USES_OPAQUE_FALLBACK` primitive — confirm opacity on the Android device proof (C9).

---

## 12. ROUTING

CONDITIONAL PASS with the §10 device checklist as the unaccepted condition → **STOP and surface to Seth** (do not route to CLOSE until the device proofs land). No code rework required. After Seth runs §10 and it holds → route to orchestrator CLOSE.
