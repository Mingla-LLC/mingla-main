// @ts-nocheck -- react-test-renderer ships no types in this package.
// issue #4420 — the Host Orders list printed each order's full UUID under the
// buyer's name. It now shows the short reference the guest's receipt shows
// ("Order 531147C7"), so a host can match an order a guest reads out.
//
// WHAT THIS FILE PROVES (the REAL OrderListCard, rendered)
//   OR-1 a UUID order shows "Order <first 8, upper case>" and never the full id.
//   OR-2 an id that is not hex keeps the raw id (never an empty reference).
//
// FAILS-ON-REVERT: restore OrderListCard's `${order.id}` subline and OR-1 goes red.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("react-native", () => {
  const ReactLocal = require("react");
  const host = (name: string) => (props: any) =>
    ReactLocal.createElement(name, props, props.children);
  return {
    View: host("View"),
    Text: host("Text"),
    Pressable: (props: any) =>
      ReactLocal.createElement(
        "Pressable",
        props,
        typeof props.children === "function" ? props.children({ pressed: false }) : props.children,
      ),
    StyleSheet: { create: (styles: unknown) => styles },
    Platform: { OS: "web", select: (options: any) => options.web ?? options.default },
  };
});
jest.mock("../../ui/Pill", () => {
  const ReactLocal = require("react");
  return { Pill: (props: any) => ReactLocal.createElement("Text", null, props.children) };
});

import { OrderListCard } from "../OrderListCard";
import type { OrderRecord } from "../../../store/orderStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const order = (id: string): OrderRecord => ({
  id,
  eventId: "e1",
  brandId: "b1",
  buyer: { name: "Quinn Tester", email: "q@example.com", phone: "", marketingOptIn: false },
  lines: [{ ticketTypeId: "t1", ticketNameAtPurchase: "General Admission", unitPriceGbpAtPurchase: 25, quantity: 1, isFreeAtPurchase: false, refundedQuantity: 0, refundedAmountGbp: 0 }],
  totalGbpAtPurchase: 25,
  currency: "USD",
  paymentMethod: "card",
  paidAt: new Date().toISOString(),
  status: "paid",
  refundedAmountGbp: 0,
  refunds: [],
} as unknown as OrderRecord);

const allText = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root
    .findAll((node) => typeof node.type === "string" && node.type === "Text")
    .map((node) => {
      const c = node.props.children as unknown;
      return Array.isArray(c) ? c.join("") : String(c);
    })
    .join("\n");

const render = (id: string): TestRenderer.ReactTestRenderer => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(<OrderListCard order={order(id)} onPress={jest.fn()} />);
  });
  if (!tree) throw new Error("not rendered");
  return tree;
};

describe("#4420 Host Orders list shows the short order reference", () => {
  test("OR-1 a UUID order shows Order + 8 characters, not the full id", () => {
    const id = "531147c7-cbe4-4a71-a05a-e83564b9405b";
    const text = allText(render(id));
    expect(text).toContain("Order 531147C7 · 1× General Admission");
    expect(text).not.toContain(id);
  });

  test("OR-2 a non-hex id keeps the raw id", () => {
    expect(allText(render("ord_local"))).toContain("ord_local · 1× General Admission");
  });
});
