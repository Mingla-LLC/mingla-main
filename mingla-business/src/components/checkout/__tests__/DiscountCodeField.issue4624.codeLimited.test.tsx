// MINGLA-INVARIANT: I-4624-10 | issue #4624 | When a ticket-capped code leaves a basket line at full price, the buyer field hides the applied chip (the code saved nothing) and shows the code's own notice, never the sale-price wording.
/**
 * #4624 D1a — buyer web. A ticket-capped code with fewer tickets left than the
 * basket line holds discounts nothing on that line; the engine still says
 * "applied" and sends a sale_limited notice with discountKind "code".
 *
 * FAILS ON REVERT: drop the discountKind filter and the field prints "Only 5
 * left at the sale price." (saleLimitedCopy) instead of the code copy.
 */
import React from "react";
import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import { codeLimitedCopy } from "@mingla/offering-rendering/saleLimitedCopy";
import { DiscountCodeField } from "../DiscountCodeField";

interface RenderTree {
  toJSON: () => unknown;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => void;
};
const act = TestRenderer.act;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../analytics/discountAnalytics", () => ({
  captureDiscountEvent: jest.fn(),
}));

const baseQuote = (over: Partial<TicketQuote>): TicketQuote => ({
  kind: "quote",
  currency: "NGN",
  lines: [],
  listSubtotalCents: 1500000,
  discountCents: 0,
  netSubtotalCents: 1500000,
  dueTodayNetCents: 1500000,
  dueTodayListCents: 1500000,
  installmentSchedule: null,
  discounts: [],
  codeOutcome: { status: "applied", reason: null, required: null, with: null, replaced: [] },
  notices: [],
  quoteDigest: "digest",
  quoteListDigest: "list-digest",
  feesCents: 0,
  taxCents: 0,
  buyerTotalCents: 1500000,
  calculationId: "calc-1",
  subtotalCents: 1500000,
  totalCents: 1500000,
  ...over,
});

async function render(quote: TicketQuote): Promise<string> {
  let tree!: RenderTree;
  await act(async () => {
    tree = TestRenderer.create(
      <DiscountCodeField
        value="TOPZY"
        quote={quote}
        quoteStatus="ready"
        saleNameByLineRef={{ "tt-1": "Early bird" }}
        onApply={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  await act(async () => tree.unmount());
  return json;
}

describe("#4624 ticket-capped code notice on buyer checkout", () => {
  test("copy: plural, singular and none left", () => {
    expect(codeLimitedCopy(3)).toBe(
      "Only 3 tickets left on this code. Lower the number to use it.",
    );
    expect(codeLimitedCopy(1)).toBe(
      "Only 1 ticket left on this code. Lower the number to use it.",
    );
    expect(codeLimitedCopy(0)).toBe(
      "No tickets left on this code for the rest of your order.",
    );
  });

  test("over the limit: no applied chip, the code stays in the field, the code notice shows", async () => {
    const json = await render(
      baseQuote({
        notices: [
          { type: "sale_limited", discountId: "code-1", lineRef: "tt-1", remaining: 5, discountKind: "code" },
        ],
      }),
    );
    expect(json).not.toContain("discount-code-applied");
    expect(json).not.toContain("Saving");
    expect(json).toContain("discount-code-limited");
    expect(json).toContain("Only 5 tickets left on this code. Lower the number to use it.");
    expect(json).not.toContain("at the sale price");
    expect(json).toContain("Enter code");
  });

  test("an automatic sale notice keeps its sale wording", async () => {
    const json = await render(
      baseQuote({
        notices: [{ type: "sale_limited", discountId: "sale-1", lineRef: "tt-1", remaining: 2 }],
      }),
    );
    expect(json).toContain("Only 2 left at the Early bird price.");
    expect(json).not.toContain("discount-code-limited");
  });

  test("within the limit the applied chip still shows the saving", async () => {
    const json = await render(
      baseQuote({
        discountCents: 1500000,
        discounts: [
          { discountId: "code-1", kind: "code", name: "Talent code", code: "TOPZY", amountMinor: 1500000, units: 2 },
        ],
      }),
    );
    expect(json).toContain("discount-code-applied");
    expect(json).toContain("Saving");
    expect(json).not.toContain("discount-code-limited");
  });
});
