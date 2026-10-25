// Issue #4063 — pure adapter from order facts to the unified buyer email/SMS.

import type { PurchaseBodyInput } from "./email/purchaseBody.ts";
import { purchaseEmailCopy } from "./email/purchaseCopy.ts";
import { renderBuyerSms, type SmsTemplateKey } from "./sms/buyerSms.ts";

export type OrderConfirmationKind = "ticket" | "trip" | "experience";

export interface OrderConfirmationMessageInput {
  kind: OrderConfirmationKind;
  title: string;
  brandName: string;
  buyerName: string | null;
  buyerEmail: string;
  buyerPhoneLast4: string | null;
  claimed: boolean;
  quantity: number;
  buttonUrl: string;
  date: string;
  time: string;
  when: string;
  place: string | null;
  detailLines?: string[];
  hostAddedGuest?: boolean;
  receipt: {
    currency: string;
    items: Array<{ label: string; quantity: number; amountCents: number }>;
    discountRows: Array<{ label: string; amountCents: number }>;
    feesAndTaxCents: number;
    paidCents: number;
    orderId: string;
  };
}

export interface OrderConfirmationMessage {
  body: PurchaseBodyInput;
  sms: string;
}

function templateFor(kind: OrderConfirmationKind) {
  if (kind === "trip") return "trip_booked" as const;
  if (kind === "experience") return "experience_booked" as const;
  return "ticket_confirmed" as const;
}

function smsTemplateFor(input: OrderConfirmationMessageInput): SmsTemplateKey {
  if (input.kind === "trip") return "S2";
  if (input.kind === "experience") return "S3";
  return input.hostAddedGuest ? "S1G" : "S1";
}

export function buildOrderConfirmationMessage(
  input: OrderConfirmationMessageInput,
): OrderConfirmationMessage {
  const noun = input.kind === "ticket" ? "ticket" : "booking";
  const copy = purchaseEmailCopy({
    template: templateFor(input.kind),
    title: input.title,
    date: input.date,
    time: input.time,
    firstName: input.buyerName,
    claimed: input.claimed,
    quantity: input.quantity,
    noun,
    brand: input.brandName,
  });

  return {
    body: {
      variant: "purchase_message",
      copy,
      claim: {
        claimed: input.claimed,
        email: input.buyerEmail,
        phoneLast4: input.buyerPhoneLast4,
      },
      buttonUrl: input.buttonUrl,
      details: {
        title: input.title,
        hostOrVenue: input.brandName,
        when: input.when,
        place: input.place,
        lines: input.detailLines,
      },
      receipt: {
        currency: input.receipt.currency,
        items: input.receipt.items,
        discountRows: input.receipt.discountRows,
        feesAndTaxCents: input.receipt.feesAndTaxCents,
        paidCents: input.receipt.paidCents,
        orderId: input.receipt.orderId,
      },
    },
    sms: renderBuyerSms(smsTemplateFor(input), {
      title: input.title,
      brand: input.brandName,
      date: input.date,
      time: input.time,
      link: input.buttonUrl.replace(/^https?:\/\//, ""),
      noun,
      claimed: input.claimed,
    }),
  };
}
