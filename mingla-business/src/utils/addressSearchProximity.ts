/**
 * Issue #3291 — where should Host address search RANK results from?
 *
 * The business picker never sent a location, so Mapbox ranked from the edge
 * server's own IP (the United States): typing "Lagos" surfaced a US restaurant
 * before Lagos, Nigeria. The edge `suggest` action already forwards an optional
 * `proximity` ("longitude,latitude") — this module decides the point.
 *
 * RANK-ONLY. Proximity reorders results; it never removes any. The request
 * still carries no `types` and no `country` (INV-3 / ORCH-1079,
 * `i-mapbox-suggest-no-types-filter.mjs`), so a Lagos host searching "London"
 * still gets London.
 *
 * Source order (first valid wins):
 *   1. the brand's saved location
 *   2. a location already picked on this draft
 *   3. an approximate point for the draft's time zone (device zone where the
 *      draft has none)
 *   4. nothing — Mapbox falls back to its default
 *
 * No fabricated data (Constitution #9): an unknown zone, or `UTC`, yields NO
 * point rather than a guess. The table below names each zone's own IANA city,
 * which is only ever used as a ranking hint and is never saved anywhere.
 *
 * BOOT PAYLOAD (ORCH-1083): this module is loaded ONLY through the dynamic
 * `import()` in `hooks/useAddressSearchProximity.ts`, so the table ships in its
 * own async web chunk instead of the eager `__common` chunk that every Host
 * screen shares. Hosts must never value-import it — `import type` only.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Any record carrying nullable lat/lng — a Brand, a draft, a stop. */
export type LatLngLike =
  | { lat?: number | null; lng?: number | null }
  | null
  | undefined;

export interface AddressSearchProximityInput {
  brandPoint?: LatLngLike;
  draftPoint?: LatLngLike;
  timeZone?: string | null;
}

/** What a Host address field hands the hook. */
export interface HostAddressProximitySources {
  /** The brand's saved location (a Brand record works as-is). */
  brandPoint?: LatLngLike;
  /**
   * A point already picked on this draft, or candidates in priority order
   * (first usable wins) — e.g. departure then destination, or every stop.
   */
  draftPoint?: LatLngLike | ReadonlyArray<LatLngLike>;
  /** The draft's IANA zone. Absent/blank → the device's zone. */
  timeZone?: string | null;
}

/** Per-field memory: the last usable draft point this field has seen. */
export interface ProximityMemory {
  lastDraftPoint: GeoPoint | null;
}

/** Real, in-range coordinates. (0,0) is the classic unset-row sentinel. */
export const isUsableGeoPoint = (point: LatLngLike): point is GeoPoint => {
  if (point === null || point === undefined) return false;
  const { lat, lng } = point;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
};

/** Builds a point from nullable lat/lng columns; null unless both are usable. */
export const geoPointFrom = (
  lat: number | null | undefined,
  lng: number | null | undefined,
): GeoPoint | null => {
  const candidate = { lat, lng };
  return isUsableGeoPoint(candidate)
    ? { lat: candidate.lat, lng: candidate.lng }
    : null;
};

/**
 * Each zone's own IANA city, as "zone|lat|lng" — compact because it ships in
 * the web bundle. Covers the curated picker list in `utils/timezones.ts` plus
 * common aliases. Rounded to 2 dp: this is a ranking hint, not a pin.
 */
