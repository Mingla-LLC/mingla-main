/**
 * issue #4522 W-11 — the balance page's "Other amount" field: choosing it puts
 * the cursor in the field, and its empty hint follows the shared money rule
 * (a whole amount shows no decimals: "0"; it said "0.00" on a naira balance).
 *
 * Mounts the REAL TripBalancePanel with "Other amount" chosen and reads the
 * rendered text field; only icons, spinner, haptics and the animation library
 * are replaced.
 *
 * FAILS ON REVERT: drop `autoFocus`, or give the hint a fixed "0.00".
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: "AnimatedView",
    Text: "AnimatedText",
    createAnimatedComponent: (component: unknown) => component,
  },
  Easing: { out: () => () => 0, in: () => () => 0, inOut: () => () => 0, bezier: () => () => 0, cubic: () => 0, ease: () => 0 },
  interpolate: () => 0,
  interpolateColor: (_v: number, _i: number[], colours: string[]) => colours[0],
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  useAnimatedProps: () => ({}),
  useAnimatedStyle: () => ({}),
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useReducedMotion: () => true,
  useSharedValue: (value: unknown) => ({ value }),
  withDelay: (_ms: number, value: unknown) => value,
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: { buttonPress: () => undefined, selection: () => undefined },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<Node | string>;
  findAll: (p: (n: Node) => boolean) => Node[];
};
type Tree = { root: Node; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void) => void;
};
const { TripBalancePanel } = require("../TripBalancePanel") as typeof import("../TripBalancePanel");

const textOf = (node: Node): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

const balance = (currency: string) => ({
  orderId: "order-1",
  currency,
  depositMinor: 20000,
  paidMinor: 40000,
  remainingMinor: 90000,
  totalMinor: 130000,
  canPayAnyAmount: true,
  minPaymentMinor: 10000,
  maxPartialMinor: 90000,
  providerMinimumMinor: 0,
  paymentInFlight: false,
  nextPayment: { installmentId: "i1", dueAt: "2027-03-01T00:00:00Z", amountMinor: 30000 },
  openRows: [
    { installmentId: "i1", dueAt: "2027-03-01T00:00:00Z", amountMinor: 30000 },
    { installmentId: "i2", dueAt: "2027-04-01T00:00:00Z", amountMinor: 60000 },
  ],
  history: [{ installmentId: "deposit", kind: "deposit", status: "collected", amountMinor: 40000 }],
  planVersion: 2,
  heldCreditMinor: 0,
  overpaymentRefundedMinor: 0,
});

const mountPanel = (props: { currency: string; choice: "next" | "all" | "other"; brandName?: string }): Tree => {
  let tree: Tree | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TripBalancePanel
        amountMinor={30000}
        balance={balance(props.currency) as never}
        busy={false}
        choice={props.choice as never}
        customAmount=""
        onChoice={() => undefined}
        onCustomAmount={() => undefined}
        onPay={() => undefined}
        tripTitle="Lagos Weekend"
        brandName={props.brandName}
      />,
    );
  });
  return tree as Tree;
};

const otherField = (tree: Tree): Node => {
  const found = tree.root.findAll(
    (n) => n.type === "TextInput" && n.props.accessibilityLabel === "Other payment amount",
  );
  if (found.length !== 1) throw new Error(`expected one Other amount field, found ${found.length}`);
  return found[0];
};

describe("#4522 W-11 — Other amount", () => {
  test.each(["NGN", "USD", "GBP"])("%s: the empty hint is a whole 0, never 0.00", (currency) => {
    const tree = mountPanel({ currency, choice: "other" });
    expect(otherField(tree).props.placeholder).toBe("0");
    tree.unmount();
  });

  test("choosing Other amount focuses its field", () => {
    const tree = mountPanel({ currency: "NGN", choice: "other" });
    expect(otherField(tree).props.autoFocus).toBe(true);
    tree.unmount();
  });

  test("the field is not drawn until Other amount is chosen", () => {
    const tree = mountPanel({ currency: "NGN", choice: "next" });
    expect(
      tree.root.findAll((n) => n.type === "TextInput" && n.props.accessibilityLabel === "Other payment amount").length,
    ).toBe(0);
    expect(tree.root.findAll((n) => n.type === "Text").some((n) => textOf(n) === "Other amount")).toBe(true);
    tree.unmount();
  });
});
