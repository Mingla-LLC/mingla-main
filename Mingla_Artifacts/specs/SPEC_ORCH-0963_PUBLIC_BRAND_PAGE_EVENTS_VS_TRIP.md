# SPEC — ORCH-0963 [Public brand page business-case optimization (events vs. trip brands)]

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-25
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/` on branch `ORCH-0963-public-brand-page-events-vs-trip`
**Investigation input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` (same worktree)
**Severity:** S2-medium / `missing-feature` + `ux` + `architecture-flaw`
**Decisions locked at INVESTIGATE §7:** (1) single-component branched, (2) bundle event-brand IA polish, (3) SECURITY DEFINER RPC for public trips

---

## 0. Layman summary

Today `/b/{slug}` renders the same Upcoming/Past/About event-shaped page for every brand. This SPEC defines the contract that:

- For **trip-planner brands** (e.g., `travelbrand`): the page surfaces a Trips/Past Trips/About tab triad with trip cards showing destination, date range, price-from, and honest spots-left.
- For **event brands** (`physical`, `popup`): the page keeps Upcoming/Past/About but lifts the first upcoming event ABOVE the bio with a one-line teaser strip ("Next: Friday — Slow Burn vol. 4 · From £15 →"), and pins the first 3 upcoming-event cards with a sticky "From £X · Buy tickets" CTA pill.

One file (`PublicBrandPage.tsx`) stays one file. A new SECURITY DEFINER RPC (`pg_public_trips_by_brand`) feeds the trip-card data with spots-left and price-from pre-aggregated so cards render in one round-trip. The existing event-fetch path is unchanged for event brands.

The change is buyer-web only. App-mobile is not in scope (proven by F-7).

---

## 1. Scope

### In scope

1. **DB:** New SECURITY DEFINER RPC `pg_public_trips_by_brand(p_brand_slug text)` returning one row per public trip with pre-aggregated capacity + sold + min-price columns.
2. **Service:** New `getPublicTripsByBrandSlug(brandSlug)` in `publicEventsService.ts`; modify `getPublicBrandBySlug` to dispatch on `brand.kind`; widen `BusinessPublicBrandViewRow.kind` TS union.
3. **Hook:** Extend `PublicBrandDetail` return shape to add `trips: PublicTripCard[]`; `usePublicBrandBySlug` signature unchanged.
4. **Component (`PublicBrandPage.tsx`):**
   - Internal branching on `brand.kind === 'trip_planner'`.
   - Tab labels switch (Trips/Past Trips/About vs Upcoming/Past/About).
   - New `<TripMiniCard>` primitive.
   - New `<NextEventTeaser>` primitive for event-brands (above bio).
   - Sticky "Buy tickets" CTA pill on the first 3 cards in the upcoming-events tab for event brands.
   - Replace the events-only stats card with a kind-appropriate compact stat row (or remove for trip-brands).
5. **Strict-grep CI gate:** new script `orch-0963-public-brand-kind-branched.mjs` enforcing the kind-branch lives in `PublicBrandPage.tsx`.
6. **New invariant:** `I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED` (DRAFT → ACTIVE on CLOSE).
7. **Regression tests:** implementor happy-path + tester adversarial per Step 0.5 gate.

### Out of scope (explicit non-goals)

- Consumer iOS / Android (`app-mobile/`) — no `/b/{slug}` surface there (F-7).
- Trip creation/edit flow — organiser-side, separate territory.
- Paid-trip checkout polish — owned by `/checkout-trip/*` ORCHs.
- Hybrid event+trip brand support — `brands.kind` is immutable single-valued (DEC-161).
- Public-page theme customization (colors, fonts, animations) — owned by ORCH-0964 in parallel; this SPEC explicitly does NOT touch `<Head>` metadata, font tokens, or animation primitives.
- Brand-edit field render audit — owned by ORCH-0962.
- New consumer-facing trip discovery (search, recommendations) — out of scope.
- Migrating existing brands between kinds — not supported and not needed.

### Assumptions (must hold)

- `brands.kind` constraint includes `'trip_planner'` (migration `20260607000000_orch_0855_brands_kind_trip_planner.sql:28`).
- `events` RLS policy `"Public can read published events (anon or authenticated)"` permits anon read of `event_type='trip'` rows with `visibility='public'` and `status IN ('scheduled','live','ended','cancelled')` — already true.
- `event_dates.is_master` exists and holds the canonical start/end for trips (confirmed via Mgmt API SELECT).
- `trip_pricing_tiers.ticket_type_id` joins cleanly to `ticket_types` for price + capacity.
- `tickets.status IN ('valid','used','transferred')` is the canonical "sold" formula per `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE` and `pg_public_ticket_types_remaining` precedent.

---

## 2. Cross-Surface Impact (Phase 2.5 — mandatory)

Per memory rule, each of the 5 primary + 2 adjacent surfaces is named with an explicit in/out declaration.

| # | Surface | In scope? | Why |
|---|---------|-----------|-----|
| 1 | Consumer iOS (`app-mobile/`) | NO | `/b/{slug}` is not consumed by `app-mobile/` (F-7 grep proof). |
| 2 | Consumer Android (`app-mobile/`) | NO | Same as #1. |
| 3 | Buyer/anon Web (`mingla-business/` `/b/{brandSlug}`) | **YES — PRIMARY** | The whole change ships here. |
| 4 | Business iOS (`mingla-business/` on iOS) | NO | Organisers don't render `/b/{slug}` natively; the route is web-only. |
| 5 | Business Android (`mingla-business/` on Android) | NO | Same as #4. |
| 6 | Admin Web (`mingla-admin/`) — adjacent | NO | Admin doesn't render the public brand page. |
| 7 | Business Web preview (`mingla-business/` dev/web build) — adjacent | **YES — TEST PARITY** | Tester drives a local Metro dev build for live-fire verification (Cloudflare blocks headless against prod — D-1). |

**Parity:** automatic across in-scope surfaces — `PublicBrandPage.tsx` is the single render path. No per-surface success criteria split; SC-* below apply globally.

---

## 3. Layer Contracts

### 3.1 Database — new SECURITY DEFINER RPC

**Migration file:** `supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql`

> Naming convention: prefix `20260728000000` is one calendar day after the last applied prod migration (`20260727000001_orch_0957_...`) confirmed via Mgmt API. Per memory rule [[supabase-mcp-workaround]], implementor MUST grep all sibling worktrees under `~/Desktop/mingla-orchs/*/supabase/migrations/` before locking the prefix.

