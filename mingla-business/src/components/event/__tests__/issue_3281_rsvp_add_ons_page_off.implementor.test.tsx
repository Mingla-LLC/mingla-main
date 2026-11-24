/**
 * issue #3281 S6 (checkpoint 16) — with EXPO_PUBLIC_FF_EXTRAS_ENABLED off (the
 * default) the public RSVP page is unchanged: no add-on read, no card list, no
 * picker, and a Going reply sends no add-ons. Companion of
 * issue_3281_rsvp_add_ons_page.implementor.test.tsx (switch on).
 *
 * Renders the REAL PublicEventPage with the add-ons switch OFF. The shared RSVP
 * surface (FoundationRsvpPreview) is a probe that records the props the page
 * hands it and draws the page's own add-on picker slot (the REAL lazy picker
 * from components/addOns: RsvpAddOnsOnUse -> the shared RsvpAddOnsPicker).
 *
 * FAILS-ON-REVERT: read the add-ons, or hand over the picker, while the
 * switch is off (drop the flag check in publicAddOnsSlot) -> red.
 */

import React from "react";
import { Platform, View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<TestNode | string>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = { root: TestNode; unmount: () => void; update: (node: React.ReactElement) => void };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

type SubmitInput = {
  rsvpStatus: "going" | "not_going" | "maybe";
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  plusCount: number;
  guests: unknown[];
};
type ProbeProps = {
  addOns?: unknown;
  rsvpAddOns?: unknown;
  addOnsReady?: boolean;
  addOnsNode?: (partySize: number) => React.ReactNode;
  onSubmit: (input: SubmitInput) => Promise<{ rsvpAddOns?: unknown }>;
};
const probe: { props: ProbeProps | null; partySize: number } = { props: null, partySize: 1 };
const queries: Array<{ key: readonly unknown[]; enabled: boolean }> = [];
const mockReader: { rsvpAddOns: unknown } = { rsvpAddOns: undefined };
const mockSubmit = jest.fn();

jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("../../../config/featureFlags", () => {
  const actual = jest.requireActual("../../../config/featureFlags") as { featureFlags: Record<string, unknown> };
  return { ...actual, featureFlags: { ...actual.featureFlags, extras: false } };
});

const routeParams: { contribution?: string } = {};
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

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
  useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    queries.push({ key: options.queryKey, enabled: options.enabled !== false });
    return {
      data:
        options.queryKey[0] === "public-rsvp-add-ons" && options.enabled !== false
          ? mockReader.rsvpAddOns
          : undefined,
    };
  },
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
jest.mock("../../../services/rsvpEvents", () => ({
  submitPublicRsvp: (...args: unknown[]) => mockSubmit(...args),
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
    return <View testID="rsvp-probe">{props.addOnsNode?.(probe.partySize)}</View>;
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

const EVENT_ID = "event-rsvp";
const SEAT = "3281c160-0000-4000-8000-000000000001";
const TEE = "3281c160-0000-4000-8000-000000000002";
const DRINKS = "3281c160-0000-4000-8000-000000000003";
const item = (id: string, name: string, priceCents: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: null,
  priceCents,
  priceAllInCents: priceCents,
  maxPerTicket: 1,
  isUnlimited: true,
  validOccurrenceIds: null,
  remaining: null,
  showOnPublicPage: true,
  photoPath: null,
  photoThumbPath: null,
  ...extra,
});
const READER_LIST = [
  item(SEAT, "Reserved seat", 0, { isUnlimited: false, remaining: 5 }),
  item(TEE, "Tee", 0, { maxPerTicket: 2 }),
  item(DRINKS, "Drinks package", 1500),
];

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


const pressablesLabelled = (tree: Renderer, label: string): TestNode[] =>
  tree.root.findAll(
    (n) => typeof n.type !== "string" && n.props.accessibilityLabel === label && typeof n.props.onPress === "function",
  );
const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};
const renderPage = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<PublicEventPage event={rsvpEvent as never} brand={brand as never} />);
  });
  await flush();
  return tree;
};
const going: SubmitInput = {
  rsvpStatus: "going",
  guestName: "Ada",
  guestEmail: "ada@example.test",
  guestPhone: "+15550000000",
  plusCount: 0,
  guests: [],
};
const accepted = {
  status: "going",
  approvalStatus: "approved",
  rsvpId: "rsvp-1",
  confirmationToken: null,
  acknowledgement: "accepted",
  credentials: [],
  anonymousRecovery: [],
  claim: null,
  guests: [],
};

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
  probe.props = null;
  probe.partySize = 1;
  queries.length = 0;
  mockReader.rsvpAddOns = READER_LIST;
  mockSubmit.mockReset();
  mockSubmit.mockResolvedValue(accepted);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("switch off: no add-on read, no card list, no picker; Going sends no add-ons", async () => {
  const tree = await renderPage();
  const read = queries.filter((q) => q.key[0] === "public-rsvp-add-ons");
  expect(read.length).toBeGreaterThan(0);
  expect(read.every((q) => q.enabled === false)).toBe(true);
  expect(probe.props?.addOns).toBeNull();
  expect(probe.props?.rsvpAddOns).toBeUndefined();
  expect(probe.props?.addOnsNode).toBeUndefined();
  expect(probe.props?.addOnsReady).toBe(true);
  expect(tree.root.findAll((n) => n.props.testID === "issue-3281-rsvp-add-ons")).toHaveLength(0);
  await act(async () => {
    await probe.props!.onSubmit(going);
  });
  expect((mockSubmit.mock.calls[0][0] as { rsvpAddOns?: unknown[] }).rsvpAddOns).toBeUndefined();
});
