/* eslint-disable import/first, @typescript-eslint/no-require-imports */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const previewData = {
  currency: "USD",
  listSubtotalCents: 8_000,
  discountCents: 8_000,
  subtotalCents: 0,
  serviceChargeBps: 0,
  serviceChargeCents: 0,
  serviceChargeLabel: "Service charge",
  totalCents: 0,
  spotLabel: "Table 7",
  venueName: "Mingla Cafe",
  staffTabsEnabled: true,
  discounts: [{ id: "sale-1", kind: "sale_price", name: "Lunch sale", amountCents: 8_000 }],
  lines: [{ lineNo: 1, discountCents: 8_000, lineTotalCents: 8_000, netLineTotalCents: 0 }],
};

const previewMutate = jest.fn();
jest.mock("../../../../hooks/useVenueOrderPad", () => ({
  useOrderPadMenu: () => ({ data: { items: [], groupsByItemId: {} }, isLoading: false }),
  usePreviewStaffOrder: () => ({ data: previewData, mutate: previewMutate, isPending: false }),
  useCreateStaffOrder: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSettleStaffOrder: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));
jest.mock("../../../../hooks/useVenueOrderTabs", () => ({
  useCloseVenueTab: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useOpenVenueTab: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ countryCode: "US" }),
}));
jest.mock("../../../../hooks/useVenueListings", () => ({
  useVenueListing: () => ({ data: { countryCode: "US" } }),
}));
jest.mock("../../../../wrappers/SmartScrollView", () => {
  const ReactLocal = require("react");
  const { View } = require("react-native");
  return { ScrollView: ({ children, ...props }: Record<string, unknown>) => ReactLocal.createElement(View, props, children) };
});
jest.mock("../../../../utils/currency", () => ({
  currencyCodeOrNull: (value: unknown) => typeof value === "string" && value ? value : null,
  formatCurrency: (value: number) => `$${(value / 100).toFixed(2)}`,
}));
jest.mock("../../../ui/Button", () => {
  const ReactLocal = require("react");
  const { Pressable, Text } = require("react-native");
  return { Button: ({ label, ...props }: Record<string, unknown>) => ReactLocal.createElement(Pressable, props, ReactLocal.createElement(Text, null, label)) };
});
jest.mock("../../../ui/Sheet", () => {
  const ReactLocal = require("react");
  const { View } = require("react-native");
  return { Sheet: ({ visible, children, ...props }: Record<string, unknown>) => visible ? ReactLocal.createElement(View, props, children) : null };
});
jest.mock("../../../ui/PhoneField", () => ({
  PhoneField: () => null,
  usePhoneEntry: () => ({
    isEmpty: true,
    result: { ok: false, message: null },
    e164: null,
    text: "",
    countryIso: "US",
    reset: jest.fn(),
  }),
}));

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestInstance | string)[];
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer { root: TestInstance; unmount: () => void }
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => void) => void;
};
const { Text, TextInput } = require("react-native") as { Text: unknown; TextInput: unknown };
import { VenueOrderPadSheet } from "../VenueOrderPadSheet";

function textOf(node: TestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : textOf(child)).join("");
}

describe("VenueOrderPadSheet server sale lines", () => {
  test("renders list/net sale presentation, no promo field, and the zero-total action", () => {
    let renderer!: Renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <VenueOrderPadSheet
          visible
          onClose={jest.fn()}
          brandId="brand-1"
          venueId="venue-1"
          spots={[]}
          venues={[]}
          resumeTab={{ sessionId: "session-1", qrSpotId: null, spotLabel: "Table 7" } as never}
          canOpenTabs
        />,
      );
    });

    const texts = renderer.root.findAll((node) => node.type === Text);
    const copy = texts.map(textOf);
    expect(copy).toContain("Lunch sale");
    expect(copy).toContain("Nothing to charge — mark as paid");
    expect(texts.some((node) => (node.props.style as { textDecorationLine?: string } | undefined)?.textDecorationLine === "line-through")).toBe(true);

    const inputs = renderer.root.findAll((node) => node.type === TextInput);
    const inputCopy = inputs.map((node) => `${node.props.placeholder ?? ""} ${node.props.accessibilityLabel ?? ""}`.toLowerCase());
    expect(inputCopy.some((value) => value.includes("promo") || value.includes("discount"))).toBe(false);
    TestRenderer.act(() => renderer.unmount());
  });
});
