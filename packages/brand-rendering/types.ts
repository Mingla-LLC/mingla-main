import type { ResolvedTheme, ThemeInput } from "@mingla/event-rendering";

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
  offeringType: "event" | "trip" | "experience";
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
  venueCategory: "restaurant" | "play" | "creative_and_arts" | null;
}

export interface PublicBrandCallbacks {
  onClose: () => void;
  onShare: () => void;
  onOpenEvent: (event: PublicBrandEvent) => void;
  onOpenTrip: (trip: PublicBrandTrip) => void;
  onOpenExperience?: (experience: PublicBrandExperience) => void;
  onOpenUpcoming?: (item: PublicBrandUpcoming) => void;
  onOpenExternal?: (url: string) => void;
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
  theme?: ResolvedTheme;
  hideFloatingChrome?: boolean;
  chromeTopOffset?: number;
  callbacks: PublicBrandCallbacks;
}