const TIME_ZONE_POINTS: ReadonlyMap<string, GeoPoint> = new Map(
  [
    "Africa/Accra|5.6|-0.19",
    "Africa/Cairo|30.04|31.24",
    "Africa/Casablanca|33.57|-7.59",
    "Africa/Johannesburg|-26.2|28.05",
    "Africa/Lagos|6.45|3.4",
    "Africa/Nairobi|-1.29|36.82",
    "America/Anchorage|61.22|-149.9",
    "America/Argentina/Buenos_Aires|-34.6|-58.38",
    "America/Bogota|4.71|-74.07",
    "America/Caracas|10.49|-66.88",
    "America/Chicago|41.88|-87.63",
    "America/Denver|39.74|-104.99",
    "America/Halifax|44.65|-63.58",
    "America/Lima|-12.05|-77.04",
    "America/Los_Angeles|34.05|-118.24",
    "America/Mexico_City|19.43|-99.13",
    "America/New_York|40.71|-74.01",
    "America/Phoenix|33.45|-112.07",
    "America/Santiago|-33.45|-70.67",
    "America/Sao_Paulo|-23.55|-46.63",
    "America/St_Johns|47.56|-52.71",
    "America/Toronto|43.65|-79.38",
    "America/Vancouver|49.28|-123.12",
    "Asia/Bangkok|13.76|100.5",
    "Asia/Calcutta|22.57|88.36",
    "Asia/Dubai|25.2|55.27",
    "Asia/Hong_Kong|22.32|114.17",
    "Asia/Jakarta|-6.21|106.85",
    "Asia/Jerusalem|31.77|35.21",
    "Asia/Karachi|24.86|67.01",
    "Asia/Kolkata|22.57|88.36",
    "Asia/Manila|14.6|120.98",
    "Asia/Riyadh|24.71|46.68",
    "Asia/Seoul|37.57|126.98",
    "Asia/Shanghai|31.23|121.47",
    "Asia/Singapore|1.35|103.82",
    "Asia/Taipei|25.03|121.57",
    "Asia/Tehran|35.69|51.39",
    "Asia/Tokyo|35.68|139.69",
    "Atlantic/Azores|37.74|-25.67",
    "Atlantic/Cape_Verde|14.93|-23.51",
    "Atlantic/Reykjavik|64.15|-21.94",
    "Australia/Adelaide|-34.93|138.6",
    "Australia/Brisbane|-27.47|153.03",
    "Australia/Melbourne|-37.81|144.96",
    "Australia/Perth|-31.95|115.86",
    "Australia/Sydney|-33.87|151.21",
    "Europe/Amsterdam|52.37|4.9",
    "Europe/Athens|37.98|23.73",
    "Europe/Berlin|52.52|13.4",
    "Europe/Brussels|50.85|4.35",
    "Europe/Bucharest|44.43|26.1",
    "Europe/Budapest|47.5|19.04",
    "Europe/Copenhagen|55.68|12.57",
    "Europe/Dublin|53.35|-6.26",
    "Europe/Helsinki|60.17|24.94",
    "Europe/Istanbul|41.01|28.98",
    "Europe/Kiev|50.45|30.52",
    "Europe/Kyiv|50.45|30.52",
    "Europe/Lisbon|38.72|-9.14",
    "Europe/London|51.51|-0.13",
    "Europe/Madrid|40.42|-3.7",
    "Europe/Moscow|55.76|37.62",
    "Europe/Oslo|59.91|10.75",
    "Europe/Paris|48.86|2.35",
    "Europe/Prague|50.08|14.44",
    "Europe/Rome|41.9|12.5",
    "Europe/Stockholm|59.33|18.07",
    "Europe/Vienna|48.21|16.37",
    "Europe/Warsaw|52.23|21.01",
    "Europe/Zurich|47.38|8.54",
    "Pacific/Auckland|-36.85|174.76",
    "Pacific/Fiji|-18.14|178.44",
    "Pacific/Honolulu|21.31|-157.86",
  ].map((row): [string, GeoPoint] => {
    const [zone, lat, lng] = row.split("|");
    return [zone ?? "", { lat: Number(lat), lng: Number(lng) }];
  }),
);

/** Approximate point for an IANA zone, or null when the zone is not known. */
export const approximatePointForTimeZone = (
  timeZone: string | null | undefined,
): GeoPoint | null => {
  if (typeof timeZone !== "string") return null;
  const point = TIME_ZONE_POINTS.get(timeZone.trim());
  return point !== undefined && isUsableGeoPoint(point) ? point : null;
};

/** The device's IANA zone, or null when the runtime cannot say. */
export const deviceTimeZone = (): string | null => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
};

/** Mapbox proximity format: "longitude,latitude". */
export const formatProximity = (point: GeoPoint): string =>
  `${point.lng},${point.lat}`;

/**
 * The rank-only proximity string for Host address search, or undefined when no
 * source yields a usable point (the request then omits `proximity` entirely).
 */
export const resolveAddressSearchProximity = (
  input: AddressSearchProximityInput,
): string | undefined => {
  if (isUsableGeoPoint(input.brandPoint)) {
    return formatProximity(input.brandPoint);
  }
  if (isUsableGeoPoint(input.draftPoint)) {
    return formatProximity(input.draftPoint);
  }
  const zonePoint = approximatePointForTimeZone(input.timeZone);
  return zonePoint !== null ? formatProximity(zonePoint) : undefined;
};

/**
 * The hook's whole job, kept here so it rides the async chunk. Every keystroke
 * in a Host address field clears the draft's picked coordinates, so the
 * "draft point" would vanish on the first letter and ranking would jump to the
 * time-zone point mid-typing; `memory` remembers the last usable draft point
 * for the life of the field.
 */
export const resolveHostAddressProximity = (
  memory: ProximityMemory,
  sources: HostAddressProximitySources,
): string | undefined => {
  const candidates: ReadonlyArray<LatLngLike> = Array.isArray(sources.draftPoint)
    ? sources.draftPoint
    : [sources.draftPoint as LatLngLike];
  const found = candidates.find(isUsableGeoPoint);
  if (found !== undefined) {
    memory.lastDraftPoint = { lat: found.lat, lng: found.lng };
  }
  const zone =
    typeof sources.timeZone === "string" && sources.timeZone.trim().length > 0
      ? sources.timeZone
      : deviceTimeZone();
  return resolveAddressSearchProximity({
    brandPoint: sources.brandPoint,
    draftPoint: memory.lastDraftPoint,
    timeZone: zone,
  });
};
