// #4490 spec 08 O2 fix 1 (O2-T5, P1) — deploy order. Merging auto-deploys
// supabase/functions to production; until the #4490 migrations are applied,
// venue_orders has no till_payment_id and PostgREST answers a select naming it
// with 42703. LIVE guest ordering runs two shared reads that O2 widened with
// that column: the Paystack venue-order charge (handleVenueOrderPaystackCharge)
// and the "new order" push (fireVenueOrderPlacedForOrder). This suite models a
// pre-migration database and asserts both still behave exactly as before O2:
// the charge finalizes and the venue gets its push. Any other lookup error is
// still thrown (never swallowed).
//
// FAILS-ON-REVERT: drop the 42703 fallback in either module and the first two
// tests fail (the charge throws venue_order_paystack_lookup_failed; no push).
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handleVenueOrderPaystackCharge } from "../venueOrderWebhook.ts";
import { fireVenueOrderPlacedForOrder } from "../venueOrderNotify.ts";
import { isMissingTillPaymentColumn } from "../tillMigrationCompat.ts";

const ORDER = "44900800-0000-4000-8000-0000000000a1";
const BRAND = "44900800-0000-4000-8000-0000000000b1";
const VENUE = "44900800-0000-4000-8000-0000000000c1";
const OWNER = "44900800-0000-4000-8000-0000000000d1";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown; count?: number };

/** A PostgREST-shaped client for a database WITHOUT the #4490 columns. */
function preMigrationClient(opts: { lookupError?: { code: string; message: string } } = {}) {
  const selects: string[] = [];
  const rpcs: Array<{ name: string; args: Row }> = [];
  const order: Row = {
    id: ORDER,
    brand_id: BRAND,
    venue_id: VENUE,
    currency: "NGN",
    total_cents: 550000,
    spot_label_at_order: "Table 4",
    pickup_code: null,
    buyer_name: "Ada",
    metadata: {},
  };
  function from(table: string) {
    let columns = "";
    const answer = (): Result => {
      if (table === "venue_orders") {
        selects.push(columns);
        if (opts.lookupError) return { data: null, error: opts.lookupError };
        if (/\btill_payment_id\b/.test(columns)) {
          return {
            data: null,
            error: {
              code: "42703",
              message: "column venue_orders.till_payment_id does not exist",
            },
          };
        }
        return { data: order, error: null };
      }
      if (table === "venue_order_items") return { data: null, error: null, count: 2 };
      if (table === "brand_team_members") {
        return { data: [{ user_id: OWNER, role: "owner" }], error: null };
      }
      return { data: null, error: null };
    };
    const q: Record<string, unknown> = {
      select: (c: string) => ((columns = c), q),
      eq: () => q,
      is: () => q,
      not: () => q,
      in: () => q,
      update: () => q,
      maybeSingle: () => Promise.resolve(answer()),
      single: () => Promise.resolve(answer()),
      then: (resolve: (v: Result) => void) => resolve(answer()),
    };
    return q;
  }
  const client = {
    from,
    rpc: (name: string, args: Row) => {
      rpcs.push({ name, args });
      return Promise.resolve({ data: { status: "finalized" }, error: null });
    },
  };
  return { client, selects, rpcs };
}

/** Captures what notify-dispatch would be asked to send. */
async function withDispatchCapture(run: () => Promise<void>): Promise<Row[]> {
  const sent: Row[] = [];
  const realFetch = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", "http://local.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return sent;
}

Deno.test("O2F1-D1 before the #4490 migrations a Paystack guest-order charge still finalizes and the venue still gets its new-order push", async () => {
  const db = preMigrationClient();
  let result: Row = {};
  const sent = await withDispatchCapture(async () => {
    result = await handleVenueOrderPaystackCharge(db.client, "mingla_vo_guest_1", {
      amount: 550000,
      currency: "NGN",
      channel: "card",
      id: 4242,
      fees: 8250,
    }) as unknown as Row;
  });
  assertEquals(result.matched, true);
  assertEquals(result.status, "finalized");
  assertEquals(result.orderId, ORDER);
  const fin = db.rpcs.filter((r) => r.name === "pg_venue_order_finalize_payment");
  assertEquals(fin.length, 1);
  assertEquals(fin[0].args.p_order_id, ORDER);
  assertEquals(fin[0].args.p_paid_amount_cents, 550000);
  assertEquals(fin[0].args.p_provider_fee_cents, 8250);
  const placed = sent.filter((s) => s.type === "business.venue_order_placed");
  assertEquals(placed.length, 1);
  assertEquals(placed[0].userId, OWNER);
  assertEquals(placed[0].title, "New order · Table 4");
  // The first read named the column; the retry did not.
  assert(db.selects.some((c) => c.includes("till_payment_id")));
  assert(db.selects.some((c) => !c.includes("till_payment_id")));
});

Deno.test("O2F1-D2 before the #4490 migrations the new-order push from any finalize path still fires once", async () => {
  const db = preMigrationClient();
  const sent = await withDispatchCapture(() => fireVenueOrderPlacedForOrder(db.client, ORDER));
  const placed = sent.filter((s) => s.type === "business.venue_order_placed");
  assertEquals(placed.length, 1);
  assertEquals(placed[0].idempotencyKey, `business.venue_order_placed:${ORDER}:${OWNER}`);
  assertEquals(sent.filter((s) => s.type === "business.venue_till_paid_late").length, 0);
});

Deno.test("O2F1-D3 any other lookup error is still a failure: the charge throws so Paystack retries", async () => {
  const db = preMigrationClient({
    lookupError: { code: "57014", message: "canceling statement due to statement timeout" },
  });
  await assertRejects(
    () =>
      handleVenueOrderPaystackCharge(db.client, "mingla_vo_guest_2", {
        amount: 550000,
        currency: "NGN",
        id: 1,
      }),
    Error,
    "venue_order_paystack_lookup_failed",
  );
  assertEquals(db.rpcs.length, 0);
  // Only once: no retry for an error that is not the deploy gap.
  assertEquals(db.selects.length, 1);
});

Deno.test("O2F1-D4 the deploy-gap test is narrow: 42703 naming till_payment_id only", () => {
  assert(isMissingTillPaymentColumn({ code: "42703", message: "column venue_orders.till_payment_id does not exist" }));
  assert(!isMissingTillPaymentColumn({ code: "42703", message: "column venue_orders.buyer_name does not exist" }));
  assert(!isMissingTillPaymentColumn({ code: "42P01", message: "relation till_payment_id" }));
  assert(!isMissingTillPaymentColumn(null));
});
