/**
 * #4490 spec 08 O5 fix 2 (O5-B4): the closed-day headline money is never cut
 * off. At 390, 768, 1024 and 1440 wide, with a long amount (₦12,345,678.90)
 * and a long venue name, every headline amount on the "Day closed" card and the
 * totals cards is present in full, with no line limit and no shrink-to-fit
 * (the value text that showed "₦45,10…" had numberOfLines 1).
 *
 * Fails on revert: without KpiTile `wrapValue` the amounts carry numberOfLines
 * 1; without closedTileBasis the tiles keep a 46% / 22% basis at 390 / 768.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 dayCloseMoney.issue4490.o5fix2
 */
import React from "react";
import { Dimensions, StyleSheet, Text } from "react-native";
import type { ViewStyle } from "react-native";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderTreeNode) => boolean) => RenderTreeNode[];
}
interface RenderTree {
  root: RenderTreeNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  const passthrough =
    (Component: unknown) =>
    (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(Component, props);
  return {
    __esModule: true,
    default: {
      View: passthrough(RN.View),
      Text: passthrough(RN.Text),
      ScrollView: passthrough(RN.ScrollView),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: { bezier: () => () => 0, linear: () => 0, out: (fn: unknown) => fn, inOut: (fn: unknown) => fn, ease: () => 0, in: (fn: unknown) => fn, cubic: () => 0 },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => {
      try {
        return typeof fn === "function" ? fn() : {};
      } catch {
        return {};
      }
    },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withRepeat: (value: unknown) => value,
    withDelay: (_d: unknown, value: unknown) => value,
  };
});
jest.mock("../../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  return { __esModule: true, ScrollView: RN.ScrollView, default: RN.ScrollView };
});
jest.mock("expo-linear-gradient", () => {
  const RN = jest.requireActual("react-native");
  return { LinearGradient: RN.View };
});
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  router: { push: jest.fn() },
}));
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), rpc: jest.fn(), auth: {} },
}));

import { DayCloseDone } from "../DayCloseDone";
import { DayCloseTotals } from "../DayCloseTotals";
import { mapDaySummary } from "../../../../services/venueDayCloseService";
import { closedTileBasis } from "../dayCloseModel";

const BIG = 1234567890; // minor units: ₦12,345,678.90
const totals = {
  currency: "NGN",
  takings: { count: 18, amountMinor: BIG, tipMinor: BIG, serviceChargeMinor: BIG, guestFeesMinor: 0 },
  byMethod: [{ method: "cash", count: 10, amountMinor: BIG, tipMinor: 0 }],
  people: [],
  tipsByServer: [],
  tipsOtherMinor: 0,
  refunds: { count: 3, amountMinor: BIG, tipMinor: 0, byMethod: [] },
  voids: { count: 1, amountMinor: BIG },
  serviceChargeMinor: BIG,
  net: { takingsMinor: BIG, tipMinor: BIG },
  depositsUsed: { count: 0, amountMinor: 0 },
  depositRefunded: { count: 0, amountMinor: 0 },
  orderedOnline: { count: 0, amountMinor: 0 },
  door: { count: 0, amountMinor: 0, byMethod: [] },
  categories: { bookingsMinor: 0, onOpenChecksMinor: 0, foodAndDrinkMinor: BIG },
  card: { chargedMinor: 0, minglaFeesMinor: 0, refundedMinor: 0, toBankMinor: 0 },
  cash: { floatMinor: 0, cashPaymentsMinor: BIG, cashTipsMinor: 0, doorCashMinor: 0, cashRefundsMinor: 0,
    paidOutMinor: 0, paidOuts: [], expectedMinor: BIG },
  paidInToday: { paidInMinor: 0, paidIn: { atVenue: 0, online: 0 } },
  reconcile: { byMethodMatches: true, byPersonMatches: true, atVenueMatches: true, onlineMatches: true },
};
const closed = mapDaySummary({
  venueId: "00000000-4490-4000-8000-0000000005a1",
  venueName: "The Very Long Harmattan Terrace and Rooftop Lounge Lagos Island",
  businessDate: "2026-11-24", today: "2026-11-24", timezone: "Africa/Lagos", currency: "NGN", state: "closed",
  close: { closedAtLocal: "23:48", closedBy: { kind: "person", name: "Chioma" }, cashCountedMinor: BIG,
    cashExpectedMinor: BIG, differenceMinor: -50000, reopenCount: 0, canReopen: true },
  totals,
  late: { count: 0, amountMinor: 0, tipMinor: 0, payments: [], refundCount: 0, refundMinor: 0 },
  openChecks: [], blockingCount: 0, canClose: false, history: [],
});

const FULL = "₦12,345,678.90";

function setWidth(width: number): void {
  Dimensions.set({
    window: { width, height: 900, scale: 2, fontScale: 1 },
    screen: { width, height: 900, scale: 2, fontScale: 1 },
  });
}

async function render(width: number, element: (w: number) => React.ReactElement): Promise<RenderTree> {
  setWidth(width);
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element(width));
  });
  return tree as unknown as RenderTree;
}

const textsWith = (tree: RenderTree, value: string): RenderTreeNode[] =>
  tree.root.findAll((n) => n.type === Text && n.props.children === value);

describe("O5-B4 closed-day money is never truncated", () => {
  for (const width of [390, 768, 1024, 1440]) {
    test(`Day closed card at ${width} wide: takings, tips and cash counted read in full`, async () => {
      const tree = await render(width, () => (
        <DayCloseDone summary={closed} exporting={false} printing={false} onExport={jest.fn()} onPrint={jest.fn()} onReopen={jest.fn()} />
      ));
      const amounts = textsWith(tree, FULL);
      // takings, tips, cash counted (the late list and history add none here)
      expect(amounts.length).toBeGreaterThanOrEqual(3);
      for (const node of amounts) {
        expect(node.props.numberOfLines).toBeUndefined();
        expect(node.props.adjustsFontSizeToFit).toBe(false);
        expect(node.props.ellipsizeMode).toBeUndefined();
      }
      for (const id of ["day-close-done-takings", "day-close-done-tips", "day-close-done-cash"]) {
        const tile = tree.root.findAll((n) => n.props.testID === id && n.props.style !== undefined)[0];
        expect(tile).toBeDefined();
        expect((StyleSheet.flatten(tile.props.style as ViewStyle) as ViewStyle).flexBasis).toBe(width >= 1024 ? "22%" : "100%");
      }
      await TestRenderer.act(async () => { tree.unmount(); });
    });
  }

  test("below 1024 each headline tile takes its own row; from 1024 four sit across", () => {
    expect([390, 768, 1023].map(closedTileBasis)).toEqual(["100%", "100%", "100%"]);
    expect([1024, 1440].map(closedTileBasis)).toEqual(["22%", "22%"]);
  });

  for (const width of [390, 768, 1024, 1440]) {
    test(`totals cards at ${width} wide: every money value reads in full`, async () => {
      const tree = await render(width, (w) => <DayCloseTotals summary={closed} wide={w >= 600} />);
      const amounts = textsWith(tree, FULL);
      expect(amounts.length).toBeGreaterThanOrEqual(6);
      for (const node of amounts.slice(0, 6)) {
        expect(node.props.numberOfLines).toBeUndefined();
        expect(node.props.adjustsFontSizeToFit).toBe(false);
      }
      await TestRenderer.act(async () => { tree.unmount(); });
    });
  }
});
