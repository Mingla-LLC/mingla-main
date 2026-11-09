/**
 * #4347 wave 2 — THE ONE directions helper for the expanded sheet.
 *
 * Every "Directions" on the sheet (the pinned bar's main button, the Details
 * address row, a stroll / picnic stop, a night-out venue) goes through here,
 * so the coming change has exactly one place to land.
 *
 * Today it anchors on COORDINATES when the card has them (the address text is
 * only the label), through the app's existing maps owner `openMapsTarget`
 * (which builds the URL with @mingla/offering-rendering's builder).
 *
 * [TRANSITIONAL] `googlePlaceId` is accepted and not yet used — when #4334
 * lands, this helper routes through `packages/offering-rendering/mapsDeepLink.ts`
 * with the Google place id (agreed with the #4334 chat); no caller changes.
 */
import { Linking } from 'react-native';
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

/** The target the maps owner receives. Pure, for tests. */
export function directionsTarget(target: DirectionsTarget): { label: string | null; geo: { lat: number; lng: number } | null } {
  const lat = target.lat;
  const lng = target.lng;
  const geo =
    typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)
      ? { lat, lng }
      : null;
  const label = typeof target.label === 'string' && target.label.trim().length > 0 ? target.label.trim() : null;
  return { label, geo };
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
 * [TRANSITIONAL] when #4334 lands this routes through
 * `packages/offering-rendering/mapsDeepLink.ts` with each stop's Google place
 * id (`waypoint_place_ids` / `destination_place_id`); no caller changes.
 */
export type RouteAllStopsAction = { readonly kind: 'route'; readonly url: string };

/**
 * Google Maps URLs accept at most 9 waypoints (the app and desktop; a mobile
 * browser honours fewer). A longer plan keeps its FIRST 9 intermediate stops
 * plus the final stop as the destination; the stops past the limit are left
 * out of the link rather than making Google reject or silently mangle it.
 */
export const GOOGLE_MAPS_MAX_WAYPOINTS = 9;

function stopToken(target: DirectionsTarget): string | null {
  const { geo, label } = directionsTarget(target);
  if (geo !== null && !(geo.lat === 0 && geo.lng === 0)) return `${geo.lat},${geo.lng}`;
  return label === null ? null : label;
}

export function routeAllStopsUrl(stops: readonly DirectionsTarget[], mode: RouteTravelMode = 'driving'): string | null {
  const tokens = stops.map(stopToken).filter((t): t is string => t !== null);
  if (tokens.length === 0) return null;
  const destination = tokens[tokens.length - 1];
  // Truncated to Google's limit — see GOOGLE_MAPS_MAX_WAYPOINTS.
  const waypoints = tokens.slice(0, -1).slice(0, GOOGLE_MAPS_MAX_WAYPOINTS);
  const params = [`api=1`, `destination=${encodeURIComponent(destination)}`];
  if (waypoints.length > 0) params.push(`waypoints=${waypoints.map((w) => encodeURIComponent(w)).join('%7C')}`);
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

/**
 * Run "Route all stops": opens the full route link on every platform.
 * `nextIndex` is no longer read (iPhone used to open only that stop); it stays
 * in the options so the caller in ExpandedCardModal needs no change in this
 * follow-up.
 */
export function openRouteAllStops(
  stops: readonly DirectionsTarget[],
  options: { mode?: RouteTravelMode; nextIndex?: number; onUnavailable?: (() => void) | null } = {},
): void {
  const action = routeAllStopsAction(stops, options.mode ?? 'driving');
  if (action === null) {
    options.onUnavailable?.();
    return;
  }
  void Linking.openURL(action.url).catch(() => options.onUnavailable?.());
}
