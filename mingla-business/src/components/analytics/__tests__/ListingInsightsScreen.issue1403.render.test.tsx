import React from "react";

interface RenderNode {
  props: {
    children?: unknown;
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
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../analytics/businessAnalyticsEvents", () => ({
  captureBusinessListingInsightsOpened: jest.fn(),
  captureBusinessListingInsightsRefreshed: jest.fn(),
}));

import { ListingInsightsScreen } from "../ListingInsightsScreen";

const identity = {
  data: {
    id: "listing-1403",
    brandId: "brand-1403",
    title: "Summer Table",
    listingType: "event",
    status: "live",
    detailRoute: "/event/listing-1403",
  },
  isError: false,
  isLoading: false,
  error: null,
  refetch: jest.fn(),
};

const rollup: {
  data: {
    eventId: string;
    authorized: boolean;
    minglaDroveCount: number;
    valueCents: Record<string, number>;
    bySource: {
      source: string;
      customers: number;
      valueCents: Record<string, number>;
    }[];
  };
  isError: boolean;
  isLoading: boolean;
  error: null;
  refetch: jest.Mock;
} = {
  data: {
    eventId: "listing-1403",
    authorized: true,
    minglaDroveCount: 2,
    valueCents: { GBP: 1200, USD: 2500 },
    bySource: [
      { source: "ad", customers: 1, valueCents: { GBP: 1200 } },
      { source: "search", customers: 0, valueCents: {} },
      { source: "organic", customers: 1, valueCents: { USD: 2500 } },
      { source: "social", customers: 0, valueCents: {} },
      { source: "direct", customers: 0, valueCents: {} },
    ],
  },
  isError: false,
  isLoading: false,
  error: null,
  refetch: jest.fn(),
};

describe("issue #1403 Listing Insights native render", () => {
  const allText = (tree: RenderTree): string =>
    tree.root
      .findAll((node) => typeof node.props.children === "string")
      .map((node) => String(node.props.children))
      .join(" ");

  it("renders canonical identity, server total, separate currencies and all sources", async () => {
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ListingInsightsScreen
          identity={identity as never}
          rollup={rollup as never}
          entryPoint="detail_action"
          onBack={jest.fn()}
          onBackToListings={jest.fn()}
        />,
      );
    });
    const output = allText(tree!);
    expect(output).toContain("Summer Table");
    expect(output).toContain("Mingla drove 2 customers for this listing");
    expect(output).toContain("£12.00 booking value");
    expect(output).toContain("$25.00 booking value");
    expect(output).toContain("Ads");
    expect(output).toContain("Search / SEO");
    expect(output).toContain("Mingla discovery");
    expect(output).toContain("Social");
    expect(output).toContain("Direct link");
    expect(output).not.toMatch(/platform|campaign|attendee|attendance/i);
  });

  it("renders authorized zero as useful data, not an error", async () => {
    const zero = {
      ...rollup,
      data: {
        ...rollup.data,
        minglaDroveCount: 0,
        valueCents: {},
        bySource: rollup.data.bySource.map((row: {
          source: string;
          customers: number;
          valueCents: Record<string, number>;
        }) => ({
          ...row,
          customers: 0,
          valueCents: {},
        })),
      },
    };
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ListingInsightsScreen
          identity={identity as never}
          rollup={zero as never}
          entryPoint="direct"
          onBack={jest.fn()}
          onBackToListings={jest.fn()}
        />,
      );
    });
    const output = allText(tree!);
    expect(output).toContain("Mingla drove 0 customers for this listing");
    expect(output).toContain("No paid booking value yet");
    expect(output).toContain("No source mix yet");
    expect(output).not.toContain("Couldn't load");
  });
});