**Contract:**

```sql
-- ORCH-0963 [Public brand page business-case optimization]
-- Anon-callable bulk-by-brand public-trips read path. Powers /b/{slug} for
-- kind='trip_planner' brands. Mirrors pg_public_ticket_types_remaining
-- (ORCH-0946) anon-RPC pattern + biz_trip_tickets_sold (ORCH-0947)
-- canonical sold formula. Preserves I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE.

CREATE OR REPLACE FUNCTION public.pg_public_trips_by_brand(
  p_brand_slug text
)
RETURNS TABLE (
  trip_id          uuid,
  trip_slug        text,
  brand_slug       text,
  title            text,
  description      text,
  destination_text text,
  cover_media_url  text,
  cover_media_type text,
  status           text,
  start_at         timestamptz,
  end_at           timestamptz,
  timezone         text,
  bookings_closed  boolean,
  total_capacity   integer,   -- NULL when any tier is unlimited
  tickets_sold     integer,   -- canonical sold per I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE
  spots_left       integer,   -- NULL when total_capacity IS NULL; never < 0
  min_price_cents  integer,   -- NULL when no paid tiers (all free)
  currency         text,      -- ISO-4217 of the min-price tier
  has_free_tier    boolean,   -- true if any tier is_free
  published_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH brand AS (
    SELECT b.id, b.slug
    FROM public.brands b
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND b.kind = 'trip_planner'
  ),
  trip_rows AS (
    SELECT e.id, e.slug, e.title, e.description, e.destination_text,
           e.cover_media_url, e.cover_media_type, e.status,
           e.timezone, e.bookings_closed, e.published_at
    FROM public.events e
    JOIN brand ON brand.id = e.brand_id
    WHERE e.event_type = 'trip'
      AND e.visibility = 'public'
      AND e.status IN ('scheduled', 'live', 'ended', 'cancelled')
      AND e.deleted_at IS NULL
  ),
  dates AS (
    SELECT ed.event_id, ed.start_at, ed.end_at
    FROM public.event_dates ed
    WHERE ed.event_id IN (SELECT id FROM trip_rows)
      AND ed.is_master = true
  ),
  -- Per-event aggregates over trip_pricing_tiers JOIN ticket_types.
  -- `any_unlimited` flips total_capacity → NULL.
  capacity AS (
    SELECT tpt.event_id,
           bool_or(tt.is_unlimited) AS any_unlimited,
           SUM(tt.quantity_total)::int AS total_capacity
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tpt.event_id IN (SELECT id FROM trip_rows)
      AND tt.deleted_at IS NULL
    GROUP BY tpt.event_id
  ),
  sold AS (
    SELECT tt.event_id, COUNT(*)::int AS tickets_sold
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
    WHERE tt.event_id IN (SELECT id FROM trip_rows)
      AND t.status IN ('valid', 'used', 'transferred')
    GROUP BY tt.event_id
  ),
  pricing AS (
    SELECT tpt.event_id,
           MIN(NULLIF(tt.price_cents, 0)) FILTER (WHERE NOT tt.is_free) AS min_price_cents,
           -- currency tied to the MIN-priced paid tier; tie-break by ticket_type id (deterministic)
           (ARRAY_AGG(tt.currency ORDER BY tt.price_cents ASC, tt.id ASC)
              FILTER (WHERE NOT tt.is_free))[1] AS currency,
           bool_or(tt.is_free) AS has_free_tier
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tpt.event_id IN (SELECT id FROM trip_rows)
      AND tt.deleted_at IS NULL
    GROUP BY tpt.event_id
  )
  SELECT
    tr.id            AS trip_id,
    tr.slug          AS trip_slug,
    (SELECT slug FROM brand) AS brand_slug,
    tr.title,
    tr.description,
    tr.destination_text,
    tr.cover_media_url,
    tr.cover_media_type,
    tr.status,
    d.start_at,
    d.end_at,
    tr.timezone,
    tr.bookings_closed,
    CASE WHEN c.any_unlimited THEN NULL ELSE c.total_capacity END AS total_capacity,
    COALESCE(s.tickets_sold, 0) AS tickets_sold,
    CASE
      WHEN c.any_unlimited THEN NULL
      WHEN c.total_capacity IS NULL THEN NULL
      ELSE GREATEST(c.total_capacity - COALESCE(s.tickets_sold, 0), 0)
    END AS spots_left,
    p.min_price_cents,
    p.currency,
    COALESCE(p.has_free_tier, false) AS has_free_tier,
    tr.published_at
  FROM trip_rows tr
  LEFT JOIN dates    d ON d.event_id = tr.id
  LEFT JOIN capacity c ON c.event_id = tr.id
  LEFT JOIN sold     s ON s.event_id = tr.id
  LEFT JOIN pricing  p ON p.event_id = tr.id
  ORDER BY
    -- Upcoming first (scheduled/live with start_at >= now or NULL), then ended/cancelled
    (CASE WHEN tr.status IN ('scheduled','live') THEN 0 ELSE 1 END),
    d.start_at NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.pg_public_trips_by_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_trips_by_brand(text) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_trips_by_brand(text) IS
  'ORCH-0963: anon-callable bulk public-trips read for /b/{trip-planner-brand-slug}. '
  'Returns one row per published trip with pre-aggregated spots_left + min_price_cents. '
  'Sold formula mirrors biz_ticket_checkout_create_session capacity gate exactly '
  'per I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE. Brand-kind guard prevents accidental '
  'use against event brands (returns empty set for non-trip_planner brands).';
```

**Security posture:**
- SECURITY DEFINER is required because we aggregate across `tickets` (which has owner-only RLS — anon cannot read individual ticket rows). The function exposes ONLY aggregated counts, never individual `tickets.id` or `tickets.owner_id` values.
- The function's WHERE clauses act as the boundary: `b.kind = 'trip_planner'`, `e.event_type = 'trip'`, `e.visibility = 'public'`, `e.status IN (...)`, `e.deleted_at IS NULL`. A trip row that fails ANY of these does not appear in the result.
- Function is `STABLE` (read-only, deterministic per input) so Postgres can cache within a transaction.
- Brand-kind guard (`b.kind = 'trip_planner'`) means the function returns ZERO rows for an event brand — guards against accidental client-side misuse.

