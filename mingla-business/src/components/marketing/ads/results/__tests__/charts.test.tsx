/**
 * #4238 wave 2 — T14: the Host ad results charts render each state with a
 * full-sentence accessibility label; empty and few-point states draw no line.
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
import { AdListSummaryCard, sparklinePath } from "../AdListSummaryCard";
// eslint-disable-next-line import/first
import type { HostAdDailyPoint } from "../../../../../services/hostAdCampaignService";

const day = (d: string, cents: number | null, results = 0): HostAdDailyPoint => ({
  day: d,
  spend_host_cents: cents,
  spend_provider_cents: cents === null ? null : Math.round(cents / 1550),
  provider_currency: cents === null ? null : "USD",
  impressions: cents === null ? null : 2000,
  clicks: cents === null ? null : 40,
  page_visits: 9,
  results,
});

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const texts = (r: Renderer) => r.root.findAll((n) => n.type === "Text").map(textOf).join("\n");
const byTestId = (r: Renderer, id: string) => r.root.findAll((n) => typeof n.type === "string" && n.props.testID === id);
const labels = (r: Renderer) =>
  r.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "image").map((n) => String(n.props.accessibilityLabel));

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = create(element);
  });
  return renderer as unknown as Renderer;
}

const base = {
  byPlatformSpend: [],
  dailyError: false,
  hostCurrency: "NGN",
  budgetCents: 10_000_000,
  resultKind: "tickets",
  notes: ["We count ticket sales for this ad."],
  placements: [],
  onRetry: () => undefined,
};

describe("#4238 T14 results charts", () => {
  it("six days: sentence first, then a labelled spend chart and the funnel", () => {
    const daily = ["01", "02", "03", "04", "05", "06"].map((d, i) => day(`2026-11-${d}`, 700_000 + i * 10_000, i % 2));
    const r = render(<AdResultsSection {...base} daily={daily} />);
    expect(textOf(byTestId(r, "ads-detail-results-sentence")[0])).toBe(
      "You've spent NGN 43,500.00 of NGN 100,000.00 over 6 days.",
    );
    const [spend, results] = labels(r);
    expect(spend).toBe("Spend over 6 days: NGN 43,500.00 of NGN 100,000.00 budget, highest NGN 7,500.00 on 6 Nov.");
    // #4238: total spend ÷ total results (NGN 43,500 ÷ 3), not the mean of
    // the three daily figures (NGN 7,300).
    expect(results).toBe("3 ticket sales over 6 days, most on 2 Nov (1); cost per sale NGN 14,500.00 on average.");
    expect(r.root.findAll((n) => n.type === "Path").length).toBeGreaterThan(0);
    expect(byTestId(r, "ad-funnel-shown")).toHaveLength(1);
    expect(byTestId(r, "ad-funnel-visits")).toHaveLength(1);
    expect(texts(r)).toContain("Page visits are counted when people land on your page from this ad.");
  });

  it("no spend yet: plain empty copy, no axes, no results chart", () => {
    const r = render(<AdResultsSection {...base} daily={[]} />);
    expect(texts(r)).toContain("Your ad hasn't spent anything yet. Charts appear after its first day.");
    expect(r.root.findAll((n) => n.type === "Svg")).toHaveLength(0);
    expect(byTestId(r, "ad-results-chart")).toHaveLength(0);
  });

  it("one day: a labelled dot, no line; zero results hide the results chart", () => {
    const r = render(<AdResultsSection {...base} daily={[day("2026-11-02", 420_000)]} />);
    expect(r.root.findAll((n) => n.type === "Path")).toHaveLength(0);
    expect(r.root.findAll((n) => n.type === "Circle")).toHaveLength(1);
    expect(texts(r)).toContain("2 Nov: NGN 4,200.00");
    expect(textOf(byTestId(r, "ads-detail-results-sentence")[0])).toContain("over 1 day.");
    expect(texts(r)).toContain("No ticket sales counted yet. We count them when people buy on Mingla after seeing this ad.");
  });

  it("USD fallback says so; the error state offers Retry", () => {
    const usd = render(<AdResultsSection {...base} daily={[{ ...day("2026-11-02", null), spend_provider_cents: 300, provider_currency: "USD" }]} />);
    expect(texts(usd)).toContain("Spend shown in US dollars, the currency the ad apps bill in.");
    const onRetry = jest.fn();
    const failed = render(<AdResultsSection {...base} daily={[]} dailyError onRetry={onRetry} />);
    expect(texts(failed)).toContain("We couldn't load the chart. Your totals above are still right.");
    act(() => (byTestId(failed, "ads-detail-chart-retry")[0].props.onPress as () => void)());
    expect(onRetry).toHaveBeenCalled();
  });

  it("two apps show the per-app split with names in text", () => {
    const r = render(
      <AdResultsSection
        {...base}
        daily={[day("2026-11-02", 420_000)]}
        byPlatformSpend={[
          { platform: "meta", spend_provider_cents: 200, provider_currency: "USD", results: 1 },
          { platform: "snapchat", spend_provider_cents: 100, provider_currency: "USD", results: 0 },
        ]}
      />,
    );
    expect(byTestId(r, "ad-platform-split")).toHaveLength(1);
    expect(texts(r)).toContain("Facebook & Instagram");
    expect(texts(r)).toContain("Snapchat");
  });

  it("list summary: line, sparkline with gaps, hidden with no ads", () => {
    const summary = {
      currency: "NGN",
      spent_cents: 420_000,
      budget_cents: 10_000_000,
      results: 3,
      daily_spend: [{ day: "2026-11-01", cents: 100 }, { day: "2026-11-02", cents: null }, { day: "2026-11-03", cents: 300 }],
    };
    const r = render(<AdListSummaryCard summary={summary} />);
    expect(texts(r)).toContain("This month: NGN 4,200.00 of NGN 100,000.00 · 3 results");
    expect(sparklinePath(summary.daily_spend)).toBe("M0,41.333333333333336 M300,8");
    const empty = render(<AdListSummaryCard summary={null} />);
    expect(byTestId(empty, "ads-list-summary")).toHaveLength(0);
  });
});
