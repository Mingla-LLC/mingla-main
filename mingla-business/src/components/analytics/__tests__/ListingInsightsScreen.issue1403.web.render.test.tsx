import React from "react";

interface RenderNode {
  props: {
    accessibilityLabel?: unknown;
    accessibilityRole?: unknown;
    onPress?: unknown;
  };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

jest.mock("../../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../ui/TopBar", () => {
  const ReactRuntime = require("react");
  const { Text } = require("react-native");
  return {
    TopBar: ({ title }: { title: string }) =>
      ReactRuntime.createElement(Text, null, title),
  };
});
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: true }),
}));
jest.mock("../../../analytics/businessAnalyticsEvents", () => ({
  captureBusinessListingInsightsOpened: jest.fn(),
  captureBusinessListingInsightsRefreshed: jest.fn(),
}));

import { ListingInsightsScreen } from "../ListingInsightsScreen";

describe("issue #1403 Listing Insights wide-web render", () => {
  it("keeps keyboard-reachable refresh and two readable proof cards", async () => {
    const identity = {
      data: {
        id: "listing-web",
        brandId: "brand-web",
        title: "Web Experience",
        listingType: "experience",
        status: "live",
        detailRoute: "/experience/listing-web",
      },
      isError: false,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };
    const rollup = {
      data: {
        eventId: "listing-web",
        authorized: true,
        minglaDroveCount: 0,
        valueCents: {},
        bySource: ["ad", "search", "organic", "social", "direct"].map(
          (source) => ({ source, customers: 0, valueCents: {} }),
        ),
      },
      isError: false,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ListingInsightsScreen
          identity={identity as never}
          rollup={rollup as never}
          entryPoint="direct"
          onBack={jest.fn()}
          onBackToListings={jest.fn()}
        />,
      );
    });
    const refresh = tree!.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Refresh insights" &&
        node.props.accessibilityRole === "button" &&
        typeof node.props.onPress === "function",
    );
    expect(refresh).toHaveLength(1);
    expect(refresh[0].props.accessibilityRole).toBe("button");
    expect(typeof refresh[0].props.onPress).toBe("function");
    expect(
      tree!.root.findAll(
        (node) => node.props.accessibilityRole === "header",
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });
});
