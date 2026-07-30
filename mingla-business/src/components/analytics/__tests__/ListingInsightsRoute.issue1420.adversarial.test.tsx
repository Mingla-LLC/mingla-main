import React from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { canvas } from "../../../constants/designSystem";
import ListingInsightsRoute from "../../../../app/insights/[id]";

const LISTING_ID = "550e8400-e29b-41d4-a716-446655440000";

interface RenderNode {
  props: {
    style?: StyleProp<ViewStyle>;
    testID?: string;
  };
  parent: RenderNode | null;
}

interface RenderTree {
  root: {
    findByProps: (props: Record<string, unknown>) => RenderNode;
  };
  unmount: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void) => void;
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface RouteScenario {
  id: string | undefined;
  authReady: boolean;
  hydrated: boolean;
  brandId: string | null;
  role: "owner" | null;
  roleError: boolean;
  identity:
    | {
        id: string;
        brandId: string;
        title: string;
        listingType: "event";
        status: string;
        detailRoute: string;
      }
    | undefined;
  identityError: boolean;
  rollupError: boolean;
}

const scenario: RouteScenario = {
  id: LISTING_ID,
  authReady: true,
  hydrated: true,
  brandId: "brand-1420",
  role: "owner",
  roleError: false,
  identity: {
    id: LISTING_ID,
    brandId: "brand-1420",
    title: "Dark Canvas Listing",
    listingType: "event",
    status: "live",
    detailRoute: `/event/${LISTING_ID}`,
  },
  identityError: false,
  rollupError: false,
};

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 17, right: 0, bottom: 19, left: 0 }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: scenario.identity,
    isError: scenario.identityError,
    isLoading: scenario.identity === undefined && !scenario.identityError,
    error: scenario.identityError ? new Error("identity failed") : null,
    refetch: jest.fn(),
  }),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: scenario.id, entry: "direct" }),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => false,
    replace: jest.fn(),
  }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: scenario.authReady }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () =>
    scenario.brandId === null ? null : { id: scenario.brandId },
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    isLoading: scenario.role === null && !scenario.roleError,
    isError: scenario.roleError,
    role: scenario.role,
    rank: scenario.role,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandHasHydrated: () => scenario.hydrated,
  useCurrentBrandId: () => scenario.brandId,
}));
jest.mock("../../../hooks/useListingInsights", () => ({
  listingInsightsKeys: {
    disabledIdentity: ["listing-insights", "disabled"],
    identity: (id: string) => ["listing-insights", "identity", id],
  },
  useListingInsights: () => ({
    rollup: {
      data: scenario.rollupError
        ? undefined
        : {
            authorized: true,
            eventId: LISTING_ID,
            minglaDroveCount: 0,
            valueCents: {},
            bySource: [],
          },
      isError: scenario.rollupError,
      isLoading: false,
      error: scenario.rollupError ? new Error("rollup failed") : null,
      refetch: jest.fn(),
    },
  }),
}));
jest.mock("../../../services/listingInsightsService", () => ({
  fetchListingInsightsIdentity: jest.fn(),
}));
jest.mock("../../../utils/navTabGate", () => ({
  isScannerOnlyRank: () => false,
}));
jest.mock("../../../analytics/businessAnalyticsEvents", () => ({
  sanitizeBusinessListingInsightsEntryPoint: () => "direct",
}));
jest.mock("../ListingInsightsScreen", () => ({
  ListingInsightsScreen: () =>
    React.createElement(View, { testID: "listing-insights-content" }),
}));

const resetScenario = (): void => {
  Object.assign(scenario, {
    id: LISTING_ID,
    authReady: true,
    hydrated: true,
    brandId: "brand-1420",
    role: "owner",
    roleError: false,
    identity: {
      id: LISTING_ID,
      brandId: "brand-1420",
      title: "Dark Canvas Listing",
      listingType: "event",
      status: "live",
      detailRoute: `/event/${LISTING_ID}`,
    },
    identityError: false,
    rollupError: false,
  } satisfies RouteScenario);
};

const renderedRouteStyle = (
  overrides: Partial<RouteScenario>,
): ViewStyle => {
  resetScenario();
  Object.assign(scenario, overrides);
  let tree: RenderTree | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<ListingInsightsRoute />);
  });
  const content = tree!.root.findByProps({
    testID: "listing-insights-content",
  });
  const ancestors: RenderNode[] = [];
  for (let node = content.parent; node !== null; node = node.parent) {
    ancestors.push(node);
  }
  const routeCanvasOwners = ancestors
    .map((node) =>
      StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>),
    )
    .filter((style) => style?.backgroundColor !== undefined);

  expect(routeCanvasOwners.length).toBeGreaterThan(0);
  expect(
    new Set(routeCanvasOwners.map((style) => style.backgroundColor)),
  ).toEqual(new Set([canvas.discover]));
  const style = routeCanvasOwners[0] ?? {};
  TestRenderer.act(() => {
    tree!.unmount();
  });
  return style;
};

describe("issue #1420 adversarial route-state canvas ownership", () => {
  it.each([
    ["brand hydration", { hydrated: false, brandId: null, identity: undefined }],
    ["malformed route", { id: "not-a-uuid", identity: undefined }],
    ["membership error", { role: null, roleError: true, identity: undefined }],
    ["identity failure", { identity: undefined, identityError: true }],
    ["rollup failure", { rollupError: true }],
    ["authorized zero", {}],
  ] satisfies readonly [string, Partial<RouteScenario>][])(
    "keeps the outer safe-screen opaque during %s",
    (_state, overrides) => {
      const style = renderedRouteStyle(overrides);

      expect(style?.flex).toBe(1);
      expect(style?.backgroundColor).toBe(canvas.discover);
      expect(style?.backgroundColor).not.toBe("transparent");
      expect(style?.backgroundColor).not.toBe("rgb(242, 242, 242)");
    },
  );
});
