/**
 * issue #3345 — switching brand must never show "Create brand" or the
 * brandless Home while the chosen brand loads.
 *
 * Filmed 2026-09-14, several takes: pick a brand in the switcher → the top bar
 * reads "Create brand" and Home is empty for 1–19s → the brand appears.
 *
 * WHAT IS REAL. `useCurrentBrand` (with the REAL React Query client singleton
 * holding a brand list, exactly as the switcher leaves it, and the REAL
 * persisted-pointer store); `TopBar`; the Home tab route; the pending predicate.
 * Only the detail read (`useBrand`) is injected — its "not answered yet" state is
 * the state under test — plus leaf chrome with no bearing on the label.
 *
 * FAILS ON REVERT (each mutation run against this file, see the PR):
 *   - `useCurrentBrand` returns null while the detail loads → U-1, T-3
 *   - TopBar ignores the pending window                    → T-1, T-2
 *   - Home ignores the pending window                      → H-1, H-2
 *   - predicate treats a selected id as absent             → P-2, T-1, H-1
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll(
    predicate: (node: TestInstance) => boolean,
    options?: { deep?: boolean },
  ): TestInstance[];
}
interface RendererInstance {
  root: TestInstance;
  toJSON(): unknown;
  unmount(): void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void): void;
};
const act = TestRenderer.act;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ── Injected state ──────────────────────────────────────────────────────────
type DetailRead = { data: unknown; isError: boolean; isFetched: boolean };
let mockDetail: DetailRead = { data: undefined, isError: false, isFetched: false };
let mockAuthReady = true;
let mockRecoveryResolving = false;

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner-3345" }, isAuthReady: mockAuthReady }),
}));
// Partial on purpose: `useCurrentBrand` must not reach the list cache through
// this module (many suites mock it without `getBrandFromCache`).
jest.mock("../useBrands", () => ({
  useBrand: () => mockDetail,
  brandKeys: {
    all: ["brands"],
    lists: () => ["brands", "list"],
    list: (id: string) => ["brands", "list", id],
    detail: (id: string) => ["brands", "detail", id],
  },
}));

/* eslint-disable import/first */
import { queryClient } from "../../config/queryClient";
import { brandKeys } from "../brandKeys";
import { useCurrentBrand } from "../useCurrentBrand";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { isCurrentBrandPending } from "../../utils/currentBrandPending";
/* eslint-enable import/first */

const BRAND_A = {
  id: "brand-a-3345",
  displayName: "Smoke & Rhythm",
  defaultCurrency: "USD",
  stats: { rev7d: 0 },
};
const BRAND_B = {
  id: "brand-b-3345",
  displayName: "Tuesday Jazz Co",
  defaultCurrency: "USD",
  stats: { rev7d: 0 },
};

const mounted: RendererInstance[] = [];
const mount = (element: React.ReactElement): RendererInstance => {
  let renderer!: RendererInstance;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  mounted.push(renderer);
  return renderer;
};

beforeEach(() => {
  mockDetail = { data: undefined, isError: false, isFetched: false };
  mockAuthReady = true;
  mockRecoveryResolving = false;
  queryClient.clear();
  act(() => {
    useCurrentBrandStore.setState({ currentBrandId: null, hasHydrated: true });
  });
});

afterEach(() => {
  while (mounted.length > 0) {
    const renderer = mounted.pop();
    if (renderer !== undefined) act(() => renderer.unmount());
  }
  queryClient.clear();
});

// ── P — the predicate ───────────────────────────────────────────────────────
describe("#3345 P — loading is not absence", () => {
  test("P-1 a present brand is never pending", () => {
    expect(
      isCurrentBrandPending({
        brandPresent: true,
        currentBrandId: null,
        hasHydrated: false,
        recoveryResolving: true,
      }),
    ).toBe(false);
  });

  test("P-2 a selected id with no record yet is pending", () => {
    expect(
      isCurrentBrandPending({
        brandPresent: false,
        currentBrandId: BRAND_B.id,
        hasHydrated: true,
      }),
    ).toBe(true);
  });

  test("P-3 not hydrated, or recovery still choosing, is pending", () => {
    expect(
      isCurrentBrandPending({
        brandPresent: false,
        currentBrandId: null,
        hasHydrated: false,
      }),
    ).toBe(true);
    expect(
      isCurrentBrandPending({
        brandPresent: false,
        currentBrandId: null,
        hasHydrated: true,
        recoveryResolving: true,
      }),
    ).toBe(true);
  });

  test("P-4 nothing selected and resolution settled is genuinely no brand", () => {
    expect(
      isCurrentBrandPending({
        brandPresent: false,
        currentBrandId: null,
        hasHydrated: true,
        recoveryResolving: false,
      }),
    ).toBe(false);
    // Partial suite mocks hand `undefined` — that must not invent a loading state.
    expect(
      isCurrentBrandPending({
        brandPresent: false,
        currentBrandId: undefined,
        hasHydrated: undefined,
      }),
    ).toBe(false);
  });
});

