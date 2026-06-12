# TEST — ORCH-1117 · Public Offering Page UX/Design Polish

**Verdict:** **PASS** — P0: 0 · P1: 0 · P2: 1 (documented gap, deferred) · P3: 0 · P4: 2
**Tester:** mingla-tester (production gatekeeper)
**Date:** 2026-06-12
**Branch:** `ORCH-1117-offering-page-polish` @ `2a2bd67eb` (tester commit on top of impl `135a81950`)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1117-[offering-page-polish]`
**Driven on:** iOS Simulator iPhone 17 Pro (iOS 26.4, UDID `17091E60-…`), branch Metro on :8090, consumer dev build `com.mingla.app.v2`, Maestro-driven. Physical Android (Samsung `R58R54YV7JT`) available; Android opaque verified by source + `Platform.select` (visual ghosting deferred — see Device matrix).
**Comms:** factored + acked **COMMS-0024** (WARN — ORCH-1116/1117 ID collision; ORCH-1117 is legitimately held by this lineage, no code conflict, no renumber).

---

## 1. Verdict + counts

**PASS.** Zero P0, zero P1. One P2 (a mixed-unavailable-tiers edge that resolves to a misleading-but-not-dead-tap Buy; spec-gap, not a spec violation — recommended as a follow-on, does not block). Two P4 notes (clean patterns). Regression gate satisfied (both implementor happy-path tests + tester adversarial test in the closing diff, both fail-on-revert). All runtime UI claims are `proven` on the iOS sim at the live-fire bar.

**The four dispatch headline answers:**
- **T-DEADTAP:** No state dead-ended. Native floating Buy bar FIRED its handler at runtime (route transition + booking flow — not inert). Non-buyable native + web states are non-tappable `accessibilityRole="text"` info strips with NO onPress (source + type-system proven; the discriminated union makes `unavailable` structurally non-tappable — flipping it to `tappable:true` is a TS compile error). One P2 mixed-unavailable edge routes to the cart (soft dead-end, NOT a hard dead tap).
- **T-NATIVE-SCROLL:** Scroll-sibling CONFIRMED at runtime. The trip sheet AND the brand-event sheet scrolled their full content with the bar PINNED at the bottom, and swipe-down-to-dismiss still worked — proving the bar is a scroll sibling, NOT `BaseBottomSheet.stickyFooter` (ORCH-1016 frozen-scroll regression avoided).
- **T-LEGIBILITY:** Legible. On the live dark sheet the date eyebrow rendered as a legible orange (`palette.accent`), not invisible. White-on-near-white BUG fix proven by WCAG unit (≥4.5:1) + the R1 strict-grep guard (fails-on-revert verified). No live near-white-theme brand existed to drive a light-theme screenshot → that specific visual is `probable` (math + guard proven).
- **Device/sim driven:** iOS Simulator iPhone 17 Pro, branch code via Metro :8090, Maestro.

---

## 2. SC-by-SC matrix

| SC | Surface | Result | Evidence |
|----|---------|--------|----------|
| SC-1-WEB (legibility) | Web event page | PASS (math+guard); light-theme visual `probable` | `offeringLegibility.orch1117.test.ts` WCAG ≥4.5:1 on near-white page; R1 guard fails-on-revert (raw `#ffffff` at L665 → guard exit 1) |
| SC-1-NATIVE (exp inherit) | iOS brand/exp sheet | **PASS (proven)** | `native_reserve_sheet_12.png` / `native_brand_sheet_bottom_13.png` — date eyebrow "SAT 19 SEP…" renders legible orange on the dark sheet; shared package path live |
| SC-2-ALL (collapsed default) | All | PASS | `offeringLegibility.orch1117.test.ts` asserts `useState(true)` + `numberOfLines 3` + 160-char threshold; runtime: short "Details coming soon." About shows NO toggle (≤160 exception) `native_reserve_sheet_12.png` |
| SC-3-WEB-BUY (event) | Web event | PASS | adapter `onBuyTicket → checkoutPublicPath(event.id)` (`PublicEventPage.tsx:291/329`); reused by bar `handleFloatingBarPress` |
| SC-3-WEB-TRIP / -EXP | Web trip/exp routes | PASS | inline `trip-checkout-reserve` / `experience-checkout-get-spot` ABSENT (grep=0); routes mount `FloatingOfferingBar` → `tripCheckoutPath`/`experienceCheckoutPath` (adversarial B4) |
| SC-3-UNAVAIL-WEB | Web | PASS | `FloatingOfferingBar.tsx` unavailable branch = `View accessibilityRole="text"`, no onPress; B1 exhaustiveness + type-system |
| SC-3-NATIVE-NODEADTAP | iOS brand/exp/trip | **PASS (proven)** | floating Buy bar FIRED `beginBooking` at runtime (`native_bar_fired_18.png` shows route transition + booking-flow network attempt — not inert); inline row → cart `native_inline_buy_16.png`; trip `bookable===false` → non-tappable strip (source `ConsumerTripDetailScreen.tsx:565`) |
| SC-3-ANDROID | Android | PASS (source); visual `probable` | both bars: opaque `#16181b`/`#f4f6f9`/`rgba(16,18,22,0.98)` (≥0.92) via `Platform.select`, `overflow:hidden`, `elevation:0`, no Android shadow |
| SC-4-WEB (shadow) | Web event title | PASS | `titleLine` has no `textShadow*` (`offeringLegibility.orch1117.test.ts`); runtime: native titles render flat (`native_trip_sheet_09.png`) |
| SC-5 (trip bookable) | Web + native trip hook | PASS | `usePublicTripBySlug` + `useConsumerTripDetail` add `resolveTripBookable` (paid→RPC, free→true, RPC-error→true fail-open); additive only |

