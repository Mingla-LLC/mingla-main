/**
 * #1615 authoritative content-share mapping.
 *
 * Requests provide identity only. This module reads the served database truth,
 * derives ShareFactsV1, and returns the private stable-source key plus public
 * destination manifest. It deliberately has no renderer and does not inspect
 * event_cover_video_jobs or any provider payload.
 */

export type ContentShareKind =
  | "place" | "curated" | "event" | "rsvp_event"
  | "trip" | "experience" | "venue" | "brand";

type RecordLike = Record<string, any>;
type QueryClient = { from(table: string): any };

const clean = (value: unknown, max = 160): string =>
  typeof value === "string"
    ? Array.from(value.normalize("NFC").replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
      .replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim()).slice(0, max).join("")
    : "";

const compact = (value: RecordLike): RecordLike =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && item !== null && item !== undefined));

const money = (minorUnits: unknown, currency: unknown, disclosure?: string): RecordLike | undefined => {
  const code = clean(currency, 3).toUpperCase();
  return Number.isSafeInteger(minorUnits) && Number(minorUnits) >= 0 && /^[A-Z]{3}$/.test(code)
    ? compact({ minorUnits, currency: code, disclosure }) : undefined;
};

const status = (row: RecordLike): string | undefined => {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "ended") return "ended";
  return undefined;
};

function localSchedule(startAt: unknown, timezone: unknown): { localDate?: string; localTime?: string } {
  const zone = clean(timezone, 80) || "UTC";
  if (typeof startAt !== "string" || Number.isNaN(Date.parse(startAt))) return {};
  try {
    const date = new Date(startAt);
    return {
      localDate: new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", year: "numeric" }).format(date),
      localTime: new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(date),
    };
  } catch {
    return {};
  }
}

function sourceId(input: RecordLike, ...keys: string[]): string {
  for (const key of keys) {
    const value = clean(input[key], 256);
    if (value) return value;
  }
  return "";
}

export function mapAuthoritativeShareFacts(kind: ContentShareKind, assembled: RecordLike) {
  const row = assembled.row || {};
  const brand = Array.isArray(row.brands) ? row.brands[0] : row.brands || assembled.brand || {};
  const date = assembled.date || {};
  const schedule = localSchedule(date.start_at, row.timezone || date.timezone);
  const firstTicket = (assembled.tickets || []).find((ticket: RecordLike) => ticket.is_hidden !== true && ticket.is_disabled !== true);
  const price = firstTicket ? money(firstTicket.price_cents, firstTicket.currency, firstTicket.is_free ? undefined : "From") : undefined;
  const routeBase = compact({ kind, brandSlug: clean(brand.slug, 160), eventSlug: clean(row.slug, 160) });
  let facts: RecordLike;
  let destination: RecordLike;

  switch (kind) {
    case "place":
      facts = compact({
        schemaVersion: 1, kind, title: clean(row.name),
        category: clean(row.primary_type_display_name || row.primary_type, 80),
        area: clean(row.neighborhood || row.city, 120),
        rating: Number.isFinite(row.rating) && row.rating >= 0 && row.rating <= 5 ? row.rating : undefined,
        priceLevel: clean(row.price_level, 40), description: clean(row.editorial_summary || row.generative_summary, 600),
        timezone: clean(row.timezone || (Number.isInteger(row.utc_offset_minutes) ? `UTC_OFFSET:${row.utc_offset_minutes}` : ""), 80),
        route: { placeId: clean(row.google_place_id, 256) },
      });
      destination = { kind, placeId: clean(row.google_place_id, 256) };
      break;
    case "curated": {
      const card = row.card_data && typeof row.card_data === "object" && !Array.isArray(row.card_data) ? row.card_data : {};
      const stops = Array.isArray(card.stops) ? card.stops : [];
      facts = compact({
        schemaVersion: 1, kind, title: clean(row.title || card.title || card.name),
        stopCount: stops.length, area: clean(card.neighborhood || card.city || card.location, 120),
        duration: clean(card.duration, 80), description: clean(card.description || card.fullDescription, 600),
        route: {},
      });
      destination = { kind };
      break;
    }
    case "event":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), ...schedule,
        venue: clean(row.location_text, 160), area: clean(row.city, 120), price,
        status: status(row), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/e/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "rsvp_event":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), ...schedule,
        venue: clean(row.location_text, 160), rsvpDeadline: clean(row.rsvp_deadline, 120),
        status: status(row), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/e/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "trip":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), destination: clean(row.destination_text || row.location_text, 160),
        dateRange: clean(assembled.dateRange, 120), duration: clean(assembled.duration, 80), startingPrice: price,
        status: status(row), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/t/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "experience":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), area: clean(row.location_text, 120),
        nextDate: [schedule.localDate, schedule.localTime].filter(Boolean).join(" at "), duration: clean(assembled.duration, 80), price,
        status: status(row), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/exp/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "venue":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.name), category: clean(row.venue_category, 80),
        area: clean(row.city, 120), timezone: clean(row.timezone, 80), description: clean(row.pitch, 600),
        route: { brandSlug: clean(row.brand_slug, 160), venueSlug: clean(row.slug, 160) } });
      destination = { kind, brandSlug: clean(row.brand_slug, 160), venueSlug: clean(row.slug, 160), webPath: `/b/${clean(row.brand_slug, 160)}/v/${clean(row.slug, 160)}` };
      break;
    case "brand":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.name), category: clean(row.category, 80), area: clean(row.city, 120),
        upcomingPublicOfferingCount: assembled.upcomingCount > 0 ? assembled.upcomingCount : undefined,
        description: clean(row.description, 600), route: { brandSlug: clean(row.slug, 160) } });
      destination = { kind, brandSlug: clean(row.slug, 160), webPath: `/b/${clean(row.slug, 160)}` };
      break;
  }

  if (!facts.title) throw new Error("not_found");
  return { facts, destinationManifest: destination };
}

