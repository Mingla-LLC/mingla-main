# SPEC — ORCH-1365 [location-search-relevance]

**Corrective to ORCH-1361.** Give the consumer Preferences custom-location search a place-type-filtered,
country-aware, non-proximity-biased query that returns the actual place a non-Lagos user names — while
keeping BUSINESS venue-name search byte-identical and filter-free (ORCH-1079/INV-3). Fix two UI bugs in
the shared field (unscrollable list, clipped input text).

- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1365_LOCATION_SEARCH_RELEVANCE.md`
- **Evidence:** `Mingla_Artifacts/evidence/ORCH-1365/live_edge_fn_reproduction.txt`
- **Worktree:** `~/Desktop/mingla-orchs/1365-[location-search-relevance]/` on branch `1365-location-search-relevance`
- **Mapbox params verified vs live docs:** https://docs.mapbox.com/api/search/search-box/ (suggest: `types` = comma list incl. place/locality/neighborhood/region/district; `country` = ISO 3166-1 alpha-2 comma list; `proximity` = "lng,lat"|"ip"; `limit` ≤ 10; `session_token` required).

---

## 1. Executive summary

A London-region user typing "lekki nigeria" got a London restaurant and unrelated "Nigeria" places, not
Lekki, Lagos. Root causes (all runtime-proven against Mapbox): (a) the field biases ranking to the user's
current device — wrong for a "search a place you're NOT at" field; (b) no place-type filter, so POIs
(restaurants/apartments named "Lekki") outrank the real place; (c) a trailing country word ("nigeria")
makes Mapbox return literal "Nigeria" places and drop "Lekki".

The fix routes the CONSUMER Preferences field (and, if OQ-2 approved, the Discover CityPicker) through a
NEW, additive edge-fn action **`suggest_places`** that (1) applies `types=place,locality,neighborhood,region,district`
(drops POIs), (2) detects a trailing country token, strips it from the query and applies it as a Mapbox
`country` filter, and (3) sends **no** proximity for the Preferences field. The existing `suggest` action
(business venue-name search) stays BYTE-IDENTICAL and filter-free. Proven result: "lekki" AND
"lekki nigeria" both return **Lekki, Lagos, Nigeria #1** for a non-Lagos user. Plus two UI fixes to the
shared field: a gorhom-aware scrollable card list, and removal of the forced `lineHeight` that clips input text.

---

## 2. Scope & non-goals

**In scope:**
- Edge fn `mapbox-geocode`: ADDITIVE new action `suggest_places` (types filter + trailing-country strip + `country` bias + limit), plus a small country-name→ISO module. `suggest`/`retrieve`/`reverse`/`forward` UNCHANGED.
- Shared service `mapboxGeocodeService.ts`: ADDITIVE `autocompletePlacesMapbox()`. `autocompleteMapbox()` UNCHANGED.
- Shared component `MapboxAddressInput.tsx`: (a) new `searchMode?: "venue" | "places"` prop (default `"venue"` = today); (b) new injectable `ScrollComponent` for a scrollable card list; (c) TextInput text-clip fix.
- Consumer wrapper + Preferences host: use `searchMode="places"`, inject `BottomSheetScrollView`, DROP proximity threading.
- ORCH-1079 gate scoped to the business builder; ORCH-1361 proximity test/invariant retired/narrowed — both with `[TEST-MOD-APPROVED ORCH-1365]`.
- New regression tests incl. the "non-Lagos user finds Lekki Lagos" gap test.

**Non-goals:**
- Business venue/address pickers, buyer-web, admin — MUST stay byte-identical (do NOT touch their paths).
- No DB schema/migration change. No new Mapbox billing surface (suggest→retrieve session model unchanged).
- No redesign of the field's visual language — the UI fixes correct broken container/metrics within existing DESIGN §1 tokens.
- No change to `retrieve`/`reverse`/`forward`, `verify_jwt`, or session billing.

**Assumptions:** the `MAPBOX_ACCESS_TOKEN` secret is provisioned (it is; ORCH-1361 verified). The country-name→ISO map is a bounded static table maintained in-repo.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|-----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | **YES** | Preferences custom-location returns the real place; list scrolls; input text not clipped | shared pkg + `app-mobile/.../location/MapboxAddressInput.tsx`, `PreferencesSectionsAdvanced.tsx`, `PreferencesSheet.tsx` | Shared code → automatic w/ Android |
| 2 | Consumer Android (`app-mobile/`) | **YES** | Same as iOS; verify Android descender fix + gorhom scroll | same shared files | Manual eyeball delta (SC split) |
| 3 | Buyer/anon Web (`mingla-business/` checkout/e/b/t) | NO | No location autocomplete on these routes | — | n/a |
| 4 | Business iOS (`mingla-business/`) | **NO — must stay byte-identical** | Venue-name/address pickers unchanged; POIs still resolve | — (business wrapper omits `searchMode` → default `"venue"`) | Guarded by ORCH-1079 gate + byte-identical test |
| 5 | Business Android | **NO — byte-identical** | Same | — | Same guard |
| 6 | Admin Web (`mingla-admin/`) | NO | No consumer location search | — | n/a |
| 7 | Business Web preview | NO | No consumer location search | — | n/a |

**Hard gate:** the business path (`handleSuggest` → `buildSuggestUrl`; `autocompleteMapbox`; the shared component with `searchMode="venue"`) must be provably unchanged. See §6 + §9.

---

## 4. Layered specification

### 4.1 Edge function — `supabase/functions/mapbox-geocode/index.ts` (ADDITIVE)

**New request action.** Add `"suggest_places"` to `RequestBody.action` union. `RequestBody` gains no new caller-supplied filter field beyond what already exists; `country` is DERIVED server-side (not client-trusted) so business callers can never inject a filter into the business path.

**New constant + pure builder** (place-filtered; sibling to `buildSuggestUrl`, kept SEPARATE so the gate can prove the business builder is filter-free):
```
// ORCH-1365 — consumer place-search only; NEVER used by handleSuggest (business).
const PLACE_SUGGEST_TYPES = "place,locality,neighborhood,region,district";
export function buildPlaceSuggestUrl(base, token, trimmedQuery, sessionToken, opts): string
```
- Appends `q`, `session_token`, `access_token` (same as `buildSuggestUrl`), then ALWAYS `&types=${PLACE_SUGGEST_TYPES}`, then `&country=${opts.country}` ONLY when `opts.country` is a non-empty ISO code, then `&limit=${clampSuggestLimit(opts.limit)}`. **No proximity** appended for Preferences (caller omits it; keep the param optional so OQ-2/CityPicker can pass a weak tiebreak if approved).
- Verified formats: `types`, `country`, `limit` all valid per live docs.

**New trailing-country parser** (new module `supabase/functions/mapbox-geocode/countryNames.ts`, unit-testable):
```
export function parseTrailingCountry(raw: string): { query: string; country?: string }
```
- Tokenize `raw.trim()` on whitespace. If ≥2 tokens AND the final token (or final two tokens, e.g. "south africa") matches a `COUNTRY_NAME_TO_ISO` entry (case-insensitive; includes common aliases: uk→gb, usa/us→us, uae→ae, "united kingdom", "united states", "south africa", etc.), strip that token(s) and return the ISO alpha-2 as `country` and the remaining leading text as `query`. Otherwise return `{ query: raw.trim() }` (no country).
- **Single-word queries are NEVER stripped** (guard: only fire when ≥2 tokens remain-plus-country). Proven safety: "lekki london" (city, not country) and "lekki phase" are NOT stripped (probes L/M).

**New handler:**
```
async function handleSuggestPlaces(token, rawQuery, sessionToken, opts): Promise<Response>
```
- `const trimmed = rawQuery.trim(); if (trimmed.length < 3) return jsonResponse({ error: "query_too_short" }, 400);`
- `const { query, country } = parseTrailingCountry(trimmed);`
- If stripping leaves an empty `query` (e.g. user typed only a country name), fall back to `query = trimmed` (no strip) so a bare country name still searches.
- `const url = buildPlaceSuggestUrl(MAPBOX_SEARCHBOX_BASE, token, query, sessionToken, { ...opts, country });`
- Fetch + normalize IDENTICALLY to `handleSuggest` (`:295-312`): map suggestions → `{placeId, displayName, fullAddress}`, `.slice(0, clampSuggestLimit(opts.limit))`. Same error contract (`suggest_exception`/`mapbox_<status>`).

**Handler switch:** add `case "suggest_places": return handleSuggestPlaces(token, body.query ?? "", sessionToken, searchOpts);`. `searchOpts` already carries `limit`; `proximity` stays supported but Preferences won't send it.

**UNCHANGED (byte-identical):** `handleSuggest`, `buildSuggestUrl`, `handleRetrieve`, `handleReverse`, `handleForward`, `featureToDetails`, `clampSuggestLimit`, CORS, `verify_jwt=true`, session logic.

### 4.2 Service — `packages/location-input/src/mapboxGeocodeService.ts` (ADDITIVE)

Add, alongside `autocompleteMapbox` (which stays byte-identical for business):
```
export async function autocompletePlacesMapbox(
  query, sessionToken, deps: { invoke }, bias?: { limit?: number; proximity?: string }
): Promise<PlaceAutocompleteSuggestion[]>
```
- Same shape/error contract as `autocompleteMapbox` but posts `action: "suggest_places"` and merges `limit` (and `proximity` only if a caller passes it — Preferences won't). Returns `[]` on failure.

### 4.3 Shared component — `packages/location-input/src/MapboxAddressInput.tsx`

**(a) `searchMode` prop.** Add `searchMode?: "venue" | "places"` (default `"venue"`). In `handleChangeText`, call `autocompletePlacesMapbox` when `searchMode === "places"`, else `autocompleteMapbox` (today's call — business path UNCHANGED). This is the only behavioral switch; default preserves business byte-identically.

**(b) Scrollable card list (F-5).** Add optional prop `ScrollComponent?: React.ComponentType<ScrollViewProps>`. In the card branch (`:454-469`), render the ROW LIST inside `Scroll = ScrollComponent ?? RNScrollView` with `style={{ maxHeight: tokens.dropdown.maxHeight }}`, `keyboardShouldPersistTaps="handled"`, `nestedScrollEnabled`, `showsVerticalScrollIndicator`. Move `maxHeight` from the outer `<View>` onto the ScrollView; keep the outer card `<View>` for border/bg/shadow/radius with `overflow:"hidden"` (radius clip). Status states (loading/no-results/offline) stay outside/above the scroll (single-row). Inline mode UNCHANGED.

**(c) Input text-clip (F-6).** In the TextInput style (`:494-501`): **remove `lineHeight: 24`** (let the platform compute the single-line box, which reserves descender space). Keep `fontSize:16`, `padding:0`. On Android replace `paddingVertical:0` with `textAlignVertical:"center"` (keep default `includeFontPadding` so descenders are reserved). Net: `{ flex:1, fontSize:16, color: tokens.text.input, padding:0, ...(Platform.OS==="android" ? { textAlignVertical:"center" } : null) }`. Preserve iOS + Android.

**Design contract (within existing DESIGN §1 tokens — no new visual language):** card scroll affordance uses the existing `dropdown` tokens; `maxHeight:280` (LIGHT) now bounds a scroll viewport instead of clipping; row markup, dividers, press states, a11y unchanged; ≥44pt row targets preserved (`paddingVertical:14`). Scroll indicator visible on overflow. No motion change.

### 4.4 Consumer wrapper — `app-mobile/src/components/location/MapboxAddressInput.tsx`

- Forward a new `searchMode?: "venue" | "places"` prop to the shared component (default `"venue"`).
- Inject `ScrollComponent={BottomSheetScrollView}` (re-exported from `../ui/BaseBottomSheet`; the sole-gorhom-consumer gate forbids importing `@gorhom/bottom-sheet` directly — use the re-export, mirroring `BottomSheetTextInput`). This makes the card list scroll correctly inside the gorhom bottom sheet.

### 4.5 Preferences host

- `PreferencesSectionsAdvanced.tsx` `LocationInputSection`: pass `searchMode="places"` to `MapboxAddressInput`; **remove** the `proximity={proximity}` prop and the `proximity` param from `LocationInputSection`'s props.
- `PreferencesSheet.tsx`: **remove** the `getLastKnownLocation()` proximity `useEffect` (`:315-331`), the `proximity` state (`:339`), and the `proximity={proximity}` pass to `<LocationInputSection>` (`:1199`). Field keeps `suggestLimit={8}`, `minQueryLength={4}`, and the I-1315 paywall wiring (UNTOUCHED).

### 4.6 CityPicker — CONDITIONAL on OQ-2 (recommended IN scope)
- `CityPickerSheet.tsx`: pass `searchMode="places"` (cities are places — drops POI noise). **Keep** its `proximity` as a weak tiebreak (defensible "cities near me"). No scroll change (dark/inline already scrolls in the sheet). If OQ-2 is declined, leave CityPicker entirely as-is.

---

## 5. Success criteria (observable, testable)

- **SC-1 (non-Lagos "lekki"):** With a non-Lagos device, typing "lekki" in the Preferences field returns **Lekki, Lagos, Nigeria** as row #1, POIs absent. *(Runtime-proven: probe B/E.)*
- **SC-2 (non-Lagos "lekki nigeria"):** Typing "lekki nigeria" returns **Lekki, Lagos, Nigeria** as row #1 (trailing "nigeria" stripped → `country=ng`). *(Proven: probe G/N.)* **This is the exact gap that let ORCH-1361 through.**
- **SC-3 (POIs dropped):** No `feature_type=poi` suggestion appears for a place-mode query.
- **SC-4 (no proximity):** The Preferences field sends no `proximity` param; results do not depend on device location.
- **SC-5 (business byte-identical):** A `suggest` request (business venue-name search) emits an upstream URL byte-identical to pre-1365; POIs still returned (e.g. "lekki" venue search still lists the restaurant). Split: **SC-5-iOS / SC-5-Android** (business apps).
- **SC-6 (safety, no over-strip):** "lekki phase" → Lekki Lagos still returned; "lekki london" → London returned (country-name-scoped strip). *(Proven: probes M/L.)*
- **SC-7 (scrollable list):** With 8 suggestions in Preferences, the user can scroll to and tap row 8. Split **SC-7-iOS / SC-7-Android** (gorhom gesture).
- **SC-8 (no text clip):** Typed text with descenders (e.g. "Abergavenny") shows full glyphs, not clipped. Split **SC-8-iOS / SC-8-Android**.
- **SC-9 (paywall preserved):** Free users still hit the I-1315 paywall on the locked GPS row; the field is unreachable for them.
- **SC-10 (retrieve/pick unchanged):** Picking a suggestion still resolves via `retrieve` and stores `custom_lat/custom_lng`.

---

## 6. Invariants

**Preserved:**
- **`I-MAPBOX-SUGGEST-NO-TYPES-FILTER` (ORCH-1079/INV-3)** — preserved for the BUSINESS `suggest` path. The gate `i-mapbox-suggest-no-types-filter.mjs` is SCOPED (not weakened) to prove `buildSuggestUrl` (business) contains no `types`/`country` filter, and that `handleSuggest` does not call `buildPlaceSuggestUrl`. Requires `[TEST-MOD-APPROVED ORCH-1365]`. Test: §7 T-5/T-6.
- **I-1315 (custom-location paywall)** — untouched (no edit to the `isLocked`/`onLockedTap`/paywall wiring). Test: existing `orch-1315-*` suite stays green.
- **`verify_jwt=true`, session billing, retrieve/reverse/forward** — unchanged.

**Narrowed / retired (orchestrator owns the flip at CLOSE):**
- **`I-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` (ACTIVE, registry:5720)** — RETIRE the "MUST bias by device proximity" mandate for the Preferences field (proximity DROPPED). Keep the multi-row-list requirement. If OQ-2 approved, CityPicker retains proximity-as-tiebreak. The CI test `orch-1361-preferences-location-multirow-bias.test.tsx` (asserts Preferences is proximity-biased) MUST be updated to assert the NEW contract (Preferences uses `searchMode="places"`, no proximity) — `[TEST-MOD-APPROVED ORCH-1365]`.

**New (DRAFT — flip ACTIVE at CLOSE):**
- **`I-PROPOSED-1365-CONSUMER-PLACE-SEARCH-TYPE-FILTERED` (DRAFT):** The consumer place-search (Preferences custom-location field; CityPicker if OQ-2) MUST route through the `suggest_places` edge action, which (a) applies `types=place,locality,neighborhood,region,district` via `buildPlaceSuggestUrl` (POIs excluded), (b) strips a recognized trailing country token from the query and applies it as a Mapbox `country` ISO filter, and (c) sends no proximity for the Preferences field. The BUSINESS `suggest` action / `buildSuggestUrl` / `autocompleteMapbox` stay byte-identical and filter-free. Enforcement: §7 tests + the scoped ORCH-1079 gate. Fails-on-revert: §9.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Place builder adds types + country + limit | `buildPlaceSuggestUrl(...,{country:"ng",limit:8})` | URL contains `&types=place,locality,neighborhood,region,district&country=ng&limit=8`, no `&proximity=` | edge (Deno, pure) |
| T-2 | Place builder omits country when absent | `buildPlaceSuggestUrl(...,{limit:8})` | URL has `&types=...&limit=8`, no `&country=` | edge |
| T-3 | Trailing country strip | `parseTrailingCountry("lekki nigeria")` | `{query:"lekki", country:"ng"}` | edge (Deno) |
| T-4 | Safety: non-country trailing word not stripped | `parseTrailingCountry("lekki phase")` / `("lekki london")` / `("lekki")` | `{query:"lekki phase"}` / `{query:"lekki london"}` / `{query:"lekki"}` (no country) | edge |
| T-5 | **Business byte-identical (fails-on-revert)** | `buildSuggestUrl(base,tok,"lekki",st,{})` | equals pre-1365 string `.../suggest?q=lekki&session_token=..&access_token=..&limit=5` exactly; no `types`/`country` | edge |
| T-6 | Gate: business builder is filter-free; handleSuggest never calls place builder | run scoped `i-mapbox-suggest-no-types-filter.mjs` | PASS (business clean); FAIL if a `types`/`country` is added to `buildSuggestUrl` | CI gate |
| T-7 | Service posts the right action | `autocompletePlacesMapbox("lekki nigeria",st,{invoke})` | invoke body `{action:"suggest_places", query:"lekki nigeria", session_token, limit?}`; `autocompleteMapbox` still posts `action:"suggest"` | service |
| T-8 | **Preferences uses places mode, no proximity (fails-on-revert; replaces ORCH-1361 proximity test)** | source-structure of `PreferencesSectionsAdvanced.tsx`/`PreferencesSheet.tsx` | `searchMode="places"` present; no `proximity=` threaded; `getLastKnownLocation` proximity effect removed | app-mobile jest |
| T-9 | Component routes by searchMode | render with `searchMode="places"` vs default | places → `autocompletePlacesMapbox`; default/venue → `autocompleteMapbox` (business unchanged) | component |
| T-10 | Card list scrolls | 8 results, `searchMode="places"`, card mode | ScrollComponent renders wrapping rows with `maxHeight`; row 8 reachable | component/UI eyeball |
| T-11 | Input no clip | type "Abergavenny" | no clipped descenders (iOS+Android eyeball on Plus account) | UI runtime |
| T-12 | Error/empty paths | suggest_places returns `[]` / 502 | field shows `no_results` / `offline` states (unchanged) | component |
| T-13 | Paywall preserved | free user opens Preferences | locked GPS row → paywall; field unreachable (I-1315) | runtime |

**Happy/error/edge coverage:** T-1/T-3/T-7 happy; T-5/T-12 error/no-regression; T-4/T-6 edge/safety.

---

## 8. Implementation order

1. **Edge:** add `countryNames.ts` (`COUNTRY_NAME_TO_ISO` + `parseTrailingCountry`) + tests T-3/T-4.
2. **Edge:** add `PLACE_SUGGEST_TYPES`, `buildPlaceSuggestUrl`, `handleSuggestPlaces`, switch case (`index.ts`) + tests T-1/T-2/T-5.
3. **Gate:** scope `i-mapbox-suggest-no-types-filter.mjs` to the business builder (`[TEST-MOD-APPROVED ORCH-1365]`) + self-test; wire T-6.
4. **Service:** add `autocompletePlacesMapbox` (`mapboxGeocodeService.ts`) + test T-7.
5. **Component:** add `searchMode` routing, `ScrollComponent` card scroll, TextInput clip fix (`MapboxAddressInput.tsx`) + tests T-9/T-10.
6. **Consumer wrapper:** forward `searchMode`, inject `BottomSheetScrollView`.
7. **Preferences:** `searchMode="places"`, drop proximity (host + parent) + test T-8 (replaces the ORCH-1361 proximity test, token-approved).
8. **CityPicker (if OQ-2):** `searchMode="places"`, keep proximity.
9. **CI:** add T-1..T-7 to the `orch-1361-location-suggestions-deno-tests` job (or a new `orch-1365-*` job); register the new/updated jest files in the paths filter.
10. **Registry:** DRAFT `I-PROPOSED-1365-CONSUMER-PLACE-SEARCH-TYPE-FILTERED`; note the ORCH-1361 invariant narrowing (orchestrator flips at CLOSE).

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** business venue search and consumer place search are DIFFERENT edge actions with DIFFERENT URL builders — a code-level wall, not a runtime flag.
- **Fails-on-revert tests (must FAIL on revert, PASS on restore):**
  - **T-5** (byte-identical `buildSuggestUrl`): re-add any `types`/`country` to the business builder → RED (also caught by the scoped gate T-6). Protects ORCH-1079 + SC-5.
  - **T-1/T-3** (place builder + strip): remove the `types` append or the trailing-country strip → RED. Protects SC-1/SC-2/SC-3.
  - **T-8** (Preferences places-mode, no proximity): re-introduce proximity threading or revert `searchMode` → RED. Protects SC-2/SC-4 and encodes the **"non-Lagos user finds Lekki Lagos"** contract that ORCH-1361 lacked.
- **The gap that let ORCH-1361 through:** its tests verified a simulated-Lagos happy path only. T-3 + T-8 + SC-2 make the non-Lagos two-word scenario a first-class, enforced criterion.
- **Protective comments:** each test file carries a header explaining WHY (business filter-free vs consumer place-filtered; proximity dropped; two-word strip) referencing this SPEC + the ORCH-1079 gate.

---

## 10. Open questions

- **OQ-1 (country map scope):** `COUNTRY_NAME_TO_ISO` — full ISO list + common aliases (uk/usa/uae + multiword "south africa"/"united kingdom"). Recommend a bounded static table in-repo. Confirm no locale/translation of country names is required for v1 (English-only trailing token). *Recommendation: English + top aliases; revisit if i18n needed.*
- **OQ-2 (CityPicker scope):** include CityPicker in `searchMode="places"` (recommended — drops POI noise) and keep its proximity as a weak tiebreak? Or leave CityPicker untouched to keep this ORCH minimal? *Recommendation: include with types filter, keep proximity.*
- **OQ-3 (empty-after-strip):** if a user types only a country name ("nigeria"), spec falls back to the un-stripped query. Confirm acceptable (returns the country/region) vs. a "type a place" hint.
- **OQ-4 (proximity as tiebreak for Preferences):** evidence shows types-filter makes proximity harmless; recommend DROP entirely (simpler, provably correct). Confirm no product desire for a nearby-tiebreak on the Preferences field.

---

## 11. Downstream routing

- **Next = mingla-implementor** (worktree `~/Desktop/mingla-orchs/1365-[location-search-relevance]/` on branch `1365-location-search-relevance`). Build per §8, honoring the allowlist below. Use `[TEST-MOD-APPROVED ORCH-1365]` when editing the ORCH-1079 gate and the ORCH-1361 proximity test.
- **Then = mingla-tester** — must runtime-prove SC-1/SC-2 for a NON-Lagos user (drive the field or hit the deployed `suggest_places` from a non-Lagos context), SC-5 business byte-identical, and eyeball SC-7/SC-8 on iOS + Android with a Mingla+ account (the field is I-1315-gated).
- **Then = orchestrator CLOSE** — flip `I-PROPOSED-1365-*` ACTIVE; retire/narrow `I-1361-CONSUMER-LOCATION-PROXIMITY-BIASED`; deploy the edge fn + curl-verify `suggest_places`; per-platform OTA; World Map + registry sync.

---

## Allowlist (implementor MAY modify) + DO-NOT-TOUCH

**Allowlist:**
- `supabase/functions/mapbox-geocode/index.ts` (ADDITIVE only — new action/builder/handler)
- `supabase/functions/mapbox-geocode/countryNames.ts` (NEW)
- `supabase/functions/mapbox-geocode/__tests__/*` (new ORCH-1365 test files; append)
- `.github/scripts/strict-grep/i-mapbox-suggest-no-types-filter.mjs` (scope only, `[TEST-MOD-APPROVED ORCH-1365]`)
- `packages/location-input/src/mapboxGeocodeService.ts` (ADDITIVE `autocompletePlacesMapbox`)
- `packages/location-input/src/MapboxAddressInput.tsx` (searchMode + ScrollComponent + TextInput fix)
- `app-mobile/src/components/location/MapboxAddressInput.tsx` (forward searchMode + inject scroll)
- `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` (searchMode, drop proximity prop)
- `app-mobile/src/components/PreferencesSheet.tsx` (drop proximity effect/state/pass)
- `app-mobile/src/components/discover/CityPickerSheet.tsx` (ONLY if OQ-2 approved)
- `app-mobile/src/components/__tests__/orch-1361-preferences-location-multirow-bias.test.tsx` (update to new contract, `[TEST-MOD-APPROVED ORCH-1365]`)
- `.github/workflows/supabase-migrations-and-stripe-deno.yml` (register ORCH-1365 tests)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (DRAFT the new invariant; note 1361 narrowing — orchestrator flips at CLOSE)

**DO-NOT-TOUCH:**
- `handleSuggest`, `buildSuggestUrl`, `handleRetrieve`, `handleReverse`, `handleForward`, `featureToDetails`, `clampSuggestLimit`, CORS, `verify_jwt` in `index.ts` (business/byte-identical paths).
- `autocompleteMapbox`, `retrieveMapboxPlace`, `reverse/forward` in the service.
- Any `mingla-business/**` file; buyer-web; admin.
- The I-1315 paywall wiring (`isLocked`/`onLockedTap`/`setShowPaywall`).
- `retrieve`/`reverse`/`forward` actions and Mapbox session billing.

Any change outside the allowlist → **stop-and-amend** (append here or `SPEC_AMENDMENT_ORCH-1365_*.md`).
