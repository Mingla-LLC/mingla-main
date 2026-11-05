// Issue #4271 — ticket-checkout-create's doorCode arm, implementor happy path.
//   The basket is the code's lines: anything the browser sent about tickets,
//   prices, discounts, dates or plans is dropped, the surface is forced to
//   web, and a code that is not open/opened (or has expired) answers 409
//   door_code_unavailable with its status. The session is linked under the
//   code lock, and the provider returns the guest to /pay/door/<code>?paid=1.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  doorPayStripeUrls,
  doorStripeExpiresAt,
  linkDoorPaySession,
  resolveDoorPayCheckout,
} from "../doorPayCheckout.ts";
import { FakeDb } from "../../_shared/__tests__/doorPayFakes.ts";

const EVENT = "42710000-0000-4000-8000-0000000000c1";
const TIER = "42710000-0000-4000-8000-0000000000c2";
const DATE = "42710000-0000-4000-8000-0000000000c3";
const CODE_ID = "42710000-0000-4000-8000-0000000000c4";
const NOW = Date.parse("2026-11-04T20:00:00Z");

function dbWith(row: Record<string, unknown> | null, linkResult: unknown = "linked") {
  return new FakeDb(
    () => ({ data: row, error: null }),
    (name) =>
      name === "issue_4271_door_pay_code_link_session"
        ? { data: linkResult, error: null }
        : { data: null, error: { message: "unexpected" } },
  );
}

const DOOR = {
  codeId: CODE_ID,
  code: "ABCD2345",
  expiresAt: new Date(NOW + 60_000).toISOString(),
};

const OPEN_ROW = {
  id: CODE_ID,
  code: "ABCD2345",
  event_id: EVENT,
  event_date_id: DATE,
  lines: [{ ticketTypeId: TIER, quantity: 2 }],
  status: "opened",
  expires_at: new Date(NOW + 60_000).toISOString(),
};

Deno.test("#4271 a door code rebuilds the checkout from the code alone", async () => {
  const result = await resolveDoorPayCheckout(dbWith(OPEN_ROW), {
    doorCode: "abcd2345",
    eventId: EVENT,
    lines: [{ ticketTypeId: "cheap-tier", quantity: 9 }],
    surface: "native",
    discountCode: "FREE100",
    payment_plan_choice: "installments",
    checkoutContractVersion: 2,
    buyer: { name: "Phone Guest", email: "g@example.test", phone: "+12025550101" },
    purchaseTermsAccepted: true,
  }, NOW);
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.door, {
    codeId: CODE_ID,
    code: "ABCD2345",
    expiresAt: OPEN_ROW.expires_at,
  });
  assertEquals(result.body, {
    buyer: { name: "Phone Guest", email: "g@example.test", phone: "+12025550101" },
    purchaseTermsAccepted: true,
    eventId: EVENT,
    eventDateId: DATE,
    lines: [{ ticketTypeId: TIER, quantity: 2 }],
    surface: "web",
    mode: "create",
    doorCode: "ABCD2345",
  });
});

Deno.test("#4271 a paid, cancelled or expired code refuses a checkout", async () => {
  for (const [row, status] of [
    [{ ...OPEN_ROW, status: "paid" }, "paid"],
    [{ ...OPEN_ROW, status: "cancelled" }, "cancelled"],
    [{ ...OPEN_ROW, status: "open", expires_at: new Date(NOW - 1).toISOString() }, "expired"],
    [null, "not_found"],
  ] as const) {
    const result = await resolveDoorPayCheckout(dbWith(row), { doorCode: "ABCD2345" }, NOW);
    assert(!result.ok);
    if (result.ok) return;
    assertEquals(result.status, 409);
    assertEquals(result.body, { error: "door_code_unavailable", status });
  }
});

