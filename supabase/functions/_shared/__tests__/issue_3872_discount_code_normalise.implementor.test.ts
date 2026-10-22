// #3872 D1 — code normalisation and typed SQL RPC wiring.
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  callDiscountQuoteLines,
  callReserveDiscountUses,
  normaliseDiscountCode,
  type DiscountRpcClient,
} from "../discountEngine.ts";

Deno.test("normaliseDiscountCode trims, uppercases, and removes spaces and hyphens", () => {
  assertEquals(normaliseDiscountCode("  amara- 10  "), "AMARA10");
  assertEquals(normaliseDiscountCode(""), null);
  assertEquals(normaliseDiscountCode(" - - "), null);
  assertEquals(normaliseDiscountCode(null), null);
});
Deno.test("normaliseDiscountCode rejects invalid or overlong values", () => {
  for (const value of ["SAVE!", "éclair", "A".repeat(33), 42]) {
    const error = assertThrows(() => normaliseDiscountCode(value));
    assertInstanceOf(error, Error);
    assertEquals(error.message, "invalid_discount_code");
  }
});

Deno.test("quote client sends only the normalised wire contract", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const quote = { digest: "0123456789abcdef0123456789abcdef" };
  const client: DiscountRpcClient = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: quote, error: null });
    },
  };
  const result = await callDiscountQuoteLines(client, {
    brandId: "brand",
    currency: "gbp",
    lines: [],
    code: " amara-10 ",
    buyer: { email: "ada@example.com" },
    at: "2027-01-10T19:00:00Z",
  });
  assertEquals(result, quote);
  assertEquals(calls, [{
    name: "issue_3872_discount_quote_lines",
    args: {
      p_brand_id: "brand",
      p_currency: "GBP",
      p_lines: [],
      p_code: "AMARA10",
      p_buyer: { email: "ada@example.com" },
      p_at: "2027-01-10T19:00:00Z",
    },
  }]);
});

Deno.test("reserve client carries the expected digest and staff channel", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: DiscountRpcClient = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: { ok: true, quote: {} }, error: null });
    },
  };
  await callReserveDiscountUses(client, {
    kind: "venue_order",
    refId: "order",
    brandId: "brand",
    currency: "ngn",
    lines: [],
    expectedDigest: "digest",
    expiresAt: "2027-01-10T19:30:00Z",
    consume: true,
    channel: "staff",
  });
  assertEquals(calls[0], {
    name: "issue_3872_reserve_discount_uses",
    args: {
      p_kind: "venue_order",
      p_ref_id: "order",
      p_brand_id: "brand",
      p_currency: "NGN",
      p_lines: [],
      p_code: null,
      p_buyer: {},
      p_expected_digest: "digest",
      p_expires_at: "2027-01-10T19:30:00Z",
      p_consume: true,
      p_channel: "staff",
    },
  });
});

Deno.test("RPC errors fail closed", async () => {
  const client: DiscountRpcClient = {
    rpc() {
      return Promise.resolve({ data: null, error: { message: "boom" } });
    },
  };
  await assertRejects(
    () => callDiscountQuoteLines(client, {
      brandId: "brand",
      currency: "GBP",
      lines: [],
    }),
    Error,
    "discount_quote_failed:boom",
  );
});