**Performance note for the implementor:**
- All joins are by event_id (indexed by FK). Expected to scan ≤32 trip rows per brand (largest current brand = `travelbrand` with 32 trips, most still drafts). Page-level call is bounded by the trip count of one brand, not total system trips. No index changes required.

**Mgmt-API verification (orchestrator at post-merge):**

```sql
SELECT * FROM public.pg_public_trips_by_brand('travelbrand');
-- Expected: 2 rows ("The Sone", "The DC Adventure")
-- Expected spots_left: 200 (The Sone, 0 sold), 21 (DC Adventure, 81 sold)
SELECT COUNT(*) FROM public.pg_public_trips_by_brand('leggothis');
-- Expected: 0 (kind='popup', not 'trip_planner')
SELECT COUNT(*) FROM public.pg_public_trips_by_brand('nonexistent-slug');
-- Expected: 0
```

### 3.2 Service layer — `mingla-business/src/services/publicEventsService.ts`

**Change 1 (F-3 fix):** widen the TS row type:

```ts
interface BusinessPublicBrandViewRow {
  // ...
  kind: "physical" | "popup" | "trip_planner";  // was: "physical" | "popup"
  // ...
}
```

**Change 2:** new types:

```ts
/**
 * ORCH-0963 — row shape from pg_public_trips_by_brand RPC.
 * Server-aggregated: spots_left + min_price_cents pre-computed.
 */
export interface PublicTripCardRow {
  trip_id: string;
  trip_slug: string;
  brand_slug: string;
  title: string;
  description: string | null;
  destination_text: string | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  status: "scheduled" | "live" | "ended" | "cancelled";
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  bookings_closed: boolean;
  total_capacity: number | null;
  tickets_sold: number;
  spots_left: number | null;
  min_price_cents: number | null;
  currency: string | null;
  has_free_tier: boolean;
  published_at: string | null;
}

/** UI-facing shape consumed by <TripMiniCard>. */
export interface PublicTripCard {
  id: string;
  slug: string;
  brandSlug: string;
  title: string;
  description: string | null;
  destinationText: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  status: "scheduled" | "live" | "ended" | "cancelled";
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  bookingsClosed: boolean;
  totalCapacity: number | null;
  ticketsSold: number;
  spotsLeft: number | null;
  minPriceCents: number | null;
  currency: string | null;
  hasFreeTier: boolean;
  publishedAt: string | null;
}
```

**Change 3:** new fetcher:

```ts
const tripRowToCard = (row: PublicTripCardRow): PublicTripCard => ({
  id: row.trip_id,
  slug: row.trip_slug,
  brandSlug: row.brand_slug,
  title: row.title,
  description: row.description,
  destinationText: row.destination_text,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  status: row.status,
  startAt: row.start_at,
  endAt: row.end_at,
  timezone: row.timezone,
  bookingsClosed: row.bookings_closed,
  totalCapacity: row.total_capacity,
  ticketsSold: row.tickets_sold,
  spotsLeft: row.spots_left,
  minPriceCents: row.min_price_cents,
  currency: row.currency,
  hasFreeTier: row.has_free_tier,
  publishedAt: row.published_at,
});

const fetchPublicBrandTrips = async (
  brandSlug: string,
): Promise<PublicTripCard[]> => {
  // orch-strict-grep-allow events-type-filter — ORCH-0963 RPC pins event_type='trip' server-side
  const { data, error } = await supabase
    .rpc("pg_public_trips_by_brand", { p_brand_slug: brandSlug });

  if (error !== null) throw error;
  const rows = (data ?? []) as PublicTripCardRow[];
  return rows.map(tripRowToCard);
};
```

**Change 4:** modify `PublicBrandDetail`:

```ts
export interface PublicBrandDetail {
  brand: PublicBrandRecord;
  /** Empty array for trip-planner brands. */
  events: PublicEventRecord[];
  /** Empty array for physical/popup brands. */
  trips: PublicTripCard[];
  venue: PublicVenueDetail | null;
}
```

**Change 5:** rewrite `getPublicBrandBySlug` to dispatch on `brand.kind`:

```ts
export const getPublicBrandBySlug = async (
  brandSlug: string,
): Promise<PublicBrandDetail | null> => {
  // 1. Resolve verified-venue path (kind='physical' subset)
  const { data: claimedVenue, error: claimedError } = await supabase
    .from("claimed_venues_public_view")
    .select("*")
    .eq("slug", brandSlug)
    .maybeSingle();
  if (claimedError !== null) throw claimedError;

  if (claimedVenue !== null) {
    const venueRow = claimedVenue as ClaimedVenuePublicViewRow;
    const events = await fetchPublicBrandEvents(brandSlug);
    return {
      brand: claimedVenueRowToBrand(venueRow, events.length),
      venue: claimedVenueRowToPublicVenue(venueRow),
      events,
      trips: [],  // verified venues are kind='physical' — no trips
    };
  }

  // 2. Fall back to generic brand resolver
  const { data: brandData, error: brandError } = await supabase
    .from("business_public_brands_view")
    .select("*")
    .eq("slug", brandSlug)
    .maybeSingle();
  if (brandError !== null) throw brandError;
  if (brandData === null) return null;

  const brandRow = brandData as BusinessPublicBrandViewRow;
  const isTripPlanner = brandRow.kind === "trip_planner";

  // 3. Dispatch on kind — trip-planner brands fetch trips, event brands fetch events.
  // ORCH-0963: kind-branched content load (see I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED).
  const [events, trips] = isTripPlanner
    ? [[], await fetchPublicBrandTrips(brandSlug)]
    : [await fetchPublicBrandEvents(brandSlug), []];

  return {
    brand: publicBrandViewRowToBrand(
      brandRow,
      isTripPlanner ? trips.length : events.length,
    ),
    venue: null,
    events,
    trips,
  };
};
```

**Change 6:** the `publicBrandViewRowToBrand` mapper at line 314 already passes `row.kind` straight through — no change needed since `Brand.kind` already accepts the wider union. The TS-type fix in Change 1 is what enables this without `as any` lying.

### 3.3 Hook layer — `mingla-business/src/hooks/usePublicEvents.ts`

**No signature change.** `usePublicBrandBySlug` already returns `UseQueryResult<PublicBrandDetail | null>`; consumers now see `trips: PublicTripCard[]` automatically. Query key unchanged: `publicEventKeys.brandBySlug(brandSlug)` — the kind-dispatch happens server-side, so cache stays coherent.

