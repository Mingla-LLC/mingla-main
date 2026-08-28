/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import type { Reservation } from "../../../types/venueReservation";
import { VenueReservationsModule } from "../VenueReservationsModule";

interface MockFailurePayload {
  index: number;
  highestMeasuredFrameIndex: number;
  averageItemLength: number;
}

const mockScrollOrder: string[] = [];
const mockExactCalls: {
  animated: boolean;
  itemIndex: number;
  sectionIndex: number;
  viewOffset: number;
  viewPosition: number;
  dayKey: string;
  dataLength: number;
}[] = [];
let mockExactFailures: MockFailurePayload[] = [];
let mockViewportDays: string[] = [];
let mockEmitNativeScroll: (offsetY: number) => void = () => undefined;
let mockEmitViewability: (dayKeys: string[]) => void = () => undefined;

jest.mock("react-native", () => {
  const ReactRuntime = require("react") as typeof React;
  const actual = jest.requireActual("react-native") as typeof import("react-native");
  type MockSection = { dayKey: string; data: unknown[] };
  type MockSectionListProps = {
    sections: MockSection[];
    testID?: string;
    renderSectionHeader: (input: { section: MockSection }) => React.ReactElement<{
      onLayout?: () => void;
      ref?: (node: { nativeTag: string } | null) => void;
    }>;
    onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
    onViewableItemsChanged: (input: {
      viewableItems: {
        isViewable: boolean;
        item: unknown;
        key: string;
        section: MockSection;
      }[];
      changed: unknown[];
    }) => void;
    onScrollToIndexFailed: (input: MockFailurePayload) => void;
  };

  const viewabilityPayload = (
    props: MockSectionListProps,
    dayKeys: string[],
  ): Parameters<MockSectionListProps["onViewableItemsChanged"]>[0] => ({
    viewableItems: dayKeys.flatMap((dayKey) => {
      const section = props.sections.find((candidate) => candidate.dayKey === dayKey);
      return section === undefined
        ? []
        : [{ isViewable: true, item: section.data[0] ?? section, key: dayKey, section }];
    }),
    changed: [],
  });

  const HeaderMount = ({
    dayKey,
    element,
  }: {
    dayKey: string;
    element: React.ReactElement<{
      onLayout?: () => void;
      ref?: (node: { nativeTag: string } | null) => void;
    }>;
  }): React.ReactElement => {
    ReactRuntime.useEffect(() => {
      element.props.ref?.({ nativeTag: dayKey });
      return () => element.props.ref?.(null);
    }, [dayKey, element.props.ref]);
    return ReactRuntime.cloneElement(element, { ref: undefined });
  };

  const MockSectionList = ReactRuntime.forwardRef(
    (props: MockSectionListProps, ref: React.ForwardedRef<unknown>) => {
      const [visibleDayKeys, setVisibleDayKeys] = ReactRuntime.useState([
        "2026-08-28",
        "2026-08-29",
      ]);
      const propsRef = ReactRuntime.useRef(props);
      propsRef.current = props;
      mockViewportDays = visibleDayKeys;

      mockEmitNativeScroll = (offsetY: number): void => {
        propsRef.current.onScroll({ nativeEvent: { contentOffset: { y: offsetY } } });
      };
      mockEmitViewability = (dayKeys: string[]): void => {
        setVisibleDayKeys(dayKeys);
        propsRef.current.onViewableItemsChanged(
          viewabilityPayload(propsRef.current, dayKeys),
        );
      };

      ReactRuntime.useEffect(() => {
        propsRef.current.onViewableItemsChanged(
          viewabilityPayload(propsRef.current, visibleDayKeys),
        );
        // The initial native visibility report occurs once after mount.
      }, []);

      ReactRuntime.useImperativeHandle(ref, () => ({
        scrollToLocation: (input: {
          animated: boolean;
          itemIndex: number;
          sectionIndex: number;
          viewOffset: number;
          viewPosition: number;
        }) => {
          const section = propsRef.current.sections[input.sectionIndex];
          const dayKey = section?.dayKey ?? "missing";
          mockExactCalls.push({
            ...input,
            dayKey,
            dataLength: section?.data.length ?? -1,
          });
          mockScrollOrder.push(`exact:${dayKey}`);
          const failure = mockExactFailures.shift();
          if (failure !== undefined) {
            propsRef.current.onScrollToIndexFailed(failure);
          }
        },
        getScrollResponder: () => ({
          scrollTo: ({ y }: { y: number }) => {
            mockScrollOrder.push(`coarse:${y}`);
          },
        }),
      }));

      const renderedSections = visibleDayKeys.flatMap((dayKey) => {
        const section = props.sections.find((candidate) => candidate.dayKey === dayKey);
        return section === undefined ? [] : [section];
      });
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
      setAccessibilityFocus: (handle: string) =>
        mockScrollOrder.push(`focus:${handle}`),
    },
  });
  Object.defineProperty(actual, "findNodeHandle", {
    configurable: true,
    value: () => mockViewportDays[0] ?? null,
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
    selectedDayKey,
    onDaySelect,
  }: {
    days: { key: string }[];
    selectedDayKey: string;
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
          accessibilityState: { selected: day.key === selectedDayKey },
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

const FAILURE: MockFailurePayload = {
  index: 9,
  highestMeasuredFrameIndex: 4,
  averageItemLength: 80,
};

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

async function renderModule(): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <VenueReservationsModule brandId="brand" venueId="venue" />,
    );
  });
  if (tree === null) throw new Error("offscreen_agenda_render_missing");
  return tree;
}

