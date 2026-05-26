/**
 * Brand types — mingla-business/src/types/brand.ts (Cycle 2 / ORCH-0743).
 *
 * Co-located here to break the `currentBrandStore.ts ↔ useCurrentBrand.ts`
 * require cycle introduced by ORCH-0742. Both store and wrapper hook now
 * import the type from here independently; neither side depends on the other
 * at module-init.
 *
 * Ownership: types only. No runtime values, no Zustand state, no React hooks.
 *
 * Schema-version evolution comments (v3 → v14) stay at the top of
 * currentBrandStore.ts where they're operationally relevant. The shape itself
 * lives here.
 *
 * Per SPEC_ORCH_0743 §3.4.1.
 */

// BrandRole: from the brand list, what role does the CURRENT USER hold on
// this brand? Used for permission gating in the founder-facing UI (top-nav
// chip, brand-list rendering).
//
// Cycle 13a (DEC-092): the J-A9 BrandMemberRole + BrandMember + BrandInvitation
// + InviteRole types were dropped. The canonical 6-role enum now lives in
// `src/utils/brandRole.ts` (mirrors SQL biz_role_rank verbatim per I-32).
// Brand membership state lives in `src/store/brandTeamStore.ts` (TRANSITIONAL
// per I-31 until B-cycle wires invite-brand-member edge function). v11→v12
// persist migration silently strips `members` + `pendingInvitations` from
// the local cache.
export type BrandRole = "owner" | "admin";

/**
 * Brand's Stripe Connect state. NEW in J-A10 schema v8.
 *
 * - not_connected: brand has not started Stripe Connect onboarding
 * - onboarding: submitted but Stripe is verifying (KYC in progress)
 * - active: fully verified, can sell tickets and receive payouts
 * - restricted: Stripe has flagged the account; payouts paused until resolved
 *
 * Per Designer Handoff §5.3.7 + §6.3.3.
 */
export type BrandStripeStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

/** Payout status. NEW in J-A10 schema v8. */
export type BrandPayoutStatus = "paid" | "in_transit" | "failed";

export interface BrandPayout {
  id: string;
  /** Legacy field name. Amount is in the row's explicit currency. */
  amountGbp: number;
  currency: string;
  status: BrandPayoutStatus;
  /** ISO 8601 timestamp when funds arrived (paid) or expected (in_transit). */
  arrivedAt: string;
}

export interface BrandRefund {
  id: string;
  /**
   * Legacy field name. Refund amount is in the row's explicit currency.
   * The minus prefix on display is a render-time concern.
   */
  amountGbp: number;
  currency: string;
  /** Display title of the event the refund relates to. */
  eventTitle: string;
  /** ISO 8601 timestamp when the refund processed. */
  refundedAt: string;
  /** Optional human-readable reason. Surfaces in row sub-text. */
  reason?: string;
}

/**
 * Stub of an event for Brand-level summarization. NEW in J-A12 schema v9.
 *
 * Real event records ship in Cycle 3 (event creator) and live in a
 * separate table; this Brand-level stub field exists ONLY to drive the
 * J-A12 finance reports' Top events list + revenue breakdown until
 * Cycle 3 wires per-event records.
 *
 * Per Designer Handoff finance-reports design (screens-brand.jsx
 * FinanceReportsScreen line 411-417).
 */
export interface BrandEventStub {
  id: string;
  title: string;
  /**
   * Gross revenue from this event in GBP whole-units (before fees / refunds).
   * Drives both the Top events list amount and the breakdown computation.
   */
  revenueGbp: number;
  /** Number of tickets sold for this event. */
  soldCount: number;
  /** Status drives the row sub-text label fallback. */
  status: "upcoming" | "in_progress" | "ended";
  /** ISO 8601 — when the event was held (or scheduled to be held). */
  heldAt: string;
  /**
   * Optional explicit context blurb for the row sub-text (e.g.,
   * "in person", "brunch series"). When undefined, rendering falls back
   * to a status-derived label (e.g., "ended", "upcoming").
   */
  contextLabel?: string;
}