### 3.4 Component layer — `mingla-business/src/components/brand/PublicBrandPage.tsx`

**Props shape (existing prop list extended):**

```ts
interface PublicBrandPageProps {
  brand: Brand;
  events: LiveEvent[];
  trips: PublicTripCard[];   // NEW — empty for non-trip-planner brands
  venue?: PublicVenueDetail | null;
}
```

**Top-level branching constant:**

```ts
const isTripBrand = brand.kind === "trip_planner";
```

**Tab type widened:**

```ts
type Tab = "primary" | "past" | "about";
// primary = "Upcoming" (event-brand) | "Trips" (trip-brand)
// past    = "Past"     (event-brand) | "Past Trips" (trip-brand)
```

**Tab labels resolved at render:**

```ts
const primaryTabLabel = isTripBrand ? "Trips" : "Upcoming";
const pastTabLabel    = isTripBrand ? "Past Trips" : "Past";
const primaryTabCount = isTripBrand ? upcomingTrips.length : upcomingEvents.length;
const pastTabCount    = isTripBrand ? pastTrips.length : pastEvents.length;
const emptyPrimaryCopy = isTripBrand
  ? "No upcoming trips yet"
  : (isVerifiedVenue ? "No upcoming events from this venue" : "No upcoming events yet");
const emptyPastCopy = isTripBrand
  ? "No past trips to show"
  : "No past events to show";
```

**New memos for trips (mirror existing event memos):**

```ts
const PAST_TRIP_CAP = 10;

const upcomingTrips = useMemo<PublicTripCard[]>(() => {
  if (!isTripBrand) return [];
  return trips
    .filter((t) => {
      if (t.status === "cancelled" || t.status === "ended") return false;
      // No isTripPast helper needed yet — status='scheduled'|'live' is the gate.
      // Future enhancement: derive "past" from end_at if Seth wants the
      // matching isEventPast semantics, but status is sufficient today.
      return true;
    })
    .sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
}, [isTripBrand, trips]);

const pastTrips = useMemo<PublicTripCard[]>(() => {
  if (!isTripBrand) return [];
  return trips
    .filter((t) => t.status === "ended")
    .sort((a, b) => (b.endAt ?? "").localeCompare(a.endAt ?? ""))
    .slice(0, PAST_TRIP_CAP);
}, [isTripBrand, trips]);
```

**Tab body switch (replaces lines 439-451):**

```tsx
{activeTab === "primary" ? (
  isTripBrand ? (
    <UpcomingTripsTab
      trips={upcomingTrips}
      onTripPress={handleTripCardPress}
      emptyCopy={emptyPrimaryCopy}
    />
  ) : (
    <UpcomingEventsTab
      events={upcomingEvents}
      brand={brand}
      isVerifiedVenue={isVerifiedVenue}
      onEventPress={handleEventCardPress}
      onSocialPress={handleSocialPress}
    />
  )
) : activeTab === "past" ? (
  isTripBrand ? (
    <PastTripsTab trips={pastTrips} onTripPress={handleTripCardPress} emptyCopy={emptyPastCopy} />
  ) : (
    <PastEventsTab events={pastEvents} onEventPress={handleEventCardPress} emptyCopy={emptyPastCopy} />
  )
) : (
  <AboutTab brand={brand} onSocialPress={handleSocialPress} />
)}
```

Note: rename existing `UpcomingTab` → `UpcomingEventsTab` and `PastTab` → `PastEventsTab` for clarity; the rename is mechanical.

**New handler:**

```ts
const handleTripCardPress = useCallback(
  (trip: PublicTripCard): void => {
    router.push(
      tripPublicPath({ brandSlug: trip.brandSlug, tripSlug: trip.slug }) as never,
    );
  },
  [router],
);
```

(Import `tripPublicPath` from `mingla-business/src/constants/publicUrls.ts:71`.)

**Stats card:**

- Trip-brand: omit the stats card entirely. Trip count is already in the Trips tab badge; no second surface needed.
- Event-brand: keep the stats card as-is but only render when `publicEventCount > 0` (existing guard). Operator may choose to suppress the entire stats card if F-5 lands a stronger above-fold teaser; per Decision 2 (bundle event polish), we ALSO drop the stats card on event-brands in this ORCH since `<NextEventTeaser>` now carries the "next thing" message above the bio. Final decision: **drop the stats card for both kinds**.

**New primitive — `<NextEventTeaser>` (event-brand only, above bio):**

```ts
interface NextEventTeaserProps {
  event: LiveEvent;   // the soonest upcoming event
  onPress: (e: LiveEvent) => void;
}

const NextEventTeaser: React.FC<NextEventTeaserProps> = ({ event, onPress }) => {
  const dateLine = formatDraftDateLine(event);
  const minPrice = useMemo<string | null>(() => {
    // Mirror EventMiniCard pricing logic exactly.
    const visible = event.tickets.filter(
      (t) => t.visibility !== "hidden" && !t.isFree,
    );
    if (visible.length === 0) {
      return event.tickets.some((t) => t.visibility !== "hidden" && t.isFree) ? "Free" : null;
    }
    const prices = visible.map((t) => t.priceGbp ?? 0).filter((p) => p > 0).sort((a, b) => a - b);
    if (prices.length === 0) return null;
    return `From ${formatCurrencyRound(prices[0], event.currency ?? "GBP")}`;
  }, [event.currency, event.tickets]);

  return (
    <Pressable
      onPress={() => onPress(event)}
      accessibilityRole="button"
      accessibilityLabel={`Next event ${event.name}`}
      style={({ pressed }) => [styles.nextTeaser, pressed && styles.nextTeaserPressed]}
    >
      <Text style={styles.nextTeaserLabel}>NEXT</Text>
      <Text style={styles.nextTeaserBody} numberOfLines={1}>
        {dateLine} · {event.name.length > 0 ? event.name : "Untitled event"}
        {minPrice !== null ? `  ·  ${minPrice}` : ""}
      </Text>
      <Text style={styles.nextTeaserArrow}>→</Text>
    </Pressable>
  );
};
```

**Placement:** rendered between the identity column and the bio, only when `!isTripBrand && upcomingEvents.length > 0`:

```tsx
{!isTripBrand && upcomingEvents.length > 0 ? (
  <NextEventTeaser event={upcomingEvents[0]} onPress={handleEventCardPress} />
) : null}
```

