/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import type { Reservation } from "../../../types/venueReservation";
import { VenueReservationsModule } from "../VenueReservationsModule";

let mockRoleRank = 60;
let mockReservationsQuery: Record<string, unknown>;
let mockTablesQuery: Record<string, unknown>;
let mockAvailabilityQuery: Record<string, unknown>;
const mockEntryFocus = jest.fn();

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: mockRoleRank }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../hooks/useVenueReservations", () => ({
  useVenueReservations: () => mockReservationsQuery,
  useCreateReservation: () => ({ mutate: jest.fn(), isPending: false }),
  useTransitionReservation: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../hooks/useVenueTables", () => ({
  useVenueTables: () => mockTablesQuery,
}));
jest.mock("../../../hooks/useVenueAvailability", () => ({
  useVenueAvailabilityConfig: () => mockAvailabilityQuery,
}));

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children, testID, contentStyle }: { children?: React.ReactNode; testID?: string; contentStyle?: object }) => {
    const ReactRuntime = require("react") as typeof React;
    const { View: NativeView } = require("react-native") as typeof import("react-native");
    return ReactRuntime.createElement(NativeView, { testID, style: contentStyle }, children);
  },
}));
jest.mock("../../ui/Button", () => ({
  Button: ({ label, onPress, testID, loading }: { label: string; onPress: () => void; testID?: string; loading?: boolean }) => {
    const ReactRuntime = require("react") as typeof React;
    const { Pressable: NativePressable, Text: NativeText } = require("react-native") as typeof import("react-native");
    return ReactRuntime.createElement(
      NativePressable,
      { onPress, testID, accessibilityState: { busy: loading } },
      ReactRuntime.createElement(NativeText, null, label),
    );
  },
}));
jest.mock("../ReservationCreateSheet", () => ({
  ReservationCreateSheet: ({ visible }: { visible: boolean }) => {
    const ReactRuntime = require("react") as typeof React;
    const { View: NativeView } = require("react-native") as typeof import("react-native");
    return visible ? ReactRuntime.createElement(NativeView, { testID: "mock-create-sheet" }) : null;
  },
}));
jest.mock("../ReservationDetailSheet", () => ({
  ReservationDetailSheet: ({ visible, reservation, onClose }: { visible: boolean; reservation: Reservation | null; onClose: () => void }) => {
    const ReactRuntime = require("react") as typeof React;
    const { Pressable: NativePressable, View: NativeView } = require("react-native") as typeof import("react-native");
    return visible
      ? ReactRuntime.createElement(
        NativeView,
        { testID: `mock-detail-${reservation?.id ?? "missing"}` },
        ReactRuntime.createElement(NativePressable, { testID: "mock-detail-close", onPress: onClose }),
      )
      : null;
  },
}));
jest.mock("../ReservationCard", () => ({
  ReservationCard: ({ reservation, tableDisplay, onPress, entryRef, testID }: {
    reservation: Reservation;
    tableDisplay: string | null;
    onPress: (reservation: Reservation) => void;
    entryRef?: (node: { focus?: () => void } | null) => void;
    testID?: string;
  }) => {
    const ReactRuntime = require("react") as typeof React;
    const { Pressable: NativePressable, Text: NativeText } = require("react-native") as typeof import("react-native");
    ReactRuntime.useEffect(() => {
      entryRef?.({ focus: mockEntryFocus });
      return () => entryRef?.(null);
    }, [entryRef]);
    return ReactRuntime.createElement(
      NativePressable,
      { testID: testID ?? `reservation-card-${reservation.id}`, onPress: () => onPress(reservation) },
      ReactRuntime.createElement(NativeText, null, `${reservation.guestName ?? "Guest"} ${tableDisplay ?? ""}`),
    );
  },
}));
jest.mock("lucide-react-native", () => {
  const ReactRuntime = require("react") as typeof React;
  const Icon = (props: Record<string, unknown>): React.ReactElement =>
    ReactRuntime.createElement("MockIcon", props);
  return { AlertTriangle: Icon, Calendar: Icon, Check: Icon, ChevronLeft: Icon, ChevronRight: Icon };
});

// @ts-expect-error react-test-renderer ships without declarations in this workspace.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

const row: Reservation = {
  id: "gogi-one",
  brandId: "brand",
  venueId: "venue",
  placePoolId: null,
  tableId: "table-10",
  reservedFor: "2026-08-27T13:00:00.000Z",
  partySize: 4,
  status: "confirmed",
  source: "mingla",
  createdVia: "consumer",
  guestName: "Gogi Test Guest",
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

const textContent = (root: ReactTestInstance): string =>
  root.findAll((node: ReactTestInstance) => typeof node.props.children === "string")
    .map((node: ReactTestInstance) => String(node.props.children))
    .join(" ");

const interactive = (root: ReactTestInstance, testID: string): ReactTestInstance => {
  const node = root.findAllByProps({ testID }).find(
    (candidate: ReactTestInstance) => typeof candidate.props.onPress === "function",
  );
  if (node === undefined) throw new Error(`interactive_not_found:${testID}`);
  return node;
};

const renderModule = async (createNodeMock?: (element: { props: Record<string, unknown> }) => unknown): Promise<ReactTestRenderer> => {
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <VenueReservationsModule brandId="brand" venueId="venue" />,
      createNodeMock === undefined ? undefined : { createNodeMock },
    );
  });
  if (tree === null) throw new Error("module_render_missing");
  return tree;
};

