/**
 * #4238 rework 5 — native verdict P1-1, P1-2, P2-1 (detail page).
 *
 * P1-1: an End (or Pause) confirm left open while the screen moved to another
 * ad stayed open and then acted on the NEW ad (iOS ios-36). Now the screen is
 * keyed by brand + route ad, every confirm records the ad it was opened for,
 * and a submit refuses unless the screen still shows that ad.
 * P1-2: the rejected ad's "Ask Ari" / "Change the photo" dock sat under the
 * floating tab bar. On phones the dock is pinned above it and the scroll
 * reserves its height.
 *
 * FAILS ON REVERT: drop the `key` on HostAdDetailBody -> "End open on ad A"
 * fails (the dialog is still visible on B); drop the confirmStillBound check
 * in onStop -> "a submit from ad A's confirm" fails; put {dock} back inside
 * the scroll -> "Ask Ari is in the pinned dock" fails.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

const mockPause = jest.fn<(input: unknown) => Promise<void>>(async () => undefined);
const mockEnd = jest.fn<(input: unknown) => Promise<void>>(async () => undefined);
const mockGet = jest.fn<(brandId: string, campaignId: string) => Promise<unknown>>();

let mockParams: { id?: string; by?: string } = { id: "camp-a" };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../hooks/useBrandListShim", () => ({
  useBrandListState: () => ({ brands: [{ id: "brand-1" }], status: "ready", isLoading: false }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (select: (state: { setCurrentBrandId: () => void }) => unknown) => select({ setCurrentBrandId: () => undefined }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "brand-1" }) }));
jest.mock("../../../hooks/useHostAdPermissions", () => ({
  useHostAdPermissions: () => ({
    isLoading: false,
    isError: false,
    canRead: true,
    canPause: true,
    canLaunch: true,
    canEnd: true,
    canFund: false,
    canPlan: false,
  }),
}));
jest.mock("../../../hooks/useStickyFooterOffset", () => ({ useStickyFooterOffset: () => 0 }));
// #4238 W6b: the redesigned detail screen also reads the wallet, the layout and the network.
jest.mock("../../../hooks/marketing/useAdCreditWallet", () => ({
  useAdCreditWallet: () => ({ canView: false, data: null, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock("../../../components/marketing/ads/HostAdManageSheets", () => ({
  HostAdEditBudgetSheet: () => null,
  HostAdShareSheet: () => null,
  HostAdSuggestionCard: () => null,
  HostAdSuggestionConfirmSheet: () => null,
  hostAdShareMessage: () => "",
}));
jest.mock("../../../components/marketing/ads/HostAdTopUpSheet", () => ({ HostAdTopUpSheet: () => null }));
jest.mock("../../../components/marketing/ads/HostAdBuilderBits", () => {
  const pass = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    builderStyles: new Proxy({}, { get: () => ({}) }),
    BuilderCard: pass,
    BuilderLabel: pass,
    BuilderList: pass,
    Blocker: () => null,
    Note: () => null,
    Segmented: () => null,
    ValueRow: () => null,
  };
});
jest.mock("../../../services/hostAdCampaignService", () => ({
  getHostAdCampaign: (brandId: string, campaignId: string) => mockGet(brandId, campaignId),
  pauseHostAdCampaign: (input: unknown) => mockPause(input),
  cancelHostAdCampaign: jest.fn(),
  endHostAdCampaign: (input: unknown) => mockEnd(input),
  resumeHostAdCampaignPlan: jest.fn(),
  resolveHostAdCampaignForPlan: jest.fn(),
}));
jest.mock("../../../services/hostAdPlanService", () => ({
  acceptHostAdLastTickets: jest.fn(),
  changeHostAdLive: jest.fn(),
  duplicateHostAdPlan: jest.fn(),
}));
jest.mock("../../../services/hostAdLifecycle", () => ({ hostAdDetailMoneyLine: () => "Budget $150.00" }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native") as { View: unknown };
  return { ScrollView: View };
});
jest.mock("../../../components/marketing/ads/results/AdResultsSection", () => ({ AdResultsSection: () => null }));
jest.mock("../../../components/marketing/ads/results/adResultsSeries", () => ({
  hostAdCostPerResultLine: () => "Cost per sale",
  hostAdDetailCostPerResult: () => null,
}));
jest.mock("../../../components/marketing/ads/hostAdAlerts", () => ({
  hostAdLearningAlert: () => null,
  hostAdPacingAlert: () => null,
  hostAdRunDay: () => 1,
}));
jest.mock("../../../components/marketing/ads/HostAdLiveEditCard", () => ({
  HostAdLiveEditCard: () => null,
  hostAdLiveEditAttempt: jest.fn(),
  hostAdLiveEditDoneNote: jest.fn(),
  hostAdLiveEditError: jest.fn(),
}));
jest.mock("../../../components/marketing/ads/hostAdBuilderRules", () => ({
  goBackToAds: jest.fn(),
  hostAdScrollBottomPadding: () => 0,
}));
jest.mock("../../../components/ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../../components/ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../../components/ui/Material", () => ({
  Material: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../../components/ui/Banner", () => ({ Banner: () => null }));
jest.mock("../../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("../../../components/ui/Button", () => ({
  Button: (props: Record<string, unknown>) => {
    const R = jest.requireActual("react") as typeof React;
    return R.createElement("FakeButton", props);
  },
}));
jest.mock("../../../components/ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) => {
    const R = jest.requireActual("react") as typeof React;
    return R.createElement("FakeConfirmDialog", props);
  },
}));

import HostAdDetailRoute from "../HostAdDetailScreen";
import { hostAdConfirmKey, hostAdConfirmStillBound } from "../../../components/marketing/ads/hostAdManageModel";
import { hostAdPauseConfirmWords } from "../../../components/marketing/ads/hostAdManageCopy";

type Node = { type: unknown; props: Record<string, unknown> };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; update: (element: React.ReactElement) => void };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ad = (over: Record<string, unknown>) => ({
  campaign: { name: "Ad", status: "ACTIVE" },
  plan_state: "LIVE",
  plan_id: null,
  plan_currency: "USD",
  plan_cap_cents: 15000,
  host_spend_equivalent_cents: 10000,
  host_spend_equivalent_quality: null,
  provider_spend_by_currency: [{ currency: "USD", spend_cents: 10000 }],
  settlements: [],
  plan_campaigns: [{ id: "pc", platform: "meta", status: "ACTIVE" }],
  measurement: {},
  results: {},
  timeline: [],
  credit_events: [],
  creatives: [],
  daily: [],
  time_zone: "America/New_York",
  ...over,
});
// Learning ad A holds more than Running Meta B: the money in the confirm must never retarget.
const AD_A = ad({ campaign: { name: "Learning", status: "ACTIVE" }, plan_cap_cents: 120000, host_spend_equivalent_cents: 12000 });
const AD_B = ad({ campaign: { name: "Running Meta", status: "ACTIVE" }, plan_cap_cents: 70000, host_spend_equivalent_cents: 6000 });
const REJECTED = ad({
  campaign: { name: "Rooftop", status: "PAUSED" },
  plan_state: "platform_rejected",
  host_spend_equivalent_cents: 0,
  provider_spend_by_currency: [],
  plan_campaigns: [{ id: "pc", platform: "meta", status: "PAUSED" }],
});

const find = (tree: Tree, type: string, testID: string): Node | undefined =>
  tree.root.findAll((n) => n.type === type && n.props.testID === testID)[0];
const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    await Promise.resolve();
  });
};

const mount = async (): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<HostAdDetailRoute />);
  });
  await flush();
  return tree;
};
const goTo = async (tree: Tree, id: string): Promise<void> => {
  mockParams = { id };
  await TestRenderer.act(async () => {
    tree.update(<HostAdDetailRoute />);
  });
  await flush();
};
const openEnd = async (tree: Tree): Promise<void> => {
  await TestRenderer.act(async () => {
    (find(tree, "FakeButton", "ads-detail-end")?.props.onPress as () => void)();
  });
};

describe("#4238 rework 5 (native P1-1): a confirm belongs to the ad it was opened for", () => {
  beforeEach(() => {
    mockParams = { id: "camp-a" };
    mockPause.mockClear();
    mockEnd.mockClear();
    mockGet.mockReset();
    mockGet.mockImplementation(async (_brand, campaignId) => (campaignId === "camp-b" ? AD_B : campaignId === "camp-r" ? REJECTED : AD_A));
  });

  test("End open on ad A, then a move to ad B: the confirm is closed and nothing ends", async () => {
    const tree = await mount();
    await openEnd(tree);
    const dialogA = find(tree, "FakeConfirmDialog", "ads-detail-destructive-dialog");
    expect(dialogA?.props.visible).toBe(true);
    expect(dialogA?.props.description).toContain("USD 1,270.59");

    await goTo(tree, "camp-b");
    expect(mockGet).toHaveBeenLastCalledWith("brand-1", "camp-b");
    const dialogB = find(tree, "FakeConfirmDialog", "ads-detail-destructive-dialog");
    expect(dialogB?.props.visible).toBe(false);
    expect(mockEnd).not.toHaveBeenCalled();
  });

  test("a submit from ad A's confirm after the move to B never acts on B (nor on anything)", async () => {
    const tree = await mount();
    await openEnd(tree);
    const staleConfirm = find(tree, "FakeConfirmDialog", "ads-detail-destructive-dialog")?.props.onConfirm as () => Promise<void>;
    await goTo(tree, "camp-b");
    await TestRenderer.act(async () => {
      await staleConfirm();
    });
    expect(mockEnd).not.toHaveBeenCalled();

    // B's own End still works, on B only.
    await openEnd(tree);
    const dialogB = find(tree, "FakeConfirmDialog", "ads-detail-destructive-dialog");
    expect(dialogB?.props.description).toContain("USD 752.95");
    await TestRenderer.act(async () => {
      await (dialogB?.props.onConfirm as () => Promise<void>)();
    });
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd.mock.calls[0]?.[0]).toMatchObject({ brandId: "brand-1", campaignId: "camp-b" });
  });

  test("Pause open on ad A, then a move to ad B: closed, and A's stale submit pauses nothing", async () => {
    const tree = await mount();
    await TestRenderer.act(async () => {
      (find(tree, "FakeButton", "ads-detail-pause")?.props.onPress as () => void)();
    });
    const stale = find(tree, "FakeConfirmDialog", "ads-detail-pause-dialog");
    expect(stale?.props.visible).toBe(true);
    const staleConfirm = stale?.props.onConfirm as () => Promise<void>;
    await goTo(tree, "camp-b");
    expect(find(tree, "FakeConfirmDialog", "ads-detail-pause-dialog")?.props.visible).toBe(false);
    await TestRenderer.act(async () => {
      await staleConfirm();
    });
    expect(mockPause).not.toHaveBeenCalled();
  });

  test("the binding rule: only the same brand + campaign + plan passes", () => {
    const a = hostAdConfirmKey({ brandId: "b", campaignId: "camp-a", planId: "p-a" });
    const b = hostAdConfirmKey({ brandId: "b", campaignId: "camp-b", planId: "p-b" });
    expect(hostAdConfirmStillBound(a, a)).toBe(true);
    expect(hostAdConfirmStillBound(a, b)).toBe(false);
    expect(hostAdConfirmStillBound(a, hostAdConfirmKey({ brandId: "other", campaignId: "camp-a", planId: "p-a" }))).toBe(false);
    expect(hostAdConfirmStillBound(a, null)).toBe(false);
    expect(hostAdConfirmStillBound(null, a)).toBe(false);
    expect(hostAdConfirmKey({ brandId: null, campaignId: "camp-a", planId: null })).toBeNull();
  });
});

describe("#4238 rework 5 (native P1-2): the rejected ad's actions sit above the tab bar", () => {
  beforeEach(() => {
    mockParams = { id: "camp-r" };
    mockGet.mockReset();
    mockGet.mockResolvedValue(REJECTED);
  });

  test("Ask Ari is in the pinned dock (outside the scroll), and the scroll clears the dock", async () => {
    const tree = await mount();
    const dock = find(tree, "View", "ads-detail-dock");
    expect(dock).toBeDefined();
    const inDock = (dock as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
      (n) => n.type === "FakeButton" && n.props.testID === "ads-detail-ask-ari",
    );
    expect(inDock).toHaveLength(1);
    await TestRenderer.act(async () => {
      (dock?.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { height: 180 } } });
    });
    const scroll = tree.root.findAll(
      (n) => n.type === "View" && Array.isArray(n.props.contentContainerStyle),
    )[0];
    const styles = scroll?.props.contentContainerStyle as { paddingBottom?: number }[];
    const bottom = styles.map((s) => s?.paddingBottom).filter((v): v is number => typeof v === "number").pop();
    expect(bottom).toBeGreaterThanOrEqual(180 + 24);
  });
});

describe("#4238 rework 5 (native P2-1): one pause confirm", () => {
  test("the detail page's pause words are hostAdPauseConfirmWords", async () => {
    mockParams = { id: "camp-a" };
    mockGet.mockReset();
    mockGet.mockResolvedValue(AD_A);
    const tree = await mount();
    const dialog = find(tree, "FakeConfirmDialog", "ads-detail-pause-dialog");
    const words = hostAdPauseConfirmWords({ capCredit: 120000, spentCredit: 12000, currency: "USD" });
    expect(dialog?.props.description).toBe(words.description);
    expect(words.description).toBe("It stops spending now. USD 1,270.59 stays held until you resume or end it.");
  });
});
