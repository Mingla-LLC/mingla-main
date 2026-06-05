# SPEC — ORCH-1079 [Business-venue Google→Mapbox sweep]

**Mode:** SPEC (binding contract — no code)
**Worktree:** `~/Desktop/mingla-orchs/orch-1079-[business-venue-mapbox-sweep]/` on branch `orch-1079-business-venue-mapbox-sweep` (rebased onto `origin/main`; `packages/location-input/` + the shared business `MapboxAddressInput`/`mapboxGeocodeService` wrappers PRESENT — verified `git log` HEAD `ab934a811`).
**Date:** 2026-06-05
**Author:** mingla-forensics+claude
**Primary input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1079_BUSINESS_VENUE_MAPBOX_SWEEP.md` (this worktree). Every file:line below was re-verified against live source on this branch.
**Downstream routing:** mingla-implementor (NO designer — reuses the already-shipped Mapbox picker UI; no new visual contract).
**Comms-ledger acks (this turn):** COMMS-0002 (backend allowlist required in the same commit as a `supabase/functions/` change — encoded in §3.D.4 + §6), COMMS-0003 (external-API docs URLs cited inline — Mapbox Search Box URLs in §2 + §3.D). Both factored.

---

## 0. Layman summary

Mingla Business currently uses Google's address autocomplete on three screens: claiming a venue, adding a brand's venue address, and setting a trip's start/end. The shared Mapbox address picker (the one the event venue screen already uses in production) is a drop-in replacement with an identical prop signature. This spec repoints those three screens to Mapbox, deletes the now-dead Google autocomplete plumbing (but KEEPS the Google API key — six other backend jobs still use it), and adds CI gates so the Google path can't sneak back. The one real risk is the venue-claim screen, where a Google place id is used as a dedup key against a Google-seeded database; the spec pins an exact guard so a Mapbox id never poisons that key.

---

## 1. Scope, Non-Goals, Assumptions

### 1.1 Scope (exactly this)

Repoint THREE business surfaces from `AddressAutocompleteInput` / `googlePlacesService` to the existing business Mapbox wrapper `mingla-business/src/components/location/MapboxAddressInput.tsx` + `mingla-business/src/services/mapboxGeocodeService.ts` (both thin shims over `@mingla/location-input`):

1. **Venue claim** — `mingla-business/src/components/venue/VenueStep1Address.tsx` (Ve1 wizard Step 1).
2. **Brand creation** — `mingla-business/src/components/brand/BrandCreationFlow.tsx` (Step 2 venue address).
3. **Trip creator** — `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` (departure + destination fields).

Plus: resolve the §2.4 POI-without-derivable-city 500 (one-line edge-fn fallback, §3.D.1); retire the Google autocomplete path (frontend component + service + dead duplicate + the `places-autocomplete` edge fn + its `config.toml` stanza, §3.D); add 3 strict-grep invariants (§7); add `ORCH_1079_BACKEND_ALLOWLIST` (§6).

### 1.2 Non-Goals (explicitly NOT this ORCH)

- **`CreatorStep3Where.tsx` (event venue picker)** — ALREADY on Mapbox via the shared package (`:37-38` imports `MapboxAddressInput` + `PlaceDetails` from `mapboxGeocodeService`). DO NOT TOUCH. Verified: it does NOT import `googlePlacesService`.
- **Deleting `GOOGLE_MAPS_API_KEY`** — FORBIDDEN (P0). Six other live edge functions consume it (§3.D.3). The key STAYS.
- **Re-seeding `place_pool` from Mapbox** — out of scope. The place-intelligence pipeline (`admin-seed-places` / `admin-refresh-places` / `admin-place-search` / `backfill-place-photos`) stays on Google. This ORCH de-Googles the business *address autocomplete only*, not the supply pipeline.
- **Renaming `brands.google_place_id` / `place_pool.google_place_id` DB columns** — provider-naming debt deferred (Discovery #4; future naming-cleanup ORCH). No schema change in this ORCH.
- **Consumer apps (`app-mobile/`)** — already migrated by META-ORCH-1060. OUT.

### 1.3 Assumptions (proven in the investigation)

- A1. The business `MapboxAddressInput` prop signature is byte-identical to `AddressAutocompleteInput`: `{ value, onChangeText, onPick(details: PlaceDetails), onClear, error?, placeholder?, accessibilityLabel? }`. **Verified** (`MapboxAddressInput.tsx:40-48` vs `AddressAutocompleteInput`). The swap is import + handler-body-identical (with the per-surface `placeId`/`googlePlaceId` nuance below).
- A2. The Mapbox `PlaceDetails` shape is a structural superset of Google's: every field the business surfaces read (`placeId`, `formattedAddress`, `city`, `region`, `countryCode`, `location.{lat,lng}`) is present and same-typed. The only semantic difference: `placeId` is a `mapbox_id`, not a Google place id. **Verified** (investigation §2.5).
- A3. `mapbox-geocode` is deployed live (v19, COMMS-0020 RESOLVED) and its `suggest` call passes NO `types` filter, so POIs/businesses resolve by name today. **Verified** (`mapbox-geocode/index.ts handleSuggest` — no `types` param).

---

## 2. The gating risk — Mapbox POI / business-NAME search (LOCKED constraint #4)

**VERDICT: ADEQUATE. Venue-name search does NOT regress vs Google.** The implementor MUST NOT add a `types` restriction to the suggest call.

### 2.1 Mapbox docs (cited inline per COMMS-0003)

- Search Box `/suggest` returns "not only addresses, but also points of interest (POIs), categories of POIs, street names, neighborhoods, localities, place names, districts, postcodes, regions, and countries." — https://docs.mapbox.com/api/search/search-box/#get-suggestions
- `types` default = ALL types (POI included): "If no types are specified, all possible types may be returned." — https://docs.mapbox.com/api/search/search-box/#get-suggestions
- `poi` is an explicit `types` value in the full set (`country, region, postcode, district, place, city, locality, neighborhood, street, address, poi, category`). — https://docs.mapbox.com/api/search/search-box/#get-suggestions
- Retrieve context object structure (city/region/country derivation): https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
- Session billing (suggest+retrieve = one session per `session_token`): https://docs.mapbox.com/api/search/search-box/#session-billing

### 2.2 🔒 LOCKED — keep the suggest call filter-free

`supabase/functions/mapbox-geocode/index.ts handleSuggest()` builds `GET /search/searchbox/v1/suggest?q=…&session_token=…&access_token=…&limit=5` with **no `types` parameter**. The implementor MUST NOT add `types=address` (or any `types` value) to this call — doing so would exclude POIs and regress venue-name search. This is asserted by strict-grep INV-3 (§7).

### 2.3 §2.4 fallback — see §3.D.1 (POI-without-derivable-city).

---

## 3. Per-surface contracts

For each surface: current code (file:line), persisted DB/store shape, the exact before→after, success criteria, and ≥1 test case. Phase order is **Trip → Brand → Venue** (riskiest last), per LOCKED constraint #7 (§5).

> **Cross-cutting LOCKED rule (applies to all 3 surfaces):** the swap is import + handler-body-identical EXCEPT the `placeId`/`googlePlaceId` handling pinned per surface below. Do NOT change copy, placeholders, layout, store keys, JSON theme keys, mutation payloads, or RPC arguments other than what each contract names. The UI is the already-shipped Mapbox picker — no new visual contract.

---

### 3.A Surface 1 (Phase 1) — Trip creator · `TripCreatorStep1Basics.tsx` (LOWEST RISK)

**Current (file:line):**
- Import: `import { AddressAutocompleteInput } from "../event/AddressAutocompleteInput";` (`:36`). No `parseGooglePlaceResult`; no `googlePlacesService` `PlaceDetails` import (uses inferred `place` callback type).
- Field A "Departing from" (`:357-377`): `onPick` writes `{ departurePlaceId: place.placeId, departureLocationText: place.formattedAddress, departureLat: place.location.lat, departureLng: place.location.lng }`.
- Field B "Destination" (`:383-403`): symmetric for `destination*`.

**Persists to (traced):** `events.theme.business_trip.{departurePlaceId, departureLocationText, departureLat, departureLng, destinationPlaceId, destinationLocationText, destinationLat, destinationLng}` — a JSON theme blob. `tripAdapter.ts:53` labels `theme.business_trip.destinationPlaceId` as "Destination place." **The placeId is an OPAQUE identifier** — grep confirms NO edge fn / RPC / consumer reads `*_place_id` as a Google id; only the wizard writes it and the adapter labels it. No dedup, no constraint.

**Before → After:**
- Change import (`:36`) to `import { MapboxAddressInput } from "../location/MapboxAddressInput";`.
- Replace both `<AddressAutocompleteInput .../>` JSX tags with `<MapboxAddressInput .../>`. **Handler bodies UNCHANGED** — `place.placeId` now carries a `mapbox_id`, stored opaquely in the same `*PlaceId` theme keys.

**Persisted shape:** IDENTICAL JSON keys + types. `departurePlaceId`/`destinationPlaceId` now hold a `mapbox_id` string (was a Google place id string) — same type, same key, no downstream consumer cares (opaque). **Preserved.**

**Success criteria:**
- **SC-1 (LOCKED):** Both trip fields render the Mapbox dropdown and resolve a venue/city BY NAME and by address (e.g. typing "Tulum" and typing a hotel name both produce pickable suggestions).
- **SC-1a (LOCKED):** On pick, `theme.business_trip.departurePlaceId` / `destinationPlaceId` are populated with the chosen feature's `mapbox_id`; `*LocationText`/`*Lat`/`*Lng` populated from the same `PlaceDetails`.
- **SC-1b (LOCKED):** On clear, all four `departure*` (or `destination*`) keys reset to `null` (unchanged behavior).

**Test cases:**

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1A | Trip destination pick (happy) | type "Tulum", pick first suggestion | `destinationPlaceId` = mapbox_id, `destinationLocationText`/`Lat`/`Lng` set; Continue ungated | Component + service |
| T-1B | Trip departure clear | pick then clear | all four `departure*` keys = `null` | Component |
| T-1C | No Google importer remains | `grep AddressAutocompleteInput\|googlePlacesService` in `TripCreatorStep1Basics.tsx` | 0 hits | Static (strict-grep INV-1) |

---

### 3.B Surface 2 (Phase 2) — Brand creation · `BrandCreationFlow.tsx` (LOW RISK)

**Current (file:line):**
- Imports: `AddressAutocompleteInput` (`:44`), `parseGooglePlaceResult` (`:45`), `PlaceDetails` from `googlePlacesService` (`:46`).
- Step 2 (`:337-371`): `onPick(details: PlaceDetails)` → `const p = parseGooglePlaceResult(details)` → `setAddress(p.formattedAddress)` + `setAddrMeta({ lat, lng, city, countryCode, googlePlaceId: p.googlePlaceId })`. `onChangeText` + `onClear` both null out `lat/lng/city/countryCode/googlePlaceId`.
- `persistAddress` (`:225-251`) writes `patch.{address,lat,lng,city,countryCode,googlePlaceId}` via `updateBrandMutation` → `brandMapping.ts:449-450` `google_place_id` column. **`persistAddress:239` guards `if (geo.googlePlaceId !== null)`** — so a null `googlePlaceId` is cleanly OMITTED from the patch.

**Persists to (traced):** `brands.{address, lat, lng, city, country_code, google_place_id}`. **No brand-level unique constraint on `google_place_id`** (grep: no brands-scope unique index). This is generic brand metadata.

**Before → After:**
- Import (`:44`) → `import { MapboxAddressInput } from "../location/MapboxAddressInput";`.
- Import (`:46`) → `import type { PlaceDetails } from "../../services/mapboxGeocodeService";` (or keep importing the type from the shared package via the wrapper re-export `import { type PlaceDetails } from "../location/MapboxAddressInput"`).
- Replace `parseGooglePlaceResult` usage per §3.D.5 (rename to provider-neutral OR inline) — see decision in §3.D.5.
- Replace `<AddressAutocompleteInput>` with `<MapboxAddressInput>` (`:337`).
- **🔒 LOCKED — `googlePlaceId` handling:** In `onPick`, set `googlePlaceId: null` (do NOT write `details.placeId` / the mapbox_id into the Google column). All other fields (`address` ← `p.formattedAddress`, `lat`, `lng`, `city`, `countryCode`) are written identically. Because `persistAddress:239` skips a null `googlePlaceId`, the brand's `google_place_id` column is simply not written for Mapbox-sourced addresses. Existing brands are unaffected (their stored value is untouched).

**Persisted shape:** `address, lat, lng, city, country_code` written identically. `google_place_id` NOT written for new Mapbox-sourced brand addresses (column stays NULL, which it already was for skipped/free-text brands). **Preserved** — no column dropped, no type change, no constraint affected.

**Rationale (LOCKED):** stuffing a `mapbox_id` into `brands.google_place_id` would (a) mislabel provider data and (b) risk a future false-positive if any code ever joins `brands.google_place_id` to `place_pool.google_place_id`. Writing null is the safe, shape-preserving choice.

**Success criteria:**
- **SC-2 (LOCKED):** Brand Step 2 address field renders the Mapbox dropdown; resolves a venue/business BY NAME and by address; Continue stays gated until a real pick (the existing `onChangeText` null-out gate behavior is preserved).
- **SC-2a (LOCKED):** On pick, the brand persists `address/lat/lng/city/country_code` from the Mapbox `PlaceDetails`; `google_place_id` is NOT written (stays NULL for the new brand).
- **SC-2b (LOCKED):** Skip-address path (no pick) still creates a brand with NULL geo (unchanged).

**Test cases:**

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-2A | Brand address pick (happy) | type a bar name, pick | `brands.address/lat/lng/city/country_code` set from Mapbox; `brands.google_place_id` NULL | Component + service + DB |
| T-2B | mapbox_id never enters google column | pick any Mapbox POI | assert the `setAddrMeta`/patch payload has `googlePlaceId === null` (NOT `details.placeId`) | Component (unit) |
| T-2C | Free-text then Continue gated | type without picking | Continue disabled; geo meta all null | Component |
| T-2D | No Google importer remains | grep `AddressAutocompleteInput\|googlePlacesService\|parseGooglePlaceResult` in `BrandCreationFlow.tsx` | 0 hits | Static (INV-1) |

---

### 3.C Surface 3 (Phase 3) — Venue claim · `VenueStep1Address.tsx` (HIGHEST CARE — dedup hazard)

**Current (file:line):**
- Imports: `parseGooglePlaceResult` (`:13`), `AddressAutocompleteInput` (`:15`), `PlaceDetails` from `googlePlacesService` (`:16`).
- `onPick` (`:43-53`): `const p = parseGooglePlaceResult(details)` → `patch({ formattedAddress, googlePlaceId: p.googlePlaceId, lat, lng, city, countryCode })` into `useDraftVenueStore`.
- `onClear` (`:54-63`): nulls `formattedAddress/googlePlaceId/lat/lng/city/countryCode`.

**Persists to (traced):**
- `draftVenueStore` (AsyncStorage `mingla-business-draft-venue-v1`): `googlePlaceId: string|null` (`:29`), plus `placePoolId: string|null` (`:22`).
- On submit → `VenueCreatorWizard.tsx:174-195` `createVenue.mutateAsync({ …googlePlaceId: st.googlePlaceId, placePoolId: st.placePoolId … })` → `brandsService.createVenueBrandPendingReview` (`brandsService.ts:357-381`) → RPC `biz_create_venue_brand_authoring(p_google_place_id, …, p_place_pool_id)`.
- **DB:** `brands.google_place_id` (`20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql:377` inserts `v_google`).

**🟠 THE DEDUP HAZARD (root concern — LOCKED constraint #3).** The RPC (`…sub_e…:311-325`):
```
v_google := nullif(trim(coalesce(p_google_place_id, '')), '');   -- :311
IF p_place_pool_id IS NOT NULL THEN                               -- :313
  SELECT p.google_place_id INTO v_pool_google FROM place_pool p
    WHERE p.id = p_place_pool_id AND p.is_active;                 -- :317
  IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
    RAISE EXCEPTION 'place_pool_google_place_id_mismatch';        -- :325
  END IF;
