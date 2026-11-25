import type {
  TicketQuoteCodeOutcome,
  TicketQuoteDiscount,
  TicketQuoteNotice,
} from "@mingla/offering-rendering/discountQuote";

export interface GuestReservationBuyer {
  name: string;
  email: string;
  phone: string;
  phoneCountryIso?: string | null;
  marketingOptIn: boolean;
}

export interface GuestReservationInput {
  venueId: string;
  brandId: string;
  reservedForUtc: string;
  partySize: number;
  buyer: GuestReservationBuyer;
  occasion?: string | null;
  guestNotes?: string | null;
  attributionClickId?: string | null;
  organicJourneyToken?: string | null;
  discountCode?: string | null;
  quoteDigest?: string | null;
  /** #4490 P5 — a picked table, or two joined tables. */
  tableIds?: string[] | null;
  /** #4490 P5 — a seating area (the server gives the smallest free table there). */
  spaceId?: string | null;
  /** #4490 P5 — a party bigger than any table: a request, nothing to pay. */
  requestLargeParty?: boolean;
}

export interface GuestReservationPreview {
  kind: "preview";
  depositListCents: number;
  discountCents: number;
  depositNetCents: number;
  feesAndTaxCents: number;
  totalCents: number;
  currency: string;
  discounts: TicketQuoteDiscount[];
  codeOutcome: TicketQuoteCodeOutcome;
  notices: TicketQuoteNotice[];
  quoteDigest: string | null;
  requiresPayment: boolean;
}
