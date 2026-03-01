# Feature: Ticketmaster Night Out — Real Events Integration

**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Replace AI-generated Night Out venues (Google Places) with real Ticketmaster events. Ticket purchases via in-app browser modal — no Stripe KYC needed.

---

## Summary

Overhaul the Night Out tab to pull **real music events** from the Ticketmaster Discovery API v2 instead of generating synthetic nightlife cards from Google Places + OpenAI. Users see actual upcoming parties/concerts near them — Afrobeats, Amapiano, Dancehall, and more — with real prices, real artists, and real venues. Tapping "Get Tickets" opens Ticketmaster checkout in an in-app browser. This removes all Google Places API and OpenAI dependencies from the Night Out flow and eliminates the need for Stripe payment processing on this tab.

## User Story

As a Mingla user on the Night Out tab, I want to discover real upcoming music events near me so that I can browse, filter by genre/date/price, and buy tickets directly — all without leaving the app.

---

## Architecture Impact

### Removed Dependencies (Night Out flow only)
- Google Places API (New) — `places:searchNearby`
- Google Routes API — distance matrix for travel time
- OpenAI GPT-4o-mini — event name/host/description generation
- `card_pool` / `place_pool` pipeline for Night Out cards
- Stripe Connect (no in-app payment for tickets)

### New Dependencies
- **Ticketmaster Discovery API v2** — `events.json` endpoint
  - Rate limit: 5,000 requests/day
  - Auth: API key (Consumer Key)

### New Files
| File | Purpose |
|------|---------|
| `supabase/functions/ticketmaster-events/index.ts` | New edge function — Ticketmaster API proxy with caching |
| `supabase/migrations/20260301000003_ticketmaster_cache.sql` | Events cache table |

### Modified Files
| File | Change |
|------|--------|
| `app-mobile/src/services/nightOutExperiencesService.ts` | Point to new edge function, update types |
| `app-mobile/src/types/expandedCardTypes.ts` | Update `nightOutData` with ticket fields |
| `app-mobile/src/components/DiscoverScreen.tsx` | Update card rendering, filter logic, ticket button, types |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Add "Get Tickets" browser modal, update Night Out layout |

### Deleted Files (after migration)
| File | Reason |
|------|--------|
| `supabase/functions/night-out-experiences/index.ts` | Replaced by `ticketmaster-events` |

---

## Database Changes

```sql
-- Migration: 20260301000003_ticketmaster_cache.sql
-- Server-side event cache to reduce Ticketmaster API calls (5K/day limit)

CREATE TABLE IF NOT EXISTS ticketmaster_events_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,       -- geohash + keyword hash
  events JSONB NOT NULL DEFAULT '[]',   -- Array of transformed event objects
  total_results INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for cache lookup
CREATE INDEX idx_tm_cache_key ON ticketmaster_events_cache(cache_key);
-- Index for expiry cleanup
CREATE INDEX idx_tm_cache_expires ON ticketmaster_events_cache(expires_at);

-- RLS: Edge functions access via service role key — no user-level RLS needed
ALTER TABLE ticketmaster_events_cache ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
CREATE POLICY "Service role full access" ON ticketmaster_events_cache
  FOR ALL USING (true) WITH CHECK (true);
```

---

## Edge Function Spec

### Function: `ticketmaster-events`

**Trigger:** HTTP POST (invoked from mobile via `supabase.functions.invoke`)

**Input:**
```typescript
interface TicketmasterEventsRequest {
  location: { lat: number; lng: number };
  radius?: number;          // km, default 50
  keywords?: string[];      // default: ["afrobeats", "amapiano", "dancehall"]
  startDate?: string;       // ISO 8601 UTC, default: now
  endDate?: string;         // ISO 8601 UTC, default: now + 30 days
  sort?: string;            // "date,asc" (default) | "distance,asc"
  page?: number;            // default 0
  size?: number;            // default 20, max 50
}
```

**Output:**
```typescript
interface TicketmasterEventsResponse {
  events: TicketmasterEvent[];
  meta: {
    totalResults: number;
    page: number;
    pageSize: number;
    totalPages: number;
    fromCache: boolean;
    keywords: string[];
  };
}

interface TicketmasterEvent {
  id: string;                        // Ticketmaster event ID
  eventName: string;                 // Event title
  artistName: string;                // Primary attraction/performer name
  venueName: string;                 // Venue name
  image: string;                     // Best image URL (16_9 ratio, ≥1024w)
  images: string[];                  // All image URLs
  priceMin: number | null;           // Min ticket price (USD)
  priceMax: number | null;           // Max ticket price (USD)
  priceCurrency: string;             // "USD", "GBP", etc.
  date: string;                      // Formatted: "Fri, Mar 15"
  time: string;                      // Formatted: "8:00 PM"
  localDate: string;                 // Raw: "2026-03-15"
  localTime: string;                 // Raw: "20:00:00"
  dateTimeUTC: string;               // ISO 8601 UTC
  location: string;                  // "City, State"
  address: string;                   // Full venue address
  coordinates: { lat: number; lng: number };
  genre: string;                     // Primary genre name
  subGenre: string;                  // Sub-genre name
  tags: string[];                    // Derived from genre, subGenre, segment
  ticketUrl: string;                 // Ticketmaster purchase URL
  ticketStatus: string;              // "onsale" | "offsale" | "cancelled" | "rescheduled"
  seatMapUrl?: string;               // Seat map image URL (if available)
  distance?: number;                 // km from user (calculated server-side)
}
```