END IF;
```
`place_pool.google_place_id` is Google-seeded (unique-nonnull index `idx_place_pool_google_place_id_nonnull_unique`). A Mapbox `mapbox_id` will NEVER equal it. Two paths:

- **Claim-an-existing-pool-row path (`placePoolId != null`).** Set when the operator accepts a pool-match card at the Ve2 gate via `prefillDraftFromPoolMatch` (`prefillDraftFromPoolMatch.ts:15` sets `placePoolId: match.id`; `:20` sets `googlePlaceId: match.googlePlaceId` — i.e. the draft's `googlePlaceId` is sourced FROM the Google-seeded pool row, NOT from the address picker). The RPC then REQUIRES `v_google == place_pool.google_place_id`. **If the Mapbox address re-pick in Step 1 overwrites `draftVenueStore.googlePlaceId` with a `mapbox_id` (or null), the claim RPC throws `place_pool_google_place_id_mismatch` and the venue claim fails.** This is the highest-risk failure mode.
- **Create-new venue path (`placePoolId == null`).** The RPC dedup branch is skipped; `google_place_id` is stored as free metadata. Sending a `mapbox_id` here pollutes `brands.google_place_id` with a non-Google id.

**🔒 LOCKED guard (the exact rule the implementor MUST implement):**

> In `VenueStep1Address.tsx onPick`, the Mapbox address pick MUST patch **only** `formattedAddress`, `lat`, `lng`, `city`, `countryCode` into `draftVenueStore`. It MUST NOT write `googlePlaceId` at all (neither `details.placeId` nor a forced value).
>
> - **Claim path:** the pool-derived `googlePlaceId` (set earlier by `prefillDraftFromPoolMatch`) is thereby PRESERVED — the address re-pick refines the displayed address/geo without clobbering the dedup key. The claim RPC still receives the correct Google place id and the `place_pool_google_place_id_mismatch` invariant holds.
> - **Create-new path:** `draftVenueStore.googlePlaceId` retains its initial value `null` (`draftVenueStore.ts:55` default) → RPC stores NULL (matching today's "" → null behavior). No `mapbox_id` ever reaches `google_place_id`.

**Implementation note (LOCKED):** the current `onPick` (`:43-53`) writes `googlePlaceId: p.googlePlaceId` — DELETE that key from the patch object. The current `onClear` (`:54-63`) nulls `googlePlaceId` — that is ALSO unsafe on the claim path because clearing the field would wipe the pool-derived key. **🔒 LOCKED:** `onClear` MUST NOT null `googlePlaceId` either; it patches only `formattedAddress/lat/lng/city/countryCode` to null. (The pool-derived key survives a field clear; if the operator wants to abandon a pool match they reset the wizard, which resets `placePoolId` + `googlePlaceId` together — that reset path is unchanged.)

**Before → After:**
- Import (`:13`) — replace `parseGooglePlaceResult` per §3.D.5.
- Import (`:15`) → `import { MapboxAddressInput } from "../location/MapboxAddressInput";`.
- Import (`:16`) → `import type { PlaceDetails } from "../../services/mapboxGeocodeService";` (or via the wrapper re-export).
- JSX `<AddressAutocompleteInput>` → `<MapboxAddressInput>` (`:40`).
- `onPick` (`:43-53`): patch `{ formattedAddress, lat, lng, city, countryCode }` ONLY — NO `googlePlaceId`.
- `onClear` (`:54-63`): patch `{ formattedAddress:"", lat:null, lng:null, city:null, countryCode:null }` ONLY — NO `googlePlaceId`.

**Persisted shape:** `brands.{address(via formattedAddress→location_text), lat, lng, city, country_code}` written identically. `google_place_id` = the pool-derived Google id on the claim path (preserved) OR NULL on create-new (preserved). **No mapbox_id ever lands in `google_place_id`.** Schema unchanged.

**Success criteria:**
- **SC-3 (LOCKED):** Venue-claim Step 1 renders the Mapbox dropdown; resolves a venue BY NAME and by address.
- **SC-3a (LOCKED — the dedup guard):** On the **claim path** (`placePoolId != null`), after re-picking an address in Step 1, `draftVenueStore.googlePlaceId` STILL equals the pool row's `google_place_id` (unchanged by the pick) → `biz_create_venue_brand_authoring` succeeds (NO `place_pool_google_place_id_mismatch`).
- **SC-3b (LOCKED):** On the **create-new path** (`placePoolId == null`), after picking a Mapbox address, `draftVenueStore.googlePlaceId === null` → RPC stores `brands.google_place_id = NULL` (no mapbox_id).
- **SC-3c (LOCKED):** Clearing the address field does NOT null `draftVenueStore.googlePlaceId` (pool-derived key survives).

**Test cases:**

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-3A | **Claim-path dedup (CRITICAL)** | accept a pool-match card (sets `placePoolId` + pool `googlePlaceId`), then re-pick a Mapbox address in Step 1, submit | RPC `biz_create_venue_brand_authoring` returns success; `draftVenueStore.googlePlaceId` unchanged == pool id; NO `place_pool_google_place_id_mismatch` | Component + store + RPC |
| T-3B | Create-new path | no pool match; pick a Mapbox venue; submit | `draftVenueStore.googlePlaceId === null`; `brands.google_place_id` NULL; no mapbox_id stored | Component + store + DB |
| T-3C | onPick never writes googlePlaceId | unit: call `onPick(mapboxDetails)` with a seeded pool `googlePlaceId` | store `googlePlaceId` unchanged (NOT overwritten, NOT set to `details.placeId`) | Component (unit) |
| T-3D | onClear preserves googlePlaceId | unit: seed pool `googlePlaceId`, call `onClear` | store `googlePlaceId` unchanged; `formattedAddress/lat/lng/city/countryCode` null | Component (unit) |
| T-3E | No Google importer remains | grep in `VenueStep1Address.tsx` | 0 hits for `AddressAutocompleteInput\|googlePlacesService` | Static (INV-1) |

---

### 3.D Google retirement (LOCKED constraint #6)

#### 3.D.1 🔒 LOCKED — §2.4 POI-without-derivable-city fallback (CHOSEN resolution)

**Problem (verified, `mapbox-geocode/index.ts:251-255`):**
```
const city = ctx.place?.name ?? ctx.locality?.name ?? ctx.district?.name ?? null;
if (!city) { return { error: "no_locality" }; }
```
A POI feature whose Mapbox `context` lacks `place`/`locality`/`district` returns HTTP 500 `no_locality` → the user picks a real venue and the pick fails with the loud "Couldn't fetch address details. Tap to try again." error.

**🔒 CHOSEN resolution (extend the fallback chain — do NOT relax to nullable, do NOT add a `types` filter):**
Extend the city derivation to add `ctx.region?.name` as a last-resort locality:
```
const city =
  ctx.place?.name ?? ctx.locality?.name ?? ctx.district?.name ?? ctx.region?.name ?? null;
