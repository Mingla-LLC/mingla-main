import React from "react";

import type { SourceRefundSummary } from "../../../types/venueReservation";
import { SourceRefundStatusChip } from "../SourceRefundStatusChip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: {
      findByProps: (props: Record<string, unknown>) => {
        props: Record<string, unknown>;
      };
    };
    unmount: () => void;
  };
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

function refund(
  sourceType: SourceRefundSummary["sourceType"],
  buyerState: SourceRefundSummary["buyerState"],
  amountCents: number,
  currency: string,
): SourceRefundSummary {
  return {
    refundId: "refund-1221",
    sourceType,
    subjectId: "subject-1221",
    refundKind: "cancellation",
    buyerState,
    feeState: "not_required",
    financialState: "pending",
    amountCents,
    currency,
    requestedAt: "2027-01-31T00:00:00.000Z",
    updatedAt: "2027-01-31T00:00:00.000Z",
    processedAt: null,
    opsStatus: "none",
    canRetry: false,
  };
}

test("Business refund status executes the shared typed state and exact source-currency presentation", async () => {
  let tree!: ReturnType<typeof TestRenderer.create>;

  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <SourceRefundStatusChip
        refund={refund("venue_reservation", "processed", 12_345, "NGN")}
      />,
    );
  });

  expect(
    tree.root.findByProps({ accessibilityRole: "text" }).props
      .accessibilityLabel,
  ).toBe("Refund Processed · 123.45 NGN");

  await TestRenderer.act(async () => {
    tree.unmount();
    tree = TestRenderer.create(
      <SourceRefundStatusChip
        refund={refund("rsvp_contribution", "needs_attention", 999, "USD")}
      />,
    );
  });

  expect(
    tree.root.findByProps({ accessibilityRole: "text" }).props
      .accessibilityLabel,
  ).toBe("Refund Needs attention · 9.99 USD");

  await TestRenderer.act(async () => {
    tree.unmount();
  });
});
