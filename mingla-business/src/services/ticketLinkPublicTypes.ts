export type TicketLinkKind = "guest_list" | "private_ticket";
export type TicketLinkState = "active" | "full" | "expired" | "revoked" | "event_unavailable" | "event_ended" | "tier_unavailable" | "sold_out" | "not_found";

export interface TicketLinkResolve {
  state: TicketLinkState;
  kind?: TicketLinkKind;
  linkId?: string;
  eventId?: string;
  guestsMax?: number;
  approvalRequired?: boolean;
  eventDateId?: string | null;
  hideRemaining?: boolean;
  event?: {
    title: string;
    brandName: string;
    brandSlug: string;
    eventSlug: string;
    coverUrl: string | null;
    /** issue #3827 — present only while the link is active. */
    coverMediaType?: "image" | "video" | "gif" | null;
    /** issue #3827 — a video cover's still; present only while the link is active. */
    coverPosterUrl?: string | null;
    startAt: string | null;
    endAt: string | null;
    timezone: string;
    venueLine: string | null;
    currency: string;
    themeColor: string | null;
    themeFont: string | null;
  };
  tier?: {
    id: string;
    name: string;
    description?: string | null;
    priceCents?: number;
    allInCents?: number;
    currency?: string;
    minPurchaseQty?: number;
    maxPurchaseQty?: number | null;
    isUnlimited?: boolean;
    waitlistEnabled?: boolean;
    remaining?: number | null;
    saleStartAt?: string | null;
    saleEndAt?: string | null;
  };
  dates?: Array<{ id: string; startAt: string; endAt: string; timezone: string }>;
  /** issue #3827 — how a multi-date event prices its days; active links only. */
  multiDatePricingMode?: "per_day" | "all_days";
  /** issue #3827 — one pass covers every date; the guest picks nothing. */
  allDaysPass?: boolean;
}
