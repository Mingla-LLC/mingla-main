# IMPLEMENTATION — ORCH-1138 Leg 2: Public EVENT Page Redesign (Direction A, all surfaces)

**ORCH:** META-ORCH-1138 Leg 2 — `[event-page]`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[event-page]/` on branch `ORCH-1138-event-page`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1138_LEG2_EVENT_PAGE.md` (binding)
**Author:** mingla-implementor (Claude)
**Date:** 2026-06-15
**Status:** IMPLEMENTED + CONSUMER SIM-PROVEN — route to mingla-tester, then orchestrator REVIEW/CLOSE. NOT deployed/merged/closed.

---

## 1. Summary

The public **event** page is rebuilt onto the shipped Direction-A foundation across all surfaces:

- **Buyer-web + business iOS/Android:** a NEW app-layer `FoundationEventPreview` composes the shared `ParallaxCoverShell` (pinned parallax cover, body-level fixed X·Share·Mute chrome, brand-themed palette + bold fonts, City,Country venue card, date/time meta chips, a SELECTABLE ticket-TIER radiogroup, a desktop sticky panel, and the float→dock single CTA via a NEW `EventReserveBar`). The business adapter renders it for published/sold-out/pre-sale/past; cancelled/password-gate keep the shared renderer's dedicated legacy render.
- **Consumer app:** a NEW `ConsumerEventDetailScreen` (foundation, compose-around-the-gorhom-scroll) + adapter hook + a NEW `ConsumerEventReserveBar`; the deck event entry is repointed OFF EBES to it; Get-tickets opens `TicketCartSheet` directly with a BYTE-IDENTICAL `ticket-checkout-create` request.
- EBES is intact (experiences deck/venue + chat still mount it). NO refund-ladder/deadline/itinerary/route/pay-toggle (event model has none). NO schema/edge/RPC change.

**KEY DEVIATION (forced, documented — see §10):** the SPEC mandated the FOUNDATION composition inside the shared `packages/event-rendering/PublicEventPage.tsx`. That is architecturally **impossible** — `@mingla/offering-rendering` already depends on `@mingla/event-rendering`, so importing offering-rendering INTO the event-rendering package creates a runtime circular dependency (**proven on the iOS sim:** `Cannot read property 'offeringSurfaceStyles' of undefined` at module init). The fix mirrors the SPEC's own cited precedent (`TripPreview` lives in `mingla-business/src`, the app layer, not a package): the FOUNDATION composition lives in the NEW app-layer `FoundationEventPreview.tsx`. The shared package is left **byte-identical to origin/main** — which makes SC-9/N1 (EBES unaffected) provably true.

---

## 2. SPEC success-criteria coverage

