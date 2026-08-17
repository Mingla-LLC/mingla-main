import React from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Renderer = {
  root: { findAllByProps: (props: Record<string, unknown>) => Array<{ props: Record<string, unknown> }> };
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;
const press = (tree: Renderer, testID: string): void => {
  const onPress = tree.root.findAllByProps({ testID })[0]?.props.onPress;
  if (typeof onPress !== "function") throw new Error(`missing ${testID}`);
  onPress();
};

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

jest.mock("react-native-svg", () => ({
  __esModule: true,
  default: () => null,
  Circle: () => null,
  Path: () => null,
  Rect: () => null,
  G: () => null,
}), { virtual: true });
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-router/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      eventId: "event-1902",
      entityType: "event",
      goingCount: 28,
      capacity: 56,
      privateGuestList: false,
      hideRemainingCount: false,
      sample: [],
    },
  }),
  // [TEST-MOD-APPROVED #2101] Harness registration only — no assertion changes.
  // PublicEventPage now mounts the named-buyer eligibility read, whose
  // auth-scope cache eviction and mutation invalidation need a query client.
  // Stubbed inert so this suite keeps proving exactly what it proved before.
  useQueryClient: () => ({
    cancelQueries: () => Promise.resolve(),
    removeQueries: () => undefined,
    invalidateQueries: () => Promise.resolve(),
    refetchQueries: () => Promise.resolve(),
  }),
}));
// [TEST-MOD-APPROVED #2101] Harness registration only — the transition-overlay
// contract is unrelated to checkout eligibility, so the adapter is pinned to
// its legacy pass-through and the notice renders nothing.
jest.mock("../../../hooks/usePublicTicketCheckoutRouteAccess", () => ({
  usePublicTicketCheckoutRouteAccess: () => ({
    state: "unrestricted",
    canPurchase: true,
    requiresSignIn: false,
    blocked: false,
    retry: () => undefined,
  }),
}));
jest.mock("../TicketCheckoutAccessNotice", () => ({
  TicketCheckoutAccessNotice: () => null,
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useBrandList: () => [],
}));
jest.mock("../../../theme/useThemeFont", () => ({ useThemeFont: () => undefined }));
jest.mock("../../../services/rsvpEvents", () => ({
  submitPublicRsvp: jest.fn(),
  submitRsvpContribution: jest.fn(),
}));
jest.mock("../../../services/rsvpPassRecoveryService", () => ({
  fetchPublicRsvpPassPdf: jest.fn(),
}));
jest.mock("../../../services/socialProofService", () => ({
  socialProofKeys: { summary: (id: string) => ["social-proof", id] },
  fetchSocialProof: jest.fn(),
}));
jest.mock("../../../analytics/webAnalytics", () => ({ captureWeb: jest.fn() }));
jest.mock("../../../constants/publicUrls", () => ({
  checkoutPublicPathWithSeed: () => "/checkout/event-1902",
  eventOgImageUrl: () => "https://example.test/cover.png",
  eventPublicUrl: () => "https://example.test/e/brand/boundary",
}));
jest.mock("../../../utils/eventDateDisplay", () => ({
  formatDraftDateLine: () => "12 Aug",
  formatDraftDateSubline: () => "7 PM",
  formatDraftDatesList: () => [],
  formatEventDoorsTimes: () => ({ open: null, close: null }),
}));
jest.mock("../../../utils/eventCoverMediaRules", () => ({
  isLegacyUnsafeEventCoverVideoUrl: () => false,
}));
jest.mock("../../../types/eventCoverProvider", () => ({
  eventCoverProviderCreditLabel: () => null,
}));
jest.mock("@mingla/phone-input", () => ({
  PhoneInput: () => null,
  COUNTRIES: [{ code: "US", dialCode: "+1" }],
  getCountryByCode: () => ({ dialCode: "+1" }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/ShareModal", () => ({
  ShareModal: ({ visible }: { visible: boolean }) =>
    visible ? <View testID="share-modal" /> : null,
}));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../waitlist/JoinWaitlistSheet", () => ({
  JoinWaitlistSheet: () => <View testID="waitlist-sheet" />,
}));
jest.mock("../SeeWhosGoingGate", () => ({
  __esModule: true,
  default: () => <View testID="see-whos-going-gate" />,
}));
jest.mock("../FoundationEventPreview", () => ({
  FoundationEventPreview: (props: {
    event: { acquisitionState: { kind: string } };
    stateBanner: React.ReactNode;
    onSeeWhosGoing?: () => void;
    onProceedToCart: () => void;
    socialProof: { capacity: number | null; hideRemainingCount: boolean } | null;
  }) => (
    <View testID="ticket-foundation">
      {props.stateBanner}
      <Text testID="ticket-lifecycle">{props.event.acquisitionState.kind}</Text>
      <Text testID="ticket-social-capacity">
        {String(props.socialProof?.capacity ?? "none")}
      </Text>
      {props.onSeeWhosGoing ? (
        <Pressable
          testID="open-ticket-gate"
          accessibilityLabel="See who's going"
          onPress={props.onSeeWhosGoing}
        />
      ) : null}
      <Pressable
        testID="open-waitlist"
        accessibilityLabel="Open waitlist"
        onPress={props.onProceedToCart}
      />
    </View>
  ),
}));
jest.mock("../FoundationRsvpPreview", () => ({
  FoundationRsvpPreview: (props: {
    event: { acquisitionState: { kind: string } };
    stateBanner: React.ReactNode;
    config: { onSeeWhosGoing?: () => void };
    onAcquisitionClosed?: (kind: "ended" | "unavailable") => void;
  }) => (
    <View testID="rsvp-foundation">
      {props.stateBanner}
      {props.config.onSeeWhosGoing ? (
        <Pressable
          testID="open-rsvp-gate"
          accessibilityLabel="See who's going"
          onPress={props.config.onSeeWhosGoing}
        />
      ) : null}
      <Pressable
        testID="server-end-rsvp"
        accessibilityLabel="End RSVP event"
        onPress={() => props.onAcquisitionClosed?.("ended")}
      />
    </View>
  ),
}));
jest.mock("@mingla/offering-rendering", () => {
  const actual = jest.requireActual("@mingla/offering-rendering");
  const lifecycle = jest.requireActual(
    "../../../../../packages/offering-rendering/eventAcquisitionLifecycle",
  );
  const eventBody = jest.requireActual(
    "../../../../../packages/offering-rendering/EventOfferingBody",
  );
  return {
    ...actual,
    ...lifecycle,
    EventAcquisitionNotice: eventBody.EventAcquisitionNotice,
    useResponsiveLayout: () => ({ isDesktop: false }),
    resolveOfferingCta: () => ({
      kind: "waitlist",
      title: "Join waitlist",
      tappable: true,
    }),
  };
});

