import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLAIM_LINK_BASE,
  mintClaimLink,
  mintRedirectLink,
} from "../claimLink.ts";
import { resolveBuyerLink } from "../messageLinks.ts";
import {
  cardFromPaystackAuthorization,
  cardFromStripeCharge,
  formatCardDisplay,
  loadStripePaymentCard,
  recordTicketPaymentCard,
} from "../paymentCard.ts";

function rpcAdmin(
  response: { data: unknown; error: { message?: string } | null },
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(response);
    },
  };
}

Deno.test("#4063 derives public claim URLs from validated RPC codes", async () => {
  const admin = rpcAdmin({
    data: { code: "8kq2abcd7z", claimed: true },
    error: null,
  });
  assertEquals(await mintClaimLink(admin, "order", "order-id"), {
    code: "8KQ2ABCD7Z",
    url: `${CLAIM_LINK_BASE}8KQ2ABCD7Z`,
    display: "usemingla.com/c/8KQ2ABCD7Z",
    claimed: true,
  });
  assertEquals(admin.calls, [{
    name: "mint_claim_link",
    args: { p_subject_kind: "order", p_subject_id: "order-id" },
  }]);
});

Deno.test("#4063 mints redirect links with the exact waitlist RPC contract", async () => {
  const admin = rpcAdmin({ data: [{ code: "ABC123DE45" }], error: null });
  const link = await mintRedirectLink(
    admin,
    "waitlist_offer",
    "waitlist-id",
    "https://host.usemingla.com/checkout/offer",
    "2026-10-25T20:00:00.000Z",
  );
  assertEquals(link?.display.length, 26);
  assertEquals(admin.calls[0], {
    name: "mint_redirect_link",
    args: {
      p_subject_kind: "waitlist_offer",
      p_subject_id: "waitlist-id",
      p_target_url: "https://host.usemingla.com/checkout/offer",
      p_expires_at: "2026-10-25T20:00:00.000Z",
    },
  });
});

Deno.test("#4063 rejects malformed mint output and applies safe fallbacks", async () => {
  const admin = rpcAdmin({ data: { code: "not-a-code" }, error: null });
  assertEquals(
    await mintClaimLink(admin, "reservation", "reservation-id"),
    null,
  );
  assertEquals(
    await resolveBuyerLink(admin, {
      kind: "rsvp_primary",
      sourceId: "rsvp-id",
    }),
    {
      url: "https://usemingla.com/download",
      display: "usemingla.com/download",
      isShort: false,
      claimed: false,
      fallback: true,
    },
  );

  const targetUrl = "https://host.usemingla.com/checkout/offer";
  assertEquals(
    await resolveBuyerLink(admin, {
      kind: "waitlist_offer",
      sourceId: "waitlist-id",
      targetUrl,
      expiresAt: "2026-10-25T20:00:00.000Z",
    }),
    {
      url: targetUrl,
      display: "",
      isShort: false,
      claimed: false,
      fallback: true,
    },
  );
});

Deno.test("#4063 resolves primary RSVP to the database rsvp claim kind", async () => {
  const admin = rpcAdmin({
    data: { code: "1A2B3C4D5E", claimed: false },
    error: null,
  });
  const link = await resolveBuyerLink(admin, {
    kind: "rsvp_primary",
    sourceId: "rsvp-id",
  });
  assertEquals(link.isShort, true);
  assertEquals(link.claimed, false);
  assertEquals(admin.calls[0].args.p_subject_kind, "rsvp");
});

