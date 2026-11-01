/**
 * issue #3281 — an uneven cart must be quoted on its per-date map, or the
 * buyer sees quantity times days and checkout refuses the stale digest.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const request = jest.fn<(body: Record<string, unknown>) => Promise<unknown>>();

jest.mock("../ticketCheckoutService", () => ({
  invokeTicketCheckoutRequest: request,
}));

import { ticketQuoteKeys } from "../../hooks/useTicketQuote";
import { quoteTicketCheckout, type TicketQuoteInput } from "../ticketQuoteService";

const input = (byDate?: Record<string, number>): TicketQuoteInput =>
  ({
    eventId: "event-1",
    surface: "web",
    buyer: { name: "", email: "", phone: "", phoneCountryIso: "US", marketingOptIn: false },
    lines: [
      {
        ticketTypeId: "ticket-1",
        ticketName: "General",
        quantity: 3,
        unitPrice: 20,
        isFree: false,
        byDate,
      },
    ],
  }) as unknown as TicketQuoteInput;

describe("#3281 quote by date", () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({ quoteDigest: "digest" });
  });

  test("forwards an uneven cart's map", async () => {
    await quoteTicketCheckout(input({ "day-1": 2, "day-2": 1 })).catch(() => undefined);
    const lines = request.mock.calls[0][0].lines as Array<Record<string, unknown>>;
    expect(lines[0].byDate).toEqual({ "day-1": 2, "day-2": 1 });
  });

  test("leaves a uniform cart's wire body alone", async () => {
    await quoteTicketCheckout(input()).catch(() => undefined);
    const [body] = request.mock.calls[0];
    expect(JSON.stringify(body)).not.toContain("byDate");
  });

  test("a different split with the same total is a different quote", () => {
    expect(ticketQuoteKeys.detail(input({ "day-1": 2, "day-2": 1 }))).not.toEqual(
      ticketQuoteKeys.detail(input({ "day-1": 1, "day-2": 2 })),
    );
  });
});
