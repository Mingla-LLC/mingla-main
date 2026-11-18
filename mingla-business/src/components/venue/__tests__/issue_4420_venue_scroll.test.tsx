/**
 * #4420 B8 — the venue page scrolls past the Local reviews panel.
 *
 * Root cause (reproduced from source on the venue page): the Local reviews
 * panel was rendered in the page's FIXED header stack, above the suite shell,
 * whose Overview (VenueIntelligenceModule) owns the only ScrollView. A long
 * reviews list took the whole height on iOS and on short desktop windows, and
 * nothing below it could be reached.
 *
 * Fix: the panel is handed to the suite as `overviewHeader` and rendered as
 * the first child INSIDE the Overview ScrollView, together with the (now
 * compact) "Turn on Reservations" invitation.
 *
 * FAILS ON REVERT: the page renders the panel outside the shells again, the
 * shell stops forwarding it, or the module renders it outside its ScrollView.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = (name: string) =>
  function Host(props: Record<string, unknown>): React.ReactElement {
    return React.createElement(name, props, props.children as React.ReactNode);
  };

// #4490 — the shell reads venue features. These harnesses drive the nav from the
// mocked reservation settings, so the features read "fails" here and the shell
// falls back to the server's backfill rule (features follow the old switch).
jest.mock("../../../hooks/useVenueFeatures", () => ({
  useVenueFeatures: () => ({ data: undefined, isError: true, isLoading: false }),
  useSetVenueFeature: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("../../../hooks/useMyVenueAccess", () => ({
  useMyVenueAccess: () => ({
    data: { scoped: false, capabilities: [] },
    isFetched: true,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
}));
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  useVenueReservationSettings: () => ({ data: { reservationsEnabled: false }, isError: false }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: host("ShellScrollView") }));
jest.mock("../../suite/SuiteDesktopShell", () => ({ SuiteDesktopShell: host("Desktop") }));
jest.mock("../../ui/Button", () => ({ Button: host("Button") }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: host("GlassCard") }));
jest.mock("../../ui/useShareNetworkState", () => ({ useShareNetworkState: () => ({ isOnline: true }) }));
jest.mock("lucide-react-native", () => ({ Flag: () => null }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: 100 }) }));
jest.mock("../../../hooks/useVenueIntelligence", () => ({
  useVenueIntelligence: () => ({ isLoading: false, isError: true, data: undefined, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useVenueReservationMetrics", () => ({
  useVenueReservationMetrics: () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useVenueOrganicInsights", () => ({
  useVenueOrganicInsights: () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useVenueOrderMetrics", () => ({
  useVenueOrderMetrics: () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
}));
jest.mock("../insights/SiteCheckOverviewTile", () => ({ SiteCheckOverviewTile: () => null }));
jest.mock("../VenueReservationsCard", () => ({
  VenueReservationRefreshAnnouncement: () => null,
  VenueReservationsCard: () => null,
}));
jest.mock("../VenueOrganicEngagementSection", () => ({ VenueOrganicEngagementSection: () => null }));
jest.mock("../../../analytics/businessAnalyticsEvents", () => ({
  captureBusinessVenueOrganicInsightsRefreshed: jest.fn(),
  captureBusinessVenueOrganicInsightsViewed: jest.fn(),
  captureBusinessVenueReservationsRefreshed: jest.fn(),
  captureBusinessVenueReservationsViewed: jest.fn(),
}));

jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: { buttonPress: jest.fn(), selection: jest.fn(), success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));
jest.mock("../VenueAvailabilityModule", () => ({
  VenueAvailabilityModule: React.forwardRef(function Availability(props: Record<string, unknown>, _ref) {
    return React.createElement("availability", props);
  }),
}));
for (const [path, name] of [
  ["../VenueMenuModule", "VenueMenuModule"],
  ["../VenueReservationsModule", "VenueReservationsModule"],
  ["../VenueSettingsModule", "VenueSettingsModule"],
  ["../VenueTablesModule", "VenueTablesModule"],
  ["../VenueWaitlistModule", "VenueWaitlistModule"],
  ["../VenueOrdersModule", "VenueOrdersModule"],
  ["../insights/VenueInsightsModule", "VenueInsightsModule"],
]) jest.doMock(path, () => ({ [name]: host(name) }));

const { VenueSuiteShell } = require("../VenueSuiteShell") as typeof import("../VenueSuiteShell");
const { VenueIntelligenceModule } =
  require("../VenueIntelligenceModule") as typeof import("../VenueIntelligenceModule");
const { ScrollView } = require("react-native") as typeof import("react-native");

type Node = { type: unknown; props: Record<string, unknown>; parent: Node | null };
const Renderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => {
    root: { findAll: (p: (n: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (cb: () => void) => void;
};

const ReviewsPanel = (): React.ReactElement => React.createElement("ReviewsPanel");
const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  Renderer.act(() => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

const inside = (node: Node, type: unknown): boolean => {
  for (let at: Node | null = node.parent; at !== null; at = at.parent) {
    if (at.type === type) return true;
  }
  return false;
};

describe("#4420 B8 — Local reviews scroll with the venue Overview", () => {
  test("the shell renders the panel and the invitation INSIDE the Overview ScrollView", () => {
    let tree!: ReturnType<typeof Renderer.create>;
    Renderer.act(() => {
      tree = Renderer.create(
        <VenueSuiteShell
          brandId="brand-1"
          venueId="venue-1"
          overviewHeader={<ReviewsPanel />}
        />,
      );
    });
    mounted.push(tree);
    const panel = tree.root.findAll((n) => n.type === ReviewsPanel)[0];
    expect(panel).toBeDefined();
    expect(inside(panel, ScrollView)).toBe(true);
    const invite = tree.root.findAll(
      (n) => n.type === "Button" && n.props.testID === "venue-overview-turn-on-reservations",
    )[0];
    expect(invite).toBeDefined();
    expect(inside(invite, ScrollView)).toBe(true);
    // Compact (round-3 item 12): a small button, not a full-width block.
    expect(invite.props.size).toBe("sm");
    expect(invite.props.fullWidth).toBeUndefined();
  });

  test("the module itself puts its header inside its own ScrollView", () => {
    let tree!: ReturnType<typeof Renderer.create>;
    Renderer.act(() => {
      tree = Renderer.create(
        <VenueIntelligenceModule brandId="brand-1" venueId="venue-1" header={<ReviewsPanel />} />,
      );
    });
    mounted.push(tree);
    const panel = tree.root.findAll((n) => n.type === ReviewsPanel)[0];
    expect(panel).toBeDefined();
    expect(inside(panel, ScrollView)).toBe(true);
  });

  test("the venue page no longer renders the panel in its fixed header stack", () => {
    const page = readFileSync(join(__dirname, "../../../../app/venue/[venueId]/index.tsx"), "utf8");
    // Exactly one render site: the value handed to both suite shells.
    expect(page.match(/<LocalReviewsManager\b/g)?.length).toBe(1);
    expect(page).toMatch(/const localReviewsPanel =/);
    // [TEST-MOD-APPROVED #4420] round-3 item 19: the venue suite shows the panel as its own
    // Reviews module; the Stay suite still scrolls it with its Overview.
    expect(page.match(/overviewHeader=\{localReviewsPanel\}/g)?.length).toBe(1);
    // [TEST-MOD-APPROVED #4420] the Reviews module renders the same panel in
    // its "module" variant (loading / empty / error states); same single site.
    expect(page.match(/reviewsPanel=\{renderLocalReviews\("module"\)\}/g)?.length).toBe(1);
  });
});
