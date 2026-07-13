# INVESTIGATION — ORCH-1365 [location-search-relevance]

**Corrective to ORCH-1361.** Consumer Preferences custom-location search returns wrong/noisy
results for a non-Lagos user. Seth (London-region device) typed **"lekki nigeria"** and got
"Lekki London Nigerian Restaurant" + literal "Nigeria" places in Chad/Cameroon/South Africa/Chile —
**no Lekki, Lagos**. ORCH-1361 added a device-proximity ranking bias; that was the wrong lever.

- **Worktree:** `~/Desktop/mingla-orchs/1365-[location-search-relevance]/` on branch `1365-location-search-relevance` (rebased on origin/main, which contains shipped ORCH-1361 @ `e3d87c40b`).
- **Evidence:** `Mingla_Artifacts/evidence/ORCH-1365/live_edge_fn_reproduction.txt` (deployed-fn repro + direct Mapbox `/suggest` probes with the `types` filter, token from master-keys).
- **Confidence:** search root causes **PROVEN** (runtime-proven against the authoritative Mapbox upstream, non-Lagos origin). Scroll UI bug **CONFIRMED** (code-structural certainty). Field-text-clip UI bug **SUSPECTED** (source-reasoned; sim repro blocked — the field sits behind the I-1315 Mingla+ paywall, needs a Plus test account).

---

## Symptom summary (expected vs actual)

| | Expected | Actual (Seth, London device) |
|---|---|---|
| Type "lekki nigeria" | Lekki, Lagos, Nigeria near the top | "Lekki London Nigerian Restaurant" #1; literal "Nigeria" places in Chad/Cameroon/S.Africa/Chile; **no Lekki Lagos** |
| Type "lekki" | Lekki, Lagos #1 | Lekki Lagos present but mixed with POI noise (Lekki Dubai, Lekki STYL Poland, Lekki Kitchen Edgware); under London proximity, Lagos **buried entirely** |
| Suggestion list (8 rows) | Scrolls | Clips at maxHeight; rows past ~3.7 unreachable |
| Field text | Full glyphs visible | Descenders (g/y/p/j) clipped at the bottom of the input |

---

## Investigation manifest (files read, in trace order)

