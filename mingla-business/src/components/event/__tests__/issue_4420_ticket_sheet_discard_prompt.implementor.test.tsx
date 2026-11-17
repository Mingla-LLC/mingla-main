/**
 * #4420 web journey (shot 14) — the Add ticket sheet, with a name and price
 * typed, closed on a backdrop click with no prompt and the typing was lost.
 * The sheet now asks "Discard your changes?" (the shared unsaved-changes
 * dialog the published editors use) whenever its fields differ from what it
 * opened with, on every way out: backdrop, Escape, Android back, drag and
 * Cancel.
 *
 * WHAT THIS FILE PROVES (the REAL TicketTierEditSheet, rendered)
 *   DT-1 an untouched new ticket closes at once (no prompt).
 *   DT-2 a typed new ticket: a backdrop dismiss opens the discard dialog and
 *        does NOT close; Keep editing keeps the typing; Discard closes.
 *   DT-3 Cancel with edits asks the same way.
 *   DT-4 editing a saved ticket without changing anything closes at once; a
 *        changed price asks; the native drag guard reports the edits.
 *
 * FAILS-ON-REVERT: restore TicketTierEditSheet's `onClose={onClose}` and
 * DT-2 / DT-3 / DT-4 go red.
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

const mount = async (onClose: () => void, initial: TicketStub | null = null): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierEditSheet
        visible
        initial={initial}
        nextOrder={0}
        onClose={onClose}
        onSave={() => undefined}
        eventCurrency="USD"
      />,
    );
  });
  return tree as Tree;
};

describe("#4420 the ticket sheet asks before discarding typed values", () => {
  test("DT-1 an untouched new ticket closes at once", async () => {
    const onClose = jest.fn();
    const tree = await mount(onClose);
    await backdrop(tree);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog(tree)).toBeUndefined();
  });

  test("DT-2 a typed new ticket asks on backdrop; Keep editing keeps it; Discard closes", async () => {
    const onClose = jest.fn();
    const tree = await mount(onClose);
    await type(tree, "Ticket name", "General Admission");
    await backdrop(tree);
    expect(onClose).not.toHaveBeenCalled();
    const open = dialog(tree);
    expect(open?.props.title).toBe("Discard your changes?");
    expect(open?.props.confirmLabel).toBe("Discard");
    expect(open?.props.cancelLabel).toBe("Keep editing");

    await act(() => (open?.props.onClose as () => void)());
    expect(dialog(tree)).toBeUndefined();
    expect(field(tree, "Ticket name").props.value).toBe("General Admission");
    expect(onClose).not.toHaveBeenCalled();

    await backdrop(tree);
    await act(() => (dialog(tree)?.props.onConfirm as () => void)());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("DT-3 Cancel with edits asks the same way", async () => {
    const onClose = jest.fn();
    const tree = await mount(onClose);
    await type(tree, "Ticket name", "VIP");
    await act(() => (button(tree, "Cancel").props.onPress as () => void)());
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog(tree)?.props.title).toBe("Discard your changes?");
  });

  test("DT-4 a saved ticket closes at once unchanged, and asks once its price changes", async () => {
    const onClose = jest.fn();
    const tree = await mount(onClose, ticket());
    expect((sheet(tree).props.dismissGuard as () => boolean)()).toBe(false);
    await backdrop(tree);
    expect(onClose).toHaveBeenCalledTimes(1);

    const onClose2 = jest.fn();
    const edited = await mount(onClose2, ticket());
    const priceInputs = edited.root.findAll((n) =>
      typeof n.props.onChangeText === "function" && n.props.value === "25");
    expect(priceInputs.length).toBeGreaterThan(0);
    await act(() => (priceInputs[priceInputs.length - 1].props.onChangeText as (v: string) => void)("30"));
    expect((sheet(edited).props.dismissGuard as () => boolean)()).toBe(true);
    await backdrop(edited);
    expect(onClose2).not.toHaveBeenCalled();
    expect(dialog(edited)?.props.title).toBe("Discard your changes?");
  });
});
