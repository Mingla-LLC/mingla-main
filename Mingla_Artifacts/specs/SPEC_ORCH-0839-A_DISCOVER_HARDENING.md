# SPEC — ORCH-0839-A: Discover server + client hardening (TM pagination fix, meta-consistency, date-window math, mobile cache removal, Tonight semantics, tmError surface)

**Mode:** SPEC (no product code, no migrations, no deploys)
**Spec writer:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Parent investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0839_DISCOVER_EVENTS_FILTERS_AND_CHECKOUT_PIPELINE.md`

**Related artifacts:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0835_0836_0837_BUNDLED_DISCOVER_LOGBOX_STRIPE_CARDONLY.md` — this spec SUPERSEDES the cache-symmetry portion of ORCH-0835. The `businessEvents.length > 0` guard added by ORCH-0835 is being subtracted (Constitution #8) and its CI gate `orch-0835-regression-check.mjs` is being deleted (covered by new gate T-A2 below).
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md` — context for what's being subtracted.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md` — context for why Hosted Checkout is **out of scope** here (becomes Spec B / ORCH-0839-B).

**Operator decisions (captured by orchestrator before this spec was dispatched):**
- **Decision A:** "Tonight" filter MUST include events that have already started but not ended. Switch lower bound from `start_at >= now()` to `end_at >= now()`. Operator mental model confirmed: "anything happening tonight."
- **Decision B:** The mobile AsyncStorage cache in `app-mobile/src/components/DiscoverScreen.tsx` MUST be removed entirely. Server-side already caches (`ticketmaster_events_cache` table + edge-function cache); mobile cache is duplicative and was the source of C-1 cross-filter leakage. Constitution #8: subtract before adding.
- **Decision C:** Spec A ships before Spec B (sequential). Spec A is OTA-only (`eas update` after CLOSE). Spec B (Stripe Hosted Checkout pivot via `expo-web-browser`) is queued as ORCH-0839-B and dispatched after Spec A CLOSE — it requires a fresh EAS build and is explicitly out of scope here.

---

## 1. SCOPE

In scope (six fixes shipping together):

| # | Fix | Layer | Source location |
|---|---|---|---|
| F-1 | TM-events pagination alignment — `discover-merged-events` and `ticketmaster-events` agree on page indexing | Edge function | `supabase/functions/ticketmaster-events/index.ts:520-551` |
| F-2 | Meta-vs-items consistency — `meta.ticketmasterCount` reports the count of items actually returned, never the pre-slice TM upstream total | Edge function | `supabase/functions/discover-merged-events/index.ts:452-499` |
| F-3 | Date-window math — Friday-before-6pm `This Weekend` and Monday `Next Week` math fixes | Client | `app-mobile/src/components/DiscoverScreen.tsx:217-247` |
| F-4 | Mobile AsyncStorage cache removal — delete `NightOutCache` interface, `nightOutCacheKey`, `loadNightOutCache`, `saveNightOutCache`, `clearNightOutCache`, the cache-hit short-circuit, the `businessEvents.length > 0` guard from ORCH-0835, the `handleRefresh` cache clear, and the `orch-0835-regression-check.mjs` CI gate | Client + CI | `app-mobile/src/components/DiscoverScreen.tsx:1017-1132`, `1241-1247`; `app-mobile/scripts/ci/orch-0835-regression-check.mjs` (delete) |
| F-5 | "Tonight" lower-bound semantics — switch from `start_at >= now()` to `end_at >= now()` for the business-events query in the merged endpoint AND verify the TM `localStartEndDateTime` window construction in the client honors the same semantics where possible | Edge function + client | `supabase/functions/discover-merged-events/index.ts:329-336` (the business-event `event_dates` filter); `app-mobile/src/components/DiscoverScreen.tsx` `getDateRange("today")` lower bound |
| F-6 | Surface `tmError` to an inline non-fatal banner in Discover when the merged response carries a non-null `meta.tmError` | Client | `app-mobile/src/components/DiscoverScreen.tsx` (Discover header area, near the existing `fallbackActive` banner pattern) |

Plus three new CI regression scripts + three new strict-grep workflow jobs + the deletion of one obsolete CI script + three `test:orch-0839-a*` package.json scripts.

Non-goals (explicit — do NOT touch in this spec):

1. **Stripe Hosted Checkout pivot via `expo-web-browser`** — deferred to ORCH-0839-B (Spec B). Requires fresh EAS build; Spec A is OTA-only.
2. **`newArchEnabled` / bridgeless mode toggle in `app.json`** — out of scope. Native config change requires EAS rebuild and is the Spec B territory.
3. **React Query migration for merged-discover (Path C from ORCH-0835 investigation)** — Cycle B5 / pre-launch hardening item. Out of scope here.
4. **`partyTypes` / `vibeTags` / `musicGenres` cache-key facet additions** — moot now that the cache is being removed. Recorded as a permanent invariant ("no mobile cache").
5. **TM rate-limit handling, BestTime integration, OpenWeatherMap** — unrelated.
6. **`ORCH-0838` Apple Pay merchant cert verification** — still queued separately; status quo (Apple Pay suppressed via `payment_method_types: ['card']`).
7. **Cosmetic redesigns of Discover** — pure functional fixes only.
8. **The `eas update` publication itself** — orchestrator-owned at CLOSE (Step 3 of CLOSE protocol).

Assumptions:

1. The `ticketmaster_events_cache` table schema is unchanged. The cache row stores 20 events per row (one TM "page" worth). Cache TTL is 2 hours per the existing edge-function code. No migration is needed for this spec.
2. The `event_dates` table has both `start_at` and `end_at` columns populated for every published business event row. Verified via spot-check on Big Party (`start_at = 2026-05-14 20:00 UTC`, `end_at` exists per the migration chain). If any business event has `end_at` NULL, the merged endpoint MUST fall back to `start_at + 4 hours` as a conservative default (encoded in the SQL fix below) — documented in implementation notes.
3. The mobile client connects to Metro on port 8084 for dev-build testing; OTA publishes to the `production` branch for EAS users. No deployment target change.
4. `expo-linking`, `useStripe`, and `LogBox` continue to work as in ORCH-0835/0836/0837. This spec does NOT touch any of those wires.

---

## 2. SPECIFICATION — PER LAYER

### 2.1 Database layer

**No DB changes.** This spec does NOT add tables, columns, RLS, or migrations. The `event_dates.end_at` column is already present (per the existing `event_dates` schema documented in migrations under `supabase/migrations/`). The implementor MUST grep `supabase/migrations/` for `event_dates` and confirm `end_at` is `NOT NULL` for published events; if any are nullable, the implementor switches the SQL to `COALESCE(ed.end_at, ed.start_at + interval '4 hours') >= now()` as a defensive default.

### 2.2 Edge function layer — `ticketmaster-events` (F-1)

**File:** `supabase/functions/ticketmaster-events/index.ts`

**Lines 520-551 (current, cache-hit branch):**
```ts
const pageNum = page ?? 0;
const pageSize = size ?? 20;
const sortBy = sort ?? "date,asc";

// ── Build cache key + check cache ────────────────────────────────────
const cacheKey = buildCacheKey({ ... });

const { data: cached } = await supabaseAdmin
  .from("ticketmaster_events_cache")
  .select("events, total_results, fetched_at")
  .eq("cache_key", cacheKey)
  .gt("expires_at", new Date().toISOString())
  .maybeSingle();

if (cached) {
  const events = (cached.events as TicketmasterEvent[]) || [];
  const start = pageNum * pageSize;
  const paginatedEvents = events.slice(start, start + pageSize);
  const totalPages = Math.ceil(events.length / pageSize);
  // returns { events: paginatedEvents, meta: { ..., page: pageNum, ... } }
}
```

**Required change (cache-hit branch only — fresh-fetch branch is correct):**
```ts
if (cached) {
  // ORCH-0839-A F-1: the cache row stores exactly ONE TM page (the page that
  // was originally fetched). It is NOT a superset across pages. Slicing here
  // with `pageNum * pageSize` was always wrong — when `page=1` (the merged
  // endpoint's default), `events.slice(20, 40)` on a 20-element row returns
  // `[]`. The fresh-fetch branch (lines ~608-609) correctly returns
  // `result.events` directly without slicing. Mirror that here: serve the
  // cached page verbatim. The cache key already includes every facet that
  // would change the page contents, so a hit means "this exact page is in
  // cache." Invariant: I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE.
  const events = (cached.events as TicketmasterEvent[]) || [];
  const totalPages = events.length > 0 ? 1 : 0;

  return new Response(
    JSON.stringify({
      events,
      meta: {
        totalResults: cached.total_results,
        page: pageNum,
        pageSize,
        totalPages,
        fromCache: true,
      },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
```

**Rationale for serve-cached-page-verbatim (vs alternative "always slice from page 0"):**
- The cache key does NOT include `page` — it only includes the city/segment/date-window/etc. So a cache hit on `(Raleigh, music, no-date)` returns the row that was originally fetched for that combo, regardless of which `page` the caller asked for.
- TM's API itself is 0-indexed; `discover-merged-events` defaulting to `page=1` was the upstream bug.
- The TM-events function currently caches a single page (20 events) per cache key. No "page across the cache" semantics exist or are needed for the current product surface.
- Future product needs (paged TM browsing beyond 20 events) require a different cache shape (page-keyed). That is out of scope for this spec.

**No change to the fresh-fetch branch.** Lines ~607-610 already serve `result.events` directly.

**No change to cache-key construction** (line ~525-540). The omission of `page` from the cache key is correct given the new cache-hit semantics.

**Deploy:** orchestrator-owned at CLOSE Step 1.5 → Step 3, via `/Users/sethogieva/bin/supabase functions deploy ticketmaster-events --project-ref gqnoajqerqhnvulmnyvv`.

### 2.3 Edge function layer — `discover-merged-events` (F-2, F-5)

**File:** `supabase/functions/discover-merged-events/index.ts`

**F-2 (meta-vs-items consistency) — lines 452-499 (current):**
```ts
} else if (tmRes.data && Array.isArray(tmRes.data.events)) {
  tmItems = tmRes.data.events;
  tmTotal = tmRes.data.meta?.totalResults ?? tmItems.length;
}
// ...
const tmSpread: MergedDiscoverItem[] = tmItems
  .slice(0, remainingForTm)
  .map(...);
const items = [...businessSpread.slice(0, size), ...tmSpread];

const response = {
  items,
  meta: {
    businessCount: businessTotal ?? businessItems.length,
    ticketmasterCount: tmTotal,           // <-- reports pre-slice upstream total
    tmCalled,
    tmError,
    page,
    pageSize: size,
    fromCache: false,
  },
};
```

**Required change:**
```ts
} else if (tmRes.data && Array.isArray(tmRes.data.events)) {
  tmItems = tmRes.data.events;
  tmTotal = tmRes.data.meta?.totalResults ?? tmItems.length;

  // ORCH-0839-A F-2: when upstream reports a non-zero total but returns zero
  // events, treat as an upstream cache/pagination defect — surface as tmError
  // so the client banner fires. The TM-events fix (F-1) eliminates the
  // observed case, but defense-in-depth catches future regressions.
  // Invariant: I-PROPOSED-DISCOVER-META-MATCHES-ITEMS.
  if (tmItems.length === 0 && tmTotal > 0) {
    console.warn(
      "[discover-merged-events] TM upstream reported totalResults=" +
        tmTotal +
        " but events=[] — flagging as tmError"
    );
    tmError =
      tmError ??
      "ticketmaster_upstream_dropped_events";
  }
}
// ...
const tmSpread: MergedDiscoverItem[] = tmItems
  .slice(0, remainingForTm)
  .map(...);
const items = [...businessSpread.slice(0, size), ...tmSpread];

const response: DiscoverMergedResponse = {
  items,
  meta: {
    businessCount: businessSpread.length,            // ORCH-0839-A F-2: post-merge count
    ticketmasterCount: tmSpread.length,              // ORCH-0839-A F-2: post-slice count
    businessTotalAvailable: businessTotal ?? businessItems.length, // optional informational
    ticketmasterTotalAvailable: tmTotal,             // optional informational, separate from "count"
    tmCalled,
    tmError,
    page,
    pageSize: size,
    fromCache: false,
  },
};
```

The two new informational fields (`businessTotalAvailable`, `ticketmasterTotalAvailable`) preserve the upstream-total data the prior `ticketmasterCount`/`businessCount` used to carry, without misrepresenting the response itself. Client may ignore them. The renamed semantic of `ticketmasterCount` / `businessCount` (now = items returned, not upstream total) is the invariant.

**F-5 (Tonight semantics) — lines 329-336 (current):**
```ts
const eventDatesEmbed = dateWindowUtc !== null
  ? "event_dates!inner ( id, start_at, end_at, timezone, is_master )"
  : "event_dates!left ( id, start_at, end_at, timezone, is_master )";

let q = supabase
  .from("events")
  .select(`...`)
  // ...
  .gte("event_dates.start_at", dateWindowUtc?.startUtc)
  .lte("event_dates.start_at", dateWindowUtc?.endUtc);
```

**Required change (the `.gte` lower bound on `start_at`):**
```ts
// ORCH-0839-A F-5: lower bound switched from start_at >= window.start to
// end_at >= window.start so events that have already started but not ended
// remain visible under date chips (notably "Tonight"). Operator-confirmed
// product semantic: "Tonight" = anything happening tonight, including
// in-progress events. The upper bound stays on start_at so events that
// haven't begun by the window end don't leak forward.
// If an event has end_at NULL, fall back to start_at + 4h via
// COALESCE-equivalent (PostgREST: use `.or()` with two clauses).
// Invariant: I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS.
// NB: PostgREST doesn't support COALESCE directly; the implementor MUST
// confirm event_dates.end_at is NOT NULL for published events (grep the
// latest migration in supabase/migrations/) before shipping. If nullable,
// use a server-side SQL view or RPC wrapper that defaults end_at.
.gte("event_dates.end_at", dateWindowUtc?.startUtc)
.lte("event_dates.start_at", dateWindowUtc?.endUtc);
```

**Implementor decision point:** if `event_dates.end_at` is nullable for published events, two paths are acceptable: (a) introduce a server-side view `event_dates_with_default_end_at` that returns `COALESCE(end_at, start_at + interval '4 hours')` and `JOIN` against it instead; (b) defensively skip events with NULL `end_at` from dated chips. Implementor picks (a) if migration backfill is preferred (out of this spec's no-migration scope), otherwise (b). Path (b) is the default for this spec to keep it strictly no-DB-change.

**Client-side Tonight bound (`DiscoverScreen.tsx` `getDateRange("today")`):** the current lower bound is `now` which is correct — it means "from now until end of today." No client change needed for F-5 BEYOND the TM `localStartEndDateTime` interpretation, which is TM's own semantic (TM treats it as `startDateTime`); not changeable without breaking TM API. Document the asymmetry: Mingla business events use `end_at >= now`; TM events use `localStartEndDateTime` which is `startDateTime >= startDateTime <= endDateTime` per TM's API. This is acceptable because TM events nearly always show before they start, and the asymmetry is invisible to users.

**No change to F-5 in `nightOutExperiencesService.ts`.** The service forwards `localStartEndDateTime` and `timezone` verbatim. The server is authoritative for the `end_at`-based filter.

**Deploy:** orchestrator-owned. After F-1 + F-2 + F-5 all land in source, deploy `discover-merged-events` AND `ticketmaster-events` together via the Supabase CLI.

### 2.4 Service layer — `nightOutExperiencesService.ts`

**No changes.** `searchMerged` continues to forward `localStartEndDateTime`, `timezone`, etc. unchanged. The function does NOT need to pass `page=0` — the server-side TM-events fix (F-1) makes the page-indexing alignment irrelevant from the client perspective; merged endpoint can keep its `Math.max(1, body.page ?? 1)` default.

### 2.5 Hook layer

**No React Query hooks change.** The merged-discover response continues to flow through `searchMerged` → `useState` in `DiscoverScreen.tsx`. Path C (React Query migration) is out of scope.

### 2.6 Component layer — `DiscoverScreen.tsx` (F-3, F-4, F-6)

**File:** `app-mobile/src/components/DiscoverScreen.tsx`

**F-3.a (Friday-before-6pm This Weekend) — current lines 217-230:**
```ts
case "weekend": {
  const dayOfWeek = now.getDay();
  const daysUntilFri = (5 - dayOfWeek + 7) % 7 || 7;
  const friday = new Date(now);
  friday.setDate(friday.getDate() + (dayOfWeek <= 5 && dayOfWeek > 0 ? daysUntilFri : 0));
  friday.setHours(18, 0, 0, 0);
  const sunday = new Date(friday);
  sunday.setDate(sunday.getDate() + 2);
  sunday.setHours(23, 59, 59, 0);
  if (dayOfWeek === 0 || dayOfWeek === 6 || (dayOfWeek === 5 && now.getHours() >= 18)) {
    return { localStartEndDateTime: pair(now, sunday) };
  }
  return { localStartEndDateTime: pair(friday, sunday) };
}
```

**Required change:**
```ts
case "weekend": {
  // ORCH-0839-A F-3.a: the `(5 - dow + 7) % 7 || 7` math was correct for
  // dow ∈ {1,2,3,4,6} but broke on dow=5 (Friday) where `(5-5+7)%7 = 0` is
  // falsy and the `|| 7` clause advances to NEXT Friday. Explicit case-on-5
  // fixes it. dow=0 and dow=6 are already short-circuited below.
  const dayOfWeek = now.getDay();
  const daysUntilFri = dayOfWeek === 5 ? 0 : (5 - dayOfWeek + 7) % 7;
  const friday = new Date(now);
  friday.setDate(friday.getDate() + (dayOfWeek <= 5 && dayOfWeek > 0 ? daysUntilFri : 0));
  friday.setHours(18, 0, 0, 0);
  const sunday = new Date(friday);
  sunday.setDate(sunday.getDate() + 2);
  sunday.setHours(23, 59, 59, 0);
  if (dayOfWeek === 0 || dayOfWeek === 6 || (dayOfWeek === 5 && now.getHours() >= 18)) {
    return { localStartEndDateTime: pair(now, sunday) };
  }
  return { localStartEndDateTime: pair(friday, sunday) };
}
```

**F-3.b (Monday Next Week) — current lines 232-239:**
```ts
case "next-week": {
  const monday = new Date(now);
  monday.setDate(monday.getDate() + (8 - now.getDay()) % 7);
  monday.setHours(0, 0, 0, 0);
  // ...
}
```

**Required change:**
```ts
case "next-week": {
  // ORCH-0839-A F-3.b: `(8 - dow) % 7` on dow=1 (Monday) returns 0, no
  // advance, current week instead of next week. Explicit case-on-1 fixes.
  const dayOfWeek = now.getDay();
  const daysUntilNextMon = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
  const monday = new Date(now);
  monday.setDate(monday.getDate() + daysUntilNextMon);
  monday.setHours(0, 0, 0, 0);
  const nextSunday = new Date(monday);
  nextSunday.setDate(nextSunday.getDate() + 6);
  nextSunday.setHours(23, 59, 59, 0);
  return { localStartEndDateTime: pair(monday, nextSunday) };
}
```

**F-4 (drop the mobile cache entirely) — affects lines 1017-1132, 1241-1247, and the import for `AsyncStorage` if no other code uses it:**

Delete:
- The `NightOutCache` interface (current lines ~1017-1030).
- The `nightOutCacheKey` const (current line ~1039).
- The `saveNightOutCache`, `clearNightOutCache`, `loadNightOutCache` functions (current ~1041-1080).
- The cache-hit short-circuit block inside `fetchNightOutEvents` (current ~1115-1132) — the entire `if (!skipCache)` clause and its body (lines 1113-1133) goes away; the body of `fetchNightOutEvents` starts directly with the merged fetch.
- The `await clearNightOutCache()` call inside `handleRefresh` (current ~1244 — handleRefresh just calls `fetchNightOutEvents(true)` afterward; the cache clear becomes a no-op since the cache is gone).
- The `saveNightOutCache(cards, false)` and `saveNightOutCache(cards, usedFallbackNow)` calls inside the success branches of `fetchNightOutEvents` (current ~1207 and ~1226).
- The `businessEvents.length` dep array entry added by ORCH-0835 (line ~1217) — no longer needed since the guard is gone.
- The `businessEvents.length > 0` clause in the (now-deleted) cache-hit predicate.
- The `NIGHT_OUT_CACHE_KEY` const + AsyncStorage import IF this is the only consumer in the file. If `AsyncStorage` is used elsewhere in the file (e.g., for `_hasHydrated` or other persistence) keep the import; otherwise remove.

**The `fetchNightOutEvents` body after deletion looks like:**
```ts
const fetchNightOutEvents = useCallback(
  async (skipCache: boolean = false): Promise<void> => {
    // ORCH-0839-A F-4: mobile AsyncStorage cache removed. Server-side caches
    // authoritatively (ticketmaster_events_cache table + edge-function cache).
    // Mobile cache was duplicative, was the source of C-1 cross-filter
    // leakage (cache-hit branch restored only TM, leaving stale Mingla
    // events from the prior filter), and added no measurable benefit on
    // device. `skipCache` is preserved as a parameter for API compatibility
    // but is now a no-op.
    // Invariant: I-PROPOSED-DISCOVER-NO-MOBILE-CACHE.
    if (!effectiveCity && (!nightOutGpsLat || !nightOutGpsLng)) return;
    setNightOutLoading(true);
    setNightOutError(null);
    try {
      const { localStartEndDateTime } = getDateRange(selectedFilters.date);
      const genreSlugs: DiscoverGenreSlug[] =
        selectedFilters.genre === "all" ? [] : [selectedFilters.genre];

      if (effectiveCity) {
        const merged = await NightOutExperiencesService.searchMerged({
          city: { ... },
          segmentSlug: selectedFilters.segment,
          genreSlugs,
          localStartEndDateTime: localStartEndDateTime ?? undefined,
          sort: "date,asc",
          partyTypeSlugs: selectedFilters.partyTypes,
          vibeTagSlugs: selectedFilters.vibeTags,
          musicGenreSlugs: selectedFilters.musicGenres,
        });

        // ORCH-0839-A F-6: surface tmError from merged response.
        setTmError(merged.meta?.tmError ?? null);

        const bizItems: BusinessEventCardData[] = [];
        const tmVenues: NightOutVenue[] = [];
        for (const it of merged.items as MergedDiscoverItem[]) {
          if (it.source === "business_event") bizItems.push(it.item);
          else tmVenues.push(it.item);
        }
        setBusinessEvents(bizItems);
        setFallbackActive(false);
        const cards = tmVenues.map(transformNightOutVenue);
        setNightOutCards(cards);
        // NO saveNightOutCache call — cache deleted in F-4.
      } else {
        // GPS-only path unchanged from current source (lines 1185-1207 today),
        // minus the saveNightOutCache call at the end.
        setBusinessEvents([]);
        setTmError(null);
        const { events, meta } = await NightOutExperiencesService.search({ ... });
        const usedFallbackNow = meta?.usedFallback === true;
        setFallbackActive(usedFallbackNow);
        const cards = events.map(transformNightOutVenue);
        setNightOutCards(cards);
      }
    } catch (err) {
      console.error("[Discover] Error fetching events:", err);
      setNightOutError(t("discover:errors.failed_events"));
      setFallbackActive(false);
      setTmError(null);
    } finally {
      setNightOutLoading(false);
    }
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [
    effectiveCity?.name,
    effectiveCity?.lat,
    effectiveCity?.lng,
    nightOutGpsLat,
    nightOutGpsLng,
    selectedFilters.date,
    selectedFilters.segment,
    selectedFilters.genre,
    selectedFilters.partyTypes,
    selectedFilters.vibeTags,
    selectedFilters.musicGenres,
    t,
    // businessEvents.length REMOVED — no cache-hit predicate to feed it
  ],
);
```

**`handleRefresh` after deletion:**
```ts
const handleRefresh = async (): Promise<void> => {
  setIsRefreshing(true);
  // ORCH-0839-A F-4: no clearNightOutCache call — mobile cache removed.
  // Refresh just re-fetches; server cache TTL handles its own freshness.
  await fetchNightOutEvents(true);
  setIsRefreshing(false);
};
```

**F-6 (surface tmError) — add a new local state at the top of `DiscoverScreen` near the existing `nightOutError` state (current line ~943):**
```ts
const [nightOutError, setNightOutError] = useState<string | null>(null);
// ORCH-0839-A F-6: surface a non-fatal banner when the merged endpoint
// carries a tmError (Ticketmaster upstream returned events=[] with non-zero
// totalResults, or TM call threw, or rate-limited). Lives separately from
// nightOutError (which is the hard fetch failure). Banner is non-blocking;
// Mingla business events continue to render normally.
const [tmError, setTmError] = useState<string | null>(null);
```

And the inline banner, rendered just above the events grid, after the existing `fallbackActive` banner pattern (the implementor finds the existing `fallbackActive` banner JSX and mirrors its position):

```tsx
{tmError !== null ? (
  <View style={styles.tmErrorBanner}>
    <Text style={styles.tmErrorText}>
      Live events temporarily unavailable. Showing what we have.
    </Text>
  </View>
) : null}
```

Styles (added to the existing `StyleSheet.create` block near `fallbackBanner`):

```ts
tmErrorBanner: {
  backgroundColor: "rgba(255, 200, 0, 0.12)",
  borderColor: "rgba(255, 200, 0, 0.30)",
  borderWidth: 1,
  borderRadius: 12,
  paddingHorizontal: 16,
  paddingVertical: 10,
  marginHorizontal: 16,
  marginBottom: 12,
},
tmErrorText: {
  fontSize: 13,
  fontWeight: "500",
  color: "rgba(255, 230, 150, 0.95)",
  textAlign: "center",
},
```

Copy is friendly + non-blaming per Constitution. The banner clears automatically on the next successful fetch (`setTmError(null)` inside the success branch).

### 2.7 Realtime layer

**No realtime changes.** Discover is not subscribed to realtime channels for the merged feed.

### 2.8 CI gate layer — three NEW regression checks + ONE deletion + three new workflow jobs + three new package.json scripts

#### 2.8.1 `app-mobile/scripts/ci/orch-0839-a-tm-pagination-aligned.mjs` (NEW)

Asserts:
- T-A0: `supabase/functions/ticketmaster-events/index.ts` cache-hit branch does NOT call `events.slice(start, start + pageSize)` or any pageNum-based slice (regex against the file). The branch must return `events` verbatim.
- T-A1: `supabase/functions/discover-merged-events/index.ts` keeps `Math.max(1, body.page ?? 1)` (unchanged — informational so we don't regress merged-side).

Exit 1 on any FAIL. Pattern follows `orch-0834-rescoped-regression-check.mjs`.

#### 2.8.2 `app-mobile/scripts/ci/orch-0839-a-meta-items-consistent.mjs` (NEW)

Asserts:
- T-B0: `supabase/functions/discover-merged-events/index.ts` sets `meta.ticketmasterCount` from `tmSpread.length` (post-slice), not `tmTotal` (pre-slice). Regex: `ticketmasterCount:\s*tmSpread\.length` appears in the response builder.
- T-B1: Same file sets `meta.businessCount` from `businessSpread.length`. Regex: `businessCount:\s*businessSpread\.length` appears.
- T-B2: Same file logs and surfaces `tmError = "ticketmaster_upstream_dropped_events"` when `tmItems.length === 0 && tmTotal > 0`. Regex covering that conditional block + the assignment.

Exit 1 on any FAIL.

#### 2.8.3 `app-mobile/scripts/ci/orch-0839-a-mobile-cache-removed.mjs` (NEW — supersedes the ORCH-0835 gate)

Asserts:
- T-C0: `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain the identifier `NightOutCache` (interface deleted).
- T-C1: Same file does NOT contain `loadNightOutCache`, `saveNightOutCache`, `clearNightOutCache`, or `nightOutCacheKey`.
- T-C2: Same file does NOT contain the regex `cached\.venues\.length\s*>\s*0` (the cache-hit predicate is gone).
- T-C3: Same file contains the comment string `ORCH-0839-A F-4` in the new `fetchNightOutEvents` body (positive assertion the explanation comment is in place — protects against future re-introduction).
- T-C4: The file `app-mobile/scripts/ci/orch-0835-regression-check.mjs` does NOT exist (deleted as part of this spec).

Exit 1 on any FAIL.

#### 2.8.4 `app-mobile/scripts/ci/orch-0835-regression-check.mjs` (DELETE)

This CI gate is replaced by `orch-0839-a-mobile-cache-removed.mjs` (T-C2 supersedes T-A0 from the 0835 gate; T-C0/C1/C3 are stricter than 0835 ever was).

The strict-grep workflow YAML entry `orch-0835-discover-cache-symmetry` is also deleted.

The `test:orch-0835` script in `app-mobile/package.json` is deleted.

The CLOSE memo for ORCH-0839-A MUST note: "Supersedes ORCH-0835 cache-symmetry guard. The cache itself is removed; the guard is obsolete."

#### 2.8.5 `app-mobile/package.json` script entries

Add three new lines; delete one.

Delete:
```json
"test:orch-0835": "node ./scripts/ci/orch-0835-regression-check.mjs",
```

Add:
```json
"test:orch-0839-a-pagination": "node ./scripts/ci/orch-0839-a-tm-pagination-aligned.mjs",
"test:orch-0839-a-meta": "node ./scripts/ci/orch-0839-a-meta-items-consistent.mjs",
"test:orch-0839-a-cache-removed": "node ./scripts/ci/orch-0839-a-mobile-cache-removed.mjs",
```

#### 2.8.6 Strict-grep workflow YAML — `.github/workflows/strict-grep-mingla-business.yml`

Delete the `orch-0835-discover-cache-symmetry` job (currently registered after the ORCH-0834-rescoped jobs). Update the registry comment block at the top to remove the ORCH-0835 entry.

Add three new jobs following the existing pattern (e.g., the `orch-0829-b-d1-checkout-expiry-tombstone` job is the most recent template), one per gate above. Update the registry comment block to add the three new gates.

The implementor follows the existing 4-step procedure in `.github/scripts/strict-grep/README.md` and `feedback_strict_grep_registry_pattern.md` for adding each gate.

---

## 3. SUCCESS CRITERIA

| # | Criterion | Observable | Testable | Layer |
|---|---|---|---|---|
| SC-01 | The "All" filter in Discover shows BOTH the Big Party Mingla event AND ≥10 Ticketmaster events for Raleigh+music after a cache hit | Yes — visual on real device + Metro log + direct edge-function probe | Direct probe of `discover-merged-events` returns `items.length >= 10` with both source kinds | Full stack |
| SC-02 | Direct probe of `ticketmaster-events` with `page=0` AND `page=1` BOTH return `events.length === 20` for Raleigh+music+no-date when the cache row has 20 events | Yes — `curl` script | T-A0 gate + manual probe | Edge fn |
| SC-03 | `discover-merged-events` response: `meta.ticketmasterCount` equals `items.filter(i => i.source === 'ticketmaster').length`. Same for `businessCount`. Always. | Yes — runtime invariant on every response | T-B0 + T-B1 gates; runtime spot-check via curl | Edge fn |
| SC-04 | When TM upstream returns `totalResults > 0` but `events.length === 0`, the merged response carries `meta.tmError === "ticketmaster_upstream_dropped_events"` AND `meta.ticketmasterCount === 0` | Yes — server log + response inspection | T-B2 gate; cannot be triggered after F-1 ships, but the defensive code path remains | Edge fn |
| SC-05 | On Friday before 18:00 (e.g., simulated by Maestro running with `TZ` set), the `This Weekend` filter returns events from today through this Sunday — NOT next weekend's Fri-Sun | Yes — `getDateRange("weekend")` unit test | Independent test asserting `localStartEndDateTime` falls within this weekend | Client |
| SC-06 | On Monday (any time), the `Next Week` filter returns events from next Monday through next Sunday — NOT this week | Yes — `getDateRange("next-week")` unit test | Independent test | Client |
| SC-07 | The Big Party Mingla event remains visible under the "Tonight" filter from 16:00 EDT (start time) until its `end_at` (event end time), not just until 16:00 | Yes — direct probe with `now()` advanced past start_at | SQL probe + edge-function probe + real-device test if test data is available | Edge fn |
| SC-08 | Switching from "Tonight" (which populates `businessEvents=[bigParty]`) to "This Month" within the same session shows the correct mix of events for "This Month"; the Mingla event slot reflects what the merged endpoint actually returned, not whatever was in memory from the prior filter | Yes — Maestro filter-toggle flow | T-C0..T-C4 gates prove the cache is gone, so the bug class can't reproduce | Client |
| SC-09 | `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain `NightOutCache`, `loadNightOutCache`, `saveNightOutCache`, `clearNightOutCache`, `nightOutCacheKey`, or `cached.venues.length > 0` | Yes — grep | T-C0/C1/C2 gates | Client |
| SC-10 | When the merged endpoint returns a non-null `meta.tmError`, the Discover screen renders a yellow non-fatal banner with the copy "Live events temporarily unavailable. Showing what we have." above the events grid; the banner disappears on the next successful fetch | Yes — visual on real device + simulated tmError | Maestro flow with mock tmError | Client |
| SC-11 | The three new CI regression scripts (`test:orch-0839-a-pagination`, `test:orch-0839-a-meta`, `test:orch-0839-a-cache-removed`) all exit 0 on the implementor branch | Yes — `npm run` | Local + GitHub Actions | CI |
| SC-12 | The deleted file `app-mobile/scripts/ci/orch-0835-regression-check.mjs` does not exist; the `orch-0835-discover-cache-symmetry` job does not exist in `strict-grep-mingla-business.yml`; the `test:orch-0835` script does not exist in `package.json` | Yes — grep | T-C4 + manual file-existence check | CI |

---

## 4. INVARIANTS

### 4.1 Invariants this spec MUST preserve

| Invariant | Preserved how | Test |
|---|---|---|
| `I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST` (ORCH-0824) | merged endpoint partition order unchanged; business events ranked first | Existing `orch-0824-event-taxonomy-parity` gate + manual response inspection |
| `I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS` (ORCH-0828) | `showGrid` / `showEmpty` / `showLoadingSkeleton` predicates unchanged; both arrays still considered | `orch-0828-regression-check.mjs` re-run |
| `I-PROPOSED-DISCOVER-TM-SUPPRESSION` (ORCH-0824) | Party Type / Vibe / Mingla-only-genre suppression unchanged in merged endpoint | Existing manual probe |
| `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` / `I-PROPOSED-STRIPE-CALLBACK-WIRED` / `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` / `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` (ORCH-0834/0837) | This spec does not touch Stripe surfaces at all | n/a |
| `I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM` (ORCH-0834-rescoped) | TicketClaimConfirmModal continues to use Gorhom; not touched | `orch-0834-rescoped-regression-check.mjs` re-run |
| Constitution #3 (no silent failures) | F-6 surfaces tmError; F-2 logs+propagates the "upstream dropped events" condition | Code review + T-B2 gate |
| Constitution #8 (subtract before adding) | F-4 deletes the entire mobile cache mechanism rather than layering a fix | T-C0..C4 gates |

### 4.2 NEW invariants this spec establishes (codified on CLOSE)

| Invariant ID | Description | CI gate |
|---|---|---|
| `I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE` | The `ticketmaster-events` cache-hit branch MUST serve the cached events array verbatim, never `events.slice(pageNum*pageSize, …)`. The cache stores ONE TM page per cache row; per-page slicing is upstream's responsibility, not ours. | `orch-0839-a-tm-pagination-aligned.mjs` T-A0 |
| `I-PROPOSED-DISCOVER-META-MATCHES-ITEMS` | Every `discover-merged-events` response MUST satisfy `meta.ticketmasterCount === items.filter(i => i.source === 'ticketmaster').length` AND `meta.businessCount === items.filter(i => i.source === 'business_event').length`. Upstream-total fields, if exposed, MUST use distinct names (`*TotalAvailable`). | `orch-0839-a-meta-items-consistent.mjs` T-B0 + T-B1 |
| `I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS` | The merged endpoint's business-event date filter MUST use `event_dates.end_at >= window.start` as the lower bound, never `event_dates.start_at >= window.start`. Events that have already started but not ended remain visible under date chips. | Implementor SQL diff in `discover-merged-events/index.ts:329-336` reviewed at CLOSE; no separate strict-grep gate (the SQL string is complex; T-B0/B1 gates indirectly cover the response shape) |
| `I-PROPOSED-DISCOVER-NO-MOBILE-CACHE` | `app-mobile/src/components/DiscoverScreen.tsx` MUST NOT contain `NightOutCache`, `loadNightOutCache`, `saveNightOutCache`, `clearNightOutCache`, or `nightOutCacheKey`. The merged-discover state is fetched fresh on every filter change; server caches authoritatively. Future re-introduction of a mobile cache requires a new spec that addresses cross-filter and remount cache-symmetry from the start. | `orch-0839-a-mobile-cache-removed.mjs` T-C0..C4 |

### 4.3 Invariant being retired

| Invariant ID | Why retired |
|---|---|
| `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` (ORCH-0835) | Replaced by `I-PROPOSED-DISCOVER-NO-MOBILE-CACHE`. The cache is gone; symmetry is moot. |

---

## 5. TEST CASES

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Direct probe — TM-events `page=0` | curl `/functions/v1/ticketmaster-events` with `{city: "Raleigh", segmentSlug: "music", page: 0, size: 20}` | `events.length === 20`, `meta.fromCache === true` (after first call) | Edge fn |
| T-02 | Direct probe — TM-events `page=1` | Same as T-01 with `page: 1` | `events.length === 20`, `meta.fromCache === true`, same 20 events as T-01 | Edge fn |
| T-03 | Direct probe — discover-merged "All" Raleigh music | curl `/functions/v1/discover-merged-events` with the chip's body | `items.length >= 11` (1 Mingla + 10+ TM), `meta.ticketmasterCount === items.filter(i => i.source === 'ticketmaster').length` | Edge fn |
| T-04 | Direct probe — meta-vs-items invariant | Inspect every Discover chip's merged response | `meta.ticketmasterCount + meta.businessCount === items.length` always | Edge fn |
| T-05 | Unit — `getDateRange("weekend")` on Friday 10:00 AM | Fake `now()` to a Friday at 10:00 in `getDateRange` | Returns a window starting today at the original `now` instant, ending Sunday 23:59:59 of THIS weekend (not next weekend) | Client |
| T-06 | Unit — `getDateRange("weekend")` on Friday 7:00 PM | Fake `now()` to Friday 19:00 | Returns `pair(now, sunday)` for this weekend (existing path; regression check) | Client |
| T-07 | Unit — `getDateRange("next-week")` on Monday | Fake `now()` to Monday 09:00 | Returns next Monday 00:00 to next Sunday 23:59:59, NOT this week | Client |
| T-08 | Unit — `getDateRange("next-week")` on Thursday | Fake `now()` to Thursday | Returns next Monday 00:00 to next Sunday 23:59:59 (existing path; regression check) | Client |
| T-09 | Maestro — Tonight semantics | Real device or sim, browse Discover at any time after Big Party has started but not ended | Big Party visible under "Tonight" | Full stack |
| T-10 | Maestro — Cross-filter no-leak | Tonight populates Mingla event A; tap This Month | Mingla slot reflects This Month's merged result, not the cached A | Client |
| T-11 | Maestro — tmError banner | Force `meta.tmError` to non-null in a synthetic merged response (test scaffold) | Yellow banner with the exact copy renders above the grid; disappears on next clean fetch | Client |
| T-12 | CI gate — TM pagination aligned | `npm run test:orch-0839-a-pagination` | Exit 0 | CI |
| T-13 | CI gate — meta-items consistent | `npm run test:orch-0839-a-meta` | Exit 0 | CI |
| T-14 | CI gate — mobile cache removed | `npm run test:orch-0839-a-cache-removed` | Exit 0 | CI |
| T-15 | CI regression — ORCH-0835 gate is gone | `ls app-mobile/scripts/ci/orch-0835-regression-check.mjs` | No such file or directory; `package.json` does not contain `test:orch-0835` | CI |

---

## 6. IMPLEMENTATION ORDER

Sequential. Edge functions first because they're the primary fix; client changes second; CI gates third.

1. **TM-events cache-hit fix** (~10 min):
   - Edit `supabase/functions/ticketmaster-events/index.ts:520-551` per §2.2 to serve cached events verbatim
   - Run `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticketmaster-events/index.ts`

2. **discover-merged-events meta-vs-items + tmError + Tonight semantics** (~20 min):
   - Edit `supabase/functions/discover-merged-events/index.ts:452-499` per §2.3 F-2 — `tmTotal`-vs-`tmSpread.length` flip + the `tmError` defense
   - Edit `supabase/functions/discover-merged-events/index.ts:329-336` per §2.3 F-5 — switch `.gte("event_dates.start_at", ...)` to `.gte("event_dates.end_at", ...)`
   - If `event_dates.end_at` is nullable for published events: pick path (a) view or path (b) skip-null-end-events per §2.3; document the choice in the implementation report
   - Run `deno check` on the file

3. **DiscoverScreen date-window math** (~10 min):
   - Edit `app-mobile/src/components/DiscoverScreen.tsx:217-230` per §2.6 F-3.a
   - Edit `app-mobile/src/components/DiscoverScreen.tsx:232-239` per §2.6 F-3.b
   - `npx tsc --noEmit`

4. **DiscoverScreen mobile cache removal** (~30 min):
   - Delete the `NightOutCache` interface, `nightOutCacheKey`, `loadNightOutCache`, `saveNightOutCache`, `clearNightOutCache`, the entire cache-hit short-circuit block, the `clearNightOutCache` call inside `handleRefresh`, the `saveNightOutCache` calls inside the success branches, the `businessEvents.length` dep array entry, and the `_v2_` prefix const if unused after deletion
   - Confirm the `AsyncStorage` import is still used elsewhere in the file (keep if so, delete if not)
   - Confirm `fetchNightOutEvents` body matches §2.6 F-4 (with the `// ORCH-0839-A F-4` comment present)
   - `npx tsc --noEmit`

5. **DiscoverScreen tmError banner** (~15 min):
   - Add `const [tmError, setTmError] = useState<string | null>(null);` near the existing `nightOutError` state
   - Add `setTmError(merged.meta?.tmError ?? null);` inside the merged-fetch success branch
   - Add `setTmError(null);` inside the GPS-only branch (no tmError concept there)
   - Add `setTmError(null);` inside the catch block
   - Add the inline banner JSX above the events grid per §2.6 F-6
   - Add the two new style entries to the `StyleSheet.create` block
   - `npx tsc --noEmit && npx expo lint`

6. **CI gates** (~30 min total):
   - Create `app-mobile/scripts/ci/orch-0839-a-tm-pagination-aligned.mjs` per §2.8.1
   - Create `app-mobile/scripts/ci/orch-0839-a-meta-items-consistent.mjs` per §2.8.2
   - Create `app-mobile/scripts/ci/orch-0839-a-mobile-cache-removed.mjs` per §2.8.3
   - Delete `app-mobile/scripts/ci/orch-0835-regression-check.mjs`
   - Update `app-mobile/package.json` scripts block per §2.8.5
   - Run each gate locally — all must exit 0

7. **Strict-grep workflow YAML** (~10 min):
   - Edit `.github/workflows/strict-grep-mingla-business.yml`
   - Delete the `orch-0835-discover-cache-symmetry` job
   - Add three new jobs for the three new gates (follow the `orch-0829-b-d1-checkout-expiry-tombstone` job as the template)
   - Update the registry comment block at the top of the file to reflect the change

8. **Implementation report** (~15 min):
   - Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0839-A_DISCOVER_HARDENING.md` with the standard 15-section template, old→new receipts for every file changed, spec-criterion traceability (SC-01..SC-12), invariant verification (7 preserved + 4 new + 1 retired), constitutional compliance check, regression surface list, and discoveries-for-orchestrator (carry the 6 items from §17 of the 0839 investigation)

**Total estimate:** ~2 hours implementor effort. Risk: LOW — all changes are surgical, server-side fixes are correctness rather than refactor, client cache removal is pure subtraction.

---

## 7. REGRESSION PREVENTION

Three new CI gates (above) catch any re-regression of the three invariants. Plus:

- **Protective comments** at every change site explicitly cite `ORCH-0839-A` and the WHY (operator-confirmed product semantic, server-side authoritative cache, bug-class that materialized) so future-Claude reading the code understands why these guards exist before considering simplification.
- **The deletion of `orch-0835-regression-check.mjs`** is documented in the implementation report under "CI Gates Retired" with reasoning ("Cache is gone; symmetry is moot. New gate `orch-0839-a-mobile-cache-removed.mjs` asserts the deletion holds.").
- **A note in `INVARIANT_REGISTRY.md` at CLOSE:** `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` is marked RETIRED with cross-reference to `I-PROPOSED-DISCOVER-NO-MOBILE-CACHE`.

---

## 8. DISCOVERIES FOR ORCHESTRATOR (carried forward from §17 of the 0839 investigation)

1. **TM API itself is healthy for Raleigh+music.** Earlier "TM rate limit / TM API silently empty" speculation is now disproven; the bug was the cache slice. No action needed.
2. **`event_dates.start_at >= now` → `event_dates.end_at >= now` is captured in F-5 of this spec.** Closed by Spec A.
3. **Pre-launch hardening item:** the merged-discover state architecture (Path C from ORCH-0835 investigation) — migrate to React Query with persist as a single source of truth for both arrays. Cycle B5 / pre-launch hardening. NOT this spec.
4. **Stripe Hosted Checkout pivot** remains the right strategic move and is queued as ORCH-0839-B (Spec B). ORCH-0838 (Apple Pay re-enable + cert validation) becomes a "later, optional" item once Spec B ships.
5. **CI gate gap:** the existing `orch-0824` discover gate validates the merged endpoint's response shape but does not assert that `items.length` is consistent with `meta.ticketmasterCount + meta.businessCount`. The new `orch-0839-a-meta-items-consistent.mjs` plugs this — Spec A closes the gap.
6. **`This Weekend` semantics on Saturdays/Sundays** are NOT bugged today (the path correctly returns `pair(now, sunday)` for dow=0/6 and Fri≥18:00). The bug is narrow to Friday before 18:00. Existing correct path is preserved by F-3.a; tests T-06 and T-08 regression-check this.

---

## 9. EFFORT + RISK

- **Implementor effort:** ~2 hours (well-bounded: surgical server fixes + client surgical edits + CI scaffolding).
- **Test effort:** ~45 minutes (direct edge-function probes, unit tests for `getDateRange`, Maestro flow for cross-filter no-leak, banner spot-check).
- **Deploy effort:** ~10 minutes (orchestrator deploys `ticketmaster-events` and `discover-merged-events` together; no migration; mobile changes ship via `eas update --branch production` at CLOSE Step 3).
- **Risk:** **LOW.** Server fixes are correctness; client cache removal is pure subtraction (existing cache had no measurable benefit and was the source of the C-1 bug class); date-window math fixes are localized to two `case` blocks. No native config touched, no DB changes, no migrations. Fully OTA-shippable.

**Risk on the Tonight-semantic change (F-5):** if any business event has `event_dates.end_at IS NULL` in production today, switching the filter would exclude that event entirely under dated chips. The implementor MUST grep the latest `event_dates` migration to confirm `end_at` is `NOT NULL` for published rows; if not, path (b) (skip null end_at) preserves existing behavior for those rows.

---

## 10. CLOSE PROTOCOL TRIGGERS

When this ships and tester returns PASS, the orchestrator's CLOSE protocol must:

- Codify four new invariants in `INVARIANT_REGISTRY.md`:
  - `I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE`
  - `I-PROPOSED-DISCOVER-META-MATCHES-ITEMS`
  - `I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS`
  - `I-PROPOSED-DISCOVER-NO-MOBILE-CACHE`
- Retire `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` with cross-reference.
- Update `WORLD_MAP.md`, `MASTER_BUG_LIST.md`, `COVERAGE_MAP.md`, `PRODUCT_SNAPSHOT.md`, `PRIORITY_BOARD.md`, `AGENT_HANDOFFS.md`, `OPEN_INVESTIGATIONS.md` for **ORCH-0839-A** (the parent ORCH-0839 stays OPEN until Spec B closes; this is a partial close).
- Surface the 6 Discoveries from §8 above as orchestrator follow-ups.
- **This is NOT a deprecation-class close** (no DROP COLUMN / DROP TABLE / DROP FUNCTION / feature retirement on the schema side; the mobile cache removal is in-app code, not a schema change). Step 5a-5h extension does not apply.
- Provide the deploy commands at CLOSE:
  1. `/Users/sethogieva/bin/supabase functions deploy ticketmaster-events --project-ref gqnoajqerqhnvulmnyvv`
  2. `/Users/sethogieva/bin/supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv`
  3. Verify version bumps via `mcp__supabase__list_edge_functions`; preserve existing `verify_jwt` settings (both are `verify_jwt: false`).
  4. After commit lands on `Seth` and PR closes to `main`: `cd app-mobile && eas update --branch production --platform ios --message "ORCH-0839-A: Discover hardening — TM pagination + meta + dates + cache + tmError + Tonight"`
- After Spec A CLOSE, orchestrator dispatches **Spec B (ORCH-0839-B)** for the Stripe Hosted Checkout pivot via `expo-web-browser`.
