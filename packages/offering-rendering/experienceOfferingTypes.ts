/**
 * experienceOfferingTypes — ORCH-1183 [experience-standardize] (final META-ORCH-1166 leg).
 *
 * The normalized, pure-structural prop contract the shared `ExperienceOfferingBody`
 * + `StopSpine` read. Each surface (buyer-web/business `ExperiencePreview`, consumer
 * `ConsumerExperienceDetailScreen`) maps its own read payload — the by-slug
 * `pg_public_experience_by_slug` RPC (web read + consumer route) or the deck-card
 * SEED (`BusinessEventCard`, consumer deck path) — into THIS shape via a tiny
 * per-surface adapter. The body never touches a hook / fetch.
 *
 * Mirrors `tripOfferingTypes.ts`. Experiences are STOP/place-based (not day-based),
 * carry ONE sellable all-in price (NO installments / NO deposits / NO per-stop
 * prices — ORCH-1151 sums the stops server-side into the one ticket), and use the
 * canonical 1–4 vibe ids (adventurous/first-date/romantic/group-fun).
 *
 * I-MOR-0827-PACKAGE-ISOLATION: these are PURE structural types declared locally
 * (no app `src/` import).
 */

/**
 * One itinerary stop. The shared StopSpine renders these in order:
 * START HERE / THEN / END WITH labels (by index), an optional per-stop start-time
 * pill, the per-stop media gallery (image OR video — consumer's per-stop video is
 * preserved), and an optional per-stop map (lat/lng-gated).
 *
 * NEVER carries a per-stop PRICE for display — experiences show ONE combined all-in
 * price (ORCH-1151 sums stops server-side). `priceCents` is intentionally absent.
 */
export interface ExperienceOfferingStop {
  id: string;
  /** 0-based order; the spine dot shows order+1. */
  stopOrder: number;
  placeName: string | null;
  /** Street/place address; address-privacy-aware (NULL when the brand hides it). */
  address: string | null;
  /** Authored blurb (experience_stops.ai_description). null → omitted (rule 9). */
  description: string | null;
  /** Authored wall-clock start ("HH:mm[:ss]" or an ISO instant). null → no pill. */
  startTime: string | null;
  /** Per-stop coords; both finite → optional per-stop map. NULL when hidden. */
  lat: number | null;
  lng: number | null;
  /** Per-stop media (image|video). [] → the gallery renders nothing (rule 9). */
  media: Array<{ url: string; type: "image" | "video" }>;
}

/** The ONE sellable ticket — a single all-in charge (no installments/deposit). */
export interface ExperienceOfferingTicket {
  ticketTypeId: string;
  name: string;
  priceCents: number;
  /**
   * The SERVER fee-grossed all-in (`pg_public_event_tier_allin`), in CENTS. The
   * price card + reserve bar DISPLAY this (WYSIWYP, never the bare base under an
   * all-in caption — orch-1153-no-bare-base). null/undefined → free / RPC miss →
   * the body falls back to `priceCents`. NEVER recompute fees client-side.
   */
  priceAllInCents?: number | null;
  currency: string;
  isFree: boolean;
  isUnlimited: boolean;
  /** Remaining capacity; null when unlimited / unknown (no fabricated sold-out). */
  ticketsRemaining: number | null;
  /** Total capacity; null when unlimited / unknown. */
  quantityTotal: number | null;
}

/** One bookable occurrence (event_dates row) — drives the reserve picker. */
export interface ExperienceOfferingOccurrence {
  eventDateId: string;
  startAt: string;
  endAt: string;
  /** Remaining seats for the occurrence; null = unlimited / unknown. */
  remaining: number | null;
  capacity: number | null;
}

/** The brand card ("Presented by"). */
export interface ExperienceOfferingBrand {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue: number | null;
  /** Verified tick. */
  verified: boolean;
}

/**
 * The normalized experience data the body renders. Pre-mapped by each surface
 * adapter — the body renders ONLY these fields (rule 9: a section omits when its
 * data is absent). The wrapper composes the display strings the body renders.
 */
export interface ExperienceOfferingData {
  id: string;
  title: string;
  description: string | null;
  /** ISO 4217 currency (experience-level). */
  currency: string;
  timezone: string;

  // cover
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;

  // §meta chips (rule 9 — null → that chip omitted)
  /** "City, Country" (normalizeCityCountry) — null hides the location chip. */
  cityCountry: string | null;
  /** "5 dates · Next: Fri 20 Jun" / "Fri 20 Jun" / null. */
  datesLabel: string | null;
  /** "3 spots left · 12 max" / "12 max" / null. */
  seatsLabel: string | null;
  /** "7:00 PM start" / null. */
  startTimeLabel: string | null;

  // vibes
  /** Canonical vibe ids (1–4 of adventurous/first-date/romantic/group-fun). */
  intents: string[];

  // itinerary
  stops: ExperienceOfferingStop[];

  // pricing (ONE ticket)
  ticket: ExperienceOfferingTicket | null;

  // availability
  occurrences: ExperienceOfferingOccurrence[];
  /** Open-daily (restaurant-style) → ExperienceReservePicker; else flat slots. */
  openDaily: boolean;

  // gating
  /** false → PAID experience whose brand can't charge → CTA disabled. */
  bookable: boolean;
}

/** The body's action callbacks (all navigation/reservation owned by the surface). */
export interface ExperienceOfferingCallbacks {
  /** Brand chip "View" → brand page. */
  onViewBrand?: () => void;
  /** Reserve (the §reserve box CTA + floating/docked bar). */
  onReserve: () => void;
}
