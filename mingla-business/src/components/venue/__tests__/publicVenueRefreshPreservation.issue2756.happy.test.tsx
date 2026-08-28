/**
 * Issue #2756 — both REAL public venue route adapters keep the shared screen
 * mounted through ready → background fetch → stale error → retry → ready.
 * Append-only implementor happy-path guard.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import { classifyPublicVenueRouteState } from "@mingla/brand-rendering/publicVenueRefreshState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL = "https://host.usemingla.com";

interface QueryState {
  data: Record<string, unknown> | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  errorUpdatedAt: number;
  refetch: jest.Mock<() => Promise<unknown>>;
}

const resolvedRefetch = jest.fn<() => Promise<unknown>>(async () => undefined);
const buyerQuery: { current: QueryState } = {
  current: {
    data: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    errorUpdatedAt: 0,
    refetch: resolvedRefetch,
  },
};
const consumerQuery: { current: QueryState } = {
  current: { ...buyerQuery.current, refetch: resolvedRefetch },
};

const params = { brandSlug: "gogilagos", venueSlug: "gogi", tab: undefined };
const analytics: string[] = [];
const diagnostics: string[] = [];
let buyerBookingMounts = 0;
let buyerBookingUnmounts = 0;
let consumerSheetMounts = 0;
let consumerSheetUnmounts = 0;

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => params,
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
    canGoBack: () => true,
  }),
}));
jest.mock("expo-router/head", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("HeadStub", null, children),
}));
jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@mingla/offering-rendering", () => {
  const themeResolver = require("../../../../../packages/offering-rendering/themeResolver");
  const themePalette = require("../../../../../packages/offering-rendering/themePalette");
  return {
    __esModule: true,
    ...themeResolver,
    ...themePalette,
    ParallaxCoverShell: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("ParallaxCoverShell", null, children),
    buildStaticMapUrl: () => null,
    normalizeMapsGeo: () => null,
    canOpenMapsTarget: () => false,
    useResponsiveLayout: () => ({
      width: 390,
      isDesktop: false,
      isPhone: true,
      isWeb: true,
    }),
    useVenueMapsActions: () => ({ requestOpenMaps: () => undefined }),
    VenueCopyAddressButton: () => null,
    MapsAppChooserDialog: () => null,
  };
});

jest.mock("../../../hooks/usePublicEvents", () => ({
  __esModule: true,
  usePublicVenueBySlug: () => buyerQuery.current,
  usePublicVenueReservable: () => ({
    data: { reservable: true, venueId: "venue-1", currency: "NGN" },
    isLoading: false,
    isError: false,
    error: null,
    refetch: resolvedRefetch,
  }),
  usePublicVenueDiscoveryPrice: () => ({ data: null }),
  usePublicBrandBySlug: () => ({ data: null }),
}));
jest.mock("../../../hooks/useMenus", () => ({
  __esModule: true,
  usePublicMenus: () => ({ data: [] }),
}));
jest.mock("../../../hooks/usePublicStayDetail", () => ({
  __esModule: true,
  usePublicStayDetail: () => ({ data: null, isLoading: false, isError: false }),
}));
jest.mock("../../../theme/useThemeFont", () => ({
  __esModule: true,
  useThemeFont: () => undefined,
}));
jest.mock("../../../analytics/webAnalytics", () => ({
  __esModule: true,
  captureWeb: (name: string) => analytics.push(`buyer:${name}`),
  captureAdClickIds: () => undefined,
}));
jest.mock("../../../services/venueOrganicCaptureService", () => ({
  __esModule: true,
  captureVenueOrganicEvent: async () => undefined,
  settleVenueOrganicJourneyOnConsent: () => () => undefined,
}));
jest.mock("../../../services/venueOrganicCapturePolicy", () => ({
  __esModule: true,
  runBuyerVenueOrganicCapture: (_surface: string, run: () => void) => run(),
  settleBuyerVenueOrganicCapture: () => () => undefined,
}));
jest.mock("../../../diagnostics/reportNonFatal", () => ({
  __esModule: true,
  reportNonFatal: (scope: string) => diagnostics.push(`buyer:${scope}`),
}));
jest.mock("../../../utils/openMapsTarget", () => ({ openMapsTarget: () => undefined }));
jest.mock("../../../utils/copyAddressText", () => ({ copyAddressText: async () => undefined }));
jest.mock("../../../utils/shareCanonicalPublicPageOnWeb", () => ({
  shareCanonicalPublicPageOnWeb: async () => undefined,
}));
jest.mock("../../ui/ShareModal", () => ({ ShareModal: () => null }));
jest.mock("../PublicVenueNotFound", () => ({ PublicVenueNotFound: () => null }));
jest.mock("../PublicVenueReservationSheet", () => ({
  PublicVenueReservationSheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    React.createElement("PublicVenueReservationSheetStub", { visible }, children),
}));
jest.mock("../GuestVenueReservation", () => ({
  GuestVenueReservation: () => {
    React.useEffect(() => {
      buyerBookingMounts += 1;
      return () => {
        buyerBookingUnmounts += 1;
      };
    }, []);
    return React.createElement("GuestVenueReservationStub");
  },
}));
jest.mock("../../stay/BuyerStayGuestExperience", () => ({
  BuyerStayGuestExperience: () => null,
}));

jest.mock("../../../../../app-mobile/src/hooks/usePublicVenue", () => ({
  __esModule: true,
  usePublicVenue: () => consumerQuery.current,
}));
jest.mock("../../../../../app-mobile/src/hooks/useStayGuest", () => ({
  __esModule: true,
  usePublicStayDetail: () => ({ data: null, isLoading: false, isError: false }),
}));
jest.mock("../../../../../app-mobile/src/theme/useConsumerThemeFont", () => ({
  __esModule: true,
  useConsumerThemeFont: () => undefined,
}));
jest.mock("../../../../../app-mobile/src/services/postHogService", () => ({
  __esModule: true,
  postHogService: { capture: (name: string) => analytics.push(`consumer:${name}`) },
}));
jest.mock("../../../../../app-mobile/src/services/venueOrganicCaptureService", () => ({
  __esModule: true,
  captureVenueOrganicEvent: async () => undefined,
}));
jest.mock("../../../../../app-mobile/src/services/nativeAdAttributionService", () => ({
  __esModule: true,
  captureNativeStayRouteAttribution: async () => undefined,
}));
jest.mock("../../../../../app-mobile/src/services/contentShareAdapter", () => ({
  __esModule: true,
  shareContent: async () => undefined,
}));
jest.mock("../../../../../app-mobile/src/diagnostics/reportNonFatal", () => ({
  __esModule: true,
  reportNonFatal: (scope: string) => diagnostics.push(`consumer:${scope}`),
}));
jest.mock("../../../../../app-mobile/src/utils/openMapsTarget", () => ({ openMapsTarget: () => undefined }));
jest.mock("../../../../../app-mobile/src/utils/copyAddressText", () => ({ copyAddressText: async () => undefined }));
jest.mock("../../../../../app-mobile/src/components/expandedCard/VenueReserveSheet", () => ({
  VenueReserveSheet: (props: Record<string, unknown>) => {
    React.useEffect(() => {
      consumerSheetMounts += 1;
      return () => {
        consumerSheetUnmounts += 1;
      };
    }, []);
    return React.createElement("VenueReserveSheetStub", props);
  },
}));
jest.mock("../../../../../app-mobile/src/components/stay/ConsumerStayGuestExperience", () => ({
  ConsumerStayGuestExperience: () => null,
}));

const businessVenue = (name = "Gogi"): Record<string, unknown> => ({
  id: "venue-1",
  brandId: "brand-1",
  brandSlug: "gogilagos",
  brandName: "Gogi Lagos",
  slug: "gogi",
  name,
  address: null,
  city: "Lagos",
  lat: 6.4281,
  lng: 3.4219,
  venueCategory: "restaurant",
  coverMediaUrl: null,
  coverMediaType: null,
  theme: { color: "#ba5d18", font: "inter", animation: null },
  hours: [],
  timezone: "Africa/Lagos",
  galleryPhotoUrls: [],
  pitch: null,
  placePoolId: "place-1",
});
const consumerVenue = (name = "Gogi"): Record<string, unknown> => ({
  ...businessVenue(name),
  menu: [],
  menuWindows: {},
  discoveryPrice: null,
  reservability: { state: "available", venueId: "venue-1", currency: "NGN" },
});

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
}
interface RenderTree {
  root: { findAll: (predicate: (node: TestNode) => boolean) => TestNode[] };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (run: () => void | Promise<void>) => Promise<void>;
};

const findControl = (tree: RenderTree, label: string): TestNode => {
  const node = tree.root.findAll(
    (candidate) => candidate.props.accessibilityLabel === label,
  )[0];
  if (node === undefined) throw new Error(`missing control: ${label}`);
  return node;
};
const textCount = (tree: RenderTree, text: string): number =>
  tree.root.findAll((node) => node.props.children === text).length;
const selectedReservations = (tree: RenderTree): boolean =>
  findControl(tree, "Reservations").props.accessibilityState !== undefined &&
  (findControl(tree, "Reservations").props.accessibilityState as { selected?: boolean }).selected === true;

type RouteKind = "buyer" | "consumer";
const routeFor = (kind: RouteKind): React.ComponentType => {
  const module = kind === "buyer"
    ? require("../../../../app/b/[brandSlug]/v/[venueSlug]")
    : require("../../../../../app-mobile/app/b/[brandSlug]/v/[venueSlug]");
  return (module.default ?? module) as React.ComponentType;
};

const exerciseRefresh = async (kind: RouteKind): Promise<void> => {
  const holder = kind === "buyer" ? buyerQuery : consumerQuery;
  const venueFactory = kind === "buyer" ? businessVenue : consumerVenue;
  let resolveRetry!: () => void;
  const retryPromise = new Promise<void>((resolve) => {
    resolveRetry = resolve;
  });
  const refetch = jest.fn<() => Promise<unknown>>(() => retryPromise);
  holder.current = {
    data: venueFactory(),
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    errorUpdatedAt: 0,
    refetch,
  };
  const Route = routeFor(kind);
  let tree!: RenderTree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(React.createElement(Route));
  });
  await TestRenderer.act(async () => {
    (findControl(tree, "Reserve a table").props.onPress as () => void)();
  });
  expect(selectedReservations(tree)).toBe(true);
  const mountCount = kind === "buyer" ? buyerBookingMounts : consumerSheetMounts;
  const analyticsBefore = analytics.length;

  holder.current = { ...holder.current, isFetching: true };
  await TestRenderer.act(async () => tree.update(React.createElement(Route)));
  expect(textCount(tree, "Loading venue...") + textCount(tree, "Loading venue…")).toBe(0);
  expect(selectedReservations(tree)).toBe(true);

  holder.current = {
    ...holder.current,
    isFetching: false,
    isError: true,
    error: new TypeError("offline fixture"),
    errorUpdatedAt: 100,
  };
  await TestRenderer.act(async () => tree.update(React.createElement(Route)));
  expect(textCount(tree, "Couldn’t refresh venue. Showing the last update.")).toBeGreaterThan(0);
  expect(selectedReservations(tree)).toBe(true);
  const retry = findControl(tree, "Try refreshing venue again");
  await TestRenderer.act(async () => {
    (retry.props.onPress as () => void)();
    (retry.props.onPress as () => void)();
  });
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(textCount(tree, "Trying…")).toBeGreaterThan(0);

  holder.current = {
    ...holder.current,
    data: venueFactory("Gogi refreshed"),
    isFetching: false,
    isError: false,
    error: null,
  };
  await TestRenderer.act(async () => {
    tree.update(React.createElement(Route));
    resolveRetry();
    await retryPromise;
  });
  expect(textCount(tree, "Gogi refreshed")).toBeGreaterThan(0);
  expect(textCount(tree, "Couldn’t refresh venue. Showing the last update.")).toBe(0);
  expect(selectedReservations(tree)).toBe(true);
  expect(kind === "buyer" ? buyerBookingMounts : consumerSheetMounts).toBe(mountCount);
  expect(kind === "buyer" ? buyerBookingUnmounts : consumerSheetUnmounts).toBe(0);
  expect(analytics).toHaveLength(analyticsBefore);
  expect(diagnostics.filter((entry) => entry.startsWith(kind))).toHaveLength(1);
  await TestRenderer.act(async () => tree.unmount());
};

const exerciseColdStates = async (kind: RouteKind): Promise<void> => {
  const holder = kind === "buyer" ? buyerQuery : consumerQuery;
  const refetch = jest.fn<() => Promise<unknown>>(async () => undefined);
  holder.current = {
    data: null,
    isLoading: true,
    isFetching: true,
    isError: false,
    error: null,
    errorUpdatedAt: 0,
    refetch,
  };
  const Route = routeFor(kind);
  let tree!: RenderTree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(React.createElement(Route));
  });
  expect(
    textCount(tree, "Loading venue...") + textCount(tree, "Loading venue…"),
  ).toBeGreaterThan(0);

  holder.current = {
    ...holder.current,
    isLoading: false,
    isFetching: false,
    isError: true,
    error: new TypeError("offline fixture"),
    errorUpdatedAt: 200,
  };
  await TestRenderer.act(async () => tree.update(React.createElement(Route)));
  expect(textCount(tree, "This venue could not load")).toBeGreaterThan(0);
  const retry = findControl(tree, "Try loading the venue again");
  await TestRenderer.act(async () => {
    (retry.props.onPress as () => void)();
    (retry.props.onPress as () => void)();
  });
  expect(refetch).toHaveBeenCalledTimes(1);
  await TestRenderer.act(async () => tree.unmount());
};

describe("#2756 public venue background refresh preservation", () => {
  test("the route-state matrix blocks only cold no-data states", () => {
    expect(classifyPublicVenueRouteState({ hasData: true, isLoading: false, isFetching: true, isError: false })).toBe("populated-refreshing");
    expect(classifyPublicVenueRouteState({ hasData: true, isLoading: false, isFetching: false, isError: true })).toBe("populated-error");
    expect(classifyPublicVenueRouteState({ hasData: false, isLoading: false, isFetching: true, isError: false })).toBe("cold-loading");
    expect(classifyPublicVenueRouteState({ hasData: false, isLoading: false, isFetching: false, isError: true })).toBe("cold-error");
  });

  test("Buyer keeps Reservations, the sheet, child identity and analytics through refresh/retry", async () => {
    await exerciseRefresh("buyer");
  });

  test("Consumer keeps Reservations, the sheet, child identity and analytics through refresh/retry", async () => {
    await exerciseRefresh("consumer");
  });

  test("Buyer preserves cold loading and exposes one guarded cold-error retry", async () => {
    await exerciseColdStates("buyer");
  });

  test("Consumer preserves cold loading and exposes one guarded cold-error retry", async () => {
    await exerciseColdStates("consumer");
  });
});
