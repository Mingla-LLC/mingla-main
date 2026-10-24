import {
  assert,
  assertEquals,
  assertFalse,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildBuyerConfirmationPayload,
  buyerPhoneLast4,
  compactOrderRef,
} from "../buyerConfirmationPayload.ts";

const ORDER_ID = "7f3a91c2-aaaa-bbbb-cccc-dddddddddddd";
const EVENT_ID = "11111111-2222-3333-4444-555555555555";

interface Result {
  data: unknown;
  error: null;
}

class FakeQuery implements PromiseLike<Result> {
  private columns = "";
  private single = false;

  constructor(private readonly table: string) {}

  select(columns: string): this {
    this.columns = columns;
    return this;
  }

  eq(): this {
    return this;
  }

  order(): this {
    return this;
  }

  maybeSingle(): Promise<Result> {
    this.single = true;
    return Promise.resolve(this.result());
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private result(): Result {
    if (this.table === "orders") {
      return {
        data: {
          buyer_email: "buyer@example.test",
          buyer_phone_e164: "+12025550142",
          buyer_user_id: null,
          purchased_by_user_id: "99999999-8888-7777-6666-555555555555",
          total_cents: 1800,
          tax_amount_cents: 50,
          buyer_fees_cents: 150,
          tax_cents: 50,
          buyer_total_cents: 2000,
          event_date_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          booked_start_at: null,
        },
        error: null,
      };
    }
    if (this.table === "tickets") {
      if (this.columns.includes("ticket_event_dates")) {
        return { data: [], error: null };
      }
      return {
        data: [{
          id: "ticket-1",
          ticket_type_id: "tier-1",
          status: "valid",
          ticket_types: { name: "General admission" },
        }],
        error: null,
      };
    }
    if (this.table === "order_line_items") {
      return {
        data: [{
          quantity: 2,
          unit_price_cents: 900,
          list_unit_price_cents: 1000,
          total_cents: 1800,
          discount_cents: 200,
          ticket_types: { name: "General admission" },
        }],
        error: null,
      };
    }
    if (this.table === "order_discount_lines") {
      return {
        data: [{ name_snapshot: "Launch offer", amount_minor: 200 }],
        error: null,
      };
    }
    if (this.table === "event_dates") {
      return {
        data: this.single
          ? {
            id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            start_at: "2026-10-25T23:30:00.000Z",
            end_at: "2026-10-26T01:30:00.000Z",
            timezone: "America/New_York",
          }
          : [],
        error: null,
      };
    }
    return { data: null, error: null };
  }
}

const client = {
  from(table: string): FakeQuery {
    return new FakeQuery(table);
  },
  rpc(name: string): Promise<Result> {
    assertEquals(name, "mint_claim_link");
    return Promise.resolve({
      data: { code: "AB12CD34EF", claimed: false },
      error: null,
    });
  },
};

Deno.test("#4063 builds one server-owned buyer confirmation payload without QR material", async () => {
  const payload = await buildBuyerConfirmationPayload(client, {
    orderId: ORDER_ID,
    eventId: EVENT_ID,
    currency: "USD",
    logPrefix: "[test]",
  });

  assert(payload !== null);
  assertObjectMatch(payload, {
    buyerContact: { email: "buyer@example.test", phoneLast4: "0142" },
    claim: {
      shortUrl: "https://usemingla.com/c/AB12CD34EF",
      code: "AB12CD34EF",
    },
    attachedToAccount: false,
    boughtForSomeoneElse: true,
    tickets: [{
      ticketId: "ticket-1",
      ticketTypeId: "tier-1",
      ticketName: "General admission",
      status: "valid",
    }],
    receipt: {
      lines: [{ qty: 2, name: "General admission", amountCents: 2000 }],
      discountLines: [{ label: "Launch offer", amountCents: 200 }],
      feesAndTaxCents: 200,
      paidCents: 2000,
      currency: "USD",
      orderRef: "7F3A91C2",
    },
  });
  assert(payload.receipt.dateLine?.includes("7:30 PM"));
  assertFalse("qrPayload" in payload.tickets[0]);
  assertFalse("qrImageDataUrl" in payload.tickets[0]);
});

Deno.test("#4063 confirmation identifiers are compact and never expose a full phone", () => {
  assertEquals(compactOrderRef(ORDER_ID), "7F3A91C2");
  assertEquals(buyerPhoneLast4("+1 (202) 555-0142"), "0142");
  assertEquals(buyerPhoneLast4("12"), null);
});
