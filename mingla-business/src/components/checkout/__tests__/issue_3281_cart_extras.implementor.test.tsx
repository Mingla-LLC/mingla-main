/**
 * issue #3281 — Extras on the Host web cart: a line carries its extras, a
 * ticket change keeps them, clearing them restores the plain line, and a
 * change of extras is a new checkout attempt. The quote and create requests
 * send them on the line; a cart without extras keeps its wire body.
 */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const request = jest.fn<(body: Record<string, unknown>) => Promise<unknown>>();
jest.mock("../../../services/ticketCheckoutService", () => ({
  invokeTicketCheckoutRequest: request,
}));

import { ticketQuoteKeys } from "../../../hooks/useTicketQuote";
import {
  quoteTicketCheckout,
  type TicketQuoteInput,
} from "../../../services/ticketQuoteService";
import { CartProvider, type CartContextValue, useCart } from "../CartContext";

interface RenderTree {
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => void;
};
const act = TestRenderer.act;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TICKET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DINNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let latestCart: CartContextValue | null = null;
const Probe = () => {
  latestCart = useCart();
  return null;
};

const addTicket = (
  quantity: number,
  addOns?: Array<{ addOnId: string; quantity: number }>,
) =>
  latestCart!.setLineQuantity({
    ticketTypeId: TICKET,
    ticketName: "General",
    unitPrice: 20,
    currency: "USD",
    isFree: false,
    quantity,
    addOns,
  });

const attemptId = () =>
  latestCart!.checkoutAttemptIdFor({ eventId: EVENT, surface: "web" });

describe("#3281 cart extras", () => {
  test("a line keeps its extras through a ticket change and drops them when cleared", async () => {
    let tree!: RenderTree;
    await act(async () => {
      tree = TestRenderer.create(
        <CartProvider>
          <Probe />
        </CartProvider>,
      );
    });
    await act(async () => addTicket(2));
    await act(async () => latestCart!.setBuyer({ termsAccepted: true }));
    const plainAttempt = attemptId();

    await act(async () =>
      addTicket(2, [{ addOnId: DINNER, quantity: 2 }]),
    );
    expect(latestCart!.lines[0].addOns).toEqual([{ addOnId: DINNER, quantity: 2 }]);
    const extrasAttempt = attemptId();
    expect(extrasAttempt).not.toBe(plainAttempt);
    // The same cart keeps its attempt.
    expect(attemptId()).toBe(extrasAttempt);

    await act(async () => addTicket(3));
    expect(latestCart!.lines[0].addOns).toEqual([{ addOnId: DINNER, quantity: 2 }]);

    await act(async () => addTicket(3, []));
    expect(latestCart!.lines[0].addOns ?? []).toEqual([]);

    // Removing the ticket removes its extras with it.
    await act(async () =>
      addTicket(3, [{ addOnId: DINNER, quantity: 1 }]),
    );
    await act(async () => addTicket(0));
    expect(latestCart!.lines).toEqual([]);

    await act(async () => tree.unmount());
  });
});

const quoteInput = (addOns?: Array<{ addOnId: string; quantity: number }>) =>
  ({
    eventId: EVENT,
    surface: "web",
    buyer: { name: "", email: "", phone: "", marketingOptIn: false },
    lines: [
      {
        ticketTypeId: TICKET,
        ticketName: "General",
        quantity: 2,
        unitPrice: 20,
        currency: "USD",
        isFree: false,
        addOns,
      },
    ],
  }) as unknown as TicketQuoteInput;

describe("#3281 quote extras", () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({ quoteDigest: "digest" });
  });

  test("the quote sends a line's extras", async () => {
    await quoteTicketCheckout(quoteInput([{ addOnId: DINNER, quantity: 2 }])).catch(
      () => undefined,
    );
    const lines = request.mock.calls[0][0].lines as Array<Record<string, unknown>>;
    expect(lines[0].addOns).toEqual([{ addOnId: DINNER, quantity: 2 }]);
  });

  test("a cart without extras keeps its wire body", async () => {
    await quoteTicketCheckout(quoteInput()).catch(() => undefined);
    expect(JSON.stringify(request.mock.calls[0][0])).not.toContain("addOns");
  });

  test("other extras are another quote", () => {
    expect(ticketQuoteKeys.detail(quoteInput([{ addOnId: DINNER, quantity: 1 }]))).not.toEqual(
      ticketQuoteKeys.detail(quoteInput([{ addOnId: DINNER, quantity: 2 }])),
    );
  });
});
