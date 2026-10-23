import React from "react";
import type {
  TicketCheckoutReview,
  TicketQuote,
} from "@mingla/offering-rendering/discountQuote";
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

let latestCart: CartContextValue | null = null;

const Probe = () => {
  latestCart = useCart();
  return null;
};

const quote: TicketQuote = {
  kind: "quote",
  currency: "USD",
  lines: [],
  listSubtotalCents: 5000,
  discountCents: 1000,
  netSubtotalCents: 4000,
  dueTodayNetCents: 4000,
  dueTodayListCents: 5000,
  installmentSchedule: null,
  discounts: [],
  codeOutcome: {
    status: "applied",
    reason: null,
    required: null,
    with: null,
    replaced: [],
  },
  notices: [],
  quoteDigest: "discounted-digest",
  quoteListDigest: "list-digest",
  feesCents: 0,
  taxCents: 0,
  buyerTotalCents: 4000,
  calculationId: "calc-1",
  subtotalCents: 4000,
  totalCents: 4000,
};

const review: TicketCheckoutReview = {
  kind: "review_required",
  detail: "discount_changed",
  quote,
  previousTotalCents: 5000,
};

describe("#3872 CartContext server quote authority", () => {
  test("normalizes codes, stores server quotes and reviews, then clears them", async () => {
    let tree!: RenderTree;
    await act(async () => {
      tree = TestRenderer.create(
        <CartProvider>
          <Probe />
        </CartProvider>,
      );
    });

    await act(async () =>
      latestCart!.setLineQuantity({
        ticketTypeId: "tier-1",
        ticketName: "General admission",
        unitPrice: 5000,
        currency: "USD",
        isFree: false,
        quantity: 1,
      }),
    );
    await act(async () => latestCart!.setDiscountCode(" save-10 "));
    expect(latestCart!.discountCode).toBe("SAVE10");
    expect(latestCart!.quoteStatus).toBe("loading");
    expect(latestCart!.quote).toBeNull();

    await act(async () => latestCart!.setQuoteState(quote, "ready"));
    await act(async () => latestCart!.setCheckoutReview(review));
    expect(latestCart!.quote).toBe(quote);
    expect(latestCart!.quoteStatus).toBe("ready");
    expect(latestCart!.checkoutReview).toBe(review);

    await act(async () => latestCart!.reset());
    expect(latestCart!.discountCode).toBeNull();
    expect(latestCart!.quote).toBeNull();
    expect(latestCart!.quoteStatus).toBe("idle");
    expect(latestCart!.quoteErrorCode).toBeNull();
    expect(latestCart!.checkoutReview).toBeNull();

    await act(async () => tree.unmount());
  });
});
