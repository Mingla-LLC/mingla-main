/** Issue #2726 implementor happy path: real RNW empty-state and rail output. */
import React from "react";
const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (node: React.ReactElement) => string;
};

jest.mock("../../ui/Button", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  const Button = (props: Record<string, unknown>) =>
    React.createElement(
      Pressable,
      {
        ...props,
        accessibilityLabel: [
          props.variant,
          props.size,
          props.shape,
          props.accentColor,
          String(props.fullWidth),
        ].join("|"),
      },
      React.createElement(Text, null, props.label),
    );
  return { Button, default: Button };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: true }),
}));
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  useVenueReservationSettings: () => ({ data: { reservationsEnabled: true } }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../store/venueSuiteStore", () => ({
  useVenueSuiteStore: Object.assign(() => jest.fn(), { getState: () => ({}) }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { ScrollView } = require("react-native");
  return { ScrollView };
});
jest.mock("expo-router", () => ({
  useNavigation: () => ({
    addListener: () => () => undefined,
    dispatch: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useVenueAvailability", () => ({
  useVenueAvailabilityConfig: () => ({
    data: {
      servicePeriods: [
        { name: "Dinner", days: [5, 6], start: "17:00", end: "23:00" },
      ],
      turnTimes: {},
      bufferMinutes: 0,
      maxReservationsPerSlot: null,
      slotGranularityMinutes: 15,
      advanceWindowDays: 30,
      minNoticeMinutes: 0,
      ianaTimezone: "Africa/Lagos",
      ianaTimezoneSource: "operator",
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: jest.fn(),
  }),
  useVenueBlackouts: () => ({ data: [] }),
  useUpsertVenueAvailabilityConfig: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useUpsertVenueBlackout: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteVenueBlackout: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../hooks/useVenueTables", () => ({
  useVenueTables: () => ({ data: [] }),
}));
jest.mock("../../ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));
jest.mock("../../../wrappers/KeyboardToolbarRoot", () => ({
  setAvailabilityNumericToolbarState: jest.fn(),
}));
jest.mock("../../ui/Input", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Input = React.forwardRef(
    (props: Record<string, unknown>, _ref: unknown) =>
      React.createElement(View, props),
  );
  Input.displayName = "InputMock";
  return { Input, default: Input };
});
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../VenueBlackoutSheet", () => ({ VenueBlackoutSheet: () => null }));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../VenueIntelligenceModule", () => ({
  VenueIntelligenceModule: () => null,
}));
jest.mock("../VenueMenuModule", () => ({ VenueMenuModule: () => null }));
jest.mock("../VenueReservationsModule", () => ({
  VenueReservationsModule: () => null,
}));
jest.mock("../VenueSettingsModule", () => ({
  VenueSettingsModule: () => null,
}));
jest.mock("../VenueTablesModule", () => ({ VenueTablesModule: () => null }));
jest.mock("../VenueWaitlistModule", () => ({
  VenueWaitlistModule: () => null,
}));

import { SuiteDesktopShell } from "../../suite/SuiteDesktopShell";
import { StyleSheet, View } from "react-native";
import { restaurantHubLayout } from "../../../constants/designSystem";
import { VenueAvailabilityModule } from "../VenueAvailabilityModule";
import { VenueHubEmptyState } from "../VenueHubEmptyState";
import { deriveVenueRailModules } from "../VenueSuiteShell";
import { deriveVenueModules } from "../venueModules";

function render(node: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(node);
}

function openingTag(html: string, testID: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testID}"[^>]*>`));
  if (match === null) throw new Error(`Missing ${testID}`);
  return match[0];
}

function classTokens(tag: string): readonly string[] {
  return tag.match(/class="([^"]+)"/)?.[1]?.split(" ") ?? [];
}

