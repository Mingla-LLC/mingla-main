// Issue #4063 — unified waitlist email and one-segment SMS copy.

import type { PurchaseBodyInput } from "./email/purchaseBody.ts";
import { purchaseEmailCopy } from "./email/purchaseCopy.ts";
import { renderBuyerSms } from "./sms/buyerSms.ts";

export interface WaitlistSpotMessageInput {
  title: string;
  brandName: string;
  ticketTypeName: string;
  quantity: number;
  date: string;
  time: string;
  when: string;
  place: string | null;
  expiry: string;
  zoneLabel: string;
  checkoutUrl: string;
  smsLink: string | null;
}

export interface WaitlistSpotMessage {
  body: PurchaseBodyInput;
  sms: string;
}

export function buildWaitlistSpotMessage(
  input: WaitlistSpotMessageInput,
): WaitlistSpotMessage {
  const quantity = Math.max(1, Math.trunc(input.quantity));
  const copy = purchaseEmailCopy({
    template: "waitlist_spot",
    title: input.title,
    date: input.date,
    quantity,
    ticketType: input.ticketTypeName,
    expiry: input.expiry,
    zoneLabel: input.zoneLabel,
  });

  return {
    body: {
      variant: "purchase_message",
      copy,
      buttonUrl: input.checkoutUrl,
      details: {
        title: input.title,
        hostOrVenue: input.brandName,
        when: input.when,
        place: input.place,
      },
    },
    sms: renderBuyerSms(input.smsLink ? "S14" : "S14N", {
      title: input.title,
      date: input.date,
      expiry: input.expiry,
      link: input.smsLink,
    }),
  };
}
