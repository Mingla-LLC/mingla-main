# IMPLEMENT — ORCH-1167 [event-page-canonical] — Canonical Standard-Event Public Page

**Leg 1 of META-ORCH-1166.** Phase 1 (shared body + RPC + city-geo + inline box), per SPEC binding contract.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/` on branch `ORCH-1167-event-page-canonical`.
**Status:** implemented and self-verified (source typechecks clean; gates green; happy-path test green with fails-on-revert proof; migrations WRITTEN + schema-probe-verified, UNAPPLIED). Runtime sim/device verification is the tester's phase.

---

## 1. Summary

Standardized the STANDARD ticketed-event public page (`event_type='event'` only) into ONE shared, shell-agnostic body — `EventOfferingBody` in `packages/offering-rendering` — rendered from one prop contract on buyer-web, business iOS/Android, and consumer iOS/Android. The body renders Seth's locked 9-section structure. Its centerpiece is the new **inline on-page ticket box** (per-tier quantity steppers + live Σ-all-in running total (WYSIWYP) + in-box Proceed) that REPLACES the `/checkout/[eventId]` tier-picker on web/business and pre-populates the cart at the editable cart step (i) on every surface. All three surfaces read the new anon RPC `pg_public_event_by_slug`; the new `city_geo` privacy field + the vibes/party-types/music-genres pills are threaded end-to-end (closing the F-3 `music_genres` drop). Package consolidation is Phase-1-only (the body lives in offering-rendering and imports from `@mingla/event-rendering` via the existing peer-dep; no 88-import mass-flip).

---

## 2. SPEC success-criteria coverage

| SC | How met | Commit |
|----|---------|--------|
| **SC-1 (9-section order)** — all 3 surfaces render sections 1–9 in the locked order | `EventOfferingBody` renders sections 2–8 (incl. inline box at 5) in order; cover (1) + floating bar (9) are surface-pinned siblings; asserted by `orch-1167-canonical-9-section-order.mjs`. SC-1-Web/bizIOS/bizAndroid via `FoundationEventPreview`→`EventOfferingBody`; SC-1-consIOS/consAndroid via `ConsumerEventDetailScreen` standard branch→`EventOfferingBody`. | HEAD |
| **SC-2 (pills)** — format → vibes → party-types → music-genres → tickets-left, each group omits when empty | Pills row in `EventOfferingBody` (testID `orch-1167-pills-row`), rule-9 empty-omit. Threaded: web mapper (`musicGenres` added), consumer foundation (`partyTypes/vibeTags/musicGenres`), RPC payload. | HEAD |
| **SC-3 (inline box, all-in)** — steppers; running total = Σ(priceAllInGbp×qty) to the cent; never bare base | `computeRunningTotal` (pure module `eventBoxTotals.ts`); WYSIWYP. Proven by the happy-path test + `orch-1167-allin-price-in-ticket-box.mjs`. | HEAD |
| **SC-4 (proceed → cart step i, populated, editable)** | Web/business: `onProceedToCart` → `checkoutPublicPathWithSeed` (`?seed=id:qty,…`) → `/checkout/[eventId]` seeds `CartContext` on mount (editable QuantityRows). Consumer: `onProceedToCart` → `TicketCartSheet` with new `initialQuantities` multi-tier seed. | HEAD |
| **SC-5 (CTA states)** — free / waitlist / approval / sold-out / pre-sale / past / cancelled / door-only / not-bookable | `EventOfferingBody` + `EventOfferingFloatingBar` resolve via the shared `resolveOfferingCta` (one owner) + the per-tier sub-predicates (`ticketIsSoldOut`/`ticketIsDoorOnly`/`ticketSaleEnded`); `bookable=false` → "Booking unavailable". | HEAD |
| **SC-6 (shell-agnostic)** — consumer scrolls with `BottomSheetScrollView` (direct child, no freeze); body hosts no scroll root | Body declares no scroll container (asserted by `orch-1167-shell-agnostic-body.mjs`); consumer keeps its proven `BaseBottomSheet`+`BottomSheetScrollView` scaffold; web/business use `ParallaxCoverShell`+RN `ScrollView`. | HEAD |
| **SC-7 (one read path)** — all 3 fetch from `pg_public_event_by_slug`; adding a field surfaces on all 3 with one mapper edit (verified by `musicGenres`) | Web/business `detailFromRow` merges `fetchCanonicalEventBodyFields` (RPC) onto the LiveEvent; consumer `usePublicEventBySlug` reads the RPC directly. `musicGenres` added once in the RPC payload → surfaces everywhere. Asserted by `orch-1167-one-read-rpc.mjs`. | HEAD |
| **SC-8 (city-level map, no exact pin when hidden)** | RPC enforces privacy server-side (`address`+`locationGeo` NULL when hidden; `cityGeo` returned). Hosts feed `locationGeo ?? cityGeo` to `buildProxyStaticMapUrl` (zoom 14 exact / 11 city). No geo → text venue card (rule 9). Asserted by `orch-1167-city-level-map-no-exact-pin-when-hidden.mjs`. | HEAD |
| **SC-9 (web close-X)** — ORCH-1159 preserved | `FoundationEventPreview` passes `hideCloseOnWeb` to `ParallaxCoverShell`; Share present everywhere. | HEAD |

---

## 3. Files changed (25)

**Database (2 migrations, UNAPPLIED):**
- `supabase/migrations/20261015000000_orch_1167_event_city_geo.sql` (new, +~140) — `events.city_geo geometry(Point,4326)` + view exposure.
- `supabase/migrations/20261015000001_orch_1167_pg_public_event_by_slug.sql` (new, +~250) — canonical anon RPC.

**Shared packages:**
- `packages/event-rendering/types.ts` (+~25) — `musicGenres`, `cityGeo` on `PublicEventProps`.
- `packages/offering-rendering/EventOfferingBody.tsx` (new, ~720) — the shared body + `EventOfferingFloatingBar`.
- `packages/offering-rendering/eventBoxTotals.ts` (new, ~55) — pure Σ-all-in totals (RN-free, unit-testable).
- `packages/offering-rendering/index.ts` (+~8) — additive exports.

**Buyer-web + business (RN one codebase):**
- `mingla-business/src/components/event/FoundationEventPreview.tsx` (rewritten ~210) — thin wrapper of `EventOfferingBody` in `ParallaxCoverShell`.
- `mingla-business/src/components/event/PublicEventPage.tsx` (~−90/+90) — `ticketQuantities` state, `onProceedToCart` → seeded cart path, inline box owns CTA, `staticMapUrl`, `EventOfferingFloatingBar`; retired the docked/sticky `EventReserveBar` CTA.
- `mingla-business/src/services/publicEventsService.ts` (+~90) — `fetchCanonicalEventBodyFields` (RPC), `music_genres`/`city_geo` row fields, merge in `detailFromRow`.
- `mingla-business/src/store/liveEventStore.ts` (+~10) — `cityGeo` on `LiveEvent`.
- `mingla-business/src/constants/publicUrls.ts` (+~45) — `encodeCartSeed`/`decodeCartSeed`/`checkoutPublicPathWithSeed`.
- `mingla-business/app/checkout/[eventId]/index.tsx` (+~35) — seed the cart from the `seed` param on mount (editable).

**Consumer (app-mobile):**
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (~−170/+110) — standard branch renders `EventOfferingBody` + `EventOfferingFloatingBar`; RSVP branch UNCHANGED; removed the dead radiogroup/`ConsumerTierRow`/`ConsumerEventReserveBar`/`offeringCta`/`openCart`.
- `app-mobile/src/hooks/usePublicEventBySlug.ts` (new, ~210) — consumer RPC read + mapper.
- `app-mobile/src/hooks/useConsumerEventFoundation.ts` (+~25) — `partyTypes/vibeTags/musicGenres/cityGeo` threaded.
- `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` (+~50) — `initialQuantities` multi-tier seed.

**CI gates + tests + workflow:**
- 5 × `.github/scripts/strict-grep/orch-1167-*.mjs` (new) + `.github/workflows/strict-grep-mingla-business.yml` (+5 jobs).
- `packages/offering-rendering/__tests__/orch_1167_event_box_totals.test.ts` (new) — happy-path regression.

---

## 4. Data-model changes (written, UNAPPLIED)

- `public.events.city_geo geometry(Point,4326)` NULLable, DEFAULT NULL, additive (rule-9; 77/89 events stay NULL → no map). Exposed on `business_public_events_view` (mirrors the ORCH-1150 column list verbatim + appends `e.city_geo`).
- `public.pg_public_event_by_slug(text, text) RETURNS json` — anon SECURITY DEFINER STABLE, `GRANT EXECUTE TO anon, authenticated`. Reads anon-safe columns only; privacy enforced server-side (omits exact `address`+`location_geo`, returns `city`+`city_geo` when the street is hidden). Per-tier all-in via the same `compute_all_in_cents` single owner.

**Schema probe (read-only, live):** confirmed `location_geo point`, `city text`, `party_types/music_genres ARRAY`, `city_geo` not-yet-existing, `tickets.status text`, `quantity_total integer`, `compute_all_in_cents(p_base_cents,p_pass_mingla_fee,p_pass_service_fee,p_effective_take_rate_bps,p_service_fee_bps DEFAULT 300)`, `resolve_effective_take_rate_bps → TABLE(effective_take_rate_bps int,…)`, `ST_X/ST_Y(point::geometry)` valid, `theme #>> '{business_event,hideAddressUntilTicket}'` resolves. The migrations match these exactly.

