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

/* ===========================================================================
 * 2.1a (Booking Core — Tables + Availability + the Engine) domain types.
 * camelCase mapped from the snake_case venue_tables / venue_capacity_rules /
 * venue_availability_config / venue_blackouts tables + the engine RPC result.
 * The Reservations / Waitlist domain shapes are 2.1b.
 * ========================================================================= */

/** A table zone (matches the venue_tables.zone CHECK). */
export type VenueTableZone =
  | "indoor"
  | "outdoor"
  | "private_room"
  | "bar"
  | "patio";

/** A table seating type (matches the venue_tables.seating_type CHECK). */
export type VenueSeatingType = "high_top" | "booth" | "lounge" | "standard";

/**
 * A table's reservation policy (matches venue_tables.reservation_policy). In
 * 2.1a only `reservable` tables surface in the engine; `walk_in_only` /
 * `approval_required` are named seams (the rows persist but the 2.1a UI offers
 * only the three the engine honours).
 */
export type VenueReservationPolicy =
  | "reservable"
  | "walk_in_only"
  | "approval_required";

/** `venue_tables` row, camelCased. */
export interface VenueTable {
  id: string;
  brandId: string;
  placePoolId: string | null;
  name: string;
  capacity: number;
  minParty: number | null;
  maxParty: number | null;
  zone: VenueTableZone | null;
  seatingType: VenueSeatingType | null;
  combinable: boolean;
  accessible: boolean;
  isActive: boolean;
  reservationPolicy: VenueReservationPolicy;
  sortOrder: number;
  notes: string | null;
}

/** The add/edit table form payload (id present → edit, absent → insert). */
export interface VenueTableUpsert {
  id?: string;
  name: string;
  capacity: number;
  minParty: number | null;
  maxParty: number | null;
  zone: VenueTableZone | null;
  seatingType: VenueSeatingType | null;
  combinable: boolean;
  accessible: boolean;
  reservationPolicy: VenueReservationPolicy;
  notes: string | null;
}

/**
 * The capacity-rule kinds. The full catalog is laid in 2.0's CHECK, but 2.1a
 * ships ONLY the three the engine honours; the rest are named seams.
 */
export type VenueCapacityRuleKind =
  | "party_fit"
  | "deposit_threshold"
  | "blackout_scope";

/** `venue_capacity_rules` row (the 3 MVP kinds), camelCased. */
export interface VenueCapacityRule {
  id: string;
  brandId: string;
  kind: VenueCapacityRuleKind;
  params: Record<string, unknown>;
  tableId: string | null;
  zone: VenueTableZone | null;
  isActive: boolean;
}

/** A single service period (one entry of venue_availability_config.service_periods). */
export interface ServicePeriod {
  name: string;
  /** 0..6 (Sun..Sat). */
  days: number[];
  /** 'HH:MM' venue-local. */
  start: string;
  /** 'HH:MM' venue-local. */
  end: string;
  type?: string;
}

/** `venue_availability_config` row, camelCased (one row per brand). */
export interface VenueAvailabilityConfig {
  brandId: string;
  servicePeriods: ServicePeriod[];
  /** { p2: 75, p4: 90, p6: 120 } minutes by party bucket. */
  turnTimes: Record<string, number>;
  bufferMinutes: number;
  maxReservationsPerSlot: number | null;
  slotGranularityMinutes: number;
  advanceWindowDays: number;
  minNoticeMinutes: number;
}

/** The patch payload for the availability config upsert (all optional). */
export interface VenueAvailabilityConfigPatch {
  servicePeriods?: ServicePeriod[];
  turnTimes?: Record<string, number>;
  bufferMinutes?: number;
  maxReservationsPerSlot?: number | null;
  slotGranularityMinutes?: number;
  advanceWindowDays?: number;
  minNoticeMinutes?: number;
}

/** Which scope a blackout applies to (matches venue_blackouts.applies_to). */
export type BlackoutAppliesTo = "all" | "zone" | "table";

/** `venue_blackouts` row, camelCased. */
export interface VenueBlackout {
  id: string;
  brandId: string;
  dateStart: string;
  dateEnd: string;
  reason: string | null;
  appliesTo: BlackoutAppliesTo;
  zone: VenueTableZone | null;
  tableId: string | null;
}

