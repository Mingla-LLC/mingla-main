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