```
Rationale: (a) keeps `PlaceDetails.city` non-null (the business `PlaceDetails.city: string` typing and the Google contract are both preserved — no downstream nullability ripple); (b) a region name ("Quintana Roo", "Greater London") is a sensible human-readable locality fallback for a POI Mapbox couldn't place in a city; (c) one-line, behavior-additive — a feature that previously 500'd now resolves, and a feature that previously resolved is unaffected (the new branch only fires when the prior three are all null). Cite the context object structure: https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature

**🟠 Cross-surface blast (LOCKED — must be tested):** `mapbox-geocode` is SHARED with the consumer app (META-ORCH-1060) and the event venue picker. Adding a region fallback changes the `city` value returned for the (rare) POI-without-place case across ALL consumers. This is acceptable (a region string is strictly better than a 500), but the change MUST land with a unit test (T-4A) and the implementor MUST confirm no consumer reads `city` expecting a strict city-level value (grep `PlaceDetails.city` consumers — the consumer discover-city path derives codes from `region_code`, not `city` name, per `i-discover-city-codes-from-mapbox-context.mjs`, so the region fallback does not disturb code derivation).

**Touches `supabase/functions/mapbox-geocode/index.ts`** → requires `ORCH_1079_BACKEND_ALLOWLIST` (§6).

#### 3.D.2 Frontend deletions (after the 3 surfaces are repointed)

- `mingla-business/src/components/event/AddressAutocompleteInput.tsx` — DELETE (once all 3 importers repointed; `CreatorStep3Where` already off it). Verify 0 importers before delete.
- `mingla-business/src/services/googlePlacesService.ts` — DELETE (only `AddressAutocompleteInput` + the dead `GooglePlacesAutocomplete` import it).
- `mingla-business/src/components/ui/GooglePlacesAutocomplete.tsx` — DELETE (already dead, 0 importers; deletion regardless).

#### 3.D.3 🔒 LOCKED — `GOOGLE_MAPS_API_KEY` STAYS (do NOT delete)

Six other LIVE edge functions consume it. Any PR proposing its removal is P0 (asserted by INV-2 guard, §7):

| Edge fn | Role | Verdict |
|---|---|---|
| `admin-seed-places` | place_pool seeder | KEEP |
| `admin-refresh-places` | place_pool refresh | KEEP |
| `admin-place-search` | admin place search | KEEP |
| `backfill-place-photos` | place photo backfill | KEEP |
| `get-companion-stops` | consumer companion stops (`app-mobile/.../stopReplacementService.ts:43`) | KEEP |
| `get-picnic-grocery` | consumer picnic grocery (`…:55`) | KEEP |

#### 3.D.4 Backend deletions (after cutover) — `places-autocomplete` ONLY

- DELETE `supabase/functions/places-autocomplete/index.ts` (once no business surface invokes it).
- REMOVE the `[functions.places-autocomplete]` stanza from `supabase/config.toml:31-32`. (Note: `supabase/config.toml` is NOT under `supabase/functions/` or `supabase/migrations/`, so editing it does NOT trip the C7 gate — but the DELETED `places-autocomplete/index.ts` path IS under `supabase/functions/` and WILL appear in `git diff --name-only`, so it MUST be allowlisted — §6.)
- **🔒 LOCKED (COMMS-0002):** because this ORCH changes files under `supabase/functions/` (deletes `places-autocomplete/index.ts`, modifies `mapbox-geocode/index.ts`), the SAME commit MUST add `ORCH_1079_BACKEND_ALLOWLIST` to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` listing both paths (§6), modeled on the ORCH-1064/1066/1077 precedent. Verified: C7's `forbidden` filter (`orch-0863…mjs:1897-1902`) flags ANY changed path (added OR deleted) under those two prefixes unless `ALLOWLIST.includes(p)`.