export interface BrandStats {
  events: number;
  followers: number;
  /** Lifetime GMV in the brand's default currency (sum of net order totals). */
  rev: number;
  /** Last-7-day GMV in the brand's default currency. ORCH-0816. */
  rev7d: number;
  /** Total attendees across all events. NEW in J-A7 schema v3. */
  attendees: number;
}

export interface BrandLiveEvent {
  name: string;
  soldGbp: number;
  goalGbp: number;
}

export interface BrandContact {
  email?: string;
  phone?: string;
  /**
   * ISO 3166-1 alpha-2 country code for the phone's dial-code chip
   * (e.g. "GB", "US"). NEW in J-A8 polish schema v6. When undefined,
   * the phone Input defaults to "GB". Tracked separately from the
   * `phone` string so the country selection can be persisted without
   * mangling the user's typed local-number text.
   */
  phoneCountryIso?: string;
}

export interface BrandCustomLink {
  label: string;
  url: string;
}

export interface BrandLinks {
  website?: string;
  instagram?: string;
  /** TikTok handle (e.g. "@yourbrand"). NEW in J-A8 polish schema v5. */
  tiktok?: string;
  /** X (formerly Twitter) handle. NEW in J-A8 polish schema v5. */
  x?: string;
  /** Facebook page slug or URL. NEW in J-A8 polish schema v5. */
  facebook?: string;
  /** YouTube channel handle or URL. NEW in J-A8 polish schema v5. */
  youtube?: string;
  /** LinkedIn page slug or URL. NEW in J-A8 polish schema v5. */
  linkedin?: string;
  /** Threads handle. NEW in J-A8 polish schema v5. */
  threads?: string;
  /** Custom link list (post-MVP); empty in J-A7 stubs. */
  custom?: BrandCustomLink[];
}

/**
 * Cycle 2 J-A7 Brand shape (v3). `displayName` is the canonical label
 * (preserves the existing TopBar consumer contract from Cycle 0a).
 * `currentLiveEvent` is `null` when the brand has no live event tonight;
 * non-null brands drive the Home hero KPI. New v3 fields (bio, tagline,
 * contact, links) are optional — render-time guards handle undefined.
 */
