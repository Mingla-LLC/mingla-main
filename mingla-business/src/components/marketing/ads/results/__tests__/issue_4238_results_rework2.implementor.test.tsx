/**
 * #4238 wave 2 rework 2 — results P3s from the tester's retest: the "98%"
 * mark is explained in words, the cost-per-result axis value fits its 390 px
 * gutter, and cost per result is written with a code like the headline.
 */

import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = { props: Record<string, unknown>; type: unknown; children: (RenderNode | string)[] };
type Renderer = { root: { findAll: (p: (node: RenderNode) => boolean) => RenderNode[] } };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => Renderer;
};

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    ...base,
    Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
  };
});
jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  const make = (name: string) => (props: Record<string, unknown>) =>
    ReactLib.createElement(name, props, props.children as React.ReactNode);
  return {
    __esModule: true,
    default: make("Svg"),
    Path: make("Path"),
    Line: make("Line"),
    Rect: make("Rect"),
    Circle: make("Circle"),
    Text: make("SvgText"),
  };
});
jest.mock("../../../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => children,
}));

// eslint-disable-next-line import/first
import { AdResultsChart } from "../AdResultsChart";
// eslint-disable-next-line import/first
import { AdSpendChart } from "../AdSpendChart";
// eslint-disable-next-line import/first
import {
  buildResultsSeries,
  buildSpendSeries,
  compactAxisAmount,
  hostAdCostPerResultLine,
} from "../adResultsSeries";
// eslint-disable-next-line import/first
import type { HostAdDailyPoint } from "../../../../../services/hostAdCampaignService";

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const byType = (r: Renderer, type: string) => r.root.findAll((n) => n.type === type);
const byTestId = (r: Renderer, id: string) => r.root.findAll((n) => typeof n.type === "string" && n.props.testID === id);
function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = create(element);
  });
  return renderer as unknown as Renderer;
}
const point = (day: string, host: number | null, results = 0): HostAdDailyPoint => ({
  day,
  spend_host_cents: host,
  spend_provider_cents: host === null ? null : Math.round(host / 1500),
  provider_currency: "USD",
  impressions: null,
  clicks: null,
  page_visits: null,
  results,
});
const daily = [
  point("2026-10-31", 4_650_000, 1),
  point("2026-11-01", 7_750_000, 1),
  point("2026-11-02", 3_100_000, 1),
];

describe("#4238 results P3s", () => {
  it("explains the 98% mark in plain words", () => {
    const series = buildSpendSeries({ daily, hostCurrency: "NGN", budgetCents: 150_000_000 });
    const r = render(<AdSpendChart series={series} />);
    const note = byTestId(r, "ad-spend-chart-pause-note");
    expect(note).toHaveLength(1);
    expect(textOf(note[0])).toBe("Dashed line: your budget. 98%: we pause your ad when 98% of the budget is spent.");
  });

  it("shortens the right-axis value so it fits the 40 px gutter", () => {
    expect(compactAxisAmount(7_750_000)).toBe("77.5K");
    expect(compactAxisAmount(95_000)).toBe("950");
    expect(compactAxisAmount(999_900)).toBe("9,999");
    expect(compactAxisAmount(120_000_000)).toBe("1.2M");
    const series = buildResultsSeries({ daily, inHostCurrency: true });
    const r = render(<AdResultsChart series={series} resultLabel="ticket_purchase" currency="NGN" />);
    const axis = byType(r, "SvgText").map((node) => textOf(node));
    expect(axis).toEqual(["77.5K"]);
    for (const value of axis) expect(value.length).toBeLessThanOrEqual(6);
  });

  it("writes cost per result with a code, like the results headline", () => {
    expect(hostAdCostPerResultLine("Cost per sale", { cents: 10_333_333, currency: "NGN" })).toBe(
      "Cost per sale: NGN 103,333.33",
    );
    expect(hostAdCostPerResultLine("Cost per sale", null)).toBe(
      "Cost per sale: Shown once we have both spend and results",
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const page = fs.readFileSync(
      path.join(__dirname, "../../../../../../src/screens/hostAds/HostAdDetailScreen.tsx"),
      "utf8",
    );
    expect(page).toContain("{hostAdCostPerResultLine(costPerLabel, costPerResult)}");
    expect(page).not.toMatch(/formatCurrency\(costPerResult/);
  });
});
