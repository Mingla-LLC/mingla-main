// Issue #4063 — unified RSVP pass/promoted email and SMS copy.

import type { PurchaseBodyInput } from "./email/purchaseBody.ts";
import { purchaseEmailCopy } from "./email/purchaseCopy.ts";
import { renderBuyerSms } from "./sms/buyerSms.ts";

/** Issue #4422 — why the guest holds a pass, so the text can say so. */
export type RsvpPassReason = "going" | "approved" | "spot_opened";

export interface RsvpPassMessageInput {
  reason: RsvpPassReason;
  guest: boolean;
  title: string;
  brandName: string;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientPhoneLast4: string | null;
  leadName: string | null;
  claimed: boolean;
  buttonUrl: string;
  smsLink: string;
  date: string;
  time: string;
  when: string;
  place: string | null;
}

export interface RsvpPassMessage {
  body: PurchaseBodyInput;
  sms: string;
}

export function buildRsvpPassMessage(
  input: RsvpPassMessageInput,
): RsvpPassMessage {
  const copy = purchaseEmailCopy({
    template: input.reason === "spot_opened" ? "rsvp_promoted" : "rsvp_on_list",
    title: input.title,
    date: input.date,
    firstName: input.recipientName,
    claimed: input.claimed,
  });

  return {
    body: {
      variant: "purchase_message",
      copy,
      claim: {
        claimed: input.claimed,
        email: input.recipientEmail,
        phoneLast4: input.recipientPhoneLast4,
      },
      buttonUrl: input.buttonUrl,
      details: {
        title: input.title,
        hostOrVenue: input.brandName,
        when: input.when,
        place: input.place,
        lines: input.guest && input.leadName
          ? [`${input.leadName} added you to the list.`]
          : undefined,
      },
    },
    // The plus-one keeps "<Lead> added you to the list": they took no action.
    sms: renderBuyerSms(
      input.guest
        ? "S4G"
        : input.reason === "approved"
        ? "S4A"
        : input.reason === "spot_opened"
        ? "S4P"
        : "S4",
      {
        title: input.title,
        lead: input.leadName,
        date: input.date,
        time: input.time,
        link: input.smsLink,
        noun: "pass",
        claimed: input.claimed,
      },
    ),
  };
}
