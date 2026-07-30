import React from "react";
import {
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { canvas } from "../../../constants/designSystem";
import { SafeScreen } from "../../ui/SafeScreen";
import { ListingInsightsScreen } from "../ListingInsightsScreen";
import ListingInsightsRoute from "../../../../app/insights/[id]";

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      id: "550e8400-e29b-41d4-a716-446655440000",
      brandId: "brand-1420",
      title: "Dark Canvas Listing",
      listingType: "event",
      status: "live",
      detailRoute: "/event/550e8400-e29b-41d4-a716-446655440000",
    },
    isError: false,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({
    id: "550e8400-e29b-41d4-a716-446655440000",
    entry: "direct",
  }),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => false,
    replace: jest.fn(),
  }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ id: "brand-1420" }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    isLoading: false,
    isError: false,
    role: "owner",
    rank: "owner",
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandHasHydrated: () => true,
  useCurrentBrandId: () => "brand-1420",
}));
jest.mock("../../../hooks/useListingInsights", () => ({
  listingInsightsKeys: {
    disabledIdentity: ["listing-insights", "disabled"],
    identity: (id: string) => ["listing-insights", "identity", id],
  },
  useListingInsights: () => ({
    rollup: {
      data: {
        authorized: true,
        eventId: "550e8400-e29b-41d4-a716-446655440000",
        minglaDroveCount: 0,
        valueCents: {},
        bySource: [],
      },
      isError: false,
      isLoading: false,
      error: null,
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
  ListingInsightsScreen: () => React.createElement("ListingInsightsScreen"),
}));
jest.mock("../../ui/SafeScreen", () => ({
  SafeScreen: ({
    children,
    style,
  }: {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
  }) => React.createElement("SafeScreen", { style }, children),
}));

interface RouteElementProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

describe("issue #1420 listing Insights route canvas", () => {
  it("owns the canonical dark canvas at the outer SafeScreen boundary", () => {
    const route = ListingInsightsRoute() as React.ReactElement<RouteElementProps>;
    const child = React.Children.only(
      route.props.children,
    ) as React.ReactElement;

    expect(
      StyleSheet.flatten(route.props.style),
    ).toEqual({
      flex: 1,
      backgroundColor: canvas.discover,
    });
    expect(route.type).toBe(SafeScreen);
    expect(child.type).toBe(ListingInsightsScreen);
  });
});
