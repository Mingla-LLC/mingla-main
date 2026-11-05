/**
 * #4271 — door pay code client: create / view / cancel / text, the guest's
 * checkout hand-off (doorCode on ticket-checkout-create), the door access
 * check, and the door sales read that now includes card money at the door.
 * Server shapes follow the #4271 build contract; the server is mocked.
 */
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock("../ticketCheckoutService", () => ({
  ticketCheckoutProviderHandoff: (result: Record<string, unknown>) =>
    result.kind === "requires_web_redirect"
      ? {
          checkoutSessionId: result.checkoutSessionId,
          buyerStatusToken: result.buyerStatusToken,
          redirectUrl: result.hostedCheckoutUrl,
        }
      : result.kind === "requires_paystack_redirect"
        ? {
            checkoutSessionId: result.checkoutSessionId,
            buyerStatusToken: result.buyerStatusToken,
            redirectUrl: result.authorizationUrl,
          }
        : null,
}));

import {
  cancelDoorPayCode,
  createDoorCodeCheckout,
  createDoorPayCode,
  DoorPayCodeError,
  fetchDoorPayGuestName,
  fetchDoorPayLatePayment,
  quoteDoorPayCode,
  fetchCanTakeDoorPayment,
  mapDoorPayCodeRow,
  textDoorPayLink,
  viewDoorPayCode,
} from "../doorPayCodeService";
import { fetchEventDoorSales } from "../doorSalesService";

