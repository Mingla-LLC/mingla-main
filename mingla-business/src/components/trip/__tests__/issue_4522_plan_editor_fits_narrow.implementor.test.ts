/**
 * issue #4522 W-7 — at 375 px the plan editor's rows must not push past the
 * card: a web text field beside a suffix needs minWidth 0 and the suffix must
 * be allowed to shrink/wrap. Measured in a browser at 375 px (no element past
 * the card in Percent or Amount mode).
 *
 * Mounts the REAL editor (deposit, final-payment days and flexible minimum
 * rows all showing) and reads the style each rendered field and suffix gets.
 * FAILS ON REVERT: drop `minWidth: 0` from the field style or `flexShrink: 1`
 * from the suffix style.
 */
import React, { act } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

import { PaymentPlanEditorV2 } from "../PaymentPlanEditorV2";
import {
  DEFAULT_TRIP_PAYMENT_PLAN_V2,
  TRIP_PLAN_V2_EDITOR_RUNTIME,
  type TripPaymentPlanV2,
} from "../tripPlanV2EditorModel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  parent: Node | null;
  children: Array<Node | string>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer {
  root: Node;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
};

const mounted: Renderer[] = [];
afterEach(() => {
  while (mounted.length > 0) {
    const tree = mounted.pop();
    if (tree !== undefined) act(() => tree.unmount());
  }
});

const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
    : ((style as Record<string, unknown> | undefined) ?? {});

const mount = (value: TripPaymentPlanV2): Renderer => {
  let tree!: Renderer;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(PaymentPlanEditorV2, {
        value,
        onChange: jest.fn(),
        totalAmountMinor: 120_000,
        currency: "USD",
        tripStartAt: "2027-03-12T12:00:00.000Z",
        timeZone: "Africa/Lagos",
        packageCount: 1,
        sharePaymentPlan: false,
        onSharePaymentPlanChange: jest.fn(),
        showShareControl: false,
        model: TRIP_PLAN_V2_EDITOR_RUNTIME,
      }),
    );
  });
  mounted.push(tree);
  return tree;
};

const textOf = (node: Node): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

/** The rendered host field for a testID, and the suffix text drawn beside it. */
const rowFor = (tree: Renderer, testID: string): { field: Node; suffix: Node } => {
  const field = tree.root.findAll((n) => n.type === "TextInput" && n.props.testID === testID)[0];
  if (field === undefined) throw new Error(`no field ${testID}`);
  let row: Node | null = field.parent;
  while (row !== null && row.type !== "View") row = row.parent;
  if (row === null) throw new Error(`no row around ${testID}`);
  const suffix = row.findAll((n) => n.type === "Text")[0];
  if (suffix === undefined) throw new Error(`no suffix beside ${testID}`);
  return { field, suffix };
};

const ROWS: Array<[string, TripPaymentPlanV2, string]> = [
  ["deposit (percent)", { ...DEFAULT_TRIP_PAYMENT_PLAN_V2, flex: { enabled: false } }, "trip-plan-v2-deposit-input"],
  [
    "deposit (amount)",
    { ...DEFAULT_TRIP_PAYMENT_PLAN_V2, deposit: { mode: "amount", amount_minor: 30_000 }, flex: { enabled: false } },
    "trip-plan-v2-deposit-input",
  ],
  ["final payment days", { ...DEFAULT_TRIP_PAYMENT_PLAN_V2, flex: { enabled: false } }, "trip-plan-v2-final-days"],
  [
    "flexible minimum",
    { ...DEFAULT_TRIP_PAYMENT_PLAN_V2, flex: { enabled: true, min_payment_minor: 5_000 } },
    "trip-plan-v2-flex-min",
  ],
];

describe("PaymentPlanEditorV2 at a narrow width", () => {
  test.each(ROWS)("%s: the field beside its suffix may shrink", (_label, value, testID) => {
    const { field } = rowFor(mount(value), testID);
    const style = flat(field.props.style);
    expect(style.flex).toBe(1);
    expect(style.minWidth).toBe(0);
  });

  test.each(ROWS)("%s: the suffix may shrink and wrap", (_label, value, testID) => {
    const { suffix } = rowFor(mount(value), testID);
    expect(textOf(suffix).length).toBeGreaterThan(0);
    expect(flat(suffix.props.style).flexShrink).toBe(1);
  });

  test("the long suffix is the one that must wrap", () => {
    const { suffix } = rowFor(mount({ ...DEFAULT_TRIP_PAYMENT_PLAN_V2, flex: { enabled: false } }), "trip-plan-v2-final-days");
    expect(textOf(suffix)).toBe("days before departure");
  });
});
