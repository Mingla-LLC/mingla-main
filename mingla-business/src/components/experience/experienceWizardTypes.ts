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
  /**
   * Issue #1363 [three-tier address] — how lat/lng was captured: "exact" (Tier-1
   * pick / Tier-3 pin) or "approximate" (Tier-2 free-text forward-geocode); null
   * when unset. Persisted to experience_stops.coordinate_precision.
   */
  coordinatePrecision?: "exact" | "approximate" | null;
  /** ≤5; imageUrls[0] = primary. */
  imageUrls: string[];
  /** "HH:mm" local, or null. */
  startTime: string | null;
  /** Per-stop price major-unit string (used only in per_stop pricing mode). */
  priceMajor: string;
  /**
   * META-ORCH-1059 CHANGE 3 — compulsory per-stop blurb (1–280 chars).
   * Persists to experience_stops.ai_description → CuratedStop.aiDescription
   * (the per-stop line on the deck card + public page). Required at publish.
   */
  description: string;
}

/** CHANGE 3 — max length of the per-stop description. */
export const MAX_STOP_DESCRIPTION = 280;

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
  coordinatePrecision: null,
  imageUrls: [],
  startTime: null,
  priceMajor: "0.00",
  description: "",
});

/** Start Here / Then / End With label, derived from position + count (mirrors CuratedStop). */
export const labelForIndex = (i: number, n: number): string => {
  if (n <= 1) return "START HERE";
  if (i === 0) return "START HERE";
  if (i === n - 1) return "END WITH";
  return "THEN";
};

/**
 * A stop is location-valid when it carries a REAL COORDINATE (from a pick,
 * free-text forward-geocode, OR a dropped pin) alongside a display address.
 *
 * Issue #1363 (OQ-2, Seth-approved 2026-07-29) — SUPERSEDES the prior pick-only
 * predicate (placeId required). The invariant's intent — every stop carries a
 * real coordinate — is PRESERVED (lat/lng still required); only the Mapbox-
 * placeId-required MECHANISM is dropped, so an un-indexed place located via
 * free-text/pin is valid. (Revises I-PROPOSED-1363-COORD-FROM-ANY-TIER.)
 *
 * ⚠ NOTE: the experience PUBLISH RPC `biz_publish_experience` still enforces a
 * server-side `place_id` guard (`stop_address_unvalidated`) — loosening it is a
 * documented follow-up outside this issue's allowlist (see IMPLEMENTATION report
 * gap G1). This client predicate is loosened per the SPEC; the server guard must
 * be loosened by the paired RPC amendment before a pin-only stop can publish.
 */
export const stopHasValidatedLocation = (s: ExperienceStopDraft): boolean =>
  s.lat !== null && s.lng !== null && s.address.trim().length > 0;

/** CHANGE 3 — a stop has a valid (non-empty, ≤280) description. */
export const stopHasValidDescription = (s: ExperienceStopDraft): boolean => {
  const len = s.description.trim().length;
  return len > 0 && len <= MAX_STOP_DESCRIPTION;
};
