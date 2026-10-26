import { PARTY_TYPE_SLUGS, VIBE_TAG_SLUGS, MUSIC_GENRE_SLUGS, isSubsetOf, mapMinglaMusicGenresToTmSlugs } from "../_shared/eventTaxonomy.ts";
import { resolveTmClassification } from "../_shared/ticketmasterClassifications.ts";
import { discoverCurrency } from "../_shared/discoverCurrency.ts";
import { discoverPriceBandCatalog, discoverPriceBands, type DiscoverPriceBandSpec } from "../_shared/discoverPriceBands.ts";
import { buildDiscoverV2Key } from "./_v2_key.ts";
import { DISCOVER_KINDS, type DiscoverV2Request } from "./_v2_types.ts";
import { collapseTicketmasterOccurrences, resolveTicketmasterPool, ticketmasterWindowIsCapped, type TicketmasterPool } from "./_v2_tm_pool.ts";

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  from: (table: string) => any;
};
type ErrorResponse = (body: unknown, status?: number, extra?: Record<string, string>) => Response;

const ALLOWED_FILTERS: Record<string, readonly string[]> = {
  events: ["when", "price", "partyTypes", "vibeTags", "musicGenres"],
  experiences: ["when", "goodFor", "price"],
  trips: ["destination", "leavingFrom", "when"],
  stays: ["checkIn", "guests", "propertyKinds"],
};

function invalid(request: DiscoverV2Request, bands: DiscoverPriceBandSpec | null): string | null {
  const { anchor, filters } = request;
  if ((!anchor.name?.trim() && !Number.isFinite(anchor.lat)) || !Number.isFinite(anchor.lng) || !(anchor.radiusKm > 0)) return "city_required";
  if (!DISCOVER_KINDS.includes(filters.kind)) return "invalid_kind";
  const extra = Object.keys(filters.f).find((key) => !ALLOWED_FILTERS[filters.kind].includes(key));
  if (extra) return `invalid_filter:${extra}`;
  if (filters.kind === "stays" && filters.f.guests !== undefined && (!Number.isInteger(filters.f.guests) || filters.f.guests < 1 || filters.f.guests > 8)) return "guests_out_of_range";
  if (filters.kind === "events") {
    if (filters.f.partyTypes && !isSubsetOf(filters.f.partyTypes, PARTY_TYPE_SLUGS as readonly string[])) return "party_type_slugs_not_canonical";
    if (filters.f.vibeTags && !isSubsetOf(filters.f.vibeTags, VIBE_TAG_SLUGS as readonly string[])) return "vibe_tag_slugs_not_canonical";
    if (filters.f.musicGenres && !isSubsetOf(filters.f.musicGenres, MUSIC_GENRE_SLUGS as readonly string[])) return "music_genre_slugs_not_canonical";
  }
  const prices = "price" in filters.f && Array.isArray(filters.f.price) ? filters.f.price : [];
  const maxBand = bands ? bands.edgesMinor.length + 1 : 0;
  if (prices.some((id) => /^band_(\d+)$/.test(id) && Number(id.slice(5)) > maxBand)) return "invalid_filter:price";
  return null;
}

function rangeBounds(value: unknown): { start: string; end: string } | null {
  const match = typeof value === "string" ? value.match(/^[[(]"?([^",]+)"?,"?([^"\])]+)"?[\])]$/) : null;
  return match ? { start: match[1], end: match[2] } : null;
}

