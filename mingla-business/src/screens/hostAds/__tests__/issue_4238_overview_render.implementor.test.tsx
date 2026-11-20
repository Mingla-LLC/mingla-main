/**
 * #4238 Overview — the ad detail screen answers "is my ad working?".
 *
 * Renders the real detail screen with mocked services (the #4420 pattern):
 * phone order, wide-desktop columns, no "—" tile, "Day 1 of 3", no verdict
 * without guidance, nothing new on a rejected ad, no Pace on an ended ad
 * (the Money card stays), and Ask Ari prefills (never sends) and captures
 * one event.
 *
 * FAILS ON REVERT: restoring the "—" tile or the "of 7" literal, rendering
 * the funnel twice on desktop, or dropping the verdict guard fails below.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

const mockGet = jest.fn<() => Promise<unknown>>();
const mockPush = jest.fn();
const mockCapture = jest.fn();
let mockWide = false;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "camp-1" }),
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: (...args: unknown[]) => mockCapture(...args) },
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
    canFund: true,
    canPlan: true,
  }),
}));
jest.mock("../../../hooks/useStickyFooterOffset", () => ({ useStickyFooterOffset: () => 0 }));
jest.mock("../../../hooks/marketing/useAdCreditWallet", () => ({
  useAdCreditWallet: () => ({ canView: false, data: null, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: mockWide }) }));
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
  const R = jest.requireActual("react") as typeof React;
  const card = (props: Record<string, unknown>) => R.createElement("FakeCard", props);
  return {
    builderStyles: new Proxy({}, { get: () => ({}) }),
    BuilderCard: card,
    BuilderLabel: ({ children }: { children?: React.ReactNode }) => R.createElement("FakeLabel", null, children),
    BuilderList: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Blocker: () => null,
    Note: (props: Record<string, unknown>) => R.createElement("FakeNote", { testID: props.testID, text: props.text }),
    Segmented: () => null,
    ValueRow: (props: Record<string, unknown>) => R.createElement("FakeRow", { testID: props.testID }),
  };
});
jest.mock("../../../services/hostAdCampaignService", () => ({
  getHostAdCampaign: (...args: unknown[]) => mockGet(...(args as [])),
  pauseHostAdCampaign: jest.fn(),
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
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native") as { View: unknown };
  return { ScrollView: View };
});
jest.mock("../../../components/marketing/ads/results/AdResultsSection", () => {
  const R = jest.requireActual("react") as typeof React;
  return {
    AdResultsSection: (props: Record<string, unknown>) =>
      R.createElement("FakeResultsSection", { showFunnel: props.showFunnel, showSplit: props.showSplit }),
  };
});
jest.mock("../../../components/marketing/ads/hostAdAlerts", () => ({
  hostAdLearningAlert: () => null,
  hostAdPacingAlert: () => null,
  hostAdRunDay: () => 1,
}));
jest.mock("../../../components/marketing/ads/HostAdLiveEditCard", () => ({
  HostAdLiveEditCard: () => null,
  hostAdLiveEditAttempt: jest.fn(),
}));
jest.mock("../../../components/marketing/ads/hostAdBuilderRules", () => ({
  goBackToAds: jest.fn(),
  hostAdScrollBottomPadding: () => 0,
}));
jest.mock("../../../components/ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("../../../components/ui/Material", () => ({
  Material: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../../components/ui/Button", () => ({
  Button: (props: Record<string, unknown>) => {
    const R = jest.requireActual("react") as typeof React;
    return R.createElement("FakeButton", { testID: props.testID, label: props.label, onPress: props.onPress });
  },
}));
jest.mock("../../../components/ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));

import HostAdDetailRoute from "../HostAdDetailScreen";
import { useAriSeedStore } from "../../../store/ariSeedStore";

type Json = { type: string; props: Record<string, unknown>; children: (Json | string)[] | null };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    toJSON: () => Json | Json[] | null;
    root: { findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] };
  };
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const verdictBehind = {
  state: "behind",
  drop_off: "not_buying",
  cost_per_result_cents: null,
  expected_cost_per_result_cents: 91667,
};
const LIVE_AD = {
  campaign: { name: "Tinoe Yard", status: "ACTIVE", starts_at: iso(NOW - 86_400_000) },
  plan_state: "live",
  plan_id: "plan-1",
  plan_currency: "NGN",
  plan_cap_cents: 3_000_000,
  plan_daily_credit_cents: 1_000_000,
  host_spend_equivalent_cents: 1_481_100,
  host_spend_equivalent_quality: "frozen_plan_fx",
  provider_spend_by_currency: [{ currency: "USD", spend_cents: 1124 }],
  settlements: [],
  plan_campaigns: [
    { id: "c-snap", platform: "snapchat", status: "ACTIVE", ends_at: iso(NOW + 2 * 86_400_000) },
    { id: "c-meta", platform: "meta", status: "ACTIVE", ends_at: iso(NOW + 2 * 86_400_000) },
  ],
  measurement: { manifest: { result_hierarchy: ["ticket_purchase"] } },
  results: { orders: 0, tickets: 0, sign_ups: 0, clicks_7d: 0, conversions: 0, value_cents: {} },
  timeline: [],
  credit_events: [],
  creatives: [],
  daily: [
    { day: "2026-11-19", spend_host_cents: 1_481_100, spend_provider_cents: 1124, provider_currency: "USD", impressions: 26_660, clicks: 415, page_visits: 314, results: 0 },
  ],
  days_live: 1,
  learning: { state: "learning", until: iso(NOW + 6 * 86_400_000) },
  time_zone: "UTC",
  by_placement: [],
  overview: {
    verdict: verdictBehind,
    checkout_started: 0,
    run_days: 3,
    synced_at: iso(NOW - 12 * 60_000),
    pace: {
      total_credit_cents: 3_000_000,
      spent_credit_cents: 1_481_100,
      even_share: 0.34,
      apps: [
        { platform: "snapchat", campaign_id: "c-snap", spent_credit_cents: 1_370_000, page_visits: 200, cost_per_visit_credit_cents: 6850, state: "ends_early", stops_at: iso(NOW + 13 * 3_600_000) },
        { platform: "meta", campaign_id: "c-meta", spent_credit_cents: 111_100, page_visits: 114, cost_per_visit_credit_cents: 975, state: "on_pace", stops_at: null },
      ],
    },
    best_video: {
      best: { creative_id: "a", name: "Night video", taps: 210, spend_per_tap_credit_cents: 2730 },
      worst: { creative_id: "b", name: "Day video", taps: 84, spend_per_tap_credit_cents: 5150 },
    },
  },
};

function walk(node: Json | Json[] | string | null, out: { ids: string[]; texts: string[] }): void {
  if (node === null) return;
  if (typeof node === "string") {
    out.texts.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, out));
    return;
  }
  if (typeof node.props.testID === "string") out.ids.push(node.props.testID);
  for (const key of ["label", "text"]) {
    if (typeof node.props[key] === "string") out.texts.push(node.props[key] as string);
  }
  (node.children ?? []).forEach((child) => walk(child, out));
}

const render = async (payload: unknown) => {
  mockGet.mockResolvedValue(payload);
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<HostAdDetailRoute />);
  });
  const read = (node: Json | Json[] | null = tree.toJSON()) => {
    const out = { ids: [] as string[], texts: [] as string[] };
    walk(node, out);
    return out;
  };
  const column = (testID: string): { ids: string[]; texts: string[] } => {
    const find = (node: Json | Json[] | string | null): Json | null => {
      if (node === null || typeof node === "string") return null;
      if (Array.isArray(node)) {
        for (const child of node) {
          const hit = find(child);
          if (hit) return hit;
        }
        return null;
      }
      if (node.props.testID === testID) return node;
      return find(node.children as Json[] | null);
    };
    const hit = find(tree.toJSON());
    expect(hit).not.toBeNull();
    return read(hit);
  };
  return { tree, read, column };
};

const OVERVIEW_IDS = [
  "ads-detail-hero",
  "ads-detail-verdict",
  "ads-detail-results",
  "ads-overview-funnel",
  "ads-detail-pace",
  "ads-detail-best-video",
  "ads-detail-ask-ari-overview",
  "ads-detail-budget",
  "ads-detail-actions",
  "ads-detail-duplicate",
];
const order = (ids: string[]) => ids.filter((id, index) => OVERVIEW_IDS.includes(id) && ids.indexOf(id) === index);

describe("#4238 Overview on the ad detail screen", () => {
  beforeEach(() => {
    mockWide = false;
    mockGet.mockReset();
    mockPush.mockClear();
    mockCapture.mockClear();
    useAriSeedStore.getState().reset();
  });

  test("phone: the answer comes first, in the spec order, with the Tinoe verdict and funnel", async () => {
    const { read } = await render(LIVE_AD);
    const { ids, texts } = read();
    expect(order(ids)).toEqual(OVERVIEW_IDS);
    expect(texts).toContain("Behind what we expected");
    expect(texts).toContain("People are visiting, but nobody has bought yet.");
    expect(ids).toEqual(expect.arrayContaining([
      "ads-overview-step-shown",
      "ads-overview-step-tapped",
      "ads-overview-step-reached",
      "ads-overview-step-checkout",
      "ads-overview-step-bought",
      "ads-detail-checkout",
      "ads-detail-late-sales",
      "ads-pace-snapchat",
      "ads-pace-meta",
    ]));
    expect(texts).toContain("1.6% of people shown tapped");
    expect(texts).toContain("76% of taps reached your page");
    expect(texts).toContain("Ends early");
    expect(texts).toContain("On pace");
    expect(texts.some((t) => /^Snapchat will use up its share by .+ Nothing extra is charged\.$/.test(t))).toBe(true);
    expect(texts).toContain("Updated 12 min ago");
    expect(texts).toContain("Per page visit");
    expect(texts).toContain("Tickets bought up to 7 days after someone taps the ad still count here.");
  });

  test("no tile renders a dash, and the learning line reads 'Day 1 of 3'", async () => {
    const { read } = await render(LIVE_AD);
    const { texts } = read();
    expect(texts).not.toContain("—");
    expect(texts.some((t) => t.startsWith("Day 1 of 3."))).toBe(true);
    expect(texts.some((t) => t.includes("of 7."))).toBe(false);
  });

  test("with no result, visit or tap the Per tile is hidden, never '—'", async () => {
    const { read } = await render({
      ...LIVE_AD,
      daily: [{ ...LIVE_AD.daily[0], clicks: 0, page_visits: 0 }],
    });
    const { ids, texts } = read();
    expect(ids).not.toContain("ads-detail-each");
    expect(texts).not.toContain("—");
  });

  test("wide desktop: main = hero, verdict, Results, Day by day; side = Pace, Best video, Ask Ari, Budget, actions, Duplicate; one funnel", async () => {
    mockWide = true;
    const { column, tree } = await render(LIVE_AD);
    const main = column("ads-detail-desk-main").ids;
    expect(order(main)).toEqual(["ads-detail-hero", "ads-detail-verdict", "ads-detail-results", "ads-overview-funnel"]);
    expect(main).toContain("ads-detail-numbers");
    expect(main.indexOf("ads-detail-numbers")).toBeGreaterThan(main.indexOf("ads-detail-results"));
    const side = column("ads-detail-desk-side").ids;
    expect(order(side)).toEqual([
      "ads-detail-pace",
      "ads-detail-best-video",
      "ads-detail-ask-ari-overview",
      "ads-detail-budget",
      "ads-detail-actions",
      "ads-detail-duplicate",
    ]);
    const sections = tree.root.findAll((n) => n.type === "FakeResultsSection");
    expect(sections).toHaveLength(1);
    expect(sections[0].props.showFunnel).toBe(false);
    expect(sections[0].props.showSplit).toBe(false);
  });

  test("no verdict card without guidance (server sends null)", async () => {
    const { read } = await render({ ...LIVE_AD, overview: { ...LIVE_AD.overview, verdict: null } });
    expect(read().ids).not.toContain("ads-detail-verdict");
  });

  test("an older server without the overview block still renders, with no new cards", async () => {
    const { overview: _drop, ...older } = LIVE_AD;
    const { read } = await render(older);
    const { ids, texts } = read();
    expect(ids).toContain("ads-detail-results");
    for (const id of ["ads-detail-verdict", "ads-detail-pace", "ads-detail-best-video", "ads-detail-checkout", "ads-detail-updated", "ads-overview-step-checkout"]) {
      expect(ids).not.toContain(id);
    }
    expect(texts.some((t) => t.startsWith("Day 1 of 7."))).toBe(true);
  });

  test("a rejected ad shows none of the new cards", async () => {
    const { read } = await render({ ...LIVE_AD, plan_state: "platform_rejected" });
    const { ids } = read();
    for (const id of ["ads-detail-verdict", "ads-detail-pace", "ads-detail-best-video", "ads-detail-ask-ari-overview", "ads-detail-updated"]) {
      expect(ids).not.toContain(id);
    }
    expect(ids).toContain("ads-detail-rejected-dock");
  });

  test("an ended ad shows no Pace and no Updated, but keeps the verdict, best video, Ask Ari and the Money card", async () => {
    const { read } = await render({
      ...LIVE_AD,
      plan_state: "ended",
      plan_campaigns: LIVE_AD.plan_campaigns.map((row) => ({ ...row, status: "ARCHIVED" })),
    });
    const { ids } = read();
    expect(ids).not.toContain("ads-detail-pace");
    expect(ids).not.toContain("ads-detail-updated");
    expect(ids).toEqual(expect.arrayContaining(["ads-detail-verdict", "ads-detail-best-video", "ads-detail-ask-ari-overview", "ads-detail-money"]));
  });

  test("a paused ad shows Pace with its apps reading Stopped", async () => {
    const { read } = await render({
      ...LIVE_AD,
      plan_state: "paused",
      overview: {
        ...LIVE_AD.overview,
        pace: {
          ...LIVE_AD.overview.pace,
          apps: LIVE_AD.overview.pace.apps.map((row) => ({ ...row, state: "stopped", stops_at: null })),
        },
      },
    });
    const { ids, texts } = read();
    expect(ids).toContain("ads-detail-pace");
    expect(texts.filter((t) => t === "Stopped")).toHaveLength(2);
  });

  test("Ask Ari prefills this ad's question (never sends) and captures one event", async () => {
    const { tree } = await render(LIVE_AD);
    const button = tree.root.findAll((n) => n.type === "FakeButton" && n.props.testID === "ads-detail-ask-ari-overview")[0];
    expect(button.props.label).toBe("Ask Ari why people aren't buying");
    await TestRenderer.act(async () => {
      (button.props.onPress as () => void)();
    });
    expect(useAriSeedStore.getState().seed).toBe("Why aren't people buying from my ad Tinoe Yard?");
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith("host_ad_ask_ari_opened", {
      campaign_id: "camp-1",
      plan_id: "plan-1",
      verdict: "behind",
    });
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/ari?brandId=brand-1&adCampaignId=camp-1");
  });
});
