/**
 * #4420 B2 — Pause on a live ad asks once before it runs.
 *
 * Seth's confirm rule (11-14): any action that moves money or acts on another
 * person asks once, with the consequence in one line. Pausing a live ad stops
 * it showing straight away, so the Pause button opens "Pause this ad?" and
 * only "Pause ad" calls `pauseHostAdCampaign`. "Keep running" calls nothing.
 *
 * FAILS ON REVERT: wire the Pause button straight to onPause again and
 * "pressing Pause does not pause" fails.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

const mockPause = jest.fn<() => Promise<void>>(async () => undefined);
const mockGet = jest.fn<() => Promise<unknown>>();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "camp-1" }),
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
  getHostAdCampaign: (...args: unknown[]) => mockGet(...(args as [])),
  pauseHostAdCampaign: (...args: unknown[]) => mockPause(...(args as [])),
  cancelHostAdCampaign: jest.fn(),
  endHostAdCampaign: jest.fn(),
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

type Node = { type: unknown; props: Record<string, unknown> };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIVE_AD = {
  campaign: { name: "Friday Film Club regulars", status: "ACTIVE" },
  plan_state: "LIVE",
  plan_id: null,
  plan_currency: "USD",
  plan_cap_cents: 15000,
  host_spend_equivalent_cents: 0,
  host_spend_equivalent_quality: null,
  provider_spend_by_currency: [],
  settlements: [],
  plan_campaigns: [{ id: "pc-1", platform: "meta", status: "ACTIVE" }],
  measurement: {},
  results: {},
  timeline: [],
  credit_events: [],
  creatives: [],
  daily: [],
  time_zone: "America/New_York",
};

const render = async () => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<HostAdDetailRoute />);
  });
  const pauseButton = () => tree.root.findAll((n) => n.type === "FakeButton" && n.props.testID === "ads-detail-pause")[0];
  const pauseDialog = () =>
    tree.root.findAll((n) => n.type === "FakeConfirmDialog" && n.props.testID === "ads-detail-pause-dialog")[0];
  return { pauseButton, pauseDialog };
};

describe("#4420 B2 — Pause on a live ad asks once", () => {
  beforeEach(() => {
    mockPause.mockClear();
    mockGet.mockReset();
    mockGet.mockResolvedValue(LIVE_AD);
  });

  test("pressing Pause does not pause: it opens the confirm with the one-line consequence", async () => {
    const { pauseButton, pauseDialog } = await render();
    expect(pauseDialog().props.visible).toBe(false);
    await TestRenderer.act(async () => {
      (pauseButton().props.onPress as () => void)();
    });
    expect(mockPause).not.toHaveBeenCalled();
    const dialog = pauseDialog();
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.title).toBe("Pause this ad?");
    // #4238 W6b: the consequence names what stays held, in what the Host pays.
    expect(dialog.props.description).toBe("It stops spending now. USD 176.48 stays held until you resume or end it.");
    expect(dialog.props.confirmLabel).toBe("Pause");
    expect(dialog.props.cancelLabel).toBe("Keep running");
  });

  test("Pause ad pauses once and closes the confirm", async () => {
    const { pauseButton, pauseDialog } = await render();
    await TestRenderer.act(async () => {
      (pauseButton().props.onPress as () => void)();
    });
    await TestRenderer.act(async () => {
      await (pauseDialog().props.onConfirm as () => Promise<void>)();
    });
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockPause).toHaveBeenCalledWith({ brandId: "brand-1", campaignId: "camp-1" });
    expect(pauseDialog().props.visible).toBe(false);
  });

  test("Keep running calls nothing", async () => {
    const { pauseButton, pauseDialog } = await render();
    await TestRenderer.act(async () => {
      (pauseButton().props.onPress as () => void)();
    });
    await TestRenderer.act(async () => {
      (pauseDialog().props.onClose as () => void)();
    });
    expect(mockPause).not.toHaveBeenCalled();
    expect(pauseDialog().props.visible).toBe(false);
  });

  test("a failed pause keeps the confirm open with the error", async () => {
    mockPause.mockRejectedValueOnce(new Error("boom"));
    const { pauseButton, pauseDialog } = await render();
    await TestRenderer.act(async () => {
      (pauseButton().props.onPress as () => void)();
    });
    await TestRenderer.act(async () => {
      await (pauseDialog().props.onConfirm as () => Promise<void>)();
    });
    expect(pauseDialog().props.visible).toBe(true);
    expect(pauseDialog().props.errorMessage).toBe("That didn't go through. Nothing was changed; try again in a minute.");
  });
});
