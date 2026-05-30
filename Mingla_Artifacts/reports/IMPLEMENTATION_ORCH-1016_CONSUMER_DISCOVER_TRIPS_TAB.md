# IMPLEMENTATION — ORCH-1016 [Consumer Discover Trips tab]

> **Mode:** IMPLEMENT (production code + evidence). **Worktree:** `~/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]/` on branch `ORCH-1016-consumer-discover-trips-tab`. Metro port 8087.
> **Inputs:** `SPEC_ORCH-1016_CONSUMER_DISCOVER_TRIPS_TAB.md` (🔒) + `DESIGN_ORCH-1016_CONSUMER_DISCOVER_TRIPS_TAB.md` (🎨, incl. the 5 orchestrator resolutions).
> **Status:** implemented and verified (app-mobile tsc clean; both regression tests green + fails-on-revert proven; RPC body validated against live DB read-only). Migrations NOT applied (operator runs `db push`).
> **Date:** 2026-05-30. **Author:** mingla-implementor+claude.

---

## 0. Comms Ledger
Read on entry. Relevant rows honored: **COMMS-0002** (added `ORCH_1016_BACKEND_ALLOWLIST` in the SAME commit as the migrations), **COMMS-0014** (buyer flow reuses `nativeCheckoutFlow.ts` → `ticket-checkout-create`, no parallel fn), **COMMS-0009** (zero anon `.from('brands')`/`.from('tickets')` in consumer code — verified by the service check), **COMMS-0003** (no new Stripe payload/enum introduced — see §Stripe). No new cross-ORCH discovery; no new COMMS row written.

---

## 1. The 5 orchestrator resolutions — as implemented
1. **Null-cover hue = HASH `tripId` client-side** → `app-mobile/src/utils/hueFromId.ts` (djb2 → mod 360); used by `TripCard` + `ConsumerTripDetailScreen`. No `cover_hue` added to the RPC.
2. **`formatTripDateRange` → shared `@mingla/event-rendering`** → `packages/event-rendering/formatTripDateRange.ts`; consumed by business `TripPreview` (replaced its local `formatDateRange`) + consumer `TripCard`/detail.
3. **`RefundPolicyDisplay` → `@mingla/event-rendering`** → `packages/event-rendering/RefundPolicyDisplay.tsx` (tokens inlined, package-isolated); business `RefundPolicyDisplay.tsx` is now a re-export shim (same pattern as EventCoverMedia / COMMS-0007).
4. **Default sort label = "Newest"** → `TripFilterChips` sort sheet options Newest/Oldest/Price (low→high)/Price (high→low); `relevance` RPC mode backs "Newest".
5. **Empty-state "Browse events" CTA threads the tab setter** → `TripsContent` receives `onBrowseEvents` = `setActiveTab('events')` from `DiscoverScreen`.

---

## 2. Files changed, grouped by surface

