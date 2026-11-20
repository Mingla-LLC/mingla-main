// N140 (#4490): a Paystack venue order is confirmed ON RETURN through the
// webhook's own finalize path; a return racing the webhook pays it once; a
// payment still in progress is "in_progress" (no second payment offered).
// Fails-on-revert: without confirmVenueOrderPaystackOnReturn the status read
// never finalizes (R-1 fails); mapping "ongoing" to not_paid fails R-2.
import { assertEquals } from "jsr:@std/assert@1";

import {
  confirmVenueOrderPaystackOnReturn,
  venueOrderReturnCheckFor,
} from "../venueOrderWebhook.ts";

function fakeClient() {
  const calls: Array<Record<string, unknown>> = [];
  let paid = false;
  const client = {
    calls,
    from: (_t: string) => ({
      select: (_c: string) => ({
        eq: (_k: string, _v: string) => ({
          maybeSingle: async () => ({ data: { id: "order-1", brand_id: "brand-1" }, error: null }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, ...args });
      if (name !== "pg_venue_order_finalize_payment") return { data: null, error: null };
      // The real function: FOR UPDATE + early return when already paid.
      const status = paid ? "replayed" : "finalized";
      paid = true;
      calls[calls.length - 1].result = status;
      return { data: { status }, error: null };
    },
  };
  return client;
}

Deno.test("R-1 a successful charge is finalized on return through the same RPC", async () => {
  const client = fakeClient();
  const check = await confirmVenueOrderPaystackOnReturn(
    client,
    "mingla_vo_order-1_x",
    async () => ({ status: "success", amount: 2800000, currency: "NGN", id: 99, fees: 100 }),
  );
  assertEquals(check, "confirmed");
  const finalize = client.calls.filter((c) => c.name === "pg_venue_order_finalize_payment");
  assertEquals(finalize.length, 1);
  assertEquals(finalize[0].p_paid_amount_cents, 2800000);
  assertEquals(finalize[0].p_currency, "NGN");
});

Deno.test("R-1b return racing the webhook: confirmed twice, finalized once, replayed once", async () => {
  const client = fakeClient();
  const verify = async () => ({ status: "success", amount: 2800000, currency: "NGN", id: 99, fees: 100 });
  const [a, b] = await Promise.all([
    confirmVenueOrderPaystackOnReturn(client, "mingla_vo_order-1_x", verify),
    confirmVenueOrderPaystackOnReturn(client, "mingla_vo_order-1_x", verify),
  ]);
  assertEquals([a, b], ["confirmed", "confirmed"]);
  const results = client.calls.filter((c) => c.name === "pg_venue_order_finalize_payment").map((c) => c.result).sort();
  assertEquals(results, ["finalized", "replayed"]);
});

Deno.test("R-2 statuses map to what the guest is shown", () => {
  assertEquals(venueOrderReturnCheckFor("success"), "confirmed");
  for (const s of ["ongoing", "pending", "processing", "queued"]) assertEquals(venueOrderReturnCheckFor(s), "in_progress");
  for (const s of ["failed", "abandoned", "reversed"]) assertEquals(venueOrderReturnCheckFor(s), "not_paid");
});

Deno.test("R-3 nothing is finalized while the payment is still in progress", async () => {
  const client = fakeClient();
  const check = await confirmVenueOrderPaystackOnReturn(client, "mingla_vo_order-1_x", async () => ({ status: "ongoing" }));
  assertEquals(check, "in_progress");
  assertEquals(client.calls.length, 0);
});
