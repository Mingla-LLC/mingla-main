import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import HomeTab from "../home";

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
let mockUpcoming = {
  items: [mockLive("live-1"), mockUpcomingItem],
  liveItems: [mockLive("live-1")],
  nonLiveItems: [mockUpcomingItem],
  counts: { active: 2, total: 2 },
};

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@tanstack/react-query", () => ({
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
jest.mock("../../../src/hooks/useBusinessRecent", () => ({
  useBusinessRecent: () => ({
    rows: [mockRecentRow],
    total: 1,
    state: "populated",
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
jest.mock("../../../src/store/liveSectionCollapseStore", () => ({
  useLiveSectionCollapseStore: (
    selector: (state: {
      collapsed: boolean;
      hasHydrated: boolean;
      toggle: () => void;
    }) => unknown,
  ) => selector({ collapsed: false, hasHydrated: true, toggle: jest.fn() }),
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
jest.mock("../../../src/components/home/AnalyticsHomeTile", () => ({
  AnalyticsHomeTile: "AnalyticsHomeTile",
}));
jest.mock("../../../src/components/home/LiveOfferingCard", () => ({
  LiveOfferingCard: "LiveOfferingCard",
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
    if (node.type === "KpiTile" && node.props.label === "Last 7 days") {
      order.push("last7");
    } else if (node.type === "AnalyticsHomeTile") {
      order.push("analytics");
    } else if (node.type === "LiveOfferingCard") {
      order.push("live");
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
  ])("renders Analytics before Recent on %s", async (_, wide) => {
    mockIsWideDesktop = wide;
    const screen = await render(<HomeTab />);
    expect(screen.root).not.toBeNull();
    const order = renderedOrder(screen.root as unknown as TestNode);
    expect(order.indexOf("analytics")).toBeGreaterThan(-1);
    expect(order.indexOf("recent")).toBeGreaterThan(order.indexOf("analytics"));
    expect(screen.queryByText("Active events")).toBeNull();
  });

  it("keeps Analytics discoverable and renders Recent without a live carousel", async () => {
    mockUpcoming = {
      items: [mockUpcomingItem],
      liveItems: [],
      nonLiveItems: [mockUpcomingItem],
      counts: { active: 1, total: 1 },
    };
    const screen = await render(<HomeTab />);
    expect(screen.root).not.toBeNull();
    const root = screen.root as unknown as TestNode;
    expect(findNodes(root, (node) => node.type === "AnalyticsHomeTile")).toHaveLength(1);
    expect(findNodes(root, (node) => node.type === "LiveOfferingCard")).toHaveLength(0);
    expect(findNodes(root, (node) => node.type === "RecentRow")).toHaveLength(1);
  });

  it("preserves Analytics navigation alongside Recent", async () => {
    const screen = await render(<HomeTab />);
    expect(screen.root).not.toBeNull();
    const root = screen.root as unknown as TestNode;
    expect(findNodes(root, (node) => node.type === "RecentRow")).toHaveLength(1);
    fireEvent.press(
      findNodes(root, (node) => node.type === "AnalyticsHomeTile")[0] as never,
    );
    expect(mockPush).toHaveBeenCalledWith("/analytics?entry=home_tile");
  });

  it("pull-to-refresh invalidates the brand-keyed Analytics preview", async () => {
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
    expect(mockRecentRefresh).toHaveBeenCalledTimes(1);
  });
});