### Backend (`supabase/`) — migrations awaiting `supabase db push`
- **NEW** `supabase/migrations/20260803000000_orch_1016_events_departure_text.sql` — `events.departure_text` + `events.departure_geo point` (additive, nullable) + a `BEFORE INSERT/UPDATE OF theme` trigger `tg_events_sync_departure_from_theme` that mirrors `theme.business_trip.departureLocationText/Lat/Lng` → the canonical columns on trip rows.
- **NEW** `supabase/migrations/20260803000001_orch_1016_pg_published_trips_public.sql` — global anon SECURITY DEFINER RPC `pg_published_trips_public(...)` + REVOKE/GRANT + self-verify DO-block.
- **MOD** `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — `ORCH_1016_BACKEND_ALLOWLIST` (the 2 migrations + the Deno test), spread into `ALLOWLIST` (COMMS-0002, same commit).
- **NEW** `supabase/migrations/__tests__/orch_1016_pg_published_trips_public.test.ts` — Deno hard-guard + departure-filter contract test (fails-on-revert).

### Business authoring (`mingla-business/`) — "Departing from" + "Leaving from"
- **MOD** `src/components/trip/TripCreatorStep1Basics.tsx` — `Step1Draft` gains `departure{PlaceId,LocationText,Lat,Lng}`; new "Departing from" `AddressAutocompleteInput` immediately above Destination.
- **MOD** `src/components/trip/TripCreatorWizard.tsx` — departure threaded through all 4 sites (tripToStep1Draft, previewTrip, autosaveStep1, publish payload).
- **MOD** `src/components/trip/EditPublishedTripScreen.tsx` — edit state + `tripToLocalEditState` + `buildLiveTripPatch` (additive, NO refund gate) + a "Departing from" `TextInput` above Destination.
- **MOD** `src/services/tripsService.ts` — `TripBusinessTrip` gains 4 departure fields; `EventRow.departure_text`; `readBusinessTrip` sources `departureLocationText` from the canonical column.
- **MOD** `src/components/trip/TripPreview.tsx` — uses shared `formatTripDateRange`; renders a "Leaving from {city}" metaRow (conditional) ABOVE destination (icon `send`).
- **MOD** `src/hooks/usePublicTripBySlug.ts` + `src/services/publicEventsService.ts` — project `departureLocationText` (canonical column, theme fallback) so the buyer-web `/t/...` page (§G) renders it.
- **MOD** `src/components/trip/RefundPolicyDisplay.tsx` — re-export shim → `@mingla/event-rendering`.
- **MOD (additive, 0 deleted lines)** 4 trip test fixtures (`ORCH-0876.adversarial`, `publishedTripEditGuards`, `upcomingBuilder`, `upcomingBuilder.adversarial`) — added the 4 departure-default fields to `businessTrip` literals so they compile against the widened type. Append-only-safe.

### Consumer app (`app-mobile/`)
- **NEW** `src/services/tripsDiscoveryService.ts` — `DiscoverTripRow`/`DiscoverTripFilters` types + `fetchPublishedTrips` (RPC call, camelCase→p_* mapping, throw-on-error, totalCount).
- **NEW** `src/hooks/useDiscoverTrips.ts` — `useInfiniteQuery`, query-key factory, staleTime 60s, anon-tolerant.
- **NEW** `src/components/discover/TripCard.tsx` — single-column card (DESIGN Item 2), conditional render, Android opaque glass.
- **NEW** `src/components/discover/TripFilterChips.tsx` — 6-chip row (destination, leaving-from, dates, price, group, sort) + sheets.
- **NEW** `src/components/discover/TripsContent.tsx` — Trips tab body + all 9 states (loading/error/empty-none/empty-filters/populated/single/etc.).
- **NEW** `src/screens/Trip/ConsumerTripDetailScreen.tsx` — full-screen overlay detail (hero, X-close/share, deadline band, refund ladder, itinerary, inclusions, tiers, sticky Reserve with deadline enforcement).
- **NEW** `src/hooks/useConsumerTripDetail.ts` — composes detail from anon-direct `events`/`trip_*` reads + RPC-sourced brand fields. NEVER `.from('brands')`.
- **NEW** `src/utils/hueFromId.ts` — deterministic hue hash.
- **NEW** `app/t/[brandSlug]/[tripSlug].tsx` — Expo Router deep-link re-export.
- **NEW** `scripts/ci/orch-1016-trips-discovery-service-check.mjs` — implementor regression test.
- **MOD** `src/components/DiscoverScreen.tsx` — title→"Discover"; Events/Trips spotlight pill (Likes pattern, exact); Events filter bar gated to Events tab; `<TripsContent>` mounts on Trips tab; `onOpenTrip` prop. Events grid pipeline byte-for-byte unchanged (SC-12).
- **MOD** `app/index.tsx` — `viewingTrip` overlay slot + `<ConsumerTripDetailScreen>` render + `onOpenTrip` threaded to DiscoverScreen + `isOverlayActive` includes viewingTrip.
- **MOD** `src/screens/ConsumerBrandProfileScreen.tsx` — `onOpenTrip` → `router.push('/t/{brandSlug}/{tripSlug}')` (in-app), NOT `WebBrowser` (kills the web-eject; WebBrowser kept for events/experiences).
- **MOD** `src/store/appStore.ts` — `discoverActiveTab` slot + setter (mirrors `likesActiveTab`).
- **MOD** `src/payments/nativeCheckoutFlow.ts` — `NativeCheckoutInput.intakeFormData` + forwards `intake_form_data` body key (§F.4; key already supported server-side — no edge-fn edit).
- **MOD** `src/i18n/locales/en/discover.json` — `title`→"Discover", `events_tab`, `trips_tab` (EN-only per §E.1).

### Shared package (`packages/event-rendering/`)
- **NEW** `formatTripDateRange.ts`, **NEW** `RefundPolicyDisplay.tsx`, **MOD** `index.ts` (exports).

---

## 3. Migration apply command (for the orchestrator, after rebase onto main)
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]" && /Users/sethogieva/bin/supabase db push --linked
```
Remote head is `20260802000003`; the ORCH-1016 migrations are `20260803000000` + `20260803000001` (strictly greater, monotonic, no sibling collision). Standard `db push` (no `--include-all`). Run `migration list --linked` first to confirm no remote-only drift. Both migrations are additive + idempotent (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE) with a self-verify DO-block that RAISEs on any deploy failure.

