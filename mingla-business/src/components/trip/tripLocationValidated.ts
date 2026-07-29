/**
 * ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]
 *
 * Single source of truth for "a trip location field carries a confirmed Mapbox
 * pick". Mirrors the experiences family predicate
 * `stopHasValidatedLocation` (experienceWizardTypes.ts) — a field is only valid
 * when placeId + lat + lng are all non-null (i.e. a suggestion was picked, not
 * free-typed).
 *
 * [DECISION-REVISED 2026-06-12] BOTH departure AND destination are HARD-REQUIRED
 * (Seth overrode ORCH-1016's optional-departure design): a trip cannot publish
 * (create wizard) or save (published-edit screen) while EITHER field holds empty
 * OR typed-but-unpicked text. Empty is INVALID for both. `tripPlacePicked` is the
 * single truth; both field-level helpers delegate to it.
 *
 * Consumed by: TripCreatorStep1Basics, TripCreatorWizard, EditPublishedTripScreen
 * + their tests. Do not loosen (I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED).
 */

/**
 * A trip location field is "located" when it carries a REAL COORDINATE — from a
 * Mapbox pick, a free-text forward-geocode, OR a dropped pin. lat + lng both
 * non-null.
 *
 * Issue #1363 (OQ-2, Seth-approved 2026-07-29) — SUPERSEDES the prior pick-only
 * rule (placeId required) and its "Do not loosen" lock above. The invariant's
 * intent — every trip departure/destination carries a real coordinate — is
 * PRESERVED (lat/lng still required); only the Mapbox-placeId-required MECHANISM
 * is dropped so an un-indexed place located by free-text/pin is valid. The
 * `placeId` param is retained for call-site signature compatibility but is no
 * longer read. (Revises I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED /
 * I-PROPOSED-1363-COORD-FROM-ANY-TIER.) The trip PUBLISH RPC gates only on
 * destination TEXT, so this loosening works end-to-end with no server change.
 */
export const tripPlacePicked = (
  _placeId: string | null,
  lat: number | null,
  lng: number | null,
): boolean => lat !== null && lng !== null;

/**
 * Destination is REQUIRED for publish/save → valid IFF a real pick. Empty or
 * dirty (typed-but-unpicked) text is INVALID. The `text` param is accepted for
 * symmetry with the departure helper + call sites; emptiness never passes.
 */
export const destinationLocationValidated = (
  _text: string | null,
  placeId: string | null,
  lat: number | null,
  lng: number | null,
): boolean => tripPlacePicked(placeId, lat, lng);

/**
 * [DECISION-REVISED 2026-06-12] Departure is HARD-REQUIRED + VALIDATED. Valid
 * IFF a real pick. An EMPTY departure AND a non-empty-but-unvalidated (dirty)
 * departure are BOTH INVALID and block publish/save — identical to destination.
 * (The earlier "empty departure valid" / text-only branch is removed.)
 */
export const departureLocationValidated = (
  _text: string | null,
  placeId: string | null,
  lat: number | null,
  lng: number | null,
): boolean => tripPlacePicked(placeId, lat, lng);

// Inline-error copy — single source, reused on both authoring screens + tests.
// Provider-neutral (no payment-provider names; COMMS-0021 satisfied trivially).
export const TRIP_DESTINATION_PICK_ERROR =
  "Pick the destination from the suggestions.";
export const TRIP_DEPARTURE_PICK_ERROR =
  "Pick the departure city from the suggestions.";