describe("#2726 web happy path", () => {
  it("renders the real Availability host at workspace width while capping only prose", () => {
    const html = render(<VenueAvailabilityModule brandId="b1" />);
    const referenceStyles = StyleSheet.create({
      width: { width: "100%" },
      cap: { maxWidth: restaurantHubLayout.proseMaxWidth },
    });
    const widthReference = render(
      <View style={referenceStyles.width} testID="width-ref" />,
    );
    const capReference = render(
      <View style={referenceStyles.cap} testID="cap-ref" />,
    );
    const widthAtom = classTokens(openingTag(widthReference, "width-ref")).find(
      (token) => token.startsWith("r-width-"),
    );
    const capAtom = classTokens(openingTag(capReference, "cap-ref")).find(
      (token) => token.startsWith("r-maxWidth-"),
    );
    const hostTag = openingTag(html, "venue-availability-module");
    const proseTag = openingTag(html, "venue-avail-heading-copy");
    const hostClasses = classTokens(hostTag);
    const proseClasses = classTokens(proseTag);
    expect(widthAtom).toBeDefined();
    expect(capAtom).toBeDefined();
    expect(hostClasses).toContain(widthAtom);
    expect(hostClasses).not.toContain(capAtom);
    expect(proseClasses).toContain(capAtom);
    expect(html).toContain('aria-label="Service periods, 1 column"');
  });

  it("renders the shared max-measure anatomy through real react-native-web", () => {
    const html = render(
      <VenueHubEmptyState
        icon="reservations"
        title="No reservations today yet."
        body="When guests book, they land here."
        actionLabel="Add one to test"
        onAction={jest.fn()}
        testID="empty-web"
      />,
    );
    expect(html).toContain("No reservations today yet.");
    expect(html).toContain("Add one to test");
    // RNW's deterministic atoms for maxWidth:560 and width/height:48.
    expect(html).toContain("r-maxWidth-l3xdm2");
    expect(html).toContain("r-width-rwqe4o");
    expect(html).toContain("r-height-h3s6tt");
    expect(html).toContain('aria-label="primary|md|pill|#eb7825|false"');
    const anatomy = openingTag(html, "empty-web-anatomy");
    const icon = openingTag(html, "empty-web-icon");
    const body = openingTag(html, "empty-web-body");
    const action = openingTag(html, "empty-web-action");
    const rhythm = StyleSheet.create({
      anatomy: { paddingVertical: 8 },
      icon: { marginBottom: 16 },
      body: { marginTop: 4 },
      action: { marginTop: 16 },
    });
    const rhythmHtml = render(
      <>
        <View style={rhythm.anatomy} testID="rhythm-anatomy" />
        <View style={rhythm.icon} testID="rhythm-icon" />
        <View style={rhythm.body} testID="rhythm-body" />
        <View style={rhythm.action} testID="rhythm-action" />
      </>,
    );
    const atom = (id: string, prefix: string): string | undefined =>
      classTokens(openingTag(rhythmHtml, id)).find((token) =>
        token.startsWith(prefix),
      );
    expect(classTokens(anatomy)).toContain(
      atom("rhythm-anatomy", "r-paddingBlock-"),
    );
    expect(classTokens(icon)).toContain(atom("rhythm-icon", "r-marginBottom-"));
    expect(classTokens(body)).toContain(atom("rhythm-body", "r-marginTop-"));
    expect(classTokens(action)).toContain(
      atom("rhythm-action", "r-marginTop-"),
    );
  });

  it("renders exact grouped order, accessible context, and 44px rail targets", () => {
    const modules = deriveVenueRailModules(deriveVenueModules(true));
    const html = render(
      <SuiteDesktopShell
        modules={modules}
        activeModule="availability"
        onSelect={jest.fn()}
        workspaceSelfScrolls
        scrollBottomPad={120}
        railTestIdPrefix="venue-rail-"
      >
        <span>Workspace</span>
      </SuiteDesktopShell>,
    );
    expect(modules.map(({ group, label }) => `${group}:${label}`)).toEqual([
      "Venue:Overview",
      "Bookings:Tables",
      "Bookings:Availability",
      "Bookings:Reservations",
      "Bookings:Waitlist",
      "Operations:Menu",
      "Operations:Insights",
      "Operations:Orders",
      "Operations:Settings",
    ]);
    expect(html.match(/>Venue<|>Bookings<|>Operations</g)).toHaveLength(3);
    expect(html).toContain('aria-label="Bookings, Availability module"');
    expect(html).toContain("r-minHeight-peo1c");
    const opacityOneReference = render(
      <View style={{ opacity: 1 }} testID="opacity-one" />,
    );
    const opacityZeroReference = render(
      <View style={{ opacity: 0 }} testID="opacity-zero" />,
    );
    const opacityOneAtom = classTokens(
      openingTag(opacityOneReference, "opacity-one"),
    ).at(-1);
    const opacityZeroAtom = classTokens(
      openingTag(opacityZeroReference, "opacity-zero"),
    ).at(-1);
    const activeSelection = openingTag(html, "venue-selection-availability");
    const inactiveSelection = openingTag(html, "venue-selection-tables");
    expect(classTokens(activeSelection)).toContain(opacityOneAtom);
    expect(classTokens(inactiveSelection)).toContain(opacityZeroAtom);
    expect(activeSelection).toContain("transition-duration:200ms");
    expect(activeSelection).toContain("transition-property:opacity");
  });

  it("hides the whole Bookings heading when the booking band is filtered", () => {
    const modules = deriveVenueRailModules(deriveVenueModules(false));
    expect(modules.some((module) => module.group === "Bookings")).toBe(false);
    const html = render(
      <SuiteDesktopShell
        modules={modules}
        activeModule="overview"
        onSelect={jest.fn()}
        workspaceSelfScrolls
        scrollBottomPad={120}
        railTestIdPrefix="venue-rail-"
      >
        <span>Workspace</span>
      </SuiteDesktopShell>,
    );
    expect(html).not.toContain(">Bookings<");
  });
});
