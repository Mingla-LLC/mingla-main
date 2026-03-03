import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TICKETMASTER_API_KEY = Deno.env.get("TICKETMASTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseAdmin = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "");

// ── Ticketmaster Music segment ID ───────────────────────────────────────────
const MUSIC_SEGMENT_ID = "KZFzniwnSyZfZ7v7nJ";

// ── Interfaces ──────────────────────────────────────────────────────────────

interface RequestBody {
  location: { lat: number; lng: number };
  radius?: number;
  keywords?: string[];
  startDate?: string;
  endDate?: string;
  sort?: string;
  page?: number;
  size?: number;
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
  distance: number;
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
  // localDate is "YYYY-MM-DD"
  const parts = localDate.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  // Build the date in UTC to avoid timezone shifts when only using the date components
  const d = new Date(Date.UTC(year, month, day));
  const dayName = DAY_NAMES[d.getUTCDay()];
  const monthName = MONTH_NAMES[d.getUTCMonth()];
  return `${dayName}, ${monthName} ${d.getUTCDate()}`;
}

function formatTime(localTime: string | undefined): string {
  if (!localTime) return "Time TBA";
  // localTime is "HH:MM:SS"
  const parts = localTime.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  const ampm = hours >= 12 ? "PM" : "AM";
  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;
  return `${hours}:${minutes} ${ampm}`;
}

// ── Cache Key Builder ───────────────────────────────────────────────────────

function buildCacheKey(
  lat: number,
  lng: number,
  keywords: string[],
  startDate?: string
): string {
  const sortedKw = [...keywords].sort().join(",");
  const dateStr = startDate ? startDate.slice(0, 10) : "none";
  return `geo:${lat.toFixed(1)}:${lng.toFixed(1)}:kw:${sortedKw}:d:${dateStr}`;
}

// ── Image Picker ────────────────────────────────────────────────────────────

function pickBestImage(images: any[]): string {
  if (!images || images.length === 0) return "";

  // Prefer 16_9 with width >= 1024
  const ideal = images.find(
    (img: any) => img.ratio === "16_9" && img.width >= 1024
  );
  if (ideal) return ideal.url;

  // Fallback: largest by width
  const sorted = [...images].sort(
    (a: any, b: any) => (b.width || 0) - (a.width || 0)
  );
  return sorted[0]?.url || "";
}

// ── Price Formatter ─────────────────────────────────────────────────────────

function formatPrice(
  priceRanges: any[] | undefined
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

// ── Transform Ticketmaster Event ────────────────────────────────────────────

function transformEvent(
  event: any,
  userLat: number,
  userLng: number
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
    distance: parseFloat(haversineKm(userLat, userLng, venueLat, venueLng).toFixed(1)),
  };
}

// ── Main Handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Validate env
    if (!TICKETMASTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "TICKETMASTER_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse body
    const body: RequestBody = await req.json();
    const { location, radius, keywords, startDate, endDate, sort, page, size } = body;

    if (!location?.lat || !location?.lng) {
      return new Response(
        JSON.stringify({ error: "location.lat and location.lng are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lat = location.lat;
    const lng = location.lng;
    const searchRadius = radius ?? 50; // km
    const searchKeywords = keywords ?? [];
    const pageNum = page ?? 0;
    const pageSize = size ?? 20;
    const sortBy = sort ?? "date,asc";

    // ── Check cache ───────────────────────────────────────────────────────
    const cacheKey = buildCacheKey(lat, lng, searchKeywords, startDate);

    const { data: cached } = await supabaseAdmin
      .from("ticketmaster_events_cache")
      .select("events, total_results, fetched_at")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached) {
      const events = (cached.events as TicketmasterEvent[]) || [];
      // Paginate cached results
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
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build Ticketmaster API URL ────────────────────────────────────────
    const params = new URLSearchParams({
      apikey: TICKETMASTER_API_KEY,
      latlong: `${lat},${lng}`,
      radius: searchRadius.toString(),
      unit: "km",
      segmentId: MUSIC_SEGMENT_ID,
      sort: sortBy,
      size: pageSize.toString(),
      page: pageNum.toString(),
    });

    if (searchKeywords.length > 0) {
      params.set("keyword", searchKeywords.join(","));
    }
    // Ticketmaster requires ISO 8601 WITHOUT milliseconds: 2026-03-01T00:00:00Z
    const stripMs = (iso: string) => iso.replace(/\.\d{3}Z$/, "Z");
    if (startDate) {
      const start = startDate.includes("T") ? startDate : `${startDate}T00:00:00Z`;
      params.set("startDateTime", stripMs(start));
    }
    if (endDate) {
      const end = endDate.includes("T") ? endDate : `${endDate}T23:59:59Z`;
      params.set("endDateTime", stripMs(end));
    }

    const tmUrl = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`;

    // ── Fetch from Ticketmaster ──────────────────────────────────────────
    let tmResponse: Response;
    try {
      tmResponse = await fetch(tmUrl);
    } catch (fetchErr) {
      console.error("Ticketmaster fetch error:", fetchErr);
      return new Response(
        JSON.stringify({ error: "Failed to reach Ticketmaster API" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle rate limiting and server errors
    if (tmResponse.status === 429 || tmResponse.status >= 500) {
      console.warn(`Ticketmaster returned ${tmResponse.status}, checking stale cache...`);

      // Try stale cache (ignoring expiry)
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
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const errMsg = tmResponse.status === 429
        ? "Ticketmaster rate limit exceeded. Please try again later."
        : "Ticketmaster service unavailable. Please try again later.";

      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: tmResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tmResponse.ok) {
      const errText = await tmResponse.text();
      console.error(`Ticketmaster error ${tmResponse.status}:`, errText);
      return new Response(
        JSON.stringify({ error: `Ticketmaster API error: ${tmResponse.status}` }),
        { status: tmResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tmData = await tmResponse.json();

    // ── Handle empty results ─────────────────────────────────────────────
    const rawEvents = tmData._embedded?.events ?? [];
    const totalResults = tmData.page?.totalElements ?? 0;
    const totalPages = tmData.page?.totalPages ?? 0;

    if (rawEvents.length === 0) {
      return new Response(
        JSON.stringify({
          events: [],
          meta: {
            totalResults: 0,
            page: pageNum,
            pageSize,
            totalPages: 0,
            fromCache: false,
            keywords: searchKeywords,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Transform events ─────────────────────────────────────────────────
    const events: TicketmasterEvent[] = rawEvents.map((e: any) =>
      transformEvent(e, lat, lng)
    );

    // ── Write to cache (fire-and-forget) + cleanup expired rows ─────────
    supabaseAdmin
      .from("ticketmaster_events_cache")
      .upsert(
        {
          cache_key: cacheKey,
          events: events as any,
          total_results: totalResults,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "cache_key" }
      )
      .then(() => {
        // Cleanup expired cache rows
        supabaseAdmin
          .from("ticketmaster_events_cache")
          .delete()
          .lt("expires_at", new Date().toISOString())
          .then(({ error }) => {
            if (error) console.warn("Cache cleanup error:", error.message);
          });
      })
      .catch((err: any) => {
        console.warn("Cache upsert error:", err);
      });

    // ── Return response ──────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        events,
        meta: {
          totalResults,
          page: pageNum,
          pageSize,
          totalPages,
          fromCache: false,
          keywords: searchKeywords,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("ticketmaster-events error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
