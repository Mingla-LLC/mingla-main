# IMPLEMENTATION — ORCH-0809 Slice M1 — Discover Ticketmaster Filter Expansion v1

**ORCH-ID:** ORCH-0809 (renumbered from initially-registered ORCH-0807 — collision found during pre-flight; see §Discoveries)
**Slice:** M1 of 3 (DB schema + server constants + edge function v2 + client types + service signature)
**Status:** implemented and verified (M1 scope only)
**Verification:** Deno typecheck PASS, tsc PASS on touched files, zero new compile errors, no tests run (M3)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0809_DISCOVER_TICKETMASTER_FILTER_EXPANSION_V1.md`
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0809_DISCOVER_TICKETMASTER_FILTER_EXPANSION_V1.md`

---

## §1 Mission Recap

M1 ships the backend-only contract for the four-deliverable ORCH-0809: a database migration adding five nullable `discover_city_*` columns to `public.preferences`, a server-owned Ticketmaster classification ID file (segments verified, genres deferred to M2 per SPEC §5.3's "remove unverified slugs" provision), an additive-and-backward-compatible edge-function v2 rewrite (city + segment slug + genre slugs + `localStartEndDateTime` + automatic <5-result lat/lng fallback + v2 cache key prefix), the new client types module, the `UserPreferences` type extension, and a service-layer `search(input)` signature alongside a `[TRANSITIONAL]` `getEvents(location, options)` adapter that keeps DiscoverScreen's existing fetch call working until M2 surgery lands.

M1 changes NO Discover UI behavior. The price filter remains visible, the segment selector does not exist yet, the city picker does not exist yet, dates still flow through the v1 UTC path on the wire. App still works exactly as it did pre-M1.

## §2 Files Changed (Old → New Receipts)

### File 1 — `supabase/migrations/20260601000001_orch_0809_discover_city_preferences.sql` (NEW)

**What it did before:** N/A
**What it does now:** Adds 5 nullable columns to `public.preferences`: `discover_city_name text`, `discover_city_state_code text`, `discover_city_country_code text`, `discover_city_lat numeric`, `discover_city_lng numeric`. Includes column comments documenting purpose + ORCH ID. Apply-time `DO $$` verification probe RAISES if any column missing post-apply.
**Why:** SPEC §5.1 — persist user's Discover city selection so it survives sign-out.
**Lines:** 55
**Monotonic filename:** `20260601000001` is strictly greater than the latest existing prefix `20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql`. Verified via `ls supabase/migrations/ | sort | tail`.
**RLS:** No new policies. Existing `preferences_owner_*` policies cover the new columns via `user_id = auth.uid()` predicates (additive nullable columns inherit policy coverage).
**Awaits `supabase db push`:** YES — operator runs `supabase db push --linked` to apply. Implementor MUST NOT call `mcp__supabase__apply_migration`.

### File 2 — `supabase/functions/_shared/ticketmasterClassifications.ts` (NEW)

**What it did before:** N/A
**What it does now:** Exports `DiscoverSegmentSlug` (M1: `"music" | "sports"` only), `DiscoverGenreSlug` (full 16-slug union retained — slugs without TM IDs degrade to "segment only" filtering per SPEC §5.3), `DISCOVER_SEGMENT_ID` (Music + Sports verified IDs), `DISCOVER_GENRE_ID` (empty maps for M1 — M2 populates after operator runs the verification curl), and `resolveTmClassification(segmentSlug, genreSlugs)` which returns `{ segmentId, genreIds }` with safe-default-to-Music for unknown segments and silent-drop for unmapped genres.
**Why:** SPEC §5.3 — server-owned classification authority so the client never ships TM IDs (Constitution #2). Slice M1 explicitly defers Arts & Theatre / Comedy / Family / Film segments to M2 pending operator verification curl, per the SPEC's "remove unverified slugs" provision.
**Lines:** 94
**Verification source:** Music ID matches the legacy hardcoded constant on the prior `ticketmaster-events/index.ts:16` (`KZFzniwnSyZfZ7v7nJ`). Sports ID `KZFzniwnSyZfZ7v7nE` resolved via WebFetch of the public Ticketmaster Discovery API developer documentation.
**No `"VERIFY"` literals shipped** — satisfies SPEC §9 Gate 2 Check 3 trivially in this slice.

### File 3 — `supabase/functions/ticketmaster-events/index.ts` (REWRITTEN)

**What it did before:** Accepted `{ location, radius, keywords, startDate, endDate, sort, page, size }`. Hardcoded `segmentId = MUSIC_SEGMENT_ID`. Computed cache key as `geo:lat:lng:kw:keywords:d:startDate` at 0.1° precision. Used UTC `startDateTime`/`endDateTime`. Computed haversine distance against the request's lat/lng.

**What it does now:**
- **Backward-compat detection:** if no `city` and no `segmentSlug` are passed, behaves exactly as before — defaults to Music segment, uses `latlong`+`radius`, accepts v1 UTC `startDate`/`endDate`.
- **v2 request shape (additive):** accepts `city`, `stateCode`, `countryCode`, `segmentSlug`, `genreSlugs[]`, `localStartEndDateTime`, `latFallback`, `lngFallback`, `radiusFallback`.
- **Classification resolution:** server-side via `resolveTmClassification(segmentSlug, genreSlugs ?? [])` — client never ships TM IDs.
- **TM URL builder:** prefers `city`+`stateCode`+`countryCode`; falls back to `latlong`+`radius`+`unit=km` when no city; segmentId always set; genreId joined when present; `localStartEndDateTime` preferred over UTC pair.
- **<5-result lat/lng fallback:** when city-mode returns fewer than 5 results AND `latFallback`/`lngFallback` are present, automatically re-queries with lat/lng and returns the larger result set with `meta.usedFallback = true`.
- **v2 cache key:** `v2:city:<city>:<stateCode>:<countryCode>:seg:<segmentId>:gen:<genreIds>:kw:<keywords>:dt:<dt>` for city mode, `v2:geo:<lat0.1>:<lng0.1>:seg:...` for lat/lng mode. v1 cache rows expire naturally over 2h TTL (no manual flush).
- **Distance nullable:** `TicketmasterEvent.distance: number | null`. Null when city-mode is used (no haversine anchor). Distance computed only when an anchor (lat/lng or fallback lat/lng) is present.
- **Input validation:** 400 on missing-both city-and-location, 400 on malformed `localStartEndDateTime` format (regex `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2},\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/`).
- **Rate-limit / 5xx stale-cache fallback:** preserved unchanged from v1.
- **Fire-and-forget cache write:** restructured as `async` IIFE with try/catch to fix the Deno type error `Property 'catch' does not exist on type 'PromiseLike<void>'` introduced by the original chained `.then().catch()` pattern.

**Why:** SPEC §5.2 — all four scope items (city, segments, local-time, fallback) wire through this single function.
**Lines:** 555 (vs 478 in v1) — 77 net new lines.
**Deno typecheck:** PASS (`/Users/sethogieva/.deno/bin/deno check supabase/functions/_shared/ticketmasterClassifications.ts supabase/functions/ticketmaster-events/index.ts` exit 0).
**Edge deploy:** orchestrator-owned. Recommended deploy command (after `supabase db push --linked` confirms migration is live):
```
/Users/sethogieva/bin/supabase functions deploy ticketmaster-events --project-ref gqnoajqerqhnvulmnyvv
```

### File 4 — `app-mobile/src/types/discoverFilters.ts` (NEW)

**What it did before:** N/A
**What it does now:** Exports `DiscoverSegmentSlug` (M1: `"music" | "sports"`), `DiscoverGenreSlug` (16-slug union retained — slugs map to "no genre filter" when ID not yet resolved), `GENRES_BY_SEGMENT` map (drives M2's context-aware genre chips), `DiscoverCity` interface (5 fields denormalized from Google Places autocomplete).
**Why:** SPEC §5.5 — client owns slug taxonomy; server owns ID resolution.
**Lines:** 64

### File 5 — `app-mobile/src/types/preferences.ts` (EXTENDED)

**What it did before:** 31-line `UserPreferences` interface with core preference + location + intents + ORCH-0434 fields.
**What it does now:** Same interface plus 5 new optional fields: `discover_city_name?: string | null`, `discover_city_state_code?: string | null`, `discover_city_country_code?: string | null`, `discover_city_lat?: number | null`, `discover_city_lng?: number | null`. Comment block documents the persistence semantics and the M2 dependency on CityPickerSheet.
**Why:** SPEC §5.6 — client mirror of the DB migration fields.
**Lines changed:** +10

### File 6 — `app-mobile/src/services/nightOutExperiencesService.ts` (REWRITTEN)

**What it did before:** Single `static async getEvents(location, options)` method invoking `ticketmaster-events` with v1 body shape.
**What it does now:**
- New primary method `static async search(input: NightOutSearchInput): Promise<NightOutSearchOutput>` accepting the v2 shape (city OR location, segment slug, genre slugs, local-time date pair, free-text keywords). Validates "exactly one of city or location" client-side. Emits v2 body. Returns events + `meta.usedFallback`.
- **`[TRANSITIONAL]` adapter** `static async getEvents(location, options)` preserved — calls the edge function with the EXACT v1 body shape so the existing `DiscoverScreen.tsx:911-956` callsite continues to work unchanged through Slice M1. Exit condition: M2 lands DiscoverScreen surgery and deletes this adapter.
- **Type changes:** `NightOutVenue.distance: number | null` (was `number?`) reflecting the edge function's nullable distance for city-mode. `EventsMeta` gains `usedFallback: boolean`.

**Why:** SPEC §5.4 — client never ships TM IDs. v1 adapter exists for M1-only continuity per implementor contract Prime Directive 3 ("subtract before adding" — but only when the subtraction is in scope; here M2 owns the DiscoverScreen migration).
**Lines:** 217 (vs 107 v1).

### File 7 — `app-mobile/src/components/DiscoverScreen.tsx` (1-LINE ADJUSTMENT)

**What it did before:** `distance: venue.distance` in `transformNightOutVenue` mapping.
**What it does now:** `distance: venue.distance ?? undefined` — coerces the new `null` shape back to `undefined` for `NightOutCardData` whose `distance` is typed as `number | undefined`.
**Why:** Required by the M1 type change to `NightOutVenue.distance: number | null`. The full DiscoverScreen surgery (city chip, segment switcher, price-filter removal, local-time date math, fetch callsite migration to `search()`) is M2 work and is intentionally NOT in M1.
**Lines changed:** 1 (plus 2 lines of explanatory comment)

## §3 SPEC Deviations

### SD-1 — `segmentId` / `genreIds` field naming

**SPEC §5.2** typed the edge function request fields as `segmentId?: string` and `genreIds?: string[]` with a comment saying "TM segment ID from server-owned map." This contradicts SPEC §5.3 + §5.4 + §5.5 which establish that the client never ships TM IDs.

**Resolved during implementation:** edge function accepts `segmentSlug` and `genreSlugs[]` (the names already used by the client service and the shared classification helper). Server resolves to TM IDs via `resolveTmClassification`. This honors the constitutional principle the SPEC itself sought to establish.

**Downstream impact:** None — no other caller exists. Documented here so the orchestrator can update the SPEC §5.2 text on CLOSE to match the implementation.

### SD-2 — Slugs deferred to M2 (per SPEC §5.3 permission)

**SPEC §5.3** explicitly permits: "If any classification cannot be verified, the slug is removed from `DISCOVER_GENRE_ID`. The chip then renders but the genre filter degrades to 'segment only' — acceptable."

**Applied:** M1 ships only `"music" | "sports"` in `DiscoverSegmentSlug` (segments verified via the legacy Music ID + WebFetch of public TM docs for Sports). Arts & Theatre / Comedy / Family / Film stay out of the slug union until M2 + operator verification curl. `DISCOVER_GENRE_ID` ships empty maps. No `"VERIFY"` literal appears anywhere — strict-grep Gate 2 Check 3 is trivially satisfiable in M1.

**M2 dependency:** operator runs:
```
curl 'https://app.ticketmaster.com/discovery/v2/classifications.json?apikey=$TICKETMASTER_API_KEY&size=200' | jq '._embedded.classifications[]'
```
and pastes the relevant segment + genre IDs into `DISCOVER_SEGMENT_ID` and `DISCOVER_GENRE_ID`. The slug union extends in lockstep.

### SD-3 — `[TRANSITIONAL]` legacy `getEvents` adapter

**SPEC §5.4** says: "The legacy `getEvents(location, options)` signature is **deleted** because Discover is the only caller (verified via grep)."

**Deviation:** kept as a `[TRANSITIONAL]` adapter through Slice M1 to avoid breaking the running app between M1 ship and M2 ship. The adapter passes v1 wire format unchanged — no behavioral drift. Adapter is marked with the required `// [TRANSITIONAL]` comment + exit condition (M2 DiscoverScreen surgery) per the Code Quality Contract.

**Removal:** M2 deletes this adapter as part of the DiscoverScreen migration to `search()`.

## §4 Verification Matrix

| Spec criterion | M1 status | Method |
|---|---|---|
| SC-1 GPS-default city populates within 5s | DEFERRED M2 | CityPickerSheet + reverse-geocode wiring is M2 scope |
| SC-2 City picker persists 5 columns to preferences | DEFERRED M2 | CityPickerSheet is M2 scope |
| SC-3 City persists across sign-out | DEFERRED M2 | Requires SC-2 |
| SC-4 Segment switcher surfaces Sports / Comedy events | PARTIAL — wire path exists; Music + Sports IDs ready; UI is M2 | Edge function accepts `segmentSlug`. Verified via Deno typecheck. Manual TM real-fire is M2 dependency. |
| SC-5 Hip-Hop / R&B genre returns only that genre | DEFERRED M2 | Requires verified genre IDs (operator curl) |
| SC-6/SC-7 Local-time date chips | PARTIAL — wire path exists; UI math change is M2 | Edge function accepts and prefers `localStartEndDateTime`. Discover still emits UTC via v1 adapter; M2 swaps. |
| SC-8 Price filter UI gone | DEFERRED M2 | DiscoverScreen surgery is M2 |
| SC-9 v1 edge function shape still works | VERIFIED | Backward-compat detection in handler. Confirmed via code-read. Deno test in M3. |
| SC-10 Fallback when city <5 results | VERIFIED in code | Handler retries with `latFallback`/`lngFallback` when present; sets `meta.usedFallback`. Real-fire validation is M3 tester. |
| SC-11 Cache key isolation by segment+genre+city+window | VERIFIED in code | `buildCacheKey` includes all four. Deno test in M3. |
| SC-12 No `"VERIFY"` literal in classifications file | VERIFIED | grep `"VERIFY"` in `ticketmasterClassifications.ts` returns zero. |
| SC-13 No `KZFzniwn` literal in `app-mobile/` | VERIFIED | grep returns zero hits in `app-mobile/src/`. |
| SC-14 No UTC `startDateTime` in Discover path | DEFERRED M2 | DiscoverScreen still computes UTC via v1 adapter; M2 swaps to `toLocalISO`. |
| SC-15 Useful "set your city" prompt for edge-case user | DEFERRED M2 | DiscoverScreen UI work |

## §5 Invariant Verification

| Invariant | Status | Notes |
|---|---|---|
| Constitution #2 One owner per truth | PRESERVED | TM classification IDs live only in `_shared/ticketmasterClassifications.ts`. Client ships slugs only. |
| Constitution #3 No silent failures | PRESERVED | Edge function still 4xx/5xx with structured error bodies; cache write failures logged. Price filter removal is M2. |
| Constitution #4 One key per entity | PRESERVED | Cache key `v2:` prefix coexists with v1 `geo:` without collision. |
| Constitution #9 No fabricated data | PRESERVED | `distance: number \| null` returns null in city-mode rather than fabricating from city centroid. |
| Constitution #13 Exclusion consistency | PRESERVED | The same slug→ID resolution applies whether the call comes via v1 or v2 wire shape. |
| I-LOCATION-INVALIDATE-ON-LOCATION-ONLY (`useUserLocation.ts:148`) | UNTOUCHED | The guard at lines 145-150 was not touched. Location query key is unchanged. |
| Zustand-persist no server snapshots | N/A — M2 work | DiscoverCity persistence happens via React Query's preferences cache + DB write, not Zustand persist. |
| I-PROPOSED-BH DISCOVER_CITY_PERSISTED | DRAFT — schema ready | DB columns + edge function support shipped; persistence flip happens in M2 with CityPickerSheet. Will flip ACTIVE on ORCH-0809 CLOSE. |
| I-PROPOSED-BI DISCOVER_TM_CLASSIFICATION_BY_ID | DRAFT — server resolver ready | Resolver shipped. Music + Sports IDs verified. Genre IDs deferred to M2. Will flip ACTIVE on CLOSE. |
| I-PROPOSED-BJ DISCOVER_TM_LOCAL_TIME_WINDOWS | DRAFT — wire path ready | Edge function prefers `localStartEndDateTime` when provided. DiscoverScreen still sends UTC via v1 adapter; M2 swaps. Will flip ACTIVE on CLOSE. |

## §6 Gates Run

- **Deno typecheck:** PASS (`deno check` on both new + rewritten edge function files; exit 0).
- **tsc (app-mobile):** PASS on the four touched mobile files (`discoverFilters.ts`, `preferences.ts`, `nightOutExperiencesService.ts`, `DiscoverScreen.tsx`). No new errors introduced. Pre-existing repo-wide tsc errors in unrelated files are not in scope for this slice.
- **Strict-grep gates:** NOT RUN — Gate 1 / Gate 2 / Gate 3 scripts are M3 deliverables. M1 does not include the gates because the implementation is not yet complete (e.g. price filter still present, DiscoverScreen still uses UTC date helper).
- **Deno tests:** NOT RUN — test suite is M3 deliverable.
- **Jest tests:** NOT RUN — test suite is M3 deliverable.

## §7 Discoveries for Orchestrator

- **ORCH-ID collision (registered + resolved during this implementation):** The orchestrator session that registered "ORCH-0807 Discover Ticketmaster Filter Expansion v1" failed to grep `supabase/migrations/` before assigning the ID. The migration directory already had `20260531000000_orch_0807_brand_avatars_storage.sql` (a different work item, possibly ORCH-0805-A renumbered). Renumbered the Discover work to **ORCH-0809** during pre-flight. Files renamed: SPEC, dispatch prompt, WORLD_MAP entry, MASTER_BUG_LIST entry, PRIORITY_BOARD entry. Process recommendation: META-ORCH for orchestrator to grep `supabase/migrations/` + `.github/scripts/strict-grep/` for `orch-NNNN` patterns BEFORE assigning a new ORCH-ID — relying on World Map alone is insufficient because implementor work writes migrations + strict-grep scripts using ORCH-IDs that may not yet be reflected in the World Map.
- **SPEC §5.2 field naming inconsistency:** documented as SD-1 above. SPEC should be amended on CLOSE.
- **TM API verification operator dependency:** M2 needs the operator to run a one-shot curl against TM `/discovery/v2/classifications.json` with the `TICKETMASTER_API_KEY` to harvest segment + genre IDs for the four deferred segments and the music/sports genres. Recommend the operator generate that output before dispatching M2 so the implementor can complete in a single pass.
- **Migration apply gate:** operator must run `supabase db push --linked` before M2 ships (the M2 CityPickerSheet code will write to columns that don't exist yet without the push).

## §8 Regression Surface (M1 only)

M1 changes the wire format of the `ticketmaster-events` edge function in a backward-compatible way. The risks to monitor on deploy:

1. **Existing Discover fetch** — still routes through `getEvents` adapter → v1 wire shape. Should be byte-identical to today's behavior. Watch for: zero-result spikes, latency regression, cache miss spikes (would indicate the v1/v2 cache key path branches wrong).
2. **Cache key drift** — v1 cache rows expire naturally over 2h TTL. During the transition window, both v1 (`geo:`) and v2 (`v2:geo:`) keys coexist with no collision. Manual verification: query `ticketmaster_events_cache` and confirm coexistence.
3. **Any other caller of `ticketmaster-events`** — cross-domain blast probe required before deploy: `grep -rn "ticketmaster-events" app-mobile/ mingla-admin/ mingla-business/`. M1 expects exactly one consumer (DiscoverScreen via the service). If anything else surfaces, scope review required.

## §9 Cross-Domain Blast Probe (pre-deploy)

Run before edge function deploy:

```bash
grep -rn "ticketmaster-events" app-mobile/ mingla-admin/ mingla-business/ supabase/
grep -rn "NightOutExperiencesService" app-mobile/ mingla-admin/ mingla-business/
grep -rn "discover_city_" app-mobile/ mingla-admin/ mingla-business/ supabase/migrations/
grep -rn "ticketmasterClassifications" supabase/ app-mobile/ mingla-admin/ mingla-business/
grep -rn "KZFzniwn" app-mobile/ mingla-admin/ mingla-business/
```

Expected:
- `ticketmaster-events` returns the edge function itself + `nightOutExperiencesService.ts` only.
- `NightOutExperiencesService` returns the service + `DiscoverScreen.tsx` only.
- `discover_city_` returns the migration + `preferences.ts` only.
- `ticketmasterClassifications` returns the new file + the edge function import only.
- `KZFzniwn` returns ZERO hits in `app-mobile/`/`mingla-admin/`/`mingla-business/` (proves Constitution #2 compliance).

## §10 Operator Gates Awaiting

- **`supabase db push --linked`** — to apply `20260601000001_orch_0809_discover_city_preferences.sql` to remote.
- **Edge function deploy** — orchestrator runs `supabase functions deploy ticketmaster-events --project-ref gqnoajqerqhnvulmnyvv` AFTER the migration is live (the function imports from `_shared/ticketmasterClassifications.ts`; safe to deploy independently because the v1 adapter still works without the new DB columns).
- **TM classifications curl** — operator runs the curl referenced in §SD-2 and provides output before M2 dispatch.

## §11 Transition Items

| Item | Why | Exit Condition |
|---|---|---|
| `getEvents(location, options)` adapter in `nightOutExperiencesService.ts` | Keeps DiscoverScreen working through Slice M1 without behavioral change | Slice M2 lands DiscoverScreen surgery using `search()` |
| Empty `DISCOVER_GENRE_ID` maps in `ticketmasterClassifications.ts` | M1 ships only verified IDs (Music + Sports segments) | Slice M2 populates after operator runs the TM `/classifications` curl |
| Sparse `DiscoverSegmentSlug` union (`"music" \| "sports"`) | M1 ships only verified segments | Slice M2 extends to include `arts-theatre`, `comedy`, `family`, `film` |
| UTC date format on the wire from DiscoverScreen | DiscoverScreen still uses v1 adapter → v1 UTC `startDate`/`endDate` | Slice M2 migrates to `localStartEndDateTime` |

## §12 Next Slice (M2) Scope Preview

- DiscoverScreen surgery: city chip + segment switcher + price filter removal + local-time date math (`toLocalISO`) + fetch callsite migration to `search()`
- `CityPickerSheet` component (new file)
- `geocodingService.reverseGeocode(lat, lng)` exposure or addition
- Preferences write path: read + upsert all five `discover_city_*` columns
- Delete the `[TRANSITIONAL]` `getEvents` adapter
- Add the remaining four segment IDs + verified genre IDs to the server constants (depends on operator curl output)

## §13 Next Slice (M3) Scope Preview

- Three strict-grep gates: `orch-0809-no-discover-price-filter`, `orch-0809-tm-classification-by-id`, `orch-0809-tm-local-time-window`
- Workflow registration: new jobs in `.github/workflows/strict-grep-mingla-business.yml` (or the mobile parallel mirror — implementor verifies which workflow file covers `app-mobile/` paths)
- Deno tests (T-08 v1 pass-through, T-09 v2 city path, T-10 fallback path, T-11 cache key isolation, T-12-13-14 negative greps via integration)
- Jest tests (T-01 first-paint default, T-02 city persistence, T-04-05 segment + genre verification once IDs land)
- Slug-parity Deno test (client `DiscoverGenreSlug` matches server `DISCOVER_GENRE_ID` keys)
- iOS / Android / Web parity smoke (tester)
- Negative-control proofs for all three strict-grep gates

---

**End of M1 report. Awaiting operator approval to proceed to M2 (DiscoverScreen surgery + CityPickerSheet) or hand back to Codex for M2/M3 continuation.**