/** The add/edit blackout payload. */
export interface VenueBlackoutUpsert {
  id?: string;
  dateStart: string;
  dateEnd: string;
  reason: string | null;
  appliesTo: BlackoutAppliesTo;
  zone: VenueTableZone | null;
  tableId: string | null;
}

/**
 * A bookable slot from the engine RPC (`pg_venue_available_slots`). The FROZEN
 * CONTRACT shape — 2.2's consumer picker reads the same.
 */
export interface AvailableSlot {
  /** Slot start, UTC ISO. */
  slotStartUtc: string;
  /** 'HH:MM' venue-local convenience label. */
  slotLocalLabel: string;
  /** max-per-slot minus already-booked. */
  remaining: number;
  /** true → returned but full (show "full", don't hide). */
  isFull: boolean;
}

/* ===========================================================================
 * 2.1b (Reservations lifecycle + Waitlist) domain types. camelCase mapped from
 * the snake_case `reservations` / `venue_waitlist` tables.
 * ========================================================================= */

/** The 8-state reservation lifecycle (matches the reservations.status CHECK). */
export type ReservationStatus =
  | "requested"
  | "confirmed"
  | "seated"
  | "completed"
  | "no_show"
  | "cancelled_by_guest"
  | "cancelled_by_venue"
  | "waitlisted";

/** Where a reservation came from (matches reservations.source CHECK). */
export type ReservationSource =
  | "mingla"
  | "phone"
  | "walk_in"
  | "website"
  | "instagram";

/** payment_status (manual bookings are FREE → 'none'). */
export type ReservationPaymentStatus = "none" | "paid" | "refunded";

/**
 * The segmented list views (Design IA §4.4) — NOT a 3rd nav level; a segmented
 * control inside the Reservations module. Each maps to a status filter.
 */
export type ReservationView =
  | "today"
  | "upcoming"
  | "waitlist"
  | "completed"
  | "no_shows"
  | "canceled";

/** A `reservations` row, camelCased. */
export interface Reservation {
  id: string;
  brandId: string;
  placePoolId: string | null;
  tableId: string | null;
  /** Slot start, UTC ISO. */
  reservedFor: string;
  partySize: number;
  status: ReservationStatus;
  source: ReservationSource;
  createdVia: "operator" | "consumer";
  guestName: string | null;
  guestPhoneE164: string | null;
  guestEmail: string | null;
  consumerUserId: string | null;
  occasion: string | null;
  guestNotes: string | null;
  tags: string[];
  feeCents: number | null;
  feeCurrency: string | null;
  paymentStatus: ReservationPaymentStatus;
  createdAt: string;
}

/** Manual-create payload for biz_reservation_create. */
export interface ReservationCreateInput {
  reservedFor: string;
  partySize: number;
  source: ReservationSource;
  guestName: string | null;
  guestPhoneE164: string | null;
  guestEmail: string | null;
  tableId: string | null;
  occasion: string | null;
  guestNotes: string | null;
  tags: string[];
}

/** The lifecycle actions the operator can take (UI labels → transition target). */
export type ReservationAction =
  | "confirm"
  | "seat"
  | "no_show"
  | "complete"
  | "cancel";

/** The canonical reservation tags (Design IA §4.4). */
export const RESERVATION_TAGS = [
  "vip",
  "birthday",
  "first_time",
  "regular",
  "high_risk_no_show",
] as const;
export type ReservationTag = (typeof RESERVATION_TAGS)[number];

/** venue_waitlist status (matches the CHECK). */
export type WaitlistStatus =
  | "waiting"
  | "notified"
  | "converted"
  | "expired"
  | "lost";

/** A `venue_waitlist` row, camelCased. */
export interface WaitlistEntry {
  id: string;
  brandId: string;
  guestName: string | null;
  guestPhoneE164: string | null;
  guestEmail: string | null;
  partySize: number;
  preferredZone: VenueTableZone | null;
  quotedWaitMinutes: number | null;
  status: WaitlistStatus;
  notifyVia: "push" | "sms" | "none";
  notifiedAt: string | null;
  expiresAt: string | null;
  convertedReservationId: string | null;
  consumerUserId: string | null;
  createdAt: string;
}

/** Add-to-waitlist payload (direct RLS-gated insert). */
export interface WaitlistAddInput {
  guestName: string | null;
  guestPhoneE164: string | null;
  guestEmail: string | null;
  partySize: number;
  preferredZone: VenueTableZone | null;
  quotedWaitMinutes: number | null;
}