**New primitive — `<TripMiniCard>` (trip-brand only):**

```ts
interface TripMiniCardProps {
  trip: PublicTripCard;
  onPress: (t: PublicTripCard) => void;
  past?: boolean;
}

const TripMiniCard: React.FC<TripMiniCardProps> = ({ trip, onPress, past = false }) => {
  const dateLine = formatTripDateRange(trip.startAt, trip.endAt, trip.timezone);
  const priceLabel = useMemo<string | null>(() => {
    if (trip.minPriceCents !== null && trip.currency !== null) {
      return `From ${formatCurrencyRound(trip.minPriceCents / 100, trip.currency)}`;
    }
    if (trip.hasFreeTier) return "Free";
    return null;
  }, [trip.minPriceCents, trip.currency, trip.hasFreeTier]);

  const spotsLabel = useMemo<string | null>(() => {
    if (trip.spotsLeft === null) return null;          // unlimited or unknown — show nothing
    if (trip.spotsLeft === 0) return "Sold out";
    if (trip.spotsLeft <= 5) return `${trip.spotsLeft} spot${trip.spotsLeft === 1 ? "" : "s"} left`;
    return null;                                        // hide for non-scarce capacity
  }, [trip.spotsLeft]);

  return (
    <Pressable
      onPress={() => onPress(trip)}
      accessibilityRole="button"
      accessibilityLabel={`Open trip ${trip.title}`}
      style={({ pressed }) => [
        styles.tripCard,
        past && styles.tripCardPast,
        pressed && styles.tripCardPressed,
      ]}
    >
      <EventCoverMedia
        hue={hashHueFromString(trip.id)}                // deterministic hue fallback
        mediaUrl={trip.coverMediaUrl}
        mediaType={trip.coverMediaType}
        radius={12}
        label=""
        style={styles.tripCover}
      />
      <View style={styles.tripBody}>
        <Text style={styles.tripDate}>{dateLine}</Text>
        <Text style={styles.tripTitle} numberOfLines={2}>
          {trip.title.length > 0 ? trip.title : "Untitled trip"}
        </Text>
        {trip.destinationText !== null && trip.destinationText.length > 0 ? (
          <Text style={styles.tripDestination} numberOfLines={1}>
            {trip.destinationText}
          </Text>
        ) : null}
        <View style={styles.tripFooterRow}>
          {priceLabel !== null ? <Text style={styles.tripPrice}>{priceLabel}</Text> : null}
          {trip.bookingsClosed ? (
            <View style={styles.tripBadgeClosed}><Text style={styles.tripBadgeLabel}>Booking closed</Text></View>
          ) : spotsLabel !== null ? (
            <View style={styles.tripBadgeScarce}><Text style={styles.tripBadgeLabel}>{spotsLabel}</Text></View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};
```

**New helper — `formatTripDateRange(start, end, timezone)`** at the same file's helpers section. Returns:

- Both null → `""` (caller hides line).
- Same day (`start.toLocaleDateString() === end.toLocaleDateString()`) → `"Fri 19 Sep"`.
- Same month → `"19 – 22 Sep 2026"`.
- Crosses months → `"30 Sep – 3 Oct 2026"`.
- Crosses years → `"30 Dec 2026 – 3 Jan 2027"`.

Format using Intl with timezone if provided, else UTC. Honesty rule: if `endAt < startAt`, log a warning and render `startAt` only (data corruption guard).

**Sticky CTA pill on first 3 upcoming-event cards (event-brand only, F-5):**