async function flushInitialRequest(): Promise<void> {
  await TestRenderer.act(async () => {
    jest.runOnlyPendingTimers();
  });
}

describe("issue #2737 native-event-driven off-screen agenda navigation", () => {
  beforeEach(() => {
    mockScrollOrder.length = 0;
    mockExactCalls.length = 0;
    mockExactFailures = [];
    mockViewportDays = [];
    mockEmitNativeScroll = () => undefined;
    mockEmitViewability = () => undefined;
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-28T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("targets Sunday's first card and completes only after the native viewport reports it", async () => {
    const tree = await renderModule();

    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-date-2026-08-30").props.onPress();
    });
    await flushInitialRequest();

    expect(mockScrollOrder).toEqual(["exact:2026-08-30"]);
    expect(mockExactCalls[0]).toEqual({
      animated: false,
      itemIndex: 1,
      sectionIndex: 2,
      viewOffset: 0,
      viewPosition: 0,
      dayKey: "2026-08-30",
      dataLength: 1,
    });
    expect(mockViewportDays).toEqual(["2026-08-28", "2026-08-29"]);
    expect(
      tree.root.findAllByProps({ testID: "reservation-agenda-header-2026-08-30" }),
    ).toHaveLength(0);

    await flushInitialRequest();
    expect(mockScrollOrder).toEqual(["exact:2026-08-30"]);

    await TestRenderer.act(async () => mockEmitNativeScroll(340));
    expect(mockScrollOrder).toEqual(["exact:2026-08-30"]);

    await TestRenderer.act(async () => mockEmitViewability(["2026-08-30"]));
    expect(mockViewportDays).toEqual(["2026-08-30"]);
    expect(
      tree.root.findAllByProps({ testID: "reservation-agenda-header-2026-08-30" }),
    ).not.toHaveLength(0);
    expect(mockScrollOrder).toEqual([
      "exact:2026-08-30",
      "focus:2026-08-30",
    ]);
  });

  it("uses the empty selected day's footer anchor and still completes sticky focus", async () => {
    const tree = await renderModule();

    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-date-2026-08-27").props.onPress();
    });
    await flushInitialRequest();

    expect(mockExactCalls[0]).toEqual({
      animated: false,
      itemIndex: 1,
      sectionIndex: 0,
      viewOffset: 0,
      viewPosition: 0,
      dayKey: "2026-08-27",
      dataLength: 0,
    });
    expect(mockScrollOrder).toEqual(["exact:2026-08-27"]);
    expect(
      tree.root.findAllByProps({ testID: "reservation-agenda-header-2026-08-27" }),
    ).toHaveLength(0);

    await TestRenderer.act(async () => mockEmitNativeScroll(72));
    await TestRenderer.act(async () => mockEmitViewability(["2026-08-27"]));
    expect(mockViewportDays).toEqual(["2026-08-27"]);
    expect(
      tree.root.findAllByProps({ testID: "reservation-agenda-header-2026-08-27" }),
    ).not.toHaveLength(0);
    expect(mockScrollOrder).toEqual([
      "exact:2026-08-27",
      "focus:2026-08-27",
    ]);
  });

  it("does not spin on identical progress and lets only the superseding Saturday win", async () => {
    mockExactFailures = [{ ...FAILURE }, { ...FAILURE }];
    const tree = await renderModule();

    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-date-2026-08-30").props.onPress();
    });
    await flushInitialRequest();
    await TestRenderer.act(async () => mockEmitNativeScroll(120));
    await TestRenderer.act(async () => mockEmitNativeScroll(0));
    await TestRenderer.act(async () => mockEmitViewability(["2026-08-30"]));

    expect(mockScrollOrder).toEqual([
      "exact:2026-08-30",
      "coarse:720",
      "exact:2026-08-30",
    ]);
    await TestRenderer.act(async () => mockEmitNativeScroll(720));
    await TestRenderer.act(async () => mockEmitViewability(["2026-08-30"]));
    await flushInitialRequest();
    expect(mockScrollOrder).toEqual([
      "exact:2026-08-30",
      "coarse:720",
      "exact:2026-08-30",
    ]);

    await TestRenderer.act(async () => {
      interactive(tree.root, "reservation-calendar-date-2026-08-29").props.onPress();
    });
    await flushInitialRequest();
    expect(
      interactive(tree.root, "reservation-calendar-date-2026-08-29").props
        .accessibilityState.selected,
    ).toBe(true);

    const afterSaturdayExact = [...mockScrollOrder];
    await TestRenderer.act(async () => mockEmitNativeScroll(700));
    await TestRenderer.act(async () => mockEmitViewability(["2026-08-30"]));
    expect(mockScrollOrder).toEqual(afterSaturdayExact);

    await TestRenderer.act(async () => mockEmitViewability(["2026-08-29"]));
    expect(mockViewportDays).toEqual(["2026-08-29"]);
    expect(mockScrollOrder.at(-1)).toBe(
      "focus:2026-08-29",
    );
    expect(
      mockScrollOrder.filter((event) => event.startsWith("focus:")),
    ).toEqual(["focus:2026-08-29"]);
  });
});
