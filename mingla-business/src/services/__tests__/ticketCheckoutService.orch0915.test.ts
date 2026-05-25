jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import { createTicketCheckout } from "../ticketCheckoutService";
import { supabase } from "../supabase";

const invokeMock = supabase.functions.invoke as jest.Mock;

const baseInput = {
  eventId: "evt_trip",
  buyer: {
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+15555550123",
    marketingOptIn: false,
  },
  lines: [
    {
      ticketTypeId: "tier_1",
      ticketName: "Explorer",
      unitPrice: 500,
      unitPriceGbp: 500,
      currency: "USD",
      isFree: false,
      quantity: 1,
    },
  ],
  surface: "web" as const,
};

describe("createTicketCheckout ORCH-0915 paymentPlanChoice mapping", () => {
  beforeEach(() => {
    invokeMock.mockResolvedValue({
      data: {
        kind: "requires_web_redirect",
        checkoutSessionId: "checkout_1",
        buyerStatusToken: "buyer_token",
        hostedCheckoutUrl: "https://checkout.stripe.test/session",
        totalCents: 50000,
        currency: "USD",
      },
      error: null,
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it("maps full choice to payment_plan_choice", async () => {
    await createTicketCheckout({
      ...baseInput,
      paymentPlanChoice: "full",
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "ticket-checkout-create",
      expect.objectContaining({
        body: expect.objectContaining({
          payment_plan_choice: "full",
        }),
      }),
    );
  });

  it("maps installment choice to payment_plan_choice", async () => {
    await createTicketCheckout({
      ...baseInput,
      paymentPlanChoice: "installments",
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "ticket-checkout-create",
      expect.objectContaining({
        body: expect.objectContaining({
          payment_plan_choice: "installments",
        }),
      }),
    );
  });

  it("preserves the legacy request shape when choice is omitted", async () => {
    await createTicketCheckout(baseInput);

    const body = invokeMock.mock.calls[0][1].body;
    expect(body).not.toHaveProperty("payment_plan_choice");
  });
});
