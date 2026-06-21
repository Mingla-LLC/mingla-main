/**
 * tripOfferingTypes — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * The normalized, pure-structural prop contract the shared `TripOfferingBody` +
 * `useTripOfferingState` + `TripReserveBar` + `TripPaymentChoice` read. Each
 * surface (buyer-web/business `TripPreview`, consumer `ConsumerTripDetailScreen`)
 * maps its own read payload (`usePublicTripBySlug` / `useConsumerTripDetail`, or
 * the shared `pg_public_trip_by_slug` RPC) into THIS shape via a tiny per-surface
 * adapter — the body never touches a hook.
 *
 * I-MOR-0827-PACKAGE-ISOLATION: these are PURE structural types declared locally
 * (no app `src/` import). `RefundPolicyShape` mirrors the app shapes by structure.
 */

import type { CtaState } from "./offeringCta";

/** A refund-ladder tier (days-before-departure → refund percentage). */
export interface TripRefundTier {
  days_before_start: number;
  refund_pct: number;
}

/** The trip refund policy (kind + ordered ladder). Mirrors the app RefundPolicyShape. */
export interface TripRefundPolicyShape {
  kind: "flexible" | "standard" | "strict" | "custom";
  tiers: TripRefundTier[];
}

/** One day of the itinerary spine. */
export interface TripOfferingDay {
  id: string;
  ordinal: number;
  title: string;
  narrative: string | null;
  /** Optional per-day date label (free text). null → not shown. */
  date: string | null;
  /** Per-day media gallery items (image|video). [] → CountAwareGallery renders nothing. */
  media: Array<{ url: string; type: "image" | "video" }>;
}

/** A what's-included / what's-NOT-included chip item. */
export interface TripOfferingInclusion {
  id: string;
  kind: "included" | "excluded";
  item: string;
}

/**
 * The installment-plan template (relative-offset) for a tier, mirroring the app
 * `TripInstallmentScheduleData`. Null when the tier has no plan.
 */
export interface TripInstallmentTemplate {
  deposit_pct: number;
  installments: Array<{
    ordinal: number;
    pct: number;
    days_after_booking?: number;
    fixed_date?: string;
  }>;
}

/** One sellable pricing tier. Leg B: the body renders N of these as selectable rows. */
export interface TripOfferingTier {
  id: string;
  ticketTypeId: string;
  tierName: string;
  priceCents: number;
  /**
   * META-ORCH-1174 Leg B3 — the SERVER all-in (pg_public_event_tier_allin), in
   * cents. The §10 box + bar display + sum THIS (WYSIWYP, I-PROPOSED-1174-ALLIN-
   * SERVER-SOURCED). null/undefined → the per-surface adapter had no all-in (free
   * tier, or the RPC missed) → the math falls back to priceCents. NEVER recompute
   * fees client-side. Each surface adapter resolves it via fetchTierAllInCents.
   */
  priceAllInCents?: number | null;
  /** Optional per-package description (tier_metadata.description) — shown in the row. */
  description?: string | null;
  currency: string;
  isFree: boolean;
  isUnlimited: boolean;
  /** Remaining capacity; null when unlimited or unknown (no fabricated sold-out). */
  ticketsRemaining: number | null;
  /** Installment template (tier_metadata.installments); null → no plan. */
  installmentSchedule: TripInstallmentTemplate | null;
}

/** The brand card ("Presented by"). */
export interface TripOfferingBrand {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue: number | null;
  /** Verified tick (consumer shows it; web/business may pass false). */
  verified: boolean;
}

/**
 * The normalized trip data the body renders. Pre-mapped by each surface adapter —
 * the body renders ONLY these fields (rule 9: a section omits when its data is
 * absent). The wrapper composes price/availability strings the body just renders.
 */
export interface TripOfferingData {
  id: string;
  title: string;
  description: string | null;

  // dates + route
  startAt: string | null;
  endAt: string | null;
  /** "5 days · 4 nights" (or null when not derivable) — composed by the adapter. */
  durationLabel: string | null;
  /** Full date-range pill label (formatTripDateRange) — composed by the adapter. */
  dateRangeLabel: string;
  /** "City, Country" (normalizeCityCountry) — null hides the leaving-from pill. */
  departureCityCountry: string | null;
  /** "City, Country" (normalizeCityCountry) — null hides the destination pill. */
  destinationCityCountry: string | null;
  /** Raw destination text for the map caption (fallback "Destination"). */
  destinationText: string | null;

  // §4 pills
  /** "{n} seats left · {cap} max" / "Sold out · …" / "{cap} max" / null. */
  spotsLabel: string | null;
  /** booking_deadline ISO; the §4 countdown renders only when present + future. */
  bookingDeadlineIso: string | null;

  // §7 itinerary + §8 included/excluded
  days: TripOfferingDay[];
  inclusions: TripOfferingInclusion[];

  // §9 cancellation
  refundPolicy: TripRefundPolicyShape | null;

  // §10 reserve box
  tiers: TripOfferingTier[];
  /** ISO 4217 currency (trip-level). */
  currency: string;

  // §11 map (rule 9 — both must be finite to render)
  destinationLat: number | null;
  destinationLng: number | null;

  // gating
  /** false → PAID trip whose brand can't charge → CTA disabled. */
  bookable: boolean;
  /** true → bookings closed (deadline passed / manually closed). */
  bookingsClosed: boolean;
}

/**
 * The pure-projected pay-over-time schedule (absolute-date), what `TripPaymentChoice`
 * renders. Mirrors the app `InstallmentScheduleDisplaySchedule` by structure.
 */
export interface ProjectedTripSchedule {
  fullPriceCents: number;
  depositCents: number;
  currency: string;
  installments: Array<{ ordinal: number; amountCents: number; dueAtIso: string }>;
}

/** A single split-CTA button (its own resolved CtaState + onPress). */
export interface ReserveSplitButton {
  cta: CtaState;
  onPress: () => void;
}

/**
 * The split-CTA payload — "Pay in full" / "Pay over time". Present ONLY when the
 * (single, Leg A) tier has an installment schedule AND is tappable.
 */
export interface ReserveSplitCtas {
  full: ReserveSplitButton;
  overTime: ReserveSplitButton;
}

/**
 * A reserved cart line — META-ORCH-1174 Leg B3 (DEC-B multi-line). One per selected
 * package; `paymentPlanChoice` present only for a tier carrying a plan (DEC-F).
 */
export interface TripReserveLine {
  ticketTypeId: string;
  quantity: number;
  paymentPlanChoice?: "full" | "installments";
}

/** The body's action callbacks (all navigation/checkout owned by the surface). */
export interface TripOfferingCallbacks {
  /** Brand chip "View" → brand page. */
  onViewBrand?: () => void;
  /**
   * Reserve (the §10 box CTA + floating/docked bar). META-ORCH-1174 Leg B3: the
   * surface receives the FULL selected-lines array (DEC-B multi-package). `choice`
   * stays for the single/legacy split-button path (no selection → the surface
   * seeds the cart from `lines` or opens it to pick). When `lines` is omitted the
   * surface opens the cart un-seeded (Leg-A behavior preserved).
   */
  onReserve: (choice?: "full" | "installments", lines?: TripReserveLine[]) => void;
}
