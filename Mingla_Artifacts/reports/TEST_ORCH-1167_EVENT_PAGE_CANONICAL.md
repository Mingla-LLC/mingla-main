# TEST — ORCH-1167 [event-page-canonical] — Canonical Standard-Event Public Page

**Verdict: CONDITIONAL PASS** (merge-ready; conditions are non-blocking cosmetic/UX items + the runtime-scroll claim that is source-verified only, owned by Seth's on-device QA).

**Tester:** mingla-tester (brutal last line). Assumed broken until proven. Independent source + live-fire DB verification; own adversarial test written + fails-on-revert proven.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/` @ `62a3f7531`.
**Contract:** SPEC `…/specs/SPEC_ORCH-1167_EVENT_PAGE_CANONICAL_STRUCTURE.md`; IMPLEMENT `…/reports/IMPLEMENT_ORCH-1167_EVENT_PAGE_CANONICAL.md`.

---

## 1. Verdict rationale

The product change is real, correctly scoped, and proven at the layers that can be proven here. The ONE shared `EventOfferingBody` is consumed by all 3 surfaces; the ONE anon RPC `pg_public_event_by_slug` is applied to prod, anon-granted, and — verified against ALL 14 live published events — **leaks ZERO exact pins/addresses for the 4 hidden-address events** (the headline privacy invariant). The Σ-all-in WYSIWYP math, the hostile cart-seed boundary, and all 5 + 5 strict-grep gates hold, each with fails-on-revert proof. Scope is clean (every changed file inside the §12 allowlist; no RSVP/trip/experience/admin/pricing-engine bleed).

It is CONDITIONAL (not full PASS) for two reasons, neither a merge blocker:
- **SC-6 runtime (consumer gorhom scroll-no-freeze)** could NOT be proven by live sim in this environment (no booted simulator / no Metro). Source-verified only → capped at "suspected." This is Seth's on-device sign-off (per dispatch).
- **Two non-blocking observations** (D-T1 desktop title duplication, D-T2 consumer/web floating-bar dock anchored to body-top not box) — UX/cosmetic, source-suspected, flagged for Seth's device QA.

---

## 2. Per-SC evidence

| SC | Result | Evidence |
|----|--------|----------|
| **SC-1 (9-section order)** | PASS (source) | `orch-1167-canonical-9-section-order.mjs` real PASS + self-test PASS; body renders sections 2–8 in locked order, cover(1)+float(9) surface-pinned. All 3 surfaces wrap the shared body (FoundationEventPreview / ConsumerEventDetailScreen standard branch). |
| **SC-2 (pills order + omit-empty)** | PASS (source) | Pills row `format → vibeTags → partyTypes → musicGenres → tickets-left`, each group `.map` over a `?? []` array (rule-9 omit). `musicGenres` threaded web (mapper + RPC merge) + consumer (foundation + RPC). |
| **SC-3 (inline box Σ-all-in, never bare base)** | **PASS (proven)** | `computeRunningTotal` = Σ(`priceAllInGbp ?? priceGbp`×qty). Happy-path test 4/4 PASS; **fails-on-revert reproduced**: deleting the coalesce in `eventBoxTotals.ts` → 2 tests FAIL (got 105 base vs 130 all-in), restored → PASS. |
| **SC-4 (proceed → cart step (i), populated + editable)** | PASS (source) + **boundary PROVEN** | Web: `onProceedToCart`→`checkoutPublicPathWithSeed(id,qty)`→checkout index `useEffect` seeds `setLineQuantity` once on mount (editable QuantityRows). Consumer: `handleProceedToCart`→`TicketCartSheet initialQuantities` multi-tier seed (capped by capacity). My adversarial seed test (10/10) proves the seed round-trip is lossless + hostile-input safe. |
| **SC-5 (CTA states)** | PASS (source) | Box + floating bar both resolve via shared `resolveOfferingCta` (one owner) + per-tier `ticketIsSoldOut/DoorOnly/SaleEnded`; `bookable=false`→disabled "Booking unavailable". Free/waitlist/buy label branches present in both `EventOfferingBody` and `EventOfferingFloatingBar`. |
| **SC-6 (shell-agnostic, gorhom no-freeze)** | **SUSPECTED** (source only — runtime NOT run) | `orch-1167-shell-agnostic-body.mjs` PASS: body declares no `ScrollView`/`BottomSheetScrollView`/`FlatList`/`ParallaxCoverShell` root. Consumer keeps the proven `BaseBottomSheet`+`BottomSheetScrollView`-as-direct-child scaffold (ORCH-1016/1043/1138). **No sim available → cannot confirm no-freeze at runtime; capped at suspected. Seth's on-device QA owns this.** |
| **SC-7 (one read path)** | PASS-with-caveat (source) | `orch-1167-one-read-rpc.mjs` PASS: web service + consumer hook both call `pg_public_event_by_slug`. CAVEAT: web still reads the page row from `business_public_events_view` then MERGES pills/cityGeo from the RPC (view+RPC, not pure single-read); the RPC's per-tier all-in is discarded on web (web uses `fetchTickets`→`fetchTierAllInCents`). "One mapper edit surfaces everywhere" is true for consumer; web needs the `fetchCanonicalEventBodyFields` mapper + `detailFromRow` merge edited. Non-blocking — `musicGenres` did surface on all 3 this leg. |
| **SC-8 (city-level map, no exact pin when hidden)** | **PASS (live-fire PROVEN)** | RPC gates `address`+`locationGeo` NULL on `hide_address_until_ticket`, returns `cityGeo`. **Live prod probe over ALL 14 published events: hidden=4, LEAKS=0** (no hidden event emits non-null locationGeo or address). Public event "Big Party" correctly returns exact `{lat,lng}`+address+tickets. Host feeds `locationGeo ?? cityGeo`, zoom 14 exact / 11 city. NOTE: 0 events have `city_geo` written yet (D-1: publish-write unwired) → hidden events currently render NO map (rule-9 text card), which is honest + safe. |
| **SC-9 (web close-X preserved, ORCH-1159)** | PASS (source) | `FoundationEventPreview` passes `hideCloseOnWeb` to `ParallaxCoverShell`; Share present everywhere; `orch-1153-reserve-verb` adjacent gate green. |

---

## 3. Gate / test results

**ORCH-1167 strict-grep gates (5/5 — self-test + real, all PASS):**
- `orch-1167-allin-price-in-ticket-box` ✔ self + real
- `orch-1167-canonical-9-section-order` ✔ self + real
- `orch-1167-city-level-map-no-exact-pin-when-hidden` ✔ self + real
- `orch-1167-one-read-rpc` ✔ self + real
- `orch-1167-shell-agnostic-body` ✔ self + real

**Adjacent regression gates (green):** `meta-orch-0827-package-isolation` (covers the new body — T-17 isolation), `orch-1138-mor-isolation`, `orch-1153-no-bare-base-under-allin`, `orch-1153-reserve-verb`, `orch-1138-event-deck-off-ebes`.

**Jest:**
- Implementor happy-path `orch_1167_event_box_totals` — **4/4 PASS**; fails-on-revert independently reproduced (revert coalesce → 2 FAIL).
- My adversarial `orch_1167_cart_seed.adversarial` — **10/10 PASS**; fails-on-revert proven (revert decode guards → 6 FAIL).
- Adjacent `publicUrls.test` — 6/6 PASS.
- `publicEventsService.*` / `checkout-trip` / `liveEventStore-migrator` / `meta_orch_0952_carousel` jest "failures" (15 suites) are **PRE-EXISTING + environmental** — `Cannot find module '@mingla/event-rendering'` (node-env jest alias, implementor D-3; the import exists on the base branch `be65f8f1c`), playwright-under-jest, missing `@testing-library/react-native`, deno asserts. NONE are ORCH-1167.

**Typecheck:**
- `mingla-business` tsc: ORCH-1167 files (PublicEventPage, FoundationEventPreview, publicEventsService, liveEventStore, checkout index, publicUrls, types.ts, eventBoxTotals) — **ZERO real errors**. `EventOfferingBody.tsx` + `event-rendering/types.ts` show ONLY the `Cannot find module 'react'` tsconfig-boundary artifact (packages typecheck via the apps' Metro bundler, identical to the shipped `ParallaxCoverShell.tsx`/pre-existing `event-rendering/PublicEventPage.tsx`).
- `app-mobile` tsc: ORCH-1167 files (ConsumerEventDetailScreen, usePublicEventBySlug, useConsumerEventFoundation, TicketCartSheet) — **ZERO errors**. 557 baseline errors all in pre-existing deno/test files.

**Build sanity (mingla-business web export + ORCH-1083 budget gate):**
- `npx expo export -p web` — **SUCCEEDS** (664 modules bundled clean; no duplicate-import/export or syntax error — the regression this step catches for the 1167 RN-web changes).
- ORCH-1083 `__common` budget gate + ORCH-1137 lucide render-proof — **NOT LOCALLY RUNNABLE / source-verified only.** The worktree's `node_modules` is a SYMLINK to the main checkout, and the local export emits a single non-production 984KB chunk (1 chunk vs the gate's required ≥3 code-split points; lucide glyph signature absent from the dev bundle). This is the MEMORY-documented "local `expo export` exit-0 ≠ web-shippable; the budget gate is CI-only" trap — an environment artifact, NOT an ORCH-1167 regression. The gate runs green in CI's clean install; flagged for the CI run, not a local blocker.

**Live DB verification (prod):** `events.city_geo` exists, view exposes it (appended last), `pg_public_event_by_slug` live + `EXECUTE` granted to anon+authenticated; privacy probe = 0 leaks / 14 events; paid-tier all-in ≥ base always (all live tiers all-in==base because 0/8 charges-enabled brands pass a fee — the gross-up is proven by unit test, not live data, per the known MEMORY gotcha).

---

## 4. My adversarial test (different angle than implementor)

**File:** `mingla-business/src/constants/__tests__/orch_1167_cart_seed.adversarial.test.ts` (NEW, immutable).
**Angle:** the implementor tested the in-box Σ-all-in MATH (SC-3). I attacked the **untrusted cart-SEED boundary** that carries the selection from the public page into the cart (SC-4) — a hand-editable `?seed=` URL surface. Proves a hostile seed can NEVER inject a phantom line / negative / zero / NaN / fractional / empty-id quantity into the cart, and the legit encode↔decode round-trip is lossless (WYSIWYP integrity reaches the cart, not just the box).
**Result:** 10/10 PASS.
**Fails-on-revert (proven):** against the ORCH-1167 implementation commit **`6eb1d0b8c`**, deleting the `Number.isFinite(qty) && qty > 0` guards in `decodeCartSeed` (`mingla-business/src/constants/publicUrls.ts`) → **6 of 10 assertions FAIL** (hostile `seed=vip:-3`/`vip:0`/`vip:abc` leak negative/zero/NaN lines). Restored → 10/10 PASS.

---

## 5. Blocking defects

**NONE.**

## 6. Non-blocking observations (for Seth's device QA / a follow-on)

- **D-T1 (desktop title duplication, cosmetic):** on the DESKTOP web/business two-column layout, `ParallaxCoverShell` renders `heroTitle`/`heroEyebrow` over the cover AND `EventOfferingBody` renders its own section-2 lead block in the same left column → the event name/date can appear twice on desktop. Phone-web, native business, and consumer render the title ONLY in the body (no dup — those shell branches don't render the hero caption). Verify on desktop web.
- **D-T2 (floating-bar dock anchor, UX — suspected):** both web (`FoundationEventPreview`) and consumer (`ConsumerEventDetailScreen`) attach `onDockLayout`/`handleDockLayout` to a wrapper around the WHOLE body (`dockTopY` = body TOP), not around the inline ticket box. Since the body top sits just under the cover, `floatingPillVisible = dockTopY > scrollY + viewportH - margin` may flip the floating "Get tickets" bar to HIDDEN almost immediately on scroll — before the in-page box is actually reached. The float→dock was designed to track the box. Likely makes the floating CTA disappear earlier than intended. Source-suspected (no sim); confirm the floating bar shows while the box is off-screen on device.
- **D-T3 (SC-7 web is view+RPC, not pure one-read):** web reads the page row from the view and merges pills/cityGeo from the RPC, discarding the RPC's per-tier all-in. Adding an RPC field needs the web `fetchCanonicalEventBodyFields` mapper + `detailFromRow` merge edited (consumer is one-edit). Acceptable this leg; note for the META-ORCH-1166 dissolution.
- **D-T4 (ALLIN strict-grep gate inspects the wrong file):** `orch-1167-allin-price-in-ticket-box.mjs` greps `EventOfferingBody.tsx`, but the load-bearing running-total math lives in `eventBoxTotals.ts`. Reverting the coalesce in `eventBoxTotals.ts` does NOT trip the grep gate (it passes via the unrelated `formatTicketPrice` line in the body). The JEST test IS the real protection (it correctly fails-on-revert). Recommend pointing the gate at `eventBoxTotals.ts` in a follow-on so the grep gate isn't false-assurance.
- **D-1 (carried from implementor, confirmed live):** `city_geo` publish-write is unwired (0/14 events have it) → hidden-address events render no map until a follow-on geocodes the city centroid at publish. Safe default (rule-9).

---

## 7. Scope / DO-NOT-TOUCH audit

Every changed file (23, excluding artifacts) is inside the SPEC §12 allowlist. No RSVP/trip/experience body, no `mingla-admin`, no pricing engine / `ticket-checkout-create` / PaymentSheet, no 88-import mass-flip (Phase 2 correctly deferred). RSVP branch of `ConsumerEventDetailScreen` + `RsvpPublicBody` byte-untouched. Confirmed clean.
