# INVESTIGATION — ORCH-1079 [Business-venue Google→Mapbox sweep]

**Mode:** INVESTIGATE (investigation + migration-mapping only — no code, no spec)
**Worktree:** `~/Desktop/mingla-orchs/orch-1079-[business-venue-mapbox-sweep]/` on branch `orch-1079-business-venue-mapbox-sweep`
**Date:** 2026-06-05
**Author:** mingla-forensics+claude
**Confidence:** HIGH (source-traced end-to-end; Mapbox POI behavior verified against live docs; one runtime-confidence caveat noted on POI `context.place` derivation)

---

## 0. Executive summary

The infrastructure for this sweep is **already shipped and live on `main`** (META-ORCH-1059 + META-ORCH-1060). The business app's `MapboxAddressInput.tsx` and `mapboxGeocodeService.ts` are already thin per-app wrappers over the shared `@mingla/location-input` package (PR #372, `0a42dead8`), and the event venue picker (`CreatorStep3Where`) already runs Mapbox in production. ORCH-1079 is therefore **NOT** a new-infrastructure build — it is a small, mechanical **repoint** of the last three Google-Places surfaces onto the already-existing business Mapbox wrapper, plus retiring the now-orphaned Google path.

**Three remaining Google importers** (definitive list, verified on this branch):
1. `mingla-business/src/components/venue/VenueStep1Address.tsx` — venue-claim address
2. `mingla-business/src/components/brand/BrandCreationFlow.tsx` — brand venue address (Step 2)
3. `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` — trip departure + destination

All three import the shared Google component `mingla-business/src/components/event/AddressAutocompleteInput.tsx`, which wraps `mingla-business/src/services/googlePlacesService.ts` → the `places-autocomplete` edge fn → Google Places API.

**POI / business-NAME search verdict: ADEQUATE — WITH EVIDENCE (not a regression).** The `mapbox-geocode` edge fn's `suggest` call passes **no `types` filter**, and Mapbox Search Box `/suggest` returns POIs/businesses by name by default. The event venue picker already proves this in production. One MEDIUM-confidence caveat (POI-without-`context.place` → honest 500) is documented in §2 with a recommended mitigation.

**Google retirement:** `places-autocomplete` edge fn + `AddressAutocompleteInput.tsx` + `googlePlacesService.ts` + the dead `GooglePlacesAutocomplete.tsx` can be deleted after cutover. **`GOOGLE_MAPS_API_KEY` MUST be retained** — six other live edge functions use it (the entire place-intelligence/`place_pool` seeding pipeline + consumer companion/picnic stops). Do NOT delete the key.

**One real hazard, scoped to the VENUE-CLAIM surface only:** the venue path persists `google_place_id` and uses it as a **dedup/match key** against Google-seeded `place_pool.google_place_id` rows (RPC `biz_create_venue_brand_authoring` raises `place_pool_google_place_id_mismatch`). A Mapbox `mapbox_id` will never match a Google place id. This is handled today because the create-new venue path sends an empty `google_place_id` and only the **claim-an-existing-pool-row** path enforces the match — but the SPEC must decide explicitly how Mapbox interacts with the Google-seeded pool. Full analysis in §3.A.

---

## 1. ENUMERATE the remaining Google importers (definitive)

### 1.1 The Google component + service (to be retired)

| File | Role | Status |
|---|---|---|
| `mingla-business/src/components/event/AddressAutocompleteInput.tsx` | Google Places autocomplete field (250ms debounce, ≥3-char, ≤5 suggestions, pick→`fetchPlaceDetails`). Imports `googlePlacesService`. | RETIRE after cutover |
| `mingla-business/src/services/googlePlacesService.ts` | `autocompletePlaces()` + `fetchPlaceDetails()` → `supabase.functions.invoke("places-autocomplete", …)` | RETIRE after cutover |
| `supabase/functions/places-autocomplete/index.ts` | Edge proxy → Google Places API (`https://places.googleapis.com/v1` + legacy `maps.googleapis.com/maps/api/place`). `verify_jwt = true` (config.toml:31-32). | RETIRE after cutover (backend allowlist — COMMS-0002) |
| `mingla-business/src/components/ui/GooglePlacesAutocomplete.tsx` | **DEAD CODE** — imported by NOTHING (`grep` for `GooglePlacesAutocomplete` outside its own file = 0 hits). Also references `googlePlacesService` + `places-autocomplete`. | DELETE (no migration needed; never rendered) |
| `mingla-business/src/utils/parseGooglePlaceResult.ts` + `__tests__/parseGooglePlaceResult.test.ts` | Maps `PlaceDetails`→`ParsedVenuePlace{googlePlaceId,…}` for venue/brand persistence. Pure mapper. | KEEP or rename (see §3); shape is provider-agnostic except the `googlePlaceId` field name |