---

## 5. Edge functions touched

None. The RPC is a SQL migration. No edge-function deploy needed for this leg. (`ticket-checkout-create` / PaymentSheet money flow untouched — DO-NOT-TOUCH honored.)

---

## 6. Regression tests added

- `packages/offering-rendering/__tests__/orch_1167_event_box_totals.test.ts` — 4 tests, all PASS (run: `cd mingla-business && npx jest --roots=../packages --testPathPattern="orch_1167_event_box_totals"`).
- **fails-on-revert verified at `0a85c8f34`** — by TRUE LINE DELETION of the all-in coalesce (`const price = ticket.priceAllInGbp ?? ticket.priceGbp;` → bare `ticket.priceGbp`) in `eventBoxTotals.ts` → 2 tests FAILED (T-04 all-in total + the no-markup assert); restored → 4 PASS.

---

## 7. Old → New receipts (key surfaces)

**`packages/offering-rendering/EventOfferingBody.tsx`** — Before: did not exist; the event body was forked (web/business `FoundationEventPreview` radiogroup+route-out, consumer hand-mirrored). Now: ONE shared shell-agnostic body with the canonical 9-section structure + the inline ticket box (steppers + Σ-all-in + Proceed) + `EventOfferingFloatingBar`. Why: SoT consolidation + inline box (SPEC §3A/§4C).

