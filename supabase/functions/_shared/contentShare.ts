/**
 * #1615 authoritative content-share mapping.
 *
 * Requests provide identity only. This module reads the served database truth,
 * derives ShareFactsV1, and returns the private stable-source key plus public
 * destination manifest. It deliberately has no renderer and never reads a
 * private processing-job record or provider payload.
 */

export type ContentShareKind =
  | "place" | "curated" | "event" | "rsvp_event"
  | "trip" | "experience" | "venue" | "brand";

type RecordLike = Record<string, any>;
type QueryClient = { from(table: string): any; rpc(name: string, args?: Record<string, unknown>): any };

/** Exact deployed public.place_pool columns consumed by the V1 share mapper. */
export const PLACE_POOL_SHARE_SELECT = "id,google_place_id,name,address,city,primary_type_display_name,primary_type,rating,price_level,utc_offset_minutes,editorial_summary,generative_summary,opening_hours,stored_photo_urls,google_maps_uri,national_phone_number,website,is_active,is_servable";

const clean = (value: unknown, max = 160): string =>
  typeof value === "string"
    ? Array.from(value.normalize("NFC").replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
      .replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim()).slice(0, max).join("")
    : "";

const compact = (value: RecordLike): RecordLike =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && item !== null && item !== undefined));

const cleanPriceLevel = (value: unknown): string | undefined => ({
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  "0": "Free", "1": "$", "2": "$$", "3": "$$$", "4": "$$$$",
} as Record<string, string>)[clean(value, 40).toUpperCase()];

const publicStop = (raw: unknown): RecordLike | null => {
  const stop = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as RecordLike : {};
  const title = clean(stop.title || stop.name, 160);
  if (!title) return null;
  return compact({
    title,
    category: clean(stop.category || stop.primaryTypeDisplayName || stop.primary_type_display_name, 80),
    area: clean(stop.neighborhood || stop.area || stop.city, 120),
    address: clean(stop.address, 180),
    description: clean(stop.description || stop.editorialSummary, 300),
    imageUrl: publicMediaUrl(stop.imageUrl || stop.image_url || stop.image),
  });
};

const publicDetailsFor = (kind: ContentShareKind, row: RecordLike, assembled: RecordLike): RecordLike => {
  if (kind === "curated") {
    const card = row.card_data && typeof row.card_data === "object" && !Array.isArray(row.card_data) ? row.card_data : {};
    return compact({
      kind,
      stops: (Array.isArray(card.stops) ? card.stops : []).slice(0, 24).map(publicStop).filter(Boolean),
      estimate: clean(card.estimate || card.estimatedCost || card.priceRange || card.price_range, 80),
    });
  }
  if (kind === "place") return compact({
    kind,
    description: clean(row.editorial_summary || row.generative_summary, 600),
    address: clean(row.address, 180),
    directionsUrl: publicExternalUrl(row.google_maps_uri),
    phone: clean(row.national_phone_number, 40),
    website: publicExternalUrl(row.website),
    utcOffsetMinutes: Number.isInteger(row.utc_offset_minutes) ? row.utc_offset_minutes : undefined,
  });
  if (["event", "rsvp_event", "trip", "experience"].includes(kind)) return compact({
    kind,
    actionEligible: assembled.actionEligible === true,
    occurrences: (assembled.relevantDates || []).slice(0, 24).map((date: RecordLike) => compact({
      startAt: clean(date.start_at, 40), endAt: clean(date.end_at, 40), timezone: clean(date.timezone || row.timezone, 80),
    })),
  });
  if (kind === "venue" || kind === "brand") return compact({
    kind,
    offerings: (assembled.offerings || []).slice(0, 8).map((item: RecordLike) => compact({
      title: clean(item.title, 160), kind: clean(item.event_type, 24),
      brandSlug: clean(item.brand_slug, 160), eventSlug: clean(item.slug, 160),
      startAt: clean(item.master_start_at, 40),
    })),
  });
  return { kind };
};

