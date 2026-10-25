const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  DoorSaleError,
  fetchEventDoorSales,
  recordDoorSale,
  refundDoorSale,
} from "../doorSalesService";

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe("#4063 durable door sales service", () => {
  it("sends the server-owned transaction a stable request id and normalized contact", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        orderId: "order-4063",
        ticketIds: ["ticket-1", "ticket-2"],
        receiptQueued: true,
        replayed: false,
      },
      error: null,
    });

    const result = await recordDoorSale({
      eventId: "event-4063",
      eventDateId: "date-4063",
      lines: [{ ticketTypeId: "tier-4063", quantity: 2 }],
      paymentMethod: "cash",
      buyerName: "  Door Buyer  ",
      buyerPhoneE164: "  +12025554063  ",
      buyerEmail: "  BUYER@EXAMPLE.TEST  ",
      notes: "  North entrance  ",
      clientRequestId: "request-4063",
    });

    expect(mockRpc).toHaveBeenCalledWith("biz_door_sale_record", {
      p_event_id: "event-4063",
      p_event_date_id: "date-4063",
      p_lines: [{ ticket_type_id: "tier-4063", quantity: 2 }],
      p_payment_method: "cash",
      p_buyer_name: "Door Buyer",
      p_buyer_phone_e164: "+12025554063",
      p_buyer_email: "buyer@example.test",
      p_notes: "North entrance",
      p_client_request_id: "request-4063",
    });
    expect(result).toEqual({
      orderId: "order-4063",
      ticketIds: ["ticket-1", "ticket-2"],
      receiptQueued: true,
      replayed: false,
    });
  });

  it("preserves the server capacity code for exact client copy", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "door_ticket_capacity_exceeded" },
    });

    await expect(recordDoorSale({
      eventId: "event-4063",
      lines: [{ ticketTypeId: "tier-4063", quantity: 1 }],
      paymentMethod: "manual",
      clientRequestId: "request-capacity-4063",
    })).rejects.toMatchObject<Partial<DoorSaleError>>({
      name: "DoorSaleError",
      code: "door_ticket_capacity_exceeded",
    });
  });

  it("reads canonical orders and maps server cents, status, lines and refunds", async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
    } as Record<string, jest.Mock>;
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({
      data: [{
        id: "order-4063",
        event_id: "event-4063",
        buyer_name: "Door Buyer",
        buyer_email: "buyer@example.test",
        buyer_phone_e164: "+12025554063",
        door_payment_method: "card_reader",
        buyer_total_cents: 4500,
        total_cents: 4500,
        currency: "USD",
        created_by_scanner_id: "scanner-4063",
        created_at: "2026-10-24T12:00:00.000Z",
        payment_status: "partial_refund",
        refunded_amount_cents: 500,
        metadata: { door_notes: "Reader receipt 8" },
        events: { brand_id: "brand-4063" },
        order_line_items: [{
          id: "line-4063",
          ticket_type_id: "tier-4063",
          quantity: 3,
          unit_price_cents: 1500,
          total_cents: 4500,
          list_unit_price_cents: 1500,
          ticket_types: { name: "At the door", is_free: false },
        }],
        refunds: [{
          id: "refund-4063",
          amount_cents: 500,
          reason: "Partial cash refund",
          created_at: "2026-10-24T12:05:00.000Z",
          status: "succeeded",
        }],
      }],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    const sales = await fetchEventDoorSales("event-4063");

    expect(mockFrom).toHaveBeenCalledWith("orders");
    expect(query.eq).toHaveBeenNthCalledWith(1, "event_id", "event-4063");
    expect(query.eq).toHaveBeenNthCalledWith(2, "source", "door_sale");
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      id: "order-4063",
      brandId: "brand-4063",
      paymentMethod: "card_reader",
      totalAtSale: 45,
      refundedAmount: 5,
      status: "refunded_partial",
      notes: "Reader receipt 8",
    });
    expect(sales[0].lines[0]).toMatchObject({
      ticketTypeId: "tier-4063",
      ticketNameAtSale: "At the door",
      unitPriceAtSale: 15,
      quantity: 3,
    });
    expect(sales[0].refunds[0]).toMatchObject({
      id: "refund-4063",
      amount: 5,
      reason: "Partial cash refund",
    });
  });

  it("uses the dedicated offline refund RPC", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        orderId: "order-4063",
        refundId: "refund-4063",
        amountCents: 500,
        refundedAmountCents: 500,
        status: "partial_refund",
      },
      error: null,
    });

    await expect(refundDoorSale({
      orderId: "order-4063",
      amountCents: 500,
      reason: "  Guest requested cash back  ",
    })).resolves.toEqual({
      orderId: "order-4063",
      refundId: "refund-4063",
      amountCents: 500,
      refundedAmountCents: 500,
      status: "partial_refund",
    });
    expect(mockRpc).toHaveBeenCalledWith("biz_door_sale_refund", {
      p_order_id: "order-4063",
      p_amount_cents: 500,
      p_reason: "Guest requested cash back",
    });
  });
});
