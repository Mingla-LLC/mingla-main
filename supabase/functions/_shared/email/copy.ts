// ORCH-0785 — Per-variant copy strings for transactional email.
// Centralised so future tone tweaks live in one file and the SPEC's
// "experience app, not dating app" positioning rule is enforced.

import type { EmailVariant } from "./types.ts";

export interface TicketCopy {
  preheader: string;
  subjectFor(eventTitle: string): string;
  heading: string;
  intro: string;
  attachmentBadge: string;
}

const FREE: TicketCopy = {
  preheader: "You're in. Your Mingla tickets are attached.",
  subjectFor: (title) => `You're in — ${title}`,
  heading: "You're in.",
  intro: "No payment needed. Your tickets are attached as a PDF — save it to your phone or print it out.",
  attachmentBadge: "QR in attached PDF",
};

const PAID: TicketCopy = {
  preheader: "You're confirmed. Your Mingla tickets are attached.",
  subjectFor: (title) => `Your Mingla tickets — ${title}`,
  heading: "You're confirmed.",
  intro: "Thanks for your purchase. Your tickets are attached as a PDF — save it to your phone or print it out.",
  attachmentBadge: "QR in attached PDF",
};

const PENDING: TicketCopy = {
  preheader: "Payment is processing — tickets will arrive shortly.",
  subjectFor: (title) => `We're processing your tickets — ${title}`,
  heading: "We're processing your order.",
  intro: "Payment is going through. Your tickets will be issued and emailed within a few minutes.",
  attachmentBadge: "QR in attached PDF",
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
export const FOOTER_DISCLAIMER =
  "You received this email because you purchased tickets or requested an action with Mingla.";