**Logic (pseudocode):**
```
1. Parse + validate request body
2. Build cache key: round(lat,1) + round(lng,1) + sort(keywords) + startDate_day
3. Check ticketmaster_events_cache:
   - If cache hit AND expires_at > now() → return cached events + meta.fromCache=true
4. If cache miss or expired:
   a. Build Ticketmaster API URL:
      - endpoint: https://app.ticketmaster.com/discovery/v2/events.json
      - params: apikey, geoPoint (lat,long), radius, unit=km,
                segmentId=KZFzniwnSyZfZ7v7nJ (Music),
                keyword=afrobeats,amapiano,dancehall (joined),
                startDateTime, endDateTime,
                sort, size, page
   b. Fetch from Ticketmaster
   c. Transform _embedded.events[] → TicketmasterEvent[]
      - Pick best image: prefer 16_9 ratio, width ≥ 1024
      - Extract artist from _embedded.attractions[0].name
      - Extract venue from _embedded.venues[0]
      - Format date/time from dates.start
      - Build tags from classifications
      - Calculate distance from user via haversine (lightweight, no Google API)
   d. Upsert to ticketmaster_events_cache (fire-and-forget)
5. Return events + meta
```

**Error handling:**
- Ticketmaster 429 (rate limit): Return cached data if available, else error
- Ticketmaster 5xx: Return cached data if available, else error
- Empty results: Return `{ events: [], meta: { totalResults: 0, ... } }`

**Environment variables required:**
```
TICKETMASTER_API_KEY=Pau3bK2jrF0UljroOwIwDBcHlmNFRib1
```

---

## Mobile Implementation

### Updated Types

**`nightOutExperiencesService.ts` — Replace `NightOutVenue`:**
```typescript
export interface NightOutVenue {
  id: string;                        // Ticketmaster event ID
  eventName: string;                 // Event title
  artistName: string;                // Performer/artist (replaces hostName)
  venueName: string;                 // Venue name (replaces placeName)
  image: string;                     // Primary image
  images: string[];                  // All images
  priceMin: number | null;           // Min price
  priceMax: number | null;           // Max price
  priceCurrency: string;             // Currency code
  price: string;                     // Formatted: "$25 - $75" or "TBA"
  date: string;                      // "Fri, Mar 15"
  time: string;                      // "8:00 PM"
  localDate: string;                 // "2026-03-15"
  dateTimeUTC: string;               // ISO 8601
  location: string;                  // "City, State"
  address: string;                   // Full address
  coordinates: { lat: number; lng: number };
  genre: string;                     // Genre name
  subGenre: string;                  // Sub-genre name
  tags: string[];                    // Genre tags
  ticketUrl: string;                 // Purchase URL ← NEW
  ticketStatus: string;              // Sale status ← NEW
  distance?: number;                 // km from user
  seatMapUrl?: string;               // Seat map image
}
```

**`expandedCardTypes.ts` — Update `nightOutData`:**
```typescript
nightOutData?: {
  eventName: string;
  venueName: string;        // was: placeName
  artistName: string;       // was: hostName
  date: string;
  time: string;
  price: string;
  genre?: string;           // was: musicGenre
  subGenre?: string;        // NEW
  tags: string[];
  coordinates?: { lat: number; lng: number };
  ticketUrl: string;        // NEW — Ticketmaster checkout link
  ticketStatus: string;     // NEW — "onsale" | "offsale" etc.
  seatMapUrl?: string;      // NEW
};
```

### Updated `NightOutCardData` (DiscoverScreen.tsx)
```typescript
interface NightOutCardData {
  id: string;
  eventName: string;
  artistName: string;       // was: hostName
  venueName: string;        // was: placeName
  image: string;
  images?: string[];
  price: string;
  priceMin: number | null;
  priceMax: number | null;
  date: string;
  time: string;
  localDate: string;
  location: string;
  tags: string[];
  genre?: string;           // was: musicGenre
  subGenre?: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  ticketUrl: string;        // NEW
  ticketStatus: string;     // NEW
  distance?: number;
}
```

