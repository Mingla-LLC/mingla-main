/* eslint-disable import/first */
// issue #3827 — "Add a hidden paid ticket" / "Add a free guest-list ticket"
// from the private-link sheet open the ticket editor already set up.
//
// Part 1 mounts the REAL TicketTierEditSheet (chrome leaves mocked, as in
// TicketTierEditSheet.issue1959.happy.test.tsx) with a `newTicketPreset` and
// saves: the saved ticket is hidden (paid preset) or free (free preset), so it
// is a type a private link may use. Editing an existing ticket ignores presets.
//
// Part 2 pins the pure rule and the route the guests page pushes, which the
// event editor parses back (`?section=tickets&newTicket=<preset>`).
//
// FAILS-ON-REVERT: reset `setVisibility("public")` / `setIsFree(false)` for new
// tickets in TicketTierEditSheet and Part 1 goes red.

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: (): null => null }));
jest.mock("../../../hooks/useEventWaitlist", () => ({ useEventWaitlist: () => ({ data: [] }) }));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    visible ? require("react").createElement("MockSheet", null, children) : null,
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Button: (props: Record<string, unknown>) => require("react").createElement("MockButton", props),
}));

import { TicketTierEditSheet } from "../TicketTierEditSheet";
import type { TicketStub } from "../../../store/draftEventStore";
import {
  addTicketTypeForLinkRoute,
  isTicketLinkable,
  parseNewTicketPreset,
  type NewTicketPreset,
} from "../../../utils/ticketLinkEligibility";

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

const field = (tree: Tree, label: string): HostNode => {
  const matches = tree.root.findAll((node) => node.props.accessibilityLabel === label);
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
};
const button = (tree: Tree, label: string): HostNode => {
  const match = tree.root.findAllByType("MockButton").find((node) => node.props.label === label);
  expect(match).toBeDefined();
  return match as HostNode;
};
const changeText = async (tree: Tree, label: string, value: string): Promise<void> => {
  await TestRenderer.act(() => {
    (field(tree, label).props.onChangeText as (next: string) => void)(value);
  });
};

const mount = async (
  preset: NewTicketPreset | null,
  saved: TicketStub[],
  initial: TicketStub | null = null,
): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierEditSheet
        visible
        initial={initial}
        newTicketPreset={preset}
        nextOrder={1}
        onClose={() => undefined}
        onSave={(ticket) => saved.push(ticket)}
        eventCurrency="GBP"
      />,
    );
  });
  return tree as Tree;
};

describe("#3827 new ticket opened from the private-link sheet", () => {
  test("the hidden paid preset saves a hidden, paid ticket a private link can use", async () => {
    const saved: TicketStub[] = [];
    const tree = await mount("hidden-paid", saved);
    expect(field(tree, "Visibility: Hidden — private links only")).toBeDefined();
    await changeText(tree, "Ticket name", "VIP table");
    await changeText(tree, "Ticket price in GBP", "40");
    await changeText(tree, "Ticket capacity", "20");
    await TestRenderer.act(() => (button(tree, "Save ticket").props.onPress as () => void)());
    expect(saved).toHaveLength(1);
    expect(saved[0].visibility).toBe("hidden");
    expect(saved[0].isFree).toBe(false);
    expect(isTicketLinkable(saved[0])).toBe(true);
    await TestRenderer.act(() => tree.unmount());
  });

  test("the free guest-list preset saves a free ticket a private link can use", async () => {
    const saved: TicketStub[] = [];
    const tree = await mount("free-guest-list", saved);
    expect(field(tree, "Free ticket").props.accessibilityState).toMatchObject({ checked: true });
    await changeText(tree, "Ticket name", "Guest list");
    await changeText(tree, "Ticket capacity", "50");
    await TestRenderer.act(() => (button(tree, "Save ticket").props.onPress as () => void)());
    expect(saved).toHaveLength(1);
    expect(saved[0].isFree).toBe(true);
    expect(isTicketLinkable(saved[0])).toBe(true);
    await TestRenderer.act(() => tree.unmount());
  });

  test("no preset keeps today's blank public paid ticket", async () => {
    const tree = await mount(null, []);
    expect(field(tree, "Visibility: Public")).toBeDefined();
    expect(field(tree, "Free ticket").props.accessibilityState).toMatchObject({ checked: false });
    await TestRenderer.act(() => tree.unmount());
  });

  test("editing an existing ticket ignores a preset", async () => {
    const existing = {
      id: "ga", name: "General Admission", priceGbp: 25, capacity: 100, isFree: false,
      isUnlimited: false, visibility: "public", displayOrder: 0, approvalRequired: false,
      passwordProtected: false, password: null, waitlistEnabled: false, minPurchaseQty: 1,
      maxPurchaseQty: null, allowTransfers: true, description: null, saleStartAt: null,
      saleEndAt: null, availableAt: "both",
    } as TicketStub;
    const tree = await mount("hidden-paid", [], existing);
    expect(field(tree, "Visibility: Public")).toBeDefined();
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3827 private-link eligibility and the add-a-type route", () => {
  test("paid public types are not linkable; hidden or free types are", () => {
    const base = { isFree: false, priceGbp: 25, visibility: "public" as const };
    expect(isTicketLinkable(base)).toBe(false);
    expect(isTicketLinkable({ ...base, visibility: "hidden" })).toBe(true);
    expect(isTicketLinkable({ ...base, isFree: true, priceGbp: null })).toBe(true);
    expect(isTicketLinkable({ ...base, priceGbp: 0 })).toBe(true);
  });

  test("the route opens the published editor on Tickets in the preset, and parses back", () => {
    expect(addTicketTypeForLinkRoute("evt-1", "hidden-paid")).toBe(
      "/event/evt-1/edit?mode=edit-published&section=tickets&newTicket=hidden-paid",
    );
    expect(parseNewTicketPreset("hidden-paid")).toBe("hidden-paid");
    expect(parseNewTicketPreset(["free-guest-list"])).toBe("free-guest-list");
    expect(parseNewTicketPreset("public-paid")).toBeNull();
    expect(parseNewTicketPreset(undefined)).toBeNull();
  });
});