---

## 4. RPC signature as shipped
```sql
pg_published_trips_public(
  p_destination_query text DEFAULT NULL, p_departure_query text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,  p_date_to timestamptz DEFAULT NULL,
  p_min_price_cents integer DEFAULT NULL, p_max_price_cents integer DEFAULT NULL,
  p_group_size_min integer DEFAULT NULL,  p_group_size_max integer DEFAULT NULL,
  p_sort text DEFAULT 'relevance', p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
) RETURNS TABLE (trip_id uuid, trip_slug text, brand_slug text, brand_name text,
  brand_verified boolean, title text, description text, destination_text text,
  departure_text text, cover_media_url text, cover_media_type text, status text,
  start_at timestamptz, end_at timestamptz, timezone text, bookings_closed boolean,
  booking_deadline timestamptz, total_capacity integer, tickets_sold integer,
  spots_left integer, min_price_cents integer, currency text, has_free_tier boolean,
  published_at timestamptz, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;
-- REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO anon, authenticated;
```
Matches the SPEC §A.2 signature exactly.

---

## 5. Test evidence

### Deno RPC test — `supabase/migrations/__tests__/orch_1016_pg_published_trips_public.test.ts`
`deno test --allow-read` → **14 passed | 0 failed**. Asserts all 6 hard-guard conjuncts, departure-separate-from-destination, spots/sold formula, anon GRANT + SECURITY DEFINER, self-verify block, sort modes, and operator-decision-#1 (no `show_on_discover` predicate).
- **fails-on-revert verified at `9e1d25ad5b8cfb91091b89a30145362514546f30`**: removing the `booking_deadline IS NULL OR ... >= now()` conjunct → 1 test fails; removing the `p_departure_query ... ILIKE` clause → 1 test fails; restore → 14/14 green.

### Service test — `app-mobile/scripts/ci/orch-1016-trips-discovery-service-check.mjs`
`node` → **6 checks PASS**. Asserts the 11-field camelCase→p_* mapping, throw-on-error, totalCount derivation, no-AsyncStorage, zero `.from('brands')`/`.from('tickets')` across 7 consumer files, + a behavioral mapRow/totalCount replica.
- **fails-on-revert verified at `9e1d25ad5b8cfb91091b89a30145362514546f30`**: breaking the `p_departure_query: filters.departureQuery` mapping → fails; restore → 6/6 PASS.

