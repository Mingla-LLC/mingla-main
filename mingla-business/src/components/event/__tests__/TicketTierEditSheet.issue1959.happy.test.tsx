import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { Platform } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (): null => null,
}));
jest.mock("../../../hooks/useEventWaitlist", () => ({
  useEventWaitlist: () => ({ data: [] }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? React.createElement("MockSheet", null, children) : null,
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => React.createElement("MockButton", props),
}));

// eslint-disable-next-line import/first
import { TicketTierEditSheet } from "../TicketTierEditSheet";
// eslint-disable-next-line import/first
import type { TicketStub } from "../../../store/draftEventStore";

type HostNode = { props: Record<string, unknown> };
type Tree = {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
    findAllByType: (type: string) => HostNode[];
  };
  unmount: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const ticket = (overrides: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-1959",
  name: "General Admission",
  priceGbp: 250,
  capacity: 200,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  passwordConfigured: false,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  currency: "NGN",
  ...overrides,
});

const field = (tree: Tree, label: string): HostNode => {
  const matches = tree.root.findAll(
    (node) => node.props.accessibilityLabel === label,
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
};

const button = (tree: Tree, label: string): HostNode => {
  const match = tree.root
    .findAllByType("MockButton")
    .find((node) => node.props.label === label);
  expect(match).toBeDefined();
  return match as HostNode;
};

const changeText = async (tree: Tree, label: string, value: string): Promise<void> => {
  await TestRenderer.act(() => {
    (field(tree, label).props.onChangeText as (next: string) => void)(value);
  });
};

const press = async (tree: Tree, label: string): Promise<void> => {
  await TestRenderer.act(() => {
    (field(tree, label).props.onPress as () => void)();
  });
};

const mount = async (
  initial: TicketStub | null,
  onSave: (saved: TicketStub) => void = () => undefined,
): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierEditSheet
        visible
        initial={initial}
        nextOrder={0}
        onClose={() => undefined}
        onSave={onSave}
        eventCurrency="NGN"
      />,
    );
  });
  return tree as Tree;
};

describe("#1959 ticket numeric fields replace existing values", () => {
  test("web pointer click reselects the whole value after focus places the caret", async () => {
    const tree = await mount(ticket({ priceGbp: 10000, capacity: 200 }));
    const originalOS = Platform.OS;
    const originalAnimationFrame = globalThis.requestAnimationFrame;
    const priceSelection = jest.fn();
    const capacitySelection = jest.fn();

    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;

    try {
      await TestRenderer.act(() => {
        (field(tree, "Ticket price in NGN").props.onPressIn as (
          event: unknown,
        ) => void)({ currentTarget: { setSelectionRange: priceSelection } });
        (field(tree, "Ticket capacity").props.onPressIn as (
          event: unknown,
        ) => void)({ currentTarget: { setSelectionRange: capacitySelection } });
      });

      expect(priceSelection).toHaveBeenCalledWith(0, 5);
      expect(capacitySelection).toHaveBeenCalledWith(0, 3);
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalOS,
      });
      globalThis.requestAnimationFrame = originalAnimationFrame;
      await TestRenderer.act(() => tree.unmount());
    }
  });

  test("a new tier starts with genuinely blank numeric values and Unlimited off", async () => {
    const tree = await mount(null);

    expect(field(tree, "Ticket price in NGN").props.value).toBe("");
    expect(field(tree, "Ticket capacity").props.value).toBe("");
    expect(field(tree, "Unlimited capacity").props.accessibilityState).toEqual({
      checked: false,
    });
    expect(button(tree, "Save ticket").props.disabled).toBe(true);

    await TestRenderer.act(() => tree.unmount());
  });

  test.each([
    [250, "10000"],
    [515, "25000"],
  ])("selects price %s on focus and emits only replacement %s", async (seed, replacement) => {
    const saved: TicketStub[] = [];
    const tree = await mount(ticket({ priceGbp: seed }), (value) => saved.push(value));
    const price = field(tree, "Ticket price in NGN");

    expect(price.props.value).toBe(String(seed));
    expect(price.props.selectTextOnFocus).toBe(true);
    await changeText(tree, "Ticket price in NGN", replacement);
    expect(field(tree, "Ticket price in NGN").props.value).toBe(replacement);

    await TestRenderer.act(() => {
      (button(tree, "Save changes").props.onPress as () => void)();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].priceGbp).toBe(Number(replacement));
    expect(saved[0].priceGbp).not.toBe(Number(`${replacement}${seed}`));

    await TestRenderer.act(() => tree.unmount());
  });

  test("capacity replacement and Unlimited round-trip preserve exactly one value", async () => {
    const saved: TicketStub[] = [];
    const tree = await mount(ticket(), (value) => saved.push(value));

    expect(field(tree, "Ticket capacity").props.selectTextOnFocus).toBe(true);
    await changeText(tree, "Ticket capacity", "50");
    expect(field(tree, "Ticket capacity").props.value).toBe("50");

    await press(tree, "Unlimited capacity");
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === "Ticket capacity")).toHaveLength(0);
    await press(tree, "Unlimited capacity");
    expect(field(tree, "Ticket capacity").props.value).toBe("50");

    await TestRenderer.act(() => {
      (button(tree, "Save changes").props.onPress as () => void)();
    });
    expect(saved[0]).toEqual(expect.objectContaining({ capacity: 50, isUnlimited: false }));

    await TestRenderer.act(() => tree.unmount());
  });

  test("rejects invalid price and capacity grammar without changing visible state", async () => {
    const tree = await mount(ticket({ priceGbp: 35.75, capacity: 80 }));

    for (const invalid of ["35.7.5", "1,000", "-5", "1e3", "£25"]) {
      await changeText(tree, "Ticket price in NGN", invalid);
      expect(field(tree, "Ticket price in NGN").props.value).toBe("35.75");
    }
    for (const invalid of ["8.5", "1,000", "-5", "1e3", "50 seats"]) {
      await changeText(tree, "Ticket capacity", invalid);
      expect(field(tree, "Ticket capacity").props.value).toBe("80");
    }

    await changeText(tree, "Ticket price in NGN", "42.");
    await changeText(tree, "Ticket capacity", "120");
    expect(field(tree, "Ticket price in NGN").props.value).toBe("42.");
    expect(field(tree, "Ticket capacity").props.value).toBe("120");

    await TestRenderer.act(() => tree.unmount());
  });

  test("Save requires positive paid/capped values but free and Unlimited remain exceptions", async () => {
    const tree = await mount(ticket());

    await changeText(tree, "Ticket price in NGN", "");
    expect(button(tree, "Save changes").props.disabled).toBe(true);
    await press(tree, "Free ticket");
    expect(button(tree, "Save changes").props.disabled).toBe(false);

    await press(tree, "Free ticket");
    await changeText(tree, "Ticket price in NGN", "25");
    await changeText(tree, "Ticket capacity", "");
    expect(button(tree, "Save changes").props.disabled).toBe(true);
    await changeText(tree, "Ticket capacity", "0");
    expect(button(tree, "Save changes").props.disabled).toBe(true);
    await changeText(tree, "Ticket capacity", "1.5");
    expect(field(tree, "Ticket capacity").props.value).toBe("0");
    expect(button(tree, "Save changes").props.disabled).toBe(true);
    await press(tree, "Unlimited capacity");
    expect(button(tree, "Save changes").props.disabled).toBe(false);

    await TestRenderer.act(() => tree.unmount());
  });
});