### 1.2 The three live importers of `AddressAutocompleteInput` (the actual migration targets)

| # | File:line | Surface | Imports |
|---|---|---|---|
| 1 | `mingla-business/src/components/venue/VenueStep1Address.tsx:15-16` | Venue-claim wizard Step 1 (Ve1) | `AddressAutocompleteInput` + `PlaceDetails` (googlePlacesService) + `parseGooglePlaceResult` |
| 2 | `mingla-business/src/components/brand/BrandCreationFlow.tsx` (import top; usage `:337`) | Brand creation wizard Step 2 (brand venue address) | `AddressAutocompleteInput` + `parseGooglePlaceResult` |
| 3 | `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx:36` | Trip wizard Step 1 (departure + destination, two fields) | `AddressAutocompleteInput` |

### 1.3 CreatorStep3Where — ALREADY MIGRATED (do NOT double-migrate)

`mingla-business/src/components/event/CreatorStep3Where.tsx:37-38` imports `MapboxAddressInput` from `../location/MapboxAddressInput` and `PlaceDetails` from `../../services/mapboxGeocodeService`. It does **not** import `googlePlacesService`. The earlier grep hit was a code comment only (lines 32-36, 75). ORCH-1047 switched it after Google `REQUEST_DENIED`; META-ORCH-1059/1060 repointed it through the shared package. **Confirmed: no action.**

### 1.4 The Mapbox target (already on `main`, NOT yet on this stale branch)

- `mingla-business/src/components/location/MapboxAddressInput.tsx` — on `origin/main` this is a thin wrapper injecting `BUSINESS_TOKENS` + business `Icon` + business `supabase.functions.invoke` + `BUSINESS_COPY` into `SharedMapboxAddressInput` from `@mingla/location-input`. **Props are byte-identical to `AddressAutocompleteInput`** (`value`, `onChangeText`, `onPick(details: PlaceDetails)`, `onClear`, `error`, `placeholder`, `accessibilityLabel`).
- `mingla-business/src/services/mapboxGeocodeService.ts` — on `origin/main` this is a business-supabase-bound shim re-exporting `autocompleteMapbox`/`retrieveMapboxPlace`/`newMapboxSessionToken` + `PlaceDetails`/`PlaceAutocompleteSuggestion` types from `@mingla/location-input`.
- `packages/location-input/` — shared package (index, src/MapboxAddressInput.tsx, src/mapboxGeocodeService.ts, src/types.ts).
- `supabase/functions/mapbox-geocode/index.ts` — server proxy, `verify_jwt = true` (config.toml:138-139), deployed **v19** live (COMMS-0020 RESOLVED confirms source-on-main + deployed parity).

