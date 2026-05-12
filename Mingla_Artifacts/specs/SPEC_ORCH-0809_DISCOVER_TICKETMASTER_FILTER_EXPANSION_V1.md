# SPEC — ORCH-0809 — Discover Ticketmaster Filter Expansion v1

**ORCH-ID:** ORCH-0809
**Status:** SPEC (awaiting orchestrator REVIEW → IMPLEMENT dispatch)
**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** in-session audit codified in `Mingla_Artifacts/WORLD_MAP.md` (ORCH-0809 entry, 2026-05-12) — INVESTIGATE skipped because the audit is the investigation in substance.
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0809_DISCOVER_TICKETMASTER_FILTER_EXPANSION_V1.md`

---

## §1 — Goal

Make Discover's Ticketmaster query honest. Today Discover (a) is GPS-only with no city picker, (b) hardcodes Ticketmaster's Music segment so Sports / Comedy / Theatre / Family / Film are unreachable, (c) fuzzy-matches user-facing genre chips to keywords instead of using Ticketmaster's real `genreId` classification IDs, (d) computes "Tonight / This Weekend / Next Week / This Month" as UTC ranges against TM's UTC `startDateTime`/`endDateTime` (drift at midnight, wrong-day events near timezone boundaries), and (e) presents a price-tier filter that does NOT filter at the API and silently hides results post-fetch with no UX signal. This SPEC delivers a user-editable city picker as primary location (GPS default, lat/lng fallback), wires real `segmentId` + `genreId` classification from a server-owned ID map, switches date filters to TM's `localStartEndDateTime` (one param fixes all four chips' timezone drift), and removes the price filter entirely (returns as a separate ORCH when Mingla Business native events with structured pricing are integrated into Discover).

## §2 — In-Scope (locked by operator 2026-05-12)

S-1 — **City picker as primary location.** Top-of-Discover chip showing the user's currently selected city. Tapping opens a Sheet with Google Places autocomplete (already wired via `geocodingService.autocomplete()`). On first paint after GPS resolves, the chip auto-populates to the GPS-resolved city (reverse-geocoded). Selecting a different city persists to `UserPreferences` and refetches Discover. TM query sends `city` + `stateCode` + `countryCode` (the city's resolved values) instead of `latlong`+`radius`. Fallback to `latlong`+`radius` (current behavior) only when the city query returns fewer than 5 results.

S-2 — **Real segmentId + genreId/subGenreId.** New server-owned constants file at `supabase/functions/_shared/ticketmasterClassifications.ts` containing canonical TM classification IDs. Discover gains a top-row segment switcher (single-select: Music / Sports / Arts & Theatre / Comedy / Family / Film). The genre filter section is context-aware (renders only genres that exist within the selected segment). Discover sends `segmentId` + `genreIds[]` to the edge function; edge function passes them to TM verbatim. Client never ships TM IDs as magic strings — chips reference user-facing slugs, server resolves slugs to TM IDs.

S-3 — **localStartEndDateTime for date chips.** Replace UTC `startDateTime`/`endDateTime` params with TM's `localStartEndDateTime` (a single array param TM filters against the venue's local time). Date math continues to compute against the user's device-local clock; format change from UTC ISO `…Z` to TM local-time ISO (no trailing `Z`). All four chips (Tonight / This Weekend / Next Week / This Month) benefit from the single change.

S-4 — **Delete the price filter from Discover.** Remove `PriceFilter` type, `selectedFilters.price`, `TIER_BY_SLUG` filter logic, `priceFilterOptions` list, and the Price section of the filter modal. Update `moreChipBadgeCount` accounting. Reap unused imports (`PRICE_TIERS`, `TIER_BY_SLUG`, `PriceTierSlug`) IF unused elsewhere in DiscoverScreen.tsx; preserve if other Discover code still references them. New strict-grep gate proves removal.

## §3 — Out of Scope (deferred — do NOT implement in this ORCH)

- Reintroducing the price filter — separate ORCH when Mingla Business native events (with structured `ticket_types.unit_price_cents` pricing) are integrated into Discover.
- City picker affecting Mingla-native events, places, or any non-Ticketmaster Discover source.
- TM `marketId` / `dmaId` location parameters (would require city→marketId map).
- TM `includeTBA` / `includeTBD` hygiene flags (defer until QA hits TBA noise).
- TM `unit=miles` toggle (defer until UX asks).
- Sort options beyond `date,asc` (defer; TM also supports `distance,asc`, `relevance,desc`).
- TM attraction / venue / promoter deep links.
- Radius slider UI (city replaces radius as primary control; lat/lng fallback path keeps the existing 50 km).
- Free-text keyword search box (TM `keyword` param exposed as user input).
- Multi-segment selection (M1 ships single-select segment — multi-select can be a follow-up if usage data warrants).
- Reverse-geocoding "GPS → city" UX edge cases beyond first-paint default (e.g. user moves to a new city mid-session) — out of scope; current behavior is fine because user has a city pinned.

## §4 — Five-Truth-Layer Anchor (audit summary, not full investigation)

| Layer | Current truth |
|---|---|
| **Docs** | Ticketmaster Discovery API v2 accepts 44 query params; Mingla sends 8. Free-tier API. |
| **Schema** | `preferences` table has `custom_lat numeric, custom_lng numeric, custom_location text, use_gps_location boolean NOT NULL DEFAULT true`. No city columns. `ticketmaster_events_cache` table caches by `cache_key` text PK + `events jsonb` + `total_results int` + `fetched_at timestamptz` + `expires_at timestamptz`. |
| **Code** | `app-mobile/src/components/DiscoverScreen.tsx:92-114` (filter types + `GENRE_TO_KEYWORDS` map), `:116-170` (`getDateRange` local-then-UTC), `:911-956` (`fetchNightOutEvents` callsite, hardcoded `radius: 50`), `:1086-1118` (price post-filter), `:1124-1125` (badge counter), `:1136-1142` + `:1497-1527` (price modal section). `app-mobile/src/services/nightOutExperiencesService.ts:47-106` (service layer). `supabase/functions/ticketmaster-events/index.ts:16` (Music ID hardcoded), `:269` (radius default 50), `:309-322` (TM URL build), `:325-332` (date stripMs UTC pass-through), `:108-117` (cache key 0.1° precision). |
| **Runtime** | TM `/discovery/v2/events.json` accepts `city` (array), `stateCode`, `countryCode`, `segmentId` (array), `genreId` (array), `subGenreId` (array), `classificationName` (array with `-` exclusion), `localStartEndDateTime` (array — single param replacing UTC pair, filters against venue local time). All free tier. |
| **Data** | `ticketmaster_events_cache` exists with `cache_key` schema `geo:lat:lng:kw:keywords:d:startDate`. Will require a v2 prefix to coexist with new key shape. |

## §5 — Contract Per Layer

### §5.1 — Database layer

**Migration:** `supabase/migrations/<timestamp>_orch_0807_discover_city_preferences.sql`

Add five nullable columns to `public.preferences`:

```sql
ALTER TABLE public.preferences
  ADD COLUMN discover_city_name text NULL,
  ADD COLUMN discover_city_state_code text NULL,
  ADD COLUMN discover_city_country_code text NULL,
  ADD COLUMN discover_city_lat numeric NULL,
  ADD COLUMN discover_city_lng numeric NULL;

