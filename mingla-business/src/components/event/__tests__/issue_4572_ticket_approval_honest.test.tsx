/**
 * #4572 item 7c (D7) — ticket "Approval required" is not enforced yet, so the
 * Host editor stops promising it.
 *
 * WHAT THIS FILE PROVES (the REAL TicketTierEditSheet, rendered)
 *   AP-1 a new ticket: the switch is off, disabled, says "Coming soon", and a
 *        press does NOT turn it on (adversarial: a disabled switch ignores it).
 *   AP-2 a ticket that already has approval on: the switch is on, enabled,
 *        says "Not checked yet", can be turned off, and saves off.
 *   AP-3 once off it cannot be turned back on.
 *   AP-4 no shipped string promises host approval for tickets
 *        ("approve or reject before they pay", the approval toast, the
 *        "Request access" / "Request approval" ticket labels).
 *
 * FAILS-ON-REVERT (true line deletion):
 *   - delete `disabled={!approvalRequired}` → AP-1 fails (the press turns it on);
 *   - delete `if (disabled) return;` in ToggleRow and the `disabled` prop →
 *     AP-1 fails;
 *   - restore the old sub "You approve or reject before they pay." → AP-4 fails.
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
// The real Sheet's scrim tap, Escape, Android back and drag all call its
// onClose (or onRequestClose when its dismissGuard says so); the mock keeps
// those props so the test can dismiss it the way a backdrop click does.
jest.mock("../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children?: React.ReactNode }) =>
    props.visible ? React.createElement("MockSheet", props, props.children) : null,
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
// #4420 — the sheet's unsaved-changes dialog (reanimated is not loadable here).
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    props.visible === true ? React.createElement("MockConfirmDialog", props) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => React.createElement("MockButton", props),
}));

// eslint-disable-next-line import/first
import { TicketTierEditSheet } from "../TicketTierEditSheet";
// eslint-disable-next-line import/first
import type { TicketStub } from "../../../store/draftEventStore";

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<HostNode | string>;
};
type Tree = {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
    findAllByType: (type: string) => HostNode[];
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const act = async (fn: () => void): Promise<void> => {
  await TestRenderer.act(() => {
    fn();
  });
};

const sheet = (tree: Tree): HostNode => tree.root.findAllByType("MockSheet")[0];
const dialog = (tree: Tree): HostNode | undefined => tree.root.findAllByType("MockConfirmDialog")[0];
const field = (tree: Tree, label: string): HostNode => {
  const matches = tree.root.findAll((n) => n.props.accessibilityLabel === label);
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
};
const button = (tree: Tree, label: string): HostNode => {
  const match = tree.root.findAllByType("MockButton").find((n) => n.props.label === label);
  expect(match).toBeDefined();
  return match as HostNode;
};
const type = async (tree: Tree, label: string, value: string): Promise<void> => {
  await act(() => {
    (field(tree, label).props.onChangeText as (v: string) => void)(value);
  });
};
const backdrop = async (tree: Tree): Promise<void> => {
  await act(() => {
    (sheet(tree).props.onClose as () => void)();
  });
};

const ticket = (overrides: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-4420",
  name: "General Admission",
  priceGbp: 25,
  capacity: 100,
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
  currency: "USD",
  ...overrides,
});

const mount = async (
  onSave: (t: TicketStub) => void,
  initial: TicketStub | null = null,
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
        eventCurrency="USD"
      />,
    );
  });
  return tree as Tree;
};

const textOf = (node: HostNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const approvalSwitch = (tree: Tree): HostNode => {
  const matches = tree.root.findAll(
    (n) => n.props.accessibilityLabel === "Approval required" && n.props.accessibilityRole === "switch",
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
};
const press = async (node: HostNode): Promise<void> => {
  await act(() => {
    (node.props.onPress as () => void)();
  });
};

describe("#4572 7c ticket approval is honest", () => {
  test("AP-1 a new ticket cannot switch approval on (Coming soon)", async () => {
    const tree = await mount(() => undefined);
    const sw = approvalSwitch(tree);
    expect(sw.props.disabled).toBe(true);
    expect(sw.props.accessibilityState).toEqual({ checked: false, disabled: true });
    const text = textOf(sw);
    expect(text).toContain("Coming soon");
    expect(text).toContain("Coming soon: approve guests before they get a ticket.");
    await press(sw);
    expect(approvalSwitch(tree).props.accessibilityState).toEqual({ checked: false, disabled: true });
  });

  test("AP-2 an approval-on ticket says Not checked yet, can be turned off and saves off", async () => {
    const onSave = jest.fn<(t: TicketStub) => void>();
    const tree = await mount(onSave, ticket({ approvalRequired: true }));
    const sw = approvalSwitch(tree);
    expect(sw.props.disabled).toBe(false);
    expect(sw.props.accessibilityState).toEqual({ checked: true, disabled: false });
    expect(textOf(sw)).toContain(
      "Not checked yet: guests get their ticket straight away. Turn this off to remove the label.",
    );
    await press(sw);
    const off = approvalSwitch(tree);
    expect(off.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(textOf(off)).toContain("Coming soon");
    await act(() => (button(tree, "Save changes").props.onPress as () => void)());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].approvalRequired).toBe(false);
  });

  test("AP-3 once off it cannot be turned back on", async () => {
    const tree = await mount(() => undefined, ticket({ approvalRequired: true }));
    await press(approvalSwitch(tree));
    await press(approvalSwitch(tree));
    expect(approvalSwitch(tree).props.accessibilityState).toEqual({ checked: false, disabled: true });
  });
});

describe("#4572 7c no shipped string promises ticket approval", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const REPO = join(__dirname, "..", "..", "..", "..", "..");
  const read = (rel: string): string => readFileSync(join(REPO, rel), "utf8");

  test.each([
    ["mingla-business/src/components/event/TicketTierEditSheet.tsx", "approve or reject before they pay"],
    ["mingla-business/src/constants/buyerClaimCopy.ts", "approvalToast"],
    ["mingla-business/src/components/event/PublicEventPage.tsx", "approvalToast"],
    ["mingla-business/src/components/event/PublicEventPage.tsx", "onRequestApproval"],
    ["mingla-business/src/utils/ticketDisplay.ts", "\"Request access\""],
    ["packages/offering-rendering/PublicEventPage.tsx", "\"Request approval\""],
    ["packages/offering-rendering/PublicEventPage.tsx", "onRequestApproval"],
    ["packages/offering-rendering/types.ts", "onRequestApproval"],
    // The buyer row follows the free / buy path for an approval ticket.
    ["packages/offering-rendering/PublicEventPage.tsx", "ticket.approvalRequired"],
  ])("%s has no %s", (rel, needle) => {
    expect(read(rel)).not.toContain(needle);
  });
});
