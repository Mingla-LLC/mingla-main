import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderPurchaseBody } from "../purchaseBody.ts";
import {
  type PurchaseCopyInput,
  type PurchaseCopyTemplate,
  purchaseEmailCopy,
} from "../purchaseCopy.ts";

const BASE: PurchaseCopyInput = {
  template: "ticket_confirmed",
  title: "Bachata Takeover",
  date: "Sat 25 Oct",
  time: "7:30 PM",
  dayWord: "tomorrow",
  firstName: "Amara Okafor",
  claimed: false,
  quantity: 2,
  noun: "ticket",
  venue: "The Waterside",
  amount: "£25.00",
  brand: "Bachata Lagos",
  ticketType: "General Admission tickets",
  expiry: "9:00 PM",
  zoneLabel: "Lagos time",
  retryDate: "Mon 27 Oct",
  installmentNumber: 2,
  friendlyError: "Your bank declined the payment.",
  cancelKind: "refund",
  orderCancelKind: "refund_known",
  refundKind: "standard",
  partialRefund: true,
  refundState: "needs_attention",
  subjectLabel: "Bachata Takeover",
  message: "We need you to confirm the original payment method.",
  travelerHasRefillUrl: true,
  sender: "Tobi",
  sameLocalDate: false,
};

const ALL_TEMPLATES: PurchaseCopyTemplate[] = [
  "ticket_confirmed",
  "trip_booked",
  "experience_booked",
  "rsvp_on_list",
  "rsvp_promoted",
  "rsvp_pending",
  "rsvp_waitlisted",
  "rsvp_maybe",
  "rsvp_not_going",
  "rsvp_declined",
  "rsvp_removed",
  "event_reminder",
  "reservation_booked",
  "reservation_changed",
  "reservation_cancelled",
  "reservation_reminder",
  "waitlist_spot",
  "payment_dunning",
  "payment_paid",
  "payment_reminder",
  "traveler_update",
  "recovery",
  "refund_issued",
  "order_cancelled",
  "refund_status",
  "chip_in_receipt",
  "ticket_sent",
];

Deno.test("#4063 every purchase copy template produces complete text", () => {
  for (const template of ALL_TEMPLATES) {
    const result = purchaseEmailCopy({ ...BASE, template });
    for (const [field, value] of Object.entries(result)) {
      if (field === "buttonLabel" && value === null) continue;
      assert(
        typeof value === "boolean" ||
          (typeof value === "string" && value.trim().length > 0),
        `${template}.${field} is empty`,
      );
    }
  }
});

Deno.test("#4063 pins confirmation, RSVP promotion and refund copy", () => {
  assertEquals(purchaseEmailCopy(BASE), {
    subject: "You're in: Bachata Takeover, Sat 25 Oct",
    heading: "You're in, Amara.",
    promise: "Your tickets are waiting in the Mingla app.",
    claimBlock: true,
    buttonLabel: "Get my tickets",
    preheader: "Your tickets are waiting in the Mingla app.",
  });
  assertEquals(
    purchaseEmailCopy({ ...BASE, template: "rsvp_promoted" }).subject,
    "You're in: Bachata Takeover",
  );
  assertEquals(
    purchaseEmailCopy({ ...BASE, template: "refund_issued" }).promise,
    "Bachata Lagos has refunded £25.00 to your original payment method.",
  );
});

Deno.test("#4063 renders one button, claim guidance, details and money truth", () => {
  const result = renderPurchaseBody({
    variant: "purchase_message",
    copy: purchaseEmailCopy(BASE),
    claim: {
      claimed: false,
      email: "buyer@example.com",
      phoneLast4: "+44 7700 900123",
    },
    buttonUrl: "https://usemingla.com/c/8KQ2ABCD7Z",
    details: {
      title: "Bachata Takeover",
      hostOrVenue: "Bachata Lagos",
      when: "Sat 25 Oct, 7:30 PM",
      place: "The Waterside",
      lines: ["Bachata Lagos added you to the guest list."],
    },
    receipt: {
      currency: "GBP",
      items: [{ label: "General Admission", quantity: 2, amountCents: 5000 }],
      discountRows: [{ label: "Early bird", amountCents: 500 }],
      feesAndTaxCents: 250,
      paidCents: 4750,
      orderId: "a1b2c3d4-1111-2222-3333-444444444444",
      cardDisplay: "Visa •••• 4242",
    },
  });
  assertEquals(result.subject, "You're in: Bachata Takeover, Sat 25 Oct");
  assertStringIncludes(
    result.text,
    "Sign in with buyer@example.com or the number ending 0123",
  );
  assertStringIncludes(
    result.html,
    "Sign in with <strong>buyer@example.com</strong> or the number ending 0123",
  );
  assertStringIncludes(result.text, "2× General Admission: £50.00");
  assertStringIncludes(result.text, "Early bird: −£5.00");
  assertStringIncludes(result.text, "Fees & tax: £2.50");
  assertStringIncludes(result.text, "Paid: £47.50");
  assertStringIncludes(result.text, "Order A1B2C3D4 · Visa •••• 4242");
  assertEquals(result.html.match(/background:#C4471A/g)?.length, 1);
  assertEquals(result.html.match(/<a /g)?.length, 1);
  assert(!result.html.includes("<img"));
  assert(!result.html.toLowerCase().includes("qr"));
});

Deno.test("#4063 escapes buyer text and renders free receipts honestly", () => {
  const copy = purchaseEmailCopy({
    ...BASE,
    template: "ticket_confirmed",
    title: "<script>alert(1)</script>",
    quantity: 1,
  });
  const result = renderPurchaseBody({
    variant: "purchase_message",
    copy,
    claim: { claimed: true },
    buttonUrl: "https://usemingla.com/c/8KQ2ABCD7Z",
    details: {
      title: "<script>alert(1)</script>",
      hostOrVenue: "Host & Co",
    },
    receipt: {
      currency: "GBP",
      items: [{ label: "Free ticket", amountCents: 0 }],
      discountRows: [],
      paidCents: 0,
    },
  });
  assert(!result.html.includes("<script>"));
  assertStringIncludes(result.html, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assertStringIncludes(result.text, "It's on your Mingla account.");
  assertStringIncludes(result.text, "1× Free ticket: Free");
  assertStringIncludes(result.text, "Total: Free");
});

Deno.test("#4063 strips subject line breaks from buyer-controlled slots", () => {
  const result = purchaseEmailCopy({
    ...BASE,
    title: "Bachata\r\nBcc: attacker@example.com",
  });
  assertEquals(
    result.subject,
    "You're in: Bachata Bcc: attacker@example.com, Sat 25 Oct",
  );
  assert(!/[\r\n]/.test(result.subject));
});

Deno.test("#4063 enforces claim contacts and safe action URLs", () => {
  const copy = purchaseEmailCopy(BASE);
  assertThrows(
    () =>
      renderPurchaseBody({
        variant: "purchase_message",
        copy,
        claim: { claimed: false },
        buttonUrl: "https://usemingla.com/c/8KQ2ABCD7Z",
      }),
    Error,
    "purchase_body_claim_contact_missing",
  );
  assertThrows(
    () =>
      renderPurchaseBody({
        variant: "purchase_message",
        copy,
        claim: { claimed: true },
        buttonUrl: "javascript:alert(1)",
      }),
    Error,
    "purchase_body_button_url_missing_or_invalid",
  );
});