COMMENT ON COLUMN public.preferences.discover_city_name IS
  'ORCH-0809: User-selected city for Discover Ticketmaster filter. NULL = use GPS-resolved city (no override). discover_city_lat/lng are denormalized from Google Places autocomplete at write time for the lat/lng fallback path when TM city query returns < 5 results.';
```

**Why nullable:** existing users have no selected city — NULL means "use GPS-resolved city as the default chip value, with no persisted override." First time the user picks a city, all five columns get written together.

**RLS:** No new policies. The existing `preferences_owner_select` + `preferences_owner_insert` + `preferences_owner_update` policies cover the new columns because they predicate on `user_id = auth.uid()`. **Implementor MUST grep the migration chain to confirm these three policies exist with current names** (see `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` for the baseline). If a policy uses a SECURITY DEFINER helper, **no change required** — additive columns inherit policy coverage.

**Apply-time verification probe (inside migration):**

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'preferences'
    AND column_name IN ('discover_city_name','discover_city_state_code','discover_city_country_code','discover_city_lat','discover_city_lng')
    GROUP BY table_name HAVING COUNT(*) = 5
  ) THEN
    RAISE EXCEPTION 'ORCH-0809 migration failed: not all 5 discover_city_* columns present on preferences';
  END IF;
END$$;
```

**Cache table:** No schema change. Existing `ticketmaster_events_cache` is fine; new key prefix `v2:` keeps v2 keys distinct from v1 (`geo:`) so v1 rows expire naturally over their 2-hour TTL. No manual flush required.

### §5.2 — Edge function layer

**File touched:** `supabase/functions/ticketmaster-events/index.ts`

**Request schema v2 (backward-compatible — v1 shape still accepted):**

```ts
interface RequestBody {
  // v1 fields (preserved for backward compat)
  location?: { lat: number; lng: number };  // now optional — used when city resolves to < 5 results, or when city not provided
  radius?: number;                           // default 50 km — used only with lat/lng fallback
  keywords?: string[];                       // FREE-TEXT keyword search (NOT genre-mapped any more); v1 callers may still pass
  startDate?: string;                        // v1 UTC startDateTime — DEPRECATED but still accepted
  endDate?: string;                          // v1 UTC endDateTime — DEPRECATED but still accepted
  sort?: string;
  page?: number;
  size?: number;

  // v2 NEW fields (additive)
  city?: string;                             // city name from Google Places — e.g. "Brooklyn"
  stateCode?: string | null;                 // ISO-3166-2 region code — e.g. "NY"
  countryCode?: string | null;               // ISO-3166-1 alpha-2 — e.g. "US"
  segmentId?: string;                        // TM segment ID from server-owned map — e.g. Music's "KZFzniwnSyZfZ7v7nJ"
  genreIds?: string[];                       // TM genre IDs (any number; TM accepts array)
  subGenreIds?: string[];                    // TM sub-genre IDs (defer to follow-up if M1 only ships genre-level)
  localStartEndDateTime?: string;            // TM local-time pair "2026-05-12T00:00:00,2026-05-12T23:59:59" — REPLACES startDate/endDate when provided
}
```

**Request validation rules:**

1. If `city` is present, `stateCode` SHOULD be present and `countryCode` SHOULD be present (TM disambiguation). Edge function does NOT enforce this — TM tolerates city alone. SPEC notes it; client always sends all three when available.
2. If neither `city` nor `location` is present → HTTP 400 `{ error: "city or location is required" }`.
3. If `segmentId` is present, it must be a string of length 18 matching TM's classification ID pattern (`^KZ[A-Za-z0-9]+$`). On mismatch → HTTP 400 `{ error: "invalid segmentId" }`.
4. If `localStartEndDateTime` is present AND `startDate`/`endDate` are also present, `localStartEndDateTime` wins (logged as warning).
5. Backward compat: v1 callers (only `location`+`radius`, no city/segment) continue to work. Edge function detects "v1 shape" when `city` is absent and `segmentId` is absent → defaults `segmentId` to Music (existing behavior) and uses `latlong`+`radius`.

**Response schema:** UNCHANGED. Same `{ events: TicketmasterEvent[], meta: {...} }` shape. The `TicketmasterEvent.distance` field becomes optional when city-mode is used (no anchor point for haversine). When city-mode, set `distance` to `null` instead of fabricating from city centroid. Implementor extends the type:

```ts
distance: number | null;  // null when city-mode (no haversine anchor)
```

**Cache key v2:**

```ts
function buildCacheKey(input: {
  city?: string;
  stateCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  segmentId?: string;
  genreIds?: string[];
  localStartEndDateTime?: string;
}): string {
  // v2 prefix isolates from v1 cache rows; let v1 expire over its 2h TTL.
  if (input.city) {
    const segPart = input.segmentId ?? "any";
    const genrePart = (input.genreIds ?? []).sort().join(",") || "any";
    const dtPart = input.localStartEndDateTime ?? "any";
    return `v2:city:${input.city.toLowerCase()}:${(input.stateCode ?? "").toLowerCase()}:${(input.countryCode ?? "").toLowerCase()}:seg:${segPart}:gen:${genrePart}:dt:${dtPart}`;
  }
  // Lat/lng fallback path — same precision as v1 (0.1°)
  return `v2:geo:${input.lat!.toFixed(1)}:${input.lng!.toFixed(1)}:seg:${input.segmentId ?? "any"}:gen:${(input.genreIds ?? []).sort().join(",") || "any"}:dt:${input.localStartEndDateTime ?? "any"}`;
}
```

TTL: unchanged (2 hours). Cleanup logic: unchanged.

