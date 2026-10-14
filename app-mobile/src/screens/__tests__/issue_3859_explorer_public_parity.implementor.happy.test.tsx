/* eslint-disable @typescript-eslint/no-require-imports, import/first, react/display-name */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

type Row = Record<string, unknown>;
type BrandCallbacks = {
  onToggleFollow: () => void;
  onOpenEvent: (row: Row) => void;
  onOpenTrip: (row: Row) => void;
  onOpenExperience: (row: Row) => void;
  onOpenUpcoming: (row: Row) => void;
  onOpenVenue: (row: Row) => void;
};
type BrandShellProps = {
  callbacks: BrandCallbacks;
  venuesLoadState: "loading" | "error" | "ready";
};

const mockRouter = {
  canGoBack: jest.fn(() => false),
  back: jest.fn(),
  replace: jest.fn(),
  push: jest.fn(),
};
const mockShell: { props: BrandShellProps | null } = { props: null };
const mockBrandRefetch = jest.fn();
const mockFollow = jest.fn(() => Promise.resolve());
let mockUser: Row | null = null;
const mockBrandQuery: Row = {
  isLoading: false,
  isFetching: false,
  isError: false,
  isStale: false,
  refetch: mockBrandRefetch,
  data: {
    brand: {
      id: "brand_3859",
      slug: "lantern-room",
      displayName: "Lantern Room",
    },
    events: [],
    trips: [],
    experiences: [],
    upcoming: [],
    upcomingHasMore: false,
    menu: [],
    resolvedTheme: {},
  },
};
const mockVenuesQuery: Row = {
  data: [],
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: jest.fn(),
};

jest.mock("react-native", () => {
  const React = require("react");
  const host =
    (name: string) =>
    (props: { children?: unknown }) =>
      React.createElement(name, props, props.children ?? null);
  return {
    __esModule: true,
    ActivityIndicator: host("ActivityIndicator"),
    Text: host("Text"),
    View: host("View"),
    Alert: { alert: jest.fn() },
    Platform: { OS: "ios" },
    StyleSheet: { create: <T,>(styles: T): T => styles },
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ slug: "lantern-room" }),
}));
jest.mock(
  "@mingla/brand-rendering",
  () => ({
    PublicBrandPage: function PublicBrandPage(props: BrandShellProps) {
      mockShell.props = props;
      return null;
    },
  }),
  { virtual: true },
);
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("../../hooks/useBrandBySlug", () => ({
  useBrandBySlug: () => mockBrandQuery,
  usePublicBrandVenues: () => mockVenuesQuery,
}));
jest.mock("../../hooks/useBrandFollow", () => ({
  brandFollowKeys: {
    status: (brand: string, user: string) => [brand, user],
    list: (user: string) => [user],
  },
  useBrandFollow: () => ({
    isFollowing: false,
    isMuted: false,
    isPending: false,
    mutedUntil: null,
    follow: mockFollow,
  }),
}));
jest.mock("../../hooks/useBrandOfferingSections", () => ({
  useBrandHappeningNow: () => ({ data: [] }),
  useBrandPast: () => ({ rows: [], hasMore: false, loadState: "ready" }),
}));
jest.mock("../../store/appStore", () => ({
  useAppStore: (select: (state: Row) => unknown) => select({ user: mockUser }),
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../services/contentShareAdapter", () => ({
  shareContent: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../components/ui/Toast", () => ({
  toastManager: { show: jest.fn() },
}));
jest.mock("../../components/ui/ToastContainer", () => ({
  ToastContainer: () => null,
}));
jest.mock("../../utils/hapticFeedback", () => ({
  HapticFeedback: { light: jest.fn() },
}));
jest.mock("../../components/profile/BrandFollowOverflowSheet", () => ({
  BrandFollowOverflowSheet: () => null,
}));
jest.mock("../../components/profile/BrandsYouFollowManageSheet", () => ({
  BrandsYouFollowManageSheet: () => null,
}));

import ConsumerBrandProfileScreen from "../ConsumerBrandProfileScreen";
import {
  resolveExplorerContentShareDestination,
  resolveExplorerPublicPath,
} from "../../services/publicParityNativeAdapter";

const appRoot = resolve(__dirname, "../../..");
const read = (relative: string): string =>
  readFileSync(resolve(appRoot, relative), "utf8");

const mountBrand = (): { callbacks: BrandCallbacks; unmount: () => void } => {
  mockShell.props = null;
  let tree: { unmount: () => void } | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<ConsumerBrandProfileScreen />);
  });
  if (mockShell.props === null) {
    throw new Error("brand renderer was not mounted");
  }
  return {
    callbacks: mockShell.props.callbacks,
    unmount: () => TestRenderer.act(() => tree?.unmount()),
  };
};