function localWall(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

interface TmWindow { localStartEndDateTime: string; endUtc: string }

async function tmWindow(client: RpcClient, timezone: string, when: string): Promise<TmWindow | null> {
  const { data, error } = await client.rpc("discover_v2_window", { p_when: when, p_tz: timezone, p_now: new Date().toISOString() });
  if (error) return null;
  const range = rangeBounds(data);
  return range ? { localStartEndDateTime: `${localWall(range.start, timezone)},${localWall(range.end, timezone)}`, endUtc: range.end } : null;
}

function priceOption(item: TicketmasterPool["items"][number]): string | null {
  if (item.priceMin === null || !item.priceCurrency) return null;
  if (item.priceMin === 0) return "free_ticket";
  const bands = discoverPriceBands("events", item.priceCurrency);
  if (!bands) return null;
  const minor = Math.round(item.priceMin * 100);
  const index = bands.edgesMinor.findIndex((edge) => minor < edge);
  return `band_${index === -1 ? bands.edgesMinor.length + 1 : index + 1}`;
}

function localDateParts(timezone: string, date = new Date()): { iso: string; isoWeekday: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(read("weekday")) + 1;
  return { iso: `${read("year")}-${read("month")}-${read("day")}`, isoWeekday: weekday, time: `${read("hour")}:${read("minute")}:${read("second")}` };
}

function addUtcDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function tmDateMatches(
  localDate: string,
  localTime: string | null,
  when: "tomorrow" | "weekend" | undefined,
  timezone: string,
  now = new Date(),
): boolean {
  if (!when) return true;
  const today = localDateParts(timezone, now);
  if (when === "tomorrow") return localDate === addUtcDays(today.iso, 1);
  const fridayOffset = today.isoWeekday === 6 ? -1 : today.isoWeekday === 7 ? -2 : (5 - today.isoWeekday + 7) % 7;
  const friday = addUtcDays(today.iso, fridayOffset);
  const weekendStarted = today.isoWeekday > 5 || (today.isoWeekday === 5 && today.time >= "18:00:00");
  const start = weekendStarted ? `${today.iso}T${today.time}` : `${friday}T18:00:00`;
  const end = `${addUtcDays(friday, 3)}T00:00:00`;
  const eventStart = `${localDate}T${localTime ?? "00:00:00"}`;
  return eventStart >= start && eventStart < end;
}

export function filterTm(pool: TicketmasterPool, request: DiscoverV2Request, timezone: string, now = new Date()): TicketmasterPool["items"] {
  if (request.filters.kind !== "events") return [];
  const filters = request.filters.f;
  if ((filters.partyTypes?.length ?? 0) > 0 || (filters.vibeTags?.length ?? 0) > 0) return [];
  let allowedGenreIds: Set<string> | null = null;
  if ((filters.musicGenres?.length ?? 0) > 0) {
    const mapped = mapMinglaMusicGenresToTmSlugs(filters.musicGenres ?? []);
    if (mapped.tmMappable.length === 0) return [];
    const resolved = resolveTmClassification("music", mapped.tmMappable);
    allowedGenreIds = new Set([...resolved.genreIds, ...resolved.subGenreIds]);
    if (allowedGenreIds.size === 0) return [];
  }
  return pool.items.filter((item) => {
    if (!tmDateMatches(item.localDate, item.localTime, filters.when, timezone, now)) return false;
    if (allowedGenreIds && !allowedGenreIds.has(item.genreId ?? "") && !allowedGenreIds.has(item.subGenreId ?? "")) return false;
    if ((filters.price?.length ?? 0) > 0 && !filters.price?.includes(priceOption(item) ?? "")) return false;
    return true;
  });
}

const EVENT_GROUP_KEY: Record<string, string> = {
  when: "when", price: "price", partyType: "partyTypes", vibe: "vibeTags", music: "musicGenres",
};

function requestWithEventOption(request: DiscoverV2Request, groupId: string, optionId: string): DiscoverV2Request {
  if (request.filters.kind !== "events") return request;
  const key = EVENT_GROUP_KEY[groupId];
  if (!key) return request;
  const f = { ...request.filters.f } as Record<string, unknown>;
  delete f[key];
  f[key] = groupId === "when" ? optionId : [optionId];
  return { ...request, filters: { kind: "events", f } as DiscoverV2Request["filters"] };
}

function tmFacetCandidates(pool: TicketmasterPool, bands: DiscoverPriceBandSpec | null): Record<string, string[]> {
  const prices = new Set<string>();
  for (const item of pool.items) {
    const option = priceOption(item);
    if (option) prices.add(option);
  }
  if (bands) for (let index = 1; index <= bands.edgesMinor.length + 1; index += 1) prices.add(`band_${index}`);
  return {
    when: ["tomorrow", "weekend"],
    price: [...prices],
    music: [...MUSIC_GENRE_SLUGS],
  };
}

function mergeTmFacetCounts(
  rawGroups: unknown,
  pool: TicketmasterPool,
  request: DiscoverV2Request,
  timezone: string,
  bands: DiscoverPriceBandSpec | null,
): unknown[] {
  if (request.filters.kind !== "events") return Array.isArray(rawGroups) ? rawGroups : [];
  const groups = (Array.isArray(rawGroups) ? rawGroups : []).map((group) => ({ ...(group as Record<string, unknown>) }));
  const candidates = tmFacetCandidates(pool, bands);
  for (const [groupId, ids] of Object.entries(candidates)) {
    let group = groups.find((candidate) => candidate.id === groupId);
    const options = new Map<string, Record<string, unknown>>(
      (Array.isArray(group?.options) ? group.options : []).map((option) => {
        const row = option as Record<string, unknown>;
        return [String(row.id), { ...row }];
      }),
    );
    for (const id of ids) {
      const baselineRequest = { ...request, filters: { kind: "events", f: {} } as DiscoverV2Request["filters"] };
      const possible = collapseTicketmasterOccurrences(
        filterTm(pool, requestWithEventOption(baselineRequest, groupId, id), timezone),
      ).length;
      if (possible === 0 && !options.has(id)) continue;
      const tmCount = collapseTicketmasterOccurrences(
        filterTm(pool, requestWithEventOption(request, groupId, id), timezone),
      ).length;
      const current = options.get(id) ?? { id, count: 0 };
      options.set(id, { ...current, count: Number(current.count ?? 0) + tmCount });
    }
    if (options.size === 0) continue;
    if (!group) {
      group = { id: groupId, multi: groupId !== "when", options: [] };
      groups.push(group);
    }
    group.options = [...options.values()];
  }
  return groups;
}

export function encodeCursor(value: { m: number; t: number; k: string }): string {
  return btoa(JSON.stringify({ v: 2, ...value })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCursor(value: string | null | undefined, key: string): { m: number; t: number } | null {
  if (!value) return { m: 0, t: 0 };
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    return parsed?.v === 2 && parsed.k === key && Number.isSafeInteger(parsed.m) && Number.isSafeInteger(parsed.t) ? { m: parsed.m, t: parsed.t } : null;
  } catch { return null; }
}

function tmCard(item: TicketmasterPool["items"][number]) {
  return { source: "ticketmaster", kind: "event", id: item.id, title: item.eventName, venueName: item.venueName, imageUrl: item.image, startsLocalDate: item.localDate, startsLocalTime: item.localTime, genre: item.genre, price: item.priceCurrency ? { currency: item.priceCurrency, minMajor: item.priceMin, maxMajor: item.priceMax } : null, ticketStatus: item.ticketStatus, ticketUrl: item.ticketUrl, raw: item };
}

export function shouldLoadTicketmaster(request: Pick<DiscoverV2Request, "op" | "filters">): boolean {
  return request.op === "facets" || request.filters.kind === "events";
}

export async function handleDiscoverV2(request: DiscoverV2Request, client: RpcClient, jsonError: ErrorResponse): Promise<Response> {
  const requestedSize = request.size ?? 20;
  if (!Number.isInteger(requestedSize) || requestedSize < 1 || requestedSize > 50) return jsonError({ error: "invalid_page_size" }, 400);
  const cityNames = request.anchor.name?.trim() ? [request.anchor.name.trim()] : [];
  const { data: contextData, error: contextError } = await client.rpc("discover_v2_city_context", { p_city_names: cityNames, p_lat: request.anchor.lat, p_lng: request.anchor.lng, p_radius_km: request.anchor.radiusKm, p_device_tz: request.deviceTz ?? "UTC" });
  if (contextError) return jsonError({ error: "db_error", detail: contextError.message }, 500);
  const context = (contextData ?? {}) as Record<string, unknown>;
  const timezone = typeof context.tz === "string" ? context.tz : (request.deviceTz ?? "UTC");
  const currency = discoverCurrency(request.anchor.countryCode, typeof context.majorityCurrency === "string" ? context.majorityCurrency : null);
  const bands = request.filters.kind === "events" || request.filters.kind === "experiences" ? discoverPriceBands(request.filters.kind, currency) : null;
  const validationError = invalid(request, bands);
  if (validationError) return jsonError({ error: validationError }, 400);
  const { data: generationData, error: generationError } = await client.rpc("issue_2009_event_discovery_generation");
  const generation = generationError ? `unavailable:${crypto.randomUUID()}` : String(generationData ?? "0");
  const key = buildDiscoverV2Key(request, generation, timezone, currency);
  const horizonWindow = shouldLoadTicketmaster(request) ? await tmWindow(client, timezone, "tm_horizon_120") : null;
  const selectedWindow = request.filters.kind === "events" && request.filters.f.when
    ? await tmWindow(client, timezone, request.filters.f.when)
    : horizonWindow;
  const tmPool = horizonWindow
    ? await resolveTicketmasterPool(client, { anchor: request.anchor, localStartEndDateTime: horizonWindow.localStartEndDateTime, timezone })
    : { items: [], poolCoverageEnd: null, capped: false, partial: false, error: null, fromCache: false };
  // Filter occurrences first so a later performance that matches Tomorrow or
  // Weekend is not hidden by an earlier performance outside the selected window.
  const selectedTm = collapseTicketmasterOccurrences(filterTm(tmPool, request, timezone));
  const sqlFilters = {
    ...request.filters.f,
    _countryCode: request.anchor.countryCode?.toUpperCase() ?? null,
    _priceCatalog: request.filters.kind === "events" || request.filters.kind === "experiences"
      ? { [request.filters.kind]: discoverPriceBandCatalog(request.filters.kind) }
      : {},
  };
  const shared = { p_city_names: cityNames, p_lat: request.anchor.lat, p_lng: request.anchor.lng, p_radius_km: request.anchor.radiusKm, p_tz: timezone, p_kind: request.filters.kind, p_filters: sqlFilters };

  if (request.op === "facets") {
    const { data, error } = await client.rpc("discover_v2_facets", { ...shared, p_currency: currency });
    if (error) return jsonError({ error: "db_error", detail: error.message }, 500);
    const result = (data ?? {}) as Record<string, unknown>;
    const kinds = (result.kinds ?? {}) as Record<string, { total?: number; available?: boolean }>;
    const tmTotal = request.filters.kind === "events" ? selectedTm.length : 0;
    const eventTotal = Number(kinds.events?.total ?? 0) + collapseTicketmasterOccurrences(tmPool.items).length;
    kinds.events = { total: eventTotal, available: eventTotal > 0 };
    const selected = (result.selected ?? {}) as Record<string, unknown>;
    const minglaTotal = Number(selected.minglaTotal ?? selected.total ?? 0);
    const groups = mergeTmFacetCounts(result.groups, tmPool, request, timezone, bands);
    const selectedCapped = request.filters.kind === "events" && selectedWindow
      ? ticketmasterWindowIsCapped(tmPool, selectedWindow.endUtc)
      : false;
    return jsonError({ ...result, contract: 2, city: { key: result.cityKey ?? "", tz: timezone, tzSource: context.tzSource === "supply" ? "supply" : "device", currency, label: request.anchor.name }, kinds, selected: { ...selected, kind: request.filters.kind, minglaTotal, total: minglaTotal + tmTotal, tm: request.filters.kind === "events" ? { included: true, total: tmTotal, capped: selectedCapped, poolCoverageEnd: tmPool.poolCoverageEnd, error: tmPool.error } : null }, groups, priceBands: bands, generatedAt: new Date().toISOString() });
  }

  const cursor = decodeCursor(request.cursor, key);
  if (!cursor) return jsonError({ error: "invalid_cursor" }, 400);
  const { data, error } = await client.rpc("discover_v2_items", { ...shared, p_offset: cursor.m, p_limit: requestedSize });
  if (error) return jsonError({ error: "db_error", detail: error.message }, 500);
  const result = (data ?? {}) as Record<string, unknown>;
  const minglaItems = Array.isArray(result.items) ? result.items : (Array.isArray(data) ? data : []);
  const minglaTotal = Number(result.total ?? minglaItems.length);
  const remaining = requestedSize - minglaItems.length;
  const minglaExhausted = cursor.m + minglaItems.length >= minglaTotal;
  const tmItems = minglaExhausted && remaining > 0 ? selectedTm.slice(cursor.t, cursor.t + remaining).map(tmCard) : [];
  const nextM = cursor.m + minglaItems.length;
  const nextT = cursor.t + tmItems.length;
  const hasMore = nextM < minglaTotal || nextT < selectedTm.length;
  return jsonError({ contract: 2, items: [...minglaItems, ...tmItems], nextCursor: hasMore ? encodeCursor({ m: nextM, t: nextT, k: key }) : null, section: { minglaExhausted }, tmError: tmPool.error, fromCache: tmPool.fromCache });
}
