/** Shared discover-merged-events response types (edge + cache layers). */

export interface BusinessEventCard {
  eventId: string;
  brandId: string;
  brandSlug: string;
  eventSlug: string;
  brandName: string;
  brandProfilePhotoUrl: string | null;
  title: string;
  description: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue: number;
  masterDateUtc: string | null;
  masterEndAtUtc: string | null;
  doorsOpenLocal: string | null;
  endsAtLocal: string | null;
  timezone: string;
  venueName: string | null;
  city: string | null;
  address: string | null;
  hideAddressUntilTicket: boolean;
  format: "in-person" | "online" | "hybrid";
  locationGeo: { lat: number; lng: number } | null;
  partyTypes: string[];
  vibeTags: string[];
  musicGenres: string[];
  priceMin: number | null;
  priceMax: number | null;
  displayPriceCents: number | null;
  displayCurrency: string | null;
  currency: string;
  publicBuyerUrl: string;
}

export type MergedDiscoverItem =
  | { source: "business_event"; item: BusinessEventCard }
  | { source: "ticketmaster"; item: Record<string, unknown> };

export interface DiscoverMergedResponse {
  items: MergedDiscoverItem[];
  meta: {
    businessCount: number;
    ticketmasterCount: number;
    businessTotalAvailable: number;
    ticketmasterTotalAvailable: number;
    tmCalled: boolean;
    tmError: string | null;
    page: number;
    pageSize: number;
    fromCache: boolean;
  };
}
