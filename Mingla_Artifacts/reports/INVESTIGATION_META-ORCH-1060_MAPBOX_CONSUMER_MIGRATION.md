# INVESTIGATION — META-ORCH-1060 [Mapbox address/geocoding migration — CONSUMER LEG]

- **Mode:** mingla-forensics INVESTIGATE (migration-mapping; no product code, no spec, no migrations written, no deploys)
- **Worktree:** `~/Desktop/mingla-orchs/meta-orch-1060-[mapbox-consumer-migration]/` on branch `meta-orch-1060-mapbox-consumer-migration`
- **Date:** 2026-06-04
- **Locked scope (Seth):** (1) CONSUMER `app-mobile/` only — do NOT touch business event/trip/brand Google pickers; (2) PROFILE = provider-swap only, no new manual-edit/autocomplete UI; (3) paired-friend view resolves the recommendation center from the friend's CITY text when they have no coordinates.
- **COMMS ledger:** read on entry. No BLOCK rows addressed to me / META-ORCH-1060. Factored: **COMMS-0003** (cite provider docs URLs inline — done throughout), **COMMS-0015/0018/0020** (source-drift class — directly relevant to Phase 0), **COMMS-0020** (context, NOT re-created — and its premise is now stale; see §1).

---

## TL;DR for the orchestrator

- **Phase 0 is essentially already done.** COMMS-0020's premise ("`mapbox-geocode` source does not exist on main") is **STALE**. The source landed on `origin/main` via PR #342 (`b9d272156`, META-ORCH-1059) and is **byte-identical** (sha256 `318cc387…`) to the deployed v19 and to all three sibling worktrees. Phase 0 collapses to a 10-minute verify-and-redeploy-from-main, not a reconciliation.
- **The prompt's surface map has two material inaccuracies** (verified against current code): (a) the consumer app uses **THREE** geocoding paths, not one — Nominatim forward-autocomplete, Nominatim reverse-geocode, AND the **native OS geocoder** (`expo-location`); (b) **Profile does NOT use Nominatim** — it uses the native OS geocoder via `throttledReverseGeocode`. The "route Profile's GPS reverse-geocode through Mapbox" task, as written, targets a path that isn't Nominatim. This changes the Profile recommendation (see §3c).
- **The high-blast discover-city ISO state/country-code parsing risk is SOLVED by Mapbox, not just mitigated.** Mapbox returns `context.region.region_code` (ISO 3166-2, e.g. "NC") and `context.country.country_code` (ISO alpha-2) as **structured fields** — the fragile `parseStateCountry()` display-string parsing can be deleted. BUT the current edge fn does not yet extract `region_code`; it must be added.
- **The blast radius is wider than the prompt's 3 surfaces.** There are **7** consumer geocode call-sites across **9** files (Preferences ×2, CityPicker, Onboarding manual-location, useUserLocation legacy fallback, DiscoverScreen night-out, localeDetection). All four `geocodingService.autocomplete()` callers and both `geocodingService.reverseGeocode()` callers must be accounted for.
- **Paired-view 4th fallback:** geocode-at-resolve-time inside the RPC's caller (`personHeroCards.ts` → `mapbox-geocode` server-side) is the right call. Zero client changes, consent gate stays in the RPC. (Details + the alternative weighed in §4.)

---

## Phase 0 ingest summary

- Read COMMS ledger (entries COMMS-0001…0020). COMMS-0020 is the Phase-0 anchor; COMMS-0008/0009/0010/0015/0018 establish the recurring "deployed-edge-source-only-in-worktree" class.
- Read the canonical Mapbox client trio: `supabase/functions/mapbox-geocode/index.ts` (282 ln), `mingla-business/src/services/mapboxGeocodeService.ts` (121 ln), `mingla-business/src/components/location/MapboxAddressInput.tsx` (320 ln) — all on this branch and on `origin/main`.
- Read the consumer geocoding stack in full: `app-mobile/src/services/geocodingService.ts` (374 ln), `app-mobile/src/utils/throttledGeocode.ts` (143 ln), `CityPickerSheet.tsx` (425 ln), `useUserLocation.ts` (178 ln), the `PreferencesSheet.tsx` autocomplete sites, `ProfilePage.tsx` location handler, `OnboardingFlow.tsx` manual-location autocomplete, `localeDetection.ts`, `DiscoverScreen.tsx` discover-city + night-out sites, `LaunchCityPicker.tsx`.
- Read the paired-friend chain: migration `20260730000004_orch_0986_friend_location_resolution_chain.sql` (confirmed the **latest** of three; supersedes `…0002` + `…0003`), and the caller `supabase/functions/_shared/personHeroCards.ts`.
- External research: Mapbox Search Box API + Geocoding API v6 docs fetched and cited inline (§5).

---

## 1. PHASE-0 DRIFT RECONCILIATION — RESOLVED (premise stale)

### 1a. Sibling copies are byte-identical to each other