> ⚠ **Branch-staleness blocker (must rebase first).** This worktree is **5 commits behind `origin/main`** and PRE-DATES the META-ORCH-1060 merge (PR #372). On this branch `packages/location-input/` **does not exist** and the local `MapboxAddressInput.tsx`/`mapboxGeocodeService.ts` are still the standalone META-ORCH-1059 originals (the LOCAL non-shared versions). **The SPEC/IMPLEMENT phase MUST rebase this branch onto `origin/main` before any work** so it builds on the shared-package wrapper, not the stale standalone copy. Reinforces `[[edge-deploy-and-migration-apply-hazards]]` (always `git fetch` + rebase before existence checks).

---

## 2. THE GATING RISK — Mapbox POI / business-NAME search adequacy

**VERDICT: ADEQUATE — venue-NAME search does NOT regress vs Google. (One MEDIUM-confidence caveat with a cheap mitigation.)**

### 2.1 Evidence — Mapbox Search Box returns POIs/businesses by name by default

Verified live against Mapbox docs (COMMS-0003 — external-API behavior cited inline):

- **Search Box `/suggest` covers POIs and businesses by name**, not just addresses: "not only addresses, but also points of interest (POIs), categories of POIs, street names, neighborhoods, localities, place names, districts, postcodes, regions, and countries." — https://docs.mapbox.com/api/search/search-box/#get-suggestions , https://docs.mapbox.com/api/search/search-box/
- **`types` default = ALL types (POI included):** "If no types are specified, all possible types may be returned." — https://docs.mapbox.com/api/search/search-box/#get-suggestions
- **`poi` is an explicit `types` value** (full set: `country, region, postcode, district, place, city, locality, neighborhood, street, address, poi, category`). — https://docs.mapbox.com/api/search/search-box/#get-suggestions
- **Session billing** suggest+retrieve = one session per `session_token`: https://docs.mapbox.com/api/search/search-box/#session-billing

### 2.2 The deployed edge fn already gets POIs (no filter excludes them)

`supabase/functions/mapbox-geocode/index.ts` `handleSuggest()` builds:
```
GET /search/searchbox/v1/suggest?q=<query>&session_token=<tok>&access_token=<tok>&limit=5
```
**No `types` parameter is passed.** Per the docs above, omitting `types` returns ALL feature types including POIs. So typing "Soho Lounge" or "The Crown & Anchor" hits POI/business results today. This is the make-or-break, and it is satisfied by construction.

### 2.3 Production precedent — event venue picker already runs Mapbox

`CreatorStep3Where.tsx` (event "Venue name" + "Address" step) has used `MapboxAddressInput` → `mapbox-geocode` in production since ORCH-1047/META-ORCH-1059. The field is literally a venue picker (placeholder "e.g. Hidden Rooms" for name, then the Mapbox address field). It does name-capable search via the same no-`types` suggest call. No operator bug report of "can't find my venue by name" has surfaced against the event picker since (no such COMMS entry; no MASTER_BUG_LIST entry found in scan). This is the strongest available evidence that the business leg is safe.

### 2.4 MEDIUM-confidence caveat (FLAG + mitigation) — POI without a derivable city → honest 500

`mapbox-geocode`'s `featureToDetails()` (index.ts) **requires a derivable city**:
```
const city = ctx.place?.name ?? ctx.locality?.name ?? ctx.district?.name ?? null;
if (!city) return { error: "no_locality" };
```
Mapbox can omit `context.place` for some POI features. When that happens, `retrieve` returns HTTP 500 `no_locality`, and `MapboxAddressInput` shows the loud pick-error "Couldn't fetch address details. Tap to try again." — i.e. the user picks a real venue from the dropdown and the pick fails. This mirrors the Google contract ("city required") and the edge fn header explicitly documents it as a known defensive point. The event picker has run this way in prod without a reported gap, so the practical hit rate is low — but it is the one place where venue-name picking could surface friction.

**Recommended mitigation (for the SPEC to decide, not this investigation):** keep the suggest call filter-free (do NOT add `types=address`, which WOULD regress name search), and in `featureToDetails` extend the city fallback chain to also accept `ctx.region?.name` as a last-resort locality OR relax `city` to nullable for the business venue surfaces (the business `PlaceDetails.city` is already typed `string` non-null, but the persisted columns `brands.city`/`events` accept null). This is a one-line edge-fn change with a cross-surface blast on the consumer city picker — so it belongs in the SPEC with its own success criterion + a unit test feeding a POI-without-place fixture, NOT a silent tweak. Cite: https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature (context object structure).

### 2.5 Shape-parity confirmation (Google ↔ Mapbox `PlaceDetails`)

| Field | Google (`googlePlacesService`) | Mapbox business shim (`@mingla/location-input`) |
|---|---|---|
| `placeId` | Google place id | `mapbox_id` |
| `formattedAddress` | ✓ | ✓ |
| `city` | ✓ (required) | ✓ (required, honest 500 if not derivable) |
| `region` | admin_area_1 short name | `context.region.name` |
| `countryCode` | ISO alpha-2 | ISO alpha-2 (`context.country.country_code`) |
| `location.{lat,lng}` | ✓ | ✓ |
| `regionCode` / `regionCodeFull` | ✗ (absent) | ✓ (ADDITIVE — consumer-only; business surfaces ignore) |

The Mapbox shape is a **structural superset** of Google's — every field the business surfaces read (`formattedAddress`, `city`, `region`, `countryCode`, `location`) is present and same-typed. The only semantic difference is `placeId` (mapbox_id vs google place id), which matters ONLY for the venue-claim dedup path (§3.A).

---

## 3. PER-SURFACE MIGRATION MAP

For each surface: current code, what it persists, and the repoint that keeps the persisted shape identical. The shared business `MapboxAddressInput` is a **drop-in** (identical prop signature), so the migration is import-swap + handler-body-identical, with ONE field-name nuance per surface.

### 3.A Venue claim — `VenueStep1Address.tsx` (HIGHEST CARE)

**Current (file:line):**
- Import: `AddressAutocompleteInput` (`:15`), `PlaceDetails` from `googlePlacesService` (`:16`), `parseGooglePlaceResult` (`:13`).
- `onPick`: `parseGooglePlaceResult(details)` → `patch({formattedAddress, googlePlaceId, lat, lng, city, countryCode})` into `useDraftVenueStore`.

**Persists to (traced):**
- `draftVenueStore` fields (`store/draftVenueStore.ts:29` `googlePlaceId: string|null`, persisted via AsyncStorage `mingla-business-draft-venue-v1`).
- On submit → `VenueCreatorWizard.tsx:174-195` `createVenue.mutateAsync({…googlePlaceId: st.googlePlaceId…})` → `brandsService.createVenueBrandPendingReview` (`brandsService.ts:357-381`) → RPC `biz_create_venue_brand_authoring(p_google_place_id, …)`.
- **DB:** `brands.google_place_id` (inserted at `20260809000000_…sub_e_business_supply_feeder.sql:350,377` as `v_google`).

**THE DEDUP HAZARD (root concern, classified 🟠 Contributing Factor for the SPEC):**
The RPC (`…sub_e…:311-327`) does:
```
v_google := nullif(trim(coalesce(p_google_place_id,'')), '');
IF p_place_pool_id IS NOT NULL THEN
  SELECT p.google_place_id INTO v_pool_google FROM place_pool WHERE id = p_place_pool_id AND is_active;
  IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
     RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
  END IF;
END IF;
```
`place_pool` is seeded by Google (`admin-seed-places` / `admin-refresh-places` write `google_place_id`; unique index `idx_place_pool_google_place_id_nonnull_unique`). A Mapbox `mapbox_id` will **never** equal a `place_pool.google_place_id`. So:
- **Claim-an-existing-pool-row path** (`placePoolId != null`, set when the operator accepts a pool match card at the Ve2 gate via `prefillDraftFromPoolMatch` / `poolSearchService`): the pool-match card already carries the Google `google_place_id` (`prefillDraftFromPoolMatch.ts:20`), so the draft's `googlePlaceId` comes FROM the pool row, not from the address picker. **The Mapbox address picker in Step 1 is NOT the source of the dedup key here** — it only refines the displayed address/geo. This path is safe IF the migration preserves that the pool-derived `googlePlaceId` is what reaches the RPC (do not overwrite it with the mapbox_id on address re-pick).
- **Create-new venue path** (`placePoolId == null`): the RPC's dedup branch is skipped entirely; `google_place_id` is stored as free metadata. Sending a `mapbox_id` here would pollute `brands.google_place_id` with a non-Google id under a column whose unique index spans place_pool only (brands has no such constraint — `grep` shows no brands-level unique on google_place_id). **Recommendation: for the create-new path, write `null` (or a new `mapbox_id`/`provider` column) rather than stuffing a mapbox_id into `google_place_id`.**

**Migration recommendation (SPEC must specify):**
1. Swap import to `MapboxAddressInput` (`../location/MapboxAddressInput`) + `PlaceDetails` from `../services/mapboxGeocodeService`.
2. In `onPick`, **do NOT** write `details.placeId` into `googlePlaceId` for the create-new path — set `googlePlaceId: null` (preserve the existing "" → null RPC behavior). For the claim path, leave the pool-derived `googlePlaceId` untouched (Step-1 address re-pick should patch only `formattedAddress`/`lat`/`lng`/`city`/`countryCode`, not the dedup key).
3. Persisted columns `formattedAddress, lat, lng, city, countryCode` are written identically (same `PlaceDetails` fields). **Persisted shape preserved.**
4. The SPEC should rename `parseGooglePlaceResult` → `parseVenuePlaceResult` (or keep, but its `googlePlaceId` output field should be sourced as null for new-create). Provider-neutral naming, no behavior change.

> This is the ONLY surface where the swap is not purely mechanical. Flag to operator: the place_pool seeding stays Google; the venue-claim **match** card stays Google-keyed; only the free-text **address refinement** field moves to Mapbox. There is no plan in this ORCH to re-seed `place_pool` from Mapbox (out of scope — that's the place-intelligence pipeline, KEEP on Google).

### 3.B Brand creation — `BrandCreationFlow.tsx`

**Current:** import `AddressAutocompleteInput` + `parseGooglePlaceResult`; Step 2 (`:337-371`) `onPick` → `parseGooglePlaceResult` → `setAddrMeta({lat,lng,city,countryCode,googlePlaceId})`; `persistAddress` (`:225-251`) writes `patch.{address,lat,lng,city,countryCode,googlePlaceId}` via `updateBrandMutation` → `brandMapping.ts` `google_place_id` column (`:449-450`).

**Persists to:** `brands.{address,lat,lng,city,country_code,google_place_id}`. **No dedup constraint** on brands.google_place_id (no unique index found at brand scope). This is generic-brand metadata.

**Migration recommendation:** mechanical import-swap to `MapboxAddressInput`. For `googlePlaceId`: recommend writing `null` (don't pollute the Google column with a mapbox_id) — `persistAddress:239` already guards `if (geo.googlePlaceId !== null)`, so setting it null in `onPick` cleanly omits it. All other persisted fields (`address, lat, lng, city, countryCode`) identical. **Persisted shape preserved** (google_place_id simply not written for new Mapbox-sourced brand addresses; existing brands unaffected).

### 3.C Trip wizard — `TripCreatorStep1Basics.tsx`

**Current:** import `AddressAutocompleteInput` (`:36`). Two fields: "Departing from" (`:357-377`) and "Destination" (`:383-403`). `onPick` writes `{departurePlaceId|destinationPlaceId: place.placeId, …LocationText, …Lat, …Lng}`.

**Persists to:** `events.theme.business_trip.{destinationPlaceId, destinationLocationText, destinationLat, destinationLng, departurePlaceId, …}` (JSON theme blob; `tripAdapter.ts:53` labels `theme.business_trip.destinationPlaceId` as "Destination place"). The placeId is an **opaque identifier** — no Google-specific consumer anywhere (grep shows only the wizard writes it + the adapter labels it; no edge fn or RPC reads `destination_place_id` as a Google id).

**Migration recommendation:** purely mechanical import-swap to `MapboxAddressInput`. `place.placeId` becomes a mapbox_id, stored opaquely in the same theme fields — no downstream cares. **Persisted shape preserved** (same JSON keys, same types). This is the lowest-risk surface.

### 3.D Surface risk ranking (recommended phase order)

1. **Trip** (`TripCreatorStep1Basics`) — zero dedup, opaque placeId. Lowest risk. Migrate first as the proof.
2. **Brand creation** (`BrandCreationFlow`) — generic metadata, no constraint. Low risk.
3. **Venue claim** (`VenueStep1Address`) — dedup-coupled; needs the explicit "don't overwrite the pool-derived google_place_id; write null on create-new" rule. Migrate last, with the POI caveat mitigation (§2.4) landed first if the SPEC chooses it.

---

## 4. GOOGLE RETIREMENT

### 4.1 Safe to DELETE after cutover (frontend)

- `mingla-business/src/components/event/AddressAutocompleteInput.tsx` (once all 3 importers repointed + CreatorStep3Where confirmed off it — it already is).
- `mingla-business/src/services/googlePlacesService.ts` (only `AddressAutocompleteInput` + dead `GooglePlacesAutocomplete` import it).
- `mingla-business/src/components/ui/GooglePlacesAutocomplete.tsx` — **already dead** (0 importers); delete now or at cutover.
- `mingla-business/src/utils/parseGooglePlaceResult.ts` — keep or rename provider-neutral (still useful for the venue persist mapping); if kept, drop the `googlePlaceId` field name dependency.

### 4.2 Safe to DELETE after cutover (backend)

- `supabase/functions/places-autocomplete/index.ts` — once no business surface invokes it. **Backend allowlist required (COMMS-0002):** removing a `supabase/functions/` file triggers the ORCH-0863 C7 `no-new-backend-files` gate path; the SPEC must add an `ORCH_1079_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit, modeled on the ORCH-1064/1066/1077 precedent. Also remove the `[functions.places-autocomplete]` stanza from `supabase/config.toml:31-32`.

### 4.3 `GOOGLE_MAPS_API_KEY` — **DO NOT DELETE** (enumerated consumers)

Six other LIVE edge functions consume `GOOGLE_MAPS_API_KEY` (all confirmed live + wired):

| Edge fn | Google API | Consumer | Verdict |
|---|---|---|---|
| `admin-seed-places` | `places:searchNearby` + Geocoding | place_pool seeder (admin/cron) | KEEP — seeds the consumer deck supply |
| `admin-refresh-places` | `places/{id}` details | place_pool refresh (called by admin-seed-places) | KEEP |
| `admin-place-search` | `places:searchText` | admin place search (called by admin-seed-places) | KEEP |
| `backfill-place-photos` | Place Photos | place photo backfill (referenced by score-place-photo-aesthetics) | KEEP |
| `get-companion-stops` | Google (companion stops) | `app-mobile/src/services/stopReplacementService.ts:43` — explicitly marked "remain KEEP" | KEEP — consumer feature |
| `get-picnic-grocery` | Google (grocery) | `app-mobile/src/services/stopReplacementService.ts:55` | KEEP — consumer feature |

**Conclusion: the key stays.** Only the `places-autocomplete` edge fn (the business autocomplete proxy) is retirable. The place-intelligence pipeline + consumer stop features are out of ORCH-1079 scope and continue on Google.

---

## 5. BLAST RADIUS + INVARIANTS

### 5.1 Downstream of business venue data

- **Public pages (buyer/anon web):** `brands.{address,lat,lng,city,country_code}` render on `/b/{slug}` and event pages via `publicEventsService.ts`/`brandMapping.ts`. Fields written identically → no public-page regression. `google_place_id` is exposed in `publicEventsService.ts:168/601` but is metadata, not rendered as a Google link.
- **Checkout:** venue address/geo feed ticket flows; unchanged field set.
- **Consumer deck:** business venue supply reaches the deck via `place_pool` (seeded by the Google pipeline, NOT by the address picker) → the deck is decoupled from which provider powers the address autocomplete. No deck regression from this swap.
- **Trip cards / upcoming builder:** read `theme.business_trip.*` opaquely (`upcomingBuilder.test.ts` confirms null-tolerant). No regression.

### 5.2 Cross-surface coverage (Phase 2.5 surfaces)

Business iOS + Business Android + Buyer/anon Web (business venue pickers render in the web build) — ALL covered by ORCH-1079. Consumer iOS/Android = OUT (META-ORCH-1060 already done). Admin Web = OUT (admin uses the Google place pipeline, unchanged). Each repointed surface needs per-platform sim/web verification at TEST.

### 5.3 Recommended NEW strict-grep invariants (for the SPEC)

1. `I-BIZ-VENUE-INPUT-USES-MAPBOX` — the three migrated surfaces (`VenueStep1Address`, `BrandCreationFlow`, `TripCreatorStep1Basics`) MUST import `MapboxAddressInput`/`mapboxGeocodeService` and MUST NOT import `googlePlacesService` or `AddressAutocompleteInput`.
2. `I-NO-BIZ-GOOGLE-PLACES-AUTOCOMPLETE` — after cutover, `googlePlacesService.ts` + `AddressAutocompleteInput.tsx` + `GooglePlacesAutocomplete.tsx` + the `places-autocomplete` edge fn must not exist / not be referenced from `mingla-business/`.
3. `I-GOOGLE-MAPS-KEY-RETAINED` (guard, not a deletion gate) — document that `GOOGLE_MAPS_API_KEY` stays for the 6 non-autocomplete consumers; any PR proposing its removal is P0.

### 5.4 Invariant violations check

None violated by the planned migration. The `place_pool_google_place_id_mismatch` dedup invariant (ORCH-1009 Sub-E) is PRESERVED by the §3.A rule (don't feed mapbox_id into the dedup key). Constitution #3 (no silent failures) preserved — `MapboxAddressInput` keeps the loud pick-error contract. Constitution #9 (no fabricated data) preserved.

---

## 6. FIVE-LAYER CROSS-CHECK

| Layer | Finding |
|---|---|
| **Docs** | META-ORCH-1059/1060 specs (shipped) define the shared package + drop-in contract. Mapbox Search Box docs confirm POI-by-name default (§2). |
| **Schema** | `brands.google_place_id` (no brand-level unique); `place_pool.google_place_id` unique-nonnull index + RPC dedup. `events.theme` JSON for trips. No schema change required for the swap (provider-neutral columns); google_place_id simply stops being written for new Mapbox-sourced addresses. |
| **Code** | 3 live importers of `AddressAutocompleteInput`; CreatorStep3Where already Mapbox; `GooglePlacesAutocomplete` dead. Business Mapbox wrapper is a true drop-in (prop parity verified). |
| **Runtime** | `mapbox-geocode` deployed v19 (live, COMMS-0020); event picker runs it in prod; suggest passes no `types` → POIs returned. Branch is 5 behind main (must rebase). |
| **Data** | Venue draft persists `googlePlaceId` (AsyncStorage + brands col). place_pool seeded by Google pipeline (independent of the picker). Trip placeIds opaque in theme JSON. |

No layer contradictions that block the migration. The one cross-layer subtlety (mapbox_id ≠ google_place_id at the dedup layer) is resolved by the §3.A persistence rule.

---

## 7. OUTCOME & JOURNEY STEP-BACK

**Brand's job-to-be-done:** "I want to put my venue on Mingla by typing its name/address and picking it — fast, accurate, finds my actual place."

**Journey:** open wizard (venue claim / brand create / trip) → type venue name or address → see suggestions → pick → address+geo captured → continue → publish → venue renders on public page / deck / checkout.

**Where reality could diverge:** the only divergence risk is "I typed my bar's name and it didn't show up" (POI-name search). §2 proves Mapbox returns POIs by name by default and the event picker already does this in prod, so the outcome is preserved. The §2.4 caveat (POI without `context.place` → pick fails) is the one residual friction point; the recommended fallback closes it. Fixing the import swap DOES deliver the outcome, provided the §3.A venue-dedup rule and §2.4 caveat are honored in the SPEC.

---

## 8. DISCOVERIES FOR ORCHESTRATOR

1. **Branch is 5 commits behind main and pre-dates PR #372** — the shared `@mingla/location-input` package does not exist on this branch. MUST rebase before SPEC/IMPLEMENT or the implementor will rebuild infra that already exists. (Reinforces `[[edge-deploy-and-migration-apply-hazards]]`.)
2. **`GooglePlacesAutocomplete.tsx` is dead code** (0 importers) independent of this ORCH — candidate for deletion regardless.
3. **The place-intelligence pipeline (admin-seed/refresh/place-search/backfill-photos) + consumer companion/picnic stops stay on Google.** ORCH-1079 does NOT make Mingla "Google-free" — it only de-Googles the business *address autocomplete*. If a future ORCH wants full Google removal, it must first migrate the `place_pool` seeder + consumer stop features to Mapbox (large, separate scope).
4. **Provider-naming debt:** `brands.google_place_id` / `place_pool.google_place_id` / `parseGooglePlaceResult` keep Google-specific names even as the picker goes Mapbox. Not a blocker; flag for a future naming-cleanup ORCH if desired.

---

## 9. CONFIDENCE

**HIGH.** All three remaining importers traced to source on this branch; the Mapbox target wrapper + shared package read from `origin/main`; persisted shapes traced to DB columns/RPC; the make-or-break POI-name behavior verified against live Mapbox docs AND corroborated by the in-prod event picker precedent. The single MEDIUM-confidence point is the POI-without-`context.place` 500 edge case (§2.4) — capped at MEDIUM because it depends on Mapbox's per-feature `context` population, which is data-dependent and best confirmed with a live suggest+retrieve on a few real venue names during SPEC/TEST (not blocking the migration recommendation).

---

## 10. HARD-GUARD COMPLIANCE

- Investigation only — no code modified, no spec written. ✓
- Mapbox docs URLs cited inline (COMMS-0003). ✓
- No sibling worktrees touched. ✓
- `GOOGLE_MAPS_API_KEY` deletion NOT recommended — all consumers enumerated first (§4.3). ✓
- Backend allowlist (COMMS-0002) noted for the `places-autocomplete` removal. ✓
