/**
 * #4238 wave 2 rework — the results card P3s: the empty sentence once, the
 * shared "over N days" rule, cost per result from totals, and a plot whose
 * viewBox matches its real width (aligned with its day labels at 1280 px).
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
import { AdResultsSection } from "../AdResultsSection";
// eslint-disable-next-line import/first
import { AdSpendChart } from "../AdSpendChart";
// eslint-disable-next-line import/first
import { buildSpendSeries, hostAdDetailCostPerResult } from "../adResultsSeries";
// eslint-disable-next-line import/first
import type { HostAdDailyPoint } from "../../../../../services/hostAdCampaignService";

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const byTestId = (r: Renderer, id: string) => r.root.findAll((n) => typeof n.type === "string" && n.props.testID === id);
function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = create(element);
  });
  return renderer as unknown as Renderer;
}
const point = (day: string, host: number | null, provider: number | null, results = 0): HostAdDailyPoint => ({
  day,
  spend_host_cents: host,
  spend_provider_cents: provider,
  provider_currency: provider === null ? null : "USD",
  impressions: null,
  clicks: null,
  page_visits: null,
  results,
});
const base = {
  byPlatformSpend: [],
  dailyError: false,
  hostCurrency: "NGN",
  budgetCents: 10_000_000,
  resultKind: "tickets",
  notes: [],
  placements: [],
  onRetry: () => undefined,
};

describe("#4238 rework: results card", () => {
  it("an ad with no spend says so once, not twice", () => {
    const r = render(<AdResultsSection {...base} daily={[]} />);
    const all = r.root.findAll((n) => n.type === "Text").map(textOf);
    expect(all.filter((line) => line === "Your ad hasn't spent anything yet. Charts appear after its first day.")).toHaveLength(1);
  });

  it("'over N days' counts days whose own spend is above zero (Admin's rule, same rows)", () => {
    // The Admin T17 fixture: 1 Nov 1,500, 2 Nov 900, 3 Nov visits only.
    const daily = [point("2026-11-01", null, 1500, 2), point("2026-11-02", null, 900, 1), point("2026-11-03", null, null, 0)];
    expect(buildSpendSeries({ daily, hostCurrency: "NGN", budgetCents: null }).spendDays).toBe(2);
    // A zero-spend day (paused) is not a day of spending either.
    const paused = [point("2026-11-01", 700, 1, 0), point("2026-11-02", 0, 0, 0), point("2026-11-03", 300, 1, 0)];
    const r = render(<AdResultsSection {...base} daily={paused} />);
    expect(textOf(byTestId(r, "ads-detail-results-sentence")[0])).toContain("over 2 days.");
  });

  it("cost per result is total spend ÷ total results, and shows whenever both exist", () => {
    // Spend only in USD (no frozen rate): still shown, in USD, from totals.
    const daily = [point("2026-11-01", null, 100, 1), point("2026-11-02", null, 1000, 2)];
    expect(hostAdDetailCostPerResult({ hostSpendCents: null, hostCurrency: "NGN", conversions: 3, daily }))
      .toEqual({ cents: 367, currency: "USD" });
    expect(hostAdDetailCostPerResult({ hostSpendCents: 1_550_000, hostCurrency: "NGN", conversions: 4, daily }))
      .toEqual({ cents: 387_500, currency: "NGN" });
    expect(hostAdDetailCostPerResult({ hostSpendCents: 0, hostCurrency: "NGN", conversions: 4, daily: [] })).toBeNull();
    expect(hostAdDetailCostPerResult({ hostSpendCents: 500, hostCurrency: "NGN", conversions: 0, daily: [] })).toBeNull();
  });

  it("the spend plot uses its real width, so the line ends where its last day label ends", () => {
    const series = buildSpendSeries({
      daily: [point("2026-11-01", 100, 1), point("2026-11-02", 200, 2), point("2026-11-03", 300, 3)],
      hostCurrency: "NGN",
      budgetCents: null,
    });
    const r = render(<AdSpendChart series={series} />);
    const frame = r.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "image")[0];
    act(() => (frame.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { width: 900, height: 132 } } }));
    const svg = byTestId(r, "ad-spend-chart-svg")[0];
    expect(svg.props.viewBox).toBe("0 0 900 132");
    const last = r.root.findAll((n) => n.type === "Circle").at(-1)!;
    expect(last.props.cx).toBe(860);
    const axis = byTestId(r, "ad-spend-chart-axis")[0];
    const style = ([] as Record<string, unknown>[]).concat(axis.props.style as Record<string, unknown>[]).reduce((a, b) => ({ ...a, ...b }), {});
    expect(style.marginRight).toBe(40);
  });
});