Deno.test("#4063 extracts only valid provider-reported card metadata", () => {
  assertEquals(
    cardFromStripeCharge({
      payment_method_details: {
        type: "card",
        card: {
          brand: "american_express",
          last4: "4242",
          wallet: { type: "apple_pay" },
        },
      },
    }),
    { brand: "amex", last4: "4242", wallet: "apple_pay" },
  );
  assertEquals(
    cardFromStripeCharge({
      payment_method_details: { type: "cashapp", card: { last4: "4242" } },
    }),
    null,
  );
  assertEquals(
    cardFromPaystackAuthorization(
      { brand: null, card_type: "Master", last4: "1111" },
      "card",
    ),
    { brand: "mastercard", last4: "1111", wallet: null },
  );
  assertEquals(
    cardFromPaystackAuthorization({ brand: "visa", last4: "12x4" }, "card"),
    null,
  );
  assertEquals(
    cardFromPaystackAuthorization({ brand: "visa", last4: "4242" }, "bank"),
    null,
  );
});

Deno.test("#4063 Stripe card lookup is bounded and fail-open", async () => {
  assertEquals(
    await loadStripePaymentCard(
      () =>
        Promise.resolve({
          payment_method_details: {
            type: "card",
            card: { brand: "visa", last4: "4242" },
          },
        }),
      25,
    ),
    { brand: "visa", last4: "4242", wallet: null },
  );
  assertEquals(
    await loadStripePaymentCard(
      () => new Promise(() => {}),
      1,
    ),
    null,
  );
  assertEquals(
    await loadStripePaymentCard(
      () => Promise.reject(new Error("provider unavailable")),
      25,
    ),
    null,
  );
});

// [TEST-MOD-APPROVED #4063] Keep card capture on provider-verified payment rails.
Deno.test("#4063 wires display-safe card capture to authoritative payment paths", async () => {
  const stripeWebhook = await Deno.readTextFile(
    new URL("../stripeWebhookRouter.ts", import.meta.url),
  );
  const paystackWebhook = await Deno.readTextFile(
    new URL("../paystackWebhookRouter.ts", import.meta.url),
  );
  const confirm = await Deno.readTextFile(
    new URL("../../ticket-checkout-confirm/index.ts", import.meta.url),
  );

  assert(stripeWebhook.includes("stripe.charges.retrieve("));
  assert(stripeWebhook.includes("recordTicketPaymentCard(supabase"));
  assert(paystackWebhook.includes("txn?.authorization"));
  assert(paystackWebhook.includes("cardFromPaystackAuthorization("));
  assert(confirm.includes("stripe.charges.retrieve("));
  assert(confirm.includes("recordTicketPaymentCard(supabase"));
});

Deno.test("#4063 formats the complete card-brand display vocabulary", () => {
  const cases: Array<[string, string]> = [
    ["visa", "Visa"],
    ["master", "Mastercard"],
    ["american express", "Amex"],
    ["discover", "Discover"],
    ["diners club", "Diners Club"],
    ["jcb", "JCB"],
    ["china unionpay", "UnionPay"],
    ["verve", "Verve"],
    ["eftpos_au", "eftpos"],
    ["unknown", "Card"],
  ];
  for (const [input, display] of cases) {
    assertEquals(formatCardDisplay(input, "4242"), `${display} •••• 4242`);
  }
  assertEquals(formatCardDisplay("visa", "999"), "");
});

Deno.test("#4063 records payment card metadata and never throws on RPC failure", async () => {
  const admin = rpcAdmin({ data: { outcome: "recorded" }, error: null });
  assert(
    await recordTicketPaymentCard(admin, {
      checkoutSessionId: "checkout-id",
      card: { brand: "visa", last4: "4242", wallet: "google_pay" },
    }),
  );
  assertEquals(admin.calls[0], {
    name: "issue_4063_record_payment_card",
    args: {
      p_checkout_session_id: "checkout-id",
      p_brand: "visa",
      p_last4: "4242",
      p_wallet: "google_pay",
    },
  });

  const failing = {
    rpc(): Promise<{ data: unknown; error: null }> {
      return Promise.reject(new Error("network"));
    },
  };
  assertEquals(
    await recordTicketPaymentCard(failing, {
      checkoutSessionId: "checkout-id",
      card: { brand: "visa", last4: "4242", wallet: null },
    }),
    false,
  );
});