```
318cc3872a62f2234565193e6539e4912bc984e45cb9cb4d9979340227886f3f  ORCH-1076-[paid-readiness…]/supabase/functions/mapbox-geocode/index.ts   (282 ln)
318cc3872a62f2234565193e6539e4912bc984e45cb9cb4d9979340227886f3f  ORCH-1077-[notification-deeplink…]/…/mapbox-geocode/index.ts            (282 ln)
318cc3872a62f2234565193e6539e4912bc984e45cb9cb4d9979340227886f3f  META-ORCH-1076-Phase-2-[paystack…]/…/mapbox-geocode/index.ts           (282 ln)
```

All three sibling copies share one sha256. `find ~/Desktop/mingla-orchs -path '*/mapbox-geocode/index.ts'` returns no other copies.

### 1b. The canonical source is ALREADY ON main (COMMS-0020 premise is stale)

🔵 **Observation (corrects COMMS-0020).** Evidence from the anchor checkout (`/Users/sethogieva/Desktop/mingla-main`):

- `git cat-file -e origin/main:supabase/functions/mapbox-geocode/index.ts` → **exists on origin/main**.
- `git show origin/main:…/mapbox-geocode/index.ts | shasum -a256` → `318cc387…` — **byte-identical** to the three siblings.
- `git log origin/main --oneline -- …/mapbox-geocode/index.ts` → added by `b9d272156 META-ORCH-1059 [experiences-business-parity] … (#342)`.
- `git merge-base --is-ancestor b9d272156 origin/main` → **YES** (it's in origin/main history).

Why COMMS-0020 saw "not found": the `ls supabase/functions/mapbox-geocode/` it ran on the anchor returned "No such file" only because the **anchor working tree was checked out to a non-main commit** at scan time (HEAD `4e089c68c`, this branch's tip), not because the file is absent from main. The committed `origin/main` tree contains it.

### 1c. Deployed v19 matches the source verbatim

`mcp__supabase__get_edge_function("mapbox-geocode")` → `version:19, status:ACTIVE, verify_jwt:true, entrypoint supabase/functions/mapbox-geocode/index.ts`. The returned `files[0].content` is **character-for-character identical** to `origin/main`'s copy (compared in full). (`ezbr_sha256` is Supabase's bundle hash, not the file hash — content equality confirmed by direct comparison, not by that field.)

### 1d. Phase-0 recommendation (DESIGN only — do not execute here)

The reconciliation is already satisfied on `main`. Phase 0 collapses to **verify-then-redeploy-from-main**:

1. Confirm on `origin/main`: `git show origin/main:supabase/functions/mapbox-geocode/index.ts | shasum -a256` == `318cc387…` (proves source present + canonical).
2. Redeploy `mapbox-geocode` **from merged main** (per `[[ship-verify-merge-before-reap]]` + COMMS-0015), so the live v19 is provably sourced from the repo, not an orphan. Source is unchanged → redeploy is a no-op-content reassertion (safe).
3. **Do NOT** copy from any sibling worktree — `main` is canonical and equal to them.
4. Ack COMMS-0020 noting the premise was stale and the source is already on main (the orchestrator owns the ledger write).

> **Note for the SPEC phase:** META-ORCH-1060 will *extend* this edge fn (see §3b, §3c-region_code, §4) — those extensions are the real Phase-0/Phase-1 backend work, NOT a from-scratch reconciliation.

### 1e. Current edge-fn request/response contract (verbatim from source)

`supabase/functions/mapbox-geocode/index.ts`, `verify_jwt=true`, reads secret **`MAPBOX_ACCESS_TOKEN`** (`index.ts:253`). Action-discriminated POST:

- **`suggest`** — body `{ action:"suggest", query:string, session_token?:string }` → `{ suggestions: [{ placeId, displayName, fullAddress }] }` (≤5). Calls `GET /search/searchbox/v1/suggest?q=&session_token=&access_token=&limit=5` (`index.ts:129-134`). `query<3` → `{error:"query_too_short"}` 400.
- **`retrieve`** — body `{ action:"retrieve", mapbox_id:string, session_token?:string }` → `{ details: { placeId, formattedAddress, city, region|null, countryCode|null, location:{lat,lng} } }`. Calls `GET /search/searchbox/v1/retrieve/{mapbox_id}?session_token=&access_token=` (`index.ts:181-184`).
- **Normalized `PlaceDetails`** (`index.ts:233-242`): `city = ctx.place?.name ?? ctx.locality?.name ?? ctx.district?.name` (honest 500 `no_locality` if none); `region = ctx.region?.name` (**name only — NOT region_code**, `index.ts:228`); `countryCode = ctx.country?.country_code?.toUpperCase()` (`index.ts:229-231`); `location = { lat: coords[1], lng: coords[0] }` (GeoJSON `[lng,lat]` swap, `index.ts:240`).
- **Session-token handling** (`index.ts:269-272`): server uses the client-supplied UUID, else `crypto.randomUUID()`. Client (`mapboxGeocodeService.newMapboxSessionToken()`) mints one UUID per typing session, reused across suggest→retrieve, rotated after a completed pick (`MapboxAddressInput.tsx:140`). Mapbox bills suggest+retrieve as ONE session.
- **CORS + errors:** `Access-Control-Allow-Origin:*`; every error is `{error:"<code>"}` with appropriate status (matches Google `places-autocomplete`'s contract).

**Mapbox docs cited inline in the source** (and re-verified §5): Search Box `/suggest` https://docs.mapbox.com/api/search/search-box/#get-suggestions ; `/retrieve` https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature ; session billing https://docs.mapbox.com/api/search/search-box/#session-billing .

---

## 2. SHARED-PACKAGE EXTRACTION

### 2a. Current location (business-only)

- Component: `mingla-business/src/components/location/MapboxAddressInput.tsx` (RN; imports business design tokens `../../constants/designSystem` — `accent, glass, radius, semantic, spacing, text, typography`, lines 34-42; and `../ui/Icon`, line 44).
- Service: `mingla-business/src/services/mapboxGeocodeService.ts` (imports `./supabase` for `functions.invoke`, line 34; exports `PlaceAutocompleteSuggestion`, `PlaceDetails`, `newMapboxSessionToken`, `autocompleteMapbox`, `retrieveMapboxPlace`).
- No shared location package exists. `packages/` currently holds: `brand-rendering`, `event-rendering`, `payments-native`, `phone-input`, `scripts`, `theme-animations`.

### 2b. Business-app importers that must repoint after extraction

`grep` for `MapboxAddressInput` / `mapboxGeocodeService` importers in `mingla-business/src`:

- `mingla-business/src/components/wizard/CreatorStep3Where.tsx` (the experience stops builder — the one named in the prompt). **Verify the exact path/line at SPEC time** (this investigation confirmed the component+service are the only Mapbox client files; the importer set is small).

> **Recommendation (SPEC):** confirm the full importer set with `grep -rln "MapboxAddressInput\|mapboxGeocodeService" mingla-business/src` at SPEC start and list each with file:line as a repoint checklist item.

### 2c. Extraction shape — propose `packages/location-input/`

Model it on the existing `packages/phone-input/` precedent (a shared RN input already consumed by both apps). The **service** extracts cleanly (pure logic + `supabase.functions.invoke`); the **component** has token coupling that must be parameterized.

- `packages/location-input/src/mapboxGeocodeService.ts` — move verbatim. ONE caveat: it imports a concrete `./supabase` client. The shared package must receive the Supabase client (or the `functions.invoke` fn) via a small adapter/param, because app-mobile and mingla-business each have their own `supabase` singleton. Recommended: export a factory `createMapboxGeocode(invoke)` OR keep `autocompleteMapbox(query, token, { invoke })`. (`phone-input` solved an analogous cross-app concern.)
- `packages/location-input/src/MapboxAddressInput.tsx` — move, but **the 7 design tokens + `Icon` are app-specific**. Two viable patterns: (i) inject a `tokens` + `IconComponent` prop bundle from each app; (ii) keep a thin per-app wrapper that passes tokens, with the shared package owning only the state machine + a11y + dropdown logic. Pattern (ii) matches `event-rendering`'s shim approach (COMMS-0007 / `feedback_eventcovermedia_shared_package.md`: edit the shared package, leave per-app shims).
- Types `PlaceAutocompleteSuggestion` + `PlaceDetails` move to the package and both apps import from there (kills the structural duplication with `googlePlacesService.PlaceDetails`).

### 2d. RN-vs-business styling/token divergences that complicate sharing

- **Design tokens differ between apps.** Business uses `mingla-business/src/constants/designSystem` (`glass.tint.profileBase`, `glass.border.profileBase`, `accent.warm`, `accent.tint`, `radius.md`, `semantic.error`, `typography.body/caption`). app-mobile uses `app-mobile/src/constants/designSystem` (the consumer's `glass`, accent, etc.). The shared component cannot hardcode either — tokens must be injected (§2c).
- **Icon component differs** (`mingla-business/.../ui/Icon` vs `app-mobile/.../ui/Icon`). Inject as a prop.
- **Consumer sheets use a different visual idiom** (e.g. `CityPickerSheet`'s bespoke dark canvas `rgba(20,22,26,0.98)` + hard-coded `rgba(255,255,255,…)` strings). The shared `MapboxAddressInput` is an *inline field*, not a sheet — the consumer surfaces (CityPicker, Preferences) embed it inside their own sheet chrome, so the field-vs-sheet boundary is the natural seam. The shared piece is the field + dropdown + state machine; the sheet stays per-surface.
- **No web/native split needed** for this leg (both apps are RN here; buyer-web is out of scope per the locked surfaces).

---

## 3. CONSUMER SURFACES TO REPOINT

The consumer app has **three** geocoding mechanisms (verified):

| Mechanism | Provider | File | Used by |
|---|---|---|---|
| `geocodingService.autocomplete()` | **Nominatim** (`/search`) | `geocodingService.ts:282-352` | CityPicker, Preferences ×2, Onboarding, useUserLocation |
| `geocodingService.reverseGeocode()` | **Nominatim** (`/reverse`) | `geocodingService.ts:29-98` | localeDetection, DiscoverScreen night-out |
| `throttledReverseGeocode()` | **native OS geocoder** (`expo-location`) | `throttledGeocode.ts:58` | ProfilePage, SwipeableCards, locationService, enhancedLocationService, enhancedLocationTrackingService |

Nominatim base: `https://nominatim.openstreetmap.org/search` (`geocodingService.ts:299`) and `/reverse` (`geocodingService.ts:60`), `User-Agent: Mingla-Mobile-App/1.0`.

### 3a. Preferences sheet custom-location 🔴 (in scope)

- **Call sites:** `PreferencesSheet.tsx:641` (debounced type-ahead) and `PreferencesSheet.tsx:891` (auto-resolve-on-save fallback, ORCH-0943). Both call `geocodingService.autocomplete()` → **Nominatim**.
- **Persists:** `custom_location` (text), `custom_lat`, `custom_lng` (numeric) on `preferences`. The save path takes `resolvedSuggestion.location` (lat/lng) + `fullAddress`/`displayName`. Hard rule **I-PROPOSED-CUSTOM-COORDS-LOCKED** (strict-grep `i-proposed-orch-0943-custom-coords-locked.mjs`): any `custom_lat/custom_lng` write must include `custom_location` in the same payload OR be GPS-gated.
- **Change:** repoint to the shared Mapbox picker. Note this surface today uses a free-text field + suggestion list, not the suggest→retrieve component. SPEC must decide: adopt `MapboxAddressInput` (suggest→retrieve, structured `PlaceDetails` with lat/lng) — preferred, since it yields exact coords + city directly. The ORCH-0943 auto-resolve-on-save fallback (line 891) becomes unnecessary because the picker only fires `onPick` after a successful `retrieve` (coords guaranteed).
- **Invariant guard:** keep `custom_location` + `custom_lat/lng` written atomically so the 0943 gate stays green.

### 3b. Discover city picker 🔴 (in scope — HIGH BLAST, parsing risk RESOLVED)

- **Call site:** `CityPickerSheet.tsx:154` → `geocodingService.autocomplete()` → **Nominatim**. (Header comment line 5 wrongly says "Google Places"; service is Nominatim — comment drift, 🔵.)
- **Persists** (`CityPickerSheet.tsx:203-209`): `discover_city_name`, `discover_city_state_code`, `discover_city_country_code`, `discover_city_lat`, `discover_city_lng` on `preferences`. Column types: name/state_code/country_code = `text`, lat/lng = `numeric` (`20260601000001_orch_0809_discover_city_preferences.sql:14-18`).
- **The parsing risk (prompt's CRITICAL item):** today the ISO codes are *parsed out of the Nominatim display string*:
  - `parseStateCountry(suggestion.fullAddress)` (`CityPickerSheet.tsx:178`, fn at `:85-113`) splits the comma string, maps the last token via `COUNTRY_NAME_TO_CODE` and (US-only) the second-to-last via `US_STATE_CODES`.
  - `resolvedCityName = displayName.split(",")[0]` (`CityPickerSheet.tsx:189-191`) takes the first segment as the canonical city token. This MUST equal `events.city` (the merged Discover endpoint does an **EXACT string match** on `events.city` — ORCH-0824 hotfix-5b, `CityPickerSheet.tsx:180-191`). A wrong city token = zero TM/event matches.
- **RESOLUTION (Mapbox returns these structured — see §5):** Mapbox `properties.context.region.region_code` = ISO 3166-2 ("NC"), `context.country.country_code` = ISO alpha-2, `context.place.name` = the canonical city. So:
  - **State code:** `region.region_code` replaces the US-only `US_STATE_CODES` parse and **works for all countries** (Nominatim parse only ever resolved US states; this is a net improvement).
  - **Country code:** `country.country_code` replaces the `COUNTRY_NAME_TO_CODE` lookup (which only knew a hand-maintained set).
  - **City token:** `context.place.name` is the clean locality — replaces `display_name.split(",")[0]`.
  - **Required edge-fn change:** the current `retrieve` handler extracts `region.name` only (`index.ts:228`). META-ORCH-1060 must add `regionCode = ctx.region?.region_code` (and optionally `region_code_full`) to the `details` shape and to the `PlaceDetails` type, then have CityPicker write `discover_city_state_code = details.regionCode`. Without this, repointing to Mapbox would regress state codes to null.
- **Downstream that the city token + codes feed:** `DiscoverScreen.tsx:1262-1271` reconstructs the `DiscoverCity` from these columns and passes `stateCode`/`countryCode`/`lat`/`lng` to the Ticketmaster filter; `events.city` exact-match join (ORCH-0824). The launch-city gate (`useLaunchCityGate.ts`) uses live **GPS** via `check-launch-city`, NOT the stored discover_city codes — so it is NOT disturbed by this change. The friend-location RPC reads `discover_city_lat/lng` (numeric coords only, not codes) as fallback 3 (`…0004…sql:70-71`) — unaffected by a code-format change.
- **Mitigation if Mapbox omits `region_code` for a feature:** keep a null-safe fallback (the column is already nullable; TM tolerates city-only). Do NOT resurrect display-string parsing.

### 3c. Profile location reverse-geocode 🟠 (prompt premise INACCURATE)

- **Actual path:** `ProfilePage.tsx:239` calls `throttledReverseGeocode(lat,lng)` → `throttledGeocode.ts:58` → **`Location.reverseGeocodeAsync` (native OS geocoder)** — NOT Nominatim, NOT `geocodingService.reverseGeocode`. The prompt's claim "ProfilePage … `geocodingService.ts` reverse" is wrong.
- **Persists:** `profiles.location` (text only, e.g. "Raleigh, NC, USA"; `ProfilePage.tsx:240-257`) + AsyncStorage `mingla_user_location`. **No coords are stored** on the profile.
- **`throttledGeocode.ts` is a single-owner wrapper** (top-of-file: "ALL reverse geocoding MUST go through this wrapper … grep `reverseGeocodeAsync` should return ONLY this file") with throttle + cache + dedupe + rate-limit retry. It serves FIVE consumers (Profile, SwipeableCards, locationService, enhancedLocationService, enhancedLocationTrackingService), most of which are hot deck-path callers.
- **Decision needed (SPEC + Seth):** "provider-swap only, route the GPS reverse-geocode through Mapbox" cannot mean "swap Nominatim" here because Profile already isn't on Nominatim. Two readings:
  - **(R1) Leave Profile alone.** The native OS geocoder is free, offline-capable, already throttled, and not a Nominatim dependency. If the goal is "kill Nominatim from the consumer app," Profile is already not the problem. **Recommended** unless Seth specifically wants Mapbox label parity on the profile string.
  - **(R2) Route `throttledReverseGeocode` through `mapbox-geocode` (new `reverse` action).** Higher blast — it would re-route 5 hot consumers (incl. the deck path) onto a network edge fn, losing the offline native fallback and adding latency/cost to every deck render. If chosen, it must stay inside the `throttledGeocode` wrapper (keep throttle/cache/dedupe) and **must not break the single-owner invariant**. This is a much bigger change than "provider swap" implies.
- **Mapbox reverse capability exists** (§5): Search Box `GET /search/searchbox/v1/reverse?longitude=&latitude=` (no session token, billed per request) and Geocoding v6 `GET /search/geocode/v6/reverse`. So R2 is feasible; the edge fn would gain a `reverse` action. **Flag for Seth:** confirm R1 vs R2 — the locked scope says "no new UI" but is silent on which reverse path; R2 has real cost/latency implications on the deck.

### 3d. Other consumer location inputs

- **`OnboardingFlow.tsx:973`** — manual-location autocomplete → `geocodingService.autocomplete()` → **Nominatim**. NOT in the prompt's list but IS a consumer Nominatim surface. SPEC must decide in/out. If the goal is "remove Nominatim from app-mobile," this is in scope (repoint to the shared picker). 🟠
- **`useUserLocation.ts:72`** — legacy fallback: when `custom_location` text exists but no coords, calls `geocodingService.autocomplete()` to re-derive coords → **Nominatim**. If §3a writes coords reliably via Mapbox, this fallback rarely fires, but it still imports Nominatim. Repoint to the Mapbox service (forward geocode of the text) to fully de-Nominatim. 🟡
- **`localeDetection.ts:60`** — `geocodingService.reverseGeocode()` → **Nominatim** → country name → currency (`detectLocaleFromCoordinates`). To remove Nominatim this needs Mapbox reverse (country_code → currency). 🟡 — note Mapbox returns `country_code` (alpha-2) directly, which is *cleaner* than matching a country *name* string. SPEC should consider switching `getCurrencyByCountryName` → a code-based lookup.
- **`DiscoverScreen.tsx:1310`** — night-out flow `geocodingService.reverseGeocode(nightOutGpsLat,lng)` → **Nominatim**. In scope if de-Nominatim is the goal. 🟡
- **`LaunchCityPicker.tsx`** — **confirmed static list, OUT of scope.** No `geocod`/`autocomplete`/`nominatim`/`fetch` references in the file; it's a curated launch-city chooser (`useLaunchCityGate` + `onboardingLocationOverride`).

### 3e. `geocodingService` — adapter or replace? (recommendation)

**Recommendation: keep `geocodingService` as the consumer-side seam, but re-implement its body as a thin adapter over the shared Mapbox service** (forward via `autocompleteMapbox` for `autocomplete()`; Mapbox reverse for `reverseGeocode()` IF localeDetection/night-out are repointed). Rationale:

- Six call-sites depend on the `geocodingService.autocomplete()` / `.reverseGeocode()` signatures + its 24h reverse cache + 5min autocomplete LRU cache (`geocodingService.ts:18-27, 354-370`). Re-pointing the *body* (not the signature) is the lowest-blast migration and preserves the caching the Nominatim path added.
- The `AutocompleteSuggestion` shape (`{ displayName, fullAddress, location? }`, `geocodingService.ts:11-15`) already carries lat/lng — the same data Mapbox `PlaceDetails` gives. The adapter maps Mapbox suggest+retrieve → this shape.
- **Caveat:** Mapbox autocomplete is two-step (suggest then retrieve-for-coords), whereas Nominatim `/search` returns coords inline. The adapter must either (a) retrieve coords lazily on pick (preferred for the picker surfaces) or (b) retrieve top-N up front (costs N retrieve sessions — avoid). For surfaces that adopt `MapboxAddressInput` directly (3a, 3b), bypass `geocodingService` entirely; for the remaining script-style callers (locale, night-out, useUserLocation fallback) the adapter is the clean path.
- This keeps a single consumer-side owner and lets the strict-grep gate assert "no `nominatim` string anywhere in `app-mobile/src`."

---

## 4. PAIRED-VIEW CITY FALLBACK (absorbs the "no recent location" bug)

### 4a. Current chain (latest migration confirmed)

`get_paired_friend_last_location(p_viewer_id, p_friend_id)` — **latest** def is `20260730000004_orch_0986_friend_location_resolution_chain.sql` (supersedes `…0002` create + `…0003` ACL-lock; CREATE OR REPLACE preserves the service-role-only grant). Resolution order (`…0004…sql:54-82`): (1) most-recent `user_location_history` GPS → (2) `preferences.custom_lat/lng` → (3) `preferences.discover_city_lat/lng` → else **return empty** → caller emits `locationStatus:"missing"`. **Consent gate** (active `pairings` row, either direction) at `:45-52`. Coords never leave the server. The migration itself documents the deferred 4th fallback (`…0004…sql:13-15`): "users with ONLY a text `profiles.location` and no stored coords still hit the empty state; geocoding that text needs the … Geocoding API (external-API scope) and is deferred to a follow-up." **META-ORCH-1060 is that follow-up.**

### 4b. Caller

`supabase/functions/_shared/personHeroCards.ts:325` — `resolveFriendLocation(adminClient, viewerId, friendId)` calls the RPC with the **service-role admin client**, returns `null` when no numeric coords (`:330-341`). `null` → the hero section shows the honest empty state. `personHeroCards.ts` does NOT currently read `profiles.location`.

### 4c. Decision: geocode-at-RESOLVE-time, server-side (recommended)

**Recommended: add the 4th fallback in `personHeroCards.ts` (or a small helper it calls), invoking Mapbox forward-geocode server-side when the RPC returns null AND the friend has a text `profiles.location`.** Justification vs the alternative:

- **Geocode-at-resolve-time (RESOLVE):**
  - *Pros:* zero client changes (locked-scope goal "avoid client changes if possible" — satisfied); the consent gate stays inside the RPC (the RPC still returns empty for non-paired; the caller only reaches the text fallback after the RPC's consent check has already gated GPS/custom/discover paths — but see the gate note below); no new column / no backfill; works for ALL existing friends immediately; honors the "city" intent (the hero shows the friend's *city* text, so geocoding that exact text centers recs where the hero says).
  - *Cons:* a Mapbox forward call on each paired-view resolve when the friend has only text location (mitigate with a server-side cache keyed on the text; or escalate to 4d write-time cache later); adds the friend-location resolution to Mapbox billing.
  - **Exact injection point:** in `personHeroCards.ts`, after `resolveFriendLocation` returns null, read `profiles.location` for `friendId` via the admin client, and if non-empty call `mapbox-geocode` (new server-callable forward path — see 4e) → `{lat,lng}`. Keep it best-effort: on geocode failure, fall back to the existing `missing` state (Constitution #3 — surface nothing fabricated).

- **Geocode-at-WRITE-time (WRITE / 4d):**
  - *Pros:* one geocode per profile edit; resolve path stays pure-SQL.
  - *Cons:* requires a NEW migration (e.g. `profiles.location_lat/location_lng` + a trigger or app-side write), a **backfill** of all existing `profiles.location` rows, and **a client change at the Profile write** (`ProfilePage.tsx:253` `update({ location })` — exactly the kind of client change the locked scope wants to avoid). Also, Profile already has the device GPS at write time (`ProfilePage.tsx:238`), so the "right" write-time cache is the actual GPS coords, not a geocode of the text — which would instead feed `user_location_history` (a different, larger change touching the deck path).

**Conclusion:** RESOLVE-time is lower-blast, no-backfill, no-client-change, and matches the migration's own documented plan. Choose RESOLVE. Optionally add a server-side cache (4d-lite) if Mapbox call volume is a concern — but no DB column needed for v1.

### 4d. If a cache column is later wanted (name it)

If Seth wants write-time caching as a fast-follow: add `preferences.custom_lat/lng` is already the explicit-location cache; for the *text profile* case a new `profiles.location_lat double precision` + `profiles.location_lng double precision` (nullable), written by a NEW server-side path (NOT the client) and backfilled. This is explicitly **deferred** unless Mapbox call volume proves a problem; v1 = RESOLVE-time, no column.

### 4e. Consent gate + server-callability note

- The consent gate (active pairing) lives in the RPC (`…0004…sql:45-52`). The text-fallback geocode happens in `personHeroCards.ts` which is **only reached for an already-resolved paired view** — but to be safe, the SPEC must ensure the text-fallback path is gated identically (e.g. only geocode after a successful consent-checked RPC call returns, or re-assert the pairing check). Do NOT geocode `profiles.location` for a non-paired friend.
- `personHeroCards.ts` runs with the **service-role admin client** (no end-user JWT), so it **cannot** call `mapbox-geocode` (which is `verify_jwt=true`) the way the client does. The SPEC must choose: (i) extract the Mapbox forward call into a shared `_shared/mapboxGeocode.ts` helper that `personHeroCards.ts` imports and calls Mapbox directly (server-to-server, reading `MAPBOX_ACCESS_TOKEN`), bypassing the JWT'd edge fn — **recommended** (no auth gymnastics, same secret); or (ii) add an internal/service-auth path to the edge fn. (i) is cleaner and keeps the token server-side.

---

## 5. MAPBOX COVERAGE VERIFICATION (docs cited)

Verified against current Mapbox docs (fetched 2026-06-04):

- **Search Box `/suggest` + `/retrieve`** support BOTH city-only and POI/business-name searches; `types` filter includes `country, region, postcode, district, place, city, locality, neighborhood, street, address, poi, category`. https://docs.mapbox.com/api/search/search-box/#get-suggestions , https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
- **Structured ISO codes (resolves §3b risk):** `/retrieve` `properties.context.region` returns `name`, `region_code`, and `region_code_full` (ISO 3166-2); `properties.context.country` returns `name`, `country_code` (ISO 3166-1 alpha-2), `country_code_alpha_3`; `properties.context.place` returns the city `name`. https://docs.mapbox.com/api/search/search-box/
- **Reverse geocoding (resolves §3c R2 feasibility):** Search Box `GET /search/searchbox/v1/reverse?longitude=&latitude=&access_token=` — **no session_token required**, billed per request. https://docs.mapbox.com/api/search/search-box/ . Also Geocoding API v6 `GET /search/geocode/v6/reverse?longitude=&latitude=&access_token=` (limit default 1, max 5; `country`, `language`, `types`, `worldview`). https://docs.mapbox.com/api/search/geocoding/
- **Forward free-text geocode (one-call, for paired-text fallback §4 + useUserLocation fallback §3d):** Search Box `GET /search/searchbox/v1/forward?q=` OR Geocoding v6 `GET /search/geocode/v6/forward?q=` — single call returns coordinates + `context.region.region_code_full` + `context.country.country_code`. No suggest/retrieve two-step needed for server-side resolution. https://docs.mapbox.com/api/search/geocoding/ , https://docs.mapbox.com/api/search/search-box/
- **Session billing:** suggest+retrieve = ONE session per `session_token`; `/reverse`, `/category`, `/forward` are per-request. https://docs.mapbox.com/api/search/search-box/#session-billing

**Coverage verdict:** Mapbox meets or exceeds Nominatim for the consumer use. City search: Mapbox `place`/`city` types + structured ISO codes are strictly better than Nominatim's display-string parsing (which only ever resolved US state codes and a hand-maintained country-name map). Custom street/neighborhood: Mapbox `address`/`street`/`neighborhood` types cover it; the existing experience-venue picker already proves street-level Mapbox quality in production (v19, business app). **Gap to flag:** Mapbox is a keyed, billed API (Nominatim was free) — provisioning cost + the per-keystroke suggest billing for the type-ahead surfaces is the trade-off (already accepted for the business experience picker). The 250ms debounce + ≥3-char gate (already in `MapboxAddressInput`) bound the cost.

---

## 6. BLAST RADIUS + INVARIANTS

### 6a. Downstream consumers of `discover_city_*` / `custom_*` a coordinate/parsing change could disturb

- `discover_city_*` (codes + coords): `DiscoverScreen.tsx:1262-1271` (TM filter reconstruction; **directly** depends on state_code/country_code/city token) → **highest blast** for §3b; `get_paired_friend_last_location` fallback 3 reads `discover_city_lat/lng` only (coords, not codes — safe); launch-city gate uses live GPS (`check-launch-city`), NOT stored codes — safe. The `events.city` EXACT-match join (ORCH-0824) depends on the city token == `events.city` — Mapbox `context.place.name` must equal what the business wizard writes to `events.city` (verify token parity at SPEC).
- `custom_lat/custom_lng/custom_location`: `useUserLocation.ts` (deck center), collab-deck aggregation migrations (`20260625…`, `20260627…`, `20260701…orch_0909…`), `accept-tag-along/index.ts`, `get_paired_friend_last_location` fallback 2. A coords *value* change is fine (same lat/lng semantics); the I-PROPOSED-CUSTOM-COORDS-LOCKED gate must stay green (write `custom_location` + coords atomically).
- `profiles.location` (text): paired-view hero label + the new §4 fallback. No coords today.

### 6b. Existing invariants/gates that intersect

- **I-PROPOSED-CUSTOM-COORDS-LOCKED** — `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` (scans `app-mobile/src`; `custom_lat/lng` write must include `custom_location` or be GPS-gated). §3a must preserve.
- **ORCH-0986 paired-profile gate** — `.github/scripts/strict-grep/orch-0986-paired-profile.mjs`. §4 must preserve.
- **`throttledGeocode` single-owner invariant** (file-header rule: `reverseGeocodeAsync` only in `throttledGeocode.ts`). §3c R2 must preserve if chosen.
- **COMMS-0002 / ORCH-0863 backend allowlist** — any new/changed `supabase/functions/*` (edge-fn extension §3b/§4) or new migration (§4d if chosen) must add its files to a backend allowlist in the SAME commit, or CI C7 `no-new-backend-files` fails.
- **COMMS-0003 external-API-docs-verified** — SPEC must cite the Mapbox URLs in §5 inline (this report does).

### 6c. NEW invariants META-ORCH-1060 should establish (strict-grep candidates)

1. **`I-CONSUMER-LOCATION-NO-NOMINATIM`** — `grep -r "nominatim" app-mobile/src` returns ZERO (once §3 surfaces are migrated). The single highest-value gate; proves the de-Nominatim is complete and prevents regression.
2. **`I-CONSUMER-LOCATION-USES-SHARED-MAPBOX`** — consumer location inputs import the shared `packages/location-input` picker/service, not a per-app Nominatim/Google client.
3. **`I-DISCOVER-CITY-CODES-FROM-MAPBOX-CONTEXT`** — `discover_city_state_code`/`country_code` are sourced from Mapbox `context.region.region_code`/`context.country.country_code`, NOT from display-string parsing (forbid resurrecting `parseStateCountry` on a raw address string).

---

## Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | COMMS-0020 (stale: claims source absent from main — disproven §1b). Migration `…0004` docs the deferred text-fallback (§4a). `discover_city` column comment says coords "denormalized from Google Places" — actually Nominatim now (drift). |
| **Schema** | `preferences.discover_city_*` (text codes + numeric coords); `custom_*`; `profiles.location` text-only (no coords). RPC `…0004` is the latest of 3 (confirmed). |
| **Code** | 3 geocode mechanisms; Profile on native OS geocoder (not Nominatim — prompt wrong); ISO codes parsed from Nominatim strings (replaceable by Mapbox structured context). |
| **Runtime** | `mapbox-geocode` v19 ACTIVE, `verify_jwt:true`, content == main. `MAPBOX_ACCESS_TOKEN` live (business experiences work in prod). |
| **Data** | discover_city codes today depend on a US-only/hand-maintained parse → Mapbox structured codes are strictly more correct. |

## Outcome & journey step-back

- **User goal:** "show me real-life options near where I (or my paired friend) actually are." The friend-view bug (empty state despite a visible city) is the sharpest divergence — §4 fixes it end-to-end (the migration's own documented gap).
- **Journey divergences fixed:** (a) friend with text-only city → §4 resolve-time geocode centers recs on the city; (b) discover-city state/country codes flaky outside the US → Mapbox structured codes fix all locales; (c) Nominatim rate-limits/quality on the consumer type-ahead → Mapbox (proven in business app).
- **Does fixing the named nodes deliver the outcome?** Yes, with two scope clarifications Seth must lock: (1) Profile reverse path is native-OS not Nominatim — confirm R1 (leave) vs R2 (route through Mapbox, higher blast); (2) confirm whether de-Nominatim includes Onboarding/locale/night-out/useUserLocation-fallback (§3d) or only the 3 named surfaces.

## Confidence

- **§1 Phase-0 (source on main, byte-identical, v19 match):** proven (git + sha + edge-fn content compared in full).
- **§3 surface inventory + parsing risk + Mapbox structured-code resolution:** proven (code read in full + Mapbox docs fetched/cited).
- **§3c Profile-on-native-OS-geocoder correction:** proven (read `ProfilePage.tsx` + `throttledGeocode.ts`).
- **§4 fallback design:** proven for the chain/caller/consent; the geocode-at-resolve recommendation is a design judgment (high confidence), pending Seth's RESOLVE-vs-WRITE + R1/R2 locks.
- **No live-fire sim run:** this is a code/SQL/migration-mapping investigation (INVESTIGATE per dispatch, "investigation + migration-mapping ONLY"), exempt from the simulator-repro rule. No reproducer-bound runtime bug was in scope.

## Discoveries for orchestrator

1. **COMMS-0020 premise is stale** — `mapbox-geocode` source IS on `origin/main` (PR #342), byte-identical to v19 + siblings. Phase 0 = verify+redeploy-from-main, not reconcile. Ledger should be ack'd RESOLVED with this note.
2. **Prompt surface map inaccuracies** (factor into SPEC dispatch): Profile uses the native OS geocoder, not Nominatim; the consumer app has 7 geocode call-sites across 9 files, not 3.
3. **Comment drift** (low priority): `CityPickerSheet.tsx:5` says "Google Places"; `discover_city` column comment says "Google Places autocomplete" — both are Nominatim. Worth a one-line fix during the migration.
4. **Edge-fn `retrieve` does not extract `region_code`** today (`index.ts:228` name-only) — META-ORCH-1060 must add it for §3b to keep state codes correct; this is the keystone backend change.
