// ORCH-0785 — Per-variant copy strings for transactional email.
// Centralised so future tone tweaks live in one file and the SPEC's
// "experience app, not dating app" positioning rule is enforced.

import type { EmailVariant } from "./types.ts";
import { EMAIL_FOOTER_LINE } from "./footerLine.ts";

export interface TicketCopy {
  preheader: string;
  subjectFor(eventTitle: string): string;
  heading: string;
  intro: string;
  deliveryBadge: string;
}

const FREE: TicketCopy = {
  // Legacy free-ticket rows keep their frozen pre-#4063 bytes. New free
  // confirmations render through purchase_message instead.
  preheader: "You're in. Your Mingla tickets are attached.",
  subjectFor: (title) => `You're in — ${title}`,
  heading: "You're in.",
  intro:
    "No payment needed. Your tickets are attached as a PDF — save it to your phone or print it out.",
  deliveryBadge: "QR in attached PDF",
};

const PAID: TicketCopy = {
  preheader: "You're confirmed. Your tickets are waiting in the Mingla app.",
  subjectFor: (title) => `Your Mingla tickets — ${title}`,
  heading: "You're confirmed.",
  intro:
    "Thanks for your purchase. Your tickets are waiting in the Mingla app.",
  deliveryBadge: "Get your tickets in Mingla",
};

const PENDING: TicketCopy = {
  preheader: "Payment is processing — tickets will arrive shortly.",
  subjectFor: (title) => `We're processing your tickets — ${title}`,
  heading: "We're processing your order.",
  intro:
    "Payment is going through. Your tickets will be issued and emailed within a few minutes.",
  deliveryBadge: "Tickets arrive in Mingla after payment",
};

export function ticketCopyFor(variant: EmailVariant): TicketCopy {
  switch (variant) {
    case "ticket_confirmation_free":
      return FREE;
    case "ticket_confirmation_paid":
      return PAID;
    case "ticket_confirmation_pending":
      return PENDING;
    default:
      return PAID;
  }
}

// Mingla positioning copy used in the footer. Memory rule:
// "Mingla is an experience app, not a dating app."
export const MINGLA_TAGLINE = "Mingla — the experience app.";
// #4226: one footer line for every email (shell, admin sends, host blasts and
// the host composer preview). Its words live in
// ./footerLine.ts (mirrored for the business preview, parity-tested).
export const FOOTER_DISCLAIMER = EMAIL_FOOTER_LINE;
