import type {
  EventTerminalSource,
  ResolvedTheme,
  ThemeInput,
} from "@mingla/offering-rendering";
// #1558 — ONE owner for the venue-category union. It used to be inlined here
// AND declared again in mingla-business/src/types/brand.ts; both now read the
// profile module, so a fifth category cannot exist in one list and not the
// other. `import type` is erased, so this costs nothing at runtime.
import type { VenueCategory } from "./venueCategoryProfile";

export type PublicMediaType = "image" | "video" | "gif";

export interface PublicBrandLinks {
  website?: string;
  instagram?: string;
  tiktok?: string;
  x?: string;
  facebook?: string;
  youtube?: string;
  linkedin?: string;
  threads?: string;
  custom?: Array<{ label: string; url: string }>;
}

export interface PublicBrandContact {
  email?: string;
  phone?: string;
}

export interface PublicBrand {
  id: string;
  slug: string;
  displayName: string;
  address: string | null;
  coverHue: number;
  coverMediaUrl?: string;
  coverMediaType?: PublicMediaType;
  photo?: string;
  bio?: string;
  tagline?: string;
  links?: PublicBrandLinks;
  contact?: PublicBrandContact;
  theme?: ThemeInput | null;
}

export interface PublicBrandTicket {
  priceGbp?: number | null;
  currency?: string | null;
  isFree?: boolean;
  visibility?: string;
}

export interface PublicBrandEvent {
  id: string;
  name: string;
  brandSlug: string;
  eventSlug: string;
  status: "scheduled" | "live" | "ended" | "cancelled";
  eventType: "event" | "rsvp";
  operatorEndedAtUtc: string | null;
  terminalSource: EventTerminalSource;
  masterStartAtUtc: string | null;
  masterEndAtUtc: string | null;
  masterTimezone: string | null;
  dateLine: string;
  venueName: string | null;
  format: "in_person" | "in-person" | "online" | "hybrid";
  coverHue: number;
  coverMediaUrl: string | null;
  coverMediaType: PublicMediaType | null;
  currency?: string | null;
  // ORCH-1006 Slice 3 Wave 2 — server-computed all-in (tax/fee-inclusive)
  // lowest-tier price in CENTS, from
  // business_public_events_view.display_price_cents. null/undefined when
  // there is no priced tier → the "From" mini-card label falls back to the
  // min-of-tickets base price. Optional for back-compat with older payloads.
  displayPriceCents?: number | null;
  displayCurrency?: string | null;
  tickets: PublicBrandTicket[];
}

export interface PublicBrandTrip {
  id: string;
  slug: string;
  brandSlug: string;
  title: string;
  destinationText: string | null;
  coverMediaUrl: string | null;
  coverMediaType: PublicMediaType | null;
  status: "scheduled" | "live" | "ended" | "cancelled";
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  bookingsClosed: boolean;
  spotsLeft: number | null;
  minPriceCents: number | null;
  currency: string | null;
  hasFreeTier: boolean;
}

export interface PublicBrandExperience {
  experienceId: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  experienceSlug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  // ORCH-1155 — the experience cover's media type so the Experiences-tab card
  // renders video/gif covers (not image-only). Supplied by both data paths
  // (publicEventsService + useBrandBySlug) off pg_public_experiences_by_brand's
  // new cover_media_type column. null ⇒ image-or-hue fallback.
  coverMediaType: PublicMediaType | null;
  theme?: Record<string, unknown> | null;
  venueText: string | null;
  nextOccurrenceAt: string | null;
  priceFromMinorUnits: number | null;
  currency: string;
  isFree: boolean;
  publishedAt: string;
}

export interface PublicBrandUpcoming {
  offeringId: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  offeringType: "event" | "rsvp" | "trip" | "experience";
  offeringSlug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  coverMediaType: PublicMediaType | null;
  theme?: Record<string, unknown> | null;
  startsAt: string | null;
  priceFromMinorUnits: number | null;
  currency: string;
  isFree: boolean;
  publishedAt: string;
}