const eventTypeFor = (kind: ContentShareKind): string | null => ({
  event: "event", rsvp_event: "rsvp", trip: "trip", experience: "experience",
} as Record<string, string>)[kind] || null;

export async function loadAuthoritativeContentShare(
  db: QueryClient, userId: string, kind: ContentShareKind, identity: RecordLike,
) {
  if (kind === "place") {
    const poolId = sourceId(identity, "placePoolId");
    const googleId = sourceId(identity, "googlePlaceId");
    if (!poolId && !googleId) throw new Error("validation");
    let query = db.from("place_pool").select("id,google_place_id,name,city,primary_type_display_name,primary_type,rating,price_level,utc_offset_minutes,editorial_summary,generative_summary,is_active,is_servable").limit(1);
    query = poolId ? query.eq("id", poolId) : query.eq("google_place_id", googleId);
    const { data: row } = await query.maybeSingle();
    if (!row || row.is_active !== true || row.is_servable === false) throw new Error("not_found");
    return { ...mapAuthoritativeShareFacts(kind, { row }), sourceKey: `place:${row.id}`, sourceReference: { placePoolId: row.id } };
  }

  if (kind === "curated") {
    const id = sourceId(identity, "savedCardId");
    if (!id) throw new Error("validation");
    const { data: row } = await db.from("saved_card").select("id,profile_id,title,category,card_data").eq("id", id).eq("profile_id", userId).maybeSingle();
    if (!row) throw new Error("not_found");
    return { ...mapAuthoritativeShareFacts(kind, { row }), sourceKey: `curated:${row.id}`, sourceReference: { savedCardId: row.id } };
  }

  const expectedType = eventTypeFor(kind);
  if (expectedType) {
    const id = sourceId(identity, "eventId");
    const eventSlug = sourceId(identity, "eventSlug");
    const brandSlug = sourceId(identity, "brandSlug");
    if (!id && (!eventSlug || !brandSlug)) throw new Error("validation");
    let query = db.from("events").select("id,title,description,slug,location_text,status,visibility,published_at,deleted_at,timezone,event_type,destination_text,brands!inner(name,slug,deleted_at)")
      .eq("event_type", expectedType).in("visibility", ["public", "discover"]).not("published_at", "is", null).is("deleted_at", null)
      .in("status", ["scheduled", "live", "ended", "cancelled"]).limit(1);
    query = id ? query.eq("id", id) : query.eq("slug", eventSlug).eq("brands.slug", brandSlug);
    const { data: row } = await query.maybeSingle();
    if (!row) throw new Error("not_found");
    const [{ data: dates }, { data: tickets }] = await Promise.all([
      db.from("event_dates").select("start_at,end_at,timezone,is_master").eq("event_id", row.id).order("start_at", { ascending: true }).limit(2),
      db.from("ticket_types").select("price_cents,currency,is_free,is_hidden,is_disabled,display_order").eq("event_id", row.id).is("deleted_at", null).order("display_order", { ascending: true }),
    ]);
    const assembled = { row, date: dates?.[0], tickets: tickets || [] };
    return { ...mapAuthoritativeShareFacts(kind, assembled), sourceKey: `${kind}:${row.id}`, sourceReference: { eventId: row.id } };
  }

  if (kind === "venue") {
    const brandSlug = sourceId(identity, "brandSlug");
    const venueSlug = sourceId(identity, "venueSlug");
    if (!brandSlug || !venueSlug) throw new Error("validation");
    const { data: row } = await db.from("venue_public_view").select("id,brand_slug,slug,name,city,venue_category,pitch").eq("brand_slug", brandSlug).eq("slug", venueSlug).maybeSingle();
    if (!row) throw new Error("not_found");
    return { ...mapAuthoritativeShareFacts(kind, { row }), sourceKey: `venue:${row.id}`, sourceReference: { venueId: row.id } };
  }

  const brandSlug = sourceId(identity, "brandSlug");
  if (!brandSlug) throw new Error("validation");
  const { data: row } = await db.from("brands_public_view").select("id,name,slug,description").eq("slug", brandSlug).maybeSingle();
  if (!row) throw new Error("not_found");
  const { count } = await db.from("events").select("id", { count: "exact", head: true }).eq("brand_id", row.id)
    .in("visibility", ["public", "discover"]).not("published_at", "is", null).is("deleted_at", null).in("status", ["scheduled", "live"]);
  return { ...mapAuthoritativeShareFacts("brand", { row, upcomingCount: count || 0 }), sourceKey: `brand:${row.id}`, sourceReference: { brandId: row.id } };
}
