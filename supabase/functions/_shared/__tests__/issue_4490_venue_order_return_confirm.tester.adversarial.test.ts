// #4490 N140 tester adversarial: confirm-on-return must never report "paid"
// unless the finalize RPC itself says finalized/replayed. The amount and
// currency gate lives in pg_venue_order_finalize_payment (proven on the local
// stack: 2,799,999 NGN and 2,800,000 GHS both return amount_or_currency_mismatch
// and the order stays pending), so here the RPC outcomes are stubbed.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
  confirmVenueOrderPaystackOnReturn,
  venueOrderReturnCheckFor,
} from "../venueOrderWebhook.ts";

type RpcResult = Record<string, unknown>;
function client(orderFound: boolean, rpc: RpcResult) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: orderFound ? { id: "o-1", brand_id: "b-1" } : null,
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { data: rpc, error: null };
    },
  };
}
const verifyAs = (txn: Record<string, unknown>) => async () => txn;
const ok = { status: "success", amount: 2800000, currency: "NGN", id: 1 };

Deno.test("N140 adv: an amount/currency mismatch from the RPC is never confirmed", async () => {
  const c = client(true, { matched: true, status: "amount_or_currency_mismatch" });
  assertEquals(await confirmVenueOrderPaystackOnReturn(c as never, "ref-1", verifyAs(ok)), "in_progress");
});

Deno.test("N140 adv: a reference with no order is never confirmed", async () => {
  const c = client(false, { matched: true, status: "finalized" });
  assertEquals(await confirmVenueOrderPaystackOnReturn(c as never, "ref-x", verifyAs(ok)), "in_progress");
  assertEquals(c.calls.length, 0);
});

Deno.test("N140 adv: Paystack's own amount and currency go to the gate, not the order's", async () => {
  const c = client(true, { matched: true, status: "amount_or_currency_mismatch" });
  await confirmVenueOrderPaystackOnReturn(c as never, "ref-1", verifyAs({ ...ok, amount: 100, currency: "ghs" }));
  assertEquals(c.calls[0].p_paid_amount_cents, 100);
  assertEquals(c.calls[0].p_currency, "GHS");
});

Deno.test("N140 adv: malformed provider evidence throws (caller shows 'in progress', never paid)", async () => {
  const c = client(true, { matched: true, status: "finalized" });
  await assertRejects(() => confirmVenueOrderPaystackOnReturn(c as never, "ref-1", verifyAs({ ...ok, amount: "lots" })));
  assertEquals(c.calls.length, 0);
});

Deno.test("N140 adv: declined, abandoned, reversed and unknown states are never paid", async () => {
  for (const s of ["failed", "abandoned", "reversed", "ABANDONED"]) assertEquals(venueOrderReturnCheckFor(s), "not_paid");
  for (const s of ["ongoing", "pending", "queued", "", "processing"]) assertEquals(venueOrderReturnCheckFor(s), "in_progress");
  const c = client(true, { matched: true, status: "finalized" });
  assertEquals(await confirmVenueOrderPaystackOnReturn(c as never, "ref-1", verifyAs({ ...ok, status: "failed" })), "not_paid");
  assertEquals(c.calls.length, 0);
});
