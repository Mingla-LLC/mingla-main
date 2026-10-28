// ORCH-0785 — Public types for the shared transactional email module.

import type { SenderIdentity } from "./senders.ts";
import type { PurchaseBodyInput } from "./purchaseBody.ts";

export type EmailVariant =
  | "ticket_confirmation_paid"
  | "ticket_confirmation_free"
  | "ticket_confirmation_pending"
  | "purchase_message"
  | "generic_notification"
  | "admin_compose";

export interface TicketBodyInput {
  variant:
    | "ticket_confirmation_paid"
    | "ticket_confirmation_free"
    | "ticket_confirmation_pending";
  event: {
    title: string;
    coverMediaUrl: string | null;
    coverMediaType: "image" | "video" | "gif" | null;
    locationText: string | null;
    isOnline: boolean;
    startAt: string | null;
    // ORCH-0877 — end time for the event date range. Null when the event has
    // no master end_at (legacy / draft / data-loss cases). When null the email
    // renders start-only and the ICS attachment omits DTEND (Constitution #9).
    endAt: string | null;
    timezone: string;
    /**
     * #3281 PR6 — when the order admits 2+ dates, each primary/secondary line
     * is listed instead of collapsing to a single range. Omit/empty = legacy
     * single `formatEventDateLine(startAt, endAt)`.
     */
    dateLines?: string[];
    /**
     * #3827 Q-A3 — the host turned on a private guest list
     * (`theme.business_event.settings.privateGuestList`). The confirmation CTA
     * then drops "who's going", because the app hides the going box. Omitted =
     * public, so the PDF/SMS callers that never read it are unaffected.
     */
    privateGuestList?: boolean;
  };
  brand: {
    name: string;
    profilePhotoUrl: string | null;
    /** Optional public slug for Follow-again / brand page links (#3682 d). */
    slug?: string | null;
  };
  /**
   * #3682 Wave 2.4 — follow status + one-tap unfollow in ticket / order emails.
   * Omit when the dispatcher could not mint a token (signed-out / misconfig).
   */
  follow?: {
    unfollowUrl: string | null;
    followUrl: string | null;
    reason?: "purchase" | "rsvp" | "booking";
  } | null;
  order: {
    id: string;
    shortId: string;
    totalCents: number;
    taxAmountCents?: number;
    taxBreakdown?: unknown[] | null;
    currency: string;
    buyerName: string | null;
    /**
     * issue #3827 — one line under the intro naming who a guest-list guest is
     * with ("You're on the guest list with Ada Okoro."). Unset renders nothing.
     */
    partyLine?: string | null;
    lineItems: Array<{
      ticketName: string;
      quantity: number;
      unitPriceCents: number;
      totalCents: number;
    }>;
    tickets: Array<{
      ticketId: string;
      ticketName: string;
    }>;
  };
}

export interface GenericBodyInput {
  variant: "generic_notification" | "admin_compose";
  title: string;
  paragraphs: string[];
  cta?: { label: string; url: string } | null;
  /** #3720 — validated Admin composer blocks. Legacy paragraphs remain valid. */
  document?: EmailContentBlock[] | null;
}

export type EmailContentBlock =
  | { id?: string; type: "rich_text"; html: string }
  | {
    id?: string;
    type: "image";
    url: string;
    alt: string;
    link?: string | null;
  }
  | { id?: string; type: "divider" }
  | {
    id?: string;
    type: "blog_post";
    postId: string;
    style: "card" | "row" | "link";
    buttonText: string;
    snapshot?: {
      slug: string;
      title: string;
      summary: string;
      categoryLabel: string;
      readMinutes: number;
      coverUrl: string | null;
      coverAlt: string;
      versionId: string;
    };
  }
  | {
    id?: string;
    type: "blog_post_resolved";
    postId: string;
    style: "card" | "row" | "link";
    buttonText: string;
    url: string;
    title: string;
    summary: string;
    categoryLabel: string;
    readMinutes: number;
    coverUrl: string | null;
    coverAlt: string;
    versionId: string;
  };

export type EmailBodyInput =
  | TicketBodyInput
  | GenericBodyInput
  | PurchaseBodyInput;

export interface RenderInput {
  variant: EmailVariant;
  recipient: { name: string | null; email: string };
  body: EmailBodyInput;
  supportEmail?: string;
  // Sender override used for admin compose path where the operator may pick
  // a custom From identity. Production paths leave this undefined and let
  // the module resolve from EMAIL_SENDERS.
  sender?: SenderIdentity;
  /**
   * #3524 FOLLOW-UP — the per-order attendance claim URL, already minted by the
   * caller, for the single "Open in Mingla" CTA in a ticket confirmation body.
   *
   * It lives on `RenderInput` rather than on `body` because it is not part of the
   * order's content: the same `TicketBodyInput` renders with or without it, and
   * that input is shared with the PDF and SMS paths, which carry no link. Only
   * the ticket-confirmation variants read it; omit it and the CTA falls back to
   * `MINGLA_APP_LINK_URL` (see `_shared/email/appLink.ts`).
   */
  appCtaClaimUrl?: string | null;
}

export interface RenderResult {
  subject: string;
  html: string;
  text: string;
  from: SenderIdentity;
}