const publicMediaUrl = (value: unknown): string | null => {
  const text = clean(value, 2048);
  try {
    const url = new URL(text);
    const hasUserInfo = !url.href.startsWith(`${url.protocol}//${url.host}`);
    if (url.protocol !== "https:" || hasUserInfo || url.port) return null;
    const host = url.hostname.toLowerCase();
    const bunnyHost = clean((globalThis as any).Deno?.env?.get?.("BUNNY_STREAM_CDN_HOSTNAME"), 255).toLowerCase();
    const allowed = ["usemingla.com","www.usemingla.com","business.usemingla.com"].includes(host)
      || host === "images.pexels.com" || host === "videos.pexels.com"
      || host === "i.giphy.com" || host === "media.giphy.com"
      || host === "vz-a16fce08-6c6.b-cdn.net" || (bunnyHost.length > 0 && host === bunnyHost)
      || (host === "gqnoajqerqhnvulmnyvv.supabase.co" && url.pathname.startsWith("/storage/v1/object/public/"));
    return allowed ? url.toString() : null;
  } catch { return null; }
};

const publicExternalUrl = (value: unknown): string | null => {
  const text = clean(value, 2048);
  try { const url = new URL(text); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
};

const imageFallback = (row: RecordLike): string | null => {
  const gallery = Array.isArray(row.cover_media_gallery) ? row.cover_media_gallery : [];
  const galleryUrl = gallery.map((item: any) => {
    const mediaKind = clean(item?.type || item?.kind || item?.mediaType || item?.media_type, 16).toLowerCase();
    if (["video", "gif", "animated"].includes(mediaKind)) return null;
    const candidate = publicMediaUrl(item?.url);
    if (!candidate) return null;
    try {
      const pathname = new URL(candidate).pathname;
      return ["image", "photo"].includes(mediaKind) || /\.(?:avif|jpe?g|png|webp)$/i.test(pathname)
        ? candidate : null;
    } catch { return null; }
  }).find(Boolean);
  const poolUrl = (Array.isArray(row.pool_photo_urls) ? row.pool_photo_urls : [])
    .map(publicMediaUrl).find(Boolean);
  const storedUrl = (Array.isArray(row.stored_photo_urls) ? row.stored_photo_urls : [])
    .map(publicMediaUrl).find(Boolean);
  const card = row.card_data && typeof row.card_data === "object" ? row.card_data : {};
  const cardUrl = [row.image_url, card.image, ...(Array.isArray(card.images) ? card.images : [])]
    .map(publicMediaUrl).find(Boolean);
  return galleryUrl || poolUrl || storedUrl || cardUrl || publicMediaUrl(row.profile_photo_url);
};

export function mapServedMediaIdentity(row: RecordLike): RecordLike | null {
  const primary = publicMediaUrl(row.cover_media_url);
  const type = clean(row.cover_media_type, 12);
  const authoritativePoster = publicMediaUrl(row.cover_media_poster_url);
  const fallback = imageFallback(row);
  const alt = clean(row.cover_media_alt || row.name || row.title, 240);
  // #1719: animated covers are shareable only when the same cover identity has
  // an explicitly persisted poster. A gallery/logo fallback can be unrelated
  // and must never masquerade as the video's/GIF's still.
  if (primary && type === "video" && authoritativePoster) return compact({ kind: "video", url: primary, posterUrl: authoritativePoster, alt });
  if (primary && type === "gif" && authoritativePoster) return compact({ kind: "gif", url: primary, posterUrl: authoritativePoster, alt });
  if (primary && (type === "image" || !type)) return compact({ kind: "photo", url: primary, posterUrl: primary, alt });
  if (fallback) return compact({ kind: "photo", url: fallback, posterUrl: fallback, alt });
  return null;
}

const money = (minorUnits: unknown, currency: unknown, disclosure?: string): RecordLike | undefined => {
  const code = clean(currency, 3).toUpperCase();
  return Number.isSafeInteger(minorUnits) && Number(minorUnits) >= 0 && /^[A-Z]{3}$/.test(code)
    ? compact({ minorUnits, currency: code, disclosure }) : undefined;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const clockLabel = (value: unknown): string => {
  const match = /^(\d{2}):(\d{2})$/.exec(clean(value, 5)); if (!match) return "";
  const hour = Number(match[1]); const minute = Number(match[2]); if (hour > 23 || minute > 59) return "";
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
};
export function normalizeServedHours(value: unknown): RecordLike[] | undefined {
  const byDay = new Map<string, string[]>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as RecordLike;
    const lines = Array.isArray(source.weekdayDescriptions) ? source.weekdayDescriptions
      : Array.isArray(source.weekday_text) ? source.weekday_text : null;
    if (lines) for (const item of lines) {
      if (typeof item !== "string") return undefined;
      const match = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday):\s*(.+)$/i.exec(item.trim());
      if (!match) return undefined;
      const day = DAYS.find((candidate) => candidate.toLowerCase() === match[1].toLowerCase());
      const label = clean(match[2], 80); if (!day || !label || /\[object Object\]|OpenNow:|Periods:/i.test(label)) return undefined;
      byDay.set(day, [label]);
    }
  } else if (Array.isArray(value)) {
    for (const row of value) {
      if (!row || typeof row !== "object" || Array.isArray(row) || !Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) return undefined;
      const label = row.is_closed === true ? "Closed" : row.open_time === row.close_time ? "Open 24 hours" : `${clockLabel(row.open_time)}–${clockLabel(row.close_time)}`;
      if (!label || label.startsWith("–") || label.endsWith("–")) return undefined;
      const day=DAYS[row.weekday];const labels=byDay.get(day)||[];
      if(label==="Closed")byDay.set(day,[label]);else if(!labels.includes("Closed"))byDay.set(day,[...labels,label]);
    }
  }
  return byDay.size === 7 ? DAYS.map((day) => ({ day, label: byDay.get(day)!.join(", ") })) : undefined;
}