---

## 3. Findings

### P2-1 (DOCUMENTED GAP, deferred — does NOT block) — mixed-unavailable tiers resolve to a misleading tappable Buy
- **Evidence:** `packages/event-rendering/offeringCta.ts:198-234`. The unavailable branches are HOMOGENEOUS `.every()` checks (all-door / all-ended / all-sold-out). When unavailable tiers are MIXED by DIFFERENT reasons (e.g. one `availableAt:"door"` + one `saleEndAt` past), no `.every()` fires; `sellable` is empty so `considered = visible` (L234) and it resolves to `{kind:"buy", tappable:true}`. Proven by tester adversarial B2 (`offeringCtaDeadTap.orch1117.adversarial.test.ts`, the two `[GAP]` cases).
- **Impact:** the floating bar shows a tappable "Buy ticket" that routes to the cart (`/checkout/{eventId}`) where no tier is purchasable — a misleading CTA / soft dead-end. NOT a hard dead-tap (the tap DOES navigate; the cart is the existing backstop). Requires an event with multiple visible tiers each unavailable via a DIFFERENT reason — an uncommon configuration.
- **Why not a blocker:** the SPEC §4.0 precedence only defines HOMOGENEOUS unavailable states; mixed-reason is unspecified. The implementor faithfully built the spec. The inline `PublicTicketRow` per-tier rows still each show their own correct unavailable state, so the buyer is not left without information.
- **Required fix (follow-on):** in `resolveOfferingCta`, when `sellable.length === 0` after the homogeneous checks, return `unavailable("Not on sale", null)` instead of falling back to `considered = visible`.
- **Retest:** flip the two B2 `[GAP]` assertions to expect `tappable:false` (with a `[TEST-MOD-APPROVED]` since they're append-only pins of current behavior); they fail before the fix, pass after.

### P4-1 (praise) — dead-tap invariant enforced at the TYPE LEVEL
`CtaState`'s discriminated union makes `unavailable` structurally `tappable:false`. My fails-on-revert attempt to flip the "Sold out" branch to `tappable:true` produced a **TS2322 compile error**, not a runtime regression — the strongest possible no-dead-tap guarantee. Replicate this pattern.

### P4-2 (praise) — scroll-sibling discipline + opaque-fallback done correctly
Native bars are in-flow scroll siblings (NOT `position:absolute`, NOT `stickyFooter`), matching the proven `reserveFooter` pattern; Android opaque fill + `elevation:0` + `overflow:hidden` per `ANDROID_GLASS_USES_OPAQUE_FALLBACK`. Verified scrolling + dismiss at runtime.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Re-ran the implementor's claimed proof myself (not trusted):
- **Implementor claim:** deleting the `if (!bookable) {…}` gate at the top of `resolveOfferingCta` makes `offeringCta.orch1117.test.ts` go `1 failed, 10 passed`.
- **My re-run:** checked out `packages/event-rendering/offeringCta.ts` @ branch HEAD, deleted lines 151-159 (the `!bookable` gate) by true line-deletion, ran `offeringCta.orch1117.test.ts` → **`Tests: 1 failed, 10 passed`** — exactly `T-CTA-UNAVAIL` failed (`Expected "unavailable", Received "buy"` at test L91). Restored → **`11 passed`**. **CONFIRMED** at branch HEAD.
- **R1 guard fails-on-revert:** injected `color: "#ffffff"` at `PublicEventPage.tsx:665` → `orch-1117-no-raw-white-on-palette-surface.mjs` reported FAILED + **exit code 1** (detected L665); restored → exit 0. **CONFIRMED.**

## 5. Adversarial test added (tester, different angle)

**Path:** `mingla-business/src/components/offering/__tests__/offeringCtaDeadTap.orch1117.adversarial.test.ts` (NEW, 21 tests).
**Angles (DIFFERENT from the implementor's single-state happy path):**
- **B1** dead-tap EXHAUSTIVENESS: every terminal `unavailable` state (`!bookable`/cancelled/past/pre-sale/no-tickets/all-door/all-ended/all-sold-out) is non-tappable; the only tappable kinds are buy/free/waitlist; + a SOURCE invariant that no `unavailable` literal carries `tappable:true`.
- **B2** mixed/precedence-collision states (door+ended, sold-out+door) + the not-bookable-gate-wins precedence + a positive control (one sellable among unavailable IS tappable). **This angle surfaced P2-1.**
- **B3** WYSIWYP / no-fee-recompute: bar price == all-in `priceAllInGbp` verbatim (not base, not fee-adjusted); lowest-not-summed for multi-tier; + source has no fee/tax-math tokens.
- **B4** inline single-CTA truly ABSENT on the trip + experience ROUTES; floating bar present + routes to the correct chain (never the events `/checkout/{id}`).

**fails-on-revert verified at `2a2bd67eb`:**
- B4 — re-adding `testID="trip-checkout-reserve"` to `TripCheckoutFlow.tsx` → B4 test FAILS (`1 failed, 17 skipped, 3 passed`). Restored → pass.
- B1 — flipping any `unavailable` branch to `tappable:true` is a **TS2322 compile error** (stronger than a runtime fail).
- Both implementor tests (`offeringCta.orch1117.test.ts`, `offeringLegibility.orch1117.test.ts`) AND this adversarial test appear in `git diff origin/main...HEAD --name-only`. Append-only confirmed (new file; no existing test deleted).

### 5.1 [TEST-MOD-APPROVED by orchestrator, ORCH-1117 CLOSE] — ORCH-0876 A2 re-point
The implementor's Discovery #1 flagged that `ORCH-0876.adversarial.test.ts` A2 pinned `router.push(\`/checkout-trip/${trip.id}\`)` as a SOURCE grep inside `TripCheckoutFlow.tsx`. ORCH-1117's LOCKED §4.5 moved that LOUD nav to the public trip route's floating bar. Per the dispatch authorization, I re-pointed A2's source read from `TripCheckoutFlow.tsx` to `app/t/[brandSlug]/[tripSlug].tsx` and asserted the **destination invariant is preserved**: `router.push(tripCheckoutPath(trip.id) as never)` PRESENT, and the events chain (`/checkout/${trip.id}` AND `checkoutPublicPath(trip.id)`) ABSENT. A2's comment-pin assertions (cite ORCH-0876 + `eventType.filter.audit.test.ts`) still read `TripCheckoutFlow.tsx` (the implementor preserved that comment). Result: ORCH-0876 went **21/22 → 22/22**. Documented in the test file with the `[TEST-MOD-APPROVED…]` tag.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | unavailable strips non-tappable (type+runtime); floating Buy bar fires (`native_bar_fired_18.png`); P2-1 is a soft (navigating) edge, not a dead tap |
| 2 | One owner per truth | PASS | `resolveOfferingCta`/`computeOfferingVariant` is the single buy-state owner; both inline row + bar consume it |
| 3 | No silent failures | PASS | resolvers fail-OPEN with an explicit comment; checkout 409 backstop; no swallowed catch in the bar |
| 4 | One query key per entity | N/A | no new query keys (additive field on existing trip hooks) |
| 5 | Server state server-side | PASS | bars are pure presentational; no Zustand server-state |
| 6 | Logout clears | N/A | no auth/persisted state touched |
| 7 | `[TRANSITIONAL]` labels | PASS | OQ-B native unavailable-strip deferral documented in source (`ExpandedBusinessEventSheet.tsx:457-462`) |
| 8 | Subtract before adding | PASS | inline trip/exp CTAs REMOVED before the bar added; shared state machine hoisted (no fork) |
| 9 | No fabricated data | PASS | price reads all-in field verbatim; B3 proves no fee math |
| 10 | Currency-aware | PASS | `formatPrice` uses ticket/fallback currency via `Intl.NumberFormat` (runtime €500 rendered) |
| 11 | One auth instance | PASS | bars + resolvers are anon-tolerant; no new `useAuth` on public routes |
| 12 | Validate at right time | N/A | no datetime validation added (variant uses existing computed times) |
| 13 | Exclusion consistency | PASS | `visibility!=="hidden"` filter consistent between variant + cta |
| 14 | Persisted-state startup | N/A | no persisted state |

---

## 7. Device / parity matrix

| Surface | Result | Evidence |
|---------|--------|----------|
| Consumer iOS | **PASS (proven)** | iPhone 17 Pro: trip sheet + brand-event sheet scroll w/ bar pinned, bar fires, swipe-dismiss works, legible eyebrow, short-copy About no-toggle (`native_*` shots 09-21) |
| Consumer Android | PASS (source) / visual `probable` | `Platform.select` opaque fill + `elevation:0`; physical Samsung available but visual-ghosting screenshot deferred — same RN bar component as iOS, opaque hex proven in source |
| Buyer/anon Web | PASS (source+jest) | `FloatingOfferingBar.tsx` (web) non-tappable strip role="text"; routes mount bar + remove inline CTA; jest 62/62. Branch not yet deployed → no live-web screenshot (deploys after ORCH-1116, OTA pending) |
| Business iOS / Android | PASS (inherited) | renders the same shared public components when previewing |
| Admin Web | N/A | no public offering page |
| Business Web preview | PASS (inherited) | same shared bar; bookable reflects own brand readiness |

**T-BOOKABLE-PARITY (proven):** Travel Brand / Leggo This (`stripe_charges_enabled=true`) → LIVE tappable bar (€500 Reserve/Buy bars rendered + fired). A genuinely not-ready brand exists in data (Paystack NG Test Brand `stripe_charges_enabled=false`, no Paystack) → web unavailable strip path (source-verified; OQ-B defers the native pre-emptive strip to the cart-toast backstop, which `beginBooking` provides).

---

## 8. Discoveries for Orchestrator

1. **PRE-EXISTING RED (NOT ORCH-1117): `OfferingParity.test.ts`** — asserts `<OfferingManageSheet` in `app/(tabs)/hub/trips.tsx`/`hub/experiences.tsx`, but those files now use `<LazyOfferingManageSheet` (a React.lazy refactor by another ORCH). ORCH-1117 never touched these files (confirmed empty `git diff` stat). Pre-existing baseline failure. Recommend a one-line test update in a follow-on.
2. **PRE-EXISTING RED (NOT ORCH-1117): `PublicEventPage.closeButton.adversarial.test.tsx`** — 6/6 failing on `Cannot read properties of undefined (reading 'error')` (incomplete `designSystem` mock, `useThemeFont` from ORCH-1083). PROVEN pre-existing: the origin/main version of the file also fails 6/6. ORCH-1117's 13 insertions are append-only (0 deletions, CI `tests-append-only` compliant) mock additions needed for the FloatingOfferingBar import — they do not (and were not meant to) repair the unrelated `semantic.error` mock gap. Recommend a small follow-on to complete that mock.
3. **PRE-EXISTING DEEP-LINK COLD-OPEN GAP (NOT ORCH-1117):** the app-mobile `app/t/[brandSlug]/[tripSlug].tsx` deep-link route, when COLD-opened directly (`com.mingla.app.v2://t/{brand}/{trip}`), throws **"No QueryClient set"** — because `QueryClientProvider` is mounted in `app/index.tsx`, NOT the root `app/_layout.tsx`, so sibling Stack routes render outside the provider. ORCH-1117 did NOT touch the route, `_layout`, or the provider placement (only the business `app/t/…` route). The in-app deck→sheet path works (inside the provider). Real bug worth its own ORCH; affects any cold deep-link into a trip.
4. **Worktree Metro hazard (env):** `app-mobile/node_modules` was a SYMLINK to the anchor; combined with the bracketed worktree path `ORCH-1117-[…]`, Metro computed a malformed serverRoot/entry (`./mingla-main/app-mobile/node_modules/expo-router/entry`) → red-screen "Unable to resolve module". Fixed by APFS COW-cloning the anchor `node_modules` into the worktree (de-symlink). Reusable fix for future bracketed-worktree native runs.

## 9. Accepted conditions

None required for PASS (zero P0/P1). P2-1 is a documented gap recommended as a follow-on, not a release blocker.

---

## 10. Evidence index (`Mingla_Artifacts/evidence/ORCH-1117/`)

| Shot | What it proves |
|------|----------------|
| `sim_state_01/02.png` | Metro worktree-symlink red-screen (env blocker, then fixed) |
| `sim_app_live_03.png` | branch code live on iOS sim (consumer Explore) |
| `native_trip_detail_04.png` | (pre-existing) cold deep-link "No QueryClient" — Discovery #3 |
| `native_discover_trips_08.png` | brand trips in Discover (in-app path) |
| `native_trip_sheet_09.png` | trip sheet — title no shadow, legible eyebrow |
| `native_trip_scrolled_10.png` | **T-NATIVE-SCROLL** — content scrolled, Reserve bar PINNED (From €500 + Reserve) |
| `native_reserve_sheet_12.png` | Reserve FIRED → reserve flow; legible orange eyebrow; short-copy About no-toggle |
| `native_brand_sheet_bottom_13.png` | EXP-NATIVE floating Buy bar (€500 + Buy ticket) pinned, opaque |
| `native_inline_buy_16.png` | inline Buy row → cart (Get tickets) opens |
| `native_bar_fired_18.png` | **T-DEADTAP** — floating Buy bar FIRED (route transition + booking attempt, not inert) |
| `native_dismissed_21.png` | **T-NATIVE-SCROLL** — swipe-down-to-dismiss still works (scroll-sibling, not stickyFooter) |

---

## 11. Routing

**PASS → CLOSE (orchestrator).** At CLOSE: flip `I-PROPOSED-NO-RAW-WHITE-ON-PALETTE-SURFACE` to ACTIVE (R1 guard + workflow job in place); enforce the HARD merge order (ORCH-1117 merges AFTER ORCH-1116, already on main — branch is rebased on it). Consider spawning a follow-on for P2-1 (mixed-unavailable strip) + Discoveries #1/#2/#3.
