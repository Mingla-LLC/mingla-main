// MINGLA-INVARIANT: I-ADDON-RSVP-PICKS-GO-WITH-GOING | issue #3281 | On the public RSVP page a guest can pick only the RSVP's free add-ons, only while the Host add-ons switch is on and the RSVP reader lists them, and the picks are sent only with a Going reply.
/**
 * issue #3281 S6 (checkpoint 16) — free RSVP add-ons on the public RSVP page
 * (Host web / buyer web, PublicEventPage).
 *
 * Renders the REAL PublicEventPage with the add-ons switch ON. The shared RSVP
 * surface (FoundationRsvpPreview) is a probe that records the props the page
 * hands it and draws the page's own add-on picker slot (the REAL lazy picker
 * from components/addOns: RsvpAddOnsOnUse -> the shared RsvpAddOnsPicker).
 *
 * FAILS-ON-REVERT: drop the `rsvpAddOns:` line from the page's
 * submitPublicRsvp call, send it for Maybe, drop the priceCents filter in
 * freeRsvpAddOns, or stop reporting readiness -> red.
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
  return { ...actual, featureFlags: { ...actual.featureFlags, extras: true } };
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

test("the page reads the RSVP's add-ons and hands the card list and the picker to the RSVP surface", async () => {
  await renderPage();
  expect(queries).toContainEqual({ key: ["public-rsvp-add-ons", "lanternroom", "night"], enabled: true });
  expect(typeof probe.props?.addOns).toBe("function");
  expect(probe.props?.rsvpAddOns).toBe(READER_LIST);
  expect(typeof probe.props?.addOnsNode).toBe("function");
  expect(probe.props?.addOnsReady).toBe(true);
});

test("only free add-ons can be picked; a paid one is not offered", async () => {
  const tree = await renderPage();
  expect(pressablesLabelled(tree, "Add one Reserved seat to your RSVP")).toHaveLength(1);
  expect(pressablesLabelled(tree, "Add one Tee to your RSVP")).toHaveLength(1);
  expect(pressablesLabelled(tree, "Add one Drinks package to your RSVP")).toHaveLength(0);
  const text = tree.root.findAll((n) => n.type === "Text").map(textOf).join(" | ");
  expect(text).not.toContain("Drinks package");
});

test("a Going reply sends the picks and the confirmation lists them by name", async () => {
  const tree = await renderPage();
  await act(async () => {
    (pressablesLabelled(tree, "Add one Tee to your RSVP")[0].props.onPress as () => void)();
  });
  await act(async () => {
    (pressablesLabelled(tree, "Add one Reserved seat to your RSVP")[0].props.onPress as () => void)();
  });
  let result: { rsvpAddOns?: unknown } | undefined;
  await act(async () => {
    result = await probe.props!.onSubmit(going);
  });
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  const sent = mockSubmit.mock.calls[0][0] as { rsvpAddOns?: unknown };
  expect(sent.rsvpAddOns).toEqual([
    { addOnId: SEAT, quantity: 1 },
    { addOnId: TEE, quantity: 1 },
  ]);
  expect(result?.rsvpAddOns).toEqual([
    { name: "Reserved seat", quantity: 1 },
    { name: "Tee", quantity: 1 },
  ]);
});

test("Maybe and Can't go never send add-ons", async () => {
  const tree = await renderPage();
  await act(async () => {
    (pressablesLabelled(tree, "Add one Tee to your RSVP")[0].props.onPress as () => void)();
  });
  mockSubmit.mockResolvedValue({ ...accepted, status: "maybe" });
  await act(async () => {
    await probe.props!.onSubmit({ ...going, rsvpStatus: "maybe" });
  });
  await act(async () => {
    await probe.props!.onSubmit({ ...going, rsvpStatus: "not_going" });
  });
  expect((mockSubmit.mock.calls[0][0] as { rsvpAddOns?: unknown }).rsvpAddOns).toBeUndefined();
  expect((mockSubmit.mock.calls[1][0] as { rsvpAddOns?: unknown }).rsvpAddOns).toBeUndefined();
});

test("a Going reply with no picks sends none", async () => {
  await renderPage();
  await act(async () => {
    await probe.props!.onSubmit(going);
  });
  expect((mockSubmit.mock.calls[0][0] as { rsvpAddOns?: unknown[] }).rsvpAddOns).toBeUndefined();
});

test("picks above what a smaller party may take hold Going back until the guest picks fewer", async () => {
  probe.partySize = 2;
  const tree = await renderPage();
  const addTee = (): void => (pressablesLabelled(tree, "Add one Tee to your RSVP")[0].props.onPress as () => void)();
  await act(async () => addTee());
  await act(async () => addTee());
  await act(async () => addTee());
  await act(async () => addTee());
  expect(probe.props?.addOnsReady).toBe(true);
  // The plus-one leaves: 4 tees, but a party of one may take 2.
  probe.partySize = 1;
  await act(async () => {
    tree.update(<PublicEventPage event={rsvpEvent as never} brand={brand as never} />);
  });
  await flush();
  expect(probe.props?.addOnsReady).toBe(false);
  const alert = tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === "issue-3281-rsvp-add-ons-over-limit");
  expect(alert.length).toBeGreaterThan(0);
  const removeTee = (): void => (pressablesLabelled(tree, "Remove one Tee from your RSVP")[0].props.onPress as () => void)();
  await act(async () => removeTee());
  await act(async () => removeTee());
  await flush();
  expect(probe.props?.addOnsReady).toBe(true);
});

test("an RSVP whose reader lists no add-ons gets no picker and sends none", async () => {
  mockReader.rsvpAddOns = null;
  await renderPage();
  expect(probe.props?.addOnsNode).toBeUndefined();
  expect(probe.props?.rsvpAddOns).toBeUndefined();
});
