/** Issue #4063 T5-9 — operator-created bookings require the guest's mobile. */
import React from "react";
import { afterEach, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native", () => ({
  ...jest.requireActual<Record<string, unknown>>("react-native"),
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(true),
    addEventListener: () => ({ remove: () => undefined }),
  },
}));
jest.mock("../../../hooks/useVenueListings", () => ({
  useVenueListing: () => ({ data: { countryCode: "US" } }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ countryCode: "US" }),
}));
jest.mock("../../../hooks/useVenueAvailability", () => ({
  useAvailableSlots: () => ({
    data: [{
      slotStartUtc: "2026-11-01T18:00:00.000Z",
      slotLocalLabel: "6 PM",
      isFull: false,
    }],
    isLoading: false,
  }),
}));
jest.mock("../../../hooks/useVenueTables", () => ({
  useVenueTables: () => ({ data: [] }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: require("react-native").ScrollView,
}));
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
  KeyboardToolbar: () => null,
}));
jest.mock("../../../../../packages/phone-input/CountryPickerModal", () => ({
  CountryPickerModal: () => null,
  CountryPickerOverlay: () => null,
}));
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) => require("react").createElement("Input", props),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => require("react").createElement("Button", props),
}));

import { ReservationCreateSheet } from "../ReservationCreateSheet";

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<Node | string>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Tree { root: Node; unmount: () => void }
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
const mounted: Tree[] = [];

const find = (tree: Tree, predicate: (node: Node) => boolean): Node => {
  const result = tree.root.findAll(predicate)[0];
  if (!result) throw new Error("Expected mounted control");
  return result;
};

const text = (node: Node): string =>
  node.children.map((child) => typeof child === "string" ? child : text(child)).join(" ");

test("empty mobile keeps Create disabled; a valid mobile is submitted", async () => {
  const onSave = jest.fn();
  let tree!: Tree;
  await renderer.act(async () => {
    tree = renderer.create(
      <ReservationCreateSheet
        visible
        onClose={() => undefined}
        brandId="brand-4063"
        venueId="venue-4063"
        onSave={onSave}
        saving={false}
      />,
    );
  });
  mounted.push(tree);

  const byTestId = (testID: string) => find(tree, (node) => node.props.testID === testID);
  await renderer.act(async () => {
    (byTestId("reservation-guest-name").props.onChangeText as (value: string) => void)("Tolu Ade");
    (byTestId("reservation-slot-2026-11-01T18:00:00.000Z").props.onPress as () => void)();
  });

  const save = () => byTestId("reservation-create-save");
  expect(save().props.disabled).toBe(true);
  expect(text(tree.root)).toContain("Guest's mobile *");
  expect(text(tree.root)).toContain("We'll text them a link to their booking.");

  const phone = find(
    tree,
    (node) => node.type === "TextInput" && node.props.keyboardType === "phone-pad",
  );
  await renderer.act(async () => {
    (phone.props.onChangeText as (value: string) => void)("4155550123");
  });
  expect(save().props.disabled).toBe(false);
  await renderer.act(async () => {
    (save().props.onPress as () => void)();
  });
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    guestName: "Tolu Ade",
    guestPhoneE164: "+14155550123",
  }));
});

afterEach(async () => {
  await renderer.act(async () => mounted.splice(0).forEach((tree) => tree.unmount()));
});
