/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 5
 *
 * Shared types for the experience creator wizard's Stops + Pricing steps.
 * Kept in a leaf module so the steps + the wizard host import a single source
 * (avoids a circular import).
 */

export type ExperienceLocationMode = "single" | "per_stop";
export type ExperiencePricingMode = "whole" | "per_stop";

/** One authored stop (1:1 with a CuratedStop being built). */
export interface ExperienceStopDraft {
  /** Stable key for list reorder (NOT persisted). */
  clientId: string;
  placeId: string | null;
  placeName: string;
  address: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  /** ≤5; imageUrls[0] = primary. */
  imageUrls: string[];
  /** "HH:mm" local, or null. */
  startTime: string | null;
  /** Per-stop price major-unit string (used only in per_stop pricing mode). */
  priceMajor: string;
}

let counter = 0;
export const newStopClientId = (): string => {
  counter += 1;
  return `stop_${Date.now().toString(36)}_${counter}`;
};

export const emptyStop = (): ExperienceStopDraft => ({
  clientId: newStopClientId(),
  placeId: null,
  placeName: "",
  address: "",
  city: null,
  region: null,
  countryCode: null,
  lat: null,
  lng: null,
  imageUrls: [],
  startTime: null,
  priceMajor: "0.00",
});

/** Start Here / Then / End With label, derived from position + count (mirrors CuratedStop). */
export const labelForIndex = (i: number, n: number): string => {
  if (n <= 1) return "START HERE";
  if (i === 0) return "START HERE";
  if (i === n - 1) return "END WITH";
  return "THEN";
};

/** A stop is location-valid when it carries a confirmed pick (placeId set). */
export const stopHasValidatedLocation = (s: ExperienceStopDraft): boolean =>
  s.placeId !== null && s.lat !== null && s.lng !== null;
