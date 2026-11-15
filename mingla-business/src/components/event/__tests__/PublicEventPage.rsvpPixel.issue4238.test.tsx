// Enforces I-4238-RSVP-CONVERSION-PAIRED (browser half; the invariant line is on
// supabase/functions/public-submit-rsvp/issue_4238_rsvp_conversion.test.ts).
/**
 * #4238 W2-5 (D7, RSVP part): a going / waitlisted public RSVP fires the
 * browser free sign-up with the RSVP id the server uses, so the pair
 * deduplicates. Harness copied from rsvp_public_page_status_and_restore.test.tsx:
 * the REAL PublicEventPage under react-test-renderer, the RSVP surface replaced
 * by a probe that exposes the page's onSubmit.
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


const routeParams: { contribution?: string } = {};
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

type SubmitInput = {
  rsvpStatus: "going" | "not_going" | "maybe";
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  plusCount: number;
  guests: never[];
};
type ProbeProps = {
  onSubmit: (input: SubmitInput) => Promise<unknown>;
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

// [TEST-MOD-APPROVED #3682] Shared Follow double — PublicEventPage mounts
// useBrandFollow; without this the suite loads brandFollowsService → supabase.
jest.mock(
  "../../../hooks/useBrandFollow",
  () => require("./harness/useBrandFollow.publicEventPage.mock"),
);

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
const mockSubmitPublicRsvp = jest.fn();
jest.mock("../../../services/rsvpEvents", () => ({
  submitPublicRsvp: (...args: unknown[]) => mockSubmitPublicRsvp(...args),
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
const mockFireAdReservation = jest.fn();
jest.mock("../../../analytics/webAnalytics", () => ({
  captureWeb: jest.fn(),
  fireAdReservation: (...args: unknown[]) => mockFireAdReservation(...args),
}));
jest.mock("../../ui/Sheet", () => ({ Sheet: () => null }));
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
          accessibilityLabel="Resolve guest RSVP for the page-state test"
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

const renderPage = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <PublicEventPage event={rsvpEvent as never} brand={brand as never} />,
    );
  });
  return tree;
};

const submit = async (rsvpStatus: SubmitInput["rsvpStatus"]): Promise<void> => {
  await act(async () => {
    await probe.props?.onSubmit({
      rsvpStatus,
      guestName: "Ada",
      guestEmail: "ada@example.com",
      guestPhone: "+15555550100",
      plusCount: 0,
      guests: [],
    });
  });
};

const result = (status: string) => ({
  status,
  approvalStatus: "approved",
  rsvpId: "rsvp-4238",
  confirmationToken: null,
  credentials: [],
  anonymousRecovery: [],
  claim: null,
});

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
  (globalThis as { window?: unknown }).window = {
    sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  };
  probe.props = null;
  mockSubmitPublicRsvp.mockReset();
  mockFireAdReservation.mockReset();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  jest.restoreAllMocks();
});

test("W2-5: a going result fires the browser free sign-up with the returned rsvp id", async () => {
  mockSubmitPublicRsvp.mockResolvedValue(result("going"));
  await renderPage();
  await submit("going");
  expect(mockFireAdReservation).toHaveBeenCalledTimes(1);
  expect(mockFireAdReservation).toHaveBeenCalledWith("rsvp-4238", {
    value: 0,
    currency: "USD",
    contentId: EVENT_ID,
    brandId: "brand-1",
  });
});

test("W2-5: a waitlisted result fires it too", async () => {
  mockSubmitPublicRsvp.mockResolvedValue(result("waitlisted"));
  await renderPage();
  await submit("going");
  expect(mockFireAdReservation).toHaveBeenCalledWith("rsvp-4238", expect.objectContaining({ value: 0 }));
});

test("W2-5: maybe and not going fire nothing", async () => {
  for (const status of ["maybe", "not_going"] as const) {
    mockSubmitPublicRsvp.mockResolvedValue(result(status));
    const tree = await renderPage();
    await submit(status);
    tree.unmount();
  }
  expect(mockFireAdReservation).not.toHaveBeenCalled();
});
