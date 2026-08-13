import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

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
const Renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const seed: TicketStub = {
  id: "ticket-1959-usd",
  name: "Early Entry",
  priceGbp: 19.95,
  capacity: 75,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 1,
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
};

const find = (tree: Tree, label: string): HostNode => {
  const nodes = tree.root.findAll((node) => node.props.accessibilityLabel === label);
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[nodes.length - 1];
};

const render = async (
  initial: TicketStub,
  onSave: (value: TicketStub) => void,
): Promise<Tree> => {
  let tree: Tree | undefined;
  await Renderer.act(() => {
    tree = Renderer.create(
      <TicketTierEditSheet
        visible
        initial={initial}
        nextOrder={2}
        onClose={() => undefined}
        onSave={onSave}
        eventCurrency="USD"
      />,
    );
  });
  return tree as Tree;
};

const replace = async (tree: Tree, label: string, value: string): Promise<void> => {
  const input = find(tree, label);
  expect(input.props.selectTextOnFocus).toBe(true);
  await Renderer.act(() => {
    (input.props.onChangeText as (next: string) => void)(value);
  });
};

describe("#1959 tester adversarial — two-decimal currency survives save and reopen", () => {
  test("USD decimal price and capacity replace once, persist exactly, and remain replaceable after reopen", async () => {
    const firstSave: TicketStub[] = [];
    const first = await render(seed, (value) => firstSave.push(value));

    expect(find(first, "Ticket price in USD").props.value).toBe("19.95");
    await replace(first, "Ticket price in USD", "21.50");
    await replace(first, "Ticket capacity", "40");
    await Renderer.act(() => {
      const save = first.root
        .findAllByType("MockButton")
        .find((node) => node.props.label === "Save changes");
      expect(save?.props.disabled).toBe(false);
      (save?.props.onPress as () => void)();
    });

    expect(firstSave).toHaveLength(1);
    expect(firstSave[0]).toEqual(
      expect.objectContaining({
        priceGbp: 21.5,
        capacity: 40,
        isUnlimited: false,
      }),
    );
    await Renderer.act(() => first.unmount());

    const secondSave: TicketStub[] = [];
    const reopened = await render(firstSave[0], (value) => secondSave.push(value));
    expect(find(reopened, "Ticket price in USD").props.value).toBe("21.5");
    expect(find(reopened, "Ticket capacity").props.value).toBe("40");

    await replace(reopened, "Ticket price in USD", "7.25");
    await replace(reopened, "Ticket capacity", "12");
    await Renderer.act(() => {
      const save = reopened.root
        .findAllByType("MockButton")
        .find((node) => node.props.label === "Save changes");
      (save?.props.onPress as () => void)();
    });

    expect(secondSave[0]).toEqual(
      expect.objectContaining({ priceGbp: 7.25, capacity: 12, isUnlimited: false }),
    );
    expect(secondSave[0].capacity).not.toBe(1240);

    await Renderer.act(() => reopened.unmount());
  });
});
