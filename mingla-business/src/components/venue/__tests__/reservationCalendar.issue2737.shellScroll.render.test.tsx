/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { StyleSheet, View } from "react-native";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import type { Reservation } from "../../../types/venueReservation";
import { venueScrollBottomPad } from "../venueShellScroll";
import { VenueSuiteShell } from "../VenueSuiteShell";

let mockWideDesktop = false;

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: mockWideDesktop }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 60 }),
}));
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  useVenueReservationSettings: () => ({
    data: { reservationsEnabled: true },
    isLoading: false,
    isError: false,
  }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../store/venueSuiteStore", () => ({
  useVenueSuiteStore: (selector: (state: { sync: jest.Mock }) => unknown) =>
    selector({ sync: jest.fn() }),
}));
jest.mock("../../../hooks/useVenueReservations", () => ({
  useVenueReservations: () => ({
    data: [
      mockReservation("one", "2026-08-27T13:00:00.000Z"),
      mockReservation("two", "2026-08-28T14:00:00.000Z"),
      mockReservation("three", "2026-08-29T15:00:00.000Z"),
    ],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
  useCreateReservation: () => ({ mutate: jest.fn(), isPending: false }),
  useTransitionReservation: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../hooks/useVenueTables", () => ({
  useVenueTables: () => ({ data: [], isLoading: false, isError: false }),
}));
jest.mock("../../../hooks/useVenueAvailability", () => ({
  useVenueAvailabilityConfig: () => ({
    data: { ianaTimezone: "Africa/Lagos" },
    isLoading: false,
    isError: false,
  }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = require("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView, default: RN.ScrollView };
});

function mockStub(testID: string): () => React.ReactElement {
  return function Stub(): React.ReactElement {
    return <View testID={testID} />;
  };
}

jest.mock("../VenueIntelligenceModule", () => ({
  VenueIntelligenceModule: mockStub("venue-intelligence-stub"),
}));
jest.mock("../VenueMenuModule", () => ({ VenueMenuModule: mockStub("venue-menu-stub") }));
jest.mock("../VenueSettingsModule", () => ({
  VenueSettingsModule: mockStub("venue-settings-stub"),
}));
jest.mock("../VenueTablesModule", () => ({ VenueTablesModule: mockStub("venue-tables-stub") }));
jest.mock("../VenueWaitlistModule", () => ({ VenueWaitlistModule: mockStub("venue-waitlist-stub") }));
jest.mock("../VenueAvailabilityModule", () => ({
  VenueAvailabilityModule: mockStub("venue-availability-stub"),
}));
jest.mock("../VenueOrdersModule", () => ({ VenueOrdersModule: mockStub("venue-orders-stub") }));
jest.mock("../insights/VenueInsightsModule", () => ({
  VenueInsightsModule: mockStub("venue-insights-stub"),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => {
    const ReactRuntime = require("react") as typeof React;
    const RN = require("react-native") as typeof import("react-native");
    return ReactRuntime.createElement(RN.View, { testID }, children);
  },
}));
jest.mock("../../ui/Button", () => ({
  Button: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => {
    const ReactRuntime = require("react") as typeof React;
    const RN = require("react-native") as typeof import("react-native");
    return ReactRuntime.createElement(
      RN.Pressable,
      { onPress, testID },
      ReactRuntime.createElement(RN.Text, null, label),
    );
  },
}));
jest.mock("../ReservationCreateSheet", () => ({ ReservationCreateSheet: () => null }));
jest.mock("../ReservationDetailSheet", () => ({ ReservationDetailSheet: () => null }));
jest.mock("lucide-react-native", () => {
  const ReactRuntime = require("react") as typeof React;
  const Icon = (props: Record<string, unknown>): React.ReactElement =>
    ReactRuntime.createElement("MockIcon", props);
  return {
    AlertTriangle: Icon,
    Calendar: Icon,
    Check: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
  };
});

// @ts-expect-error react-test-renderer ships without declarations in this workspace.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

function mockReservation(id: string, reservedFor: string): Reservation {
  return {
    id,
    brandId: "brand",
    venueId: "venue",
    placePoolId: null,
    tableId: null,
    reservedFor,
    partySize: 2,
    status: "confirmed",
    source: "mingla",
    createdVia: "consumer",
    guestName: `Guest ${id}`,
    guestPhoneE164: null,
    guestEmail: null,
    consumerUserId: null,
    occasion: null,
    guestNotes: null,
    tags: [],
    feeCents: null,
    feeCurrency: null,
    paymentStatus: "none",
    createdAt: "2026-08-01T00:00:00.000Z",
    refund: null,
  };
}

function interactive(root: ReactTestInstance, testID: string): ReactTestInstance {
  return (
    root
      .findAllByProps({ testID })
      .find((node: ReactTestInstance) => typeof node.props.onPress === "function") ??
    root.findByProps({ testID })
  );
}

async function renderShell(): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <VenueSuiteShell brandId="brand" venueId="venue" initialModule="reservations" />,
    );
  });
  if (tree === null) throw new Error("shell_context_render_missing");
  return tree;
}

function flattenedPaddingBottom(node: ReactTestInstance): number | undefined {
  const flattened = StyleSheet.flatten(node.props.contentContainerStyle) as
    | { paddingBottom?: number }
    | undefined;
  return flattened?.paddingBottom;
}

describe("issue #2737 reservation calendar production shell scroll ownership", () => {
  beforeEach(() => {
    mockWideDesktop = false;
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders phone Agenda with one sticky SectionList owner and no nested-list warning", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    let tree: ReactTestRenderer | null = null;
    try {
      tree = await renderShell();
      const messages = [...error.mock.calls, ...warn.mock.calls]
        .flat()
        .map(String)
        .join("\n");
      expect(messages).not.toContain("VirtualizedLists should never be nested");
      expect(tree.root.findAllByProps({ testID: "venue-suite-shell-phone-scroll" })).toHaveLength(0);
      const agenda = tree.root.findByProps({ testID: "reservation-calendar-agenda" });
      expect(agenda.props.stickySectionHeadersEnabled).toBe(true);
      expect(agenda.props.nestedScrollEnabled).toBeUndefined();
      expect(flattenedPaddingBottom(agenda)).toBe(venueScrollBottomPad(34) + 24);
      const style = StyleSheet.flatten(agenda.props.style) as { maxHeight?: number };
      expect(style.maxHeight).toBeUndefined();
    } finally {
      tree?.unmount();
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("keeps wide Agenda unwrapped and Week/Month vertically reachable with shell clearance", async () => {
    mockWideDesktop = true;
    const tree = await renderShell();
    const weekScrolls = tree.root.findAllByProps({ testID: "reservation-calendar-mode-scroll" });
    expect(weekScrolls.length).toBeGreaterThan(0);
    expect(
      flattenedPaddingBottom(weekScrolls[0]),
    ).toBe(venueScrollBottomPad(34) + 24);

    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-mode-month").props.onPress();
    });
    const monthScrolls = tree.root.findAllByProps({ testID: "reservation-calendar-mode-scroll" });
    expect(monthScrolls.length).toBeGreaterThan(0);
    expect(flattenedPaddingBottom(monthScrolls[0])).toBe(venueScrollBottomPad(34) + 24);

    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-mode-agenda").props.onPress();
    });
    const agenda = tree.root.findByProps({ testID: "reservation-calendar-agenda" });
    expect(agenda.props.stickySectionHeadersEnabled).toBe(true);
    expect(tree.root.findAllByProps({ testID: "reservation-calendar-mode-scroll" })).toHaveLength(0);
    await TestRenderer.act(async () => {
      tree.unmount();
    });
  });
});
