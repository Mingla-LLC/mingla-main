# INVESTIGATION — ORCH-1361 [location-suggestions]

Consumer Preferences custom-location field: too few suggestions + wrong-country (London) results.

- **Worktree:** `~/Desktop/mingla-orchs/1361-[location-suggestions]/` on branch `1361-location-suggestions` (rebased on `origin/main`).
- **Evidence:** `Mingla_Artifacts/evidence/ORCH-1361/live_edge_fn_probes.txt` (raw live edge-fn JSON + doc verification).
- **Confidence:** `proven` for both root-cause threads (live runtime repro on the production edge fn). The proximity/country *fix* half is `proven-by-proxy` (live suggest returns Lekki Lagos NG) + doc-confirmed; the exact `&proximity&country` direct Mapbox call was blocked by a non-API-readable server secret (named blocker).

---

## 1. Symptom (expected vs actual)

On the LIVE consumer explorer app, Preferences sheet → "Where should we look" → custom-location field (GPS toggle OFF, Mingla+ user):

- **Expected:** typing a place shows a multi-row list of candidate places; typing "lekki, Nigeria" surfaces Lekki, Lagos, Nigeria.
- **Actual:** very few (effectively one) suggestions; typing "lekki, Nigeria" surfaces a **London** result. Seth chose the FULL FIX (multi-row list + user-location bias).

---

