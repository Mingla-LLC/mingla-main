import {
  assert,
  assertEquals,
  assertFalse,
  assertObjectMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildBuyerConfirmationPayload,
  buyerPhoneLast4,
  compactOrderRef,
  receiptDateLine,
  tripReceiptDateLine,
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
        data: [
          {
            id: "ticket-1",
            ticket_type_id: "tier-1",
            status: "valid",
            ticket_types: { name: "General admission" },
          },
        ],
        error: null,
      };
    }
    if (this.table === "order_line_items") {
      return {
        data: [
          {
            quantity: 2,
            unit_price_cents: 900,
            list_unit_price_cents: 1000,
            total_cents: 1800,
            discount_cents: 200,
            ticket_types: { name: "General admission" },
          },
        ],
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

Deno.test(
  "#4063 builds one server-owned buyer confirmation payload without QR material",
  async () => {
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
      tickets: [
        {
          ticketId: "ticket-1",
          ticketTypeId: "tier-1",
          ticketName: "General admission",
          status: "valid",
        },
      ],
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
  },
);

const clientWithExtras = (result: {
  data: unknown;
  error: { message: string } | null;
}) => ({
  ...client,
  from(table: string) {
    if (table !== "order_add_on_line_items") return client.from(table);
    return {
      select: () => ({ eq: () => ({ order: () => Promise.resolve(result) }) }),
    };
  },
});

Deno.test("#3281 a receipt names the extras bought with the tickets", async () => {
  const payload = await buildBuyerConfirmationPayload(
    clientWithExtras({
      data: [{ add_on_name_at_order: "Friday dinner", quantity: 1, total_cents: 3500 }],
      error: null,
    }),
    { orderId: ORDER_ID, eventId: EVENT_ID, currency: "USD", logPrefix: "[test]" },
  );
  assert(payload !== null);
  assertEquals(payload.receipt.lines, [
    { qty: 2, name: "General admission", amountCents: 2000 },
    { qty: 1, name: "Add-on: Friday dinner", amountCents: 3500 },
  ]);
});

Deno.test("#3281 an extras read failure never blocks a confirmation", async () => {
  const payload = await buildBuyerConfirmationPayload(
    clientWithExtras({ data: null, error: { message: "relation does not exist" } }),
    { orderId: ORDER_ID, eventId: EVENT_ID, currency: "USD", logPrefix: "[test]" },
  );
  assert(payload !== null);
  assertEquals(payload.receipt.lines, [
    { qty: 2, name: "General admission", amountCents: 2000 },
  ]);
});

Deno.test("#3281 an unexpected extras reply never blocks a confirmation", async () => {
  const unexpected = clientWithExtras({ data: { not: "rows" }, error: null });
  const throwing = {
    ...client,
    from(table: string) {
      if (table !== "order_add_on_line_items") return client.from(table);
      throw new Error("client exploded");
    },
  };
  for (const reader of [unexpected, throwing]) {
    const payload = await buildBuyerConfirmationPayload(reader, {
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      currency: "USD",
      logPrefix: "[test]",
    });
    assert(payload !== null);
    assertEquals(payload.receipt.lines, [
      { qty: 2, name: "General admission", amountCents: 2000 },
    ]);
  }
});

Deno.test(
  "#4063 confirmation identifiers are compact and never expose a full phone",
  () => {
    assertEquals(compactOrderRef(ORDER_ID), "7F3A91C2");
    assertEquals(buyerPhoneLast4("+1 (202) 555-0142"), "0142");
    assertEquals(buyerPhoneLast4("12"), null);
  },
);

Deno.test(
  // [TEST-MOD-APPROVED #4063] Multi-day confirmations must name every admitted
  // date in the canonical server receipt.
  "#4063 receipt names every admitted day instead of collapsing to the first",
  () => {
    const line = receiptDateLine([
      {
        start_at: "2026-08-29T10:00:00.000Z",
        end_at: "2026-08-29T17:00:00.000Z",
        timezone: "Africa/Lagos",
      },
      {
        start_at: "2026-08-30T10:00:00.000Z",
        end_at: "2026-08-30T17:00:00.000Z",
        timezone: "Africa/Lagos",
      },
    ]);
    assert(line !== null);
    assertStringIncludes(line, "29 Aug");
    assertStringIncludes(line, "30 Aug");
  },
);

// issue #4522 E-7 / E-8 — a trip's confirmation names its calendar dates, and
// an add-on line is marked so the page counts places, not lines.
Deno.test("#4522 E-7 a trip's receipt date line is its stored calendar dates, never the zone's evening before", async () => {
  // A 12–16 Mar trip in New York: stored as UTC midnight (#4420).
  const trip = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    start_at: "2099-03-12T00:00:00.000Z",
    end_at: "2099-03-16T00:00:00.000Z",
    timezone: "America/New_York",
  };
  assertEquals(tripReceiptDateLine(trip), "Thu 12 Mar 2099 – Mon 16 Mar 2099");
  // what the event rule renders for the same row (the bug, for a trip)
  assertStringIncludes(receiptDateLine(trip) ?? "", "11 Mar 2099");
  assertEquals(tripReceiptDateLine({ ...trip, end_at: null }), "Thu 12 Mar 2099");
  assertEquals(tripReceiptDateLine(null), null);

  const tripClient = {
    from(table: string) {
      if (table === "events") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { event_type: "trip" }, error: null }) }) }) };
      }
      if (table === "event_dates") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: trip, error: null }) }) }) }) };
      }
      if (table === "order_add_on_line_items") {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({
          data: [{ add_on_name_at_order: "Airport transfer", quantity: 1, total_cents: 4500 }], error: null,
        }) }) }) };
      }
      if (table === "orders") {
        const q = client.from(table);
        return q;
      }
      return client.from(table);
    },
    rpc: client.rpc,
  };
  const payload = await buildBuyerConfirmationPayload(tripClient, {
    orderId: ORDER_ID,
    eventId: EVENT_ID,
    currency: "USD",
    logPrefix: "[test]",
    order: {
      buyer_email: "buyer@example.test", buyer_phone_e164: null, buyer_user_id: null, purchased_by_user_id: null,
      total_cents: 30000, tax_amount_cents: 0, buyer_fees_cents: 0, tax_cents: 0, buyer_total_cents: 30000,
      event_date_id: null, booked_start_at: null,
    },
  });
  assert(payload !== null);
  assertEquals(payload.receipt.dateLine, "Thu 12 Mar 2099 – Mon 16 Mar 2099");
});

Deno.test("#4522 E-7 an event's receipt date line is unchanged (its own zone, with the time)", async () => {
  const payload = await buildBuyerConfirmationPayload(client, {
    orderId: ORDER_ID,
    eventId: EVENT_ID,
    currency: "USD",
    logPrefix: "[test]",
  });
  assert(payload !== null);
  assertEquals(payload.receipt.dateLine, receiptDateLine({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    start_at: "2026-10-25T23:30:00.000Z",
    end_at: "2026-10-26T01:30:00.000Z",
    timezone: "America/New_York",
  }));
});
