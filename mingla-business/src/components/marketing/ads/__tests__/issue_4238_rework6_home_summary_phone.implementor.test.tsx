// MINGLA-INVARIANT: I-4238-HOME-ADS-PHONE-SUMMARY-FITS | issue #4238 | On phones the Home ads summary sizes to its content: no fixed minHeight and no vertical centring, so a spend-only card has no empty band above "ADS".
/**
 * #4238 P3-1: summaryWithDataNarrow was minHeight 138 + centred, leaving ~47dp
 * empty above "ADS" when only the spend line showed.
 *
 * FAILS ON REVERT: restore `summaryWithDataNarrow: { minHeight: 138 }` (from
 * 778778e8d7) -> "phone summary has no fixed minHeight" fails.
 */
import React from "react";
import { StyleSheet } from "react-native";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = { props: Record<string, unknown>; type: unknown };
type Renderer = { root: { findAll: (p: (node: RenderNode) => boolean) => RenderNode[] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Renderer;
};

let mockWide = false;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: mockWide }) }));
jest.mock("../../../../hooks/useHostAdPermissions", () => ({
  useHostAdPermissions: () => ({ isLoading: false, isError: false, canRead: true, canPause: true }),
}));
jest.mock("../../../../hooks/useTrafficAnalytics", () => ({
  useBrandTrafficRollup: () => ({ data: { sources: [] } }),
}));
jest.mock("../../../../hooks/marketing/useHostAdCampaigns", () => ({
  useHostAdCampaigns: () => ({
    campaigns: [{
      id: "a", plan_version_id: "v-a", name: "Ad a", lifecycle: "live", currency: "USD",
      cap_cents: 50_000, lifetime_budget_cents: null, host_spend_equivalent_cents: 10_000,
      spend_by_currency: [], platforms: ["meta"], next_action: "View results", plan_state: "live",
      creative: null, starts_at: null, ends_at: null,
      updated_at: "2026-11-10T10:00:00Z", created_at: "2026-11-01T10:00:00Z",
    }],
    summary: {
      currency: "USD", spent_cents: 202_500, budget_cents: 586_000, results: 7,
      daily_spend: [{ day: "2026-11-01", cents: 100 }],
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../../services/hostAdCampaignService", () => ({ pauseHostAdCampaign: jest.fn() }));
jest.mock("../../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../../ui/GlassCard", () => ({
  GlassCard: (props: { children: React.ReactNode }) => props.children,
}));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  const make = (name: string) => (props: Record<string, unknown>) =>
    ReactLib.createElement(name, props, props.children as React.ReactNode);
  return { __esModule: true, default: make("Svg"), Path: make("Path") };
});

// eslint-disable-next-line import/first
import { HomeAdsSection } from "../../../home/HomeAdsSection";

const summaryStyle = async (wide: boolean): Promise<Record<string, unknown>> => {
  mockWide = wide;
  let r!: Renderer;
  await act(async () => {
    r = create(<HomeAdsSection brandId="b1" />);
  });
  const node = r.root.findAll((n) => n.props.testID === "home-ads-summary")[0];
  return StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
};

describe("#4238 P3-1: Home ads summary on phones", () => {
  test("phone summary has no fixed minHeight and no vertical centring", async () => {
    const s = await summaryStyle(false);
    expect(s.minHeight ?? 0).toBeLessThan(72);
    expect(s.alignItems).toBe("flex-start");
  });

  test("wide desktop layout is unchanged", async () => {
    const s = await summaryStyle(true);
    expect(s.minHeight).toBe(120);
    expect(s.alignItems).toBe("center");
  });
});