## 2. Investigation manifest (files read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `app-mobile/src/services/geocodingService.ts` | service | The Preferences autocomplete adapter (Thread 1). |
| 2 | `supabase/functions/mapbox-geocode/index.ts` | edge | `handleSuggest` / `handleForward` URL builders (Thread 2). |
| 3 | `packages/location-input/src/mapboxGeocodeService.ts` | service (shared) | `autocompleteMapbox` / `forwardGeocodeMapbox` signatures to extend. |
| 4 | `packages/location-input/src/MapboxAddressInput.tsx` | component (shared) | The multi-row suggest→retrieve field the swap adopts. |
| 5 | `packages/location-input/src/types.ts` + `index.ts` | types | Token/prop contract + public exports. |
| 6 | `app-mobile/src/components/location/MapboxAddressInput.tsx` | component (consumer wrapper) | Consumer light/dark token injection wrapper. |
| 7 | `app-mobile/src/components/discover/CityPickerSheet.tsx` | component | The working multi-row precedent to mirror. |
| 8 | `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | component | `LocationInputSection` — the field to swap + paywall structure. |
| 9 | `app-mobile/src/components/PreferencesSheet.tsx` | component (host) | Wiring: `handleLocationInputChange`, `handleSuggestionSelect`, lock gate, `overlay={paywall}`. |
| 10 | `app-mobile/src/hooks/useUserLocation.ts` | hook | The user-location signal available for proximity bias. |
| 11 | `app-mobile/src/services/enhancedLocationService.ts` | service | `getCurrentLocation`/`getLastKnownLocation` — device GPS for proximity. |
| 12 | `app-mobile/src/components/__tests__/orch-1315-preferences-custom-location-paywall.test.tsx` | test | The ORCH-1315 paywall invariant the swap must preserve. |
| 13 | `mingla-business/src/services/mapboxGeocodeService.ts` + 7 business picker sites | cross-surface | No-regression walk for the shared edge fn. |

---

## 3. Q-scorecard

**Q1 — Why does the Preferences custom-location field show only one suggestion?**
Verdict: **PROVEN.** It routes through `geocodingService.autocomplete()`, which calls the edge **`forward`** action (`limit=1`) and hard-wraps the single best match into a one-element array. A list is structurally impossible on this path. (F-1)

**Q2 — Why does "lekki, Nigeria" surface a London result?**
Verdict: **PROVEN (live).** `handleForward` and `handleSuggest` build the Mapbox Search Box URL with NO `proximity`, `country`, or `types` params. Mapbox defaults `proximity=ip`, and the IP is the Supabase edge datacenter — not the device. Live `forward "lekki, Nigeria"` returns "Lekki London Nigerian Restaurant, London, GB". (F-2)

**Q3 — Is the correct place (Lekki, Lagos NG) retrievable at all?**
Verdict: **PROVEN (live).** Live `suggest "lekki"` returns "Lekki Phase 2 — Lagos, Nigeria" at rank #1 and "Lekki Phase 1 — Lagos, Nigeria" at #3, mixed with Dubai/Poland/UK noise. Mapbox has the right answer; the app just never asks for a list and never biases. (F-3)

**Q4 — What user-location signal can the app pass as proximity?**
Verdict: **PROVEN.** Device GPS via `enhancedLocationService.getLastKnownLocation()` / `getCurrentLocation()` (independent of the `use_gps_location` preference toggle), and/or `cachedLocationSync` (module export from `useUserLocation.ts`), plus a country code derivable from the user's last resolved location. (F-4)

**Q5 — Does the fix risk the ORCH-1315 custom-location paywall?**
Verdict: **PROVEN — must be preserved.** `I-1315-PAYWALL-PRESENTS-FROM-SHEET` is ACTIVE and enforced structurally. The custom-location field only renders for `!useGpsLocation && !isLocked`; the locked GPS row is a whole-row `TouchableOpacity → onLockedTap`. The swap must keep these exact structures. (F-5)

**Q6 — What else consumes the shared edge fn (blast radius)?**
Verdict: **PROVEN — additive change is safe.** 7 business pickers + consumer CityPicker + consumer OnboardingFlow + reverse-geocode callers. All omit proximity/country → byte-identical behavior when the params are optional. No buyer-web caller exists. (F-6, F-7)

---

## 4. Findings (six-field evidence)

### F-1 — Preferences autocomplete is forward/limit=1, wrapped into a 1-element array — CONFIRMED ROOT CAUSE (Thread 1)

1. **Symptom:** custom-location field shows effectively one suggestion.
2. **Layer:** service + edge.
3. **Probe:** read `geocodingService.ts:203-234`; live `forward` probes A1–A3.
4. **Evidence:**
   `geocodingService.ts:216-223`:
   ```ts
   const details: PlaceDetails = await forwardGeocodeMapbox(query, { invoke });
   const results: AutocompleteSuggestion[] = [
     { displayName: details.city || details.formattedAddress,
       fullAddress: details.formattedAddress,
       location: { lat: details.location.lat, lng: details.location.lng } },
   ];
   ```
   `PreferencesSheet.tsx:659` (`handleLocationInputChange`) and `:909` (save-path) both call `geocodingService.autocomplete(text)`. `LocationInputSection` (`PreferencesSectionsAdvanced.tsx:271-315`) renders whatever `suggestions[]` the host supplies.
   Live A1 `forward "lekki"` → exactly ONE feature (Netherlands).
5. **Mechanism:** `forward` action → `handleForward` `limit=1` → one feature → `autocomplete()` wraps it in a one-element array → the manual dropdown can only ever render one row.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — Edge fn passes NO proximity/country → Mapbox default `proximity=ip` = server datacenter — CONFIRMED ROOT CAUSE (Thread 2)

1. **Symptom:** "lekki, Nigeria" → London.
2. **Layer:** edge + runtime.
3. **Probe:** read `mapbox-geocode/index.ts:164-211` (`handleSuggest`) + `:400-439` (`handleForward`); live `forward "lekki, Nigeria"`; Mapbox doc fetch.
4. **Evidence:**
   `handleForward` URL (`index.ts:406-410`): `` `${BASE}/forward` + `?q=…` + `&access_token=…` + `&limit=1` `` — no `proximity`, `country`, `types`.
   `handleSuggest` URL (`index.ts:174-179`): `` `?q=…&session_token=…&access_token=…&limit=5` `` — same omissions.
   Live `forward "lekki, Nigeria"` → `{"city":"London","countryCode":"GB","formattedAddress":"123 Rushey Grn, London, SE6 4AA, United Kingdom"}` (== "Lekki London Nigerian Restaurant"). Live `forward "lekki"` → Netherlands; `forward "lekki lagos"` → Houston TX.
   Mapbox docs (`https://docs.mapbox.com/api/search/search-box/`): *"If not provided, the default is IP proximity."*
5. **Mechanism:** with no proximity, Mapbox biases to the caller's IP = the Supabase Deno edge datacenter (GB/EU region), so global POIs named "lekki" resolve to London/NL/US instead of Lekki, Lagos.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-3 — Mapbox CAN return Lekki, Lagos NG via `suggest` (multi-row) — SECONDARY (validates the fix)