// ── U — useCurrentBrand across the switch ───────────────────────────────────
describe("#3345 U — useCurrentBrand keeps the chosen brand through the detail read", () => {
  let seen: unknown[] = [];
  const Probe = (): null => {
    seen.push(useCurrentBrand());
    return null;
  };

  beforeEach(() => {
    seen = [];
    // What the switcher leaves behind: the account's brand list, already read.
    queryClient.setQueryData(brandKeys.list("owner-3345"), [BRAND_A, BRAND_B]);
  });

  test("U-1 right after picking a brand (detail not answered) it is the listed brand, not null", () => {
    act(() => {
      useCurrentBrandStore.setState({ currentBrandId: BRAND_B.id });
    });
    mount(<Probe />);
    expect(seen[seen.length - 1]).toEqual(BRAND_B);
  });

  test("U-2 once the detail read answers, its record wins", () => {
    const fresh = { ...BRAND_B, displayName: "Tuesday Jazz Co (renamed)" };
    mockDetail = { data: fresh, isError: false, isFetched: true };
    act(() => {
      useCurrentBrandStore.setState({ currentBrandId: BRAND_B.id });
    });
    mount(<Probe />);
    expect(seen[seen.length - 1]).toEqual(fresh);
  });

  test("U-3 a detail read that answers null (brand gone) stays null", () => {
    mockDetail = { data: null, isError: false, isFetched: true };
    act(() => {
      useCurrentBrandStore.setState({ currentBrandId: BRAND_B.id });
    });
    mount(<Probe />);
    expect(seen[seen.length - 1]).toBeNull();
  });

  test("U-4 before auth is ready no cached copy is used", () => {
    mockAuthReady = false;
    act(() => {
      useCurrentBrandStore.setState({ currentBrandId: BRAND_B.id });
    });
    mount(<Probe />);
    expect(seen[seen.length - 1]).toBeNull();
  });
});

// ── T — the top bar ─────────────────────────────────────────────────────────
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("../useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../useBusinessNotifications", () => ({
  useBusinessNotificationsInbox: () => ({ unreadCount: 0 }),
}));
jest.mock("../useGlobalSearchSheet", () => ({
  useGlobalSearchSheet: { getState: () => ({ open: jest.fn() }) },
}));
jest.mock("../../components/ui/GlassChrome", () => {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return {
    GlassChrome: ({ children }: { children?: React.ReactNode }) =>
      ReactLocal.createElement("GlassChrome", null, children),
  };
});
jest.mock("../../components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../components/ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../components/ui/Toast", () => ({ Toast: () => null }));

// eslint-disable-next-line import/first
import { TopBar } from "../../components/ui/TopBar";

const texts = (renderer: RendererInstance): string =>
  JSON.stringify(renderer.toJSON());
const byTestId = (renderer: RendererInstance, id: string): TestInstance[] =>
  renderer.root.findAll((node) => node.props.testID === id, { deep: true });

describe("#3345 T — the top bar never says Create brand while a brand loads", () => {
  test("T-1 selected brand, nothing cached, detail pending → loading placeholder", () => {
    act(() => {
      useCurrentBrandStore.setState({ currentBrandId: BRAND_B.id });
    });
    const bar = mount(<TopBar leftKind="brand" onBrandTap={() => undefined} />);
    expect(texts(bar)).not.toContain("Create brand");
    expect(byTestId(bar, "topbar-brand-loading").length).toBeGreaterThan(0);
  });

  test("T-2 the host's resolving signal also holds the placeholder", () => {
    const bar = mount(
      <TopBar leftKind="brand" onBrandTap={() => undefined} brandLoading />,
    );
    expect(texts(bar)).not.toContain("Create brand");
  });

  test("T-3 right after a switch with the list cached → the chosen brand's name", () => {
    queryClient.setQueryData(brandKeys.list("owner-3345"), [BRAND_A, BRAND_B]);
    act(() => {
      useCurrentBrandStore.setState({ currentBrandId: BRAND_B.id });
    });
    const bar = mount(<TopBar leftKind="brand" onBrandTap={() => undefined} />);
    expect(texts(bar)).toContain("Tuesday Jazz Co");
    expect(texts(bar)).not.toContain("Create brand");
  });

  test("T-4 genuinely no brand (nothing selected, hydrated) → Create brand", () => {
    const bar = mount(<TopBar leftKind="brand" onBrandTap={() => undefined} />);
    expect(texts(bar)).toContain("Create brand");
    expect(byTestId(bar, "topbar-brand-loading")).toHaveLength(0);
  });
});

