/**
 * Public RSVP page adapter (PublicEventPage) — the top status pill, the
 * visibility settings it threads, and the anonymous guest's reply surviving a
 * full-page chip-in redirect.
 *
 * Renders the REAL PublicEventPage with react-test-renderer. The shared RSVP
 * surface (FoundationRsvpPreview) is replaced by a probe that records the props
 * the page hands it and renders the page's own state banner.
 */

import React from "react";
import { Platform, Pressable, Text, View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<TestNode | string>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = { root: TestNode; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const routeParams: { contribution?: string } = {};
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

type ProbeProps = {
  stateBanner: React.ReactNode;
  config: { visibility?: unknown; discoverable?: unknown };
  restoredRsvp: { rsvpId: string } | null;
  onRsvpResolved: (snapshot: unknown) => void;
  contributionState?: string;
};
const probe: { props: ProbeProps | null } = { props: null };

const mockFetchPassMetadata = jest.fn();

jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Circle: () => null, Path: () => null, Rect: () => null, G: () => null }),
  { virtual: true },
);
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => routeParams,
}));
jest.mock("expo-router/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({
    cancelQueries: () => Promise.resolve(),
    removeQueries: () => undefined,
    invalidateQueries: () => Promise.resolve(),
    refetchQueries: () => Promise.resolve(),
  }),
}));
jest.mock("../../../hooks/usePublicTicketCheckoutRouteAccess", () => ({
  usePublicTicketCheckoutRouteAccess: () => ({
    state: "unrestricted",
    canPurchase: true,
    requiresSignIn: false,
    blocked: false,
    retry: () => undefined,
  }),
}));
jest.mock("../TicketCheckoutAccessNotice", () => ({ TicketCheckoutAccessNotice: () => null }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("../../../store/currentBrandStore", () => ({ useBrandList: () => [] }));
jest.mock("../../../theme/useThemeFont", () => ({ useThemeFont: () => undefined }));
jest.mock("../../../services/rsvpEvents", () => ({
  submitPublicRsvp: jest.fn(),
  submitRsvpContribution: jest.fn(),
}));
jest.mock("../../../services/rsvpPassRecoveryService", () => ({
  fetchPublicRsvpPassPdf: jest.fn(),
  fetchPublicRsvpPassMetadata: (...args: unknown[]) => mockFetchPassMetadata(...args),
}));
jest.mock("../../../services/socialProofService", () => ({
  socialProofKeys: { summary: (id: string) => ["social-proof", id] },
  fetchSocialProof: jest.fn(),
}));
jest.mock("../../../analytics/webAnalytics", () => ({ captureWeb: jest.fn() }));
jest.mock("../../../constants/publicUrls", () => ({
  checkoutPublicPathWithSeed: () => "/checkout/event-rsvp",
  eventOgImageUrl: () => "https://example.test/cover.png",
  eventPublicUrl: () => "https://example.test/e/lanternroom/night",
  eventPublicPath: () => "/e/lanternroom/night",
}));
jest.mock("../../../utils/eventDateDisplay", () => ({
  formatDraftDateLine: () => "Sat 26 Sept",
  formatDraftDateSubline: () => "7 PM – 10 PM",
  formatDraftDatesList: () => [],
  formatEventDoorsTimes: () => ({ open: null, close: null }),
}));
jest.mock("../../../utils/eventCoverMediaRules", () => ({ isLegacyUnsafeEventCoverVideoUrl: () => false }));
jest.mock("../../../types/eventCoverProvider", () => ({ eventCoverProviderCreditLabel: () => null }));
jest.mock("@mingla/phone-input", () => ({
  PhoneInput: () => null,
  COUNTRIES: [{ code: "US", dialCode: "+1" }],
  getCountryByCode: () => ({ dialCode: "+1" }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/ShareModal", () => ({ ShareModal: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../waitlist/JoinWaitlistSheet", () => ({ JoinWaitlistSheet: () => null }));
jest.mock("../SeeWhosGoingGate", () => ({ __esModule: true, default: () => null }));
jest.mock("../FoundationEventPreview", () => ({ FoundationEventPreview: () => null }));
jest.mock("../FoundationRsvpPreview", () => ({
  FoundationRsvpPreview: (props: ProbeProps) => {
    probe.props = props;
    return (
      <View testID="rsvp-probe">
        {props.stateBanner}
        <Text testID="probe-restored">{props.restoredRsvp?.rsvpId ?? "none"}</Text>
        <Pressable
          testID="probe-resolve"
          onPress={() =>
            props.onRsvpResolved({
              version: 1,
              eventId: "event-rsvp",
              rsvpId: "rsvp-new",
              guestStatus: "maybe",
              guestApproval: "approved",
              details: null,
              savedAtMs: NOW,
            })
          }
        />
      </View>
    );
  },
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
  };
});

import { PublicEventPage } from "../PublicEventPage";

// 2026-09-15 07:00Z; the event starts 2026-09-26 23:00Z (11 days 16 hours later).
const NOW = Date.parse("2026-09-15T07:00:00Z");
const EVENT_ID = "event-rsvp";
const STORAGE_KEY = `mingla.rsvp.guest.v1:${EVENT_ID}`;

const rsvpEvent = {
  id: EVENT_ID,
  name: "Neighbors Night on Wythe",
  brandId: "brand-1",
  brandSlug: "lanternroom",
  eventSlug: "night",
  description: "A free night for the block.",
  event_type: "rsvp",
  status: "scheduled",
  endedAt: null,
  masterStartAtUtc: "2026-09-26T23:00:00+00:00",
  masterEndAtUtc: "2026-09-27T02:00:00+00:00",
  timezone: "America/New_York",
  format: "in-person",
  venueName: "Lantern Room",
  address: "61 Wythe Avenue",
  hideAddressUntilTicket: false,
  locationGeo: null,
  cityGeo: null,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaCredit: null,
  coverGallery: [],
  tickets: [],
  currency: "USD",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  themeOverrides: null,
  visibility: "public",
  rsvpDiscoverable: true,
  rsvpCapacity: 80,
  rsvpGoingCount: 2,
  rsvpAllowPlusOnes: true,
  rsvpPlusOnesMax: 1,
  rsvpWaitlistEnabled: true,
  rsvpApprovalMode: "auto",
  rsvpContributionEnabled: true,
  privateGuestList: false,
  hideRemainingCount: false,
};
const brand = { id: "brand-1", slug: "lanternroom", displayName: "Lantern Room", photo: null, theme: null };

const goingSnapshot = JSON.stringify({
  version: 1,
  eventId: EVENT_ID,
  rsvpId: "rsvp-restored",
  guestStatus: "going",
  guestApproval: "approved",
  details: {
    eventName: "Neighbors Night on Wythe",
    dateLine: "Sat 26 Sept",
    venueLine: "Lantern Room",
    guestName: "Ada",
    status: "going",
    plusGuests: [],
    confirmationToken: null,
    credentials: [
      { entityType: "primary", entityId: "rsvp-restored", displayName: "Ada", qrCode: "q", pdfFetchRef: "r" },
    ],
    anonymousRecovery: [
      { entityType: "primary", entityId: "rsvp-restored", recoveryToken: "tok", recoveryUrl: null },
    ],
  },
  savedAtMs: NOW - 60_000,
});

const storage = new Map<string, string>();
const sessionStorageStub = {
  getItem: jest.fn((key: string) => storage.get(key) ?? null),
  setItem: jest.fn((key: string, value: string) => void storage.set(key, value)),
  removeItem: jest.fn((key: string) => void storage.delete(key)),
};

const renderPage = async (eventOverrides: Record<string, unknown> = {}): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <PublicEventPage event={{ ...rsvpEvent, ...eventOverrides } as never} brand={brand as never} />,
    );
  });
  return tree;
};
const bannerText = (tree: Renderer): string | null => {
  const label = tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === "rsvp-status-banner-label")[0];
  return label === undefined ? null : textOf(label);
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.replaceProperty(Platform, "OS", "web");
  storage.clear();
  sessionStorageStub.getItem.mockClear();
  sessionStorageStub.setItem.mockClear();
  sessionStorageStub.removeItem.mockClear();
  (globalThis as { window?: unknown }).window = { sessionStorage: sessionStorageStub };
  delete routeParams.contribution;
  probe.props = null;
  mockFetchPassMetadata.mockReset();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("an open RSVP shows a countdown to its start, never the ticket 'Not on sale yet'", async () => {
  const tree = await renderPage();
  expect(bannerText(tree)).toBe("Starts in 11 days");
  const allText = tree.root.findAll((n) => n.type === "Text").map(textOf);
  expect(allText).not.toContain("Not on sale yet");
});

test("the pill follows the clock: hours on the day, then happening now", async () => {
  (Date.now as jest.Mock).mockReturnValue(Date.parse("2026-09-26T18:00:00Z"));
  const dayOf = await renderPage();
  expect(bannerText(dayOf)).toBe("Starts in 5 hours");
  dayOf.unmount();

  (Date.now as jest.Mock).mockReturnValue(Date.parse("2026-09-27T00:00:00Z"));
  const live = await renderPage();
  expect(bannerText(live)).toBe("Happening now");
});

test("a full guest list with the waitlist on says so", async () => {
  const tree = await renderPage({ rsvpGoingCount: 80 });
  expect(bannerText(tree)).toBe("Guest list full · Join the waitlist");
});

test("the page hands the RSVP surface the event's visibility and discovery settings", async () => {
  await renderPage();
  expect(probe.props?.config.visibility).toBe("public");
  expect(probe.props?.config.discoverable).toBe(true);
});

test("a Stripe return marks the chip-in as paid for the surface", async () => {
  routeParams.contribution = "paid";
  await renderPage();
  expect(probe.props?.contributionState).toBe("paid");
});

test("an accepted reply is kept in sessionStorage for this event", async () => {
  const tree = await renderPage();
  const resolve = tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === "probe-resolve")[0];
  await act(async () => {
    (resolve.props.onPress as () => void)();
  });
  expect(sessionStorageStub.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.stringContaining('"rsvpId":"rsvp-new"'));
});

