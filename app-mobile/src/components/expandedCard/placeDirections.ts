/**
 * #4347 wave 2 — THE ONE directions helper for the expanded sheet.
 *
 * Every "Directions" on the sheet (the pinned bar's main button, the Details
 * address row, a stroll / picnic stop, a night-out venue) goes through here,
 * so the coming change has exactly one place to land.
 *
 * It anchors on COORDINATES when the card has them (the address text is only
 * the label), through the app's maps owner `openMapsTarget`, which builds the
 * link with the shared Maps target `packages/offering-rendering/mapsDeepLink.ts`
 * (#4334). The card's Google place id rides along: the Google link then carries
 * `query_place_id`, so Google Maps names the venue on the pin. A missing or
 * unusable id leaves the link exactly as before (coordinates, then the label).
 */
import { Linking } from 'react-native';
import {
  normalizeGooglePlaceId,
  normalizeMapsGeo,
} from '@mingla/offering-rendering/mapsDeepLink';
import { openMapsTarget } from '../../utils/openMapsTarget';

export interface DirectionsTarget {
  readonly lat?: number | null;
  readonly lng?: number | null;
  readonly label?: string | null;
  readonly googlePlaceId?: string | null;
}

export interface DirectionsOptions {
  readonly onUnavailable?: (() => void) | null;
  readonly preflight?: boolean;
}

/**
 * A Google place id the Maps target may carry, or null. On top of
 * mapsDeepLink's own check, a UUID is refused: some stop producers fall back to
 * the place pool's own row id (`google_place_id ?? place_id`), which is not a
 * Google id and must never reach Google as `query_place_id`.
 */
export function directionsPlaceId(id: string | null | undefined): string | null {
  const normalized = normalizeGooglePlaceId(id);
  if (normalized === null) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized) ? null : normalized;
}

/** The target the maps owner receives. Pure, for tests. */
export function directionsTarget(target: DirectionsTarget): {
  label: string | null;
  geo: { lat: number; lng: number } | null;
  googlePlaceId?: string;
} {
  const lat = target.lat;
  const lng = target.lng;
  const geo =
    typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)
      ? { lat, lng }
      : null;
  const label = typeof target.label === 'string' && target.label.trim().length > 0 ? target.label.trim() : null;
  const googlePlaceId = directionsPlaceId(target.googlePlaceId);
  // The key is present only with a usable id, so a target without one is
  // exactly the pre-#4334 { label, geo }.
  return googlePlaceId === null ? { label, geo } : { label, geo, googlePlaceId };
}