// ── H — the Home tab ────────────────────────────────────────────────────────
// Home is mounted with its data hooks injected (the #874 suite's seams); the
// branch between loading, brandless and populated is what is under test.
jest.mock("../useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 60, isLoading: false }),
}));
jest.mock("../useCurrentBrandRecovery", () => ({
  useCurrentBrandRecovery: () => ({
    errorMessage: null,
    isResolving: mockRecoveryResolving,
    isError: false,
  }),
}));
jest.mock("../useBusinessTodos", () => ({ useBusinessTodos: () => [] }));
jest.mock("../useBusinessRecentHome", () => ({
  useBusinessRecent: () => ({
    rows: [],
    total: 0,
    state: "empty",
    isRefreshing: false,
    isLoadingMore: false,
    hasPageError: false,
    hasMore: false,
    retry: jest.fn(),
    refresh: jest.fn(),
  }),
}));
jest.mock("../useEventOrders", () => ({
  eventOrdersKeys: { all: ["event-orders"] },
  useEventSalesSummaries: () => ({}),
}));
jest.mock("../useUpcomingForBrand", () => ({
  upcomingKeys: { all: ["upcoming"] },
  useUpcomingForBrand: () => ({
    items: [],
    liveItems: [],
    nonLiveItems: [],
    counts: { active: 0, total: 0 },
  }),
}));
jest.mock("../useBrandAnalytics", () => ({
  brandAnalyticsKeys: { minglaDrove: (id: string) => ["ba", id] },
  useBrandMinglaDroveRollup: () => ({ data: undefined, isLoading: false, isError: false }),
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../components/brand/BrandDeleteSheet", () => ({ BrandDeleteSheet: () => null }));
jest.mock("../../components/brand/BrandSwitcherSheet", () => ({ BrandSwitcherSheet: () => null }));
jest.mock("../../components/home/BusinessTodoToggle", () => ({ BusinessTodoToggle: () => null }));
jest.mock("../../components/home/AnalyticsHomeTile", () => ({ AnalyticsHomeTile: () => null }));
jest.mock("../../components/home/LiveOfferingCard", () => ({ LiveOfferingCard: () => null }));
jest.mock("../../components/home/RecentRow", () => ({ RecentRow: () => null }));
jest.mock("../../components/home/RecentFullScreen", () => ({ RecentFullScreen: () => null }));
jest.mock("../../components/home/RecentStatePanel", () => ({ RecentStatePanel: () => null }));
jest.mock("../../components/scanners/ScannerHome", () => ({ ScannerHome: () => null }));
jest.mock("../../components/team/InvitePendingSheet", () => ({ InvitePendingSheet: () => null }));
jest.mock("../../components/ui/GlassCard", () => ({ GlassCard: () => null }));
jest.mock("../../components/ui/KpiTile", () => ({ KpiTile: () => null }));
jest.mock("../../components/ui/UniversalCreatorSheet", () => ({ UniversalCreatorSheet: () => null }));

describe("#3345 H — Home renders loading, not the brandless Home, while a brand loads", () => {
  // The REAL `useCurrentBrand` + store + cache from above feed Home.
  const renderHome = (): RendererInstance => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const HomeTab = (require("../../../app/(tabs)/home") as { default: React.FC })
      .default;
    return mount(
      <QueryClientProvider client={queryClient}>
        <HomeTab />
      </QueryClientProvider>,
    );
  };

  test("H-1 selected brand still loading → the loading state, never the brandless list", () => {
    act(() => {
      useCurrentBrandStore.setState({ currentBrandId: BRAND_B.id });
    });
    const home = renderHome();
    expect(byTestId(home, "home-brand-loading").length).toBeGreaterThan(0);
    expect(byTestId(home, "home-mobile-scroll")).toHaveLength(0);
  });

  test("H-2 recovery still choosing a brand → loading too", () => {
    mockRecoveryResolving = true;
    const home = renderHome();
    expect(byTestId(home, "home-brand-loading").length).toBeGreaterThan(0);
  });

  test("H-3 genuinely brandless → the brandless Home, no loading state", () => {
    const home = renderHome();
    expect(byTestId(home, "home-brand-loading")).toHaveLength(0);
    expect(byTestId(home, "home-mobile-scroll").length).toBeGreaterThan(0);
  });
});
