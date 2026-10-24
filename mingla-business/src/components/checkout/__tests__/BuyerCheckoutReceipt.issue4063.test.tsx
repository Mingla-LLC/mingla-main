import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { BuyerCheckoutReceipt } from "../BuyerCheckoutReceipt";

jest.mock("../../ui/GlassCard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react") as typeof React;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return {
    GlassCard: ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => ReactModule.createElement(View, { testID }, children),
  };
});

interface TestNode {
  props: { children?: unknown };
}

interface TestTree {
  root: { findAll: (predicate: (node: TestNode) => boolean) => TestNode[] };
  toJSON: () => unknown;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (node: React.ReactElement) => TestTree;
};

function flattenText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(flattenText).join("");
  return "";
}

describe("#4063 buyer checkout receipt", () => {
  test("renders only server receipt amounts and the short order reference", () => {
    let tree!: TestTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <BuyerCheckoutReceipt
          eventName="Salsa night"
          brandName="Salsa4Life"
          orderId="7f3a91c2-1111-2222-3333-444444444444"
          receipt={{
            lines: [{ qty: 2, name: "General", amountCents: 5000 }],
            discountLines: [{ label: "Early bird", amountCents: 500 }],
            feesAndTaxCents: 250,
            paidCents: 4750,
            currency: "GBP",
            dateLine: "Sat 25 Oct, 7:30 PM",
            orderRef: "7F3A91C2",
          }}
        />,
      );
    });
    const text = tree.root
      .findAll(() => true)
      .map((node) => flattenText(node.props.children))
      .join(" ");
    expect(text).toContain("Salsa night");
    expect(text).toContain("Sat 25 Oct, 7:30 PM · Salsa4Life");
    expect(text).toContain("2×");
    expect(text).toContain("Early bird");
    expect(text).toContain("Fees & tax");
    expect(text).toContain("Paid");
    expect(text).toContain("Order 7F3A91C2");
    expect(text).not.toContain("444444444444");
  });

  test("renders nothing when the gated server receipt is missing", () => {
    let tree!: TestTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <BuyerCheckoutReceipt
          eventName="Salsa night"
          orderId="7f3a91c2-1111-2222-3333-444444444444"
          receipt={undefined}
        />,
      );
    });
    expect(tree.toJSON()).toBeNull();
  });
});
