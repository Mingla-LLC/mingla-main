// MINGLA-INVARIANT: I-4522-CANCEL-PASS9-TRUTH | issue #4522 | A second-provider cancel refund whose send failed before the provider was asked is handed back as not sent (never "sent, no answer") and counted as a failure; ops alerts about a counted seat or add-on refund say exactly what Mingla sends automatically, holds, or waits on; a card charge asked with no recorded answer is never called "not refunded".
/**
 * issue #4522 pass 9 (P9-2 / P9-3 / P9-4 / P9-5), edge side.
 * FAILS ON REVERT: without paystackRefundNotSent the import fails (P9-5a/b);
 * without the unclaim branch P9-5c fails; without the requested state P9-4
 * reads "not refunded yet"; the old shortfall text fails P9-2; without the
 * unresolved kind P9-3 fails; without isShortfallPart P9-2b fails.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  createPaystackRefund,
  paystackRefundNotSent,
} from "../../_shared/paystackRefunds.ts";
import {
  alertTripCancelNotFinished,
  tripCancelShortfallParagraphs,
  tripCancelShortfallSubject,
} from "../../_shared/installments/unrecordedRefunds.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function paystackFetch(listStatus: number, postStatus: number): () => void {
  const real = globalThis.fetch;
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue4522");
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const json = (status: number, body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url.includes("/transaction/verify/")) {
      return json(200, { status: true, data: { id: 4522, reference: "ref-4522", amount: 100_000_000, currency: "NGN", status: "success" } });
    }
    if (url.includes("/refund?")) {
      return listStatus === 200 ? json(200, { status: true, data: [] }) : json(listStatus, { status: false, message: "list down" });
    }
    if (url.endsWith("/refund") && method === "POST") {
      return json(postStatus, { status: false, message: "provider error" });
    }
    return json(404, { status: false });
  };
  return () => {
    globalThis.fetch = real;
  };
}

Deno.test("P9-5a a refund-list read error before sending is 'not sent'", async () => {
  const restore = paystackFetch(503, 200);
  let posted = false;
  const inner = globalThis.fetch;
  globalThis.fetch = (i: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") posted = true;
    return inner(i, init);
  };
  try {
    const err = await assertRejects(() =>
      createPaystackRefund({ transaction: "ref-4522", merchantNote: "mingla_trip_refund:r1:deposit", amountSubunits: 50_000_000, currency: "NGN" })
    );
    assert(paystackRefundNotSent(err), "a pre-send failure must read as not sent");
    assertEquals(posted, false);
  } finally {
    restore();
  }
});

Deno.test("P9-5b a failure answering the send itself is never 'not sent'", async () => {
  const restore = paystackFetch(200, 503);
  try {
    const err = await assertRejects(() =>
      createPaystackRefund({ transaction: "ref-4522", merchantNote: "mingla_trip_refund:r1:deposit", amountSubunits: 50_000_000, currency: "NGN" })
    );
    assertEquals(paystackRefundNotSent(err), false);
    assertEquals(paystackRefundNotSent(new Error("x")), false);
  } finally {
    restore();
  }
});

Deno.test("P9-5c the cancel hands a not-sent claim back before any refusal handling, then counts the failure", () => {
  const at = source.indexOf("paystackRefundNotSent(sendErr)");
  const unclaim = source.indexOf('"issue_4522_unclaim_trip_paystack_send"', at);
  const release = source.indexOf("p_release: true", at);
  assert(at > 0 && unclaim > at && release > unclaim, "unclaim must come first");
  assert(source.slice(unclaim, release).includes("throw sendErr;"));
});

Deno.test("P9-4 a card charge asked of the provider with no recorded answer is never 'not refunded yet'", async () => {
  let text = "";
  const capture = (_s: string, p: string[]) => {
    text = p.join("\n");
    return Promise.resolve();
  };
  const base = {
    orderId: "o1", refundId: "r1", currency: "usd", detail: "issue_2097_record_buyer_refund:buyer_refund_amount_conflict",
    made: [], intended: [{ installment_id: null, source_pi: "pi_1", refund_cents: 50_000 }], unconfirmed: [], cause: "failure" as const,
  };
  await alertTripCancelNotFinished(capture, { ...base, requested: ["pi_1"] });
  assert(!text.includes("not refunded yet"));
  assertStringIncludes(text, "may already be refunded there");
  await alertTripCancelNotFinished(capture, base);
  assertStringIncludes(text, "not refunded yet");
});

Deno.test("P9-2 the owed amount alert says what is sent automatically, or why it is held", () => {
  const sent = tripCancelShortfallParagraphs({ kind: "shortfall", owed_cents: 25_000_000, currency: "ngn", tier_pct: 50, failed_refund_cents: 50_000_000, shortfall_refund_id: "sf1" }).join("\n");
  assertStringIncludes(sent, "Mingla is sending it automatically, once, on the same payment");
  assertStringIncludes(sent, "Owed and being sent: 25000000 NGN");
  assert(!sent.includes("Admin (order refund)"));
  const held = tripCancelShortfallParagraphs({ kind: "shortfall", held: true, owed_cents: 25_000_000, currency: "ngn" }).join("\n");
  assertStringIncludes(held, "has NOT sent the difference automatically");
  assertStringIncludes(tripCancelShortfallSubject({ kind: "shortfall", held: true }), "not sent");
  const overlap = tripCancelShortfallParagraphs({ kind: "overlap", owed_cents: 1, currency: "ngn" }).join("\n");
  assertStringIncludes(overlap, "escalate to finance");
});

Deno.test("P9-2b an owed part sent after the cancel sends no second cancellation notice", () => {
  assertStringIncludes(source, 'const isShortfallPart = typeof begin.shortfall_of === "object"');
  const notice = source.indexOf("const { error: notif1Err } = isShortfallPart ? { error: null } :");
  assert(notice > 0 && source.indexOf('template_key: "buyer_order_cancelled"', notice) > notice);
});

Deno.test("P9-3 a counted refund still pending past the ceiling names the amount at stake and sends nothing", () => {
  const row = { kind: "unresolved", order_id: "o1", cancel_refund_id: "c1", failed_refund_id: "s1", pending_refund_cents: 50_000, owed_cents: 25_000, tier_pct: 50, currency: "usd" };
  const text = tripCancelShortfallParagraphs(row).join("\n");
  assertStringIncludes(text, "At stake for the traveler if it never goes through: 25000 USD");
  assertStringIncludes(text, "Nothing has been sent automatically");
  assertStringIncludes(text, "host pressing Refund again on that seat");
  assertStringIncludes(tripCancelShortfallSubject(row), "not finished");
});
