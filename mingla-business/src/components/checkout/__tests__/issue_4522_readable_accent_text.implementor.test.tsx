/**
 * issue #4522 W-11 — orange text on the dark surfaces uses the readable design
 * token (accentText), never the orange fill token (accent).
 *
 * Here: the balance page's brand label (REAL TripBalancePanel, rendered) and
 * the address field's "Use what you typed" row (the REAL Host AddressInput's
 * token bundle handed to the shared field). The "Total due today" rows on the
 * trip details and payment steps are rendered in
 * issue_4522_continue_no_nested_button and issue_4522_quote_money_glyph.
 *
 * FAILS ON REVERT: paint the panel eyebrow or the address action text with
 * color.accent again.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";
import { StyleSheet } from "react-native";

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
const { TripBalancePanel } = require("../../trip/TripBalancePanel") as typeof import("../../trip/TripBalancePanel");

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

let mockAddressTokens: { action?: { text?: string } } | undefined;
jest.mock("../../location/sharedAddressField", () => ({
  SharedAddressInput: (props: { tokens: { action?: { text?: string } } }) => {
    mockAddressTokens = props.tokens;
    return null;
  },
}));
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const { color: surfaceColor } = require("../../../theme/surfaceTokens") as typeof import("../../../theme/surfaceTokens");
const { color: dsColor } = require("../../../constants/designSystem") as typeof import("../../../constants/designSystem");
const { AddressInput } = require("../../location/AddressInput") as typeof import("../../location/AddressInput");

describe("readable accent text on dark", () => {
  test("the two tokens really differ (the claim is not vacuous)", () => {
    expect(surfaceColor.accentText).not.toBe(surfaceColor.accent);
    expect(dsColor.accentText).not.toBe(dsColor.accent);
  });

  test("the balance page's brand label paints with accentText", () => {
    const tree = mountPanel({ currency: "USD", choice: "next", brandName: "Mingla Lagos" });
    const label = tree.root.findAll((n) => n.type === "Text" && textOf(n) === "Mingla Lagos");
    expect(label.length).toBe(1);
    expect(StyleSheet.flatten(label[0].props.style as never)).toMatchObject({ color: surfaceColor.accentText });
    tree.unmount();
  });

  test("the address field's 'Use what you typed' row text uses accentText", () => {
    mockAddressTokens = undefined;
    TestRenderer.act(() => {
      TestRenderer.create(
        <AddressInput value="" onChangeText={() => undefined} onPick={() => undefined} onClear={() => undefined} />,
      );
    });
    const capturedActionText = (): string | undefined => mockAddressTokens?.action?.text;
    expect(capturedActionText()).toBe(dsColor.accentText);
  });
});