### Removed Fields
- `hostName` → replaced by `artistName` (real performer)
- `placeName` → replaced by `venueName`
- `matchPercentage` → removed (no synthetic scoring)
- `peopleGoing` → removed (Ticketmaster doesn't provide this)
- `timeRange` → removed (events have single start time)
- `musicGenre` → replaced by `genre` + `subGenre`
- `rating` / `reviewCount` → removed (not applicable to events)
- `travelTime` → removed (no Google Routes dependency)
- `description` → removed from card (event names are self-descriptive)

### Filter Changes

**Genre filter update — map to Ticketmaster keywords:**
```typescript
type GenreFilter =
  | "all"
  | "afrobeats"       // keyword: "afrobeats,amapiano"
  | "dancehall"       // keyword: "dancehall,soca"
  | "hiphop-rnb"      // keyword: "hip hop,r&b,rnb"
  | "house"           // keyword: "house,deep house,afro house"
  | "techno"          // keyword: "techno,electronic"
  | "jazz-blues"      // keyword: "jazz,blues"
  | "latin-salsa"     // keyword: "latin,salsa,reggaeton"
  | "reggae"          // keyword: "reggae,dub"
  | "kpop"            // keyword: "kpop,k-pop"
  | "acoustic-indie"; // keyword: "acoustic,indie"
```

**Genre filter is now SERVER-SIDE:** When a genre filter is selected, the keyword param changes on the API call. This is more efficient than fetching everything and filtering client-side.

**Date filter — now server-side via `startDateTime`/`endDateTime`:**
```typescript
// "today"     → startDateTime=now, endDateTime=end-of-today
// "tomorrow"  → startDateTime=start-of-tomorrow, endDateTime=end-of-tomorrow
// "weekend"   → startDateTime=next-friday-6pm, endDateTime=next-sunday-midnight
// "next-week" → startDateTime=next-monday, endDateTime=next-sunday
// "month"     → startDateTime=now, endDateTime=now+30d
// "any"       → startDateTime=now, endDateTime=now+30d (same as month)
```

**Price filter — remains CLIENT-SIDE** (Ticketmaster API doesn't support price range queries):
```typescript
// Filter on priceMin/priceMax from response
```

### Ticket Purchase Flow

**On "Get Tickets" button press:**
```typescript
import * as WebBrowser from 'expo-web-browser';

const handleGetTickets = async (ticketUrl: string) => {
  await WebBrowser.openBrowserAsync(ticketUrl, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    toolbarColor: '#1A1A2E',    // Match app theme
    controlsColor: '#FF6B35',   // Orange accent
  });
};
```

This opens a full-screen in-app browser showing the Ticketmaster checkout page. User completes purchase entirely within Ticketmaster — zero Stripe/KYC involvement on our side.

### Component Changes

**NightOutCard (in DiscoverScreen.tsx):**
- Replace `hostName` with `artistName`
- Replace `placeName` with `venueName`
- Remove `peopleGoing` row
- Add ticket status badge: "On Sale" (green) / "Sold Out" (red) / "Coming Soon" (orange)
- Replace "match %" badge with genre/subGenre badge
- Price shows actual ticket range instead of estimated cover charge
- Add small "Get Tickets" CTA button on card

**Expanded Night Out Modal (ExpandedCardModal.tsx):**
- Title: `eventName`
- Subtitle: `artistName` + `venueName`
- Genre + SubGenre badges
- Date & Time section (single start time, no range)
- Price Range section: `$25 - $75` with "per ticket" label
- Ticket status badge
- Venue location card with "Get Directions"
- **Primary CTA: "Get Tickets" button** → opens `ticketUrl` in WebBrowser
- Remove: weather section, busyness section, match factors, people going, timeline
- Optional: Seat map image if `seatMapUrl` exists

### Service Changes

**`nightOutExperiencesService.ts`:**
```typescript
export class NightOutExperiencesService {
  static async getEvents(
    location: { lat: number; lng: number },
    options?: {
      radius?: number;
      keywords?: string[];
      startDate?: string;
      endDate?: string;
      sort?: string;
      page?: number;
    }
  ): Promise<{ events: NightOutVenue[]; meta: EventsMeta }> {
    const { data, error } = await supabase.functions.invoke(
      "ticketmaster-events",
      {
        body: {
          location,
          radius: options?.radius || 50,
          keywords: options?.keywords || ["afrobeats", "amapiano", "dancehall"],
          startDate: options?.startDate,
          endDate: options?.endDate,
          sort: options?.sort || "date,asc",
          page: options?.page || 0,
          size: 20,
        },
      }
    );
    // ... error handling, return transformed data
  }
}
```

---

## RLS Policies

```sql
-- ticketmaster_events_cache is accessed only by edge functions via service role
-- No user-level RLS policies needed
-- The service role policy created above covers all operations
```

---

## Caching Strategy

### Server-Side (Edge Function → Supabase)
- **Cache key:** `geo:{lat_rounded}:{lng_rounded}:kw:{sorted_keywords}:date:{start_day}`
- **TTL:** 2 hours (events don't change frequently; balances freshness vs. API quota)
- **Cache hit:** Return immediately, no Ticketmaster API call
- **Cache miss:** Fetch from Ticketmaster, store, return
- **Cleanup:** Expired rows deleted on cache write (opportunistic)

### Client-Side (AsyncStorage — same pattern as current)
- **Cache key:** `mingla_night_out_cache_{userId}_{lat_2dp}_{lng_2dp}_{genre}`
- **TTL:** Per-session (valid while genre/location unchanged)
- **Invalidate on:** Genre filter change, location change, pull-to-refresh

### API Budget Math
- 5,000 requests/day limit
- 2-hour cache TTL → max 12 unique fetches per cache key per day
- ~100 active users × ~3 unique location/genre combos = ~300 unique cache keys
- Worst case: 300 × 12 = 3,600 requests/day → well within limit
- After cache warm-up: Most requests served from cache → ~500-1000 actual API calls/day

---

## Test Cases

1. **Basic event fetch**: Open Night Out tab with GPS → see real Ticketmaster events within 50km → events show real artist names, real venues, real prices, real dates
2. **Genre filter**: Select "Afrobeats" filter → only events matching afrobeats/amapiano keywords returned → select "House" → events change to house/electronic
3. **Date filter**: Select "This Weekend" → only Friday-Sunday events shown → select "Today" → only today's events shown
4. **Price filter**: Select "Under $25" → only events with priceMin < 25 shown → events with priceMin=null ("TBA") are hidden
5. **Get Tickets**: Tap "Get Tickets" → in-app browser opens Ticketmaster checkout page → user can complete purchase → closing browser returns to app
6. **Empty state**: Set location to remote area with no events → "No events found near you" empty state with suggestion to increase radius
7. **Cache behavior**: Fetch events → switch to "For You" tab → switch back → events load instantly from cache (no loading spinner)
8. **Ticket status**: Event with `ticketStatus: "offsale"` → shows "Sold Out" badge, "Get Tickets" button disabled/grayed
9. **Server cache**: Two users in same area fetch events within 2 hours → second user served from `ticketmaster_events_cache` (0 Ticketmaster API calls)
10. **Offline/error**: Ticketmaster API down → cached data served if available → if no cache, show error state with retry button

---

## Success Criteria

- [ ] Night Out tab shows REAL Ticketmaster events (not AI-generated)
- [ ] Events display real artist names, real venue names, real prices, real dates
- [ ] Genre filter changes Ticketmaster keyword search (server-side)
- [ ] Date filter restricts to correct date ranges (server-side)
- [ ] Price filter works client-side on priceMin/priceMax
- [ ] "Get Tickets" opens Ticketmaster checkout in in-app browser
- [ ] No Google Places API calls made from Night Out flow
- [ ] No OpenAI API calls made from Night Out flow
- [ ] No Stripe involvement in ticket purchase
- [ ] Server-side cache keeps API usage well under 5,000/day
- [ ] Existing "For You" tab completely unaffected by changes
- [ ] Card expansion shows real event details with ticket CTA as primary action

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ BEFORE (Google Places + OpenAI)                              │
│                                                              │
│ Mobile → night-out-experiences → Google Places API           │
│                                  → OpenAI (fake event gen)   │
│                                  → Google Routes (travel)    │
│                                  → card_pool (cache)         │
│                                  ← NightOutVenue[] (fake)    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ AFTER (Ticketmaster)                                         │
│                                                              │
│ Mobile → ticketmaster-events → ticketmaster_events_cache     │
│                                  (cache hit? → return)       │
│                               → Ticketmaster Discovery API   │
│                                  (cache miss → fetch+cache)  │
│                               ← TicketmasterEvent[] (REAL)   │
│                                                              │
│ "Get Tickets" → expo-web-browser → ticketmaster.com/event    │
│                 (in-app browser)    (user buys ticket)        │
└─────────────────────────────────────────────────────────────┘
```

---

## Migration Strategy

1. Create new `ticketmaster-events` edge function alongside existing `night-out-experiences`
2. Update mobile to call new edge function
3. Test thoroughly
4. Delete `night-out-experiences` edge function
5. Remove `card_pool` entries with category "Drink" that were Night Out pool cards (optional cleanup)

This is a clean swap — the Night Out tab is self-contained and doesn't share data pipelines with any other tab.