**`mingla-business/src/components/event/PublicEventPage.tsx`** — Before: single-select radiogroup (`selectedTicketId`) + `handleReserve` → `router.push(checkoutPublicPath(id))` (empty tier-picker). Now: `ticketQuantities` + `onProceedToCart` → `checkoutPublicPathWithSeed` (cart pre-populated, editable); the inline box owns the CTA; legacy docked/sticky `EventReserveBar` retired. Why: SC-3/SC-4.

**`mingla-business/src/services/publicEventsService.ts`** — Before: `getPublicEventBySlug` read only the view; the mapper dropped `music_genres` (F-3). Now: `detailFromRow` merges `fetchCanonicalEventBodyFields` (the RPC) onto the LiveEvent (pills + `cityGeo`); `music_genres` threaded. Why: SC-7 + F-3.

**`app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`** — Before: standard branch hand-rolled lead/meta/brand/about/venue + a radiogroup + `ConsumerEventReserveBar`. Now: standard branch renders the shared `EventOfferingBody` + `EventOfferingFloatingBar`; `onProceedToCart` → `TicketCartSheet` `initialQuantities`. RSVP branch byte-identical. Why: SoT + inline box (consumer).

---

## 8. Cross-surface impact

| Surface | Covered | Parity |
|---|---|---|
| Consumer iOS | YES | shared body |
| Consumer Android | YES | shared body |
| Buyer/anon Web | YES (inline box replaces `/checkout` tier-picker) | shared body |
| Business iOS | YES | shared body |
| Business Android | YES | shared body |
| Admin Web | NO (no public event page) | n/a |
| Business Web preview (`/event/[id]/preview`) | DEFER (OQ-3 — separate `PreviewEventView` untouched) | manual/deferred |

---

## 9. Gate / test results

