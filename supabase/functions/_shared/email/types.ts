// ORCH-0785 — Public types for the shared transactional email module.

import type { SenderIdentity } from "./senders.ts";

export type EmailVariant =
  | "ticket_confirmation_paid"
  | "ticket_confirmation_free"
  | "ticket_confirmation_pending"
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
  };
  brand: {
    name: string;
    profilePhotoUrl: string | null;
  };
  order: {
    shortId: string;
    totalCents: number;
    currency: string;
    buyerName: string | null;
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
}

export type EmailBodyInput = TicketBodyInput | GenericBodyInput;

export interface RenderInput {
  variant: EmailVariant;
  recipient: { name: string | null; email: string };
  body: EmailBodyInput;
  supportEmail?: string;
  // Sender override used for admin compose path where the operator may pick
  // a custom From identity. Production paths leave this undefined and let
  // the module resolve from EMAIL_SENDERS.
  sender?: SenderIdentity;
}

export interface RenderResult {
  subject: string;
  html: string;
  text: string;
  from: SenderIdentity;
}
