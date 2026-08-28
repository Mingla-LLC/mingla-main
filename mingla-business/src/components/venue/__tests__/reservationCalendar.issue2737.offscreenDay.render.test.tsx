/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import type { Reservation } from "../../../types/venueReservation";
import { VenueReservationsModule } from "../VenueReservationsModule";

const mockScrollOrder: string[] = [];
let mockFailureCount = 0;

jest.mock("react-native", () => {
  const ReactRuntime = require("react") as typeof React;
  const actual = jest.requireActual("react-native") as typeof import("react-native");
  type MockSection = { dayKey: string; data: unknown[] };
  type MockSectionListProps = {
    sections: MockSection[];
    testID?: string;
    renderSectionHeader: (input: { section: MockSection }) => React.ReactElement<{
      onLayout?: () => void;
    }>;
    onScrollToIndexFailed: (input: {
      index: number;
      highestMeasuredFrameIndex: number;
      averageItemLength: number;
    }) => void;
  };

  const HeaderMount = ({
    dayKey,
    element,
  }: {
    dayKey: string;
    element: React.ReactElement<{ onLayout?: () => void }>;
  }): React.ReactElement => {
    ReactRuntime.useEffect(() => {
      element.props.onLayout?.();
    }, [dayKey, element.props]);
    return element;
  };

  const MockSectionList = ReactRuntime.forwardRef(
    (props: MockSectionListProps, ref: React.ForwardedRef<unknown>) => {
      const [expanded, setExpanded] = ReactRuntime.useState(false);
      const propsRef = ReactRuntime.useRef(props);
      propsRef.current = props;
      ReactRuntime.useImperativeHandle(ref, () => ({
        scrollToLocation: ({ sectionIndex }: { sectionIndex: number }) => {
          mockScrollOrder.push(`exact:${sectionIndex}`);
          if (mockFailureCount === 0) {
            mockFailureCount += 1;
            propsRef.current.onScrollToIndexFailed({
              index: 9,
              highestMeasuredFrameIndex: 4,
              averageItemLength: 80,
            });
          }
        },
        getScrollResponder: () => ({
          scrollTo: ({ y }: { y: number }) => {
            mockScrollOrder.push(`coarse:${y}`);
            setExpanded(true);
          },
        }),
      }));

      const sections = props.sections;
      const renderedSections = expanded ? sections : sections.slice(0, 2);
      return ReactRuntime.createElement(
        actual.View,
        { testID: props.testID },
        renderedSections.map((section) =>
          ReactRuntime.createElement(HeaderMount, {
            dayKey: section.dayKey,
            element: props.renderSectionHeader({ section }),
            key: section.dayKey,
          }),
        ),
      );
    },
  );

  Object.defineProperty(actual, "AccessibilityInfo", {
    configurable: true,
    value: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: () => mockScrollOrder.push("focus"),
    },
  });
  Object.defineProperty(actual, "findNodeHandle", {
    configurable: true,
    value: () => 2737,
  });
  Object.defineProperty(actual, "SectionList", {
    configurable: true,
    value: MockSectionList,
  });
  return actual;
});

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 60 }),
}));
jest.mock("../../../hooks/useVenueReservations", () => ({
  useVenueReservations: () => ({
    data: [
      mockReservation("fri", "2026-08-28T12:00:00.000Z"),
      mockReservation("sat", "2026-08-29T12:00:00.000Z"),
      mockReservation("sun", "2026-08-30T12:00:00.000Z"),
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
jest.mock("../ReservationCalendarToolbar", () => ({
  ReservationCalendarToolbar: ({
    days,
    onDaySelect,
  }: {
    days: { key: string }[];
    onDaySelect: (dayKey: string) => void;
  }) => {
    const ReactRuntime = require("react") as typeof React;
    const RN = require("react-native") as typeof import("react-native");
    return ReactRuntime.createElement(
      RN.View,
      null,
      days.map((day) =>
        ReactRuntime.createElement(RN.Pressable, {
          key: day.key,
          testID: `reservation-calendar-date-${day.key}`,
          onPress: () => onDaySelect(day.key),
        }),
      ),
    );
  },
}));
jest.mock("../ReservationCard", () => ({
  ReservationCard: ({ reservation }: { reservation: Reservation }) => {
    const ReactRuntime = require("react") as typeof React;
    const RN = require("react-native") as typeof import("react-native");
    return ReactRuntime.createElement(RN.View, {
      testID: `reservation-card-${reservation.id}`,
    });
  },
}));
jest.mock("../ReservationCreateSheet", () => ({ ReservationCreateSheet: () => null }));
jest.mock("../ReservationDetailSheet", () => ({ ReservationDetailSheet: () => null }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => {
    const ReactRuntime = require("react") as typeof React;
    const RN = require("react-native") as typeof import("react-native");
    return ReactRuntime.createElement(RN.View, null, children);
  },
}));
jest.mock("lucide-react-native", () => {
  const ReactRuntime = require("react") as typeof React;
  const Icon = (props: Record<string, unknown>): React.ReactElement =>
    ReactRuntime.createElement("MockIcon", props);
  return { AlertTriangle: Icon, Calendar: Icon };
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
    guestName: id,
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
  const node = root
    .findAllByProps({ testID })
    .find((candidate: ReactTestInstance) => typeof candidate.props.onPress === "function");
  if (node === undefined) throw new Error(`interactive_not_found:${testID}`);
  return node;
}

describe("issue #2737 off-screen agenda day navigation", () => {
  beforeEach(() => {
    mockScrollOrder.length = 0;
    mockFailureCount = 0;
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-28T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("coarse-scrolls after measurement failure, then exactly reveals and focuses Sunday", async () => {
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <VenueReservationsModule brandId="brand" venueId="venue" />,
        {
          createNodeMock: (element: { props?: { testID?: string } }) =>
            element.props?.testID?.startsWith("reservation-agenda-header-")
              ? { focus: jest.fn() }
              : null,
        },
      );
    });
    if (tree === null) throw new Error("offscreen_agenda_render_missing");

    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-date-2026-08-30").props.onPress();
    });
    await TestRenderer.act(async () => {
      jest.runAllTimers();
    });
    await TestRenderer.act(async () => {
      jest.runAllTimers();
    });

    const firstExact = mockScrollOrder.indexOf("exact:2");
    const coarse = mockScrollOrder.indexOf("coarse:720");
    const finalExact = mockScrollOrder.lastIndexOf("exact:2");
    const focus = mockScrollOrder.indexOf("focus");
    expect(firstExact).toBeGreaterThanOrEqual(0);
    expect(coarse).toBeGreaterThan(firstExact);
    expect(finalExact).toBeGreaterThan(coarse);
    expect(focus).toBeGreaterThan(finalExact);
    expect(mockFailureCount).toBe(1);
  });
});
