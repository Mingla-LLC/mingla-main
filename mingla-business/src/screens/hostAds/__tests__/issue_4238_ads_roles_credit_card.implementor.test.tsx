/**
 * #4238 ads roles — the Ads credit card on Promote home.
 *
 * Top up is for the owner, admins and Finance; withdraw is for the owner and
 * Finance. The card reads the server's answers (get_wallet capabilities), and
 * falls back to the role mirror only when an older server sends none.
 *
 * FAILS ON REVERT: put back useCanManageBrandPayments (owner-only payouts
 * rule) -> "an admin sees Top up" fails; drop the withdraw role line -> "an
 * admin sees the withdraw line instead of Withdraw" fails.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

type Caps = Record<string, { allowed: boolean; ask_role?: string; ask_name?: string }> | undefined;
let mockCaps: Caps;
let mockRoleCanTopUp = false;
let mockRoleCanWithdraw = false;
let mockBalance = 50_000;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "brand-1" }) }));
jest.mock("../../../hooks/useHostAdPermissions", () => ({
  useHostAdPermissions: () => ({
    isLoading: false,
    isError: false,
    canRead: true,
    canPlan: true,
    canTopUp: mockRoleCanTopUp,
    canWithdraw: mockRoleCanWithdraw,
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
      wallet: { balance_cents: mockBalance, currency: "USD", currency_status: "aligned", authority_currency: "USD" },
      history: [],
      currency_authority: { resolved: true, currency: "USD" },
      ...(mockCaps ? { capabilities: mockCaps } : {}),
    },
  }),
}));
jest.mock("../../../hooks/marketing/useHostAdCampaigns", () => ({
  useHostAdCampaigns: () => ({ campaigns: [], summary: null, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/marketing/useHostAdPlans", () => ({
  useHostAdPlans: () => ({ drafts: [], plans: [], launchedPlanIds: [], planIdByVersionId: {}, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock("../../../services/adCreditService", () => ({ applyAdCreditTopUp: jest.fn() }));
jest.mock("../../../services/hostAdLifecycle", () => ({
  buildHostAdList: () => [],
  hostAdRowIdentity: () => "",
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
  const R = jest.requireActual("react") as typeof React;
  const pass = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    builderStyles: new Proxy({}, { get: () => ({}) }),
    Blocker: () => null,
    BuilderCard: pass,
    BuilderLabel: pass,
    BuilderList: pass,
    Note: (props: Record<string, unknown>) => R.createElement("FakeNote", props),
    Segmented: () => null,
    ValueRow: () => null,
  };
});
// #4238 Ads list: the draft delete confirm and its bin icon.
jest.mock("../../../components/ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../../components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../components/marketing/ads/HostAdTopUpSheet", () => ({ HostAdTopUpSheet: () => null }));
jest.mock("../../../components/marketing/ads/results/AdListSummaryCard", () => ({
  AdListSummaryCard: () => null,
  hostAdListSummaryLine: () => "",
}));
jest.mock("../../../components/ui/GlassCard", () => ({
  GlassCard: (props: { children?: React.ReactNode }) => props.children ?? null,
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
import { hm } from "../../../components/marketing/ads/hostAdManageCopy";

type Node = { type: unknown; props: Record<string, unknown> };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
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
const byTestId = (tree: Tree, type: string, testID: string): Node[] =>
  tree.root.findAll((n) => n.type === type && n.props.testID === testID);

const ASK = { ask_role: "brand_owner", ask_name: "Tolu" };

describe("#4238 ads roles: the Ads credit card", () => {
  test("an admin sees Top up, and the withdraw line instead of Withdraw", async () => {
    mockBalance = 50_000;
    mockRoleCanTopUp = false; // the server answer wins over the role mirror
    mockRoleCanWithdraw = false;
    mockCaps = { top_up: { allowed: true }, withdraw: { allowed: false, ...ASK } };
    const tree = await mount();
    expect(byTestId(tree, "FakeButton", "ads-add-credit")).toHaveLength(1);
    expect(byTestId(tree, "FakeButton", "ads-withdraw")).toHaveLength(0);
    const line = byTestId(tree, "FakeNote", "ads-credit-withdraw-role");
    expect(line).toHaveLength(1);
    expect(line[0]?.props.text).toBe(hm("credit.withdrawNeedsRole", { name: "Tolu" }));
    expect(byTestId(tree, "FakeNote", "ads-credit-team")).toHaveLength(0);
  });

  test("the withdraw line falls back to 'the owner' with no name", async () => {
    mockCaps = { top_up: { allowed: true }, withdraw: { allowed: false, ask_role: "brand_owner" } };
    const tree = await mount();
    const line = byTestId(tree, "FakeNote", "ads-credit-withdraw-role");
    expect(line[0]?.props.text).toBe(hm("credit.withdrawNeedsRole", { name: hm("credit.theOwner") }));
  });

  test("the owner and Finance see Top up and Withdraw", async () => {
    mockCaps = { top_up: { allowed: true }, withdraw: { allowed: true } };
    const tree = await mount();
    expect(byTestId(tree, "FakeButton", "ads-add-credit")).toHaveLength(1);
    expect(byTestId(tree, "FakeButton", "ads-withdraw")).toHaveLength(1);
    expect(byTestId(tree, "FakeNote", "ads-credit-withdraw-role")).toHaveLength(0);
    expect(byTestId(tree, "FakeNote", "ads-credit-team")).toHaveLength(0);
  });

  test("with no credit there is nothing to withdraw: no withdraw line", async () => {
    mockBalance = 0;
    mockCaps = { top_up: { allowed: true }, withdraw: { allowed: false, ...ASK } };
    const tree = await mount();
    expect(byTestId(tree, "FakeButton", "ads-add-credit")).toHaveLength(1);
    expect(byTestId(tree, "FakeNote", "ads-credit-withdraw-role")).toHaveLength(0);
    mockBalance = 50_000;
  });

  test("no top-up access: one line, no buttons", async () => {
    mockCaps = { top_up: { allowed: false, ...ASK }, withdraw: { allowed: false, ...ASK } };
    const tree = await mount();
    expect(byTestId(tree, "FakeButton", "ads-add-credit")).toHaveLength(0);
    expect(byTestId(tree, "FakeButton", "ads-withdraw")).toHaveLength(0);
    const line = byTestId(tree, "FakeNote", "ads-credit-team");
    expect(line[0]?.props.text).toBe(hm("credit.topUpNeedsRole"));
  });

  test("an older server (no capabilities) uses the role mirror", async () => {
    mockCaps = undefined;
    mockRoleCanTopUp = true;
    mockRoleCanWithdraw = false;
    const tree = await mount();
    expect(byTestId(tree, "FakeButton", "ads-add-credit")).toHaveLength(1);
    expect(byTestId(tree, "FakeNote", "ads-credit-withdraw-role")).toHaveLength(1);
  });
});
