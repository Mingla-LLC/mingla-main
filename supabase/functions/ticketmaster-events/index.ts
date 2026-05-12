import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveTmClassification,
  DISCOVER_SEGMENT_ID,
  type DiscoverSegmentSlug,
  type DiscoverGenreSlug,
} from "../_shared/ticketmasterClassifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TICKETMASTER_API_KEY = Deno.env.get("TICKETMASTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseAdmin = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "");

// ── ORCH-0809 fallback config ───────────────────────────────────────────────
// When a city-mode query returns fewer than this many results AND the client
// supplied latFallback/lngFallback, the edge function automatically retries
// with lat/lng+radius and sets meta.usedFallback = true.
const CITY_FALLBACK_THRESHOLD = 5;

// ── Request schema ──────────────────────────────────────────────────────────
//
// ORCH-0809 SPEC §5.2: v2 schema is additive and backward-compatible.
// SPEC clarification (resolved during M1 implementation): the segmentId /
// genreIds fields named in SPEC §5.2 carry SLUGS on the wire, not TM
// classification IDs — to honor Constitution #2 (one owner per truth) and
// the SPEC's own §5.3 + §5.4 + §5.5 contracts. Server resolves slugs to TM
// IDs via resolveTmClassification(). Documented in IMPLEMENTATION report §
// SPEC Deviations.

interface RequestBody {
  // v1 fields (preserved for backward compat)
  location?: { lat: number; lng: number };
  radius?: number;
  keywords?: string[];
  startDate?: string;
  endDate?: string;
  sort?: string;
  page?: number;
  size?: number;

  // v2 fields (additive)
  city?: string;
  stateCode?: string | null;
  countryCode?: string | null;
  segmentSlug?: DiscoverSegmentSlug | string;
  genreSlugs?: ReadonlyArray<DiscoverGenreSlug | string>;
  localStartEndDateTime?: string;
  latFallback?: number;
  lngFallback?: number;
  radiusFallback?: number;
}

interface TicketmasterEvent {
  id: string;
  eventName: string;
  artistName: string;
  venueName: string;
  image: string;
  images: string[];
  priceMin: number | null;
  priceMax: number | null;
  priceCurrency: string | null;
  price: string;
  date: string;
  time: string;
  localDate: string;
  localTime: string | null;
  dateTimeUTC: string | null;
  location: string;
  address: string;
  coordinates: { lat: number; lng: number };
  genre: string | null;
  subGenre: string | null;
  tags: string[];
  ticketUrl: string;
  ticketStatus: string;
  seatMapUrl: string | null;
  // ORCH-0809: nullable — null when city-mode is used (no haversine anchor)
  distance: number | null;
}

// ── Haversine Distance ──────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Date / Time Formatting ──────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDate(localDate: string): string {
  const parts = localDate.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const d = new Date(Date.UTC(year, month, day));
  const dayName = DAY_NAMES[d.getUTCDay()];
  const monthName = MONTH_NAMES[d.getUTCMonth()];
  return `${dayName}, ${monthName} ${d.getUTCDate()}`;
}

function formatTime(localTime: string | undefined): string {
  if (!localTime) return "Time TBA";
  const parts = localTime.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  const ampm = hours >= 12 ? "PM" : "AM";
  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;
  return `${hours}:${minutes} ${ampm}`;
}

// ── Cache Key Builder ────────────────────────────────────────────────────────
//
// ORCH-0809 SPEC §5.2: v2 cache keys carry `v2:` prefix so they don't
// collide with v1 (`geo:`) cache rows. v1 rows expire over their existing
// 2h TTL — no manual flush required.

interface CacheKeyInput {
  city?: string;
  stateCode?: string | null;
  countryCode?: string | null;
  lat?: number;
  lng?: number;
  segmentId: string;
  genreIds: string[];
  subGenreIds: string[];
  localStartEndDateTime?: string;
  startDate?: string;
  keywords: string[];
  usedFallback: boolean;
}

