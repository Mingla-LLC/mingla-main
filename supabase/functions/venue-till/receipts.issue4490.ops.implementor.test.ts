// #4490 spec 08 O1 receipts (T20) — the Till receipt end to end at the edge:
// the anonymous receipt page reads one payment only with its token; staff send
// a receipt by text and/or email (phone and email checked, token hash minted);
// the drain builds the private link when the message is SENT; notify-dispatch
// accepts only that exact link; the email is itemised from the snapshot.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createVenueTillHandler, type TillClient, tillSafeCode } from "./index.ts";
import {
  buildTillReceiptUrl,
  deriveTillReceiptToken,
  rederiveTillReceiptToken,
  tillReceiptTokenHashHex,
  tillReceiptUrlPaymentId,
  trustedTillReceiptUrl,
} from "../_shared/venueTillReceiptToken.ts";
import {
  renderTillReceiptEmailBody,
  tillReceiptEmailCta,
  tillReceiptSms,
} from "../_shared/email/tillReceiptEmail.ts";
import { renderCategoryMessage } from "../_shared/notifyTemplates.ts";
import { resolveTillReceiptDispatch } from "../notify-outbox-drain/index.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const PAYMENT = "00000000-4490-4000-8000-0000000000e1";
const OTHER_PAYMENT = "00000000-4490-4000-8000-0000000000e9";
const STAFF = "00000000-4490-4000-8000-0000000000f1";
const KEY = { kid: "k1", key: new Uint8Array(32).fill(7) };
// deno-lint-ignore no-explicit-any
const RING: any = { ok: true, current: KEY, previous: null };
const ORIGIN = "http://localhost:8491";
const env = (name: string) =>
  ({
    SUPABASE_URL: "http://kong:8000",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    BUSINESS_WEB_ORIGIN: ORIGIN,
  } as Record<string, string>)[name];

type Call = { name: string; params: Record<string, unknown> };

function client(
  calls: Call[],
  rpc: (name: string, p: Record<string, unknown>) => { data: unknown; error: unknown },
  user: string | null = STAFF,
): TillClient {
  return {
    from: () => {
      throw new Error("no table reads expected");
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      // TEST-MOD-APPROVED #4490 (08-O5 part A): the PIN gate answers "not a Till device" for these accounts, as the database does.
      if (name === "issue_4490_pin_gate") return Promise.resolve({ data: false, error: null });
      calls.push({ name, params });
      return Promise.resolve(rpc(name, params));
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: user ? { id: user } : null },
          error: user ? null : new Error("bad"),
        }),
    },
  };
}

function req(body: Record<string, unknown>, jwt: string | null = "staff.jwt.sig"): Request {
  return new Request("http://local/venue-till", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const RECEIPT = {
  receiptNo: 12,
  venueName: "Gameland QA",
  venueAddress: "1 Admiralty Way, Lagos",
  currency: "NGN",
  paidAt: "2026-11-22T20:40:00Z",
  timezone: "Africa/Lagos",
  lines: [
    { label: "Chapman", quantity: 2, amountMinor: 500000, modifiers: ["No ice"] },
    { label: "Walk-in", quantity: 1, amountMinor: 537500, modifiers: [] },
  ],
  subtotalMinor: 1037500,
  serviceChargeMinor: 50000,
  taxIncludedMinor: 37500,
  totalMinor: 1087500,
  paidBeforeMinor: 400000,
  payment: {
    method: "cash",
    amountMinor: 587500,
    tipMinor: 0,
    cashGivenMinor: 1500000,
    changeMinor: 912500,
    paidLate: false,
    reference: "A4CCF3B1",
  },
  refundedMinor: 0,
  footer: "Thank you. See you soon.",
};

// ---------------------------------------------------------------- the page

Deno.test("R-1 receipt_view is anonymous and hashes the token for the server", async () => {
  const token = await deriveTillReceiptToken({ paymentId: PAYMENT, key: KEY });
  const calls: Call[] = [];
  const handle = createVenueTillHandler({
    env,
    client: () => client(calls, () => ({ data: RECEIPT, error: null }), null),
  });
  const res = await handle(req({ action: "receipt_view", paymentId: PAYMENT, token }, null));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.receipt.receiptNo, 12);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "issue_4490_till_receipt_view");
  assertEquals(calls[0].params.p_payment_id, PAYMENT);
  assertEquals(calls[0].params.p_token_hash, `\\x${await tillReceiptTokenHashHex(token)}`);
});