1. **Symptom:** correct place absent from the single forward result.
2. **Layer:** runtime.
3. **Probe:** live `suggest "lekki"` (A4).
4. **Evidence:** `#1 "Lekki Phase 2" — Lagos, Lagos, Nigeria`, `#3 "Lekki Phase 1" — Lagos, Lagos, Nigeria`; noise: `#2 Lekki Dubai (UAE)`, `#4 Poland`, `#5 UK`.
5. **Mechanism:** the multi-row `suggest` action surfaces the right place at #1; adding `country=ng` drops the non-NG noise, `proximity=<Lagos>` guarantees ranking. Direct `&proximity&country` call not executed (server token is a non-API-readable secret; no public token per ORCH-1162R) → this half is proven-by-proxy + doc-confirmed.
6. **Severity:** SECONDARY ROOT CAUSE (the multi-row switch alone largely fixes the user symptom; bias is the refinement).

### F-4 — User-location signal is available — SUPPORTING

1. **Layer:** hook/service.
2. **Evidence:** `enhancedLocationService.getLastKnownLocation()`/`getCurrentLocation()` return `{latitude,longitude}` (`enhancedLocationService.ts:60,127`); `useUserLocation.ts:19` exports `cachedLocationSync: {lat,lng}|null`; `useUserLocation` also resolves the active deck coords. Country can be derived from the user's last reverse-geocoded `countryCode` (already cached in `geocodingService.reverseGeocode`).
3. **Mechanism:** the host can pass device coords + country as proximity/country to the field, independent of the `use_gps_location` toggle (the user is physically in Lagos even with GPS-for-deck toggled off).
4. **Severity:** SUPPORTING (enables the fix).

### F-5 — ORCH-1315 paywall structures are load-bearing — MUST PRESERVE

1. **Layer:** component + test.
2. **Evidence:** `I-1315-PAYWALL-PRESENTS-FROM-SHEET` ACTIVE (INVARIANT_REGISTRY:183). Test `orch-1315-…paywall.test.tsx` T-A4 pins in `PreferencesSectionsAdvanced.tsx`: `isLocked ? ( <TouchableOpacity` with `onPress={onLockedTap}`, `accessibilityRole="button"`, `accessibilityLabel="Upgrade to set a custom starting point"`; and the `!useGpsLocation && !isLocked` guard around the field. T-A1/T-A1b pin `overlay={paywall}` + `presentInline` in `PreferencesSheet.tsx`.
3. **Mechanism:** the swap replaces the INNER field (inside the `!useGpsLocation && !isLocked` block); the GPS-row/lock structures and the paywall overlay wiring must remain byte-compatible with the pinned strings.
4. **Severity:** CONSTRAINT (not a defect) — a regression here would silently drop the Mingla+ paywall.

### F-6 — Shared edge fn blast radius — additive change is safe

1. **Layer:** cross-surface.
2. **Evidence:** `suggest`/`retrieve` consumers via `MapboxAddressInput`: consumer `CityPickerSheet`; business `ExperienceStopCard`, `BrandCreationFlow`, `TripCreatorStep1Basics`(×2), `EditPublishedTripScreen`(×2), `VenueStep1Address`, `CreatorStep3Where`. `forward` consumers via `geocodingService.autocomplete`/`forwardGeocodeMapbox`: `PreferencesSheet`(×2), `OnboardingFlow`, `useUserLocation` fallback. `reverse` consumers: locale/night-out/GPS-name. No buyer-web caller. Business wrapper `mingla-business/src/services/mapboxGeocodeService.ts` calls `sharedAutocomplete(query, sessionToken, {invoke})` with no location args.
3. **Mechanism:** if `proximity`/`country` are OPTIONAL (URL params appended only when present; service args defaulted), every non-passing caller produces a byte-identical request → no regression.
4. **Severity:** CLEARED (with the additive constraint).

### F-7 (Discovery) — OnboardingFlow has the SAME bug — OUT OF SCOPE

`OnboardingFlow.tsx:991` also calls `geocodingService.autocomplete()` (forward/limit=1) with its own manual dropdown — identical too-few + wrong-country failure. Not fixed by ORCH-1361 (Preferences-scoped); the additive edge-fn params leave it unchanged. **Register as a follow-on ORCH** (Onboarding location field → same multi-row + bias treatment). CityPickerSheet shares the wrong-country risk too but is `suggest`-based (multi-row) so it degrades to "noisy list," not "one wrong answer" — candidate to also receive proximity/country in the same pass (Open Question).

