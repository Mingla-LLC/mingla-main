/**
 * #3350 — the ticket sheet's red errors wait until the organiser leaves the
 * field (found filming the Scene 04 tutorial, 2026-09-14).
 *
 * A brand-new "Add ticket type" sheet opened with red text under Price and
 * Capacity and a red "3 things to fix before saving" box — before anything had
 * been typed. The app's other forms (checkout buyer details, guest
 * reservations, Add person) show a field's error once it has been left.
 *
 * What must still hold:
 *   - Save stays disabled while anything is invalid (pinned by #1959);
 *   - the list at Save still names what is missing (#2590), just not in red
 *     until the organiser has left a field with a problem.
 *
 * Same react-test-renderer harness as TicketTierEditSheet.issue1959.happy.test.tsx.
 *
 * Fails on revert: restore the ungated `priceInvalid` / `capacityInvalid` /
 * `capacityBelowSold` renders and the "before blur" assertions go red; drop
 * the pending style and the neutral-list assertion goes red.
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
// eslint-disable-next-line import/first
import { semantic } from "../../../constants/designSystem";

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
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const PRICE_ERROR = "Enter a price greater than zero, or mark this ticket free.";
const CAPACITY_ERROR =
  "Enter a whole-number capacity greater than zero, or mark this ticket unlimited.";

const textOf = (node: HostNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

/** Every rendered Text, whitespace-collapsed (JSX line breaks become spaces). */
const texts = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => n.type === "Text")
    .map((n) => textOf(n).replace(/\s+/g, " ").trim());

const flatStyle = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
    : ((style as Record<string, unknown>) ?? {});

const field = (tree: Tree, label: string): HostNode => {
  const matches = tree.root.findAll((n) => n.props.accessibilityLabel === label);
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
};

const saveButton = (tree: Tree, label: string): HostNode => {
  const match = tree.root
    .findAllByType("MockButton")
    .find((n) => n.props.label === label);
  expect(match).toBeDefined();
  return match as HostNode;
};

const blockerBox = (tree: Tree): HostNode | undefined =>
  tree.root.findAll(
    (n) => n.type === "View" && n.props.testID === "ticket-save-blockers",
  )[0];

const act = async (fn: () => void): Promise<void> => {
  await TestRenderer.act(() => {
    fn();
  });
};

const mount = async (
  props: Partial<React.ComponentProps<typeof TicketTierEditSheet>> = {},
): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierEditSheet
        visible
        initial={null}
        nextOrder={0}
        onClose={() => undefined}
        onSave={() => undefined}
        eventCurrency="USD"
        {...props}
      />,
    );
  });
  return tree as Tree;
};

const ticket = (overrides: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-3350",
  name: "General Admission",
  priceGbp: 25,
  capacity: 120,
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

describe("#3350 — a new ticket sheet is not red before the organiser has done anything", () => {
  test("no price or capacity error on open; Save is disabled and the list is a neutral to-do", async () => {
    const tree = await mount();
    const shown = texts(tree);

    expect(shown).not.toContain(PRICE_ERROR);
    expect(shown).not.toContain(CAPACITY_ERROR);
    expect(saveButton(tree, "Save ticket").props.disabled).toBe(true);

    // #2590 — the reasons are still at the button…
    const box = blockerBox(tree);
    expect(box).toBeDefined();
    expect(textOf(box as HostNode)).toContain("3 things to fix before saving");
    // …but nothing in it is painted as a failure yet.
    expect(flatStyle((box as HostNode).props.style).backgroundColor).not.toBe(
      semantic.errorTint,
    );
    const boxTexts = (box as HostNode).children.filter(
      (c): c is HostNode => typeof c !== "string",
    );
    for (const t of boxTexts) {
      expect(flatStyle(t.props.style).color).not.toBe(semantic.error);
    }

    await TestRenderer.act(() => tree.unmount());
  });

  test("typing a price does not flash an error; leaving the field empty does", async () => {
    const tree = await mount();
    const price = (): HostNode => field(tree, "Ticket price in USD");

    await act(() => (price().props.onChangeText as (v: string) => void)("0"));
    expect(texts(tree)).not.toContain(PRICE_ERROR);
    await act(() => (price().props.onChangeText as (v: string) => void)(""));
    expect(texts(tree)).not.toContain(PRICE_ERROR);

    await act(() => (price().props.onBlur as () => void)());
    expect(texts(tree)).toContain(PRICE_ERROR);
    expect(texts(tree)).not.toContain(CAPACITY_ERROR); // capacity not left yet
    // Once an error is revealed the list at Save turns red.
    expect(flatStyle((blockerBox(tree) as HostNode).props.style).backgroundColor).toBe(
      semantic.errorTint,
    );

    // Fixing the value clears the error straight away.
    await act(() => (price().props.onChangeText as (v: string) => void)("25"));
    expect(texts(tree)).not.toContain(PRICE_ERROR);

    await TestRenderer.act(() => tree.unmount());
  });

  test("capacity errors wait for blur too, and Save stays disabled throughout", async () => {
    const tree = await mount();
    const capacity = (): HostNode => field(tree, "Ticket capacity");

    await act(() => (capacity().props.onChangeText as (v: string) => void)("0"));
    expect(texts(tree)).not.toContain(CAPACITY_ERROR);
    expect(saveButton(tree, "Save ticket").props.disabled).toBe(true);

    await act(() => (capacity().props.onBlur as () => void)());
    expect(texts(tree)).toContain(CAPACITY_ERROR);
    expect(saveButton(tree, "Save ticket").props.disabled).toBe(true);

    await TestRenderer.act(() => tree.unmount());
  });

  test("reopening the sheet starts clean again", async () => {
    let tree = await mount();
    await act(() =>
      (field(tree, "Ticket price in USD").props.onBlur as () => void)(),
    );
    expect(texts(tree)).toContain(PRICE_ERROR);
    await TestRenderer.act(() => tree.unmount());

    tree = await mount();
    expect(texts(tree)).not.toContain(PRICE_ERROR);
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3350 — the sold-tickets floor waits for blur as well", () => {
  test("typing towards a capacity above the sold count never flashes the floor error", async () => {
    const tree = await mount({ initial: ticket({ capacity: 150 }), soldCount: 100 });
    const capacity = (): HostNode => field(tree, "Ticket capacity");
    const floor = "Cannot go below 100 tickets sold. Increase capacity or refund existing buyers first.";

    // Retyping "150" passes through "1" and "15", both below 100 sold.
    await act(() => (capacity().props.onChangeText as (v: string) => void)("1"));
    expect(texts(tree)).not.toContain(floor);
    await act(() => (capacity().props.onChangeText as (v: string) => void)("15"));
    expect(texts(tree)).not.toContain(floor);
    expect(saveButton(tree, "Save changes").props.disabled).toBe(true);

    await act(() => (capacity().props.onBlur as () => void)());
    expect(texts(tree)).toContain(floor);

    await act(() => (capacity().props.onChangeText as (v: string) => void)("150"));
    expect(texts(tree)).not.toContain(floor);
    expect(saveButton(tree, "Save changes").props.disabled).toBe(false);

    await TestRenderer.act(() => tree.unmount());
  });
});