Deno.test("R-2 a bad-shaped token or id never reaches the database; a wrong token is the same 404", async () => {
  const calls: Call[] = [];
  const handle = createVenueTillHandler({
    env,
    client: () => client(calls, () => ({ data: null, error: { message: "receipt_not_found", code: "P0002" } }), null),
  });
  for (const body of [
    { action: "receipt_view", paymentId: PAYMENT, token: "nope" },
    { action: "receipt_view", paymentId: "not-a-uuid", token: `k1.${"a".repeat(43)}` },
    { action: "receipt_view", paymentId: PAYMENT },
  ]) {
    const res = await handle(req(body, null));
    assertEquals(res.status, 404);
    assertEquals((await res.json()).code, "receipt_not_found");
  }
  assertEquals(calls.length, 0);
  const res = await handle(req({ action: "receipt_view", paymentId: PAYMENT, token: `k1.${"a".repeat(43)}` }, null));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).code, "receipt_not_found");
  assertEquals(calls.length, 1);
});

Deno.test("R-3 any other database failure on the page is a plain 500, never a raw message", async () => {
  const handle = createVenueTillHandler({
    env,
    client: () => client([], () => ({ data: null, error: { message: "relation x does not exist", code: "42P01" } }), null),
  });
  const res = await handle(req({ action: "receipt_view", paymentId: PAYMENT, token: `k1.${"a".repeat(43)}` }, null));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { code: "till_failed" });
});

// ---------------------------------------------------------------- sending

const sendHandler = (calls: Call[], rpc?: (name: string) => { data: unknown; error: unknown }) =>
  createVenueTillHandler({
    env,
    receiptTokenHash: () => Promise.resolve("ab".repeat(32)),
    client: () =>
      client(calls, (name) =>
        rpc ? rpc(name) : { data: { queued: { sms: true, email: true }, sendsLeft: 2 }, error: null }),
  });