Deno.test("#4271 a door checkout names this code's event and needs the terms box", async () => {
  const buyer = { name: "G", email: "g@example.test", phone: "+12025550101" };
  const wrongEvent = await resolveDoorPayCheckout(dbWith(OPEN_ROW), {
    doorCode: "ABCD2345", eventId: "42710000-0000-4000-8000-0000000000ff",
    buyer, purchaseTermsAccepted: true,
  }, NOW);
  assert(!wrongEvent.ok);
  if (!wrongEvent.ok) {
    assertEquals(wrongEvent.status, 409);
    assertEquals(wrongEvent.body, { error: "door_code_unavailable", status: "not_found" });
  }
  const noTerms = await resolveDoorPayCheckout(dbWith(OPEN_ROW), { doorCode: "ABCD2345", buyer }, NOW);
  assert(!noTerms.ok);
  if (!noTerms.ok) assertEquals(noTerms.body, { error: "purchase_terms_required" });
  // The guest page sends the box inside buyer and no eventId.
  const guestPage = await resolveDoorPayCheckout(dbWith(OPEN_ROW), {
    doorCode: "ABCD2345", buyer: { ...buyer, termsAccepted: true },
  }, NOW);
  assert(guestPage.ok);
  if (guestPage.ok) {
    assertEquals(guestPage.body.eventId, EVENT);
    assertEquals(guestPage.body.purchaseTermsAccepted, true);
  }
});

Deno.test("#4271 the session is linked under the code lock", async () => {
  const ok = await linkDoorPaySession(dbWith(null, "linked"), DOOR, "s1");
  assertEquals(ok, { ok: true });
  const paid = await linkDoorPaySession(dbWith(null, "paid"), DOOR, "s1");
  assertEquals(paid, { ok: false, status: "paid" });
});

Deno.test("#4271 the provider returns the guest to the code's pay page", () => {
  assertEquals(
    doorPayStripeUrls("https://host.usemingla.com", DOOR),
    {
      successUrl: "https://host.usemingla.com/pay/door/ABCD2345?paid=1",
      cancelUrl: "https://host.usemingla.com/pay/door/ABCD2345",
    },
  );
});

Deno.test("#4271 ticket-checkout-create wires the door arm in order", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const resolveAt = src.indexOf("await resolveDoorPayCheckout(");
  const tokenAt = src.indexOf("const ticketLinkToken = body.ticketLinkToken");
  assert(resolveAt > 0 && resolveAt < tokenAt, "door code must replace the body before it is read");
  const sessionIdAt = src.indexOf('const checkoutSessionId = String(session.checkoutSessionId ?? "");');
  const linkAt = src.indexOf("await linkDoorPaySession(");
  assert(sessionIdAt > 0 && linkAt > sessionIdAt, "the session must be linked once it exists");
  // The door return URLs use the web branch's validated BUSINESS_WEB_ORIGIN
  // (ISSUE-927: exactly one canonical read in this file).
  assert(src.includes("({ successUrl, cancelUrl } = doorPayStripeUrls(baseUrl, doorPay));"));
  assertEquals(src.split('Deno.env.get("BUSINESS_WEB_ORIGIN")').length - 1, 1);
  assert(src.includes("callbackUrl: providerCallbackUrl,"));
  assert(src.includes("returnUrl: providerCallbackUrl,"));
});

Deno.test("#4271 rework: the guest's Stripe page closes with the code, never the 24-hour default", () => {
  // The code has 1 minute left: Stripe's 30-minute floor (+1 minute of skew).
  assertEquals(doorStripeExpiresAt(DOOR, NOW), Math.ceil((NOW + 31 * 60_000) / 1000));
  // A code that outlives the floor closes the page when the code ends.
  const late = { ...DOOR, expiresAt: new Date(NOW + 45 * 60_000).toISOString() };
  assertEquals(doorStripeExpiresAt(late, NOW), Math.ceil((NOW + 45 * 60_000) / 1000));
});

Deno.test("#4271 rework: the door checkout prices and creates inside the door wrappers", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  // The quote: a door code reads issue_4271_door_ticket_quote, nothing else does.
  const quoteAt = src.indexOf('"issue_4271_door_ticket_quote"');
  const plainQuoteAt = src.indexOf('supabase.rpc("issue_3872_ticket_quote"');
  assert(quoteAt > 0 && quoteAt < plainQuoteAt, "door quote branch must come first");
  assert(src.slice(src.lastIndexOf("if (doorPay !== null) {", quoteAt), quoteAt).length < 200);
  // Create-session: the door wrapper sits before the plain create in the chain.
  assert(src.includes(": doorSessionCall !== null\n      ? doorSessionCall\n      : await supabase.rpc("));
  assert(src.includes('"issue_4271_door_checkout_create_session"'));
  // Stripe page expiry is set for door codes only.
  assert(src.includes("? { expires_at: doorStripeExpiresAt(doorPay) }"));
});
