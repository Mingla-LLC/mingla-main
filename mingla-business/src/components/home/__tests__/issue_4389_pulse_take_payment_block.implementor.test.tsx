/**
 * #4389 HT (Seth: "more breathing room … Take a payment … full width of the
 * box it's in").
 *   - The money header is only "TOTAL LIFETIME REVENUE ›" (no pill in it).
 *   - Take a payment is a full-width button at the BOTTOM of the money panel,
 *     after the "At the door today" line, 50pt tall, icon before the label.
 *   - Lifetime revenue is the card payout ledger (cash / paid another way,
 *     and a card sale until it is processed, are not in it). With door sales
 *     today the panel never says "Your first sale will show here"; it names
 *     the figure "From card sales" instead, so it never contradicts itself.
 *
 * FAILS ON REVERT: the button back in the header → T1; the first-sale line
 * shown next to door sales → T2.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-svg", () => {
  const R = jest.requireActual("react") as typeof React;
  const C = (): null => null;
  return { __esModule: true, default: C, Path: C, Defs: C, LinearGradient: C, Stop: C, Circle: C, Line: C, Rect: C, G: C, createElement: R.createElement };
});
jest.mock("../../../hooks/useBrandPayoutScreen", () => ({
  useBrandPayoutScreen: () => ({
    isLoading: false,
    isError: false,
    data: { currency: "USD", payoutsPaused: false, lifetimeSalesCents: {}, salesThisWeekCents: 0, comingToYouCents: 0, paidThisMonthCents: 0, releases: [] },
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useTrafficAnalytics", () => ({
  useBrandTrafficRollup: () => ({ data: undefined, isError: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useBrandFollowerSummary", () => ({
  useBrandFollowerSummary: () => ({ data: { total: 0, sourcesThisWeek: { brandPage: 0 } }, isError: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useReducedMotionNative", () => ({ useReducedMotionNative: () => true }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../ui/GlassCard", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { GlassCard: (p: { children?: React.ReactNode }) => R.createElement(RN.View, null, p.children) };
});
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../../door/tap/TapToPayIcon", () => ({ TapToPayIcon: () => null }));
jest.mock("../../brand/brandSetupAnalytics", () => ({ trackBrandSetup: jest.fn() }));

import { StyleSheet, Text } from "react-native";
import { BusinessPulsePanel } from "../BusinessPulsePanel";
import { DoorTodayLine, TakePaymentButton } from "../HomeTakePayment";

interface Node { type: unknown; props: Record<string, unknown>; parent: Node | null; children: Array<Node | string>; findAll(p: (n: Node) => boolean): Node[] }
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: { root: Node; unmount(): void } | null = null;
afterEach(() => {
  if (tree !== null) TestRenderer.act(() => tree?.unmount());
  tree = null;
});
const isInside = (n: Node, a: Node): boolean => {
  for (let p: Node | null = n.parent; p !== null; p = p.parent) if (p === a) return true;
  return false;
};
const byId = (root: Node, id: string): Node[] => root.findAll((n) => typeof n.type === "string" && n.props.testID === id);
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(" "));

function render(hasOtherSales: boolean): Node {
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <BusinessPulsePanel
        brandId="b-ht"
        defaultCurrency="USD"
        canViewPayments
        liveItems={[]}
        upcomingItems={[]}
        liveMetricsById={{}}
        onScanPress={() => undefined}
        onOpenOffering={() => undefined}
        moneyFootnote={<DoorTodayLine count={1} totalMajor={50} currency="USD" />}
        moneyAction={<TakePaymentButton brandId="b-ht" tapToPay={false} variant="block" onMessage={() => undefined} />}
        hasOtherSales={hasOtherSales}
      />,
    );
  });
  return (tree as unknown as { root: Node }).root;
}

describe("#4389 HT — Take a payment, full width at the bottom of the money panel", () => {
  test("T1: the header is only the eyebrow; the button sits at the bottom, after the door line, full width, 50pt", () => {
    const root = render(true);
    const header = byId(root, "business-pulse-money-header")[0] as Node;
    const button = byId(root, "home-take-payment-button")[0] as Node;
    expect(button).toBeDefined();
    expect(isInside(button, header)).toBe(false);
    expect(textOf(header).replace(/\s+/g, " ").trim()).toBe("TOTAL LIFETIME REVENUE ›");
    const action = byId(root, "business-pulse-money-action")[0] as Node;
    expect(isInside(button, action)).toBe(true);
    // After the door line in document order.
    const order = root.findAll((n) => typeof n.type === "string" && (n.props.testID === "home-door-today" || n.props.testID === "business-pulse-money-action")).map((n) => n.props.testID);
    expect(order).toEqual(["home-door-today", "business-pulse-money-action"]);
    const pressable = root.findAll((n) => typeof n.type !== "string" && n.props.testID === "home-take-payment-button" && typeof n.props.style === "function")[0] as Node;
    const style = StyleSheet.flatten((pressable.props.style as (s: { pressed: boolean }) => never)({ pressed: false })) as unknown as Record<string, unknown>;
    expect(style.alignSelf).toBe("stretch");
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(48);
    expect(Number(style.minHeight)).toBeLessThanOrEqual(52);
    expect((StyleSheet.flatten(action.props.style as never) as unknown as Record<string, unknown>).marginTop).toBe(24);
    // Icon before the label.
    const label = root.findAll((n) => n.type === Text && n.props.children === "Take a payment")[0];
    expect(label).toBeDefined();
  });

  test("T2: with door sales today the panel never says 'Your first sale will show here'", () => {
    const withSales = render(true);
    expect(byId(withSales, "business-pulse-first-sale")).toHaveLength(0);
    expect(byId(withSales, "business-pulse-card-sales")).toHaveLength(1);
    TestRenderer.act(() => tree?.unmount());
    tree = null;
    const none = render(false);
    expect(byId(none, "business-pulse-first-sale")).toHaveLength(1);
  });

  test("T3: Home passes the button as the panel's bottom action and the door-sales flag (both layouts)", () => {
    const home = fs.readFileSync(path.join(__dirname, "../../../../app/(tabs)/home.tsx"), "utf8");
    expect(home).not.toContain("headerAction=");
    expect(home.match(/moneyAction=\{takePaymentButton\}/g)).toHaveLength(2);
    expect(home.match(/hasOtherSales=\{hasDoorSalesToday\}/g)).toHaveLength(2);
    expect(home).toContain("const hasDoorSalesToday = doorToday.count > 0;");
    expect(home).toContain('variant="block"');
  });
});