export type Brand = {
  id: string;
  displayName: string;
  /**
   * URL-safe brand slug. FROZEN at brand creation per I-17.
   * NEVER add an edit path — IG-bio links and shared brand URLs
   * (Cycle 7 `/b/{brandSlug}` surface) depend on this slug being
   * immutable. If a future cycle needs brand renaming for typo
   * correction, ship a slug-redirect table + 301 to the new slug;
   * do NOT mutate this field directly.
   */
  slug: string;
  /**
   * Optional public-facing address. Used to pre-fill experience venues and
   * show an address on public surfaces when present.
   */
  address: string | null;
  /**
   * Cover band hue — drives the gradient on the public brand page hero.
   * Founder picks from a 6-swatch row in BrandEditView. Defaults to 25
   * (warm orange — matches the existing accent.warm Cycle 0 scheme).
   *
   * NEW in Cycle 7 FX2 schema v11. Hue-only stub for now; image upload
   * lands in B-cycle when storage pipelines + edge functions are ready
   * (mirrors the event-cover Cycle 3 hue-only pattern).
   */
  coverHue: number;
  photo?: string;
  role: BrandRole;
  stats: BrandStats;
  currentLiveEvent: BrandLiveEvent | null;
  /** Long-form description shown on profile. NEW in J-A7 schema v3. */
  bio?: string;
  /** One-line tagline. NEW in J-A7 schema v3. */
  tagline?: string;
  /** Contact info shown in profile + edit. NEW in J-A7 schema v3. */
  contact?: BrandContact;
  /** Social + custom links. NEW in J-A7 schema v3. */
  links?: BrandLinks;
  /**
   * Whether to show attendee count on public-facing surfaces. NEW in J-A8
   * schema v4. Undefined treated as `true` at read sites (default-on).
   * Consumer (Cycle 3+ public-page rendering) wires up later — J-A7 view
   * always shows attendees regardless of this toggle.
   */
  displayAttendeeCount?: boolean;
  /**
   * Stripe Connect status. NEW in J-A10 schema v8. Undefined treated as
   * `"not_connected"` at read sites — drives the J-A7 banner + payments
   * dashboard banner variant.
   */
  stripeStatus?: BrandStripeStatus;
  /**
   * ISO 4217 default currency for this brand's payouts + ticket pricing.
   * NEW in B2a Path C V3 (Sub-C Session B). Drives multi-currency formatting
   * across the dashboard per Constitution #10 + I-PROPOSED-T. Mapped from
   * `brands.default_currency`. Undefined means currency is not set yet.
   */
  defaultCurrency?: string;
  /**
   * Deprecated legacy cache. Do not use for active Payments display.
   */
  availableBalanceGbp?: number;
  /**
   * Deprecated legacy cache. Do not use for active Payments display.
   */
  pendingBalanceGbp?: number;
  /**
   * ISO 8601 timestamp of the most recent payout. NEW in J-A10 schema v8.
   * Undefined when no payouts have occurred. Drives the "Last payout"
   * KPI tile sub-text (relative time).
   */
  lastPayoutAt?: string;
  /**
   * Recent payouts. NEW in J-A10 schema v8. Undefined treated as `[]`.
   * Sorted newest-first by arrivedAt at render time.
   */
  payouts?: BrandPayout[];
  /**
   * Recent refunds. NEW in J-A10 schema v8. Undefined treated as `[]`.
   * Sorted newest-first by refundedAt at render time.
   */
  refunds?: BrandRefund[];
  /**
   * Recent events for finance-reports rendering. NEW in J-A12 schema v9.
   * Undefined treated as `[]` at read sites. Real per-event records ship
   * Cycle 3 (event creator) in a separate table; this Brand-level stub
   * exists ONLY to populate J-A12 finance reports until Cycle 3 lands.
   */
  events?: BrandEventStub[];
  /**
   * Cover media URL (Supabase storage OR Giphy/Pexels). NEW in Cycle 17e-A
   * schema (column pre-load). UI render: if present, shows media; falls back
   * to coverHue gradient when null/undefined. Picker UI ships in 17e-B Tier 2.
   */
  coverMediaUrl?: string;
  /**
   * Cover media type. NEW in Cycle 17e-A schema (column pre-load).
   * 17e-B Tier 2 picker writes this.
   */
  coverMediaType?: "image" | "video" | "gif";
  /**
   * Profile photo type — supports animated avatars per Q1=B amendment (DEC-109).
   * NEW in Cycle 17e-A schema (column pre-load). Picker UI ships in 17e-B Tier 2.
   * Existing profile_photo_url defaults to image semantics when this is undefined.
   */
  profilePhotoType?: "image" | "video" | "gif";
  /**
   * Ve1 — venue claim lifecycle for physical brands. Popup/trip_planner
   * typically stay `"none"`. Pending venues cannot publish public profile
   * or create events/trips until verified.
   */
  claimStatus?: BrandClaimStatus;
  /** Ve3 — admin rejection note when claim_status is rejected. */
  rejectionReason?: string;
  /** Ve3 — admin requested more info; claim stays pending_review. */
  claimFollowUpAt?: string;
  /** Ve3 — set when another claim for same google_place_id was approved. */
  duplicateOfBrandId?: string;
  /** Ve1 — Google Place ID when captured during venue onboarding. */
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
  city?: string;
  countryCode?: string;
  /** Ve1 — Restaurant / Play / Creative & Arts from venue onboarding. */
  venueCategory?: VenueCategory;
  /** Ve1+ — linked place_pool row after Ve2 match. */
  placePoolId?: string;
};

/** Ve1 — `brands.claim_status` + optional UI-only states. */
export type BrandClaimStatus =
  | "none"
  | "pending_review"
  | "verified"
  | "rejected";

export type VenueCategory = "restaurant" | "play" | "creative_and_arts";

/** Ve1 — one row in `brand_hours` (weekday 0 = Monday … 6 = Sunday). */
export interface BrandHourEntry {
  weekday: number;
  /** "HH:MM" or "HH:MM:SS"; null when closed. */
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}