---

## 5. Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| Docs | geocodingService header claims multi-row UX "served by the shared MapboxAddressInput field (CityPicker), not this adapter." | The Preferences field uses the ADAPTER, not the shared field → the doc's own carve-out is the bug: Preferences was never migrated to the multi-row field. |
| Schema | n/a (no DB change; `custom_lat/lng/location` columns already exist). | — |
| Code | `autocomplete()` = forward/limit=1 → 1 row; edge builds URL with no proximity/country. | Matches symptom. |
| Runtime | forward "lekki, Nigeria" → London GB; suggest "lekki" → Lekki Lagos NG at #1. | Confirms both threads; confirms fix is reachable. |
| Data | Mapbox default proximity=ip = server datacenter. | The gap between "user's device location" (data the app has) and "server IP" (what Mapbox sees) IS the bug. |

---

## 6. Repro evidence

Live production edge fn `https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/mapbox-geocode` (verify_jwt=true, authed with anon JWT), raw JSON in `evidence/ORCH-1361/live_edge_fn_probes.txt`:

- `forward "lekki"` → Oegstgeest, **Netherlands**.
- `forward "lekki, Nigeria"` → **London, GB** ("Lekki London Nigerian Restaurant") — exact Seth repro.
- `forward "lekki lagos"` → Houston, **Texas US**.
- `suggest "lekki"` → #1 **Lekki Phase 2, Lagos, Nigeria**; #3 Lekki Phase 1, Lagos, Nigeria (+ Dubai/Poland/UK noise).
- `suggest "lekki, Nigeria"` → #1 London restaurant, then Chad/Cameroon/SA/Chile junk.

Mapbox doc verification captured (proximity default=ip; country=ISO alpha-2 CSV; types list; limit≤10).

---

## 7. Blast radius / cross-surface map

- **In-scope surface:** Consumer iOS + Android — Preferences custom-location field (`app-mobile/`).
- **Edge fn (shared) — additive-only:** `handleSuggest` + `handleForward` gain OPTIONAL `proximity`/`country`. No-regression for: 7 business pickers, consumer CityPicker, OnboardingFlow, reverse callers, buyer-web (no caller) — all omit the params.
- **Out of scope:** OnboardingFlow (F-7, follow-on), CityPicker bias (Open Question), business pickers (no behavior change).

---

## 8. Invariant impact

- **Preserve (ACTIVE):** `I-1315-PAYWALL-PRESENTS-FROM-SHEET` (paywall over sheet), the ORCH-1315 T-A4 GPS-row structure, INV-3 (structured region/country codes never parsed — the shared field already honors this), Mapbox session-billing discipline (one session_token across suggest→retrieve; forward/reverse per-request).
- **Propose (DRAFT):** `I-PROPOSED-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` — consumer location search MUST bias by the user's device proximity (and/or country), never the server IP. (Flip ACTIVE at CLOSE — orchestrator owns the flip.)

---

## 9. Discoveries for Orchestrator

1. **F-7 OnboardingFlow** — same forward/limit=1 + no-bias bug in the onboarding manual-location field. Register a follow-on ORCH (multi-row + bias).
2. **CityPicker bias** — shares the wrong-country risk (noisy list). Candidate to also pass proximity/country in this pass (Open Question / small add).
3. **Forward `limit>1` Mapbox constraint** — Mapbox `/forward` supports `limit` up to 10 only with a single `types`; the fix keeps `forward` at `limit=1`, so no impact, but noted for any future forward-list idea.

---

## 10. Confidence & recommended next phase

- **Confidence:** `proven` (both root-cause threads have live runtime repro on the production edge fn). Fix mechanism `proven-by-proxy` (live suggest returns Lekki Lagos NG) + doc-confirmed; direct proximity-param call blocked by a named, genuinely-unresolvable blocker (server token is a non-API-readable secret) — this caps only the direct-param sub-proof, not the diagnosis.
- **Recommended next phase:** SPEC (this dispatch is INVESTIGATE-THEN-SPEC). Scope = client multi-row swap of the Preferences custom-location field + additive edge-fn proximity/country bias, preserving the ORCH-1315 paywall + session-billing + INV-3. See `specs/SPEC_ORCH-1361_LOCATION_SUGGESTIONS.md`.
