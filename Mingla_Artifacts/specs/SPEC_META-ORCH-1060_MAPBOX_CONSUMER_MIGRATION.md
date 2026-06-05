# SPEC — META-ORCH-1060 [Mapbox address/geocoding migration — CONSUMER LEG]

- **Mode:** mingla-forensics SPEC (binding contract; NO product code in this file)
- **Worktree:** `~/Desktop/mingla-orchs/meta-orch-1060-[mapbox-consumer-migration]/` on branch `meta-orch-1060-mapbox-consumer-migration`
- **Date:** 2026-06-04
- **Investigation input:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1060_MAPBOX_CONSUMER_MIGRATION.md` (this worktree) — read in full, every file:line dependency re-verified against current branch source before writing this spec.
- **Downstream routing:** This is a UI-touching migration. The next phase after SPEC is **mingla-designer** (consumer picker visual contract — see §11), THEN **mingla-implementor**.

---

## Layman summary (chat-grade)

The consumer app currently does address search and city lookup through **Nominatim** (free OpenStreetMap), which is rate-limited, lower quality, and forces fragile string-parsing to get state/country codes. The business app already moved its experience picker to **Mapbox** (live, proven). This spec moves the **consumer app's** address/geocoding entirely onto Mapbox, extracts the Mapbox picker into a **shared package** both apps use, and fixes a real bug: a paired friend who has only a city in their profile (no GPS) shows an empty "no recent location" state — we'll geocode that city server-side so the deck centers correctly. Profile location stays on the phone's native geocoder (free/offline) and is explicitly out of scope.

---

## 0. Locked decisions (Seth — FINAL, encoded here, do NOT reopen)

| # | Decision | Where enforced |
|---|---|---|
| **L1** | **Scope = consumer `app-mobile/` only this leg.** Business event/trip/brand Google venue pickers are NOT touched (separate fast-follow ORCH). | §2 Scope, §2.5 Cross-Surface |
| **L2** | **Clean sweep — migrate ALL consumer Nominatim call-sites to Mapbox.** Goal: ZERO Nominatim in `app-mobile/` so the strict-grep guard holds. | §3 (all surfaces), §9 INV-1 |
| **L3** | **Profile location LEFT AS-IS** — it uses the phone's native on-device geocoder (`expo-location`), NOT Nominatim. Do NOT route it through Mapbox (decision R1). | §3.4, §2 Non-goals |
| **L4** | **Phase 0 is trivial** — the `mapbox-geocode` edge fn source is already on `origin/main` (PR #342 `b9d272156`, byte-identical to deployed v19). Phase 0 = verify-source-matches-deployed + redeploy-from-main, NOT a reconciliation. | §3.0 |

---

## 1. Investigation findings this spec must honor

1. **The consumer app's ONLY Nominatim file is `app-mobile/src/services/geocodingService.ts`** (verified: `grep -rln "nominatim" app-mobile/src` → exactly one file). Both `geocodingService.autocomplete()` (Nominatim `/search`) and `geocodingService.reverseGeocode()` (Nominatim `/reverse`) live here. Re-pointing this ONE file's body de-Nominatim's every call-site at once.
2. **Profile uses the native OS geocoder, not Nominatim** — `ProfilePage.tsx` → `throttledReverseGeocode()` → `expo-location` `reverseGeocodeAsync`. The prompt's premise ("route Profile's reverse-geocode through Mapbox") targets a non-Nominatim path; per L3, Profile is OUT.
3. **The discover-city ISO state/country code parsing is REPLACEABLE, not just mitigable.** Mapbox `/retrieve` returns `properties.context.region.region_code` (ISO 3166-2) and `context.country.country_code` (ISO alpha-2) as STRUCTURED fields. BUT the current edge fn (`supabase/functions/mapbox-geocode/index.ts:228`) extracts `region.name` only — `region_code` must be ADDED. This is the keystone backend change.
4. **The `mapbox-geocode` source is already on main, byte-identical to deployed v19** (sha256 `318cc387…`). `verify_jwt=true`, reads secret `MAPBOX_ACCESS_TOKEN` (`index.ts:253`).
5. **Business importers of the to-be-shared files = 4** (investigation found 1; re-verified this turn): `mingla-business/src/components/experience/ExperienceStopsStep.tsx`, `ExperienceStopCard.tsx`, `mingla-business/src/components/event/CreatorStep3Where.tsx`, plus the component/service themselves. All must repoint after extraction.
6. **Paired-friend chain latest migration** = `20260730000004_orch_0986_friend_location_resolution_chain.sql` (resolution: GPS history → custom_lat/lng → discover_city_lat/lng → empty). Caller `supabase/functions/_shared/personHeroCards.ts:320` `resolveFriendLocation()` returns `null` when no numeric coords → hero shows empty state. The migration itself documents the deferred 4th text-fallback — META-ORCH-1060 is that follow-up.

---

## 2. Scope, Non-Goals, Assumptions

### Scope (this leg)
- **Phase 0:** verify + redeploy `mapbox-geocode` from main; add the `region_code` keystone to the edge fn (§3.0, §3.1).
- **Shared package:** extract `MapboxAddressInput` + `mapboxGeocodeService` into `packages/location-input/` consumed by BOTH apps; repoint the 4 business importers (§3.2).
- **Consumer surface migration (all 7 Nominatim call-sites):** Preferences custom-location ×2, Discover city picker, Onboarding manual-location, `useUserLocation` legacy fallback, `localeDetection` currency, DiscoverScreen night-out — all de-Nominatim'd (§3.3 / §3.5 / §3.6 / §3.7 / §3.8).
- **Paired-view 4th fallback:** server-side resolve-time forward-geocode of the friend's text `profiles.location` (§4).
- **3 strict-grep invariants** + backend allowlist update (§9).

### Non-Goals (explicitly OUT)
- **Profile location reverse-geocode (L3, decision R1).** Stays on the native OS geocoder via `throttledReverseGeocode` (`throttledGeocode.ts`). Rationale: it is free, offline-capable, already throttled/cached/deduped, serves 5 hot consumers (incl. the deck render path), and is NOT a Nominatim dependency. Routing it through Mapbox (decision R2) would add network latency + per-render Mapbox billing + lose the offline fallback to the deck path — a far larger change than "de-Nominatim," and it isn't Nominatim to begin with. **Do NOT touch `throttledGeocode.ts` or its 5 consumers.**
- **Business event/trip/brand Google venue pickers (L1).** `AddressAutocompleteInput` / `places-autocomplete` (Google) for EVENTS stay on Google this leg.
- **Buyer/anon web, Business iOS/Android, Admin web** — no consumer location surfaces (§2.5).
- **A `profiles.location_lat/lng` cache column / backfill** — explicitly deferred (§4.4); v1 uses resolve-time geocode + in-fn cache, no DB column.
- **Reverse-geocode `action` on the edge fn** — NOT needed for any in-scope surface. localeDetection + night-out are repointed to Mapbox **forward** geocode (they pass coords today, but see §3.7/§3.8 — they currently reverse-geocode coords→country; those become a Mapbox reverse via the new `reverse` action OR stay on coords→native; SPEC decision in §3.7).

### Assumptions
- `MAPBOX_ACCESS_TOKEN` Supabase secret is live (business experiences work in prod — confirmed v19 ACTIVE). No new secret provisioning needed.
- Mapbox quota covers added consumer type-ahead volume; 250ms debounce + ≥3-char gate (already in `MapboxAddressInput`) bound cost (§10).
- `app-mobile` and `mingla-business` each have their own `supabase` singleton + `Icon` + design tokens — the shared package must inject these (§3.2).

---

## 2.5 Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behavior / files / parity |
|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ YES | All 7 location surfaces use Mapbox via the shared package + repointed `geocodingService`. Parity = shared code with #2. Per-surface SC in §6. |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ YES | Identical to iOS (shared RN code). Parity AUTOMATIC. Tester must still verify the picker renders + persists on Android (SC-tagged `-Android`). |
| 3 | **Buyer/anon Web** (`mingla-business/` `/checkout`, `/e/…`, `/b/…`) | ❌ NO | No consumer location input on buyer-anon routes — they don't expose city/preferences/onboarding. |
| 4 | **Business iOS** (`mingla-business/` iOS) | ⚠️ INDIRECT | Business event/trip/brand pickers UNCHANGED (L1). The 4 EXPERIENCE importers (§3.2) repoint to the shared package — MUST render + geocode identically post-extraction (regression-only SC-7). No new behavior. |
| 5 | **Business Android** (`mingla-business/` Android) | ⚠️ INDIRECT | Same as #4. Parity AUTOMATIC (shared). Regression SC-7-Android. |
| 6 | **Admin Web** (`mingla-admin/`) | ❌ NO | Admin renders no consumer geocoding. |
| 7 | **Business Web preview** | ⚠️ INDIRECT | Experience picker via shared package; regression-only, same as #4. |

**Manual-parity note:** the consumer migration (1/2) and the business experience repoint (4/5/7) are SEPARATE code paths sharing one package. Each gets its own success criterion (§6). The implementor MUST NOT ship the consumer side while leaving a business importer broken.

---

## 3. Layer-by-layer contract

### 3.0 Phase 0 — verify + redeploy `mapbox-geocode` from main 🔒 LOCKED

**Pre-keystone (idempotent reassertion):**
1. On `origin/main`: confirm `git show origin/main:supabase/functions/mapbox-geocode/index.ts | shasum -a256` == `318cc3872a62f2234565193e6539e4912bc984e45cb9cb4d9979340227886f3f` (source present + canonical).
2. Confirm deployed `mapbox-geocode` is v19 ACTIVE, `verify_jwt:true` (via `mcp__supabase__get_edge_function`) and its content equals main's copy.
3. Do NOT copy from any sibling worktree — `main` is canonical.

**This phase does NOT redeploy from the worktree.** The keystone change (§3.1) is what gets deployed, and only AFTER it merges to main (per `[[ship-verify-merge-before-reap]]` + COMMS-0015): merge PR → confirm `origin/main` contains the squash commit + content probe of `index.ts` → THEN redeploy `mapbox-geocode` from updated main → THEN anything that depends on it.

**Ledger:** the orchestrator owns the COMMS-0020 ack (premise stale — source already on main). This spec only records the fact.

**SC-0:** Post-merge, deployed `mapbox-geocode` version increments, `verify_jwt` stays `true`, and a live `retrieve` call returns the new `regionCode` field (§3.1). `git show origin/main:…/index.ts` matches the deployed content.

---

### 3.1 Edge fn `region_code` keystone — `supabase/functions/mapbox-geocode/index.ts` 🔒 LOCKED (HIGHEST BLAST)

**Current state (verified):**
- `RetrieveContextEntry` interface (`index.ts:92-95`) has ONLY `{ name?, country_code? }` — no `region_code`.
- `retrieve` handler (`index.ts:228`) sets `region = ctx.region?.name ?? null` — name only.
- Response `details` shape (`index.ts:233-242`): `{ placeId, formattedAddress, city, region, countryCode, location:{lat,lng} }`.

**Required change (additive — does NOT remove `region` name):**
1. Extend `RetrieveContextEntry` to include `region_code?: string` and `region_code_full?: string` (Mapbox returns both on `context.region`).
2. In the `retrieve` handler, after `const region = ctx.region?.name ?? null;`, add:
   - `const regionCode = ctx.region?.region_code ? ctx.region.region_code.toUpperCase() : null;` (ISO 3166-2 subdivision part, e.g. `NC`).
   - Optionally also expose `regionCodeFull` (`ctx.region.region_code_full`, e.g. `US-NC`) — include it; harmless and future-useful.
3. Add `regionCode` (and `regionCodeFull`) to the returned `details` object. **Preserve every existing field byte-for-byte** (`region` name stays — business + the new consumer code both keep working).
4. **No change** to `suggest`, session handling, CORS, `verify_jwt`, error contract, or the `no_locality`/`no_location` honest-500 behavior.

**Mapbox docs cited inline (COMMS-0003 — MUST be in the implementor's edge-fn header + the SPEC):**
- Search Box `/retrieve` response `properties.context.region` exposes `name`, `region_code` (ISO 3166-2), `region_code_full`; `context.country` exposes `name`, `country_code` (ISO 3166-1 alpha-2), `country_code_alpha_3`; `context.place` exposes the city `name`: https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature and https://docs.mapbox.com/api/search/search-box/
- `/suggest`: https://docs.mapbox.com/api/search/search-box/#get-suggestions
- Session billing (suggest+retrieve = ONE session): https://docs.mapbox.com/api/search/search-box/#session-billing

**New response contract (`retrieve`):**
```
{ details: {
    placeId: string,
    formattedAddress: string,
    city: string,                 // required (honest 500 no_locality)
    region: string | null,        // name — PRESERVED
    regionCode: string | null,    // NEW — ISO 3166-2 subdivision (e.g. "NC")
    regionCodeFull: string | null,// NEW — e.g. "US-NC"
    countryCode: string | null,   // ISO alpha-2
    location: { lat: number, lng: number }
} }
```

**SC-1:** A live `retrieve` for a US city returns `regionCode` = the correct 2-letter ISO state (e.g. Raleigh → `NC`); for a non-US city it returns the correct ISO subdivision or `null` (never a parsed string). `region` (name) and all other fields are unchanged from v19.

**INV-keystone:** `regionCode` is read ONLY from `ctx.region.region_code` — never derived from a display string anywhere in the codebase (§9 INV-3).

---

### 3.2 Shared package extraction — `packages/location-input/` 🔒 LOCKED (structure) / 🎨 OPEN (internal wrapper shape)

**Path confirmed:** `packages/location-input/` (model on `packages/phone-input/`, the existing cross-app shared RN input precedent). Current `packages/`: brand-rendering, event-rendering, payments-native, phone-input, scripts, theme-animations.

**What moves:**
1. **`packages/location-input/src/mapboxGeocodeService.ts`** — moved from `mingla-business/src/services/mapboxGeocodeService.ts`. The service imports a concrete `./supabase` singleton (line 34); the shared version MUST receive `functions.invoke` via injection. **Token-injection approach:** export `autocompleteMapbox(query, sessionToken, { invoke })` and `retrieveMapboxPlace(placeId, sessionToken, { invoke })` where `invoke` is the app's `supabase.functions.invoke`. Each app passes its own singleton's `invoke`. (App-mobile and business have DIFFERENT `supabase` clients + DIFFERENT env tokens, but the secret `MAPBOX_ACCESS_TOKEN` is server-side in the edge fn — no client token differs; only the Supabase client differs.) Keep `newMapboxSessionToken()` and the `PlaceAutocompleteSuggestion` + `PlaceDetails` types in the package; **add `regionCode`/`regionCodeFull` to `PlaceDetails`** to match §3.1.
2. **`packages/location-input/src/MapboxAddressInput.tsx`** — moved from `mingla-business/src/components/location/MapboxAddressInput.tsx`. The 7 design tokens (`accent, glass, radius, semantic, spacing, text, typography` from `../../constants/designSystem`) + `Icon` are app-specific. **Token-injection approach (pattern (ii), matching `event-rendering`'s shim model — `feedback_eventcovermedia_shared_package.md`):** the shared component owns the suggest→retrieve state machine, debounce, dropdown, a11y, error mapping, and session-token lifecycle; it receives a `tokens` bundle + `IconComponent` (and `invoke`) via props. Each app keeps a THIN per-app wrapper that injects its tokens/Icon/invoke. **Edit the shared package, never re-fork the field.**

**Business importers to repoint (4 — re-verified this turn):**
- `mingla-business/src/components/experience/ExperienceStopsStep.tsx`
- `mingla-business/src/components/experience/ExperienceStopCard.tsx`
- `mingla-business/src/components/event/CreatorStep3Where.tsx`
- The component/service originals become thin re-export shims OR are deleted with importers repointed to the package wrapper (implementor's choice — 🎨 OPEN — but every importer above MUST compile + render + geocode unchanged).

**PlaceDetails contract (PRESERVED + extended):**
```
{ placeId, formattedAddress, city, region|null, regionCode|null, regionCodeFull|null, countryCode|null, location:{lat,lng} }
```
The 6 original fields are byte-stable; `regionCode`/`regionCodeFull` are additive.

**SC-7 (regression — Business):** After extraction, all 4 business importers render the experience address field, type-ahead returns Mapbox suggestions, pick persists the SAME `PlaceDetails` shape (city/region/countryCode/lat/lng) the business wizard wrote before. No visual or behavioral change to the experience picker. (`-Android` variant: same on Android.)

**INV-2:** Consumer location inputs import the shared `packages/location-input` picker/service — not a hand-rolled or per-app geocoder (§9 INV-2).

---

### 3.3 Consumer surface 1+2 — Preferences custom-location ×2 🔒 LOCKED

- **Files/lines:** `app-mobile/src/components/.../PreferencesSheet.tsx:641` (debounced type-ahead) + `:891` (ORCH-0943 auto-resolve-on-save fallback). Both call `geocodingService.autocomplete()` → Nominatim today.
- **Replacement:** adopt the shared `MapboxAddressInput` (suggest→retrieve) so `onPick(details: PlaceDetails)` yields exact coords + city directly. The `:891` auto-resolve-on-save fallback becomes unnecessary (the picker only fires `onPick` after a successful `retrieve`, so coords are guaranteed) — REMOVE it, or leave it as a no-op guard (implementor's choice; if removed, ensure no path can save without coords).
- **Persists UNCHANGED:** `preferences.custom_location` (text), `preferences.custom_lat`, `preferences.custom_lng` (numeric). Map `details.formattedAddress` (or `details.city` per current display convention — match the pre-migration value semantics) → `custom_location`; `details.location.lat/lng` → `custom_lat/lng`.
- **INVARIANT GUARD (I-PROPOSED-CUSTOM-COORDS-LOCKED, `i-proposed-orch-0943-custom-coords-locked.mjs`):** any `custom_lat/custom_lng` write MUST include `custom_location` in the SAME payload (or be GPS-gated). Write all three atomically. This gate MUST stay green.

**SC-2:** In Preferences, typing a city/address shows Mapbox suggestions; picking one saves `custom_location` + `custom_lat` + `custom_lng` together (verify in `preferences` row). No path writes coords without `custom_location`. The 0943 strict-grep gate passes.

---

### 3.4 Consumer surface — Profile location 🔒 LOCKED OUT (L3, decision R1)

- **Path:** `ProfilePage.tsx:239` → `throttledReverseGeocode(lat,lng)` → `throttledGeocode.ts:58` → `expo-location` `reverseGeocodeAsync` (native OS). Persists `profiles.location` (text only; no coords).
- **Contract:** **NO CHANGE.** Do NOT route through Mapbox. Do NOT touch `throttledGeocode.ts` or its 5 consumers (Profile, SwipeableCards, locationService, enhancedLocationService, enhancedLocationTrackingService). The `throttledGeocode` single-owner invariant (`reverseGeocodeAsync` appears ONLY in `throttledGeocode.ts`) MUST stay intact.
- **Why in this spec:** to make the boundary explicit so the implementor doesn't "helpfully" migrate it and so the de-Nominatim grep (§9 INV-1) understands this path was never Nominatim.

**SC-3:** `throttledGeocode.ts` is byte-unchanged; `grep -rn "reverseGeocodeAsync" app-mobile/src` returns ONLY `throttledGeocode.ts`; Profile location set/display behaves exactly as before.

---

### 3.5 Consumer surface 3 — Discover city picker 🔒 LOCKED (HIGH BLAST — parser DELETION)

- **File:** `app-mobile/src/components/discover/CityPickerSheet.tsx`.
- **Call site:** `:154` `geocodingService.autocomplete()` → Nominatim. **Replace** with the shared Mapbox picker (or repointed `geocodingService` body per §3.9) so the pick yields a `PlaceDetails` with `regionCode`/`countryCode`/`city`/`location`.
- **DELETE `parseStateCountry()` (`:85-113`) and its handler use (`:178`).** This is the prompt's explicit deletion. Today the ISO codes are parsed out of the Nominatim display string via `COUNTRY_NAME_TO_CODE` (hand-maintained) + `US_STATE_CODES` (US-only). With Mapbox structured fields this parser is dead code AND a correctness hazard.
- **DELETE the `displayName.split(",")[0]` city-token derivation (`:189-191`).** Replace with `details.city` (Mapbox `context.place.name` — the clean locality).
- **New write mapping (`:203-209`, persists to `preferences`):**
  - `discover_city_name = details.city` (was `displayName.split(",")[0]`)
  - `discover_city_state_code = details.regionCode` (was `parseStateCountry(...).stateCode` — US-only) — **now correct for all countries**
  - `discover_city_country_code = details.countryCode` (was `parseStateCountry(...).countryCode` — hand-maintained map)
  - `discover_city_lat = details.location.lat`, `discover_city_lng = details.location.lng`
- **REGRESSION RISK (call out explicitly):** `discover_city_state_code` / `discover_city_country_code` feed (a) `DiscoverScreen.tsx:1262-1271` which reconstructs the `DiscoverCity` and passes `stateCode`/`countryCode`/`lat`/`lng` to the **Ticketmaster filter**, and (b) the `events.city` EXACT-match join (ORCH-0824 hotfix-5b) — `discover_city_name` MUST equal what the business wizard writes to `events.city`. **Token parity check (HARD, at implement + test):** confirm Mapbox `context.place.name` produces the same canonical city token (e.g. `Raleigh`, `London`) that `events.city` holds — a mismatch = zero event matches. The launch-city gate (`useLaunchCityGate` / `check-launch-city`) uses live GPS, NOT these stored codes — unaffected. The paired-friend RPC reads `discover_city_lat/lng` (coords only) — unaffected by a code-format change.
- **Null-safety:** `discover_city_state_code` column is nullable; if Mapbox omits `region_code` for a feature, write `null` (TM tolerates city-only). **Do NOT resurrect display-string parsing** (INV-3).
- **Comment drift fix (low-priority, do it here):** `CityPickerSheet.tsx:5` header says "Google Places" — it's Nominatim today, Mapbox after. Update to "Mapbox Search Box".

**SC-4:** Picking a US city in Discover writes `discover_city_state_code` = correct ISO state from `regionCode` (verify Raleigh→`NC`), `discover_city_country_code` from `countryCode`, and `discover_city_name` = the clean locality that exact-matches `events.city`. `parseStateCountry` and the `split(",")[0]` derivation are deleted (grep returns zero). The TM filter and `events.city` join still return matches for a known launch city.

---

### 3.6 Consumer surface 4 — Onboarding manual-location 🔒 LOCKED

- **File/line:** `app-mobile/src/.../OnboardingFlow.tsx:973` `geocodingService.autocomplete()` → Nominatim.
- **Replacement:** repoint to Mapbox (shared picker or repointed `geocodingService` body). Persist whatever it persists today UNCHANGED in shape (verify the exact write target at implement; it feeds the same custom/discover preference columns — match existing semantics + the 0943 atomic-write guard if it writes `custom_*`).

**SC-5:** Onboarding manual-location type-ahead returns Mapbox suggestions; the picked location persists to the same column(s) with coords + text written atomically. No Nominatim call remains.

---

### 3.7 Consumer surfaces 5+6 — `localeDetection` + DiscoverScreen night-out 🔒 LOCKED (reverse paths)

These two call `geocodingService.reverseGeocode()` (Nominatim `/reverse`, coords→address/country).

- **`localeDetection.ts:60`** — `detectLocaleFromCoordinates` reverse-geocodes to a country NAME, then `getCurrencyByCountryName`. **Replacement:** route through Mapbox reverse and switch to a **country-CODE** lookup (Mapbox returns `country_code` alpha-2 directly — cleaner + more reliable than country-name matching). Implementor adds a code-based currency lookup (`getCurrencyByCountryCode`) or maps the existing table by code.
- **`DiscoverScreen.tsx:1310`** — night-out flow `geocodingService.reverseGeocode(nightOutGpsLat,lng)`. **Replacement:** Mapbox reverse; preserve whatever fields it consumes downstream (verify at implement — likely city/region for display).

**Reverse-action SPEC decision (🔒 LOCKED):** Add a `reverse` action to `mapbox-geocode` (Search Box `GET /search/searchbox/v1/reverse?longitude=&latitude=&access_token=` — **no session_token**, billed per request). Cite: https://docs.mapbox.com/api/search/search-box/ (reverse) and Geocoding v6 fallback https://docs.mapbox.com/api/search/geocoding/ . Response normalizes to the SAME `details` shape (city/region/regionCode/countryCode/location). Reuse the existing `context` extraction. **Why an edge action (not native):** these are coords→country/city for currency + night-out display, not the deck-hot Profile path; routing through the edge fn keeps the token server-side and reuses the structured-context extraction. (The deck-hot Profile path stays native per L3 — that is the distinction.)

**Backend-allowlist (COMMS-0002 / ORCH-0863 C7):** adding the `reverse` action edits `supabase/functions/mapbox-geocode/index.ts` (already an existing file, not a NEW backend file — but verify the C7 gate's `no-new-backend-files` scope; if any NEW `_shared` helper is added for the paired-view fallback (§4.5), it MUST be added to the backend allowlist in the SAME commit).

**SC-6a (locale):** With GPS in a known country, currency resolves from Mapbox `country_code` (verify GB→GBP, US→USD) — no Nominatim call.
**SC-6b (night-out):** Night-out reverse resolves city/region from Mapbox; downstream display unchanged; no Nominatim call.

---

### 3.8 Consumer surface 7 — `useUserLocation` legacy fallback 🔒 LOCKED

- **File/line:** `app-mobile/src/hooks/useUserLocation.ts:72` — when `custom_location` text exists but no coords, calls `geocodingService.autocomplete()` to re-derive coords → Nominatim.
- **Replacement:** repoint to the Mapbox **forward** geocode of the text (single-call; Search Box `/forward` or Geocoding v6 `/forward` returns coords + structured context — https://docs.mapbox.com/api/search/search-box/ , https://docs.mapbox.com/api/search/geocoding/ ). With §3.3 reliably writing coords, this fallback rarely fires, but it MUST be de-Nominatim'd to satisfy INV-1.

**SC-8:** With a `custom_location` text and null coords, `useUserLocation` resolves coords via Mapbox (no Nominatim). After §3.3, the path is exercised only as a legacy guard.

---

### 3.9 `geocodingService.ts` — re-implement body as a thin Mapbox adapter 🔒 LOCKED (seam) / 🎨 OPEN (internal impl)

- **Keep the file + its public signatures** (`autocomplete()`, `reverseGeocode()`, the 24h reverse cache, the 5min autocomplete LRU) — re-implement the BODY over the shared Mapbox service. This is the lowest-blast way to de-Nominatim every script-style caller (locale, night-out, useUserLocation fallback) at once while surfaces that adopt `MapboxAddressInput` directly (§3.3, §3.5) bypass it.
- **Adapter mapping:** `autocomplete(query)` → Mapbox suggest + lazy retrieve-on-pick (do NOT eager-retrieve top-N — that's N billed sessions); return the existing `AutocompleteSuggestion` shape `{ displayName, fullAddress, location? }`. `reverseGeocode(lat,lng)` → Mapbox `reverse` action (§3.7).
- **DELETE all Nominatim fetch code + the `nominatim.openstreetmap.org` hosts + the `User-Agent: Mingla-Mobile-App/1.0`** — zero Nominatim string left (INV-1).
- 🎨 OPEN: cache key strategy, lazy-vs-pick retrieve plumbing, internal types — implementor's craft, as long as signatures + cache TTLs are preserved.

**SC-9:** `grep -rn "nominatim" app-mobile/src` returns ZERO. `geocodingService.autocomplete()` / `.reverseGeocode()` keep their signatures + cache behavior; all callers compile unchanged.

---

## 4. Paired-view 4th fallback (absorbs the "no recent location" bug) 🔒 LOCKED

### 4.1 Current chain (latest migration confirmed)
`get_paired_friend_last_location(p_viewer_id, p_friend_id)` — latest def `20260730000004_orch_0986_friend_location_resolution_chain.sql`. Order: (1) recent `user_location_history` GPS → (2) `preferences.custom_lat/lng` → (3) `preferences.discover_city_lat/lng` → else empty. **Consent gate** (active `pairings` row, either direction) inside the RPC. Caller `personHeroCards.ts:320` `resolveFriendLocation()` returns `null` on no numeric coords → hero empty state. `personHeroCards.ts` runs with the **service-role admin client** (no end-user JWT) and does NOT read `profiles.location` today.

### 4.2 Decision — geocode-at-RESOLVE-time, server-side (recommended, LOCKED)
Add the 4th fallback in `personHeroCards.ts` (NOT a DB column / NOT the client). Justification vs write-time:
- **No client change** (locked-scope goal satisfied) — write-time would force a client change at `ProfilePage.tsx:253` `update({ location })`, exactly what the scope avoids.
- **No new column / no backfill** — works for ALL existing friends immediately.
- **Matches the migration's own documented plan** (`…0004…sql:13-15` defers exactly this text-geocode to a follow-up).
- Honors intent: the hero shows the friend's CITY text; geocoding that exact text centers recs where the hero says.

### 4.3 Exact injection point + contract
In `personHeroCards.ts`, after `resolveFriendLocation()` returns `null`:
1. Read `profiles.location` (text) for `friendId` via the admin client.
2. If non-empty, forward-geocode it via a NEW `_shared/mapboxGeocode.ts` server helper (§4.5) → `{lat,lng}`.
3. Return that as the resolved center. **Best-effort:** on geocode failure or empty text, fall back to the existing `null` → `missing` state (Constitution #3 — never fabricate a location).

### 4.4 NO new DB column for v1 (deferred)
Do NOT add `profiles.location_lat/lng` or any backfill. If Mapbox call volume later proves a problem, a write-time cache is a fast-follow ORCH — NOT this leg. v1 = resolve-time + in-fn cache (§4.6).

### 4.5 Consent gate + server-callability (LOCKED)
- **Consent:** the text-fallback is reached ONLY after the consent-checked RPC returns (the RPC already gated GPS/custom/discover behind the active-pairing check). To be safe, the SPEC REQUIRES the text-fallback path execute ONLY when the prior `get_paired_friend_last_location` call (which enforces consent) was made for this `(viewerId, friendId)` pair and returned (i.e. do not geocode `profiles.location` for any friend whose RPC did not pass the consent gate). Do NOT add a separate un-gated read path.
- **Server-to-server Mapbox call:** `personHeroCards.ts` runs with the service-role admin client and CANNOT call the `verify_jwt=true` edge fn the way the client does. **Approach (LOCKED):** extract the Mapbox forward call into a NEW `supabase/functions/_shared/mapboxGeocode.ts` helper that calls Mapbox directly server-to-server (reads `MAPBOX_ACCESS_TOKEN`, hits Search Box `/forward` — https://docs.mapbox.com/api/search/search-box/ / Geocoding v6 `/forward` — https://docs.mapbox.com/api/search/geocoding/ ), returning `{lat,lng}|null`. `personHeroCards.ts` imports it. This keeps the token server-side, no auth gymnastics, same secret. (Do NOT add an internal/service-auth bypass to the JWT'd edge fn.)
- **Backend allowlist:** the NEW `_shared/mapboxGeocode.ts` (and any change to `personHeroCards.ts`) MUST be added to the META-ORCH-1060 backend allowlist in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit (COMMS-0002 / ORCH-0863 C7).

### 4.6 Caching (LOCKED)
To avoid repeat geocoding of the same text on every paired-view resolve, cache the `text → {lat,lng}` result in-process inside the `_shared/mapboxGeocode.ts` helper (a module-scoped Map with a bounded size + TTL, e.g. ≤500 entries / 24h). No DB. Edge-fn cold starts reset it — acceptable.

**SC-10:** A paired friend whose `profiles.location` is a non-empty city text and who has NO GPS/custom/discover coords now resolves a non-empty center (hero shows recs, not the empty state). A non-paired friend NEVER triggers the geocode (consent preserved). Geocode failure → graceful `missing` state (no crash, no fabricated location). Repeat resolves for the same text hit the cache (≤1 Mapbox call per distinct text per TTL window).

---

## 5. Mapbox docs — consolidated citations (COMMS-0003)

- Search Box `/suggest`: https://docs.mapbox.com/api/search/search-box/#get-suggestions
- Search Box `/retrieve` (structured `context.region.region_code`, `region_code_full`, `context.country.country_code`, `context.place.name`): https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature , https://docs.mapbox.com/api/search/search-box/
- Search Box `/reverse` (no session_token, per-request billing): https://docs.mapbox.com/api/search/search-box/
- Search Box `/forward` (single-call forward geocode): https://docs.mapbox.com/api/search/search-box/
- Geocoding API v6 `/forward` + `/reverse` (fallback engine, structured context): https://docs.mapbox.com/api/search/geocoding/
- Session billing (suggest+retrieve = ONE session; reverse/forward/category per-request): https://docs.mapbox.com/api/search/search-box/#session-billing

**Coverage verdict (investigation §5, re-affirmed):** Mapbox meets or exceeds Nominatim for the consumer use — structured ISO codes are strictly better than display-string parsing (which only resolved US states + a hand-maintained country map). Street-level quality is already proven in the business experience picker (v19, prod).

---

## 6. Success Criteria (consolidated, observable/testable/per-surface)

| SC | Surface | Criterion |
|---|---|---|
| SC-0 | Backend | Post-merge, `mapbox-geocode` redeployed from main; version increments; `verify_jwt:true`; live `retrieve` returns `regionCode`. |
| SC-1 | Backend | `retrieve` returns correct ISO `regionCode` (Raleigh→`NC`) from `ctx.region.region_code`; all v19 fields preserved. |
| SC-2 / -Android | Consumer iOS/Android | Preferences custom-location uses Mapbox; saves `custom_location`+`custom_lat`+`custom_lng` atomically; 0943 gate green. |
| SC-3 | Consumer | Profile untouched; `reverseGeocodeAsync` only in `throttledGeocode.ts`; behavior identical. |
| SC-4 / -Android | Consumer iOS/Android | Discover city writes correct `discover_city_state_code` from `regionCode`, `country_code` from `countryCode`, city token exact-matches `events.city`; `parseStateCountry` + `split(",")[0]` deleted; TM filter + city join still return matches. |
| SC-5 | Consumer | Onboarding manual-location on Mapbox; persists same column(s) atomically; no Nominatim. |
| SC-6a/6b | Consumer | locale currency from Mapbox `country_code`; night-out reverse from Mapbox; downstream unchanged; no Nominatim. |
| SC-7 / -Android | Business iOS/Android/web | All 4 experience importers render + geocode unchanged via the shared package; `PlaceDetails` shape stable. |
| SC-8 | Consumer | `useUserLocation` fallback resolves coords via Mapbox forward; no Nominatim. |
| SC-9 | Consumer | `grep -rn "nominatim" app-mobile/src` = ZERO; `geocodingService` signatures + caches preserved. |
| SC-10 | Backend | Paired friend with text-only location resolves a center; non-paired never geocoded; failure → graceful `missing`; cache caps Mapbox calls. |

---

## 7. Invariants this change must preserve

| INV | Description | How preserved | Test |
|---|---|---|---|
| I-PROPOSED-CUSTOM-COORDS-LOCKED | `custom_lat/lng` write must include `custom_location` or be GPS-gated (`i-proposed-orch-0943-custom-coords-locked.mjs`) | §3.3 writes all 3 atomically | T-02 |
| ORCH-0986 paired-profile gate | `orch-0986-paired-profile.mjs` | §4 keeps consent inside the RPC; no un-gated read | T-10b |
| `throttledGeocode` single-owner | `reverseGeocodeAsync` only in `throttledGeocode.ts` | §3.4 leaves it untouched | T-03 |
| ORCH-0824 events.city exact-match | discover city token == `events.city` | §3.5 uses Mapbox `context.place.name`; token-parity verified | T-04b |
| COMMS-0002 / ORCH-0863 C7 backend allowlist | new/changed `supabase/functions/*` files in allowlist same commit | §3.7 / §4.5 allowlist update | T-CI |
| COMMS-0003 external-API-docs | Mapbox URLs cited inline at SPEC + in edge-fn header | §5 + §3.1 | review |

---

## 8. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Keystone happy | `retrieve` Raleigh mapbox_id | `details.regionCode="NC"`, `countryCode="US"`, all v19 fields present | Edge fn |
| T-01b | Keystone non-US | `retrieve` London | `regionCode`=ISO subdivision or `null` (never parsed string), `countryCode="GB"` | Edge fn |
| T-01c | Keystone region omitted | feature with no `region.region_code` | `regionCode=null` (no throw, no parse) | Edge fn |
| T-02 | Prefs atomic write | pick city in Preferences | `custom_location`+`custom_lat`+`custom_lng` all set | Hook+DB |
| T-02b | Prefs guard (adversarial) | attempt save with coords, no text | rejected/impossible — 0943 gate green | Strict-grep |
| T-03 | Profile untouched | set profile location | native geocoder used; `throttledGeocode.ts` unchanged; grep proves single owner | Component |
| T-04 | Discover US codes | pick Raleigh | `discover_city_state_code="NC"`, `country_code="US"`, name="Raleigh" | Full stack |
| T-04b | events.city parity (adversarial) | pick a launch city w/ live events | TM filter + `events.city` join return matches (token parity) | Service+DB |
| T-04c | Parser deleted | grep | `parseStateCountry` + `split(",")[0]` city derivation absent | Static |
| T-05 | Onboarding | pick manual location | persists same column(s) atomically; no Nominatim | Full stack |
| T-06a | Locale currency | GPS in GB | currency=GBP from `country_code` | Service |
| T-06b | Night-out reverse | GPS coords | city/region from Mapbox; display unchanged | Service |
| T-07 | Business regression | open experience picker (4 importers) | renders + geocodes + persists unchanged | Component (business) |
| T-08 | useUserLocation fallback | custom_location text, null coords | coords from Mapbox forward; no Nominatim | Hook |
| T-09 | No Nominatim | `grep -rn nominatim app-mobile/src` | ZERO | Static |
| T-10 | Paired text fallback (happy) | friend w/ text-only `profiles.location`, no coords | hero resolves center, shows recs | Edge fn |
| T-10b | Paired consent (adversarial) | non-paired friend with text location | NO geocode; `missing` state; consent preserved | Edge fn |
| T-10c | Paired geocode fail | friend text geocode returns nothing | graceful `missing`, no crash, no fabricated coords | Edge fn |
| T-10d | Paired cache | resolve same text twice | ≤1 Mapbox call per distinct text per TTL | Edge fn |
| T-CI | Backend allowlist | CI run | C7 `no-new-backend-files` green (allowlist updated) | CI |

**Implementor happy-path test paths (Step 0.5 contract):** unit-test the edge-fn `retrieve` `regionCode` extraction with a documented Mapbox response mock (T-01/01b/01c); a `_shared/mapboxGeocode.ts` forward-geocode unit test with a documented `/forward` mock (T-10/10c/10d); a discover-write mapping test asserting columns sourced from structured fields (T-04). **Tester adversarial angles:** (1) keystone — codes MUST come from structured fields, never a string; feed a feature whose display string would parse to a DIFFERENT/absent code and assert the stored code follows `region_code`, not the string (T-01c + T-04c). (2) paired-view — a non-paired friend with a tempting `profiles.location` text MUST NOT be geocoded (consent breach test, T-10b); a geocode failure MUST degrade to `missing` not fabricate (T-10c).

---

## 9. Strict-grep invariants (3 NEW) + exact patterns

> Backend-allowlist note (COMMS-0002 / ORCH-0863 C7): the edge-fn `region_code` + `reverse` changes (§3.1/§3.7) and the NEW `_shared/mapboxGeocode.ts` (§4.5) MUST be added to a `META_ORCH_1060_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit as the backend change, modeled on the ORCH-1064/1066 precedent.

**INV-1 — `I-CONSUMER-LOCATION-NO-NOMINATIM`** (new gate file `.github/scripts/strict-grep/i-consumer-location-no-nominatim.mjs`)
- **FORBID** (case-insensitive) any of these strings anywhere under `app-mobile/src`: `nominatim`, `nominatim.openstreetmap.org`, `Mingla-Mobile-App/1.0` (the Nominatim User-Agent).
- **Match scope:** all `app-mobile/src/**/*.{ts,tsx}`.
- **Pass condition:** zero matches.

**INV-2 — `I-CONSUMER-LOCATION-USES-SHARED-MAPBOX`** (gate file `.github/scripts/strict-grep/i-consumer-location-uses-shared-mapbox.mjs`)
- **REQUIRE:** the consumer location entry points (`geocodingService.ts` + the consumer picker wrapper) import from `packages/location-input` (or `@mingla/location-input`). Pattern: presence of `from "@mingla/location-input"` / `from ".*packages/location-input"` in `app-mobile/src/services/geocodingService.ts` and the consumer `MapboxAddressInput` wrapper.
- **FORBID:** a hand-rolled fetch to any geocoding host (`/search?` Nominatim, raw `api.mapbox.com`) inside `app-mobile/src` outside the shared package import — consumer code must go through the package/service seam, never a direct provider call.
- **Pass condition:** required import present AND no direct provider fetch in consumer location files.

**INV-3 — `I-DISCOVER-CITY-CODES-FROM-MAPBOX-CONTEXT`** (gate file `.github/scripts/strict-grep/i-discover-city-codes-from-mapbox-context.mjs`)
- **FORBID** in `app-mobile/src/components/discover/CityPickerSheet.tsx` (and anywhere in `app-mobile/src`): the identifier `parseStateCountry`, the `COUNTRY_NAME_TO_CODE`/`US_STATE_CODES` parse tables used for code derivation, and the pattern `\.split\(["']\s*,\s*["']\)\[0\]` used to derive a city token for `discover_city_name`.
- **REQUIRE:** `discover_city_state_code` / `discover_city_country_code` assignments are sourced from a `regionCode` / `countryCode` field (the structured `PlaceDetails`), not a string parse. Pattern: `discover_city_state_code:` immediately fed by `.regionCode`; `discover_city_country_code:` fed by `.countryCode`.
- **Pass condition:** forbidden parse identifiers absent AND structured-field assignment present.

---

## 10. Mapbox billing / session-token lifecycle (LOCKED)

- **Suggest+retrieve = ONE billed session** per `session_token`. The shared `mapboxGeocodeService.newMapboxSessionToken()` mints one UUID per typing session, reused across suggest→retrieve, rotated after a completed pick (the business `MapboxAddressInput:140` already does this). **Confirm the shared package preserves this lifecycle** — the consumer surfaces inherit it automatically by using the shared component/service.
- **Reverse/forward = per-request** (no session token) — used by §3.7 (locale, night-out) and §4 (paired-view) + §3.8 (useUserLocation fallback). These are infrequent (not per-keystroke), so per-request billing is acceptable.
- **Cost guardrails:** 250ms debounce + ≥3-char gate (already in `MapboxAddressInput`) bound the type-ahead suggest cost; the consumer surfaces inherit these by using the shared component.

---

## 11. Visual & UX contract — handoff to mingla-designer (REQUIRED)

This SPEC owns the FUNCTIONAL contract + the UX acceptance bar. The granular visual contract for the consumer picker is produced by **mingla-designer** before implementation. The designer DESIGN doc MUST pin (for the consumer Mapbox picker embedded in CityPickerSheet, PreferencesSheet, OnboardingFlow):

- **Color:** exact `app-mobile/src/constants/designSystem` tokens for field/dropdown/row/border/icon + every state (default/focus/press/disabled/error/selected), light AND dark, with computed contrast ratios (body ≥ 4.5:1).
- **Typography, spacing/placement (4px-grid tokens), safe-area/edge, sheet vs field boundary** (the shared piece is the inline FIELD + dropdown; the consumer SHEET chrome — e.g. CityPicker's `rgba(20,22,26,0.98)` dark canvas — stays per-surface).
- **All 9 states with Mingla-voice copy** (loading/error/empty/populated/submitting/offline/first-time/returning/degraded) — including the existing consumer copy "Couldn't reach city search. Tap to try again." (`CityPickerSheet.tsx:160`) and "This city couldn't be resolved." (`:174`) preserved or improved.
- **Motion + haptics**, `prefers-reduced-motion` fallback.
- **No-AI-slop bans** + a "References examined" line.

**Acceptance bar (LOCKED, designer fills the granular tokens):** the consumer picker must visually match the consumer sheet idiom (NOT the business design tokens — the shared component receives consumer tokens via injection, §3.2); zero regression in the CityPicker/Preferences/Onboarding sheet chrome; the dropdown must be reachable, scrollable, and dismissible inside each host sheet.

---

## 12. Implementation order

1. **Edge fn keystone** (§3.1) — add `region_code`/`region_code_full` to `mapbox-geocode` retrieve + types. Add `reverse` action (§3.7). Add `_shared/mapboxGeocode.ts` forward helper (§4.5). Update backend allowlist (§9). Unit tests T-01*.
2. **Shared package** (§3.2) — create `packages/location-input/` (service + component with injection); add `regionCode`/`regionCodeFull` to `PlaceDetails`. Repoint the 4 business importers; verify SC-7.
3. **`geocodingService.ts` adapter** (§3.9) — re-implement body over the shared Mapbox service; delete all Nominatim. (Unblocks de-Nominatim for script-style callers.)
4. **Consumer pickers** (§3.3, §3.5, §3.6) — Preferences, Discover (delete parser + split derivation, wire structured codes), Onboarding → shared picker.
5. **Reverse/forward consumers** (§3.7, §3.8) — locale (code-based currency), night-out, useUserLocation fallback.
6. **Paired-view fallback** (§4) — wire `personHeroCards.ts` to the forward helper with consent guard + cache.
7. **Strict-grep gates** (§9) — add 3 gate files + workflow jobs.
8. **Profile** (§3.4) — verify untouched (no edit; assertion only).
9. **Merge → verify origin/main → redeploy `mapbox-geocode` from main → THEN reap** (§3.0, COMMS-0015).

---

## 13. Regression prevention

- **Class:** silent provider/code-derivation drift. **Safeguard:** INV-1/2/3 strict-grep gates lock de-Nominatim, shared-package usage, and structured-code sourcing in CI permanently.
- **Class:** atomic custom-coords write. **Safeguard:** the existing 0943 gate stays green (§3.3).
- **Class:** edge-fn drift / orphaned deploy. **Safeguard:** §3.0 + COMMS-0015 — deploy from merged main only, content-probe before reap.
- **Protective comments:** the edge-fn keystone block must carry the Mapbox `region_code` doc URL + a "codes are structured, never parsed" note; `personHeroCards.ts` text-fallback must carry the consent-gate + best-effort-degrade note.

---

## Confidence

- **§3.0 / §3.1 keystone:** proven (edge-fn source read in full; `RetrieveContextEntry` confirmed lacks `region_code`; Mapbox docs cited).
- **§3.2 importers (4):** proven (re-grepped this turn — ExperienceStopsStep, ExperienceStopCard, CreatorStep3Where + component/service).
- **§3 surfaces + single-Nominatim-file:** proven (`grep -rln nominatim app-mobile/src` = 1 file).
- **§4 paired fallback:** proven for chain/caller/consent/admin-client constraint; resolve-time + server helper is a design judgment (high confidence), honoring locked scope (no client change, no column).
- **§3.4 Profile-out (R1):** proven (native OS geocoder path read; L3 locked).
