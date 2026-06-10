# SPEC — ORCH-1107: Companion-stops + Picnic-grocery off Google onto scored place_pool

**Date:** 2026-06-10 · **Owner:** Claude `mingla-orchestrator` · **Operator directive:** "remove it. Nothing must use Google… companion stops should use the scored pipeline we already have and every other curated intent uses." (Scope confirmed = Bucket A only.)

## Problem (proven)
`get-companion-stops` (Take a Stroll) and `get-picnic-grocery` (Picnic Dates) both call `batchSearchPlaces` (`_shared/placesCache.ts`) → **live Google Places `searchNearby`** (`places.googleapis.com/v1/places:searchNearby`), reading `GOOGLE_MAPS_API_KEY`. They make ~1 call per companion type (≈9 per expansion), do **no** `place_pool` read (the "cache" is vestigial: `cacheHits` hardcoded 0, `ttlHours` unused), and return raw Google results (companion-stops even hardcodes an Unsplash placeholder image). This bypasses the scored intelligence pipeline and is the only consumer-runtime Google dependency.

## Target pattern (already exists)
Every other curated intent serves stops via `fetchSinglesForSignalRank` (`_shared/signalRankFetch.ts`) → RPC **`fetch_local_signal_ranked`**, which enforces the three serving gates: G1 `is_servable=true`, G2 `signal score >= filter_min`, G3 real `stored_photo_urls`. Params: `{ filterSignal, filterMin, rankSignal, centerLat, centerLng, radiusMeters, limit, requiredTypes }`. `replace-curated-stop` already uses this path.

## Change (both edge functions)
1. Replace `batchSearchPlaces(...Google...)` with `fetchSinglesForSignalRank(supabaseAdmin, {...})`:
   - `centerLat/centerLng` = anchor location; `radiusMeters` = `maxDistance` (companion default 500m; picnic per its current value).
   - `requiredTypes` = companion types (`bakery, cafe, ice_cream_shop, meal_takeaway, deli, grocery_store, convenience_store, supermarket, food_store`) for companion; picnic = its grocery/park set.
   - `rankSignal` / `filterSignal` = the signal these intents already map to in `signalRankFetch` (Take-a-Stroll → `scenic`; Picnic → `picnic_friendly`) — choose the companion-appropriate one (likely a casual/food signal; confirm against the rank-signal allowlist).
   - `limit` small (companion returns top 1; fetch ~5 and pick best).
2. Map `SignalRankResult` → the existing response shape (id, name, location, address, rating, reviewCount, imageUrl from real `stored_photo_urls[0]` — **kill the Unsplash placeholder**).
3. **Remove** `GOOGLE_MAPS_API_KEY` read + the 500 "Google Maps API key not configured" guard from both functions.
4. Leave the client (`stopReplacementService`, `ExpandedCardModal.fetchStrollData/fetchPicnicData`, `CompanionStopsSection`) unchanged — same contract, new source.

## Success criteria
- `grep GOOGLE_MAPS_API_KEY supabase/functions/get-companion-stops supabase/functions/get-picnic-grocery` → **zero**.
- Both functions call `fetch_local_signal_ranked` (directly or via `fetchSinglesForSignalRank`); no `googleapis.com` reference remains in either.
- Take-a-Stroll + Picnic cards still render a companion/grocery spot on expand (device-verified iOS + Android), now sourced from servable, scored, real-photo place_pool rows.
- Regression test: happy-path (companion returned from place_pool for an anchor with nearby servable food places) + adversarial (anchor with no nearby servable companion → graceful empty, no Google fallback, no crash).

## Out of scope
Buckets B (seeding pipeline), C (Gemini/Ari), D (Google login / Firebase push / map links) — operator deferred. Seeding pipeline remains the legitimate Google→place_pool ingestion.

---

## SPEC AMENDMENT 1 (2026-06-10, orchestrator — SUPERSEDES §8-9 RPC choice)

**Investigated correction.** §8 named `fetch_local_signal_ranked` / `fetchSinglesForSignalRank`. Live probing proved that RPC returns ~0 rows for the launch cities (it gates on `place_scores`, which is the canonical deterministic+AI **blend** written by `run-signal-scorer`, currently sparse for NY/Paris/etc. because the scorer hasn't been run there). The **live solo-deck RPC** `query_servable_places_by_signal` is the correct, simpler path and is what `discover-cards` itself uses. USE IT.

**RPC contract (verified signature):**
`query_servable_places_by_signal(p_signal_id text, p_filter_min numeric, p_lat double precision, p_lng double precision, p_radius_m double precision, p_exclude_place_ids uuid[] DEFAULT '{}', p_limit integer DEFAULT 20)` → returns `place_id, google_place_id, name, address, lat, lng, rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, photos, stored_photo_urls, types, primary_type, signal_score, …`. It already enforces G1 `is_servable` + `is_active`, G2 `place_scores.score >= p_filter_min`, G3 real `stored_photo_urls`, and a haversine radius — so the three serving gates come for free.

**Per-function call:**
- `get-companion-stops`: `p_signal_id='casual_food'`, `p_lat/p_lng` = anchor, `p_radius_m` = `maxDistance` (default 500), `p_filter_min=120`, `p_limit=10`; sort by `signal_score` desc, take top 1.
- `get-picnic-grocery`: `p_signal_id='groceries'`, same geo/limit pattern.
Map the returned row → the existing response shape; `imageUrl = stored_photo_urls[0]` (KILL the Unsplash placeholder). Graceful empty (`strollData:null` / no grocery) when the RPC returns 0 rows — NO Google fallback, no throw.

**Operational note (NOT a code defect, NOT in 1107 scope):** companion/picnic will return results in a city only AFTER `run-signal-scorer` has populated `place_scores` for that city. That is Seth's operational task (and overlaps META-ORCH-1062 / COMMS-0018's scorer-invoke fix). 1107 ships the correct code; data population is separate.

**Success-criteria update:** replace "calls `fetch_local_signal_ranked`" with "calls `query_servable_places_by_signal`"; the zero-`GOOGLE_MAPS_API_KEY` / zero-`googleapis.com` criteria stand.

**COMMS-0002 factor:** ORCH-1107 edits EXISTING edge functions (no NEW backend files, no migration), so the ORCH-0863 C7 `no-new-backend-files` gate should not trip — but if CI flags it, add an `ORCH_1107_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit.

**Affected Surfaces:** iOS-consumer + Android-consumer (Take-a-Stroll / Picnic-Dates card expand), backend (2 edge functions). NOT business app, admin, or buyer-web.