| SC | Status | Evidence |
|----|--------|----------|
| SC-1-Web / SC-1-BizIOS / SC-1-BizAndroid | ✓ | `FoundationEventPreview.tsx` composes `ParallaxCoverShell` (parallax cover, body chrome, theme+bold fonts, City,Country venue, date/time chips, selectable tier radiogroup, desktop sticky panel, float→dock CTA); no itinerary/route/refund/deadline/pay-toggle. Adapter renders it. Business jest source test (29 asserts) + ORCH-0961 render tests (8/8). |
| SC-2-iOS / SC-2-Android | ✓ | Deck `businessEvent` branch mounts `ConsumerEventDetailScreen` (not EBES). G-1 gate + consumer test T3. **Sim-proven**: cold `/e/` route mounts the foundation screen; the body SCROLLS (screenshot 04). |
| SC-3 (all) | ✓ | Tier list is `role="radiogroup"`, each tier `role="radio"`+`aria-checked`; selecting a tier drives the single CTA. **Sim-proven**: selecting "The Free" flipped the CTA to "Get free ticket"; selecting "The Paid" → "$65 · Buy ticket" (screenshots 05/06). Color never the only indicator (radio dot + accent rail + bold + state word). |
| SC-4 (all) | ✓ (partial-runtime) | State machine via `resolveOfferingCta`/`computeOfferingVariant` (single owner). Free → "Get free ticket" sim-proven. Sold-out/sales-ended/pre-sale/not-bookable/door-only/approval driven by the shared machine (source-verified; not all runtime-exercised — tester to cover the rarer states). |
| SC-5 (all) | ✓ | Venue card honors `hideAddressUntilTicket`; online → online card, no map; map OMITTED (rule-9) since the read carries no geo. **Sim-proven** venue card "The yard · 700 Corporate Center Dr…" + "Open maps" (screenshot 04). |
| SC-6-iOS / SC-6-Android | ✓ | `handleBuy` ported from EBES; request has no `address`/`taxCalculationId`, omits `paymentPlanChoice`. **Sim-proven**: Buy opened `TicketCartSheet` DIRECTLY (screenshot 06, "Get tickets" cart), NOT EBES. G-3 test + G-1 gate. |
| SC-7 (all) | ✓ | `createThemePalette.parity.orch1138.test.ts` GREEN (5/5) — the palette algorithm is untouched (themePalette.ts unchanged). |
| SC-8 (Android) | ✓ | `EventReserveBar` + `ConsumerEventReserveBar` use `Platform.select` opaque Android fill (no shadow under the rounded fill). Source test T8. (Android device pass = tester.) |
| SC-9 (all) | ✓ (strongest form) | The shared `PublicEventPage.tsx` + `types.ts` + `index.ts` are **byte-identical to origin/main** → EBES's experience + chat mounts are provably unchanged. ORCH-0961 render tests GREEN. |

---

## 3. Files changed

**New (8):**
- `mingla-business/src/components/event/FoundationEventPreview.tsx` (app-layer FOUNDATION render; ~760 lines)
- `mingla-business/src/components/event/EventReserveBar.tsx` (docked/floating single CTA; ~300 lines)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (consumer foundation detail; ~1160 lines)
- `app-mobile/src/hooks/useConsumerEventFoundation.ts` (consumer adapter projection)
- `app-mobile/src/components/offering/ConsumerEventReserveBar.tsx` (consumer single-CTA bar)
- `app-mobile/app/e/[brandSlug]/[eventSlug].tsx` (consumer cold deep-link route, seed=null OQ-6 cap)
- `.github/scripts/strict-grep/orch-1138-event-deck-off-ebes.mjs` (G-1)
- `.github/scripts/strict-grep/orch-1138-event-no-trip-only-blocks.mjs` (G-2)
- `app-mobile/src/screens/Event/__tests__/orch_1138_consumer_event_foundation.test.ts` (29 asserts)
- `mingla-business/src/components/event/__tests__/orch_1138_event_foundation.test.ts` (29 asserts)

**Modified (4):**
- `mingla-business/src/components/event/PublicEventPage.tsx` (adapter → FOUNDATION wiring; renders FoundationEventPreview / legacy split; +440/-218)
- `app-mobile/src/components/ExpandedCardModal.tsx` (businessEvent branch repoint → ConsumerEventDetailScreen; +24/-11)
- `.github/workflows/strict-grep-mingla-business.yml` (register G-1 + G-2; +22)
- `mingla-business/src/components/event/__tests__/PublicEventPage.closeButton{.,.adversarial.}test.tsx` (ORCH-0961 reconciliation, `[TEST-MOD-APPROVED ORCH-1138]` — see §10)

**Reverted to baseline (allowlisted, intentionally unchanged):** `packages/event-rendering/PublicEventPage.tsx`, `types.ts`, `index.ts`.

---

## 4. Data-model changes applied
**NONE.** No migration, no schema, no RLS, no view, no RPC. (§8 audit = NONE; rule-9 omission for the map.)

## 5. Edge functions touched
**NONE.** Checkout uses the existing `ticket-checkout-create` via the existing `nativeCheckoutFlow` (consumer) / existing `/checkout/{eventId}` web route (business). Request byte-identical (no `verify_jwt` change anywhere).

