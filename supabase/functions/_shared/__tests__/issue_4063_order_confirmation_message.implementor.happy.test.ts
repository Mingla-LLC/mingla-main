import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTransactionalEmail } from "../email/index.ts";
import { buildOrderConfirmationMessage } from "../orderConfirmationMessage.ts";

Deno.env.set("DENO_TESTING", "1");

const BASE = {
  kind: "ticket" as const,
  title: "Bachata Takeover",
  brandName: "Bachata Lagos",
  buyerName: "Amara Okafor",
  buyerEmail: "amara@example.test",
  buyerPhoneLast4: "0123",
  claimed: false,
  quantity: 2,
  buttonUrl: "https://usemingla.com/c/AB12CD34EF",
  date: "Sat 25 Oct",
  time: "7:30 PM",
  when: "Sat 25 Oct, 7:30 PM",
  place: "The Waterside",
  receipt: {
    currency: "GBP",
    items: [{ label: "General admission", quantity: 2, amountCents: 5000 }],
    discountRows: [{ label: "Launch offer", amountCents: 500 }],
    feesAndTaxCents: 250,
    paidCents: 4750,
    orderId: "a1b2c3d4-1111-2222-3333-444444444444",
  },
};

Deno.test("#4063 order confirmation uses the unified one-button email and linked SMS", () => {
  const message = buildOrderConfirmationMessage(BASE);
  const email = renderTransactionalEmail({
    variant: "purchase_message",
    recipient: { name: BASE.buyerName, email: BASE.buyerEmail },
    body: message.body,
  });

  assertEquals(email.subject, "You're in: Bachata Takeover, Sat 25 Oct");
  assertEquals(email.html.match(/background:#C4471A/g)?.length, 1);
  assertStringIncludes(
    email.text,
    "Get my tickets: https://usemingla.com/c/AB12CD34EF",
  );
  assertStringIncludes(message.sms, "usemingla.com/c/AB12CD34EF");
  assert(!email.html.includes("Follow"));
  assert(!email.html.includes("Open in Mingla"));
  assert(!email.html.toLowerCase().includes("add to calendar"));
  assert(!email.text.toLowerCase().includes("pdf"));
});

Deno.test("#4063 trip and experience confirmations use booking vocabulary", () => {
  for (const kind of ["trip", "experience"] as const) {
    const message = buildOrderConfirmationMessage({
      ...BASE,
      kind,
      claimed: true,
      quantity: 1,
    });
    assertEquals(message.body.copy.buttonLabel, "Get my booking");
    assertStringIncludes(
      message.body.copy.promise,
      "booking is in your Mingla app",
    );
    assertStringIncludes(
      message.sms,
      "Your booking: usemingla.com/c/AB12CD34EF",
    );
  }
});

Deno.test("#4063 fallback and host-added tickets keep the bounded S1G contract", () => {
  const message = buildOrderConfirmationMessage({
    ...BASE,
    buttonUrl: "https://usemingla.com/download",
    hostAddedGuest: true,
  });
  assertStringIncludes(
    message.sms,
    "Bachata Lagos added you to the guest list",
  );
  assertStringIncludes(message.sms, "usemingla.com/download");
  assert(!message.sms.includes("https://"));
});
