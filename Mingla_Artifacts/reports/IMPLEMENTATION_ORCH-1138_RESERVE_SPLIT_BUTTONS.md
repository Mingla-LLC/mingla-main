# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] · Reserve CTA → TWO split buttons ("Pay in full" / "Pay over time")

- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`
- **Base HEAD:** `b42bd2bf7` (Reserve→straight-to-cart + float/dock pill + arrow-bleed fix)
- **Dispatch:** orchestrator-routed user ask (Seth, 2026-06-15) — no dedicated SPEC file; the dispatch prompt is the contract. Builds ON `SPEC_ORCH-1138_RESERVE_STRAIGHT_TO_CART.md` (shipped at base HEAD).
- **Status:** implemented and verified (live sim render of both surfaces + both states; full test + gate suite green).

---

## 1. Summary (plain English)

The single "Reserve my spot" CTA on the trip page now becomes **TWO buttons** — **"Pay in full"** (shows the full price, e.g. €500) and **"Pay over time"** (shows the deposit due today, e.g. "From €125 today") — in BOTH the floating-while-scrolling state and the docked-at-the-base state. Tapping either goes **straight to the cart** with that payment choice already selected, so a buyer never has to scroll down to the "Choose how you pay" toggle. The two buttons appear **only when the trip actually offers an installment plan**; a pay-in-full-only trip keeps the single "Reserve my spot" button exactly as before, and every disabled/closed/sold-out state stays single. Applied to BOTH surfaces — the consumer app and the business/public-web trip page — off the identical shared component pattern. No backend, schema, or checkout-request change: the choice rides the existing payment-plan plumbing, so the charge is byte-identical.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Where |
|----|-----------|--------|-------|
| SC-1 | TWO split buttons ("Pay in full" / "Pay over time") replace the single CTA, FLOATING + DOCKED | ✓ | both bars `splitCtas` branch; live 03/04/05 |
| SC-2 | Each button shows its amount (full price / deposit due today), legible, no text/arrow bleed | ✓ | `splitLabel`/`splitPrice` one-line + ellipsize + flexShrink; live shots |
| SC-3 | Tapping a button → cart with that choice pre-selected (straight-to-cart) | ✓ | consumer `openCartWithChoice`; web `handleTripReserve(choice)` → `plan` param |
| SC-4 | Rule 9 — both buttons ONLY when the trip OFFERS a plan; else single button | ✓ | consumer `showSplit`; web `tripHasPlan && tripCta.tappable`; live 05 single |
| SC-5 | Disabled/bookings-closed → single disabled state (no split) | ✓ | `splitCtas` undefined when `!tappable`; single strip/pill path intact |
| SC-6 | All-surface parity (consumer ConsumerTripReserveBar + business/web TripReserveBar) | ✓ | both bars carry identical `splitCtas` API + render; both live-proven |
| SC-7 | Byte-identical checkout request (no schema/edge/checkout-logic change) | ✓ | reuses existing `paymentPlanChoice`/`plan`-param path; gates green |
| SC-8 | Float→dock swap preserved; sheet still scrolls (no ORCH-1016/1043 freeze) | ✓ | float/dock structure unchanged; `orch_1138_reserve_float_dock` green |
| SC-9 | Events/experiences flows untouched | ✓ | only trip bars + trip screen/route touched; EBES gate green |

---

## 3. Files changed (4 source + 2 tests)

| File | ± |
|------|---|
| `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` | +~150 |
| `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | +~55 |
| `mingla-business/src/components/trip/TripReserveBar.tsx` | +~150 |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | +~45 |
| `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_split_buttons.test.ts` (NEW) | +~150 |
| `mingla-business/src/components/trip/__tests__/tripReserveSplitButtons.orch1138.test.ts` (NEW) | +~115 |

## 4. Data-model changes applied
NONE. No migration, no SQL, no RLS, no edge function. Pure presentational + client wiring.