function buildCacheKey(input: CacheKeyInput): string {
  const segPart = input.segmentId;
  const genrePart = [...input.genreIds].sort().join(",") || "any";
  // ORCH-0809-E: sub-genre union must be part of the cache key so different
  // sub-genre combinations don't share entries (FILTER_DIMENSION invariant).
  const subPart = [...input.subGenreIds].sort().join(",") || "any";
  const dtPart = input.localStartEndDateTime
    ? `local:${input.localStartEndDateTime}`
    : input.startDate
    ? `utc:${input.startDate.slice(0, 10)}`
    : "any";
  const kwPart = [...input.keywords].sort().join(",") || "any";
  const fallbackPart = input.usedFallback ? ":fb:1" : "";

  if (input.city && !input.usedFallback) {
    const stateStr = (input.stateCode ?? "").toLowerCase();
    const countryStr = (input.countryCode ?? "").toLowerCase();
    return `v2:city:${input.city.toLowerCase()}:${stateStr}:${countryStr}:seg:${segPart}:gen:${genrePart}:sub:${subPart}:kw:${kwPart}:dt:${dtPart}`;
  }

  // Lat/lng path: either v2 with no city, or v2 fallback after city returned <5
  const lat = input.lat?.toFixed(1) ?? "0";
  const lng = input.lng?.toFixed(1) ?? "0";
  return `v2:geo:${lat}:${lng}:seg:${segPart}:gen:${genrePart}:sub:${subPart}:kw:${kwPart}:dt:${dtPart}${fallbackPart}`;
}

// ── Image Picker ─────────────────────────────────────────────────────────────

function pickBestImage(images: any[]): string {
  if (!images || images.length === 0) return "";
  const ideal = images.find(
    (img: any) => img.ratio === "16_9" && img.width >= 1024,
  );
  if (ideal) return ideal.url;
  const sorted = [...images].sort(
    (a: any, b: any) => (b.width || 0) - (a.width || 0),
  );
  return sorted[0]?.url || "";
}

// ── Price Formatter ──────────────────────────────────────────────────────────

function formatPrice(
  priceRanges: any[] | undefined,
): { min: number | null; max: number | null; currency: string | null; formatted: string } {
  if (!priceRanges || priceRanges.length === 0) {
    return { min: null, max: null, currency: null, formatted: "TBA" };
  }
  const range = priceRanges[0];
  const min = range.min ?? null;
  const max = range.max ?? null;
  const currency = range.currency ?? "USD";

  let formatted: string;
  if (min !== null && max !== null) {
    formatted = `$${Math.round(min)} - $${Math.round(max)}`;
  } else if (min !== null) {
    formatted = `$${Math.round(min)}+`;
  } else if (max !== null) {
    formatted = `Up to $${Math.round(max)}`;
  } else {
    formatted = "TBA";
  }

  return { min, max, currency, formatted };
}

// ── Transform Ticketmaster Event ─────────────────────────────────────────────

function transformEvent(
  event: any,
  anchorLat: number | null,
  anchorLng: number | null,
): TicketmasterEvent {
  const venue = event._embedded?.venues?.[0];
  const attraction = event._embedded?.attractions?.[0];

  const venueLat = parseFloat(venue?.location?.latitude ?? "0");
  const venueLng = parseFloat(venue?.location?.longitude ?? "0");

  const classification = event.classifications?.[0];
  const genre = classification?.genre?.name !== "Undefined"
    ? classification?.genre?.name ?? null
    : null;
  const subGenre = classification?.subGenre?.name !== "Undefined"
    ? classification?.subGenre?.name ?? null
    : null;
  const segmentName = classification?.segment?.name !== "Undefined"
    ? classification?.segment?.name ?? null
    : null;

  const tags = [genre, subGenre, segmentName].filter(Boolean) as string[];
  if (attraction) tags.push("Live");

  const priceInfo = formatPrice(event.priceRanges);

  const city = venue?.city?.name ?? "";
  const state = venue?.state?.stateCode ?? venue?.state?.name ?? "";
  const locationStr = [city, state].filter(Boolean).join(", ");

  const address = venue?.address?.line1 ?? "";
  const allImages = (event.images || []).map((img: any) => img.url);

  // ORCH-0809: distance is null when no anchor point (city-mode without fallback)
  const distance =
    anchorLat !== null && anchorLng !== null && !Number.isNaN(venueLat) && !Number.isNaN(venueLng)
      ? parseFloat(haversineKm(anchorLat, anchorLng, venueLat, venueLng).toFixed(1))
      : null;

  return {
    id: event.id,
    eventName: event.name ?? "Untitled Event",
    artistName: attraction?.name ?? "Various Artists",
    venueName: venue?.name ?? "Venue TBA",
    image: pickBestImage(event.images),
    images: allImages,
    priceMin: priceInfo.min,
    priceMax: priceInfo.max,
    priceCurrency: priceInfo.currency,
    price: priceInfo.formatted,
    date: event.dates?.start?.localDate
      ? formatDate(event.dates.start.localDate)
      : "Date TBA",
    time: formatTime(event.dates?.start?.localTime),
    localDate: event.dates?.start?.localDate ?? "",
    localTime: event.dates?.start?.localTime ?? null,
    dateTimeUTC: event.dates?.start?.dateTime ?? null,
    location: locationStr,
    address,
    coordinates: { lat: venueLat, lng: venueLng },
    genre,
    subGenre,
    tags,
    ticketUrl: event.url ?? "",
    ticketStatus: event.dates?.status?.code ?? "unknown",
    seatMapUrl: event.seatmap?.staticUrl ?? null,
    distance,
  };
}