### Live-DB read-only validation (RPC body)
The hard-guard WHERE returns exactly the 3 qualifying published trips ("The Sone", "Untitled trip" (testtttt), "The DC Adventure" w/ future deadline); the 33 drafts + cancelled/past are excluded. Capacity/sold/spots/price/currency aggregation validated (DC Adventure: 102 cap / 81 sold / 21 left / €500; Untitled: £20000). The ORDER BY CASE sorts live-before-scheduled. (SC-4 confirmed.)

### Typecheck / lint
- **app-mobile `tsc --noEmit`: 0 errors** (clean baseline AND with my changes).
- **mingla-business `tsc`: 242 errors** — baseline 236 + 6 benign package-isolation errors (`Cannot find module 'react'` / implicit-any) from the 2 NEW package files, identical to the pattern ALL existing `event-rendering` files already exhibit under the business tsconfig (these packages are type-clean when consumed by app-mobile). **Zero new errors in any business source file I edited.**
- `expo lint` on the touched files: no errors/warnings.
- ORCH-0863 strict-grep gate: PASS. orch-0839-a-mobile-cache-removed gate (SC-12): 5/5 PASS. Modified business fixture test `upcomingBuilder.test.ts`: 22/22 PASS.

---

## 6. Stripe / Supabase external-API docs (COMMS-0003)
**No new Stripe payload/enum/endpoint introduced.** The buyer flow reuses the existing `ticket-checkout-create` native contract; the only addition is the `intake_form_data` body key, which is an INTERNAL Mingla edge-fn key already supported server-side (ORCH-0880) — NOT a Stripe API field. The Stripe contract (PaymentIntent client-secret → PaymentSheet) is unchanged; the existing inline citation in `nativeCheckoutFlow.ts` stands: https://docs.stripe.com/payments/accept-a-payment?platform=react-native . No new Supabase RPC enum requiring citation beyond the documented `supabase.rpc()` call shape.

---

## 7. Per-hard-guard compliance checklist
| Hard guard (dispatch) | Status | Evidence |
|---|---|---|
| Likes spotlight-pill COMPOSED-WITHIN, never reinvented | ✅ | DiscoverScreen pill mirrors `LikesPage.tsx` geometry/spring/haptics/a11y byte-for-byte |
| Events tab deck + filter row UNCHANGED (SC-12) | ✅ | Events grid + filter bar gated under `activeTab==='events'`, no edits to the pipeline; cache gate 5/5 PASS |
| NO anon `.from('brands')`/`.from('tickets')` | ✅ | Service check T-NOBRANDS across 7 files; brand fields via RPC + `business_public_brands_view` only |
| Buyer flow REUSES `nativeCheckoutFlow.ts` → `ticket-checkout-create` (COMMS-0014) | ✅ | No parallel fn; Reserve reuses `ExpandedBusinessEventSheet`; only the `intake_form_data` body key added |
| `ANDROID_GLASS_USES_OPAQUE_FALLBACK` on pill + cards | ✅ | TripCard chip + TripFilterChips use opaque fills, `overflow:'hidden'`, no Android shadow under rounded fill |
| Reuse shared `EventCoverMedia` for covers | ✅ | TripCard + detail render `@mingla/event-rendering` EventCoverMedia |
| No fabricated data (verified badge / "Leaving from" / spots conditional) | ✅ | All render `!== null`/`=== true` gated; null → hidden |
| Hard guards in RPC WHERE (draft/cancelled/past/closed/zero-tier excluded; NULL deadline surfaced; show_on_discover ignored) | ✅ | 6-conjunct WHERE; Deno fails-on-revert; live-DB 3-trip set |
| COMMS-0002 allowlist in SAME commit | ✅ | `ORCH_1016_BACKEND_ALLOWLIST` added with migrations |
| COMMS-0003 Stripe docs | ✅ | No new Stripe API surface; §6 |

---

