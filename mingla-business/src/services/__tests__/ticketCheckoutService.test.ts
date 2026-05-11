jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import { pollTicketCheckoutStatus } from "../ticketCheckoutService";
import type { TicketCheckoutStatusResult } from "../ticketCheckoutService";

const pending = (): TicketCheckoutStatusResult => ({
  checkoutSessionId: "cs_1",
  status: "processing_payment",
  order: null,
});

const completed = (): TicketCheckoutStatusResult => ({
  checkoutSessionId: "cs_1",
  status: "paid_completed",
  order: {
    orderId: "ord_1",
    checkoutSessionId: "cs_1",
    eventId: "evt_1",
    buyerStatusToken: "buyer_token",
    paymentStatus: "paid",
    totalCents: 2500,
    currency: "GBP",
    tickets: [],
    notificationStatus: "queued",
  },
});

describe("pollTicketCheckoutStatus", () => {
  it("keeps successful payment in processing until delayed webhook status resolves", async () => {
    const responses = [pending(), pending(), completed()];
    const fetcher = jest.fn(async () => responses.shift() ?? completed());
    const waits: number[] = [];

    const result = await pollTicketCheckoutStatus(
      "cs_1",
      "buyer_token",
      fetcher,
      async (ms) => {
        waits.push(ms);
      },
    );

    expect(result?.order?.orderId).toBe("ord_1");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 1500]);
  });

  it("returns null after bounded polling without creating a payment-error contract", async () => {
    const fetcher = jest.fn(async () => pending());

    const result = await pollTicketCheckoutStatus(
      "cs_1",
      "buyer_token",
      fetcher,
      async () => undefined,
    );

    expect(result).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
});
