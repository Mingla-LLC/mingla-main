import React from "react";
import { StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import HomeTab from "../home";

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return { ...actual, lazy: () => "UniversalCreatorSheet" };
});

// [TEST-MOD-APPROVED #2794] The approved Recent workspace supersedes this
// lane's former Last-7/Live/Upcoming composition contract.

const mockPush = jest.fn();
const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);
const mockSetCurrentBrand = jest.fn();
const mockRecentRefresh = jest.fn().mockResolvedValue(undefined);
const mockAnalyticsData = {
  brandId: "brand-874",
  authorized: true,
  minglaDrove30d: 3,
  minglaDroveLifetime: 8,
  valueCents30d: { USD: 2400 },
  valueCentsLifetime: { USD: 6100 },
  bySource: [],
};
const mockBrand = {
  id: "brand-874",
  displayName: "Smoke & Rhythm",
  defaultCurrency: "USD",
  stats: { rev7d: 12500 },
};
const mockLive = (id: string) => ({
  key: `event:${id}`,
  id,
  kind: "event",
  status: "live",
  source: {
    id,
    name: `Live ${id}`,
    status: "live",
    tickets: [],
    currency: "USD",
  },
});
const mockUpcomingItem = {
  key: "event:upcoming-1",
  id: "upcoming-1",
  kind: "event",
  status: "scheduled",
  source: {
    id: "upcoming-1",
    name: "Upcoming one",
    status: "scheduled",
    tickets: [],
    currency: "USD",
  },
};
const mockRecentRow = {
  entityType: "event" as const,
  entityId: "recent-live-1",
  lastOpenedAt: "2026-08-29T12:00:00.000Z",
  operationId: "recent-operation-1",
  title: "Recent live event",
  status: "live",
  pendingSync: false,
  localDraft: false,
};
let mockIsWideDesktop = false;
let mockRecentState: "empty" | "populated" = "populated";
let mockUpcoming = {
  items: [mockLive("live-1"), mockUpcomingItem],
  liveItems: [mockLive("live-1")],
  nonLiveItems: [mockUpcomingItem],
  counts: { active: 2, total: 2 },
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, error: null, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useQueries: () => [],
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../../../src/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner-874" } }),
}));
jest.mock("../../../src/store/currentBrandStore", () => {
  const useCurrentBrandStore = Object.assign(
    (selector: (state: { setCurrentBrand: typeof mockSetCurrentBrand }) => unknown) =>
      selector({ setCurrentBrand: mockSetCurrentBrand }),
    {
      getState: () => ({ currentBrandId: mockBrand.id }),
    },
  );
  return { useCurrentBrandStore };
});
jest.mock("../../../src/hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => mockBrand,
}));
jest.mock("../../../src/hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 60, isLoading: false }),
}));
jest.mock("../../../src/hooks/useCurrentBrandRecovery", () => ({
  useCurrentBrandRecovery: () => ({ errorMessage: null }),
}));
jest.mock("../../../src/hooks/useBusinessTodos", () => ({
  useBusinessTodos: () => [],
}));
jest.mock("../../../src/hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: mockIsWideDesktop }),
}));
jest.mock("../../../src/hooks/marketing/useHostAdCampaigns", () => ({
  hostAdCampaignKeys: {
    byBrand: (brandId: string) => ["host-ad-campaigns", brandId],
  },
}));
jest.mock("../../../src/hooks/useBusinessRecent", () => ({
  useBusinessRecent: () => ({
    rows: mockRecentState === "empty" ? [] : [mockRecentRow],
    total: mockRecentState === "empty" ? 0 : 1,
    state: mockRecentState,
    isRefreshing: false,
    isLoadingMore: false,
    hasPageError: false,
    hasMore: false,
    retry: jest.fn().mockResolvedValue(undefined),
    refresh: mockRecentRefresh,
  }),
}));
jest.mock("../../../src/hooks/useBrands", () => ({
  brandKeys: { all: ["brands"] },
}));
jest.mock("../../../src/hooks/useEventOrders", () => ({
  eventOrdersKeys: { all: ["event-orders"] },
  useEventSalesSummaries: () => ({}),
}));
jest.mock("../../../src/hooks/useUpcomingForBrand", () => ({
  upcomingKeys: { all: ["upcoming"] },
  useUpcomingForBrand: () => mockUpcoming,
}));
jest.mock("../../../src/hooks/useBrandAnalytics", () => ({
  brandAnalyticsKeys: {
    minglaDrove: (brandId: string) => ["brand-analytics", brandId, "mingla-drove"],
  },
  useBrandMinglaDroveRollup: () => ({
    data: mockAnalyticsData,
    isLoading: false,
    isError: false,
  }),
}));
jest.mock("../../../src/hooks/useBrandPayoutScreen", () => ({
  brandPayoutScreenKey: (brandId: string) => ["brand", brandId, "payout-screen"],
}));
jest.mock("../../../src/hooks/useTrafficAnalytics", () => ({
  trafficAnalyticsKeys: {
    brand: (brandId: string, range: string) => [
      "traffic-analytics",
      "brand",
      brandId,
      range,
    ],
  },
}));
jest.mock("../../../src/utils/routeForEventRow", () => ({
  routeForEventRowDefensive: ({ id }: { id: string }) => `/event/${id}`,
}));
jest.mock("../../../src/utils/tripToLiveEvent", () => ({
  tripToLiveEvent: (trip: unknown) => trip,
}));
jest.mock("../../../src/utils/eventDateDisplay", () => ({
  formatDraftDateLine: () => "Soon",
}));
jest.mock("../../../src/utils/navTabGate", () => ({
  isScannerOnlyRank: () => false,
}));
jest.mock("../../../src/services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

jest.mock("../../../src/components/brand/BrandDeleteSheet", () => ({
  BrandDeleteSheet: "BrandDeleteSheet",
}));
jest.mock("../../../src/components/brand/BrandSwitcherSheet", () => ({
  BrandSwitcherSheet: "BrandSwitcherSheet",
}));
jest.mock("../../../src/components/home/BusinessTodoToggle", () => ({
  BusinessTodoToggle: "BusinessTodoToggle",
}));
jest.mock("../../../src/components/home/BusinessPulsePanel", () => ({
  BusinessPulsePanel: "BusinessPulsePanel",
}));
jest.mock("../../../src/components/home/HomeAdsSection", () => ({
  HomeAdsSection: "HomeAdsSection",
}));
jest.mock("../../../src/components/home/RecentRow", () => ({
  RecentRow: "RecentRow",
}));
jest.mock("../../../src/components/scanners/ScannerHome", () => ({
  ScannerHome: "ScannerHome",
}));
jest.mock("../../../src/components/team/InvitePendingSheet", () => ({
  InvitePendingSheet: "InvitePendingSheet",
}));
jest.mock("../../../src/components/ui/EventCoverMedia", () => ({
  EventCoverMedia: "EventCoverMedia",
}));
jest.mock("../../../src/components/ui/GlassCard", () => ({
  GlassCard: "GlassCard",
}));
jest.mock("../../../src/components/ui/Icon", () => ({ Icon: "Icon" }));
jest.mock("../../../src/components/ui/KpiTile", () => ({ KpiTile: "KpiTile" }));
jest.mock("../../../src/components/ui/Pill", () => {
  const ReactModule = jest.requireActual<typeof React>("react");
  const Native = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Pill: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(Native.Text, null, children),
  };
});
jest.mock("../../../src/components/ui/Toast", () => ({ Toast: "Toast" }));
jest.mock("../../../src/components/ui/IconChrome", () => ({
  IconChrome: "IconChrome",
}));
jest.mock("../../../src/components/ui/TopBar", () => ({ TopBar: "TopBar" }));
jest.mock("../../../src/components/ui/UniversalCreatorSheet", () => ({
  UniversalCreatorSheet: "UniversalCreatorSheet",
}));

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestNode | string)[];
}

