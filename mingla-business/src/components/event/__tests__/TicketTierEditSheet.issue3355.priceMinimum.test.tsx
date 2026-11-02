/**
 * #3355 P6 — Seth's decision 6, rendered: the ticket sheet refuses a new paid
 * price below the payment provider's minimum. It shows the minimum message
 * under the price, lists it at Save, and keeps Save disabled; the exact
 * minimum saves. The rule itself is in
 * src/utils/__tests__/issue_3355_ticket_price_minimum.implementor.test.ts.
 */
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

type HostNode = { type: unknown; props: Record<string, unknown> };
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

const MINIMUM =
  "Paid tickets must be at least £0.30. That's the smallest amount the payment provider can charge.";

const field = (tree: Tree, label: string): HostNode => {
  const matches = tree.root.findAll((node) => node.props.accessibilityLabel === label);
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
};

const saveButton = (tree: Tree): HostNode => {
  const match = tree.root
    .findAllByType("MockButton")
    .find((node) => node.props.label === "Save ticket");
  expect(match).toBeDefined();
  return match as HostNode;
};

const shownTexts = (tree: Tree): string[] =>
  tree.root
    .findAll((node) => node.type === "Text")
    .map((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join("") : String(children ?? "");
    });

const changeText = async (tree: Tree, label: string, value: string): Promise<void> => {
  await TestRenderer.act(() => {
    (field(tree, label).props.onChangeText as (next: string) => void)(value);
  });
};

const mountNewGbpTicket = async (onSave: (saved: TicketStub) => void): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierEditSheet
        visible
        initial={null}
        nextOrder={0}
        onClose={() => undefined}
        onSave={onSave}
        eventCurrency="GBP"
      />,
    );
  });
  const created = tree as Tree;
  await changeText(created, "Ticket name", "General Admission");
  await changeText(created, "Ticket capacity", "100");
  return created;
};

describe("#3355 P6 the ticket sheet enforces the provider minimum", () => {
  test("a new 20p GBP ticket shows the minimum message and cannot be saved", async () => {
    const saved: TicketStub[] = [];
    const tree = await mountNewGbpTicket((value) => saved.push(value));
    await changeText(tree, "Ticket price in GBP", "0.20");

    expect(saveButton(tree).props.disabled).toBe(true);
    // Under the price, and in the list at Save.
    expect(shownTexts(tree).filter((text) => text.includes(MINIMUM)).length).toBeGreaterThanOrEqual(2);
    expect(saved).toEqual([]);
    await TestRenderer.act(() => tree.unmount());
  });

  test("the exact minimum clears the message and saves", async () => {
    const saved: TicketStub[] = [];
    const tree = await mountNewGbpTicket((value) => saved.push(value));
    await changeText(tree, "Ticket price in GBP", "0.30");

    expect(shownTexts(tree).some((text) => text.includes(MINIMUM))).toBe(false);
    expect(saveButton(tree).props.disabled).toBe(false);
    await TestRenderer.act(() => {
      (saveButton(tree).props.onPress as () => void)();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].priceGbp).toBe(0.3);
    await TestRenderer.act(() => tree.unmount());
  });
});