const durationLabel = (start: unknown, end: unknown): string | undefined => {
  if (typeof start !== "string" || typeof end !== "string") return undefined;
  const milliseconds = Date.parse(end) - Date.parse(start); if (!(milliseconds > 0)) return undefined;
  const minutes = Math.round(milliseconds / 60000); return minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`;
};

const status = (row: RecordLike, assembled: RecordLike = {}): string | undefined => {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "ended") return "ended";
  if (assembled.explicitDateTbd === true) return row.is_multi_date === true ? "dates_tbd" : "date_tbd";
  if (assembled.soldOut === true) return "sold_out";
  if (assembled.rsvpClosed === true) return "rsvp_closed";
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

const exactIdentityKeys = (identity: RecordLike, expected: string[]): boolean =>
  Object.keys(identity).sort().join("|") === [...expected].sort().join("|");

const curatedCompositionIds = (identity: RecordLike): string[] | null => {
  if (!exactIdentityKeys(identity, ["stopPlaceIds"]) || !Array.isArray(identity.stopPlaceIds)
    || identity.stopPlaceIds.length < 2 || identity.stopPlaceIds.length > 24) return null;
  const ids = identity.stopPlaceIds.map((value: unknown) => clean(value, 256));
  if (ids.some((value: string, index: number) => !value || value !== identity.stopPlaceIds[index])
    || new Set(ids).size !== ids.length
    || new TextEncoder().encode(JSON.stringify(ids)).byteLength > 8192) return null;
  return ids;
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const mapCuratedComposition = (rows: RecordLike[]) => {
  const names = rows.map((row) => clean(row.name, 160));
  if (names.some((name) => !name)) throw new Error("not_public");
  const mediaByStop = rows.map(mapServedMediaIdentity);
  const stops = rows.map((row, index) => publicStop({
    ...row,
    description: row.editorial_summary || row.generative_summary,
    imageUrl: mediaByStop[index]?.posterUrl,
  }));
  if (stops.some((stop) => stop === null)) throw new Error("not_public");
  const stopCities = rows.map((row) => clean(row.city, 120));
  const area = stopCities.every((city) => city.length > 0 && city === stopCities[0]) ? stopCities[0] : undefined;
  const mediaIdentity = mediaByStop.find((candidate) => candidate !== null) || null;
  const facts = compact({
    schemaVersion: 1,
    kind: "curated",
    title: clean(names.join(" → "), 160),
    stopCount: rows.length,
    area,
    route: {},
  });
  if (mediaIdentity) facts.media = mediaIdentity;
  const publicDetails = { kind: "curated", stops };
  return {
    facts,
    mediaIdentity,
    publicDetails,
    destinationManifest: { kind: "curated", publicDetails },
  };
};

export function mapAuthoritativeShareFacts(kind: ContentShareKind, assembled: RecordLike) {
  const row = assembled.row || {};
  const brand = Array.isArray(row.brands) ? row.brands[0] : row.brands || assembled.brand || {};
  const date = assembled.date || {};
  const schedule = localSchedule(date.start_at, row.timezone || date.timezone);
  const eligibleTickets = (assembled.eligibleTickets || assembled.tickets || []) as RecordLike[];
  const displayCents = (ticket: RecordLike) => ticket.is_free === true ? 0
    : Number.isSafeInteger(ticket.all_in_cents) && ticket.all_in_cents >= 0 ? ticket.all_in_cents : undefined;
  const lowestTicket = [...eligibleTickets].filter((ticket) => Number.isSafeInteger(displayCents(ticket)) && displayCents(ticket) >= 0)
    .sort((a, b) => Number(displayCents(a)) - Number(displayCents(b)))[0];
  const lowestCents=lowestTicket?displayCents(lowestTicket):undefined;
  const price = lowestTicket ? money(lowestCents, lowestTicket.is_free === true ? (lowestTicket.display_currency || lowestTicket.currency) : lowestTicket.display_currency, lowestCents === 0 ? "Free" : "From") : undefined;
  const routeBase = compact({ kind, brandSlug: clean(brand.slug, 160), eventSlug: clean(row.slug, 160) });
  let facts: RecordLike;
  let destination: RecordLike;

  switch (kind) {
    case "place":
      facts = compact({
        schemaVersion: 1, kind, title: clean(row.name),
        category: clean(row.primary_type_display_name || row.primary_type, 80),
        area: clean(row.city, 120),
        rating: Number.isFinite(row.rating) && row.rating >= 0 && row.rating <= 5 ? row.rating : undefined,
        priceLevel: cleanPriceLevel(row.price_level), description: clean(row.editorial_summary || row.generative_summary, 600),
        hours: normalizeServedHours(row.opening_hours),
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
        duration: clean(card.duration, 80), estimate: clean(card.estimate || card.estimatedCost || card.priceRange || card.price_range, 80),
        description: clean(card.description || card.fullDescription, 600),
        route: {},
      });
      destination = { kind };
      break;
    }
    case "event":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), ...schedule,
        venue: clean(row.location_text, 160), price,
        availability: clean(assembled.availability, 80), status: status(row, assembled), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/e/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "rsvp_event":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), ...schedule,
        venue: clean(row.location_text, 160),
        availability: clean(assembled.availability, 80), status: status(row, assembled), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/e/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "trip":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), destination: clean(row.destination_text || row.location_text, 160),
        dateRange: clean(assembled.dateRange, 120), duration: clean(assembled.duration, 80), startingPrice: price,
        status: status(row, assembled), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/t/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "experience":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), area: clean(row.location_text, 120),
        nextDate: [schedule.localDate, schedule.localTime].filter(Boolean).join(" at "), duration: clean(assembled.duration, 80), price,
        availability: clean(assembled.availability, 80), status: status(row, assembled), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/exp/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "venue":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.name), category: clean(row.venue_category, 80),
        area: clean(row.city, 120), nextPublicOffering: clean(assembled.nextPublicOffering, 160),
        timezone: clean(row.iana_timezone, 80), hours: normalizeServedHours(row.hours), description: clean(row.pitch, 600),
        route: { brandSlug: clean(row.brand_slug, 160), venueSlug: clean(row.slug, 160) } });
      destination = { kind, brandSlug: clean(row.brand_slug, 160), venueSlug: clean(row.slug, 160), webPath: `/b/${clean(row.brand_slug, 160)}/v/${clean(row.slug, 160)}` };
      break;
    case "brand":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.name), category: clean(row.venue_category, 80), area: clean(row.city, 120),
        upcomingPublicOfferingCount: assembled.upcomingCount > 0 ? assembled.upcomingCount : undefined,
        description: clean(row.description, 600), route: { brandSlug: clean(row.slug, 160) } });
      destination = { kind, brandSlug: clean(row.slug, 160), webPath: `/b/${clean(row.slug, 160)}` };
      break;
  }

  if (!facts.title) throw new Error("not_found");
  const mediaIdentity = mapServedMediaIdentity(row);
  if (mediaIdentity) facts.media = mediaIdentity;
  const publicDetails = publicDetailsFor(kind, row, assembled);
  return { facts, destinationManifest: { ...destination, publicDetails }, publicDetails, mediaIdentity };
}

const eventTypeFor = (kind: ContentShareKind): string | null => ({
  event: "event", rsvp_event: "rsvp", trip: "trip", experience: "experience",
} as Record<string, string>)[kind] || null;

const relevantDatesAt = (dates: RecordLike[], nowMs = Date.now()): RecordLike[] => {
  const valid = dates.filter((date) => typeof date?.start_at === "string" && Number.isFinite(Date.parse(date.start_at)))
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const future = valid.filter((date) => Date.parse(typeof date.end_at === "string" ? date.end_at : date.start_at) >= nowMs);
  return future.length ? future : valid.slice(-1);
};

export const ticketTruthAt = (tickets: RecordLike[], remainingRows: RecordLike[], nowMs = Date.now()) => {
  const remaining = new Map(remainingRows.map((row) => [String(row.ticket_type_id), row.remaining]));
  const authored = tickets.filter((ticket) => ticket.is_hidden !== true && ticket.is_disabled !== true && ticket.available_online !== false);
  const onSale = authored.filter((ticket) => {
    const starts = typeof ticket.sale_start_at === "string" ? Date.parse(ticket.sale_start_at) : NaN;
    const ends = typeof ticket.sale_end_at === "string" ? Date.parse(ticket.sale_end_at) : NaN;
    return (!Number.isFinite(starts) || starts <= nowMs) && (!Number.isFinite(ends) || ends > nowMs);
  });
  const finiteRemaining = (ticket: RecordLike): number | null => {
    if (ticket.is_unlimited === true) return null;
    const value = remaining.get(String(ticket.id));
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  };
  // Unknown remaining capacity must fail open for purchase eligibility. It may
  // never be converted into either a false sold-out state or a finite claim.
  const eligibleTickets = onSale.filter((ticket) => finiteRemaining(ticket) !== 0);
  const eligibleRemaining = eligibleTickets.map(finiteRemaining);
  const finiteAvailability = eligibleRemaining.length > 0 && eligibleRemaining.every((value) => value !== null)
    ? (eligibleRemaining as number[]).reduce((sum, value) => sum + value, 0) : null;
  return {
    eligibleTickets,
    soldOut: onSale.length > 0 && onSale.every((ticket) => finiteRemaining(ticket) === 0),
    availability: finiteAvailability !== null ? `${finiteAvailability} left` : undefined,
  };
};

export async function loadAuthoritativeContentShare(
  db: QueryClient, userId: string, kind: ContentShareKind, identity: RecordLike,
) {
  if (kind === "place") {
    const poolId = sourceId(identity, "placePoolId");
    const googleId = sourceId(identity, "googlePlaceId");
    if (!poolId && !googleId) throw new Error("validation");
    let query = db.from("place_pool").select(PLACE_POOL_SHARE_SELECT).limit(1);
    query = poolId ? query.eq("id", poolId) : query.eq("google_place_id", googleId);
    const { data: row, error } = await query.maybeSingle();
    if (error) throw new Error("db_error");
    if (!row) throw new Error("gone");
    if (row.is_active !== true || row.is_servable === false) throw new Error("not_public");
    return { ...mapAuthoritativeShareFacts(kind, { row }), sourceKey: `place:${row.id}`, sourceReference: { placePoolId: row.id } };
  }

  if (kind === "curated") {
    const stopPlaceIds = curatedCompositionIds(identity);
    if (stopPlaceIds) {
      const { data, error } = await db.from("place_pool").select(PLACE_POOL_SHARE_SELECT).in("google_place_id", stopPlaceIds);
      if (error) throw new Error("db_error");
      const rows = Array.isArray(data) ? data : [];
      const rowsByGoogleId = new Map<string, RecordLike>();
      for (const row of rows) {
        const googlePlaceId = clean(row?.google_place_id, 256);
        if (!googlePlaceId || rowsByGoogleId.has(googlePlaceId)) throw new Error("gone");
        rowsByGoogleId.set(googlePlaceId, row);
      }
      const orderedRows = stopPlaceIds.map((googlePlaceId) => rowsByGoogleId.get(googlePlaceId));
      if (orderedRows.some((row) => !row)) throw new Error("gone");
      if (orderedRows.some((row) => row?.is_active !== true || row?.is_servable !== true)) throw new Error("not_public");
      const canonicalIds = JSON.stringify(stopPlaceIds);
      return {
        ...mapCuratedComposition(orderedRows as RecordLike[]),
        sourceKey: `curated-composition:${await sha256Hex(canonicalIds)}`,
        sourceReference: { stopPlaceIds },
      };
    }

    const id = sourceId(identity, "savedCardId");
    const legacyKeys = Object.keys(identity);
    const legacyKeysAreReadCompatible = legacyKeys.every((key) => ["savedCardId", "placePoolId", "googlePlaceId"].includes(key));
    if (!legacyKeysAreReadCompatible || !id || identity.savedCardId !== id) throw new Error("validation");
    const { data: row, error } = await db.from("saved_card").select("id,profile_id,title,category,image_url,card_data").eq("id", id).eq("profile_id", userId).maybeSingle();
    if (error) throw new Error("db_error");
    if (!row) throw new Error("gone");
    return { ...mapAuthoritativeShareFacts(kind, { row }), sourceKey: `curated:${row.id}`, sourceReference: { savedCardId: row.id } };
  }

  const expectedType = eventTypeFor(kind);
  if (expectedType) {
    const id = sourceId(identity, "eventId");
    const eventSlug = sourceId(identity, "eventSlug");
    const brandSlug = sourceId(identity, "brandSlug");
    if (!id && (!eventSlug || !brandSlug)) throw new Error("validation");
    let query = db.from("events").select("id,title,description,slug,location_text,status,visibility,published_at,deleted_at,timezone,event_type,destination_text,cover_media_url,cover_media_type,cover_media_poster_url,cover_media_alt,cover_media_gallery,is_multi_date,rsvp_capacity,rsvp_waitlist_enabled,rsvp_approval_mode,bookings_closed,booking_deadline,brands!inner(name,slug,deleted_at)")
      .eq("event_type", expectedType).limit(1);
    query = id ? query.eq("id", id) : query.eq("slug", eventSlug).eq("brands.slug", brandSlug);
    const { data: row, error: rowError } = await query.maybeSingle();
    if (rowError) throw new Error("db_error");
    if (!row || row.deleted_at || (Array.isArray(row.brands) ? row.brands[0]?.deleted_at : row.brands?.deleted_at)) throw new Error("gone");
    if (!["public", "discover"].includes(row.visibility) || !row.published_at || !["scheduled", "live", "ended", "cancelled"].includes(row.status)) throw new Error("not_public");
    const [datesResult, ticketsResult, remainingResult, allInResult, rsvpResult] = await Promise.all([
      db.from("event_dates").select("start_at,end_at,timezone,is_master").eq("event_id", row.id).order("start_at", { ascending: true }),
      db.from("ticket_types").select("id,price_cents,currency,is_free,is_hidden,is_disabled,available_online,is_unlimited,sale_start_at,sale_end_at,display_order").eq("event_id", row.id).is("deleted_at", null).order("display_order", { ascending: true }),
      db.rpc("pg_public_ticket_types_remaining", { p_event_id: row.id }),
      db.rpc("pg_public_event_tier_allin", { p_event_id: row.id }),
      expectedType === "rsvp"
        ? db.from("event_rsvps").select("id,plus_count").eq("event_id", row.id).eq("rsvp_status", "going").eq("approval_status", "approved")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (datesResult.error || ticketsResult.error || remainingResult.error || allInResult.error || rsvpResult.error) throw new Error("db_error");
    const dates = datesResult.data || [];
    const allInById=new Map<string,RecordLike>((allInResult.data||[]).map((item:RecordLike)=>[String(item.ticket_type_id),item] as [string,RecordLike]));
    const tickets = (ticketsResult.data || []).map((ticket:RecordLike)=>{
      const canonical=allInById.get(String(ticket.id));
      const canonicalAllIn=canonical?.all_in_cents;
      return {...ticket,
        all_in_cents:Number.isSafeInteger(canonicalAllIn)&&Number(canonicalAllIn)>=0?canonicalAllIn:undefined,
        display_currency:/^[A-Za-z]{3}$/.test(clean(canonical?.currency,3))?clean(canonical?.currency,3):undefined};
    });
    const relevantDates = relevantDatesAt(dates); const firstDate = relevantDates[0]; const lastDate = relevantDates[relevantDates.length - 1];
    const firstSchedule = localSchedule(firstDate?.start_at, row.timezone || firstDate?.timezone);
    const lastSchedule = localSchedule(lastDate?.start_at, row.timezone || lastDate?.timezone);
    const ticketTruth = ticketTruthAt(tickets, remainingResult.data || []);
    const rsvpGoing = (rsvpResult.data || []).reduce((sum: number, item: RecordLike) => sum + 1 + (Number.isInteger(item.plus_count) ? item.plus_count : 0), 0);
    const rsvpFull = expectedType === "rsvp" && Number.isInteger(row.rsvp_capacity) && rsvpGoing >= row.rsvp_capacity;
    const assembled = { row, date: firstDate, tickets, relevantDates, ...ticketTruth,
      rsvpClosed: rsvpFull && row.rsvp_waitlist_enabled !== true && row.rsvp_approval_mode !== "manual",
      availability: expectedType === "rsvp" && rsvpFull && row.rsvp_waitlist_enabled === true ? "Waitlist available" : ticketTruth.availability,
      actionEligible: Boolean(firstDate) && !(expectedType === "trip" && (row.bookings_closed === true
        || (typeof row.booking_deadline === "string" && Date.parse(row.booking_deadline) <= Date.now()))) && (expectedType === "rsvp"
        ? !(rsvpFull && row.rsvp_waitlist_enabled !== true && row.rsvp_approval_mode !== "manual")
        : ticketTruth.eligibleTickets.length > 0),
      dateRange: [firstSchedule.localDate, lastSchedule.localDate !== firstSchedule.localDate ? lastSchedule.localDate : ""].filter(Boolean).join(" – "),
      duration: durationLabel(firstDate?.start_at, firstDate?.end_at) };
    return { ...mapAuthoritativeShareFacts(kind, assembled), sourceKey: `${kind}:${row.id}`, sourceReference: { eventId: row.id } };
  }

  if (kind === "venue") {
    const venueId = sourceId(identity, "venueId"); const brandSlug = sourceId(identity, "brandSlug"); const venueSlug = sourceId(identity, "venueSlug");
    if (!venueId && (!brandSlug || !venueSlug)) throw new Error("validation");
    let query = db.from("venue_public_view").select("id,brand_slug,slug,name,city,venue_category,pitch,cover_media_url,cover_media_type,cover_media_poster_url,pool_photo_urls,hours,iana_timezone");
    query = venueId ? query.eq("id", venueId) : query.eq("brand_slug", brandSlug).eq("slug", venueSlug);
    const { data: row, error } = await query.maybeSingle();
    if (error) throw new Error("db_error");
    if (!row) throw new Error("not_public");
    return { ...mapAuthoritativeShareFacts(kind, { row }), sourceKey: `venue:${row.id}`, sourceReference: { venueId: row.id, brandSlug: row.brand_slug, venueSlug: row.slug } };
  }

  const brandId = sourceId(identity, "brandId"); const brandSlug = sourceId(identity, "brandSlug");
  if (!brandId && !brandSlug) throw new Error("validation");
  let brandQuery = db.from("brands").select("id,name,slug,description,cover_media_url,cover_media_type,cover_media_poster_url,profile_photo_url,venue_category,city,deleted_at");
  brandQuery = brandId ? brandQuery.eq("id", brandId) : brandQuery.eq("slug", brandSlug);
  const { data: row, error: rowError } = await brandQuery.maybeSingle();
  if (rowError) throw new Error("db_error");
  if (!row || row.deleted_at) throw new Error("gone");
  const { data: offerings, error: offeringsError } = await db.from("business_public_events_view").select("title,event_type,brand_slug,slug,master_start_at").eq("brand_slug", row.slug).gte("master_start_at", new Date().toISOString()).order("master_start_at", { ascending: true }).limit(8);
  if (offeringsError) throw new Error("db_error");
  const { count, error: countError } = await db.from("events").select("id", { count: "exact", head: true }).eq("brand_id", row.id)
    .in("visibility", ["public", "discover"]).not("published_at", "is", null).is("deleted_at", null).in("status", ["scheduled", "live"]);
  if (countError) throw new Error("db_error");
  return { ...mapAuthoritativeShareFacts("brand", { row, upcomingCount: count || 0, offerings: offerings || [] }), sourceKey: `brand:${row.id}`, sourceReference: { brandId: row.id, brandSlug: row.slug } };
}
