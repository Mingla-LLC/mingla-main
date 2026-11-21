/**
 * #4490 R4J-N20 / N25 — VenueReservationsModule hosted where its own chrome
 * cannot fit (the Stay workspace on a phone: a pill band of ~314 px sits above
 * it, and the Agenda list measured 0 px tall at 390x844).
 *
 * `chromeScrollsWithList` moves the heading, calendar toolbar, view switch and
 * banners INSIDE the one scroll owner (the Agenda SectionList's list header,
 * or the first child of the mode ScrollView), so the list always scrolls into
 * view and there is still exactly one vertical scroller (#2737: never a nested
 * list). `title` lets the Stay call the screen "Table reservations".
 *
 * What this proves: the element tree (where the chrome renders, which
 * scroller owns it, bottom clearance, heading text, no nested-list warning).
 * What it cannot prove: react-test-renderer has no layout engine, so the
 * painted list height at 390x844 remains a browser check.
 *
 * Mocks follow reservationCalendar.issue2737.shellScroll (same config), plus
 * the two #4490 hooks the module now reads (features, brand currency).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";

jest.mock("../../../hooks/useMyVenueAccess", () => ({
  useMyVenueAccess: () => ({
    data: { scoped: false, capabilities: [] },
    isFetched: true,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
}));
import { StyleSheet, View } from "react-native";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import type { Reservation } from "../../../types/venueReservation";
import { VenueReservationsModule } from "../VenueReservationsModule";

let mockWideDesktop = false;

// [TEST-MOD-APPROVED #3655] Suite leave beforeRemove uses expo-router
// useNavigation; this render config does not transform @react-navigation ESM.
jest.mock("expo-router", () => ({
  useNavigation: () => ({
    addListener: () => () => undefined,
  }),
}));
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
jest.mock("../../../hooks/useVenueFeatures", () => ({
  useVenueFeatures: () => ({ data: undefined, isLoading: false, isError: false }),
}));
jest.mock("../../../hooks/useBrandCurrency", () => ({
  useBrandCurrency: () => ({ currencyCode: "NGN", data: { currencyCode: "NGN" } }),
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

function flattenedPaddingBottom(node: ReactTestInstance): number | undefined {
  const flattened = StyleSheet.flatten(node.props.contentContainerStyle) as
    | { paddingBottom?: number }
    | undefined;
  return flattened?.paddingBottom;
}

async function renderModule(
  props: Partial<React.ComponentProps<typeof VenueReservationsModule>>,
): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <VenueReservationsModule brandId="brand" venueId="venue" {...props} />,
    );
  });
  if (tree === null) throw new Error("module_render_missing");
  return tree;
}

const textIn = (node: ReactTestInstance, value: string): ReactTestInstance[] =>
  node.findAll((n: ReactTestInstance) => n.props.children === value);

describe("issue #4490 R4J-N20 the heading and toolbar can scroll with the list", () => {
  beforeEach(() => {
    mockWideDesktop = false;
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("N20-a chromeScrollsWithList: the chrome is the Agenda's list header, one scroll owner, Stay heading", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tree = await renderModule({
        chromeScrollsWithList: true,
        title: "Table reservations",
        scrollBottomPad: 100,
      });
      const agenda = tree.root.findByProps({ testID: "reservation-calendar-agenda" });
      expect(agenda.props.ListHeaderComponent).toBeTruthy();
      const inList = agenda.findAllByProps({ testID: "venue-reservations-scroll-chrome" });
      expect(inList.length).toBeGreaterThan(0);
      // Nothing of the chrome is left above the list.
      expect(tree.root.findAllByProps({ testID: "venue-reservations-scroll-chrome" })).toHaveLength(inList.length);
      expect(agenda.findAllByProps({ testID: "venue-reservations-new" }).length).toBeGreaterThan(0);
      expect(textIn(agenda, "Table reservations").length).toBeGreaterThan(0);
      expect(textIn(tree.root, "Reservations")).toHaveLength(0);
      expect(flattenedPaddingBottom(agenda)).toBe(100 + 24);
      expect(tree.root.findAllByProps({ testID: "reservation-calendar-mode-scroll" })).toHaveLength(0);
      const messages = error.mock.calls.flat().map(String).join("\n");
      expect(messages).not.toContain("VirtualizedLists should never be nested");
      // Tables view: the chrome moves into that view's ScrollView.
      await TestRenderer.act(async () => {
        interactive(tree.root, "reservations-view-tables").props.onPress();
      });
      const tables = tree.root.findByProps({ testID: "reservation-tables-scroll" });
      expect(tables.findAllByProps({ testID: "venue-reservations-scroll-chrome" }).length).toBeGreaterThan(0);
      expect(tree.root.findAllByProps({ testID: "venue-reservations-scroll-chrome" }))
        .toHaveLength(tables.findAllByProps({ testID: "venue-reservations-scroll-chrome" }).length);
      await TestRenderer.act(async () => {
        tree.unmount();
      });
    } finally {
      error.mockRestore();
    }
  });

  it("N20-b default (ordinary venue shell): chrome stays fixed above the list and reads Reservations", async () => {
    const tree = await renderModule({});
    const agenda = tree.root.findByProps({ testID: "reservation-calendar-agenda" });
    expect(agenda.props.ListHeaderComponent).toBeNull();
    expect(tree.root.findAllByProps({ testID: "venue-reservations-scroll-chrome" })).toHaveLength(0);
    expect(agenda.findAllByProps({ testID: "venue-reservations-new" })).toHaveLength(0);
    expect(textIn(tree.root, "Reservations").length).toBeGreaterThan(0);
    await TestRenderer.act(async () => {
      tree.unmount();
    });
  });
});