## 6. §8 AUDIT RESULT (done first, no code)

- **(a) Venue lat/lng:** The buyer-web/business read row `BusinessPublicEventViewRow` does NOT carry lat/lng, and `PublicEventProps` has no geo field; the event's `public_theme.business_event.location` JSON carries only `venueName`/`address` (geo lives in the un-exposed `events.location_geo`). → **map OMITTED on web/business** (rule 9). The CONSUMER `BusinessEventCard` DOES carry `locationGeo`, but app-mobile has no Mapbox token in `app.config extra` (only the static `process.env` fallback, which does NOT survive standalone/OTA per COMMS-0028) and no `buildStaticMapUrl` util — threading those is outside the §11 allowlist → **consumer map OMITTED** (OQ-5 degradation, geo surfaced in the adapter for a future read-path/config ORCH).
- **(b) Anon event-by-slug consumer fetch:** none exists; `events` IS anon-SELECTable (proven by `useConsumerTripDetail`), so a client hook is buildable with no backend change — BUT it is a NEW file outside the §11 allowlist. Per OQ-6 the cold deep-link is **capped** to a graceful "open from the app" state for seed=null; the deck path (seed-driven) is fully functional.
- **(c) `/e/` route gate:** app-mobile has NO root auth gate (`PUBLIC_BUYER_ROUTE_PREFIXES` is a mingla-business concern); no fix needed.

**No genuine backend gap → proceeded** (the only nuance was the map, handled by rule-9 omission as the SPEC pre-authorized).

## 7. Old → New receipts

### packages/event-rendering/PublicEventPage.tsx (+ types.ts, index.ts)
**Before:** the shared event renderer (LEGACY stacked-card page) consumed by buyer-web/business adapter + EBES.
**After:** UNCHANGED (byte-identical to origin/main). The FOUNDATION render did NOT go here (would create a runtime package cycle — §10).
**Why:** SC-9/N1 — EBES experiences + chat keep the exact legacy render.

### mingla-business/src/components/event/FoundationEventPreview.tsx (NEW)
**What it does now:** composes `ParallaxCoverShell` + the Direction-A event body (chips, brand chip, About collapse, venue card, selectable tier radiogroup, all-in line) — the buyer-web/business FOUNDATION page. Mirrors `FoundationTripPreview` 1:1, EVENT-only.
**Why:** SC-1; app-layer composition avoids the package cycle (TripPreview precedent).

### mingla-business/src/components/event/PublicEventPage.tsx (adapter)
**Before:** rendered the shared `PublicEventPage` (legacy) + its own `IconChrome` row + `FloatingOfferingBar`.
**After:** resolves palette/theme/bold-fonts; computes the page variant; renders `FoundationEventPreview` (foundation variants) or the shared `PublicEventPage` (cancelled/password); builds the float/dock `EventReserveBar` + the desktop sticky panel from the SAME `resolveOfferingCta`. Checkout target UNCHANGED (`checkoutPublicPath(event.id)`).
**Why:** SC-1/SC-3/SC-4; N7 (byte-identical checkout).

### app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx (NEW)
**What it does now:** the consumer foundation event detail — `BaseBottomSheet` (scrollMode="view") with the gorhom `BottomSheetScrollView` as a DIRECT child; pinned `EventCoverMedia` + `OfferingChrome` + float→dock `ConsumerEventReserveBar` composed AROUND the scroll; tier radiogroup; `handleBuy` ported from EBES; `TicketCartSheet` direct.
**Why:** SC-2/SC-6; the load-bearing ORCH-1016/1043 scroll structure (no ParallaxCoverShell-as-host).