Deno.test("R-4 sending needs a signed-in member", async () => {
  const calls: Call[] = [];
  const res = await sendHandler(calls)(req({ action: "receipt", venueId: VENUE, paymentId: PAYMENT, email: "a@b.co" }, null));
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("R-5 a national number with its country becomes E.164; email is lower-cased; the token hash rides along", async () => {
  const calls: Call[] = [];
  const res = await sendHandler(calls)(req({
    action: "receipt",
    venueId: VENUE,
    paymentId: PAYMENT,
    phone: "0803 123 4567",
    phoneCountryIso: "NG",
    email: "Ada@Example.COM",
  }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data, { queued: { sms: true, email: true }, sendsLeft: 2 });
  const send = calls.find((c) => c.name === "issue_4490_till_receipt_send");
  assert(send);
  assertEquals(send.params, {
    p_payment_id: PAYMENT,
    p_venue_id: VENUE,
    p_actor: STAFF,
    p_phone_e164: "+2348031234567",
    p_email: "ada@example.com",
    p_token_hash: `\\x${"ab".repeat(32)}`,
  });
});

Deno.test("R-6 a number without a country, a bad email, or nothing at all is refused before the database", async () => {
  const calls: Call[] = [];
  const handle = sendHandler(calls);
  const phoneOnly = await handle(req({ action: "receipt", venueId: VENUE, paymentId: PAYMENT, phone: "12345" }));
  assertEquals(phoneOnly.status, 400);
  assertEquals((await phoneOnly.json()).code, "till_receipt_phone_invalid");
  const usGuess = await handle(req({ action: "receipt", venueId: VENUE, paymentId: PAYMENT, phone: "2025550123" }));
  assertEquals((await usGuess.json()).code, "till_receipt_phone_invalid");
  const badEmail = await handle(req({ action: "receipt", venueId: VENUE, paymentId: PAYMENT, email: "nope@" }));
  assertEquals((await badEmail.json()).code, "till_receipt_email_invalid");
  const nothing = await handle(req({ action: "receipt", venueId: VENUE, paymentId: PAYMENT }));
  assertEquals((await nothing.json()).code, "till_invalid_payload");
  assertEquals(calls.filter((c) => c.name === "issue_4490_till_receipt_send").length, 0);
});

Deno.test("R-7 the fourth send and an unpaid payment map to their own codes", async () => {
  for (const [message, status] of [["till_receipt_limit", 409], ["till_receipt_not_paid", 409]] as const) {
    const res = await sendHandler([], () => ({ data: null, error: { message, code: "PT409" } }))(
      req({ action: "receipt", venueId: VENUE, paymentId: PAYMENT, email: "a@b.co" }),
    );
    assertEquals(res.status, status);
    assertEquals((await res.json()).code, message);
  }
  assertEquals(tillSafeCode({ message: "till_receipt_limit" }), "till_receipt_limit");
});

// ---------------------------------------------------------------- the link

Deno.test("R-8 the link is rebuilt at send time from the payment id and the stored hash", async () => {
  const token = await deriveTillReceiptToken({ paymentId: PAYMENT, key: KEY });
  const hashHex = await tillReceiptTokenHashHex(token);
  assertEquals(await rederiveTillReceiptToken({ paymentId: PAYMENT, storedHashHex: `\\x${hashHex}`, ring: RING }), token);
  assertEquals(await rederiveTillReceiptToken({ paymentId: OTHER_PAYMENT, storedHashHex: hashHex, ring: RING }), null);
  assertEquals(await rederiveTillReceiptToken({ paymentId: PAYMENT, storedHashHex: null, ring: RING }), null);
  const url = buildTillReceiptUrl({ origin: ORIGIN, paymentId: PAYMENT, token });
  assertEquals(url, `${ORIGIN}/receipt/till/${PAYMENT}#t=${token}`);
  assertEquals(tillReceiptUrlPaymentId(url, ORIGIN), PAYMENT);
  assertEquals(tillReceiptUrlPaymentId(`${url}&x=1`, ORIGIN), null);
  assertEquals(tillReceiptUrlPaymentId(url.replace("#t=", "?t="), ORIGIN), null);
  assertEquals(tillReceiptUrlPaymentId(url, "https://evil.example"), null);
});

Deno.test("R-9 the drain reads the receipt and builds the link when the message goes", async () => {
  const token = await deriveTillReceiptToken({ paymentId: PAYMENT, key: KEY });
  const admin = (tokenHashHex: string | null, error: unknown = null) => ({
    rpc: (name: string, params: Record<string, unknown>) => {
      // TEST-MOD-APPROVED #4490 (08-O5 part A): the PIN gate answers "not a Till device" for these accounts, as the database does.
      if (name === "issue_4490_pin_gate") return Promise.resolve({ data: false, error: null });
      assertEquals(name, "issue_4490_till_receipt_link_facts");
      assertEquals(params, { p_payment_id: PAYMENT });
      return Promise.resolve({ data: error ? null : { tokenHashHex, receipt: RECEIPT }, error });
    },
  });
  const row = { id: "o1", category_key: "buyer_till_receipt", payload: { till_payment_id: PAYMENT } };
  const ok = await resolveTillReceiptDispatch(admin(await tillReceiptTokenHashHex(token)), row, env, RING);
  assertEquals(ok.url, `${ORIGIN}/receipt/till/${PAYMENT}#t=${token}`);
  assertEquals((ok.receipt as Record<string, unknown>).receiptNo, 12);
  const noHash = await resolveTillReceiptDispatch(admin(null), row, env, RING);
  assertEquals(noHash.url, null);
  assertEquals((noHash.receipt as Record<string, unknown>).receiptNo, 12);
  await assertRejects(() => resolveTillReceiptDispatch(admin(null, { message: "boom" }), row, env, RING));
  assertEquals(await resolveTillReceiptDispatch(admin(null), { id: "o2", payload: {} }, env, RING), { receipt: null, url: null });
});

Deno.test("R-10 notify-dispatch keeps only the exact link of the same payment, from the service role", async () => {
  const token = await deriveTillReceiptToken({ paymentId: PAYMENT, key: KEY });
  const url = buildTillReceiptUrl({ origin: ORIGIN, paymentId: PAYMENT, token });
  const base = { serviceCaller: true, categoryKey: "buyer_till_receipt", payload: { till_payment_id: PAYMENT }, receiptUrl: url, origin: ORIGIN };
  assertEquals(trustedTillReceiptUrl(base), url);
  assertEquals(trustedTillReceiptUrl({ ...base, serviceCaller: false }), undefined);
  assertEquals(trustedTillReceiptUrl({ ...base, categoryKey: "buyer_door_receipt" }), undefined);
  assertEquals(trustedTillReceiptUrl({ ...base, payload: { till_payment_id: OTHER_PAYMENT } }), undefined);
  assertEquals(trustedTillReceiptUrl({ ...base, origin: "https://host.usemingla.com" }), undefined);
  assertEquals(trustedTillReceiptUrl({ ...base, receiptUrl: undefined }), undefined);
});

// ---------------------------------------------------------------- the message

Deno.test("R-11 the email is itemised from the snapshot: lines, service, tax, tender, change, what is left, footer", () => {
  const body = renderTillReceiptEmailBody(RECEIPT);
  assert(body);
  for (
    const part of [
      "Thanks for coming to Gameland QA.",
      "Receipt 12 · Ref A4CCF3B1",
      "2 × Chapman (No ice)",
      "Walk-in",
      "Service charge",
      "Includes tax",
      "Total",
      "Paid before",
      "Cash",
      "Change",
      "Left to pay",
      "Thank you. See you soon.",
      "1 Admiralty Way, Lagos",
    ]
  ) assert(body.includes(part), part);
  assert(!body.includes("Refunded"));
  const refunded = renderTillReceiptEmailBody({ ...RECEIPT, refundedMinor: 100000 });
  assert(refunded?.includes("Refunded"));
  assertEquals(renderTillReceiptEmailBody({ ...RECEIPT, currency: "" }), null);
});

Deno.test("R-12 the template: itemised email, S15 text with the app claim when there is no web link", () => {
  const rendered = renderCategoryMessage("buyer_till_receipt", {
    venue_name: "Gameland QA",
    till_payment_id: PAYMENT,
    receipt: RECEIPT,
  });
  assertEquals(rendered.email.subject, "Your Gameland QA receipt");
  assert(rendered.email.body.includes("2 × Chapman"));
  assert(rendered.sms.includes("Thanks for coming to Gameland QA"));
  assert(rendered.sms.includes("usemingla.com/download"));
  const withLink = tillReceiptSms("buyer_till_receipt", { venue_name: "Gameland QA" }, `${ORIGIN}/receipt/till/${PAYMENT}#t=k1.x`);
  assertEquals(withLink, `Mingla: Thanks for coming to Gameland QA. Your receipt: ${ORIGIN}/receipt/till/${PAYMENT}#t=k1.x`);
  assertEquals(tillReceiptSms("buyer_door_receipt", {}, "x"), null);
  assertEquals(tillReceiptSms("buyer_till_receipt", {}, undefined), null);
  assertEquals(tillReceiptEmailCta(undefined), undefined);
  assertEquals(tillReceiptEmailCta("u")?.label, "See your receipt");
});

// ---------------------------------------------------------------- refunds

Deno.test("R-13 a card payment (tap / scan) is refunded on its carrier; cash stays a record; one card refund per payment maps to its copy code", async () => {
  for (const [method, expected] of [
    ["tap", "issue_4490_till_mint_carrier_refund"],
    ["scan", "issue_4490_till_mint_carrier_refund"],
    ["cash", "issue_4490_till_refund"],
    ["own_machine", "issue_4490_till_refund"],
  ] as const) {
    const calls: Call[] = [];
    const base = client(calls, () => ({ data: { refundId: "r1", sale: null }, error: null }));
    const handle = createVenueTillHandler({
      env,
      client: () => ({
        ...base,
        from: () => {
          const builder: Record<string, unknown> = {
            select: () => builder,
            eq: () => builder,
            maybeSingle: () =>
              Promise.resolve({
                data: { id: PAYMENT, sale_id: "s1", method, venue_till_sales: { venue_id: VENUE } },
                error: null,
              }),
          };
          return builder;
        },
      }),
    });
    const res = await handle(req({
      action: "refund",
      venueId: VENUE,
      paymentId: PAYMENT,
      amountMinor: 1000,
      tipMinor: 0,
      reason: "Guest asked",
      restock: false,
      clientRequestId: "00000000-4490-4000-8000-0000000000e7",
    }));
    assertEquals(res.status, 200, method);
    assertEquals(calls.map((c) => c.name), [expected], method);
  }
  assertEquals(tillSafeCode({ message: "till_card_refunded_once" }), "till_card_refunded_once");
});
