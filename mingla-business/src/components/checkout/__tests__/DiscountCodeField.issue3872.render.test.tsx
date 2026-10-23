import React from "react";
import { Pressable, TextInput } from "react-native";
import type {
  DiscountCodeReason,
  TicketQuote,
} from "@mingla/offering-rendering/discountQuote";
import { discountReasonCopy } from "@mingla/offering-rendering/discountReasonCopy";
import { DiscountCodeField } from "../DiscountCodeField";

interface RenderNode {
  props: Record<string, unknown> & {
    accessibilityLabel?: string;
    onChangeText?: (value: string) => void;
    onPress?: () => void;
  };
}
interface RenderTree {
  root: {
    findByType: (type: unknown) => RenderNode;
    findAllByType: (type: unknown) => RenderNode[];
  };
  toJSON: () => unknown;
  update: (element: React.ReactElement) => void;
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

const reasons: DiscountCodeReason[] = [
  "not_found",
  "paused",
  "not_started",
  "ended",
  "used_up",
  "buyer_limit",
  "queue",
  "not_applicable",
  "min_subtotal",
  "incompatible_better_automatic",
];

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
  discounts: [
    {
      discountId: "discount-1",
      kind: "code",
      name: "Save ten",
      code: "SAVE10",
      amountMinor: 1000,
      units: 1,
    },
  ],
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

describe("#3872 discount-code field states", () => {
  test.each(reasons)("provides binding copy for %s", (reason) => {
    const copy = discountReasonCopy({
      reason,
      code: "SAVE10",
      date: "Friday",
      required: "$5.00",
      withName: "Member price",
    });
    expect(copy.length).toBeGreaterThan(8);
    expect(copy).not.toMatch(/undefined|null/);
  });

  test("normalizes the buyer entry and renders the server-applied saving", async () => {
    const onApply = jest.fn();
    let tree!: RenderTree;
    await act(async () => {
      tree = TestRenderer.create(
        <DiscountCodeField
          value={null}
          quote={null}
          quoteStatus="idle"
          onApply={onApply}
          onRemove={jest.fn()}
        />,
      );
    });

    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText!(" save-10 ");
    });
    await act(async () => {
      tree.root
        .findAllByType(Pressable)
        .find(
          (node: RenderNode) =>
            node.props.accessibilityLabel === "Apply discount code",
        )!
        .props.onPress!();
    });
    expect(onApply).toHaveBeenCalledWith("SAVE10");

    await act(async () => {
      tree.update(
        <DiscountCodeField
          value="SAVE10"
          quote={quote}
          quoteStatus="ready"
          onApply={onApply}
          onRemove={jest.fn()}
        />,
      );
    });
    const appliedTree = JSON.stringify(tree.toJSON());
    expect(appliedTree).toContain("SAVE10");
    expect(appliedTree).toContain("Save ten");
    expect(appliedTree).toContain("Saving");
    expect(appliedTree).toContain("$10.00");
    await act(async () => tree.unmount());
  });

  test("renders distinct rate-limit and retry errors", async () => {
    let tree!: RenderTree;
    await act(async () => {
      tree = TestRenderer.create(
        <DiscountCodeField
          value="SAVE10"
          quote={null}
          quoteStatus="error"
          quoteErrorCode="rate_limited"
          onApply={jest.fn()}
          onRemove={jest.fn()}
        />,
      );
    });
    expect(JSON.stringify(tree.toJSON())).toContain("Too many tries");

    await act(async () => {
      tree.update(
        <DiscountCodeField
          value="SAVE10"
          quote={null}
          quoteStatus="error"
          quoteErrorCode="quote_failed"
          onApply={jest.fn()}
          onRemove={jest.fn()}
        />,
      );
    });
    expect(JSON.stringify(tree.toJSON())).toContain("Couldn't get your price");
    await act(async () => tree.unmount());
  });
});