**TM URL builder:**

```ts
const params = new URLSearchParams({
  apikey: TICKETMASTER_API_KEY,
  sort: sortBy,
  size: pageSize.toString(),
  page: pageNum.toString(),
});

// Location: city preferred, lat/lng fallback
if (input.city) {
  params.set("city", input.city);
  if (input.stateCode) params.set("stateCode", input.stateCode);
  if (input.countryCode) params.set("countryCode", input.countryCode);
} else {
  params.set("latlong", `${input.lat},${input.lng}`);
  params.set("radius", (input.radius ?? 50).toString());
  params.set("unit", "km");
}

// Segment: v2 segmentId or v1 default to Music
params.set("segmentId", input.segmentId ?? MUSIC_SEGMENT_ID);

// Genre IDs (v2 only — preferred over keyword)
if (input.genreIds && input.genreIds.length > 0) {
  params.set("genreId", input.genreIds.join(","));
}

// Sub-genre IDs (v2 only — if shipped in M1; SPEC permits deferral)
if (input.subGenreIds && input.subGenreIds.length > 0) {
  params.set("subGenreId", input.subGenreIds.join(","));
}

// Keywords (v1 + v2 free-text path)
if (input.keywords && input.keywords.length > 0) {
  params.set("keyword", input.keywords.join(","));
}

// Date window: localStartEndDateTime preferred, UTC fallback for v1
if (input.localStartEndDateTime) {
  params.set("localStartEndDateTime", input.localStartEndDateTime);
} else {
  if (input.startDate) {
    const start = input.startDate.includes("T") ? input.startDate : `${input.startDate}T00:00:00Z`;
    params.set("startDateTime", stripMs(start));
  }
  if (input.endDate) {
    const end = input.endDate.includes("T") ? input.endDate : `${input.endDate}T23:59:59Z`;
    params.set("endDateTime", stripMs(end));
  }
}
```

**Fallback trigger (city → lat/lng):**

If city-mode is used and the TM response `tmData.page?.totalElements` is less than 5 AND `latFallback`/`lngFallback` are present in the request body (passed by client when both available), the edge function automatically retries with `latlong`+`radius`+`unit=km`+`segmentId`+`genreId`+`localStartEndDateTime` and returns the fallback result with `meta.usedFallback: true`. The client uses this flag to surface "Showing nearby because '<city>' has no events" copy.

**New request fields for fallback support:**

```ts
latFallback?: number;
lngFallback?: number;
radiusFallback?: number;  // default 50 km
```

Client always populates these from the persisted `discover_city_lat`/`discover_city_lng` (denormalized at city-pick time) or from current GPS when GPS is available and city is the GPS-default. Edge function does NOT re-resolve city to lat/lng — that's the client's responsibility at city-pick time.

### §5.3 — Server-owned classifications

**New file:** `supabase/functions/_shared/ticketmasterClassifications.ts`

```ts
/**
 * ORCH-0809: Server-owned Ticketmaster classification IDs.
 *
 * Source: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *   GET /discovery/v2/classifications.json
 *
 * Implementor MUST verify each ID by fetching the classifications endpoint
 * during implementation and pinning the response. Re-verify whenever this file
 * is touched. Client never ships these IDs — slugs are the only thing crossing
 * the wire from client to server.
 */

export type DiscoverSegmentSlug =
  | "music"
  | "sports"
  | "arts-theatre"
  | "comedy"
  | "family"
  | "film";

export const DISCOVER_SEGMENT_ID: Record<DiscoverSegmentSlug, string> = {
  "music":         "KZFzniwnSyZfZ7v7nJ",  // verified 2026-05-12 via TM Discovery API docs
  "sports":        "KZFzniwnSyZfZ7v7nE",  // VERIFY before merge
  "arts-theatre":  "KZFzniwnSyZfZ7v7na",  // VERIFY before merge
  "comedy":        "KZFzniwnSyZfZ7v7n1",  // VERIFY before merge (TM may classify Comedy under Arts & Theatre's genre tree)
  "family":        "KZFzniwnSyZfZ7v7nn",  // VERIFY before merge
  "film":          "KZFzniwnSyZfZ7v7nn",  // VERIFY before merge
};

export type DiscoverGenreSlug =
  // Music genre slugs (the eleven currently in DiscoverScreen.tsx + replacements)
  | "all"
  | "afrobeats"
  | "dancehall"
  | "hiphop-rnb"
  | "house"
  | "techno"
  | "jazz-blues"
  | "latin-salsa"
  | "reggae"
  | "kpop"
  | "acoustic-indie"
  // Sports genre slugs (M1 — minimal viable set)
  | "basketball"
  | "football-nfl"
  | "baseball"
  | "soccer"
  | "hockey"
  // Arts & Theatre slugs (M1 — minimal viable set)
  | "theatre"
  | "musical"
  | "dance"
  // (extend as product chooses; this file is the only place new slugs land)
  ;

/**
 * Map: segment slug → genre slug → TM genre ID.
 * NULL genre slug means "any genre within this segment" (no genre filter).
 *
 * Implementor MUST verify each ID by hitting TM classifications endpoint
 * with the segment ID and grepping the response.
 */
export const DISCOVER_GENRE_ID: Record<DiscoverSegmentSlug, Partial<Record<DiscoverGenreSlug, string>>> = {
  "music": {
    "afrobeats":       "VERIFY",  // TM may not have a top-level afrobeats genre — confirm via /classifications
    "dancehall":       "VERIFY",
    "hiphop-rnb":      "KnvZfZ7vAv1",  // TM "Hip-Hop/Rap" — VERIFY
    "house":           "VERIFY",
    "techno":          "VERIFY",
    "jazz-blues":      "VERIFY",
    "latin-salsa":     "VERIFY",
    "reggae":          "VERIFY",
    "kpop":            "VERIFY",
    "acoustic-indie":  "VERIFY",
  },
  "sports": {
    "basketball":   "VERIFY",
    "football-nfl": "VERIFY",
    "baseball":     "VERIFY",
    "soccer":       "VERIFY",
    "hockey":       "VERIFY",
  },
  "arts-theatre": {
    "theatre":  "VERIFY",
    "musical":  "VERIFY",
    "dance":    "VERIFY",
  },
  "comedy": {},
  "family": {},
  "film":   {},
};

/**
 * Helper: resolve a (segment slug, genre slug[]) pair to TM IDs the edge
 * function can pass to /discovery/v2/events.json. Unknown slugs are dropped
 * silently (defensive — the edge function can still query by segmentId alone).
 */
export function resolveTmClassification(
  segmentSlug: DiscoverSegmentSlug,
  genreSlugs: DiscoverGenreSlug[]
): { segmentId: string; genreIds: string[] } {
  const segmentId = DISCOVER_SEGMENT_ID[segmentSlug];
  const genreMap = DISCOVER_GENRE_ID[segmentSlug] ?? {};
  const genreIds = genreSlugs
    .filter((slug) => slug !== "all")
    .map((slug) => genreMap[slug])
    .filter((id): id is string => typeof id === "string" && id !== "VERIFY");
  return { segmentId, genreIds };
}
```

