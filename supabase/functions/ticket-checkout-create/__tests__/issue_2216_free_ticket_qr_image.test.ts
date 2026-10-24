/**
 * Issue #2216 originally required rendered QR images on the Business web
 * confirmation page. Issue #4063 deliberately supersedes that presentation:
 * completed checkouts now return display-only ticket summaries and a claim
 * pointer, while every scannable credential stays inside Explorer.
 *
 * Keeping this historical suite, with its expectation advanced to the new
 * invariant, makes a reintroduction of the old blank-QR repair fail loudly.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildBuyerConfirmationPayload,
  type BuyerConfirmationClient,
} from "../../_shared/buyerConfirmationPayload.ts";

const ORDER_ID = "40000000-0000-4000-8000-000000002216";
const EVENT_ID = "10000000-0000-4000-8000-000000002216";
const TICKET_ID = "50000000-0000-4000-8000-000000002216";
const TIER_ID = "20000000-0000-4000-8000-000000002216";

class Query implements PromiseLike<{ data: unknown; error: null }> {
  constructor(private readonly table: string) {}
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  order(): this {
    return this;
  }
  maybeSingle(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve(this.result());
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) =>
        | TResult1
        | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
  private result(): { data: unknown; error: null } {
    if (this.table === "orders") {
      return {
        data: {
          buyer_email: "guest@example.test",
          buyer_phone_e164: "+15551232216",
          buyer_user_id: null,
          purchased_by_user_id: null,
          total_cents: 0,
          tax_amount_cents: 0,
          buyer_fees_cents: 0,
          tax_cents: 0,
          buyer_total_cents: 0,
          event_date_id: null,
          booked_start_at: null,
        },
        error: null,
      };
    }
    if (this.table === "tickets") {
      return {
        data: [{
          id: TICKET_ID,
          ticket_type_id: TIER_ID,
          status: "valid",
          ticket_types: { name: "Free Entry" },
          // A database row may still contain its credential. The public
          // projection must ignore it rather than merely rename it.
          qr_code: "mingla:v1:private-door-credential",
        }],
        error: null,
      };
    }
    if (this.table === "event_dates") return { data: null, error: null };
    return { data: [], error: null };
  }
}

const client: BuyerConfirmationClient = {
  from: (table: string) => new Query(table),
  rpc: (name: string) =>
    Promise.resolve({
      data: name === "mint_claim_link"
        ? { code: "ABC1234567", claimed: false }
        : null,
      error: null,
    }),
};

Deno.test("#2216/#4063 free checkout keeps tickets but removes every QR credential", async () => {
  const payload = await buildBuyerConfirmationPayload(client, {
    orderId: ORDER_ID,
    eventId: EVENT_ID,
    currency: "USD",
    logPrefix: "[#2216/#4063]",
  });
  assert(payload !== null);
  assertEquals(payload.tickets, [{
    ticketId: TICKET_ID,
    ticketTypeId: TIER_ID,
    ticketName: "Free Entry",
    status: "valid",
  }]);
  assertEquals(payload.claim, {
    shortUrl: "https://usemingla.com/c/ABC1234567",
    code: "ABC1234567",
  });
  const serialized = JSON.stringify(payload);
  assert(!/qr|private-door-credential/i.test(serialized));
});

Deno.test("#2216/#4063 ticket-checkout-create has no server QR-image rail", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(!source.includes("attachQrImageDataUrls"));
  assert(!source.includes("ticketQrImage"));
  assert(!source.includes("qrImageDataUrl"));
  assert(!source.includes("qrPayload"));
  assert(!source.includes("qr_code"));
});