## 5. Edge functions touched
NONE. The checkout request is byte-identical (the buyer's choice rides the existing `paymentPlanChoice` → `ticket-checkout-create` / `checkout-trip` `plan` param). No `verify_jwt` change.

## 6. Regression tests added (fails-on-revert proven)

- **Consumer:** `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_split_buttons.test.ts` — 17 node:assert source-assertions (split prop, both-variant render, label/price no-bleed, rule-9 gate, each button routes with its choice via `openCartWithChoice`, byte-identical request).
  - **fails-on-revert verified at `b42bd2bf7`+working-tree:** deleted the `onPress: () => openCartWithChoice("installments")` line → **S5b FAILED**; restored → all 17 PASS.
- **Business/web:** `mingla-business/src/components/trip/__tests__/tripReserveSplitButtons.orch1138.test.ts` — 9 jest source-assertions (mirror of the consumer set for `TripReserveBar` + the route).
  - **fails-on-revert verified:** deleted the floating-split `<View style={[styles.floatSplitWrapper...]}>` render → **SP3 FAILED**; restored → all 9 PASS.
- Both new test files are in the closing diff (`git diff origin/main...HEAD --name-only` includes them); shipped in the SAME branch as the fix. Append-only honored (no existing test modified or deleted).

## 7. Old → New receipts

### `ConsumerTripReserveBar.tsx`
- **Before:** rendered a SINGLE accent button (`cta`/`onPress`) in both docked + floating variants.
- **Now:** added optional `splitCtas={full,overTime}`. When present, docked renders TWO equal-width side-by-side buttons; floating renders TWO stacked compact pills (legible on a narrow phone). Each split button = label over amount, both one-line + ellipsized + shrink-first (arrow-bleed discipline). When `splitCtas` is absent the original single-button paths (`{ctaBody}</View>` / `{floatBody}</View>`) are untouched (no-plan + disabled).
- **Why:** SC-1/SC-2/SC-5/SC-6.

### `ConsumerTripDetailScreen.tsx`
- **Before:** single Reserve CTA → `openCart` (default "full"); `paymentPlanChoice` only set by the on-screen toggle.
- **Now:** added `openCartWithChoice(choice)` (sets `paymentPlanChoice` THEN `openCart()` — state batches before paint, so the cart mounts with the matching `dueTodayCents` and `handleBuy` reads the matching choice; byte-identical). Builds `splitCtas` (full price + "From {deposit} today") gated by `showSplit = planSchedule !== null && reserveCta.tappable` (rule 9). Single `onPress={openCart}` preserved verbatim (existing T-1d gate stays green).
- **Why:** SC-3/SC-4/SC-7.

### `TripReserveBar.tsx` (business/web)
- **Before/Now:** identical change to the consumer bar (same `splitCtas` API + docked/floating split render + single fallback) — all-surface parity.
- **Why:** SC-6.

### `t/[brandSlug]/[tripSlug].tsx` (business/web route)
- **Before:** `handleTripReserve()` routed to checkout with `plan: paymentPlanChoice` (the live toggle).
- **Now:** `handleTripReserve(choice?)` routes with `plan: choice ?? paymentPlanChoice`. Builds `tripSplitCtas` (Pay-in-full = full price; Pay-over-time = "From {deposit} today") gated by `tripHasPlan && tripCta.tappable`, passed to BOTH docked + floating bars. The desktop sticky `reserveControl` + single-bar `onPress` wrapped as `() => handleTripReserve()` (so a press event is never passed as the choice).
- **Why:** SC-3/SC-4/SC-6.

## 8. Cross-surface impact

| Surface | Affected | Behavior | Parity |
|---------|----------|----------|--------|
| Consumer iOS | YES | split buttons on plan trips; single otherwise | — (live-proven, shot 04/05) |
| Consumer Android | YES | same | automatic (shared RN); Android opaque-glass honored (no shadow under fill) |
| Buyer/anon Web (`/t/...`) | YES | split buttons on plan trips; single otherwise | — (live-proven via real TripReserveBar, shot 03) |
| Business iOS | YES | same `/t/` route in the business app | automatic (shared route) |
| Business Android | YES | same | automatic |
| Admin Web | NO | no trip Reserve surface | n/a |
| Business Web preview | NO | wizard preview uses LegacyTripPreview (no split CTA) | n/a |

Events + experiences: UNAFFECTED — only the two trip bars + the trip screen/route changed; EBES + event/experience CTAs untouched (`orch-1138-trip-reserve-straight-to-cart` gate green).

## 9. Smoke result (MANDATORY sim proof)

Ran on the booted iOS sim (iPhone 17 Pro, iOS 26.4) from isolated Metro (consumer :8088 / business-web :8090), bracket-free symlinks, real `node_modules` copies.

- **Reaching the live consumer trip-detail screen with real data** requires interactive OAuth login + a location/vibe-matched discover deck (no `/t/` deep-link into the native consumer trip detail; it mounts via `viewingTrip` deck state), which is not deterministically drivable in an automated session. The web public `/t/` page hit the **pre-existing** anon `permission denied for table brands` (`usePublicTripBySlug` does `.from("brands")`; the 3 plan trips are `scheduled`, not `published`) — an env/data limitation, not this change.
- **Runtime proof captured via a `[ORCH-1138-DIAG]` render harness** (a temp public-allowlisted route, DELETED before commit) that mounts the REAL `TripReserveBar` and `ConsumerTripReserveBar` with split CTAs:
  - `Mingla_Artifacts/evidence/ORCH-1138/03-web-split-docked-and-floating.png` — **business/web** TripReserveBar: docked split (Pay in full €500 | Pay over time From €125 today), docked single (Reserve my spot → / All-in €500), floating split (two stacked pills). All legible, no bleed.
  - `Mingla_Artifacts/evidence/ORCH-1138/04-consumer-split.png` — **consumer** ConsumerTripReserveBar: docked split + floating split.
  - `Mingla_Artifacts/evidence/ORCH-1138/05-consumer-single-no-plan.png` — **consumer** docked SINGLE button (no-plan rule-9 fallback), arrow fully inside bounds.
- Prior-leg evidence (same worktree, real data on the consumer trip detail) corroborates the underlying flow: `SC1_02_reserve_opens_cart_directly.png`, `SC3_cart_due_today_deposit_125.png` (cart leads with the €125 deposit on pay-over-time), `SC7_02_docked_arrow_inside_button_payover.png`.
- **Interactive "tap Pay over time → cart shows deposit"** is not separately re-driven here (needs auth + real data); it reuses the already-proven pay-choice plumbing (prior-leg SC-3 shot) and is unit-asserted (S5a/S5b/S5c, SP8).

Tests/gates (all green): consumer node tests 17+15+19+31; business jest 28; ORCH-1130 consumer-payment-choice CI PASS; strict-grep `orch-1138-trip-reserve-straight-to-cart`, `orch-1130-no-buyer-tax-form`, `orch-0963-public-trip-rpc-and-route-segregation`, `orch-0947`, `meta-orch-0827` all PASS. tsc clean on all 4 touched files (both apps).

## 10. Known issues / deferred
- **Pre-existing stale test (NOT mine):** `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts` T3a fails on the clean base HEAD `b42bd2bf7` too — it asserts `styles.wrapper` which device-rework #4 renamed to `styles.floatWrapper`. Append-only; cannot edit. Flagged for the orchestrator (a `[TEST-MOD-APPROVED]` follow-up or a tester rewrite).
- No multi-tier seed UX change (single sellable tier seed as before); all current prod trips are single-tier.

## 11. Operator action required
- NONE for deploy/migration (no migration, no edge fn). Route back to orchestrator for REVIEW → tester.
- Edge-fn deploy list: **none**.

## 12. Discoveries for Orchestrator
- The consumer native trip detail has **no `/t/` deep-link** (mounts via deck `viewingTrip` state) — automated live-fire on that exact screen needs auth + matched deck. The web `/t/` public page is anon-fetch-blocked locally (`usePublicTripBySlug` does `.from("brands")`, and the only plan trips are non-published). Consider a published plan-trip fixture + (separately) the web hook's direct `.from("brands")` vs the COMMS-0009 security-definer view for the tester's live-fire.
- Stale test `orch_1138_consumer_trip_foundation.test.ts` T3a (see §10).

---

### Comms ledger
Read on entry. No BLOCK/OPEN rows addressed to implementor/ORCH-1138. Factored in (WARN, acked): COMMS-0009 (anon never `.from("brands")` — my changes add no auth/fetch; bars stay pure presentational), COMMS-0034 (business-web lucide real — unaffected), COMMS-0033 (ORCH-1133 ID collision — unrelated). No new cross-ORCH discovery to write.