// ── Ticketmaster URL Builder ─────────────────────────────────────────────────

interface TmQueryInput {
  city?: string;
  stateCode?: string | null;
  countryCode?: string | null;
  lat?: number;
  lng?: number;
  radius?: number;
  segmentId: string;
  genreIds: string[];
  subGenreIds: string[];
  localStartEndDateTime?: string;
  startDate?: string;
  endDate?: string;
  keywords: string[];
  sort: string;
  page: number;
  size: number;
}

function stripMs(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

function buildTmUrl(input: TmQueryInput): string {
  const params = new URLSearchParams({
    apikey: TICKETMASTER_API_KEY ?? "",
    sort: input.sort,
    size: input.size.toString(),
    page: input.page.toString(),
  });

  if (input.city) {
    params.set("city", input.city);
    if (input.stateCode) params.set("stateCode", input.stateCode);
    if (input.countryCode) params.set("countryCode", input.countryCode);
  } else if (typeof input.lat === "number" && typeof input.lng === "number") {
    params.set("latlong", `${input.lat},${input.lng}`);
    params.set("radius", (input.radius ?? 50).toString());
    params.set("unit", "km");
  }

  params.set("segmentId", input.segmentId);

  if (input.genreIds.length > 0) {
    params.set("genreId", input.genreIds.join(","));
  }

  // ORCH-0809-E: sub-genre union for curated chips like "Afro" that fan out
  // to multiple TM sub-genres in a single request.
  if (input.subGenreIds.length > 0) {
    params.set("subGenreId", input.subGenreIds.join(","));
  }

  if (input.keywords.length > 0) {
    params.set("keyword", input.keywords.join(","));
  }

  // ORCH-0809: localStartEndDateTime preferred; v1 UTC startDate/endDate fallback
  if (input.localStartEndDateTime) {
    params.set("localStartEndDateTime", input.localStartEndDateTime);
  } else {
    if (input.startDate) {
      const start = input.startDate.includes("T")
        ? input.startDate
        : `${input.startDate}T00:00:00Z`;
      params.set("startDateTime", stripMs(start));
    }
    if (input.endDate) {
      const end = input.endDate.includes("T")
        ? input.endDate
        : `${input.endDate}T23:59:59Z`;
      params.set("endDateTime", stripMs(end));
    }
  }

  return `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`;
}

// ── TM Fetch + Transform ─────────────────────────────────────────────────────

interface TmFetchResult {
  events: TicketmasterEvent[];
  totalResults: number;
  totalPages: number;
  status: number;
  errorBody?: string;
}

async function fetchTm(
  tmUrl: string,
  anchorLat: number | null,
  anchorLng: number | null,
): Promise<TmFetchResult> {
  let tmResponse: Response;
  try {
    tmResponse = await fetch(tmUrl);
  } catch (fetchErr) {
    console.error("Ticketmaster fetch error:", fetchErr);
    return { events: [], totalResults: 0, totalPages: 0, status: 502 };
  }

  if (!tmResponse.ok) {
    const errText = await tmResponse.text();
    console.error(`Ticketmaster error ${tmResponse.status}:`, errText);
    return {
      events: [],
      totalResults: 0,
      totalPages: 0,
      status: tmResponse.status,
      errorBody: errText,
    };
  }

  const tmData = await tmResponse.json();
  const rawEvents = tmData._embedded?.events ?? [];
  const totalResults = tmData.page?.totalElements ?? 0;
  const totalPages = tmData.page?.totalPages ?? 0;
  const events: TicketmasterEvent[] = rawEvents.map((e: any) =>
    transformEvent(e, anchorLat, anchorLng),
  );

  return { events, totalResults, totalPages, status: tmResponse.status };
}

// ── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    if (!TICKETMASTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "TICKETMASTER_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: RequestBody = await req.json();
    const {
      location,
      radius,
      keywords,
      startDate,
      endDate,
      sort,
      page,
      size,
      city,
      stateCode,
      countryCode,
      segmentSlug,
      genreSlugs,
      localStartEndDateTime,
      latFallback,
      lngFallback,
      radiusFallback,
    } = body;

    // Validation: need either city or location
    if (!city && (!location?.lat || !location?.lng)) {
      return new Response(
        JSON.stringify({ error: "city or location is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ORCH-0809 M2.1 (P1-2 audit finding P2-4 part 1): forbid sending both city
    // and location simultaneously. The service layer already guards this client-side,
    // but the edge function must symmetrically reject so any direct caller can't
    // bypass. Eliminates the silent "city wins" precedence rule.
    if (city && location?.lat && location?.lng) {
      return new Response(
        JSON.stringify({ error: "pass either city or location, not both" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ORCH-0809 M2.1 (P1-2 audit finding): forbid unknown segmentSlug instead of
    // silently falling back to Music. This was the exact "silent classification
    // fabrication" bug class the SPEC was built to remove (same class as the
    // deleted price filter). Constitution #3 (no silent failures) + #9 (no
    // fabricated data) require an explicit 400 so the client knows the slug is
    // unsupported rather than receiving Music events labeled under another segment.
    if (segmentSlug !== undefined && !(segmentSlug in DISCOVER_SEGMENT_ID)) {
      return new Response(
        JSON.stringify({
          error: `unknown segmentSlug: ${segmentSlug}`,
          supported: Object.keys(DISCOVER_SEGMENT_ID),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validation: localStartEndDateTime format (when present)
    if (
      localStartEndDateTime &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2},\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(
        localStartEndDateTime,
      )
    ) {
      return new Response(
        JSON.stringify({ error: "invalid localStartEndDateTime format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve segment + genre slugs to TM IDs (server-owned).
    // ORCH-0809-E: subGenreIds may also be returned for curated-union chips
    // like "afro" (one slug → many TM sub-genres under a shared genre).
    const { segmentId, genreIds, subGenreIds } = resolveTmClassification(
      segmentSlug,
      genreSlugs ?? [],
    );

    const searchRadius = radius ?? 50;
    const searchKeywords = keywords ?? [];
    const pageNum = page ?? 0;
    const pageSize = size ?? 20;
    const sortBy = sort ?? "date,asc";

    // ── Build cache key + check cache ────────────────────────────────────
    const cacheKey = buildCacheKey({
      city,
      stateCode,
      countryCode,
      lat: location?.lat,
      lng: location?.lng,
      segmentId,
      genreIds,
      subGenreIds,
      localStartEndDateTime,
      startDate,
      keywords: searchKeywords,
      usedFallback: false,
    });

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

      return new Response(
        JSON.stringify({
          events: paginatedEvents,
          meta: {
            totalResults: cached.total_results,
            page: pageNum,
            pageSize,
            totalPages,
            fromCache: true,
            keywords: searchKeywords,
            usedFallback: false,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Primary TM fetch ─────────────────────────────────────────────────
    const primaryAnchorLat = city ? null : (location?.lat ?? null);
    const primaryAnchorLng = city ? null : (location?.lng ?? null);

    const primaryUrl = buildTmUrl({
      city,
      stateCode,
      countryCode,
      lat: location?.lat,
      lng: location?.lng,
      radius: searchRadius,
      segmentId,
      genreIds,
      subGenreIds,
      localStartEndDateTime,
      startDate,
      endDate,
      keywords: searchKeywords,
      sort: sortBy,
      page: pageNum,
      size: pageSize,
    });

    let result = await fetchTm(primaryUrl, primaryAnchorLat, primaryAnchorLng);
    let usedFallback = false;

    // ── Rate-limit / 5xx → stale cache attempt ───────────────────────────
    if (result.status === 429 || result.status >= 500) {
      console.warn(`Ticketmaster returned ${result.status}, checking stale cache...`);
      const { data: staleCache } = await supabaseAdmin
        .from("ticketmaster_events_cache")
        .select("events, total_results")
        .eq("cache_key", cacheKey)
        .maybeSingle();

      if (staleCache) {
        const events = (staleCache.events as TicketmasterEvent[]) || [];
        const start = pageNum * pageSize;
        const paginatedEvents = events.slice(start, start + pageSize);
        const totalPages = Math.ceil(events.length / pageSize);

        return new Response(
          JSON.stringify({
            events: paginatedEvents,
            meta: {
              totalResults: staleCache.total_results,
              page: pageNum,
              pageSize,
              totalPages,
              fromCache: true,
              keywords: searchKeywords,
              usedFallback: false,
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const errMsg = result.status === 429
        ? "Ticketmaster rate limit exceeded. Please try again later."
        : "Ticketmaster service unavailable. Please try again later.";

      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: result.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (result.status >= 400) {
      return new Response(
        JSON.stringify({ error: `Ticketmaster API error: ${result.status}` }),
        { status: result.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Fallback trigger: city returned <5, retry with lat/lng if available ─
    if (
      city &&
      result.totalResults < CITY_FALLBACK_THRESHOLD &&
      typeof latFallback === "number" &&
      typeof lngFallback === "number"
    ) {
      console.log(
        `Ticketmaster city='${city}' returned ${result.totalResults} (<${CITY_FALLBACK_THRESHOLD}); retrying with lat/lng fallback`,
      );

      const fallbackUrl = buildTmUrl({
        lat: latFallback,
        lng: lngFallback,
        radius: radiusFallback ?? 50,
        segmentId,
        genreIds,
        subGenreIds,
        localStartEndDateTime,
        startDate,
        endDate,
        keywords: searchKeywords,
        sort: sortBy,
        page: pageNum,
        size: pageSize,
      });

      const fallbackResult = await fetchTm(fallbackUrl, latFallback, lngFallback);

      if (fallbackResult.status === 200 && fallbackResult.totalResults > result.totalResults) {
        result = fallbackResult;
        usedFallback = true;
      }
    }

    // ── Cache write (fire-and-forget) ────────────────────────────────────
    const writeKey = usedFallback
      ? buildCacheKey({
          lat: latFallback,
          lng: lngFallback,
          segmentId,
          genreIds,
          subGenreIds,
          localStartEndDateTime,
          startDate,
          keywords: searchKeywords,
          usedFallback: true,
        })
      : cacheKey;

    // Fire-and-forget cache write + cleanup
    (async () => {
      try {
        await supabaseAdmin
          .from("ticketmaster_events_cache")
          .upsert(
            {
              cache_key: writeKey,
              events: result.events as any,
              total_results: result.totalResults,
              fetched_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            },
            { onConflict: "cache_key" },
          );
        const { error: cleanupErr } = await supabaseAdmin
          .from("ticketmaster_events_cache")
          .delete()
          .lt("expires_at", new Date().toISOString());
        if (cleanupErr) console.warn("Cache cleanup error:", cleanupErr.message);
      } catch (err: any) {
        console.warn("Cache upsert error:", err);
      }
    })();

    return new Response(
      JSON.stringify({
        events: result.events,
        meta: {
          totalResults: result.totalResults,
          page: pageNum,
          pageSize,
          totalPages: result.totalPages,
          fromCache: false,
          keywords: searchKeywords,
          usedFallback,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("ticketmaster-events error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