beforeEach(() => {
  mockRouter.push.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.back.mockReset();
  mockBrandQuery.isLoading = false;
  mockBrandQuery.isFetching = false;
  mockBrandQuery.isError = false;
  mockBrandQuery.isStale = false;
  mockBrandRefetch.mockReset();
  mockFollow.mockClear();
  mockUser = null;
  mockVenuesQuery.data = [];
  mockVenuesQuery.isLoading = false;
  mockVenuesQuery.isFetching = false;
  mockVenuesQuery.isError = false;
});

describe("issue #3859 — Explorer native public-page parity", () => {
  test("the real brand host callbacks keep every Mingla-owned family native", () => {
    const page = mountBrand();

    TestRenderer.act(() => {
      page.callbacks.onOpenEvent({
        id: "event_01",
        eventType: "event",
        brandSlug: "lantern-room",
        eventSlug: "late-night-jazz",
      });
      page.callbacks.onOpenEvent({
        id: "rsvp_01",
        eventType: "rsvp",
        brandSlug: "lantern-room",
        eventSlug: "guest-list-night",
      });
      page.callbacks.onOpenTrip({
        id: "trip_01",
        brandSlug: "lantern-room",
        slug: "cape-town-weekend",
      });
      page.callbacks.onOpenExperience({
        experienceId: "experience_01",
        brandSlug: "lantern-room",
        experienceSlug: "chef-table",
      });
      page.callbacks.onOpenUpcoming({
        offeringId: "experience_02",
        offeringType: "experience",
        brandSlug: "lantern-room",
        offeringSlug: "wine-walk",
      });
      page.callbacks.onOpenUpcoming({
        offeringId: "trip_02",
        offeringType: "trip",
        brandSlug: "lantern-room",
        offeringSlug: "island-weekend",
      });
      page.callbacks.onOpenUpcoming({
        offeringId: "event_02",
        offeringType: "event",
        brandSlug: "lantern-room",
        offeringSlug: "sunday-jazz",
      });
      page.callbacks.onOpenUpcoming({
        offeringId: "rsvp_02",
        offeringType: "rsvp",
        brandSlug: "lantern-room",
        offeringSlug: "roof-guest-list",
      });
      page.callbacks.onOpenVenue({
        id: "venue_01",
        slug: "main-room",
        reservationState: "available",
      });
    });

    expect(mockRouter.push.mock.calls.map(([path]) => path)).toEqual([
      "/e/lantern-room/late-night-jazz",
      "/e/lantern-room/guest-list-night",
      "/t/lantern-room/cape-town-weekend",
      "/exp/lantern-room/chef-table",
      "/exp/lantern-room/wine-walk",
      "/t/lantern-room/island-weekend",
      "/e/lantern-room/sunday-jazz",
      "/e/lantern-room/roof-guest-list",
      "/b/lantern-room/v/main-room?tab=reservations",
    ]);
    page.unmount();
  });

  test("the shared contract validates every native family and fails closed", () => {
    const context = { platform: "android", authState: "signed-in" } as const;
    const uuid = "a0b1c2d3-e4f5-6789-abcd-ef0123456789";
    const opaque = "0f1e2d3c-4b5a-6789-abcd-0123456789ab";
    expect(resolveExplorerPublicPath({ kind: "brand", entityId: "brand_01", brandSlug: "slow-burn" }, context)).toBe("/b/slow-burn");
    expect(resolveExplorerPublicPath({ kind: "venue", entityId: "venue_01", brandSlug: "slow-burn", venueSlug: "lantern-room" }, context)).toBe("/b/slow-burn/v/lantern-room");
    expect(resolveExplorerPublicPath({ kind: "event", entityKind: "rsvp", entityId: "rsvp_01", brandSlug: "slow-burn", eventSlug: "guest-list" }, context)).toBe("/e/slow-burn/guest-list");
    expect(resolveExplorerPublicPath({ kind: "trip", entityId: "trip_01", brandSlug: "slow-burn", tripSlug: "weekend-away" }, context)).toBe("/t/slow-burn/weekend-away");
    expect(resolveExplorerPublicPath({ kind: "experience", entityId: "experience_01", brandSlug: "slow-burn", experienceSlug: "chef-table" }, context)).toBe("/exp/slow-burn/chef-table");
    expect(resolveExplorerPublicPath({ kind: "stay", entityId: uuid, groupId: uuid }, context)).toBe(`/stay/${uuid}`);
    expect(resolveExplorerPublicPath({ kind: "opaque-share", entityId: opaque, shareId: opaque, cardKind: "unresolved" }, context)).toBe(`/p/${opaque}`);
    expect(resolveExplorerPublicPath({ kind: "content-share", entityId: "Aa0Bb1Cc2Dd3Ee4F", code: "Aa0Bb1Cc2Dd3Ee4F", contentKind: "unresolved" }, context)).toBe("/s/Aa0Bb1Cc2Dd3Ee4F");
    expect(resolveExplorerPublicPath({ kind: "brand", entityId: "brand_01", brandSlug: "Unsafe Slug" }, context)).toBeNull();
    expect(resolveExplorerPublicPath({ kind: "brand", entityId: "brand_01", brandSlug: "slow-burn" }, { ...context, platform: "web" })).toBeNull();
    expect(resolveExplorerPublicPath(null as never, context)).toBeNull();
    expect(resolveExplorerPublicPath({ kind: "creator" } as never, context)).toBeNull();
  });

  test("populated brand content remains mounted during refresh and refresh error", () => {
    mockBrandQuery.isLoading = true;
    mockBrandQuery.isFetching = true;
    mockVenuesQuery.data = [{ id: "venue_01" }];
    mockVenuesQuery.isFetching = true;
    let page = mountBrand();
    expect(mockShell.props).not.toBeNull();
    expect(mockShell.props?.venuesLoadState).toBe("ready");
    page.unmount();

    mockBrandQuery.isLoading = false;
    mockBrandQuery.isFetching = false;
    mockBrandQuery.isError = true;
    page = mountBrand();
    expect(mockShell.props).not.toBeNull();
    page.unmount();
  });

  test("a stale Follow action revalidates the canonical brand before writing", async () => {
    mockUser = { id: "user_01" };
    mockBrandQuery.isStale = true;
    mockBrandRefetch.mockResolvedValue({
      isError: false,
      data: mockBrandQuery.data,
    });
    const page = mountBrand();

    await TestRenderer.act(async () => {
      page.callbacks.onToggleFollow();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockBrandRefetch).toHaveBeenCalledTimes(1);
    expect(mockFollow).toHaveBeenCalledTimes(1);
    page.unmount();
  });

  test("/s follows only a server path whose kind and route agree exactly", () => {
    const context = { platform: "ios", authState: "unknown" } as const;
    const code = "Aa0Bb1Cc2Dd3Ee4F";
    expect(resolveExplorerContentShareDestination(code, "event", {
      kind: "event",
      brandSlug: "slow-burn",
      eventSlug: "late-night-jazz",
      webPath: "/e/slow-burn/late-night-jazz",
    }, context)).toBe("/e/slow-burn/late-night-jazz");
    expect(resolveExplorerContentShareDestination(code, "event", {
      kind: "trip",
      brandSlug: "slow-burn",
      eventSlug: "late-night-jazz",
      webPath: "/t/slow-burn/late-night-jazz",
    }, context)).toBeNull();
    expect(resolveExplorerContentShareDestination(code, "event", {
      kind: "event",
      brandSlug: "slow-burn",
      eventSlug: "late-night-jazz",
      webPath: "/t/slow-burn/late-night-jazz",
    }, context)).toBeNull();
    expect(resolveExplorerContentShareDestination("bad", "event", {
      kind: "event",
      brandSlug: "slow-burn",
      eventSlug: "late-night-jazz",
      webPath: "/e/slow-burn/late-night-jazz",
    }, context)).toBeNull();
  });

  test("already-native families and sanctioned external handoffs stay unchanged", () => {
    const brand = read("src/screens/ConsumerBrandProfileScreen.tsx");
    expect(brand).not.toContain("host.usemingla.com");
    expect(brand).not.toContain("openBrowserAsync");

    expect(read("app/e/[brandSlug]/[eventSlug].tsx")).toContain("<ConsumerEventDetailScreen");
    expect(read("app/t/[brandSlug]/[tripSlug].tsx")).toContain("<ConsumerTripDetailScreen");
    expect(read("app/exp/[brandSlug]/[experienceSlug].tsx")).toContain("<ConsumerExperienceDetailScreen");
    expect(read("app/b/[brandSlug]/v/[venueSlug].tsx")).toContain("<PublicVenueScreen");

    const stay = read("app/stay/[groupId].tsx");
    expect(stay).toContain("useStayReservationGroup(groupId)");
    expect(stay).toContain("openBrowserAsync(payment.authorizationUrl)");

    const opaqueShare = read("app/p/[shareId].tsx");
    expect(opaqueShare).toContain("isOpaqueShareId(shareId)");
    expect(opaqueShare).toContain("readSharedCard(shareId)");

    const contentShare = read("app/s/[code].tsx");
    expect(contentShare).toContain("resolveExplorerContentShareDestination(");
    expect(contentShare).toContain("router.replace(path as never)");

    const event = read("src/screens/Event/ConsumerEventDetailScreen.tsx");
    const trip = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
    const experience = read("src/screens/Experience/ConsumerExperienceDetailScreen.tsx");
    expect(event).toContain("router.push(`/b/${slug}` as never)");
    expect(trip).toContain("router.push(`/b/${brandSlug}` as never)");
    expect(experience).toContain("router.push(`/b/${seed.brandSlug}` as never)");
  });
});