- 5 × `orch-1167-*` strict-grep gates: SELF-TEST PASS + REAL PASS (all 5). Registered as 5 workflow jobs.
- Adjacent gates re-run green: `meta-orch-0827-package-isolation` (covers `EventOfferingBody` → SC-isolation/T-17), `orch-1138-mor-isolation`, `orch-1153-no-bare-base-under-allin`, `orch-1153-reserve-verb`.
- Happy-path test: 4/4 PASS; fails-on-revert proven @ `0a85c8f34`.
- TypeScript: my non-package files (PublicEventPage, FoundationEventPreview, publicEventsService, liveEventStore, checkout index, publicUrls, ConsumerEventDetailScreen, usePublicEventBySlug, useConsumerEventFoundation, TicketCartSheet, eventBoxTotals) — ZERO errors under both the business and app-mobile tsc. The `packages/offering-rendering/EventOfferingBody.tsx` errors are the SAME pre-existing `Cannot find module 'react'` tsconfig-boundary artifact that the shipped `ChipGroup.tsx`/`ParallaxCoverShell.tsx` show (packages are typechecked via the apps' Metro bundler, not standalone).

---

## 10. Known issues / deferred

- **OQ-3 (preview route):** `/event/[id]/preview` still renders the separate `PreviewEventView` (deferred per SPEC recommendation).
- **OQ-4 (package dissolution):** Phase 2 (88-import flip) NOT done this leg (SPEC-recommended deferral).
- **Consumer cold-path `dateLine`:** `usePublicEventBySlug` returns an empty `dateLine` (the RPC payload carries `masterStartAt` ISO but the consumer formats dates via the deck warm path; the cold-path date eyebrow is omitted, not fabricated — rule 9). The warm deck path (the common case) has the formatted line. A follow-on can format the cold-path date.
- **Consumer warm-path `cityGeo`:** the deck `BusinessEventCard` carries no city centroid → `cityGeo=null` on the warm path (the exact pin still renders when public). The cold-path RPC supplies `cityGeo`.

---

## 11. Operator action required

**Apply the 2 migrations via the Supabase Management API (review first; DO NOT `db push` blindly — these are spec-only this leg):**
- `supabase/migrations/20261015000000_orch_1167_event_city_geo.sql`
- `supabase/migrations/20261015000001_orch_1167_pg_public_event_by_slug.sql`

Both are additive + idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, `DROP FUNCTION IF EXISTS` then `CREATE`). Apply in order (city_geo first — the RPC + view read it). After apply, `NOTIFY pgrst` reloads the schema. No edge-function deploy required.

**The `city_geo` capture-at-publish path (SPEC §4A "DERIVE city_geo from the resolved city centroid") is the column + read exposure ONLY this leg — the publish-time write of `city_geo` is a follow-on (no existing row has it; new publishes will need the city-centroid geocode wired into the publish RPC). Flagged for orchestrator.**

---

## 12. Discoveries for Orchestrator

- **D-1 (city_geo publish-write not wired):** Migration 1 adds the column + view/RPC read exposure, but nothing WRITES `city_geo` yet (SPEC §4A names the publish/address-write path as the capture point). Until a follow-on geocodes the city centroid at publish, every event renders the text venue card (rule-9 default-safe). Recommend a small follow-on ORCH for the publish-time `city_geo` write.
- **D-2 (consumer cold-path date):** see §10 — the cold-path RPC date eyebrow is omitted; a follow-on can thread the formatted AM/PM line from `masterStartAt`.
- **D-3 (jest `@mingla/*` alias):** `publicEventsService.test` fails to resolve `@mingla/event-rendering` under the node-env jest config (PRE-EXISTING, untouched import). The package tests run under Deno / `--roots=../packages`. Not introduced by this leg.
- **D-4 (preview 4th body):** `PreviewEventView` remains a 4th event-body variant (OQ-3 deferred) — a future leg should reconcile it to `EventOfferingBody` in non-bookable preview mode.

---

## 13. Comms ledger

Scanned `COMMS_LEDGER.md` on entry. No `BLOCK`+`OPEN` rows targeting ORCH-1167 / `mingla-implementor` / `ALL`. COMMS-0038 (this charter), COMMS-0040/0041/0044 (sibling RSVP/trip/experience legs — this leg sets the shell-agnostic-body precedent), COMMS-0043 (ORCH-1159 close-X — preserved). No new cross-ORCH discovery requiring a ledger write.