### app-mobile/src/components/ExpandedCardModal.tsx
**Before:** the `businessEvent` branch returned `<ExpandedBusinessEventSheet>`.
**After:** returns `<ConsumerEventDetailScreen seed={businessEvent} onBack={onClose} />`. The experience EBES mount (:2259) + chat untouched.
**Why:** I-PROPOSED-1138-EVENT-DECK-OFF-EBES / SC-2.

## 8. Cross-surface impact

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Consumer iOS | YES | New foundation event detail off EBES; cart direct | Manual (new screen) — sim-proven |
| Consumer Android | YES | Same; opaque-glass bar | Manual (same files) — tester device pass |
| Buyer/anon Web | YES | Direction-A event page (FoundationEventPreview) | Manual (web/native split owned by foundation primitive) |
| Business iOS | YES | Same FoundationEventPreview in-app | Automatic (shared adapter) |
| Business Android | YES | + opaque glass | Automatic + Platform.select |
| Admin Web | NO | never renders the public event page | n/a |
| Business Web preview (wizard) | NO | out of scope (N8) | n/a |

## 9. Smoke result (MANDATORY consumer iOS sim — DONE)

Ran the consumer app on the booted **iPhone 17 Pro (iOS 26.4)** sim against a bracket-free real-copy Metro (isolated TMPDIR + port 8093; node_modules real copy per the dispatch's hint) — required because the worktree's `[event-page]` bracket path breaks Metro and the symlinked node_modules mis-resolves expo-router/entry.

1. **App loads clean — the package cycle crash is GONE** (`01-app-loaded-...png`). This iteration FIRST surfaced the circular-dependency crash (FOUNDATION-in-package); after moving to the app layer the app boots to sign-in cleanly.
2. **Cold `/e/` route mounts the foundation screen + OQ-6 cap** (`02-...`) — `BaseBottomSheet` + `OfferingChrome` (X/Share) render; seed=null → graceful "open from the app".
3. **Full foundation event detail** via a seeded staging-only cold route (real published event "Teating group chat") (`03-...`): pinned GIF cover, body chrome, date eyebrow + bold title, meta chips (date · "950 tickets left" · "Raleigh, USA"), brand chip ("Presented by Leggo This"), floating "Buy ticket →" pill.
4. **Body SCROLLS** (no freeze) (`04-...`): About + Read-more toggle, "Where you'll be" venue card + Open-maps (map omitted, rule-9), "Choose your ticket" tier radiogroup (The Free / The Paid), all-in line, and the DOCKED CTA (float→dock transition worked).
5. **Tier selection drives the CTA** (`05-...`): selecting "The Free" flipped the CTA to "Get free ticket"; "The Paid" → "$65 · Buy ticket".
6. **Buy opens `TicketCartSheet` DIRECTLY, NOT EBES** (`06-...`): the "Get tickets" multi-tier cart with quantity steppers, marketing opt-in, buyer recap, "Claim Free Ticket". The byte-identical `runNativeCheckout` path is wired up to this confirmation step (the final charge needs real auth/payment — not completed; the request shape is source- + test-verified).

Screenshots: `Mingla_Artifacts/evidence/ORCH-1138-event/01..06*.png`.
**Staging note:** the device drive used a throwaway `/tmp/orch1138-stage` copy with a seeded cold route; the WORKTREE cold route stays `seed={null}` (verified). NOT shipped.

## 10. Known issues / deferred + DEVIATIONS (need orchestrator/tester awareness)

1. **DEVIATION-1 (FOUNDATION location):** the SPEC §4.1/§4.4/§4.5 placed the FOUNDATION render in the shared package; that is a runtime circular dependency (sim-proven). Built in the app layer (`FoundationEventPreview.tsx`) per the TripPreview precedent the SPEC itself cites. Net: the shared package is byte-identical to origin/main (stronger SC-9). `FoundationEventPreview.tsx` is a NEW file not literally in the §11 allowlist — flagged here as the forced, scope-equivalent realization. Recommend a one-line SPEC amendment recording the app-layer location.
2. **DEVIATION-2 (ORCH-0961 test reconciliation):** the redesign moved the close/share/mute chrome from the adapter's `IconChrome`/`FloatingOfferingBar` into the foundation chrome. The two ORCH-0961 source-shape tests asserted the removed wiring; updated them to assert the NEW chrome contract (close/share via the page node, handleClose fallbacks preserved) with `[TEST-MOD-APPROVED ORCH-1138]` in the file headers. Behavioral coverage retained; both pass 8/8.
3. **OQ-5 (consumer + web map):** OMITTED on every surface this leg (no geo on the web read; no Mapbox token plumbed on consumer). A follow-on read-path/config ORCH can light it up with no structural change.
4. **OQ-6 (cold deep-link):** capped to the seed=null graceful state (anon event-by-slug client hook is outside the allowlist). The deck path is fully functional.
5. **Pre-existing red (NOT mine):** `PublicEventPage.orch_0964_design_rework.test.ts` fails 2/6 on origin/main too (asserts an even-older BlurView/height:380 hero superseded by ORCH-0992/1117). `publicEventsService.test.ts` fails to RUN in jest in this worktree (pre-existing `@mingla/event-rendering` jest module-resolution gap; the service file is untouched by me). Both flagged for the orchestrator; neither is caused by this work.
6. **SC-4 rarer states** (sold-out→waitlist, sales-ended, pre-sale, not-bookable, approval, door-only, password-gate, cancelled, theme-absent, loading skeleton) are source- + machine-verified but not all runtime-exercised on the sim — tester to drive.

## 11. Operator action required

- **NO migration. NO edge deploy.** This leg is pure client/RN + CI-gate + tests.
- **Tester:** drive the remaining SC-4 states + an Android device pass (SC-8) + the buyer-web `/e/` page in a desktop browser (sticky panel) + the business in-app render. Write the adversarial test.
- **Orchestrator:** record DEVIATION-1 (app-layer FOUNDATION location) as a SPEC amendment; register the two pre-existing-red discoveries (§10.5).

## 12. Discoveries for Orchestrator

- The `@mingla/offering-rendering` → `@mingla/event-rendering` dependency is one-directional and MUST stay so; any future "compose foundation in the event package" attempt will re-create the runtime cycle. The FOUNDATION render belongs in the app layer (both packages importable there). Worth codifying as an invariant.
- `PublicEventPage.orch_0964_design_rework.test.ts` is stale (asserts a long-superseded hero) — pre-existing 2/6 red on main; recommend a TEST-MOD-APPROVED cleanup ORCH.
- `publicEventsService.test.ts` can't resolve `@mingla/event-rendering` under jest in the per-ORCH worktree (symlinked node_modules) — pre-existing; flag for the jest moduleNameMapper.

## Regression Test (fails-on-revert proof)

- **Consumer:** `app-mobile/src/screens/Event/__tests__/orch_1138_consumer_event_foundation.test.ts` — 29 node:assert source assertions, GREEN. Fails-on-revert verified: deleting the deck repoint (ExpandedCardModal `<ConsumerEventDetailScreen>` → `<ExpandedBusinessEventSheet>`) → T3b FAILS; injecting `taxCalculationId` into the checkout → T15c FAILS; both restored → GREEN. `fails-on-revert verified at working tree (pre-commit), commit recorded below`.
- **Business:** `mingla-business/src/components/event/__tests__/orch_1138_event_foundation.test.ts` — 29 assertions, GREEN. Fails-on-revert verified: forcing the FOUNDATION dual-mode off → T1c FAILS; restored → GREEN.
- **Gates:** G-1 (`orch-1138-event-deck-off-ebes.mjs`) + G-2 (`orch-1138-event-no-trip-only-blocks.mjs`) PASS clean, FAIL under `ORCH1138_SIMULATE_REVERT=1`.
- **Existing suites GREEN:** ORCH-0961 close-button (8/8), createThemePalette parity (5/5), offeringLegibility (12/12).