export function openPlaceDirections(target: DirectionsTarget, options: DirectionsOptions = {}): void {
  openMapsTarget(directionsTarget(target), {
    preflight: options.preflight === true,
    onUnavailable: options.onUnavailable ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// #4347 wave 3 — "Route all stops"
// ─────────────────────────────────────────────────────────────────────────────

export type RouteTravelMode = 'driving' | 'walking' | 'transit' | 'bicycling';

/**
 * "Route all stops": ONE Google Maps directions link with every stop in order —
 * the last stop is the destination, the others are waypoints, and the origin is
 * left out so Google starts from wherever the phone is.
 *
 * The SAME https universal link on every platform (#4347 wave 3 follow-up).
 * On iPhone it opens in the Google Maps app when it is installed and in the
 * browser otherwise — no canOpenURL check and no LSApplicationQueriesSchemes
 * entry, so no native change. (Before, iPhone opened only the next stop in
 * Apple Maps, which cannot take several stops in one link.)
 *
 * Each stop is anchored on its coordinates; a stop without them falls back to
 * its label. Every token is URL-encoded and the waypoints are joined by an
 * encoded "|". Null when no stop can be placed at all.
 *
 * The shared Maps target (`packages/offering-rendering/mapsDeepLink.ts`, #4334)
 * has no multi-stop builder, so this one stays here, held to its rules: the
 * same `https://www.google.com/maps/...?api=1` form, its coordinate check
 * (`normalizeMapsGeo`: out-of-range and 0,0 fall back to the label) and its
 * Google place id check. With place ids, the destination carries
 * `destination_place_id`, and the waypoints carry `waypoint_place_ids` only
 * when EVERY waypoint has one (Google pairs the two lists by position).
 */
export type RouteAllStopsAction = { readonly kind: 'route'; readonly url: string };

/**
 * Google Maps URLs accept at most 9 waypoints (the app and desktop; a mobile
 * browser honours fewer). A longer plan keeps its FIRST 9 intermediate stops
 * plus the final stop as the destination; the stops past the limit are left
 * out of the link rather than making Google reject or silently mangle it.
 */
export const GOOGLE_MAPS_MAX_WAYPOINTS = 9;

/** A plan's stops as route targets: coordinates first, then the name, then the address. */
export function planRouteTargets(
  stops: ReadonlyArray<{
    readonly lat?: number | null;
    readonly lng?: number | null;
    readonly placeName?: string | null;
    readonly address?: string | null;
    readonly placeId?: string | null;
  }>,
): DirectionsTarget[] {
  return stops.map((stop) => ({
    lat: stop.lat,
    lng: stop.lng,
    label: stop.placeName || stop.address || null,
    googlePlaceId: stop.placeId || null,
  }));
}

/** The most stops one route link can open: the waypoints plus the destination. */
export const ROUTE_MAX_STOPS = GOOGLE_MAPS_MAX_WAYPOINTS + 1;

/**
 * How many stops the route link would carry, and how many the plan has, when
 * the cap applies (null when every stop fits). The sheet shows "Opens 10 of N
 * stops" from this, so a long plan never loses stops silently.
 *
 * Every stop the plan lists counts, optional and shop stops included, in plan
 * order: they are part of the plan the person is looking at, so the route
 * follows it rather than a filtered version of it.
 */
export function routeCap(stops: readonly DirectionsTarget[]): { readonly opened: number; readonly total: number } | null {
  const total = stops.map(stopToken).filter((t) => t !== null).length;
  return total > ROUTE_MAX_STOPS ? { opened: ROUTE_MAX_STOPS, total } : null;
}

function stopToken(target: DirectionsTarget): string | null {
  const { geo, label } = directionsTarget(target);
  const anchored = normalizeMapsGeo(geo);
  if (anchored !== null) return `${anchored.lat},${anchored.lng}`;
  return label === null ? null : label;
}

// Every stop in plan order, optional and shop stops included (see routeCap).
export function routeAllStopsUrl(stops: readonly DirectionsTarget[], mode: RouteTravelMode = 'driving'): string | null {
  const placed = stops
    .map((stop) => ({ token: stopToken(stop), placeId: directionsPlaceId(stop.googlePlaceId) }))
    .filter((s): s is { token: string; placeId: string | null } => s.token !== null);
  if (placed.length === 0) return null;
  const destination = placed[placed.length - 1];
  // Truncated to Google's limit — see GOOGLE_MAPS_MAX_WAYPOINTS.
  const waypoints = placed.slice(0, -1).slice(0, GOOGLE_MAPS_MAX_WAYPOINTS);
  const params = [`api=1`, `destination=${encodeURIComponent(destination.token)}`];
  if (destination.placeId !== null) params.push(`destination_place_id=${encodeURIComponent(destination.placeId)}`);
  if (waypoints.length > 0) {
    params.push(`waypoints=${waypoints.map((w) => encodeURIComponent(w.token)).join('%7C')}`);
    if (waypoints.every((w) => w.placeId !== null)) {
      params.push(`waypoint_place_ids=${waypoints.map((w) => encodeURIComponent(w.placeId as string)).join('%7C')}`);
    }
  }
  params.push(`travelmode=${mode}`);
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

export function routeAllStopsAction(
  stops: readonly DirectionsTarget[],
  mode: RouteTravelMode = 'driving',
): RouteAllStopsAction | null {
  const url = routeAllStopsUrl(stops, mode);
  return url === null ? null : { kind: 'route', url };
}

/** Run "Route all stops": opens the full route link on every platform. */
export function openRouteAllStops(
  stops: readonly DirectionsTarget[],
  options: { mode?: RouteTravelMode; onUnavailable?: (() => void) | null } = {},
): void {
  const action = routeAllStopsAction(stops, options.mode ?? 'driving');
  if (action === null) {
    options.onUnavailable?.();
    return;
  }
  void Linking.openURL(action.url).catch(() => options.onUnavailable?.());
}
