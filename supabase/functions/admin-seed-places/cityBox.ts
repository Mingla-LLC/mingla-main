// Issue #4276 B1: Google's box applies automatically, and a person is only asked
// when the result is a state or region, or the seed would cost more than the limit.
// Pure, so the rule is table-tested against real results.

import { type Box, HIGH_COST_USD } from "../_shared/seedingGeometry.ts";

export type BoxAskReason = "state_or_region_result" | "seed_estimate_over_limit";

export interface CityBoxDecision {
  box: Box;
  /** The edges where Google's box was larger, so the stored box grew. */
  grewEdges: Array<keyof Box>;
  changed: boolean;
  autoApply: boolean;
  askReasons: BoxAskReason[];
}

// A city result is a locality. These mean Google answered with something bigger.
const ALWAYS_REGION = new Set(["administrative_area_level_1"]);
const REGION_UNLESS_LOCALITY = new Set(["administrative_area_level_2", "country", "colloquial_area"]);

export function isRegionResult(resultTypes: readonly string[]): boolean {
  if (resultTypes.some((t) => ALWAYS_REGION.has(t))) return true;
  if (resultTypes.includes("locality")) return false;
  return resultTypes.some((t) => REGION_UNLESS_LOCALITY.has(t));
}

/** No area is ever lost: each edge keeps whichever box reaches further out. */
export function mergeBoxes(stored: Box | null, google: Box): Box {
  if (!stored) return { ...google };
  return {
    swLat: Math.min(stored.swLat, google.swLat),
    swLng: Math.min(stored.swLng, google.swLng),
    neLat: Math.max(stored.neLat, google.neLat),
    neLng: Math.max(stored.neLng, google.neLng),
  };
}

export function decideCityBox(input: {
  stored: Box | null;
  google: Box;
  resultTypes: readonly string[];
  estimateSeedCostUsd: (box: Box) => number;
}): CityBoxDecision {
  const box = mergeBoxes(input.stored, input.google);
  const grewEdges = (Object.keys(box) as Array<keyof Box>).filter(
    (edge) => !input.stored || box[edge] !== input.stored[edge],
  );
  const askReasons: BoxAskReason[] = [];
  if (isRegionResult(input.resultTypes)) askReasons.push("state_or_region_result");
  if (input.estimateSeedCostUsd(box) > HIGH_COST_USD) askReasons.push("seed_estimate_over_limit");
  return {
    box,
    grewEdges,
    changed: grewEdges.length > 0,
    autoApply: askReasons.length === 0,
    askReasons,
  };
}

/** "Washington" alone geocodes to the state, so the capital is spelled out. */
export function geocodeQueryForCity(city: { name: string; country: string | null; country_code?: string | null }): string {
  const isUs = city.country_code === "US" || /^united states/i.test(city.country ?? "");
  if (city.name.trim().toLowerCase() === "washington" && isUs) return "Washington, DC";
  return city.country ? `${city.name}, ${city.country}` : city.name;
}
