// MINGLA-INVARIANT: I-4238-HOME-PROMOTE-ONE-TOTAL | issue #4238 | rework 4: The Home Ads card total and the Promote summary derive from ONE function (hostAdListSummaryLine over the server's "this month" summary): for the same data they show identical figures, in pay terms, ended ads included.
/**
 * #4238 rework 4 (retest 4 P2-1, P3-1, P3-5). Behaviour tests: the real
 * HomeAdsSection and AdListSummaryCard are rendered; nothing reads source text.
 *
 * FAILS-ON-REVERT: make HomeAdsSection build its own total (not the shared
 * hostAdListSummaryLine) -> "Home shows exactly Promote's line" fails; put
 * the raw code back in the audience place -> "People in" test fails; drop the
 * name column floor -> "name column" test fails.
 */
import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = { props: Record<string, unknown>; type: unknown; children: (RenderNode | string)[] };
type Renderer = { root: { findAll: (p: (node: RenderNode) => boolean) => RenderNode[] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void) => void;
  create: (el: React.ReactElement) => Renderer;
};

const mockSummary = {
  currency: "USD",
  spent_cents: 202_500,
  budget_cents: 586_000,
  results: 7,
  daily_spend: [{ day: "2026-11-01", cents: 100 }],
};
const ad = (id: string, lifecycle: string) => ({
  id,
  plan_version_id: `v-${id}`,
  name: `Ad ${id}`,
  lifecycle,
  currency: "USD",
  cap_cents: 50_000,
  lifetime_budget_cents: null,
  host_spend_equivalent_cents: 10_000,
  spend_by_currency: [],
  platforms: ["meta"],
  next_action: "View results",
  plan_state: "live",
  creative: null,
  starts_at: null,
  ends_at: null,
  updated_at: "2026-11-10T10:00:00Z",
  created_at: "2026-11-01T10:00:00Z",
});

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: true }) }));
jest.mock("../../../../hooks/useHostAdPermissions", () => ({
  useHostAdPermissions: () => ({ isLoading: false, isError: false, canRead: true, canPause: true }),
}));
jest.mock("../../../../hooks/useTrafficAnalytics", () => ({
  useBrandTrafficRollup: () => ({ data: { sources: [] } }),
}));
jest.mock("../../../../hooks/marketing/useHostAdCampaigns", () => ({
  useHostAdCampaigns: () => ({
    campaigns: [ad("a", "live"), ad("b", "live"), ad("c", "ended")],
    summary: mockSummary,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../../services/hostAdCampaignService", () => ({ pauseHostAdCampaign: jest.fn() }));
jest.mock("../../../ui/GlassCard", () => ({
  GlassCard: (props: { children: React.ReactNode }) => props.children,
}));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../ui/Skeleton", () => ({ Skeleton: () => null }));
// #4238 rework 5: Home now owns a pause confirm (rendered only when a Pause is tapped).
jest.mock("../../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  const make = (name: string) => (props: Record<string, unknown>) =>
    ReactLib.createElement(name, props, props.children as React.ReactNode);
  return { __esModule: true, default: make("Svg"), Path: make("Path") };
});

// eslint-disable-next-line import/first
import { HomeAdsSection } from "../../../home/HomeAdsSection";
// eslint-disable-next-line import/first
import { AdListSummaryCard, hostAdListSummaryLine } from "../results/AdListSummaryCard";
// eslint-disable-next-line import/first
import { hostAdAudiencePlace } from "../hostAdCountries";
// eslint-disable-next-line import/first
import { HOST_AD_NAME_COL_MIN } from "../hostAdListLayout";

const texts = (r: Renderer): string[] =>
  r.root
    .findAll((n) => n.type === "Text" || (typeof n.type === "function" && false))
    .flatMap((n) => n.children.filter((c): c is string => typeof c === "string"));
const allText = (r: Renderer): string[] =>
  r.root.findAll(() => true).flatMap((n) => n.children.filter((c): c is string => typeof c === "string"));

describe("#4238 rework 4: Home and Promote show one total", () => {
  test("Home shows exactly Promote's line (same summary, same helper, pay terms)", () => {
    let home!: Renderer;
    let promote!: Renderer;
    act(() => {
      home = create(<HomeAdsSection brandId="b1" />);
      promote = create(<AdListSummaryCard summary={mockSummary} />);
    });
    const line = hostAdListSummaryLine(mockSummary);
    expect(line).toMatch(/^This month: .* of .*· 7 results$/);
    expect(allText(promote)).toContain(line);
    expect(allText(home)).toContain(line);
    // The old Home figure (active ads only, "spent of ... budget") is gone.
    expect(allText(home).some((t) => /budget$/.test(t))).toBe(false);
    void texts;
  });
});

describe("#4238 rework 4: audience place and name column", () => {
  test("People in US shows the country name; a city wins; several countries join", () => {
    expect(hostAdAudiencePlace(null, ["US"])).toBe("United States");
    expect(hostAdAudiencePlace(null, ["NG", "GB"])).toMatch(/^Nigeria, /);
    expect(hostAdAudiencePlace("Lagos", ["NG"])).toBe("Lagos");
    expect(hostAdAudiencePlace(null, ["ZZ"])).toBe("ZZ");
  });

  test("name column floor fits 'Facebook & Instagram · Nov 16' at 1280", () => {
    // 192 px for the identity line (retest 4) plus the 20 px row gap.
    expect(HOST_AD_NAME_COL_MIN).toBeGreaterThanOrEqual(192 + 20);
  });
});
