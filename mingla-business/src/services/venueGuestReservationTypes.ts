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