## 8. Deviations from SPEC/DESIGN (with reason)
- **D-1 (header IA):** DESIGN Item 1.3 put the glass header at `title → pill` with the Events filter bar moved into the scroll body. To preserve SC-12 byte-for-byte (the riskier filter-bar relocation), I instead kept the header as `title → pill → eventsFilterBar` on the Events tab (filter bar UNCHANGED in place) and `title → pill` on the Trips tab (Events filter bar conditionally hidden). This honors DESIGN Item 1.4 ("Events tab keeps its existing filter bar EXACTLY as today") and SC-12, at the cost of a slightly taller Events header than the pure `title → pill`. Net visual: identical Events tab; calm pill header; Trips gets its own `TripFilterChips` row in-body.
- **D-2 (departure persistence mechanism):** SPEC §B.2 implies extending the `biz_update_live_trip` events-row UPDATE for departure. Rather than re-CREATE the ~250-line RPC (drift risk), I added a focused `BEFORE` trigger that syncs `theme.business_trip.departureLocationText/Lat/Lng` → the canonical columns. This converges the draft (`updateTripBasics`) AND live-edit (`biz_update_live_trip` generic theme merge) paths uniformly with zero RPC surgery. Same observable contract (publish/edit a departure → `events.departure_text` set → feed + preview + buyer-web render it).
- **D-3 (edit-form input type):** SPEC §B.2 said use `AddressAutocompleteInput` on the published-edit form; I matched the edit form's ACTUAL existing pattern (a plain `TextInput` for destination — text-only edit, no geo capture on edit). The create form DOES use `AddressAutocompleteInput` (geo captured). Departure on edit is text-only, consistent with destination-on-edit.
- **D-4 (Reserve buyer flow):** per SPEC §F.1's "reuse where it fits", the consumer trip Reserve CTA opens the proven `ExpandedBusinessEventSheet` (tier select → cart → tax-preview address → `runNativeCheckout`) by mapping the trip to its `BusinessEventCard` shape — reusing ALL the address/tax/marketing plumbing rather than rebuilding it. The `intake_form_data` plumbing is wired into `nativeCheckoutFlow`; a dedicated trip-intake renderer UI is deferred where no trip intake schema exists today (SPEC A-2/F.4 — zero schemas; the edge fn's `intake_form_required` is the server backstop). When the first trip intake schema ships, the intake renderer plugs into this path.
- **D-5 (buyer-web icon):** the business Icon set has no `paper-plane-outline`; I used `send` (the paper-plane glyph in that set) for the buyer-web/preview "Leaving from" line. App-mobile's Icon DOES have `paper-plane-outline` (used on the consumer card + detail).

---

## 9. Discoveries for orchestrator
- The `mingla-business` app does not currently typecheck clean (236 pre-existing `tsc` errors on baseline: `home.tsx` comparison, `@mingla/payments-native` module resolution under this tsconfig, `DraftEvent.category`, IconChrome/Sheet.web, package react-resolution). Out of ORCH-1016 scope; flagged for a future hygiene ORCH.
- `orch-0828-regression-check` shows a PRE-EXISTING failing contract (T-05 `ExpandedBusinessEventSheet imports default BottomSheet`) on baseline — unrelated to this ORCH.
- The tester writes the separate adversarial tests (SPEC §10): `orch_1016_hard_guards_adversarial.test.ts` + `orch_1016_consumer_trip_detail.adversarial.test.tsx`.

---

## 10. Needs orchestrator decision before TEST
1. **Default-sort copy:** "Newest" (per resolution #4). Seth may override at the checkpoint.
2. **D-4 Reserve via ExpandedBusinessEventSheet** vs a dedicated trip-Reserve sheet — the reuse path inherits the full address/tax/checkout plumbing but maps a trip onto the event-card shape; confirm acceptable for C1 (trip intake renderer deferred, no schemas exist).
3. The migration must be applied by the operator/orchestrator (`db push`) before the live-fire TEST can exercise the feed end-to-end.