const renderedOrder = (root: TestNode): string[] => {
  const order: string[] = [];
  const visit = (node: TestNode | string): void => {
    if (typeof node === "string") return;
    if (node.type === "BusinessPulsePanel") {
      order.push("pulse");
    } else if (node.type === "RecentRow") {
      order.push("recent");
    }
    node.children.forEach(visit);
  };
  visit(root);
  return order;
};

const findNodes = (
  root: TestNode,
  predicate: (node: TestNode) => boolean,
): TestNode[] => {
  const matches: TestNode[] = [];
  const visit = (node: TestNode | string): void => {
    if (typeof node === "string") return;
    if (predicate(node)) matches.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return matches;
};

describe("issue #874 Home integration real render", () => {
  beforeEach(() => {
    mockIsWideDesktop = false;
    mockRecentState = "populated";
    mockUpcoming = {
      items: [mockLive("live-1"), mockUpcomingItem],
      liveItems: [mockLive("live-1")],
      nonLiveItems: [mockUpcomingItem],
      counts: { active: 2, total: 2 },
    };
    mockPush.mockClear();
    mockInvalidateQueries.mockClear();
    mockRecentRefresh.mockClear();
  });

  it.each([
    ["mobile", false],
    ["wide", true],
  ])("renders the Pulse panel before Recent on %s", async (_, wide) => {
    mockIsWideDesktop = wide;
    const screen = await render(<HomeTab />);
    expect(screen.root).not.toBeNull();
    const order = renderedOrder(screen.root as unknown as TestNode);
    expect(order.indexOf("pulse")).toBeGreaterThan(-1);
    expect(order.indexOf("recent")).toBeGreaterThan(order.indexOf("pulse"));
    expect(screen.queryByText("Active events")).toBeNull();
  });

  it("keeps the Pulse panel and Recent when nothing is live", async () => {
    mockUpcoming = {
      items: [mockUpcomingItem],
      liveItems: [],
      nonLiveItems: [mockUpcomingItem],
      counts: { active: 1, total: 1 },
    };
    const screen = await render(<HomeTab />);
    expect(screen.root).not.toBeNull();
    const root = screen.root as unknown as TestNode;
    const panel = findNodes(
      root,
      (node) => node.type === "BusinessPulsePanel",
    );
    expect(panel).toHaveLength(1);
    expect(panel[0]?.props.liveItems).toEqual([]);
    expect(findNodes(root, (node) => node.type === "RecentRow")).toHaveLength(1);
  });

  it("passes live and upcoming truth into the Pulse panel", async () => {
    const screen = await render(<HomeTab />);
    expect(screen.root).not.toBeNull();
    const root = screen.root as unknown as TestNode;
    expect(findNodes(root, (node) => node.type === "RecentRow")).toHaveLength(1);
    const panel = findNodes(
      root,
      (node) => node.type === "BusinessPulsePanel",
    );
    expect(panel).toHaveLength(1);
    expect(panel[0]?.props.liveItems).toEqual(mockUpcoming.liveItems);
    expect(panel[0]?.props.upcomingItems).toEqual(mockUpcoming.items);
  });

  it("keeps the desktop top section and Recent on one compact rhythm", async () => {
    mockIsWideDesktop = true;
    const screen = await render(<HomeTab />);
    const content = screen.getByTestId("home-desktop-content");
    expect(
      StyleSheet.flatten(content.props.contentContainerStyle).gap,
    ).toBeUndefined();
  });

  it("opens the create modal from the Recent empty state", async () => {
    mockRecentState = "empty";
    const screen = await render(<HomeTab />);

    expect(screen.getByText("Create something")).toBeTruthy();
    expect(screen.queryByText("Browse your work")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId("recent-state-cta"));
    });

    expect(
      findNodes(
        screen.root as unknown as TestNode,
        (node) => node.type === "UniversalCreatorSheet",
      ),
    ).toHaveLength(1);
    expect(mockPush).not.toHaveBeenCalledWith("/(tabs)/hub");
  });

  it("pull-to-refresh invalidates payout and the Home 30-day traffic query", async () => {
    const screen = await render(<HomeTab />);
    const list = screen.getByTestId("home-mobile-scroll");
    const refreshControl = list.props.refreshControl as {
      props: { onRefresh: () => Promise<void> };
    };
    await act(async () => {
      await refreshControl.props.onRefresh();
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["brand-analytics", mockBrand.id, "mingla-drove"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["brand", mockBrand.id, "payout-screen"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["traffic-analytics", "brand", mockBrand.id, "30d"],
    });
    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["traffic-analytics", "brand", mockBrand.id, "all"],
    });
    expect(mockRecentRefresh).toHaveBeenCalledTimes(1);
  });
});