describe("issue #2737 reservation calendar runtime states", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
    mockRoleRank = 60;
    mockEntryFocus.mockClear();
    mockReservationsQuery = { data: [row], isLoading: false, isError: false, isFetching: false, refetch: jest.fn() };
    mockTablesQuery = { data: [{ id: "table-10", name: "T10" }], isLoading: false, isError: false };
    mockAvailabilityQuery = { data: { ianaTimezone: "Africa/Lagos" }, isLoading: false, isError: false };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("gates venue-day projection behind config loading without an empty flash", async () => {
    mockAvailabilityQuery = { data: undefined, isLoading: true, isError: false };
    const tree = await renderModule();
    expect(tree.root.findAllByProps({ accessibilityLabel: "Loading reservations" }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: "reservation-card-gogi-one" })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: "reservation-calendar-empty" })).toHaveLength(0);
  });

  it("renders the blocking error and rejects duplicate retry activation", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const refetch = jest.fn(() => pending);
    mockReservationsQuery = { data: [], isLoading: false, isError: true, isFetching: false, refetch };
    const tree = await renderModule();
    const retry = interactive(tree.root, "reservation-calendar-error-retry");
    await TestRenderer.act(async () => {
      void retry.props.onPress();
      void retry.props.onPress();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(
      tree.root.findAllByProps({ testID: "reservation-calendar-error-retry" }).some(
        (node: ReactTestInstance) => node.props.accessibilityState?.busy === true,
      ),
    ).toBe(true);
    await TestRenderer.act(async () => { release?.(); await pending; });
  });

  it("retains stale reservations while table partial states resolve honestly", async () => {
    mockReservationsQuery = { ...mockReservationsQuery, isError: true };
    mockTablesQuery = { data: undefined, isLoading: true, isError: false };
    const tree = await renderModule();
    expect(textContent(tree.root)).toContain("Gogi Test Guest");
    expect(textContent(tree.root)).toContain("Loading table…");
    expect(textContent(tree.root)).toContain("Couldn't refresh. Showing the last update.");

    mockTablesQuery = { data: undefined, isLoading: false, isError: true };
    await TestRenderer.act(async () => {
      tree.update(<VenueReservationsModule brandId="brand" venueId="venue" />);
    });
    expect(textContent(tree.root)).toContain("Gogi Test Guest");
    expect(textContent(tree.root)).toContain("Table unavailable");
  });

  it("keeps browsing/detail available read-only and restores the invoking entry on close", async () => {
    mockRoleRank = 10;
    const tree = await renderModule();
    expect(tree.root.findAllByProps({ testID: "venue-reservations-new" })).toHaveLength(0);
    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-card-gogi-one").props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: "mock-detail-gogi-one" }).length).toBeGreaterThan(0);
    await TestRenderer.act(async () => {
      interactive(tree.root, "mock-detail-close").props.onPress();
      jest.runOnlyPendingTimers();
    });
    expect(mockEntryFocus).toHaveBeenCalledTimes(1);
  });

  it("removes UTC degradation after recovery without resetting the selected scope", async () => {
    mockAvailabilityQuery = { data: { ianaTimezone: "Not/AZone" }, isLoading: false, isError: false };
    const tree = await renderModule();
    expect(tree.root.findAllByProps({ testID: "reservation-calendar-timezone-warning" }).length).toBeGreaterThan(0);
    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-scope-canceled").props.onPress();
    });
    mockAvailabilityQuery = { data: { ianaTimezone: "Africa/Lagos" }, isLoading: false, isError: false };
    await TestRenderer.act(async () => {
      tree.update(<VenueReservationsModule brandId="brand" venueId="venue" />);
    });
    expect(tree.root.findAllByProps({ testID: "reservation-calendar-timezone-warning" })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: "reservation-calendar-scope-canceled" }).props.accessibilityState.selected).toBe(true);
  });

  it("registers real sticky headers and scroll/focus intent for a selected date", async () => {
    const tree = await renderModule();
    const agenda = tree.root.findByProps({ testID: "reservation-calendar-agenda" });
    expect(agenda.props.stickySectionHeadersEnabled).toBe(true);
    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-date-2026-08-28").props.onPress();
      jest.runOnlyPendingTimers();
    });
    expect(tree.root.findAllByProps({ testID: "reservation-agenda-header-2026-08-28" }).length).toBeGreaterThan(0);
  });
});