#### 3.D.5 🔒 LOCKED — `parseGooglePlaceResult` decision

`parseGooglePlaceResult.ts` is a pure provider-agnostic mapper EXCEPT its output field name `googlePlaceId` and its `import type { PlaceDetails } from "../services/googlePlacesService"`. Decision: **RENAME** `mingla-business/src/utils/parseGooglePlaceResult.ts` → `parseVenuePlaceResult.ts`, rename the export `parseGooglePlaceResult` → `parseVenuePlaceResult`, change its `PlaceDetails` import to `../services/mapboxGeocodeService` (or `@mingla/location-input`), and rename the `ParsedVenuePlace.googlePlaceId` field to `placeId` (opaque). Update its test file `__tests__/parseGooglePlaceResult.test.ts` → `parseVenuePlaceResult.test.ts` under `[TEST-MOD-APPROVED ORCH-1079]`.
- **Brand surface (§3.B):** may keep using the renamed mapper for `formattedAddress/lat/lng/city/countryCode`, then explicitly set `googlePlaceId: null` in `setAddrMeta` (the mapper's `placeId` output is IGNORED for persistence).
- **Venue surface (§3.C):** may use the renamed mapper for `formattedAddress/lat/lng/city/countryCode` ONLY; the mapper's `placeId` output MUST NOT be written to `draftVenueStore.googlePlaceId` (per §3.C LOCKED guard).
- (Inlining the 5-field map instead of keeping a helper is an acceptable 🎨 OPEN alternative — see §10.)

---

## 4. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behavior / files / parity |
|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | **OUT** | Already migrated by META-ORCH-1060. The §3.D.1 `mapbox-geocode` region-fallback DOES reach consumer (shared edge fn) — covered by T-4A + the no-disturb grep. |
| 2 | Consumer Android | **OUT** | Same as #1. |
| 3 | Buyer/anon Web (`mingla-business/` web build) | **COVERED (indirect)** | The 3 venue pickers render in the business web/preview build; the Mapbox wrapper + `mapbox-geocode` work on web (event picker already proves it). Public pages `/b/{slug}`, `/e/{brand}/{event}` render `brands.{address,lat,lng,city,country_code}` written identically → no public-page regression. `google_place_id` is exposed in `publicEventsService.ts:168/601` as metadata (not rendered as a Google link) → unaffected. |
| 4 | Business iOS (`mingla-business/` iOS) | **COVERED** | All 3 surfaces. Manual per-platform sim verification at TEST (SC-1/2/3). |
| 5 | Business Android (`mingla-business/` Android) | **COVERED** | All 3 surfaces. Parity is AUTOMATIC (shared RN component + shared edge fn) — but TEST must still confirm the Mapbox dropdown renders + picks on Android emulator (SC-1/2/3 per platform). |
| 6 | Admin Web (`mingla-admin/`) | **OUT** | Admin uses the Google place-intelligence pipeline (seed/refresh/search), which this ORCH does NOT touch (stays on Google). |
| 7 | Business Web preview | **COVERED** | Same code path as #3/#4; the dev/web build renders the same wrapper. |

**Manual-parity per-surface success criteria** (because business iOS + Android are separate runtime targets even though the code is shared): SC-1/2/3 each split into `-iOS` and `-Android` at TEST. "Code is the same" is NOT a valid skip — the tester runs each surface on both platforms (per Constitution parity rule).

---

## 5. Implementation order (LOCKED — Trip → Brand → Venue, constraint #7)

1. **Phase 0 — §3.D.1 edge fallback first.** Land the `mapbox-geocode` city-fallback (`+ ctx.region?.name`) + its unit test + `ORCH_1079_BACKEND_ALLOWLIST` entry for `mapbox-geocode/index.ts`. This de-risks the POI-without-city pick failure BEFORE any surface depends on it. (Deploy of the edge fn is the orchestrator's deploy carve-out at CLOSE; the source + allowlist land in-PR.)
2. **Phase 1 — Trip** (`TripCreatorStep1Basics.tsx`) — lowest risk, opaque placeId. Proves the swap.
3. **Phase 2 — Brand** (`BrandCreationFlow.tsx`) — generic metadata, `googlePlaceId: null`.
4. **Phase 3 — Venue** (`VenueStep1Address.tsx`) — the dedup guard (§3.C LOCKED). Riskiest, last.
5. **Phase 4 — Retirement** — delete the 3 frontend files (§3.D.2) + `places-autocomplete` edge fn + `config.toml` stanza (§3.D.4) + rename the mapper (§3.D.5).
6. **Phase 5 — Gates** — add the 3 strict-grep scripts + workflow jobs (§7) + finalize `ORCH_1079_BACKEND_ALLOWLIST` (§6).

Each phase is independently buildable; do NOT delete the Google component (§3.D.2) until all 3 importers are repointed (Phase 4 gates on Phases 1-3).

---

## 6. Backend allowlist (COMMS-0002 — LOCKED)

In the SAME commit that touches `supabase/functions/`, add to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`:

1. A new const near the other allowlists (e.g. after `ORCH_1080_BACKEND_ALLOWLIST`):
```js
// ORCH-1079 [Business-venue Google→Mapbox sweep]. C7 is scoped to ORCH-0863
// marketing; these backend touches are the business-venue Mapbox sweep:
// the POI-without-city region fallback on the shared mapbox-geocode edge fn
// and the RETIRED places-autocomplete proxy (a DELETED path still appears in
// `git diff --name-only`, so it must be allowlisted). A future close that
// drops these allowlists should re-scope C7 to fire only on `Close ORCH-0863`.
const ORCH_1079_BACKEND_ALLOWLIST = [
  "supabase/functions/mapbox-geocode/index.ts",
  "supabase/functions/places-autocomplete/index.ts",
];
```
2. Spread it into the `ALLOWLIST` array (alongside the other `...ORCH_*_BACKEND_ALLOWLIST` spreads, ~line 1889).

Verified mechanism: `mapbox-geocode/index.ts` is already present in `META_ORCH_1059_BACKEND_ALLOWLIST`, so a duplicate is harmless (the array is a union via `.includes()`) — listing it again under ORCH-1079 is explicit ownership and acceptable. `places-autocomplete/index.ts` is NOT currently allowlisted, so its DELETION will trip C7 without this entry.

Run the full gate locally before push: `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → expect `OK [C7: no-new-backend-files]`.

---

## 7. NEW strict-grep invariants (3 — LOCKED, constraint #8)

Each is a standalone `.github/scripts/strict-grep/*.mjs` with a `--self-test` mode (model: `i-consumer-location-uses-shared-mapbox.mjs`), registered as a workflow job in `.github/workflows/strict-grep-mingla-business.yml` (self-test step + run step, model: the ORCH-1075/1076 job blocks at `:2120-2136`).

### INV-1 · `i-biz-venue-input-uses-mapbox.mjs` — `I-BIZ-VENUE-INPUT-USES-MAPBOX`
- **REQUIRE:** each of `mingla-business/src/components/venue/VenueStep1Address.tsx`, `mingla-business/src/components/brand/BrandCreationFlow.tsx`, `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` imports `MapboxAddressInput` from a `components/location/MapboxAddressInput` path. Pattern: `/import\s*\{[^}]*\bMapboxAddressInput\b[^}]*\}\s*from\s*["'][^"']*location\/MapboxAddressInput["']/`.
- **FORBID** in those 3 files: any import of `AddressAutocompleteInput`, `googlePlacesService`, or `parseGooglePlaceResult`. Patterns: `/\bAddressAutocompleteInput\b/`, `/googlePlacesService/`, `/parseGooglePlaceResult/`.
- **Pass:** all 3 require-imports present AND zero forbidden tokens in all 3 files. Exit 0/1/2; self-test with good+bad fixtures.

### INV-2 · `i-no-biz-google-places-autocomplete.mjs` — `I-NO-BIZ-GOOGLE-PLACES-AUTOCOMPLETE`
- **FORBID existence:** `mingla-business/src/components/event/AddressAutocompleteInput.tsx`, `mingla-business/src/services/googlePlacesService.ts`, `mingla-business/src/components/ui/GooglePlacesAutocomplete.tsx`, `supabase/functions/places-autocomplete/index.ts` MUST NOT exist (`fs.existsSync === false` for each).
- **FORBID reference:** zero matches for `/places-autocomplete/` or `/googlePlacesService/` anywhere under `mingla-business/src/` (so the edge fn can't be re-invoked and the service can't be re-imported). Walk `mingla-business/src/` `.ts`/`.tsx`.
- **GUARD (not a deletion gate) — `GOOGLE_MAPS_API_KEY` retained:** assert the string `GOOGLE_MAPS_API_KEY` STILL appears in at least one of the 6 keep-list edge fns (e.g. `supabase/functions/admin-seed-places/index.ts`) — if it vanishes everywhere, FAIL with "GOOGLE_MAPS_API_KEY removed — P0, 6 consumers depend on it (ORCH-1079 §3.D.3)." This makes accidental key removal a red CI gate.
- **Pass:** the 4 files absent AND zero `mingla-business/src` references AND the key still present in the keep-list. Exit 0/1/2; self-test.

### INV-3 · `i-mapbox-suggest-no-types-filter.mjs` — `I-MAPBOX-SUGGEST-NO-TYPES-FILTER`
- **Target:** `supabase/functions/mapbox-geocode/index.ts`.
- **FORBID:** the `suggest` request must NOT pass a `types` parameter (which would exclude POIs and regress venue-name search, §2.2). Pattern: FAIL if a `types=` (or `searchParams.set("types"` / `&types=`) token appears in the `handleSuggest` request construction. Detector: `/\btypes\s*[=:]\s*["'`]?(address|poi|place|category)/` OR `/searchParams\.(set|append)\(\s*["']types["']/` OR `/[?&]types=/` within the file → FAIL.
- **Pass:** no `types` filter token present in `mapbox-geocode/index.ts`. Exit 0/1/2; self-test (good = no types; bad = `&types=address`).

**Workflow registration (LOCKED):** add three jobs (or three steps in one job) to `.github/workflows/strict-grep-mingla-business.yml`, each with a `--self-test` step then the run step, e.g.:
```yaml
      - name: Self-test ORCH-1079 biz-venue-uses-mapbox gate
        run: node .github/scripts/strict-grep/i-biz-venue-input-uses-mapbox.mjs --self-test
      - name: Run ORCH-1079 biz-venue-uses-mapbox gate
        run: node .github/scripts/strict-grep/i-biz-venue-input-uses-mapbox.mjs
```
(repeat for INV-2, INV-3). Update the registered-gates comment block at the top of the workflow.

---

## 8. Invariants preserved / established

**Preserved:**
- `place_pool_google_place_id_mismatch` dedup (META-ORCH-1009 Sub-E) — PRESERVED by the §3.C LOCKED guard (never feed a mapbox_id into the dedup key; never null the pool-derived key on a Step-1 re-pick/clear). Test: T-3A/T-3C/T-3D.
- Constitution #3 (no silent failures) — `MapboxAddressInput` keeps the loud pick-error contract (`BUSINESS_COPY.pickError`). The §3.D.1 fallback REDUCES (not hides) failures.
- Constitution #9 (no fabricated data) — region-name fallback is real Mapbox data, not invented.
- `I-CONSUMER-LOCATION-USES-SHARED-MAPBOX` (META-ORCH-1060) — untouched; consumer files not edited.

**Established (NEW):** `I-BIZ-VENUE-INPUT-USES-MAPBOX` (INV-1), `I-NO-BIZ-GOOGLE-PLACES-AUTOCOMPLETE` (INV-2), `I-MAPBOX-SUGGEST-NO-TYPES-FILTER` (INV-3) — register in `INVARIANT_REGISTRY.md` at CLOSE.

---

## 9. Step 0.5 — Regression-test plan (implementor happy-path + tester adversarial)

**Implementor (happy-path, must pass before handoff):**
- T-1A, T-2A, T-3A (the three surface pickers resolve by name + persist correctly).
- T-3A specifically: drive the claim path end-to-end (accept a pool match → re-pick a Mapbox address in Step 1 → submit) and assert the RPC succeeds (NO `place_pool_google_place_id_mismatch`). This is the make-or-break for the dedup guard.
- T-4A: `mapbox-geocode` unit test feeding a POI-without-`context.place` fixture → asserts `city === ctx.region.name` (not a 500). Add under `supabase/functions/__tests__/` (allowlisted).
- Full strict-grep run green (INV-1/2/3 self-tests + C7).

**Tester (adversarial, must pass for verdict):**
- **A-1 (dedup poisoning attempt):** seed a draft via a pool match (placePoolId + pool googlePlaceId), then re-pick a DIFFERENT Mapbox venue in Step 1, submit → MUST still succeed with the ORIGINAL pool google id (prove the mapbox_id never reached `googlePlaceId`; inspect store + the RPC arg + `brands.google_place_id`).
- **A-2 (create-new pollution attempt):** create-new venue (no pool match), pick a Mapbox POI, submit → `brands.google_place_id` MUST be NULL (assert via DB read; prove no mapbox_id stored).
- **A-3 (clear wipes key):** seed pool key, clear the Step-1 field → store `googlePlaceId` MUST be unchanged (T-3D).
- **A-4 (POI without city):** retrieve a real Mapbox POI whose context lacks place/locality/district (or a fixture) → pick succeeds with region fallback, no 500 (T-4A live-fire on sim).
- **A-5 (types-filter regression):** confirm typing a bar/venue NAME (not an address) returns pickable POI suggestions on all 3 surfaces (proves the no-`types` LOCK held).
- **A-6 (per-platform parity):** A-1..A-5 on business iOS sim AND business Android emulator AND the business web build (venue pickers render on web).
- **A-7 (Google fully retired):** confirm `places-autocomplete` is uninvokable (deleted) and no `mingla-business/src` file references it or `googlePlacesService` (INV-2 green); confirm `GOOGLE_MAPS_API_KEY` still present in the keep-list edge fns.

---

## 10. 🎨 OPEN (handed to implementor craft)

- Whether to keep the renamed `parseVenuePlaceResult` helper or inline the 5-field map per surface (§3.D.5) — either is acceptable as long as the LOCKED `googlePlaceId` handling holds.
- Exact const ordering / comment wording in the allowlist + workflow registered-gates comment block (must be present + accurate, but prose is yours).
- Regex tightening in the 3 gate scripts beyond the minimum patterns named (must catch the named cases + self-test, but you may harden against more).
- Whether INV-1/2/3 are three separate workflow jobs or three steps in one job (both valid; self-test + run for each is LOCKED).
- The exact unit-test fixture shape for T-4A (must exercise POI-without-place → region fallback).

**Everything else is 🔒 LOCKED:** the 3 target files, the drop-in swap, the `placeId`/`googlePlaceId` per-surface handling, the venue dedup guard (onPick + onClear), the §3.D.1 region fallback (not nullable, not a `types` filter), the `places-autocomplete`-only retirement, `GOOGLE_MAPS_API_KEY` retention, the no-`types` suggest LOCK, the backend allowlist, the 3 invariants, the phase order, persisted-shape preservation on every surface.

---

## 11. Hard-guard compliance

- SPEC only — no code modified. ✓
- Mapbox docs URLs cited inline (COMMS-0003) — §2.1, §3.D.1. ✓
- No sibling worktrees touched. ✓
- `GOOGLE_MAPS_API_KEY` retained (§3.D.3) + guarded by INV-2. ✓
- Venue `google_place_id` dedup preserved (§3.C LOCKED guard + T-3A/A-1). ✓
- POI-without-city fallback specified with test (§3.D.1 + T-4A). ✓
- Google-retirement scope exact: `places-autocomplete` edge fn only; key stays (§3.D). ✓
- 3 strict-grep patterns + `ORCH_1079_BACKEND_ALLOWLIST` (§6, §7). ✓
- Phase order Trip → Brand → Venue (§5). ✓
- All 3 surfaces contracted with persisted-shape preservation (§3.A/B/C). ✓
- No designer phase (reuses shipped picker UI) — route straight to mingla-implementor.
