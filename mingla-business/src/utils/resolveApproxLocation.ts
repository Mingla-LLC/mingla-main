/**
 * Issue #1363 — one owner for context-validated approximate location resolution.
 * The raw label remains host-owned; geocoder output never rewrites it.
 */

import type {
  HierarchicalForwardResult,
  SavedLocationContext,
} from "@mingla/location-input";
import { forwardHierarchyMapbox as businessForwardHierarchy } from "../services/mapboxGeocodeService";

export type CoordinatePrecision = "exact" | "approximate";

export interface ApproxLocation {
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  precision: "approximate";
  matchLevel: "place" | "city" | "country";
}

export type ApproxLocationResolution =
  | { status: "selected"; location: ApproxLocation }
  | { status: "needs_context" };

export interface HierarchyDep {
  forwardHierarchy?: (
    query: string,
    savedContext: SavedLocationContext,
  ) => Promise<HierarchicalForwardResult>;
}

export interface LocationRequestGeneration {
  current: number;
}

/** Invalidate every older async completion and return the new request generation. */
export const advanceLocationRequestGeneration = (
  generation: LocationRequestGeneration,
): number => {
  generation.current += 1;
  return generation.current;
};

/** Label equality is insufficient: only the newest unique generation may commit. */
export const isLocationRequestGenerationCurrent = (
  generation: LocationRequestGeneration,
  captured: number,
): boolean => generation.current === captured;

const validCoordinate = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180 &&
  !(lat === 0 && lng === 0);

/**
 * Any text change, including whitespace/case/punctuation, invalidates an older
 * async result because the display label is authoritative and preserved raw.
 */
export const isFreeTextResolveStale = (
  resolvedForText: string,
  committedTextNow: string,
): boolean => resolvedForText !== committedTextNow;

export async function resolveFreeTextLocation(
  rawText: string,
  savedContext: SavedLocationContext = {},
  deps: HierarchyDep = {},
): Promise<ApproxLocationResolution> {
  if (rawText.trim().length === 0) return { status: "needs_context" };
  const forwardHierarchy =
    deps.forwardHierarchy ?? businessForwardHierarchy;
  const result = await forwardHierarchy(rawText, savedContext);
  if (result.details === null) return { status: "needs_context" };
  const { lat, lng } = result.details;
  if (!validCoordinate(lat, lng)) return { status: "needs_context" };
  return {
    status: "selected",
    location: {
      lat,
      lng,
      city: result.details.city,
      region: result.details.region,
      countryCode: result.details.countryCode,
      precision: "approximate",
      matchLevel: result.matchLevel,
    },
  };
}