| # | File | Layer / why |
|---|------|-------------|
| 1 | `supabase/functions/mapbox-geocode/index.ts` | Edge fn — the shared suggest/retrieve/reverse/forward proxy; where ORCH-1361 added proximity/limit |
| 2 | `.github/scripts/strict-grep/i-mapbox-suggest-no-types-filter.mjs` | The ORCH-1079/INV-3 gate banning any `types` filter |
| 3 | `packages/location-input/src/MapboxAddressInput.tsx` | Shared field — card-mode list markup + TextInput style (both UI bugs live here) |
| 4 | `packages/location-input/src/mapboxGeocodeService.ts` | Service — `autocompleteMapbox` (suggest), no POI filtering anywhere |
| 5 | `packages/location-input/src/types.ts` | Token bundle shape (dropdown.mode/maxHeight, field.paddingVertical) |
| 6 | `app-mobile/src/components/location/MapboxAddressInput.tsx` | Consumer wrapper — LIGHT/DARK tokens; injects `BottomSheetTextInput`; card mode = light = Preferences only |
| 7 | `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | `LocationInputSection` host — passes `proximity`, `suggestLimit={8}`, `minQueryLength={4}` |
| 8 | `app-mobile/src/components/PreferencesSheet.tsx` | Parent — resolves `proximity` from `getLastKnownLocation()`; I-1315 paywall (`isLocked`) |
| 9 | `app-mobile/src/components/discover/CityPickerSheet.tsx` | Discover CityPicker — dark/inline variant; also threads proximity |
| 10 | `supabase/functions/mapbox-geocode/__tests__/*` + `.github/workflows/supabase-migrations-and-stripe-deno.yml` | Existing ORCH-1361 tests + CI job `orch-1361-location-suggestions-deno-tests` |
| 11 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | `I-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` (ACTIVE); `I-MAPBOX-SUGGEST-NO-TYPES-FILTER` (ORCH-1079); I-1315 |

---

## Q-scorecard

**Q1. Is the proximity bias backwards/wrong for the Preferences custom-location field?**
Verdict: **YES — CONFIRMED (proven).** The field is explicitly "a place you are NOT at" (there is a separate "Use my current location" GPS toggle in `LocationInputSection`). It threads the device proximity (`PreferencesSheet.tsx:320` → `getLastKnownLocation()` → `${lng},${lat}`), so a London device biases ranking to London and buries Lekki Lagos (evidence probe #3 on the deployed fn; probe E confirms types alone fixes it, so proximity adds only risk). See F-1.

**Q2. Is there POI noise, and does a place-type filter remove it?**
Verdict: **YES noise; YES a types filter fixes single-word.** No POI filtering exists anywhere (edge fn, service, or component). Direct Mapbox probe B: `types=place,locality,neighborhood,region,district` drops all POIs and returns Lekki Lagos #1 AND #2. See F-2.

**Q3. Does "lekki nigeria" rank worse than "lekki", and does the types filter alone fix it?**
Verdict: **Ranks worse; types filter ALONE does NOT fix it.** Probe D/F: with the types filter, "lekki nigeria" still returns only "Nigeria*" places — the trailing country word fuzzy-dominates and Lekki is dropped. The proven fix is to **strip the trailing country token** and re-query the leading part with the types filter (+ optional `country` ISO filter): probe G/N → Lekki Lagos #1/#2. See F-3.

**Q4. Can we give the consumer place-filtering while keeping business venue-name search filter-free (ORCH-1079/INV-3)?**
Verdict: **YES — via a new `suggest_places` action (Option A).** The shared `handleSuggest` (business) stays byte-identical + filter-free; a new `handleSuggestPlaces` carries the types filter. The ORCH-1079 gate must be scoped to the business builder (token-approved) so it still statically proves business is filter-free. See F-4 + Architecture.

**Q5. Is the card-mode suggestion list scrollable?**
Verdict: **NO — CONFIRMED.** Card mode wraps the rows in a `<View>` with `maxHeight` + `overflow:"hidden"` and no ScrollView (`MapboxAddressInput.tsx:454-469`). 8 rows exceed `maxHeight:280` and clip with no scroll. See F-5.

**Q6. What causes the field input text to clip at the bottom?**
Verdict: **The hardcoded `lineHeight:24` on the single-line TextInput + `padding:0`/Android `paddingVertical:0` inside an `overflow:"hidden"` row — SUSPECTED (source-reasoned).** See F-6.

**Q7. Does the CityPicker (Discover) share the same problem?**
Verdict: **Partially.** It shares the POI-noise + backwards-proximity class but is dark/inline (no scroll bug) and its "which city to browse" purpose makes proximity a more defensible default. Recommendation: apply the place-type filter there too; proximity-as-weak-tiebreak is acceptable. See F-7 (assessment; scope decision flagged for orchestrator).

---

## Findings (six-field evidence)

### F-1 — Device-proximity bias is backwards for the Preferences custom-location field · CONFIRMED ROOT CAUSE (proven)
1. **Symptom:** London device → "lekki" ranks all-London POIs; Lekki Lagos buried.
2. **Layer:** code (client host) + runtime (Mapbox).
3. **Probe:** read `PreferencesSheet.tsx:315-331` + `:1199`; `PreferencesSectionsAdvanced.tsx:249`; deployed-fn evidence probe #3 (London proximity) vs #2 (no proximity).
4. **Evidence:** `PreferencesSheet.tsx:320` `const loc = await enhancedLocationService.getLastKnownLocation();` → `:323` `setProximity(\`${loc.longitude},${loc.latitude}\`);` → passed to `LocationInputSection proximity={proximity}` (`:1199`) → field's suggest call. Deployed-fn probe #3 ("lekki" + London proximity) returned 8 London POIs, **zero** Lagos; probe #2 (no proximity) returned Lekki Lagos #1/#3. Direct Mapbox probe E proves that once the types filter is applied, Lagos is #1 **even with** London proximity — i.e. proximity is unnecessary.
5. **Mechanism:** the field is architecturally for a place the user is NOT at (separate GPS toggle exists), so biasing text ranking to the current device pushes the intended remote place down/out.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — No POI filtering exists; a place-type filter is required (and fixes single-word) · CONFIRMED ROOT CAUSE (proven)
1. **Symptom:** restaurants/apartments named "Lekki" mix into results ("Lekki London Nigerian Restaurant").
2. **Layer:** code (edge fn + service) contradicts the ORCH-1361 commit-message claim ("8 rows, POI-filtered").
3. **Probe:** read the full edge fn + service + component; direct Mapbox probes A vs B.
4. **Evidence:** `mapbox-geocode/index.ts` `handleSuggest`/`buildSuggestUrl` (`:171-187`, `:258-313`) append **no** `types`; `mapboxGeocodeService.ts autocompleteMapbox` (`:108-139`) does no client filtering; `MapboxAddressInput.tsx renderRows` (`:300-356`) renders every suggestion unfiltered. The "POI-filtered" claim appears only in the ORCH-1361 **commit message**, not the code, spec, or investigation. Direct probe B ("lekki" + `types=place,locality,neighborhood,region,district`) → Lekki Phase 2 #1, Lekki Phase 1 #2, POIs gone.
5. **Mechanism:** Mapbox `/suggest` defaults to ALL feature types (POIs included); without a types filter, name-matching POIs outrank the actual place.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-3 — Trailing country word ("lekki nigeria") defeats the types filter; must strip + country-bias · CONFIRMED ROOT CAUSE (proven)
1. **Symptom:** two-word "lekki nigeria" returns literal "Nigeria*" places, no Lekki — worse than "lekki".
2. **Layer:** runtime (Mapbox ranking).
3. **Probe:** direct Mapbox probes C/D/F/G/J/K/H/I/N (see evidence file).
4. **Evidence:** D ("lekki nigeria" + types, no prox) → #1 Nigeria Ferick (Chad), #2 Nigeriare (Cameroon), no Lekki. G ("lekki" + types + `country=ng`) → Lekki Phase 2 #1, Lekki Phase 1 #2. J (keep full "lekki nigeria" + types + country=ng) → still no Lekki. K (comma) and H/I (forward) both fail. N (strip + country=ng + London prox) → Lekki Lagos #1/#2 (robust).
5. **Mechanism:** Mapbox suggest fuzzy-matches the trailing token as a query term (returns "Nigeria" places) rather than reading it as country context; only removing the token from `q` and expressing it as the `country` filter restores the leading place.
6. **Severity:** CONFIRMED ROOT CAUSE. Remediation proven: strip a recognized trailing country token → re-query leading part + types (+ `country` ISO). Safety proven (L/M): only country names are stripped; cities/other words are preserved and still resolve.

### F-4 — ORCH-1079 gate scans the whole file, so any consumer `types` trips it · SECONDARY ROOT CAUSE (architecture blocker)
1. **Symptom:** a naive "add `types` to suggest" fix would fail CI and/or regress business venue search.
2. **Layer:** CI gate + code.
3. **Probe:** read `i-mapbox-suggest-no-types-filter.mjs` detectors.
4. **Evidence:** detectors `/\btypes\s*[=:]\s*["'\`]?(address|poi|place|category)/`, `/searchParams\.(set|append)\(\s*["']types["']/`, `/[?&]types=/` run against the ENTIRE file (`readSource(TARGET)` `:110-121`). `types=place,...` trips detector 1 (`types=place`) and detector 3 (`&types=`). The gate cannot distinguish a business builder from a consumer builder.
5. **Mechanism:** the guarantee ORCH-1079 protects is specifically that BUSINESS venue-name suggest returns POIs; a file-wide grep conflates that with any consumer `types` string.
6. **Severity:** SECONDARY ROOT CAUSE — dictates the architecture (separate action + scoped gate; see below).

### F-5 — Card-mode suggestion list has no ScrollView · CONFIRMED (code-structural certainty)
1. **Symptom:** 8-row list clips; only ~3–4 rows reachable.
2. **Layer:** code (shared component).
3. **Probe:** read `MapboxAddressInput.tsx:448-474` + LIGHT_TOKENS.
4. **Evidence:** card branch (`:454-469`) renders `{listContent}` inside a `<View style={{ ... overflow:"hidden", maxHeight: tokens.dropdown.maxHeight }}>` — no ScrollView. LIGHT_TOKENS `dropdown.maxHeight:280` (`app-mobile/.../location/MapboxAddressInput.tsx:106`); row height ≈ `paddingVertical:14`×2 + primaryLineHeight 24 + secondary 20 + gap ≈ 74px → 8 rows ≈ 590px, clipped at 280. Host comment (`PreferencesSectionsAdvanced.tsx:20-29`) explicitly says the dropdown "must use gorhom's BottomSheetScrollView" — but the shared component never received one.
5. **Mechanism:** `overflow:"hidden"` + fixed `maxHeight` + no scroll container = permanently clipped rows.
6. **Severity:** CONFIRMED. Card mode = LIGHT variant = Preferences ONLY (CityPicker is dark/inline, `maxHeight:9999`, rows flow into the sheet's own scroll → not affected).

### F-6 — Field TextInput descenders clip: hardcoded `lineHeight:24` + `padding:0` in an `overflow:hidden` row · SUSPECTED CONTRIBUTOR (source-reasoned)
1. **Symptom:** bottom of typed text (g/y/p/j descenders) clipped in the field.
2. **Layer:** code (shared component style).
3. **Probe:** read `MapboxAddressInput.tsx:274-298` (fieldStyle) + `:484-505` (TextInput). Sim repro **blocked** — the field is behind the I-1315 Mingla+ paywall (`PreferencesSheet.tsx:1202` `isLocked={!canAccess('custom_starting_point')}`); no Plus test account available.
4. **Evidence:** TextInput style `:494-501` = `{ flex:1, fontSize:16, lineHeight:24, padding:0, ...(Android ? {paddingVertical:0} : null) }`; parent `fieldStyle` has `overflow:"hidden"` (`:283`) + `alignItems:"center"` + `paddingVertical:14`.
5. **Mechanism:** forcing an explicit `lineHeight` on a single-line RN TextInput renders the glyph in a collapsed line box (padding:0); iOS/Android position the baseline such that descenders extend past the line box and get clipped by the row's `overflow:hidden`. Removing the forced `lineHeight` (let the platform compute the natural box, which reserves descender space) is the standard remedy.
6. **Severity:** SUSPECTED CONTRIBUTOR. Fix is low-risk (drop the forced lineHeight; keep fontSize:16); tester must eyeball on a Plus account across iOS + Android.

### F-7 — CityPicker (Discover) shares the class but is milder · RULED OUT as the reported bug; assessment only
1. **Symptom:** none reported; assessment requested by dispatch.
2. **Layer:** code.
3. **Probe:** read `CityPickerSheet.tsx` fully.
4. **Evidence:** dark variant → `dropdown.mode:"inline"` (no card, no scroll bug); threads proximity from `getLastKnownLocation()` (`:79-95`); writes only `discover_city_*` (`:117-140`); no types filter (shares the POI-noise class). Purpose = pick a city to browse (often near you), so proximity is a defensible default, unlike the Preferences "a place I'm not at" field.
5. **Mechanism:** same shared suggest path, but the UX intent differs.
6. **Severity:** not the reported bug. **Recommendation:** include CityPicker in the place-type filter (cities are places; POIs are noise), keep its proximity as a WEAK tiebreak. Flagged as an orchestrator scope decision (OQ-2).

---

## Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | ORCH-1361 commit message claims the list is "8 rows, POI-filtered" and the invariant `I-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` mandates proximity bias. **Both are wrong for this field.** |
| **Schema** | n/a (no DB change; CityPicker writes `discover_city_*` only — untouched). |
| **Code** | No POI filtering exists anywhere; proximity is threaded and biases ranking; card list has no scroll container; TextInput forces `lineHeight:24`. |
| **Runtime** | Direct Mapbox probes: types filter fixes "lekki" (B/E); does NOT fix "lekki nigeria" without trailing-country stripping (D/F vs G/N). |
| **Data** | n/a. |

**Contradiction flagged:** Docs (commit "POI-filtered") vs Code/Runtime (no filter, POIs present). **Truth = Code/Runtime.** The ACTIVE invariant `I-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` (registry line 5720) mandates the exact wrong behavior — ORCH-1365 must retire/narrow it (orchestrator owns the flip).

---

## Repro evidence

- **Deployed edge fn** (evidence file, top section): confirms proximity buries Lagos; unbiased ranks Lagos #1 but with POI noise.
- **Direct Mapbox `/suggest`** (evidence file, appended section): the authoritative upstream, run from a non-Lagos origin and re-tested with explicit London proximity. Proves the PROPOSED fix (types filter + trailing-country strip + `country` bias, NO proximity) returns **Lekki, Lagos, Nigeria #1** for BOTH "lekki" and "lekki nigeria" — the exact scenario ORCH-1361 failed. This is stronger than a sim repro (the sim would just call this same upstream through the proxy).
- **UI bugs:** scroll bug proven structurally from code (no ScrollView). Field-text-clip: sim repro blocked by the I-1315 paywall (needs a Plus test account) — capped SUSPECTED with a precise code diagnosis.

---

## Blast radius / cross-surface map

| Surface | In scope? | Why |
|---|---|---|
| Consumer iOS/Android (`app-mobile/`) | **YES** | Preferences custom-location field (both root causes + both UI bugs); CityPicker (types filter, proximity decision) if OQ-2 approved |
| Business iOS/Android (`mingla-business/`) | **NO (must stay byte-identical)** | Venue/address pickers use `handleSuggest`/`autocompleteMapbox` filter-free — the exact path that MUST NOT change (ORCH-1079/INV-3) |
| Buyer/anon Web (`mingla-business/` checkout/e/b/t) | **NO** | No location autocomplete surface |
| Admin Web / Business Web preview | **NO** | No consumer location search |

**Shared code touched:** `packages/location-input/*` (used by BOTH apps) — changes MUST be additive/opt-in (new action + new prop default off) so the business consumer of the shared package is unchanged. Edge fn `mapbox-geocode` shared by both apps — new action is additive; existing actions byte-identical.

---

## Invariant impact (flagged, not resolved)

- **`I-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` (ACTIVE, registry:5720)** — its "MUST bias by device proximity" mandate for the Preferences field is **REVERSED** by this ORCH. Must be narrowed/retired at CLOSE. Its CI test `orch-1361-preferences-location-multirow-bias.test.tsx` asserts "Preferences … biased by resolved device proximity" and will go RED when proximity is dropped → test modification requires the `[TEST-MOD-APPROVED ORCH-1365]` token. The multi-row-list part of the invariant remains valid.
- **`I-MAPBOX-SUGGEST-NO-TYPES-FILTER` (ORCH-1079/INV-3)** — MUST remain provably true for the BUSINESS `suggest` action. The gate must be scoped (token-approved) to guard the business `buildSuggestUrl` specifically, while permitting `types` in the new consumer `buildPlaceSuggestUrl`.
- **I-1315 (custom-location paywall)** — MUST be preserved untouched.

---

## Discoveries for orchestrator

1. The ORCH-1361 commit message overstated the fix ("POI-filtered") — no filtering ever shipped. Process note: verify the "POI-filtered" claim class in future closes.
2. ORCH-1361 verified only a simulated-Lagos happy path; the missing test was "a NON-Lagos user finds Lekki Lagos." ORCH-1365's regression suite must include exactly that (see SPEC §9).
3. `enhancedLocationService.getLastKnownLocation()` proximity plumbing in `PreferencesSheet.tsx:315-331` becomes dead once proximity is dropped from Preferences — spec removes it for cleanliness.

---

## Confidence + recommended next phase

- **Search root causes (F-1/F-2/F-3/F-4): PROVEN** (authoritative Mapbox upstream, non-Lagos origin).
- **Scroll UI bug (F-5): CONFIRMED** (code-structural).
- **Field-text-clip (F-6): SUSPECTED** (source-reasoned; paywall-blocked sim repro).
- **Recommended next phase:** SPEC (this dispatch is IA — SPEC follows immediately below as `SPEC_ORCH-1365_LOCATION_SEARCH_RELEVANCE.md`). Recommended scope: Option A architecture (new `suggest_places` action, business `suggest` byte-identical), drop proximity for Preferences, strip trailing country token + `country` bias, two UI fixes, scoped ORCH-1079 gate + retired ORCH-1361 proximity invariant — all with the `[TEST-MOD-APPROVED ORCH-1365]` token where an existing test/gate is edited.