The existing `<EventMiniCard>` already renders price; add an optional `pinCta?: boolean` prop. When true, the card renders an absolute-positioned "Buy tickets" pill at the bottom-right corner. Render with `pinCta={index < 3}` inside `<UpcomingEventsTab>`. Pill uses `accent.warm` background, white text, 8px vertical / 12px horizontal padding, 999px border-radius. Tap target ≥44pt (compose with the card's existing Pressable; pill is decorative for layout, not a separate hit target — preserves I-38).

**Hue fallback for trip cover:** trips don't currently have a `cover_hue` column (events do). For cover-less trips, derive a deterministic hue from `trip.id` via a small hash helper. Existing `EventCoverMedia` accepts `hue` already; this is a one-helper add.

### 3.5 SEO / share metadata (`<Head>` block)

Unchanged in this SPEC. ORCH-0964 owns theme-aware metadata. ORCH-0963 keeps the existing kind-agnostic OG title/description/image generation. Add ONE comment at the top of the Head block:

```tsx
{/* ORCH-0963: SEO/OG title remains kind-agnostic for now. Trip-aware
    OG image (e.g., next-trip cover) is deferred to a follow-up if Seth
    decides share-card quality matters more than implementation time. */}
```

### 3.6 Strict-grep CI gate

**File:** `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs`

**Asserts:**

1. `PublicBrandPage.tsx` contains the literal `brand.kind === "trip_planner"` branch (or `brand.kind ===` followed within 60 chars by `"trip_planner"`).
2. `publicEventsService.ts` contains the literal `pg_public_trips_by_brand` RPC call.
3. `publicEventsService.ts` contains the literal string `"trip_planner"` in `BusinessPublicBrandViewRow.kind` declaration (regex: `kind:\s*"physical"\s*\|\s*"popup"\s*\|\s*"trip_planner"`).
4. No file outside the explicit allowlist contains `event_type === 'trip'` as a positive filter (only negative filter / rejection is allowed) — protects `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` from cross-pollination.

**Wire into workflow:** add to `.github/workflows/strict-grep-mingla-business.yml` as one new job per memory rule [[strict-grep-registry-pattern]]. Allowlist file for ORCH-0863 must also be updated to include the new backend migration + RPC paths (per CLOSE pre-commit-checks memory rule).

---

## 4. Success Criteria

Each criterion is observable, testable, unambiguous.

| ID | Criterion | Layer |
|----|-----------|-------|
| **SC-1** | A `kind='trip_planner'` brand `/b/{slug}` page renders a tab strip labelled "Trips / Past Trips / About". The "Trips" tab body lists one `<TripMiniCard>` per `pg_public_trips_by_brand` row with `status IN ('scheduled','live')`. | Component + DB |
| **SC-2** | Each `<TripMiniCard>` displays: cover (or hue fallback), date range string (per `formatTripDateRange`), title, destination text (when present), price-from label (when `minPriceCents !== null`) OR "Free" (when `hasFreeTier && minPriceCents===null`), and exactly one of: "Booking closed" badge (when `bookingsClosed`) OR "N spot/spots left" badge (when `spotsLeft !== null && spotsLeft <= 5`) OR no badge (otherwise). Crucially, NEVER `"null spots left"` or `"undefined"` anywhere. | Component |
| **SC-3** | Tapping a `<TripMiniCard>` navigates to `/t/{brand.slug}/{trip.slug}` via `tripPublicPath`. | Component |
| **SC-4** | "Past Trips" tab body lists ended trips (`status='ended'`), sorted descending by `endAt`, capped at 10. Empty state copy: "No past trips to show". | Component |
| **SC-5** | A `kind ∈ {'physical','popup'}` brand with `upcomingEvents.length > 0` renders `<NextEventTeaser>` directly BELOW the identity column and ABOVE the bio. The teaser shows date, event name, and price-from string. Tapping navigates via `eventPublicPath`. **Trip-planner brands NEVER render `<NextEventTeaser>`.** | Component |
| **SC-6** | On a 414×896 mobile viewport (iPhone XR baseline), the Tabs strip is rendered within the FIRST scroll viewport (visible without scrolling) for event-brands that have at least one upcoming event. (Pixel measurement: `<NextEventTeaser>` height + avatar + name ≈ 280px; bio capped reasonable; first event card visible at ≤880px from page top.) | Layout (smoke test) |
| **SC-7** | `spots_left` on every `<TripMiniCard>` equals `total_capacity - tickets_sold` (where tickets_sold = `COUNT(tickets WHERE status IN ('valid','used','transferred'))` joined via `ticket_types.event_id`) — i.e., matches the canonical capacity gate used by `biz_ticket_checkout_create_session`. Preserves `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE`. | DB invariant |
| **SC-8** | Physical brand with verified-venue data still renders the `<VenueLocationPreview>` + `<VenueHoursTable>` + `<VenuePhotoGallery>` card — no Ve4 regression. | Component |
| **SC-9** | SEO `<Head>` block emits on `Platform.OS==='web'` exactly as today: title, og:title, og:description, og:image, og:url, twitter:card. No regression on existing OG output. | Web SEO |
| **SC-10** | `BusinessPublicBrandViewRow.kind` TS union is `"physical" \| "popup" \| "trip_planner"` (verified by `tsc --noEmit` AND by grep matching the literal). | Type safety |
| **SC-11** | Strict-grep CI gate `orch-0963-public-brand-kind-branched.mjs` passes on PR check. | CI |
| **SC-12** | Stats card (the `EVENTS: N` block at the old line 398-415) is REMOVED for both brand kinds. Empty space recovered for above-fold content per F-5 + Decision 2. | Component |
| **SC-13** | Event brand's first 3 upcoming-event cards in the "Upcoming" tab render with `pinCta={true}` showing a "Buy tickets" pill in the bottom-right corner. Cards 4+ render without the pill. The pill does NOT add a separate hit target — the full card remains tappable. | Component |
| **SC-14** | `getPublicBrandBySlug('worldtravels')` (trip-planner brand with 0 trips) returns `{ brand: ..., events: [], trips: [], venue: null }` and the page renders the empty Trips tab with "No upcoming trips yet" copy. **No crash, no fake events leak.** | Service + Component |
| **SC-15** | `getPublicBrandBySlug('leggothis')` (popup brand) returns `events: [...11 rows]`, `trips: []`, and the page renders Upcoming events with the next-event teaser strip above the bio. Trips fetcher is NOT called. | Service |

---

## 5. Invariants

### Preserved

- **`I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE`** (ACTIVE post-ORCH-0947): the trip-card spots-left value MUST equal the value the checkout RPC enforces. SC-7 verifies. RPC inlines the same canonical query (`tickets.status IN ('valid','used','transferred')` via `ticket_types.event_id`).
- **`I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE`** (ACTIVE post-ORCH-0859): `/e/{...}` is events-only, `/t/{...}` is trips-only. The `fetchPublicBrandEvents` trip-rejection filter remains unchanged. The new `fetchPublicBrandTrips` pins `event_type='trip'` server-side inside the RPC. The strict-grep gate (item 4 in §3.6) blocks positive event_type='trip' filters in any new client code.
- **`I-CATEGORY-DERIVED-ON-DROP`** (ACTIVE post-ORCH-0700 Phase 3B): no change — this ORCH does not touch place_pool category logic.
- **Constitution #9 (no fabricated data):** trip card never shows a fake price, fake date, fake destination, or fake spots-left. All values come straight from the RPC; null fields surface as omitted UI, not faked.
- **Constitution #10 (currency-aware):** trip price label uses the currency returned from the RPC (the ISO-4217 of the minimum-priced paid tier).
- **Constitution #1 (no dead taps):** trip cards + next-event teaser + sticky CTA pills all wire to Pressables with accessibility labels.
- **`I-38` (IconChrome touch ≥ 44pt):** N/A here (no icon chrome added).
- **`I-39` (explicit accessibilityLabel on interactive Pressable):** every new Pressable carries an `accessibilityLabel`.

### New

- **`I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED`** (DRAFT → ACTIVE on ORCH-0963 CLOSE): the public brand page (`/b/{slug}`) render path MUST source content according to `brands.kind`:
  - `physical | popup` → events array, never trips array.
  - `trip_planner` → trips array, never events array.
  - Render-time conditional MUST exist; conflating the two is forbidden.
  Enforced by `orch-0963-public-brand-kind-branched.mjs` strict-grep gate (assertions 1-4 in §3.6).

---

## 6. Test Cases

### 6.1 Implementor happy-path (must FAIL on revert per Step 0.5 gate)

**T-01 — RPC contract (Deno SQL test):**

- **File:** `supabase/migrations/__tests__/pg_public_trips_by_brand.test.ts`
- **Asserts:** function body contains the canonical sold formula (`'valid', 'used', 'transferred'`), uses `tt.event_id = … JOIN ticket_types` shape, pins `b.kind = 'trip_planner'`, pins `e.event_type = 'trip'`, pins `e.visibility = 'public'`, pins `e.status IN ('scheduled','live','ended','cancelled')`, GRANT EXECUTE to anon, REVOKE from PUBLIC.
- **Fails-on-revert proof:** delete the brand-kind guard from the function body and run — test must FAIL on "missing brand kind guard" assertion.

**T-02 — Service mapping (Jest):**

- **File:** `mingla-business/src/services/__tests__/publicEventsService.tripFetch.test.ts`
- **Asserts:** stub `supabase.rpc('pg_public_trips_by_brand')` to return 2 fixture rows ("The Sone" + "DC Adventure" shapes); `fetchPublicBrandTrips('travelbrand')` returns 2 `PublicTripCard` objects with correct field mapping (snake_case → camelCase), spotsLeft preserved.
- **Fails-on-revert:** revert `tripRowToCard` mapping → test FAILS on shape mismatch.

**T-03 — Component render trip-brand (Jest + RN Testing Library):**

- **File:** `mingla-business/src/components/brand/__tests__/PublicBrandPage.tripBrand.test.tsx`
- **Asserts:** rendering `<PublicBrandPage brand={kind:'trip_planner'} events={[]} trips={[oneTripFixture]} />` produces: "Trips" tab label, "Past Trips" tab label, one `<TripMiniCard>` in the Trips tab body, no `<NextEventTeaser>` anywhere, no `<EventMiniCard>` anywhere.
- **Fails-on-revert:** remove the `isTripBrand` constant → tabs labelled "Upcoming" → test FAILS on tab-label assertion.

**T-04 — NextEventTeaser placement (Jest + RTL):**

- **File:** `mingla-business/src/components/brand/__tests__/PublicBrandPage.nextEventTeaser.test.tsx`
- **Asserts:** rendering `<PublicBrandPage brand={kind:'popup'} events={[oneUpcomingEventFixture]} trips={[]} />` shows the `<NextEventTeaser>` BEFORE the bio in DOM order. Rendering with `kind='trip_planner'` and one trip shows NO teaser. Rendering with `kind='popup'` and `events=[]` shows NO teaser.
- **Fails-on-revert:** delete the `{!isTripBrand && upcomingEvents.length > 0 ? <NextEventTeaser/> : null}` block → test FAILS on absent teaser.

### 6.2 Tester adversarial (must FAIL on revert; must attack DIFFERENT angle than happy-path)

**T-05 — Unlimited capacity (spots_left=null) trip card honesty:**

- **File:** `mingla-business/src/components/brand/__tests__/TripMiniCard.unlimitedCapacity.adversarial.test.tsx`
- **Scenario:** trip with `spotsLeft=null` (any tier `is_unlimited=true`), `bookingsClosed=false`.
- **Asserts:** card renders NO spots-left badge AND NO "null spots left" text AND NO "undefined" text. Card still shows price + title + destination.
- **Fails-on-revert:** change `<TripMiniCard>` spotsLabel to `\`${trip.spotsLeft} spots left\`` (the obvious naive impl) → test FAILS on "null spots left" appearing.

**T-06 — Bookings-closed badge wins over scarce-capacity badge:**

- **File:** `mingla-business/src/components/brand/__tests__/TripMiniCard.bookingsClosedPrecedence.adversarial.test.tsx`
- **Scenario:** trip with `bookingsClosed=true` AND `spotsLeft=2`.
- **Asserts:** card renders "Booking closed" badge ONLY (not "2 spots left"). Tapping the card still navigates to `/t/{brandSlug}/{tripSlug}` (no dead tap).
- **Fails-on-revert:** swap badge precedence so scarcity wins → test FAILS.

**T-07 — RPC anti-leakage: event brand with `kind='popup'` returns ZERO trip rows even if pollination attempted:**

- **File:** `supabase/migrations/__tests__/pg_public_trips_by_brand.antiLeak.adversarial.test.ts`
- **Scenario:** Deno SQL contract test — pin function body to include `WHERE b.kind = 'trip_planner'` AND the JOIN brand-table clause. Adversarial input "what if someone removes the kind filter" must fail the contract.
- **Asserts:** body regex MUST match `b\.kind\s*=\s*'trip_planner'` AND there is NO branch that bypasses the brand-kind check.
- **Fails-on-revert:** remove kind clause from CTE → test FAILS.

**T-08 — Sticky-CTA-pill applies to first 3 upcoming events only, not 4th+, and not on past tab:**

- **File:** `mingla-business/src/components/brand/__tests__/PublicBrandPage.pinCtaCount.adversarial.test.tsx`
- **Scenario:** event-brand with 6 upcoming events + 4 past events.
- **Asserts:** upcoming-tab DOM contains exactly 3 elements with `accessibilityLabel="Buy tickets"` AND past-tab DOM contains 0 such elements.
- **Fails-on-revert:** change `pinCta={index < 3}` → `pinCta={true}` → test FAILS on 6 pills.

**T-09 — Past tab cap at 10 holds across both kinds:**

- **File:** `mingla-business/src/components/brand/__tests__/PublicBrandPage.pastCap.adversarial.test.tsx`
- **Scenario:** trip-brand with 12 past trips → Past Trips tab shows exactly 10. Event-brand with 12 past events → Past tab shows exactly 10 (existing behavior — regression guard).
- **Asserts:** count of `<TripMiniCard past>` AND `<EventMiniCard past>` ≤ 10 each.
- **Fails-on-revert:** remove `.slice(0, PAST_TRIP_CAP)` → test FAILS on 12 cards.

### 6.3 Live-fire (tester sub-mode, Maestro / Playwright local-dev only)

Per memory rules [[always-simulator-repro-described-behaviour]] + [[sim-load-latest-bundle-before-test]]. Cloudflare blocks headless on prod (D-1 closed); use local Metro web build only.

| Live-fire ID | Steps | Pass criterion |
|---|---|---|
| LF-1 | Start Metro on port 8085. `npm run web` in `mingla-business/`. Open `localhost:8085/b/travelbrand` in Playwright with real Chrome (non-headless). | Page renders: cover + avatar + "Travel Brand" name + bio + tab strip "Trips / Past Trips / About". Trips tab body shows 2 cards: "The DC Adventure" (Washington DC) + "The Sone" (Tulum). DC Adventure card shows "21 spots left" badge. The Sone shows no badge (200 - 0 = 200 left, above the 5-spot scarcity threshold). No console errors. |
| LF-2 | Same setup. Open `localhost:8085/b/leggothis`. | Page renders: cover + avatar + "Leggo This" name + `<NextEventTeaser>` strip with format "NEXT · {dateLine} · {event.name} · {From £X}" ABOVE the bio. Tabs labelled "Upcoming N / Past N / About". Upcoming tab body shows 11 event cards with the first 3 carrying a visible "Buy tickets" pill in the bottom-right. |
| LF-3 | Same setup. Open `localhost:8085/b/worldtravels` (trip-planner with 0 trips). | Page renders without crash. Tabs labelled "Trips 0 / Past Trips 0 / About". Trips tab shows "No upcoming trips yet" copy. No `<NextEventTeaser>` anywhere. |
| LF-4 | Same setup. Tap "DC Adventure" card on `/b/travelbrand`. | Navigates to `localhost:8085/t/travelbrand/the-dc-adventure`. |
| LF-5 | Same setup, prod build: `npm run web:export && node playwright/static-server.mjs web-build 43099`. Repeat LF-1..LF-3 against `localhost:43099`. | Same outcomes; confirms web-export build (the artifact Vercel ships) renders correctly. |

---

## 7. Implementation Order

1. **DB migration** — create `supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql`. **Implementor MUST grep `~/Desktop/mingla-orchs/*/supabase/migrations/` for any sibling worktree using a `20260728*` prefix before locking the filename** (per memory backstop "Invariant migration backstop").
2. **Deno SQL contract tests** — T-01 + T-07 in `supabase/migrations/__tests__/pg_public_trips_by_brand*.test.ts`.
3. **Operator applies migration** — `cd ~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip] && /Users/sethogieva/bin/supabase db push --linked` (orchestrator emits this command verbatim per memory backstop "Migration apply command backstop").
4. **Orchestrator verifies live RPC** via Mgmt API SELECTs from §3.1.
5. **Service layer:** TS-type widen (Change 1) + new types (Change 2) + new fetcher (Change 3) + `PublicBrandDetail` shape (Change 4) + `getPublicBrandBySlug` dispatch (Change 5) — all in `publicEventsService.ts`.
6. **Service tests:** T-02.
7. **Component:** rename internal tabs, add `isTripBrand` constant, add memos, add `handleTripCardPress`, drop stats card, add `<NextEventTeaser>`, add `<TripMiniCard>`, add `formatTripDateRange` helper, add hue-fallback hash helper, wire pinCta on first 3 upcoming-event cards.
8. **Component tests:** T-03, T-04, T-05, T-06, T-08, T-09.
9. **Strict-grep gate:** add script + wire into workflow + update ORCH-0863 allowlist (memory backstop CLOSE pre-commit-checks).
10. **`I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED` invariant** — add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` as DRAFT.
11. **Implementor commits** on per-ORCH branch.
12. **Orchestrator REVIEW** → forward to tester for live-fire LF-1..LF-5 + adversarial validation.
13. **CLOSE** flips invariant DRAFT → ACTIVE, runs Step 1.5 DIAG-reap, emits `[deploy]` tag (Vercel-built buyer-web touched), no EAS OTA (no `app-mobile/` touched).

---

## 8. Regression Prevention

| Risk | Guard |
|------|-------|
| Future client code re-introduces positive `event_type === 'trip'` filter on the event-only render path | Strict-grep assertion #4 in §3.6 |
| Future code stops branching `PublicBrandPage` on kind (e.g., a refactor that "simplifies" the file) | Strict-grep assertions #1-3 in §3.6 |
| RPC reverts to non-canonical sold formula | T-01 + T-07 SQL contract tests (Deno) |
| TripMiniCard shows "null spots left" if implementor regresses spotsLabel handling | T-05 adversarial |
| Bookings-closed precedence inverted | T-06 adversarial |
| Pin-CTA applies to all cards instead of first 3 | T-08 adversarial |
| Past tab cap removed | T-09 adversarial |
| `BusinessPublicBrandViewRow.kind` TS type narrows back | Strict-grep assertion #3 + SC-10 verifies via tsc |
| `pg_public_trips_by_brand` GRANT to anon dropped accidentally | T-01 asserts GRANT line |

---

## 9. External-API Verification

Per COMMS-0003 / I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED: **N/A — no external APIs touched.** The change is purely DB + service + component. No Stripe, no Google Places, no OneSignal, no Resend, no Twilio, no AppsFlyer, no Mixpanel, no RevenueCat, no OpenAI. Confirmed by grep across the change set.

---

## 10. Step 0.5 Regression-Test Gate

**Happy-path tests** (implementor): T-01, T-02, T-03, T-04 — all four required with `fails-on-revert verified at <commit hash>` line in the implementation report.

**Adversarial tests** (tester, attacking different angles than happy-path):
- T-05 attacks UI null-handling (different angle than T-03's tab-rendering)
- T-06 attacks badge precedence (different from T-05's null check)
- T-07 attacks RPC anti-leak (different from T-01's contract assertion)
- T-08 attacks count-limit logic (different from any happy-path)
- T-09 attacks cap-limit logic (regression guard)

All adversarial tests must FAIL on revert at the implementor commit hash.

**Tests are immutable post-merge per `.github/workflows/tests-append-only.yml`.**

---

## 11. CLOSE Banner Requirements

When this ORCH closes:
- `[deploy]` tag in commit subject (Vercel-built `mingla-business/` source touched).
- No EAS OTA (`app-mobile/` untouched).
- Migration apply command emitted to operator verbatim (§7 step 3).
- Three live-fire screenshots from LF-1, LF-2, LF-3 attached to QA report.
- DIAG-reap grep returns zero `[ORCH-0963-DIAG]` matches.
- COMMS-LEDGER entry written by orchestrator at SPEC-APPROVED time naming the files changed (`PublicBrandPage.tsx` + `publicEventsService.ts` + `pg_public_trips_by_brand` RPC) for ORCH-0964 rebase awareness (per Discovery D-5).
- ORCH-0863 allowlist updated with the new backend file path in the same commit.
- `I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED` flipped DRAFT → ACTIVE in `INVARIANT_REGISTRY.md`.

---

## 12. Open SPEC Questions (none)

All three INTAKE open questions were locked by Seth on 2026-05-25:
- Decision 1: single-component branched ✅
- Decision 2: bundle event-brand polish ✅
- Decision 3: SECURITY DEFINER RPC ✅

If REVIEW surfaces any unresolved ambiguity, this skill rewrites the affected section before forwarding to implementor.

---

*SPEC complete. Hand back to Claude `mingla-orchestrator` for REVIEW. After APPROVED, dispatch Codex `implementor-mingla` (default per pipeline routing) — or Claude `mingla-implementor` if Seth redirects.*