import { PublicEventPage } from "../PublicEventPage";

const ticket = {
  id: "ticket-1902",
  name: "General",
  description: null,
  priceGbp: 10,
  priceAllInGbp: 11,
  currency: "USD",
  isFree: false,
  isUnlimited: false,
  capacity: 56,
  visibility: "visible",
  passwordProtected: false,
  password: null,
  saleStartAt: null,
  saleEndAt: null,
  approvalRequired: false,
  waitlistEnabled: true,
  availableAt: "online",
  displayOrder: 0,
};
const liveEvent = (eventType: "event" | "rsvp", end: string) => ({
  id: "event-1902",
  name: "Boundary event",
  brandId: "brand-1902",
  brandSlug: "brand",
  eventSlug: "boundary",
  description: "Readable history",
  event_type: eventType,
  status: "scheduled",
  endedAt: null,
  masterStartAtUtc: "1970-01-01T00:00:00.500Z",
  masterEndAtUtc: end,
  timezone: "UTC",
  format: "in-person",
  venueName: "Venue",
  address: "Street",
  hideAddressUntilTicket: false,
  locationGeo: null,
  cityGeo: null,
  coverHue: 20,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaCredit: null,
  coverGallery: [],
  tickets: eventType === "event" ? [ticket] : [],
  currency: "USD",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  themeOverrides: null,
  rsvpCapacity: 56,
  rsvpGoingCount: 28,
  rsvpAllowPlusOnes: false,
  rsvpPlusOnesMax: 0,
  rsvpWaitlistEnabled: true,
  rsvpApprovalMode: "automatic",
  rsvpContributionEnabled: true,
  privateGuestList: false,
  hideRemainingCount: false,
});

const brand = {
  id: "brand-1902",
  slug: "brand",
  displayName: "Brand",
  photo: null,
  theme: null,
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.replaceProperty(Platform, "OS", "web");
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("mounted ticket page removes open waitlist and guest gate at foreground equality", async () => {
  let now = 1_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  let foreground: ((state: string) => void) | null = null;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    foreground = listener as (state: string) => void;
    return { remove: jest.fn() } as never;
  });
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <PublicEventPage
        event={liveEvent("event", "1970-01-01T00:00:02.000Z") as never}
        brand={brand as never}
      />,
    );
  });
  await act(async () => {
    press(tree, "open-ticket-gate");
    press(tree, "open-waitlist");
  });
  expect(tree.root.findAllByProps({ testID: "see-whos-going-gate" }).length).toBeGreaterThan(0);
  expect(tree.root.findAllByProps({ testID: "waitlist-sheet" }).length).toBeGreaterThan(0);

  now = 2_000;
  await act(async () => foreground?.("active"));

  expect(tree.root.findAllByProps({ testID: "see-whos-going-gate" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "waitlist-sheet" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "open-ticket-gate" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "open-waitlist" }).length).toBeGreaterThan(0);
  expect(tree.root.findAllByProps({ testID: "issue-1902-event-acquisition-notice" }).length).toBeGreaterThan(0);
});

test("mounted RSVP page removes its open guest gate on a server-ended transition", async () => {
  jest.spyOn(Date, "now").mockReturnValue(1_000);
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() } as never);
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <PublicEventPage
        event={liveEvent("rsvp", "1970-01-01T00:00:03.000Z") as never}
        brand={brand as never}
      />,
    );
  });
  await act(async () => {
    press(tree, "open-rsvp-gate");
  });
  expect(tree.root.findAllByProps({ testID: "see-whos-going-gate" }).length).toBeGreaterThan(0);

  await act(async () => {
    press(tree, "server-end-rsvp");
  });

  expect(tree.root.findAllByProps({ testID: "see-whos-going-gate" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "open-rsvp-gate" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "issue-1902-rsvp-acquisition-notice" }).length).toBeGreaterThan(0);
});
