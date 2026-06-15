# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] · Reserve goes STRAIGHT TO CART (+ arrow-bleed fix)

- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`
- **Base HEAD:** `9e220c58f` (rebased onto origin/main — up to date)
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1138_RESERVE_STRAIGHT_TO_CART.md` (binding)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1138_RESERVE_OPENS_SECOND_SHEET.md`
- **Status:** implemented and verified (sim live-fire for SC-1/2/3/7/8; SC-6 verified by source + structural; SC-4/5 verified by source + request-shape test)
- **Comms ledger:** read on entry. No OPEN BLOCK to mingla-implementor / ORCH-1138 / ALL. WARN rows acked: COMMS-0027 (concurrent-OTA/Metro cache poison — honored: ran an isolated app-mobile Metro on a dedicated port 8089 with `--clear` + isolated TMPDIR from a bracket-free symlink), COMMS-0030 (mingla-business iOS build break — N/A; this is the consumer `app-mobile` dev build, which is unaffected and was already installed + booted). COMMS-0009 (anon-read constraint) honored — no `.from('brands')` introduced; theming stays on `business_public_events_view` via `useEventTheme`.

---

## 1. Summary (plain English)

On the consumer trip detail screen, tapping **"Reserve my spot"** used to open a SECOND full detail page (the shared `ExpandedBusinessEventSheet` → `PublicEventPage`) and only a second Buy tap reached the cart. Now Reserve opens the **cart (`TicketCartSheet`) directly** — seeded at the trip's single tier, forwarding the same pay-in-full vs pay-over-time choice and the same deposit-due-today — so the checkout request is byte-identical to the old two-tap path, one tap shorter. The duplicate-detail hop is deleted (trip-only code only; the shared sheet is untouched and still serves events + experiences). In the same pass, the docked Reserve CTA's `→` arrow no longer bleeds off the right edge when "Pay over time" is selected: the long price truncates with an ellipsis and the label+arrow stay pinned inside the button.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified how | Result |
|----|-----------|--------------|--------|
| SC-1 | Reserve opens the cart directly, no intermediate detail page | iOS sim live-fire — tapped Reserve on "The DC Adventure" trip → `TicketCartSheet` ("Get tickets" + qty stepper + Continue to Payment) opened with NO `PublicEventPage` between. Evidence `SC1_01/SC1_02`. | ✓ |
| SC-2 | Single-tier trip → cart pre-seeded at that tier, qty 1 | Sim — cart opened with "Standard €500.00" at qty 1 (`SC1_02`). | ✓ |
| SC-3 | Plan trip + "Pay over time" → cart sticky bar leads with "Due today" = deposit | Sim — selected Pay over time (deposit €125), tapped Reserve → cart bar read **"Due today €125.00"** (not Subtotal €500). Evidence `SC3`. | ✓ |
| SC-4 | Checkout request byte-identical (same `paymentPlanChoice`, `intakeFormData`, no `address`/`taxCalculationId`); same caches invalidated | Source: `handleBuy` ported verbatim from EBES; request-shape test T-4 (no address/taxCalc, lines/buyer/marketingOptIn forwarded, orders+circle invalidations). `nativeCheckoutFlow` gates `payment_plan_choice` on truthiness so `undefined` == omitted (byte-identical). | ✓ (source + test) |
| SC-5 | Free trip → cart free ("Get free") branch | Source: `openCart` uses the SAME path for free tiers; `TicketCartSheet` owns the free CTA branch (no separate code path). No free trip in prod to live-drive. | ✓ (source) |
| SC-6 | Events + experiences STILL open EBES, unchanged | DO-NOT-TOUCH files git-pristine (`ExpandedBusinessEventSheet.tsx`, `ExpandedCardModal.tsx`, `MessageInterface.tsx`); `i-consumer-payment-flow-frozen` gate green (fingerprints EBES unchanged); my straight-to-cart test + existing trip tests green. Sim: an event opened through its OWN path (web public page), distinct from the trip cart — no cross-contamination. Deck/chat-mounted EBES not live-driven (auth-gated). Evidence `SC6_01/02`. | ✓ (source + structural; deck-EBES not live-driven) |
| SC-7 | Docked "Reserve my spot →" arrow stays inside the button in both pay states | iOS sim live-fire — in "Pay over time" the docked CTA showed "From €125.00…" (price truncated with ellipsis) and "Reserve my spot →" with the arrow fully INSIDE the orange button. Evidence `SC7_02`. Pay-in-full compare `SC7_00`. | ✓ |
| SC-8 | Cancelling the cart returns to the trip detail (no blank screen) | Sim — closed the cart via X → returned to the trip detail (`orch1138-cart-closed`). | ✓ |

---

## 3. Files changed

| File | +/− | Scope |
|------|-----|-------|
| `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | +~250 / −~100 | allowlist (FIX 1 + FIX 2) |
| `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` | +~26 / −~5 | allowlist (FIX 3, both surfaces share this RN component) |
| `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_straight_to_cart.test.ts` | NEW (+~120) | allowlist (regression test) |
| `.github/scripts/strict-grep/orch-1138-trip-reserve-straight-to-cart.mjs` | NEW (+~135) | allowlist (CI gate) |
| `.github/workflows/strict-grep-mingla-business.yml` | +12 | gate registration (required for the new gate to run — per the gate README's "1 script + 1 workflow step") |
| `app-mobile/scripts/ci/orch-1130-consumer-payment-choice-check.mjs` | +~20 / −~9 | keep-green per SPEC §8.4 (consent invariant re-pointed to the direct-cart wiring) |
| `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx` | +8 / −5 | TEST-MOD (R1f-4 asserted the now-removed `setReserveSheetVisible` press; updated to `openCart`) — requires `[TEST-MOD-APPROVED ORCH-1138]` in the commit body |

**The FIX 3 "both surfaces" note:** the SPEC §4.2 directed applying the SAME fix to `mingla-business/src/components/trip/TripReserveBar.tsx` "if it has the same layout (parity)." I inspected it — see §10. The consumer `ConsumerTripReserveBar.tsx` is the only surface that exhibits the bleed (it carries the price/kicker block beside the label+arrow in one flex row). The business `TripReserveBar.tsx` is DO-NOT-TOUCH per the SPEC allowlist and was not modified.

---

## 4. Data-model changes applied

NONE. No migration, no schema, no RLS, no edge function. The checkout request is byte-identical; only the mounting component changed.

---

## 5. Edge functions touched

NONE. `ticket-checkout-create` is unchanged (DO-NOT-TOUCH). `verify_jwt` values: N/A (no edge change).

---

## 6. Regression tests added

- **Happy-path (implementor):** `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_straight_to_cart.test.ts` — 15 `node:assert` source-assertions covering T-1 (cart not EBES), T-2 (adapter removed), T-3 (pay choice + dueToday forwarded), T-4 (no address/taxCalc; lines/buyer/marketingOptIn; orders+circle invalidations), T-7 (arrow guard: `rLeft` flexShrink:1+minWidth:0, `rCta` flexShrink:0, price + label `numberOfLines={1}`). All pass.
- **Structural gate (implementor):** `.github/scripts/strict-grep/orch-1138-trip-reserve-straight-to-cart.mjs` — asserts the screen has no EBES import/mount, no dead adapter, and DOES mount `TicketCartSheet`. Self-tested via `ORCH1138_SIMULATE_REVERT=1` (FAILs on revert).
- **fails-on-revert verified at `9e220c58f` worktree state (pre-commit):**
  - Arrow fix: deleted `flexShrink: 0` from `rCta` → test exit 1 (T7b failed). Restored → exit 0.
  - Routing fix: deleted both `onPress={openCart}` lines → test exit 1 (T1d failed). Restored → exit 0.
  - Gate: `ORCH1138_SIMULATE_REVERT=1` → exit 1. Normal → exit 0.
- The tester writes the SECOND adversarial test.

---

## 7. Old → New receipts

### `ConsumerTripDetailScreen.tsx`
**Before:** Reserve `onPress={() => setReserveSheetVisible(true)}` mounted `<ExpandedBusinessEventSheet data={card}>` (a full duplicate `PublicEventPage` detail), reaching the cart only on a 2nd Buy tap. A full `tripToBusinessEventCard()` adapter built the EBES card; `useEventTheme(card)` reused it.
**After:** Reserve `onPress={openCart}` seeds the first sellable tier into `initialTicketTypeId` and opens `<TicketCartSheet eventId={detail.tripId} …>` directly. The screen owns `usePublicEventTickets` + `useTripIntakeSchemas` + `useNativeCheckoutFlow` + `useQueryClient` + `useAppStore(user/profile)`; `handleBuy` is ported VERBATIM from EBES (same guards, same byte-identical request — no address/taxCalc, `paymentPlanChoice: detail.hasPlan ? choice : undefined`, intakeFormData spread; same success/cancel/failure toasts; same orders+circle invalidations + 3× polling loop). The full adapter is deleted; a minimal `card = { eventId: detail.tripId }` memo remains solely for `useEventTheme` (which reads only `card.eventId`). `reserveSheetVisible` state removed; `cartVisible`/`initialTicketTypeId`/`checkoutInFlight` added.
**Why:** SC-1..SC-5 (Reserve straight to cart), F-1 root cause, F-2 deletion-safety, OQ-1 cache parity.
**Lines:** ~+250 / −100.

### `ConsumerTripReserveBar.tsx`
**Before:** the docked `reserve` row was `flexDirection:"row"`, `space-between`, no shrink guard; `rLeft` (kicker+price) uncapped; `rCta` (`{label} →`) no `flexShrink`/`numberOfLines`. A long "Pay over time" price ("From €125.00 today") pushed `rCta` and its `→` past the right padding → the arrow bled out.
**After:** `rLeft` gets `flexShrink:1` + `minWidth:0` (yields space first); the price + kicker `<Text>` get `numberOfLines={1}` + `ellipsizeMode="tail"` (truncate); `rCta` gets `flexShrink:0` + `numberOfLines={1}` (label+arrow keep intrinsic width, stay one line, pinned inside). `floatCta` gets a defensive `flexShrink:0`. Strings, accent, kicker logic UNCHANGED (pure layout-overflow fix).
**Why:** SC-7 / F-4.
**Lines:** ~+26 / −5.

---

## 8. Cross-surface impact table

| # | Surface | Affected | What changes / why not | Parity |
|---|---------|----------|------------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | YES | Reserve → cart directly; arrow no longer bleeds | — |
| 2 | Consumer Android (`app-mobile`) | YES | Same — shared RN component | Automatic |
| 3 | Buyer/anon Web (`mingla-business` `/t/...`) | NO | separate web trip page + `TripCheckoutFlow` (DO-NOT-TOUCH) | — |
| 4 | Business iOS | NO | no business trip-detail change | — |
| 5 | Business Android | NO | — | — |
| 6 | Admin Web | NO | — | — |
| 7 | Business Web preview | NO | — | — |
| — | Consumer EVENTS + EXPERIENCES (deck modal + chat) | MUST NOT REGRESS | EBES + ExpandedCardModal + MessageInterface git-pristine; frozen-fingerprint gate green | F-2 guard held |

---

## 9. Smoke result (iOS sim live-fire)

Booted iPhone 17 Pro (UDID `17091E60…`). Consumer dev build `com.mingla.app.v2` already installed; ran an ISOLATED app-mobile Metro on port 8089 (`--clear`, isolated TMPDIR, from a bracket-free symlink `/tmp/orch1138-mobile` → the worktree `app-mobile`) per COMMS-0027; deep-linked the dev build to it; fresh bundle served from this worktree's source. Drove with Maestro + idb (no osascript keystrokes).

1. Cold deep-link `com.mingla.app.v2://t/travelbrand/the-dc-adventure` → NEW `ConsumerTripDetailScreen` mounted (cover, "The DC Adventure", floating Reserve pill, arrow inside). `SC1_01`.
2. Tap "Reserve my spot" → **cart opened DIRECTLY** ("Get tickets" / "SELECT YOUR TICKETS" / Standard €500 / qty stepper / Continue to Payment) — NO duplicate detail page. `SC1_02`. (SC-1, SC-2)
3. Close cart (X) → returned to the trip detail, no blank screen. (SC-8)
4. Scroll → "Choose how you pay" → select "Pay over time" (DUE TODAY €125, schedule rows). `SC7_01`.
5. Docked Reserve CTA in pay-over-time: "From €125.00…" (ellipsis-truncated price) + "Reserve my spot →" arrow **fully inside the button**. `SC7_02`. (SC-7)
6. Tap docked Reserve → cart opened directly, sticky bar reads **"Due today €125.00"**. `SC3`. (SC-3)
7. Opened an event (brand page `/b/leggothis` → View) — routed to the event's OWN path (web public page), distinct from the trip cart; app stable, no trip-screen leakage. `SC6_01/02`. (SC-6 cross-contamination check)

Evidence: `Mingla_Artifacts/evidence/ORCH-1138/SC1_*.png`, `SC3_*.png`, `SC7_*.png`, `SC6_*.png`, `00_app_booted.png`.

---

## 10. Known issues / deferred

- **SC-6 deck/chat-mounted EBES not live-driven:** the runtime entry that mounts `ExpandedBusinessEventSheet` (Discover deck + chat) is auth-gated; I couldn't sign in. SC-6 is proven by source (EBES/ExpandedCardModal/MessageInterface git-pristine), by the `i-consumer-payment-flow-frozen` gate, and by the events-open-their-own-path sim check. The tester should live-drive a deck event + a chat experience once authed.
- **SC-5 free-trip cart not live-driven:** no free trip exists in prod (`status='scheduled'` trips are all single-tier paid plan trips). Verified by source — `openCart` and `TicketCartSheet`'s free branch are unchanged.
- **`mingla-business/src/components/trip/TripReserveBar.tsx` (web/business) NOT modified:** it is on the SPEC DO-NOT-TOUCH list (separate web surface). The SPEC §4.2 said apply the parity fix "if it has the same layout"; it is a different surface and explicitly do-not-touch, so per stop-and-amend I left it. If the business/web docked CTA shows the same bleed, that is a separate ORCH against the web surface — flagged to the orchestrator.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

- **Migration `db push`:** NONE.
- **Edge-fn deploy:** NONE.
- **OTA:** this is a pure-JS `app-mobile` change → ships via `eas update` on close (per the OTA-deferred policy), no native rebuild needed.
- **Commit-body token (CLOSE PR):** the closing commit/PR that carries `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx` MUST include `[TEST-MOD-APPROVED ORCH-1138]` in the body (the R1f-4 assertion was updated from the removed `setReserveSheetVisible` press to `openCart` — a 5-line deletion that `tests-append-only.yml` blocks without the token). My worktree commit already carries it.

---

## 12. Discoveries for Orchestrator

- **Pre-existing RED test on this branch (NOT caused by me):** `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts` T3a asserts `style={[styles.wrapper, { bottom: wrapperBottom }]}`, but `ConsumerTripReserveBar.tsx` renamed `wrapper`→`floatWrapper` in an earlier ORCH-1138 device-rework leg. This assertion fails identically at HEAD `9e220c58f` BEFORE my edits (confirmed by git stash). My changes neither caused nor touched it. Needs a `[TEST-MOD-APPROVED]` fix in a follow-up (or by this ORCH's tester) — out of my SPEC scope.
- **Pre-existing drift in the ORCH-1130 CI gate:** before my edits, `orch-1130-consumer-payment-choice-check.mjs` asserted `accessibilityRole="radiogroup"` + a "Reserve charges" disclosure, but ORCH-1138's "Choose how you pay" redesign legs had already replaced the radio-dot pills with a `tablist` toggle and dropped that disclosure — so the gate was ALREADY RED on this branch. I re-pointed it to the truthful current structure (tablist + the direct-cart consent forward) while preserving the consent teeth (still fails-on-revert). Flag: the World Map / ledger should note the gate was drifted before this ORCH.
- **`stripComments` fragility (shared pattern):** the screen's doc comments contain a literal `/*)` inside a `//` line; the common strict-grep `stripComments` (block-comment-first) swallows real code after it. My new gate + test strip LINE comments first, then block. Other gates using the block-first order on this file would mis-scan — worth a sweep.

---

**Routing:** back to the orchestrator for REVIEW → then `mingla-tester` (live-fire SC-1..SC-8 on device, auth-in to drive the deck-EBES + free-trip legs, and the pre-existing-red foundation test). Do NOT deploy/merge/close.
