/**
 * META-ORCH-1148 sub-ORCH 2.0 — venue reservation suite types.
 *
 * The camelCase domain shapes mapped from the snake_case
 * `venue_reservation_settings` table (the only table 2.0's UI reads/writes) +
 * the venue-module nav union. The other six venue_* tables are schema-only
 * seams for 2.1/2.2 and are not modeled here yet.
 */

/**
 * The venue-suite module union (the nav state machine's domain).
 *
 *  - Band A (`overview` / `settings`) — ALWAYS available.
 *  - Band B (`tables` / `availability` / `reservations` / `waitlist`) — gated
 *    SOLELY on `reservations_enabled` (the LOCKED single toggle). Booking
 *    modules render the honest ComingSoon interstitial in 2.0 (no dead tap);
 *    real CRUD is 2.1.
 *
 * Bands C/D (Menu / Demand / Guests / Campaigns / Feedback) are intentionally
 * NOT in the union in 2.0 — they cannot be selected, so they cannot dead-tap.
 */
export type VenueModule =
  | "overview"
  | "settings"
  | "tables"
  | "availability"
  | "reservations"
  | "waitlist";

/** The booking-band modules (gated on the toggle; ComingSoon in 2.0). */
export type VenueBookingModule = Exclude<VenueModule, "overview" | "settings">;

/** No-show fee policy (enforcement is 2.2; 2.0 stores the policy only). */
export type NoShowFeePolicy = "forfeit" | "none";

/**
 * `venue_reservation_settings` row, camelCased. `null` from the hook means no
 * row exists yet → the toggle is OFF (the table default).
 */
export interface VenueReservationSettings {
  brandId: string;
  placePoolId: string | null;
  /** The LOCKED single toggle (VISION dec 4). */
  reservationsEnabled: boolean;
  /** Optional reservation fee — free by default. */
  feeEnabled: boolean;
  feeAmountCents: number | null;
  feeCurrency: string | null;
  feeRefundable: boolean;
  cancelCutoffHours: number;
  noShowFeePolicy: NoShowFeePolicy;
  /** NULL → inherit the brand pass-fee default. */
  passFeeOverride: boolean | null;
  /** NULL → inherit the brand pass-tax default. */
  passTaxOverride: boolean | null;
}

/** The patch payload the fee/policy mutation accepts (all optional). */
export interface VenueReservationFeePatch {
  feeEnabled?: boolean;
  feeAmountCents?: number | null;
  feeCurrency?: string | null;
  feeRefundable?: boolean;
  cancelCutoffHours?: number;
  noShowFeePolicy?: NoShowFeePolicy;
}