export interface PublicVenueDetail {
  isVerifiedVenue: true;
  city: string | null;
  venueCategory: VenueCategory | null;
}

// Issue #1365 — one row of the Brand page Reservations venue list.
// Data comes from the anon-safe venue_public_view (verified venues only);
// the adapter maps + passes it in. [] / undefined → the section is omitted.
export interface PublicBrandVenueSummary {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  photoUrl: string | null;
  placePoolId?: string | null;
  reservationState?: "loading" | "available" | "unavailable" | "error";
}

// ORCH-1186-C — DISPLAY-ONLY venue menu shapes (no ordering/cart/payment).
// A `PublicMenuGroup` is a menu/category section; its `items` are priced rows.
// `priceCents === null` ⇒ "price on request" (the public page renders no number
// for that row). `currency` is a 3-letter ISO from the stored row (never
// GBP-defaulted).
export interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  currency: string;
  // Issue #1789 (SPEC #1788 P-14) appended these to `public_menus_view`; #1793
  // is the first surface to read them. OPTIONAL on purpose: a client running
  // against a deployment whose view predates the migration receives no such key
  // at all, and that must read as "no notes allowed" rather than throw.
  /** May a guest attach "no ice" to this line at order time? (D-6) */
  allowsNotes?: boolean;
  photoUrl?: string | null;
}

export interface PublicMenuGroup {
  menuId: string;
  menuName: string;
  menuDescription: string | null;
  items: PublicMenuItem[];
}

export interface PublicBrandCallbacks {
  onClose: () => void;
  onShare: () => void;
  // Issue #679 — host-provided Follow toggle. ABSENT ⇒ no Follow UI renders
  // (the callback gate that keeps buyer-web + business preview unchanged).
  onToggleFollow?: () => void;
  onOpenEvent: (event: PublicBrandEvent) => void;
  onOpenTrip: (trip: PublicBrandTrip) => void;
  onOpenExperience?: (experience: PublicBrandExperience) => void;
  onOpenUpcoming?: (item: PublicBrandUpcoming) => void;
  onOpenExternal?: (url: string) => void;
  // Issue #1365 — a Reservations venue card tap → the public venue page.
  onOpenVenue?: (venue: PublicBrandVenueSummary) => void;
  onReservationsTabViewed?: () => void;
  onRetryVenues?: () => void;
}

export interface PublicBrandPageProps {
  brand: PublicBrand;
  events: PublicBrandEvent[];
  pastEvents?: PublicBrandEvent[];
  trips: PublicBrandTrip[];
  pastTrips?: PublicBrandTrip[];
  experiences?: PublicBrandExperience[];
  upcoming?: PublicBrandUpcoming[];
  upcomingHasMore?: boolean;
  venue?: PublicVenueDetail | null;
  // Issue #679 — server-truth follow state, host-owned (the renderer holds no
  // server state). Only read when callbacks.onToggleFollow is provided.
  isFollowing?: boolean;
  followPending?: boolean;
  // Issue #1365 — verified venues for the Reservations tab.
  // Absent / [] ⇒ section omitted (real-data-only).
  venues?: PublicBrandVenueSummary[];
  venuesLoadState?: "loading" | "ready" | "error";
  // ORCH-1186-C — DISPLAY-ONLY menu groups. Absent / [] ⇒ no Menu tab.
  menu?: PublicMenuGroup[];
  theme?: ResolvedTheme;
  hideFloatingChrome?: boolean;
  /** Business public-web #1615 identity overlay; absent preserves other hosts. */
  useDirectionCIdentity?: boolean;
  chromeTopOffset?: number;
  /** Runtime/browser bottom inset plus the page's 24pt breathing room. */
  contentBottomInset?: number;
  callbacks: PublicBrandCallbacks;
}