test("a kept Going reply is restored on return and stays when the pass endpoint confirms it", async () => {
  storage.set(STORAGE_KEY, goingSnapshot);
  mockFetchPassMetadata.mockResolvedValue({ entityType: "primary" });
  const tree = await renderPage();
  expect(probe.props?.restoredRsvp?.rsvpId).toBe("rsvp-restored");
  expect(mockFetchPassMetadata).toHaveBeenCalledWith("primary", "rsvp-restored", "tok");
  await act(async () => {
    await Promise.resolve();
  });
  const restored = tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === "probe-restored")[0];
  expect(textOf(restored)).toBe("rsvp-restored");
  expect(sessionStorageStub.removeItem).not.toHaveBeenCalled();
});

test("a kept reply the pass endpoint rejects is dropped (back to the invite)", async () => {
  storage.set(STORAGE_KEY, goingSnapshot);
  mockFetchPassMetadata.mockRejectedValue({ context: { status: 403 } });
  await renderPage();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(probe.props?.restoredRsvp).toBeNull();
  expect(sessionStorageStub.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
});

test("a network failure while verifying keeps the reply", async () => {
  storage.set(STORAGE_KEY, goingSnapshot);
  mockFetchPassMetadata.mockRejectedValue(new Error("offline"));
  await renderPage();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(probe.props?.restoredRsvp?.rsvpId).toBe("rsvp-restored");
});

test("native surfaces never read tab storage", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  storage.set(STORAGE_KEY, goingSnapshot);
  await renderPage();
  expect(probe.props?.restoredRsvp).toBeNull();
  expect(sessionStorageStub.getItem).not.toHaveBeenCalled();
});