const refusal = (status: number, body: Record<string, unknown>) => ({
  message: "Edge Function returned a non-2xx status code",
  context: { status, json: async () => body },
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe("#4271 door pay code service", () => {
  it("creates a code from ticket lines only; the server prices it", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        codeId: "code-1",
        code: "K7Q2M9XA",
        payUrl: "https://host.usemingla.com/pay/door/K7Q2M9XA",
        totalCents: 3135,
        subtotalCents: 3000,
        feeCents: 135,
        currency: "GBP",
        expiresAt: "2026-11-04T20:10:00.000Z",
        lines: [{ ticketTypeId: "tier-1", name: "General admission", quantity: 2, unitCents: 1500 }],
      },
      error: null,
    });
    const created = await createDoorPayCode({
      eventId: "event-1",
      eventDateId: null,
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
    });
    expect(mockInvoke).toHaveBeenCalledWith("door-pay-code", {
      body: {
        action: "create",
        eventId: "event-1",
        eventDateId: null,
        lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      },
    });
    expect(created).toMatchObject({ codeId: "code-1", code: "K7Q2M9XA", totalCents: 3135, feeCents: 135 });
    expect(created.lines[0]).toEqual({
      ticketTypeId: "tier-1",
      name: "General admission",
      quantity: 2,
      unitCents: 1500,
    });
  });

  it("keeps the server's refusal code for exact copy", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: refusal(400, { error: "door_access_denied" }),
    });
    await expect(
      createDoorPayCode({ eventId: "event-1", eventDateId: null, lines: [{ ticketTypeId: "t", quantity: 1 }] }),
    ).rejects.toMatchObject({ code: "door_access_denied", status: 400 });
  });

  it("views, cancels and texts a code", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        data: {
          status: "opened",
          eventName: "Afrobeats Night",
          eventStartsAt: "2026-11-04T21:00:00.000Z",
          venueLabel: null,
          brandName: "Lagos Live",
          lines: [{ ticketTypeId: "tier-1", name: "General", quantity: 2, unitCents: 1500 }],
          subtotalCents: 3000,
          feeCents: 135,
          totalCents: 3135,
          currency: "GBP",
          expiresAt: "2026-11-04T20:10:00.000Z",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { status: "cancelled" }, error: null })
      .mockResolvedValueOnce({ data: { sent: true, last4: "0123" }, error: null });

    const view = await viewDoorPayCode("K7Q2M9XA");
    expect(view).toMatchObject({ status: "opened", eventName: "Afrobeats Night", totalCents: 3135 });
    expect(mockInvoke).toHaveBeenLastCalledWith("door-pay-code", { body: { action: "view", code: "K7Q2M9XA" } });

    await cancelDoorPayCode("code-1");
    expect(mockInvoke).toHaveBeenLastCalledWith("door-pay-code", { body: { action: "cancel", codeId: "code-1" } });

    await expect(
      textDoorPayLink({ codeId: "code-1", phone: "+447700900123", phoneCountryIso: "GB" }),
    ).resolves.toEqual({ last4: "0123" });
    expect(mockInvoke).toHaveBeenLastCalledWith("door-pay-code", {
      body: { action: "text_link", codeId: "code-1", phone: "+447700900123", phoneCountryIso: "GB" },
    });
  });

  it("hands the guest to the provider page with the door code, like online checkout", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        kind: "requires_web_redirect",
        checkoutSessionId: "session-1",
        buyerStatusToken: "token-1",
        hostedCheckoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
      },
      error: null,
    });
    const buyer = {
      name: "Ada Okafor",
      email: "ada@example.com",
      phone: "+447700900123",
      marketingOptIn: false,
      termsAccepted: true,
    };
    const handoff = await createDoorCodeCheckout({ doorCode: "K7Q2M9XA", buyer });
    expect(mockInvoke).toHaveBeenCalledWith("ticket-checkout-create", {
      body: {
        doorCode: "K7Q2M9XA",
        returnContract: "host_v1",
        surface: "web",
        buyer,
        // The server's door arm requires purchaseTermsAccepted (or
        // buyer.termsAccepted) and keeps only guest fields.
        purchaseTermsAccepted: true,
        lines: [],
      },
    });
    expect(handoff.redirectUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("reports a paid code as unavailable with its status", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: refusal(409, { error: "door_code_unavailable", status: "paid" }),
    });
    const attempt = createDoorCodeCheckout({
      doorCode: "K7Q2M9XA",
      buyer: { name: "A", email: "a@b.co", phone: "+1", marketingOptIn: false },
    });
    await expect(attempt).rejects.toBeInstanceOf(DoorPayCodeError);
    await attempt.catch((error: DoorPayCodeError) => {
      expect(error.code).toBe("door_code_unavailable");
      expect(error.codeStatus).toBe("paid");
    });
  });

  it("asks the server whether this person may take door payments", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(fetchCanTakeDoorPayment("event-1")).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("biz_can_take_door_payment", { p_event_id: "event-1" });
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(fetchCanTakeDoorPayment("event-1")).resolves.toBe(false);
  });

  it("maps the realtime row the host screen listens to", () => {
    expect(
      mapDoorPayCodeRow({
        id: "code-1",
        event_id: "event-1",
        event_date_id: null,
        code: "K7Q2M9XA",
        status: "paid",
        provider: "stripe",
        lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
        currency: "GBP",
        subtotal_cents: 3000,
        total_cents: 3135,
        expires_at: "2026-11-04T20:10:00.000Z",
        opened_at: "2026-11-04T20:01:00.000Z",
        paid_at: "2026-11-04T20:02:00.000Z",
        order_id: "order-1",
        failure_reason: null,
      }),
    ).toMatchObject({ status: "paid", totalCents: 3135, orderId: "order-1", lines: [{ ticketTypeId: "tier-1", quantity: 2 }] });
  });

  it("door sales include card money at the door, with Mingla's fee", async () => {
    const query = { select: jest.fn(), eq: jest.fn(), not: jest.fn(), order: jest.fn() } as Record<string, jest.Mock>;
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.order.mockResolvedValue({
      data: [{
        id: "order-code-1",
        event_id: "event-1",
        buyer_name: "Ada Okafor",
        buyer_email: "ada@example.com",
        buyer_phone_e164: "+447700900123",
        door_payment_method: "pay_code",
        stripe_application_fee_amount_cents: 141,
        buyer_total_cents: 3135,
        total_cents: 3135,
        currency: "GBP",
        created_by_scanner_id: null,
        created_at: "2026-11-04T20:02:00.000Z",
        payment_status: "paid",
        refunded_amount_cents: 0,
        metadata: null,
        events: { brand_id: "brand-1" },
        order_line_items: [],
        refunds: [],
      }],
      error: null,
    });
    mockFrom.mockReturnValue(query);
    const [sale] = await fetchEventDoorSales("event-1");
    expect(query.not).toHaveBeenCalledWith("door_payment_method", "is", null);
    expect(query.eq).not.toHaveBeenCalledWith("source", "door_sale");
    expect(sale).toMatchObject({ paymentMethod: "pay_code", totalAtSale: 31.35, minglaFeeAmount: 1.41 });
  });

  it("a fully refunded card door sale reads as refunded in the sale detail", async () => {
    const query = { select: jest.fn(), eq: jest.fn(), not: jest.fn(), order: jest.fn() } as Record<string, jest.Mock>;
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.order.mockResolvedValue({
      data: [{
        id: "order-code-2",
        event_id: "event-1",
        buyer_name: "Ada Okafor",
        buyer_email: "ada@example.com",
        buyer_phone_e164: "+447700900123",
        door_payment_method: "pay_code",
        stripe_application_fee_amount_cents: 141,
        buyer_total_cents: 3135,
        total_cents: 3135,
        currency: "GBP",
        created_by_scanner_id: null,
        created_at: "2026-11-04T20:02:00.000Z",
        payment_status: "refunded",
        refunded_amount_cents: 3135,
        metadata: null,
        events: { brand_id: "brand-1" },
        order_line_items: [],
        refunds: [],
      }],
      error: null,
    });
    mockFrom.mockReturnValue(query);
    const [sale] = await fetchEventDoorSales("event-1");
    expect(sale).toMatchObject({ status: "refunded_full", refundedAmount: 31.35 });
  });

  it("quotes a basket through the server without making a code", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { subtotalCents: 3000, feeCents: 135, totalCents: 3135, currency: "GBP" },
      error: null,
    });
    await expect(
      quoteDoorPayCode({
        eventId: "event-1",
        eventDateId: null,
        lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      }),
    ).resolves.toEqual({ subtotalCents: 3000, feeCents: 135, totalCents: 3135, currency: "GBP" });
    expect(mockInvoke.mock.calls[0][1].body).toEqual({
      action: "quote",
      eventId: "event-1",
      eventDateId: null,
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
    });
  });

  it("a new code names the code it replaces; a first code does not", async () => {
    const created = {
      codeId: "code-2",
      code: "K7Q2M9XB",
      payUrl: "https://host.usemingla.com/pay/door/K7Q2M9XB",
      totalCents: 3135,
      subtotalCents: 3000,
      feeCents: 135,
      currency: "GBP",
      expiresAt: "2026-11-04T20:10:00.000Z",
      lines: [],
    };
    mockInvoke.mockResolvedValue({ data: created, error: null });
    const input = { eventId: "event-1", eventDateId: null, lines: [{ ticketTypeId: "tier-1", quantity: 2 }] };
    await createDoorPayCode({ ...input, replacesCodeId: "code-1" });
    expect(mockInvoke.mock.calls[0][1].body.replacesCodeId).toBe("code-1");
    await createDoorPayCode(input);
    expect(mockInvoke.mock.calls[1][1].body).not.toHaveProperty("replacesCodeId");
  });

  it("reads a late payment from the server; null means nothing was charged", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { state: "refunding", amountCents: 3135, currency: "GBP" },
      error: null,
    });
    await expect(fetchDoorPayLatePayment("code-1")).resolves.toEqual({
      state: "refunding",
      amountCents: 3135,
      currency: "GBP",
    });
    expect(mockRpc).toHaveBeenCalledWith("biz_door_pay_code_late_payment", { p_code_id: "code-1" });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchDoorPayLatePayment("code-1")).resolves.toBeNull();
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(fetchDoorPayLatePayment("code-1")).rejects.toBeInstanceOf(DoorPayCodeError);
  });

  it("the guest's name comes through the door permission, not an orders read", async () => {
    mockRpc.mockResolvedValueOnce({ data: " Ada Okafor ", error: null });
    await expect(fetchDoorPayGuestName("code-1")).resolves.toBe("Ada Okafor");
    expect(mockRpc).toHaveBeenCalledWith("biz_door_pay_code_guest_name", { p_code_id: "code-1" });
    expect(mockFrom).not.toHaveBeenCalled();
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchDoorPayGuestName("code-1")).resolves.toBeNull();
    // A failed read is an error, never a false walk-up.
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(fetchDoorPayGuestName("code-1")).rejects.toBeInstanceOf(DoorPayCodeError);
  });
});