**Implementation note:** Every `"VERIFY"` placeholder MUST be replaced with a real TM classification ID before merge. The implementor verifies via `curl 'https://app.ticketmaster.com/discovery/v2/classifications.json?apikey=...&size=200'` and pins the response (or via Anthropic Web search in the implementor's runtime). If any classification cannot be verified, the slug is removed from `DISCOVER_GENRE_ID` (the chip then renders but the genre filter degrades to "segment only" — acceptable). The strict-grep gate (§9) asserts zero `"VERIFY"` literals in the file.

### §5.4 — Client service layer

**File touched:** `app-mobile/src/services/nightOutExperiencesService.ts`

New signature (additive; v1 signature preserved for backward compat — but Discover migrates to the new one):

```ts
export interface NightOutSearchInput {
  // Location — exactly ONE of city or location must be present
  city?: {
    name: string;
    stateCode?: string | null;
    countryCode?: string | null;
    fallbackLat?: number;   // for edge function's < 5-result fallback
    fallbackLng?: number;
    fallbackRadiusKm?: number;  // default 50
  };
  location?: { lat: number; lng: number };
  radius?: number;            // km — only used with location

  // Classification
  segmentSlug?: DiscoverSegmentSlug;     // imported from shared types (see §5.5)
  genreSlugs?: DiscoverGenreSlug[];

  // Date window (local time)
  localStartEndDateTime?: string;        // "2026-05-12T00:00:00,2026-05-12T23:59:59"

  // Pagination
  sort?: string;
  page?: number;
  size?: number;
}

export interface NightOutSearchOutput {
  events: NightOutVenue[];
  meta: EventsMeta & { usedFallback?: boolean };
}

static async search(input: NightOutSearchInput): Promise<NightOutSearchOutput>;
```

The legacy `getEvents(location, options)` signature is **deleted** because Discover is the only caller (verified via grep). The implementor MUST verify no other call sites exist before removing.

Service responsibility: build the edge function body, invoke, parse error, log. No magic — slugs go through verbatim, edge function (or a shared helper at `app-mobile/src/services/_shared/tmClassifications.ts` — a CLIENT mirror of the server constants but ONLY for slugs, never IDs) determines what fields land in the wire request.

**Important:** Slug-to-ID mapping lives ONLY on the server. The client passes slugs. The edge function resolves to TM IDs. This preserves the "one owner per truth" constitutional principle.

### §5.5 — Client shared types

**New file:** `app-mobile/src/types/discoverFilters.ts`

```ts
// Client-side mirror of server slug taxonomy. Slugs ONLY — never TM IDs.
// Server-owned authoritative source: supabase/functions/_shared/ticketmasterClassifications.ts

export type DiscoverSegmentSlug =
  | "music"
  | "sports"
  | "arts-theatre"
  | "comedy"
  | "family"
  | "film";

export type DiscoverGenreSlug =
  | "all"
  | "afrobeats" | "dancehall" | "hiphop-rnb" | "house" | "techno"
  | "jazz-blues" | "latin-salsa" | "reggae" | "kpop" | "acoustic-indie"
  | "basketball" | "football-nfl" | "baseball" | "soccer" | "hockey"
  | "theatre" | "musical" | "dance";

// Genres available per segment — drives the context-aware UI
export const GENRES_BY_SEGMENT: Record<DiscoverSegmentSlug, DiscoverGenreSlug[]> = {
  "music":        ["all","afrobeats","dancehall","hiphop-rnb","house","techno","jazz-blues","latin-salsa","reggae","kpop","acoustic-indie"],
  "sports":       ["all","basketball","football-nfl","baseball","soccer","hockey"],
  "arts-theatre": ["all","theatre","musical","dance"],
  "comedy":       ["all"],
  "family":       ["all"],
  "film":         ["all"],
};

export interface DiscoverCity {
  name: string;
  stateCode: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
}
```

### §5.6 — Client preferences mapping

**File touched:** `app-mobile/src/types/preferences.ts`

Add five fields mirroring the DB additions:

```ts
discover_city_name?: string | null;
discover_city_state_code?: string | null;
discover_city_country_code?: string | null;
discover_city_lat?: number | null;
discover_city_lng?: number | null;
```

**File touched:** `app-mobile/src/services/preferencesService.ts` (or wherever the read/write happens — implementor verifies path). The upsert and select must include the new columns. Default values when unset: all NULL.

### §5.7 — Discover screen UI

**File touched:** `app-mobile/src/components/DiscoverScreen.tsx`

**Removed:**

- `PriceFilter` type (line 93)
- `price` field from `NightOutFilters` interface (line 96-100) — interface becomes `{ date, segment, genre }` where date is unchanged (kept as `DateFilter`), segment is new (`DiscoverSegmentSlug`), genre is `DiscoverGenreSlug`.
- `GENRE_TO_KEYWORDS` map (lines 102-114) — replaced by server-owned classification map.
- Price filter section in modal (lines 1497-1527).
- Price post-filter logic in `filteredNightOutCards` useMemo (lines 1086-1118) — useMemo simplified to sort-only.
- `priceFilterOptions` list (lines 1136-1142).
- `PRICE_TIERS` / `TIER_BY_SLUG` / `PriceTierSlug` imports IF unused elsewhere in the file (implementor greps).
- `selectedFilters.price !== "any"` term in `moreChipBadgeCount` (line 1124-1125) — recompute as `(segment !== "music" ? 1 : 0) + (genre !== "all" ? 1 : 0)`.

**Added:**

- City chip rendering at top-left of `filterBarAbsolute` (line 1241 region). Shows `selectedCity.name` truncated to 14 chars + caret. Tap opens `CityPickerSheet`.
- Segment switcher chip row above the date chip row (or as a small dropdown to the right of city chip — implementor picks the layout that fits the existing chrome best).
- `CityPickerSheet` component — new file at `app-mobile/src/components/discover/CityPickerSheet.tsx`. Uses `geocodingService.autocomplete()`. Renders typeahead list. On select: writes `discover_city_*` to preferences + closes sheet + triggers refetch.
- Genre filter section in modal: now context-aware via `GENRES_BY_SEGMENT[selectedFilters.segment]`.
- Empty-state when `meta.usedFallback === true`: small banner above the grid reading "Showing events near you — '<city>' has no Ticketmaster events right now."

**Date math change** (in `getDateRange`):

```ts
// Replace toISONoMs() (which returns "...Z") with toLocalISO() that returns
// TM's local-time format (no trailing Z, no timezone offset suffix).
const toLocalISO = (d: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// Return localStartEndDateTime as a comma-joined pair instead of two fields:
function getDateRange(filter: DateFilter): { localStartEndDateTime: string | null } {
  // "any" → null (no date filter)
  if (filter === "any" || filter === "month") {
    // "month" keeps a 30-day forward range; "any" returns null
    if (filter === "any") return { localStartEndDateTime: null };
  }
  // ... existing local-time math unchanged, but at the end:
  return { localStartEndDateTime: `${toLocalISO(rangeStart)},${toLocalISO(rangeEnd)}` };
}
```

**Discover fetch callsite** (lines 911-956):

```ts
const fetchNightOutEvents = useCallback(async (skipCache: boolean = false) => {
  if (!effectiveCity && !(nightOutGpsLat && nightOutGpsLng)) return;  // need EITHER city OR GPS
  setNightOutLoading(true);
  setNightOutError(null);
  try {
    if (!skipCache) {
      const cached = await loadNightOutCache();
      if (cached && cached.date === getTodayDateString() && cached.venues.length > 0 &&
          cached.segment === selectedFilters.segment && cached.genre === selectedFilters.genre &&
          cached.cityName === (effectiveCity?.name ?? null)) {
        setNightOutCards(cached.venues);
        setNightOutLoading(false);
        return;
      }
    }
    const { localStartEndDateTime } = getDateRange(selectedFilters.date);
    const { events, meta } = await NightOutExperiencesService.search({
      city: effectiveCity ? {
        name: effectiveCity.name,
        stateCode: effectiveCity.stateCode,
        countryCode: effectiveCity.countryCode,
        fallbackLat: effectiveCity.lat,
        fallbackLng: effectiveCity.lng,
        fallbackRadiusKm: 50,
      } : undefined,
      location: !effectiveCity ? { lat: nightOutGpsLat!, lng: nightOutGpsLng! } : undefined,
      radius: !effectiveCity ? 50 : undefined,
      segmentSlug: selectedFilters.segment,
      genreSlugs: selectedFilters.genre === "all" ? [] : [selectedFilters.genre],
      localStartEndDateTime: localStartEndDateTime ?? undefined,
      sort: "date,asc",
    });
    setNightOutFallbackActive(meta.usedFallback === true);
    const cards = events.map(transformNightOutVenue);
    setNightOutCards(cards);
    saveNightOutCache(cards, selectedFilters.segment, selectedFilters.genre, effectiveCity?.name ?? null);
  } catch (err) {
    console.error("[Discover] Error fetching events:", err);
    setNightOutError(t("discover:errors.failed_events"));
  } finally {
    setNightOutLoading(false);
  }
}, [effectiveCity, nightOutGpsLat, nightOutGpsLng, selectedFilters.date, selectedFilters.segment, selectedFilters.genre, t]);
```

`effectiveCity` is derived as: `selectedCity ?? gpsResolvedDefaultCity ?? null`. Implementor wires the derivation via a `useEffect` that reverse-geocodes GPS lat/lng to a city on first paint after location resolves, then sets it as the chip default IF the user has no persisted city.

### §5.8 — Cache adapter

The existing AsyncStorage night-out cache (`loadNightOutCache` / `saveNightOutCache`) must extend its key to include segment + city. Implementor updates the cache key string and adds version bump (so v1 cached payloads expire on read).

### §5.9 — Reverse-geocode at first paint

**File touched:** `app-mobile/src/services/geocodingService.ts` (verify path)

Add (or expose, if it already exists) a `reverseGeocode(lat: number, lng: number): Promise<DiscoverCity | null>` function that calls Google Places / Geocoding API and returns the city + state + country. Used ONCE per session on first paint to populate the city chip default. Cached in-memory for the session.

If `reverseGeocode` already exists with a different signature, the implementor adapts the call site rather than adding a duplicate.

## §6 — Success Criteria

| SC | Criterion | Verification |
|---|---|---|
| SC-1 | After signing in with no prior city set, Discover's city chip auto-populates with the GPS-resolved city within 5 seconds of GPS resolving. | iOS Simulator + Android Emulator + Web — tester sets device location, signs in, observes chip. |
| SC-2 | Tapping the city chip opens `CityPickerSheet`, typing "Brook" surfaces "Brooklyn, NY, US" within 2 seconds, selecting it persists `discover_city_name = "Brooklyn"`, `discover_city_state_code = "NY"`, `discover_city_country_code = "US"`, plus `discover_city_lat`/`discover_city_lng` to `preferences`. | Manual + DB probe via Supabase MCP. |
| SC-3 | After picking a city, signing out, signing back in, the chip still shows the picked city (not GPS). | Manual on iOS Simulator. |
| SC-4 | Selecting "Sports" segment surfaces NBA / NFL / MLB events in a real US city (verified via tester device — e.g. New York). Selecting "Music" still surfaces concerts. Selecting "Comedy" surfaces comedy shows. | Real-fire against TM (free tier, no PII). |
| SC-5 | Selecting "Hip-Hop / R&B" genre returns only Hip-Hop / R&B events (verified via the returned `genre`/`subGenre` fields in 10 sampled events). | Tester logs sample. |
| SC-6 | "Tonight" chip at 23:55 device-local time still returns events scheduled before midnight (no UTC drift). "This Weekend" chip on Sunday at 23:00 includes Sunday's late shows. | Tester sets device clock and observes. |
| SC-7 | Price filter is gone from the Discover UI. `selectedFilters` shape has no `price` key. `TIER_BY_SLUG` is not imported in DiscoverScreen.tsx. | strict-grep gate `orch-0807-no-discover-price-filter`. |
| SC-8 | Edge function v1 request shape (`{ location, radius, keywords, startDate, endDate }` only — no `city`/`segmentId`/`localStartEndDateTime`) still returns events successfully. | Deno integration test. |
| SC-9 | When city resolves to fewer than 5 results, edge function automatically retries with lat/lng+radius and sets `meta.usedFallback = true`. Discover shows a "showing nearby because '<city>' has no events" banner. | Deno test (mock TM response) + manual tester smoke with a deliberately empty city. |
| SC-10 | Cache hits do not cross segment, genre, city, or local-date-window boundaries (a Music+Brooklyn query does not serve a Sports+Brooklyn cache row). | Deno test on cache key generation + manual chip-switch refresh check. |
| SC-11 | No `"VERIFY"` literal survives in `supabase/functions/_shared/ticketmasterClassifications.ts`. | strict-grep gate `orch-0807-tm-classification-by-id` Check 5. |
| SC-12 | Client never references a TM classification ID literal (`KZFzniwn…`) anywhere under `app-mobile/`. | strict-grep gate Check 4. |
| SC-13 | UTC `startDateTime`/`endDateTime` no longer appear in the Discover query path of DiscoverScreen.tsx (the `toISONoMs` UTC helper is replaced with the local-time helper). | strict-grep gate `orch-0807-tm-local-time-window`. |
| SC-14 | `useGpsFlag = false` user with no `discover_city_*` set and no `custom_lat`/`custom_lng` triggers a clear "set your city" prompt on Discover, not a silent empty state. | Manual edge case. |

## §7 — Invariants

### §7.1 — Existing invariants preserved

- **Constitution #3 No silent failures** — price filter (which silently hid results) is removed; new `usedFallback` flag is surfaced to the user with explicit copy.
- **Constitution #4 One key per entity** — React Query key for night-out cache is updated to include segment + genre + city; no orphan keys.
- **Constitution #9 No fabricated data** — genre chips return actual TM-classified events; no keyword guessing. The TM `distance` field is `null` (not 0, not fabricated) when city-mode is active.
- **I-LOCATION-INVALIDATE-ON-LOCATION-ONLY** (per `useUserLocation.ts:148`) — the city chip is part of `UserPreferences` but not part of the location React Query key. City changes invalidate the night-out cache key, NOT the location key. Implementor must not add city to `['userLocation', ...]`.
- **Zustand-persist no server snapshots** (memory `feedback_zustand_persist_no_server_snapshots.md`) — `DiscoverCity` is an ID-handle, NOT a server snapshot. Persisting name+state+country+lat+lng is denormalization of Google Places autocomplete output (a foreign-system handle), not a Mingla-server record. ALLOWED.

### §7.2 — New invariants proposed

**I-PROPOSED-BL DISCOVER_CITY_PERSISTED** (status: DRAFT — flips ACTIVE on ORCH-0809 CLOSE)

When the user selects a city on the Discover surface, the chosen `(discover_city_name, discover_city_state_code, discover_city_country_code, discover_city_lat, discover_city_lng)` MUST persist to `public.preferences` for that user. Subsequent app sessions MUST render that city as the active Discover filter regardless of current GPS position. GPS-derived city is the chip's default ONLY when `discover_city_name IS NULL` for the user. Strict-grep gate Check 2 enforces presence of the migration + the columns + the upsert call site.

**I-PROPOSED-BM DISCOVER_TM_CLASSIFICATION_BY_ID** (status: DRAFT — flips ACTIVE on ORCH-0809 CLOSE)

Discover Ticketmaster queries MUST pass real `segmentId` and `genreId` values resolved from `supabase/functions/_shared/ticketmasterClassifications.ts`. The client MUST NOT ship TM classification ID literals (those starting with `KZ`). The edge function MUST resolve client-provided slugs to TM IDs server-side via `resolveTmClassification`. Keyword-based genre proxying (the old `GENRE_TO_KEYWORDS` map) is removed; free-text `keyword` remains a legitimate user-input search param when product re-introduces a search box. Strict-grep gate enforces zero client TM-ID references and zero `"VERIFY"` placeholders in the server constants file.

**I-PROPOSED-BN DISCOVER_TM_LOCAL_TIME_WINDOWS** (status: DRAFT — flips ACTIVE on ORCH-0809 CLOSE)

Discover date chips (Tonight, This Weekend, Next Week, This Month) MUST compute their Ticketmaster query window in the user's device-local timezone and pass it to TM via `localStartEndDateTime`. UTC `startDateTime` and `endDateTime` are REMOVED from the Discover query path. The edge function still accepts the legacy UTC pair for backward compat with any v1 caller, but Discover always sends `localStartEndDateTime`. Strict-grep gate enforces removal of `toISOString()` + `Z`-suffixed format builders in the `getDateRange` function within `DiscoverScreen.tsx`.

## §8 — Test Cases

| T | Scenario | Inputs | Expected | Layer |
|---|---|---|---|---|
| T-01 | First-paint default | New user, GPS resolves to (40.71, -74.00) | Chip shows "New York"; preferences row has `discover_city_name = NULL` | Component + Hook |
| T-02 | Pick city, persists | User types "Brook" → selects "Brooklyn, NY, US" | DB row updated; chip shows "Brooklyn"; refetch fires | Component + Service + DB |
| T-03 | Persistence across sign-out | T-02 then sign out + sign in | Chip still shows "Brooklyn" | Component + DB |
| T-04 | Segment switch — Sports | Select Sports segment, query NYC | Returns NBA/NFL events; no concerts | Edge + Runtime |
| T-05 | Genre filter — Hip-Hop | Music segment + Hip-Hop / R&B genre, NYC | All 10 sampled events have genre=Hip-Hop/Rap | Edge + Runtime |
| T-06 | Local-time Tonight | Device clock 23:55 local Friday, "Tonight" chip | Returns Friday 11:30 PM events; doesn't roll to Saturday | Component + Edge |
| T-07 | Local-time Weekend | Device clock 22:00 Sunday, "This Weekend" chip | Includes Sunday 22:00–23:59 events | Component + Edge |
| T-08 | Price filter UI gone | DiscoverScreen renders | No Price section in filter modal; `selectedFilters.price` undefined | Component + strict-grep |
| T-09 | Edge function v1 compat | Edge function called with only `{ location, radius }` | Returns Music events with Music segment default; no error | Edge function unit test |
| T-10 | Fallback trigger | Edge function called with `city = "Nowheresville"` (returns 0 TM results) and `latFallback`/`lngFallback` present | Retries with lat/lng; response has `meta.usedFallback: true`; Discover shows fallback banner | Edge function integration test + Component |
| T-11 | Cache key isolation | Music+NYC query, then switch to Sports+NYC | Second query does NOT serve first query's cache row | Cache key unit test |
| T-12 | No `"VERIFY"` placeholders | Read classifications file | Zero `"VERIFY"` literals | strict-grep |
| T-13 | No client TM IDs | grep `app-mobile/` for `KZFzniwn` | Zero matches | strict-grep |
| T-14 | No UTC date params in Discover | grep `DiscoverScreen.tsx` for `toISOString` in `getDateRange` | Zero matches; only `toLocalISO` helper exists | strict-grep |
| T-15 | Negative — re-introduce price filter | Implementor sanity check: add `price: "any"` back to `selectedFilters` → CI must fail | strict-grep gate fires (negative control) |
| T-16 | Migration probe | Apply migration, check 5 columns present on `preferences` | Migration `DO $$` probe RAISE EXCEPTIONs on missing columns | Migration apply |
| T-17 | RLS preservation | Non-owner user attempts SELECT on another user's preferences | Returns 0 rows | RLS smoke test |
| T-18 | useGpsFlag=false + no city | User with `use_gps_location=false`, `custom_lat=NULL`, `discover_city_name=NULL` | Discover shows "Set your city" prompt, NOT silent empty | Component |
| T-19 | Reverse-geocode failure | Mock `reverseGeocode` rejection on first paint | Chip falls back to "Use my location" or stays empty with clear copy; no crash | Component |
| T-20 | iOS/Android/Web parity | All above on each platform | Same behavior across all three | Tester live-fire |

## §9 — Strict-Grep CI Gates

All three gates are registered as new jobs in `.github/workflows/strict-grep-mingla-business.yml` per the registry pattern (one script + one job, no parallel workflow files). The mobile app is covered by the same workflow file historically; if not, the implementor adds a parallel mobile-mirror script. **Implementor verifies the correct workflow file for `app-mobile/` paths.**

### Gate 1: `orch-0807-no-discover-price-filter`

Path: `.github/scripts/strict-grep/orch-0807-no-discover-price-filter.mjs`

5 checks:
1. `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain the literal `selectedFilters.price`
2. `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain the literal `TIER_BY_SLUG`
3. `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain the literal `priceFilterOptions`
4. `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain the type alias `type PriceFilter`
5. `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain the literal `tier_${tier.slug}` (the i18n key for price tier label)

Negative control: implementor must prove the gate fires by temporarily re-adding any one of the five removed literals.

### Gate 2: `orch-0807-tm-classification-by-id`

Path: `.github/scripts/strict-grep/orch-0807-tm-classification-by-id.mjs`

6 checks:
1. File `supabase/functions/_shared/ticketmasterClassifications.ts` exists
2. File exports `DISCOVER_SEGMENT_ID`, `DISCOVER_GENRE_ID`, `resolveTmClassification`
3. File does NOT contain the literal `"VERIFY"` anywhere
4. `supabase/functions/ticketmaster-events/index.ts` imports `resolveTmClassification` from the shared file
5. `app-mobile/` does NOT contain the literal `KZFzniwn` (Ticketmaster classification ID prefix) — checked via recursive grep over `app-mobile/src/` and `app-mobile/app/`
6. `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain `GENRE_TO_KEYWORDS`

### Gate 3: `orch-0807-tm-local-time-window`

Path: `.github/scripts/strict-grep/orch-0807-tm-local-time-window.mjs`

4 checks:
1. `app-mobile/src/components/DiscoverScreen.tsx` `getDateRange` function does NOT use `toISOString()` (the UTC formatter)
2. `app-mobile/src/components/DiscoverScreen.tsx` does NOT contain a `toISONoMs` helper (old helper removed)
3. `app-mobile/src/components/DiscoverScreen.tsx` contains a `toLocalISO` helper (new helper present)
4. `supabase/functions/ticketmaster-events/index.ts` references `localStartEndDateTime` (proves the param is wired)

## §10 — Implementation Order

The implementor MUST execute in this exact order. Skipping or reordering invalidates the spec.

1. **DB migration** — write and verify migration adds 5 columns + apply-time probe + has no impact on existing rows. DO NOT run `supabase db push --linked` (operator owns DB push).
2. **Server constants** — create `supabase/functions/_shared/ticketmasterClassifications.ts`. **Resolve every `"VERIFY"`** via TM `/classifications` endpoint. Implementor must include the curl command they ran in their report. If any genre slug cannot be resolved, document and remove from the slug union.
3. **Edge function v2** — extend `supabase/functions/ticketmaster-events/index.ts` with the new request shape, backward-compat detection, classification resolution, local-time date path, fallback trigger, and v2 cache key. Deno tests for: v1 shape pass-through, v2 city path, v2 segment + genre path, fallback path, cache key isolation, malformed input → 400. Edge deploy is **orchestrator-owned** — implementor does NOT deploy.
4. **Client types** — `app-mobile/src/types/discoverFilters.ts` and `app-mobile/src/types/preferences.ts` extensions.
5. **Client service** — rewrite `nightOutExperiencesService.ts` with the new `search(input)` signature.
6. **CityPickerSheet component** — new file. Uses `geocodingService.autocomplete()` and the persistence call.
7. **DiscoverScreen.tsx surgery** — remove price filter, add segment switcher, wire city chip, switch date math to local time, update fetch callsite, update cache key.
8. **Reverse-geocode wiring** — add or expose `reverseGeocode` in `geocodingService.ts`; wire to first-paint city-default useEffect.
9. **Strict-grep gates** — three new scripts + three new workflow jobs. Negative-control each gate (prove it fires when the literal is restored).
10. **Jest / Deno tests** — T-01 through T-20. Cross-domain blast probe: `grep -lE "nightOutExperiencesService|GENRE_TO_KEYWORDS|TIER_BY_SLUG" app-mobile/` to confirm zero unintended consumers.
11. **Implementation report** — write to `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0809_DISCOVER_TICKETMASTER_FILTER_EXPANSION_V1.md`. Include classification-verification curl output, gate negative-control output, T-* results matrix.

## §11 — Hard Guards (binding on implementor)

- **No implementation outside the named files.** Adding a new shared util is allowed only if existing utils don't fit; report any new file in the impl report.
- **No `supabase db push`.** Operator owns DB push. Implementor writes and tests the migration locally only.
- **No edge function deploy.** Orchestrator deploys post-implementation per memory `feedback_orchestrator_deploys_edge_functions.md`.
- **No provider secrets in code.** TM API key stays in env. Google Places key stays in env. Test fixtures use synthetic strings.
- **No real-user PII in tests.** Use synthetic email/UUIDs.
- **No `KZFzniwn…` literals in client code.** Classification IDs are server-owned.
- **No `"VERIFY"` placeholders surviving in the constants file.** Every ID must be resolved or the slug removed.
- **No `useGpsFlag` regression.** I-LOCATION-INVALIDATE-ON-LOCATION-ONLY (lines 145-150 of `useUserLocation.ts`) — city changes must not invalidate the location query key.
- **No price filter sneak-back.** Strict-grep Gate 1 makes this impossible.
- **No silent failure on TM 429 / 5xx.** Existing stale-cache fallback at edge function lines 348-389 is preserved.
- **No type drift between client `DiscoverGenreSlug` and server `DISCOVER_GENRE_ID` keys.** Implementor adds a Deno test that imports both files and asserts the slug sets match.
- **No removal of v1 cache rows.** Let them expire naturally over 2h TTL.

## §12 — Failure Modes

| Failure | Detection | Handling |
|---|---|---|
| City typed but autocomplete returns no result | `geocodingService.autocomplete()` returns `[]` | CityPickerSheet shows "No matches — try a broader query"; user can dismiss without changing |
| User types `"  "` (whitespace) | Client-side trim before query | Skip autocomplete call; show placeholder hint |
| GPS unavailable on first paint, no persisted city | `useUserLocation` returns null + `discover_city_name` is null | Chip shows "Set your city"; tap opens CityPickerSheet directly; events grid shows EmptyState with "set location" action |
| TM city query returns < 5 results | Edge function detects | Auto-retry with lat/lng+radius; set `meta.usedFallback: true`; client shows banner |
| TM returns 429 | Edge function detects (line 348-389) | Existing stale-cache path; no change |
| Classification slug client→server mismatch | Slug not in `DiscoverGenreSlug` union | TypeScript compile error caught locally |
| `localStartEndDateTime` format malformed | Edge function validates pattern `^[\d-]+T[\d:]+,[\d-]+T[\d:]+$` | HTTP 400 with explicit error |
| Migration apply fails | `DO $$` probe RAISES | Transaction rollback; operator re-runs after fix |
| Reverse-geocode fails on first paint | `reverseGeocode` rejection | Catch → chip shows "Set your city"; no crash |
| User's persisted city becomes invalid (Google Places deletes it — very rare) | TM returns 0 results + fallback to lat/lng also 0 | Empty state with "try another city" action |

## §13 — Cross-Domain Blast Verification (implementor pre-flight)

Before declaring done, the implementor MUST run these greps and confirm zero unintended consumers:

```bash
# Client-side: anyone reading GENRE_TO_KEYWORDS?
grep -rn "GENRE_TO_KEYWORDS" app-mobile/

# Client-side: anyone else calling getEvents (v1 signature)?
grep -rn "NightOutExperiencesService\.getEvents" app-mobile/

# Client-side: anyone importing PRICE_TIERS / TIER_BY_SLUG from Discover specifically?
grep -rn "TIER_BY_SLUG" app-mobile/

# Server-side: anyone else calling ticketmaster-events edge function?
grep -rn "ticketmaster-events" app-mobile/ mingla-admin/ mingla-business/

# Edge function: anyone else importing from _shared/ticketmasterClassifications.ts (shouldn't exist yet)?
grep -rn "ticketmasterClassifications" supabase/

# DB: anyone else querying discover_city_* (shouldn't exist yet)?
grep -rn "discover_city_" supabase/ app-mobile/ mingla-admin/ mingla-business/
```

Expected at pre-flight time: each `discover_city_*` and `ticketmasterClassifications` grep returns ONLY the new files this ORCH creates. Each `GENRE_TO_KEYWORDS` / `TIER_BY_SLUG` grep returns only `DiscoverScreen.tsx` or empty. If anything else surfaces, scope review required before proceeding.

## §14 — Test Coverage (for the implementor's report)

- **Migration apply pass** — `DO $$` probe asserts 5 columns present.
- **RLS smoke** — non-owner SELECT returns 0 rows on another user's `preferences`.
- **Deno edge function tests** — at least: v1 pass-through, v2 city path, v2 segment+genre, fallback trigger, malformed input 400, cache key collision-free.
- **Jest component tests** — at least: city chip renders default, CityPickerSheet opens/persists, segment switch refetches, genre filter narrows results, fallback banner shows when `meta.usedFallback`.
- **Slug parity test** — Deno test imports `DiscoverGenreSlug` (client mirror) and `DISCOVER_GENRE_ID` (server) and asserts every client slug appears in at least one server segment's genre map (allowing for slugs that legitimately map to "no genre filter" like "all"/family/comedy variations).

## §15 — Lifecycle After SPEC

1. **Orchestrator REVIEW** — gate the SPEC against constitution + memory + hard guards.
2. **IMPLEMENT** — Codex `implementor-mingla` (default per canonical routing).
3. **DB push** — operator runs `supabase db push --linked` after implementor reports DONE.
4. **Edge function deploy** — orchestrator runs `supabase functions deploy ticketmaster-events` and verifies version bump.
5. **TEST** — Claude `mingla-forensics` TEST mode (iOS Simulator + Android Emulator + Web Browser parity per memory `feedback_tester_canonical_and_platform_parity.md`).
6. **CLOSE** — orchestrator runs the standard CLOSE protocol: artifact sync (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS), DIAG reap, commit, EAS OTA for `app-mobile/` (`eas update --branch production --platform ios` then `eas update --branch production --platform android` — two separate invocations per memory `feedback_eas_update_no_web.md`; web bundle fails due to `react-native-maps`).
7. **LOCK-IN** — invariants BG/BH/BI flip DRAFT→ACTIVE on CLOSE.

## §16 — Regression Prevention

- **Strict-grep gates 1–3** prevent: price filter reintroduction, classification ID leak to client, UTC date params returning to Discover.
- **Slug-parity Deno test** prevents client/server slug drift.
- **Migration `DO $$` probe** prevents partial column rollout.
- **Backward-compat detection in edge function** prevents v1 callers (admin/business surfaces, if any future ones land) from breaking on the schema change.
- **`I-LOCATION-INVALIDATE-ON-LOCATION-ONLY` guard comment** at `useUserLocation.ts:148` remains in place — implementor MUST NOT touch it.

---

**End of SPEC.**
