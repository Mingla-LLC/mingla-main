/**
 * #4238 rework 5 — native verdict P2-2 and the P1-1 audit on Promote.
 *
 * P2-2: Promote on a phone showed no "This month" line, so Home's total had
 * no match there. The phone layout now renders the same AdListSummaryCard
 * (hostAdListSummaryLine) the desktop layout and Home use.
 * P1-1 audit: a wallet sheet (top up, withdraw) belongs to the brand it was
 * opened on; a brand switch closes it.
 *
 * FAILS ON REVERT: drop the phone AdListSummaryCard -> "phone shows Home's
 * line" fails; drop the brandId reset effect -> "a brand switch closes the
 * withdraw sheet" fails.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

let mockBrandId = "brand-1";
const mockSummary = {
  currency: "USD",
  spent_cents: 202_500,
  budget_cents: 586_000,
  results: 7,
  daily_spend: [{ day: "2026-11-01", cents: 100 }],
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: mockBrandId }) }));
// #4238 ads roles: the Ads credit card reads top-up / withdraw authority from
// useHostAdPermissions (or the wallet's capabilities), no longer from the
// payouts hook useCanManageBrandPayments.
jest.mock("../../../hooks/useHostAdPermissions", () => ({
  useHostAdPermissions: () => ({
    isLoading: false,
    isError: false,
    canRead: true,
    canPlan: true,
    canTopUp: true,
    canWithdraw: true,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useStickyFooterOffset", () => ({ useStickyFooterOffset: () => 0 }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => ({ isConnected: true }) }));
jest.mock("../../../hooks/marketing/useAdCreditWallet", () => ({
  useAdCreditWallet: () => ({
    canView: true,
    hasResolved: true,
    viewLoading: false,
    isError: false,
    viewError: false,
    isRefetching: false,
    refetch: jest.fn(),
    data: {
      wallet: { balance_cents: 50_000, currency: "USD", currency_status: "aligned", authority_currency: "USD" },
      history: [],
      currency_authority: { resolved: true, currency: "USD" },
    },
  }),
}));
jest.mock("../../../hooks/marketing/useHostAdCampaigns", () => ({
  useHostAdCampaigns: () => ({ campaigns: [], summary: mockSummary, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/marketing/useHostAdPlans", () => ({
  useHostAdPlans: () => ({ drafts: [], plans: [], launchedPlanIds: [], planIdByVersionId: {}, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock("../../../services/adCreditService", () => ({ applyAdCreditTopUp: jest.fn() }));
jest.mock("../../../services/hostAdLifecycle", () => ({
  buildHostAdList: () => [
    {
      id: "a",
      kind: "campaign",
      lifecycle: "live",
      name: "Rooftop",
      platforms: ["meta"],
      destination: null,
      creative: null,
      currency: "USD",
      capCents: 50_000,
      spendCents: 10_000,
      spendByCurrency: [],
      primaryResultLabel: "Tickets",
      primaryResultCount: 2,
      costPerResultCents: null,
      resultsValueCents: {},
      nextAction: "View results",
      route: "/marketing/ads/a",
      reason: null,
      updatedAt: null,
    },
  ],
  hostAdRowIdentity: () => "Facebook & Instagram",
  hostAdInListTab: () => true,
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native") as { View: unknown };
  return { ScrollView: View };
});
jest.mock("../../../components/marketing/ads/HostAdManageSheets", () => {
  const R = jest.requireActual("react") as typeof React;
  const fake = (name: string) => (props: Record<string, unknown>) => R.createElement(name, props);
  return {
    HostAdCompareSheet: fake("FakeCompareSheet"),
    HostAdMoneyExplainer: () => null,
    HostAdReceiptsSheet: fake("FakeReceiptsSheet"),
    HostAdWithdrawSheet: fake("FakeWithdrawSheet"),
  };
});
jest.mock("../../../components/marketing/ads/HostAdBuilderBits", () => {
  const pass = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    builderStyles: new Proxy({}, { get: () => ({}) }),
    Blocker: () => null,
    BuilderCard: pass,
    BuilderLabel: pass,
    BuilderList: pass,
    Note: () => null,
    Segmented: () => null,
    ValueRow: () => null,
  };
});
// #4238 Ads list: the draft delete confirm and its bin icon.
jest.mock("../../../components/ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../../components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../components/marketing/ads/HostAdTopUpSheet", () => ({ HostAdTopUpSheet: () => null }));
jest.mock("../../../components/ui/GlassCard", () => ({
  GlassCard: (props: { children?: React.ReactNode; testID?: string }) => {
    const R = jest.requireActual("react") as typeof React;
    return R.createElement("FakeGlassCard", { testID: props.testID }, props.children);
  },
}));
jest.mock("../../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("../../../components/ui/Button", () => ({
  Button: (props: Record<string, unknown>) => {
    const R = jest.requireActual("react") as typeof React;
    return R.createElement("FakeButton", props);
  },
}));
jest.mock("react-native-svg", () => {
  const R = jest.requireActual("react") as typeof React;
  const make = (name: string) => (props: Record<string, unknown>) => R.createElement(name, props, props.children as React.ReactNode);
  return { __esModule: true, default: make("Svg"), Path: make("Path") };
});

import MarketingAdsRoute from "../HostAdListScreen";
import { hostAdListSummaryLine } from "../../../components/marketing/ads/results/AdListSummaryCard";

type Node = { type: unknown; props: Record<string, unknown>; children: (Node | string)[] };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; update: (element: React.ReactElement) => void };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mount = async (): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<MarketingAdsRoute />);
  });
  return tree;
};
const allText = (tree: Tree): string[] =>
  tree.root.findAll(() => true).flatMap((n) => n.children.filter((c): c is string => typeof c === "string"));

describe("#4238 rework 5: Promote on a phone", () => {
  test("phone shows Home's 'This month' line (same summary, same helper)", async () => {
    mockBrandId = "brand-1";
    const tree = await mount();
    expect(tree.root.findAll((n) => n.type === "FakeGlassCard" && n.props.testID === "ads-list-summary")).toHaveLength(1);
    expect(allText(tree)).toContain(hostAdListSummaryLine(mockSummary));
  });

  test("a brand switch closes the withdraw sheet opened on the other brand", async () => {
    mockBrandId = "brand-1";
    const tree = await mount();
    const withdraw = tree.root.findAll((n) => n.type === "FakeButton" && n.props.testID === "ads-withdraw")[0];
    await TestRenderer.act(async () => {
      (withdraw?.props.onPress as () => void)();
    });
    const sheet = () => tree.root.findAll((n) => n.type === "FakeWithdrawSheet")[0];
    expect(sheet()?.props.visible).toBe(true);
    mockBrandId = "brand-2";
    await TestRenderer.act(async () => {
      tree.update(<MarketingAdsRoute />);
    });
    expect(sheet()?.props.visible).toBe(false);
  });
});
