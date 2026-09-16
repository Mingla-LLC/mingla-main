/** #3440 independent tester: mounted page + real shared reply owner.
 * Only native primitives, transport and layout shell are stubbed.
 * Identity changes and deferred denials exercise real page effects/state.
 * CI: required mingla-business full Jest suite; no bespoke config.
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
type Renderer = { root: TestNode; update: (node: React.ReactElement) => void; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const routeParams: { contribution?: string } = {};
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

const mockFetchPassMetadata = jest.fn();
const mockSubmitPublicRsvp = jest.fn();
const mockAuth: { user: { id: string } | null } = { user: null };
const captured: { state: import('@mingla/offering-rendering/RsvpOfferingBody').RsvpOfferingState | null } = { state: null };
jest.mock('react-native', () => {
  const base = jest.requireActual('../../../../__manual_mocks__/react-native.js');
  const curve = (t: number): number => t;
  return { ...base, Easing: { inOut: () => curve, out: () => curve, in: () => curve, ease: curve, linear: curve }, AccessibilityInfo: { announceForAccessibility: () => undefined } };
});

jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Circle: () => null, Path: () => null, Rect: () => null, G: () => null }),
  { virtual: true },
);
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }), { virtual: true });
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
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../../store/currentBrandStore", () => ({ useBrandList: () => [] }));
jest.mock("../../../theme/useThemeFont", () => ({ useThemeFont: () => undefined }));
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
jest.mock('../FoundationRsvpPreview', () => ({
  FoundationRsvpPreview: (props: import('../FoundationRsvpPreview').FoundationRsvpPreviewProps) => {
    const actual = jest.requireActual('@mingla/offering-rendering/RsvpOfferingBody');
    const state = actual.useRsvpOfferingState(props);
    captured.state = state;
    return <View>{props.stateBanner}<actual.RsvpDecisionBox palette={props.palette} theme={props.theme} config={props.config} state={state} />{state.successPopup}</View>;
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
const nodes = (tree: Renderer, testID: string): TestNode[] =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID);
const replyLabel = (tree: Renderer): unknown => nodes(tree, 'orch-1150-rsvp-going')[0]?.props.accessibilityLabel;
const updatePage = async (tree: Renderer, overrides: Record<string, unknown> = {}): Promise<void> => {
  await act(async () => { tree.update(<PublicEventPage event={{ ...rsvpEvent, ...overrides } as never} brand={brand as never} />); });
};
const rejectable = (): { promise: Promise<never>; reject: (error: unknown) => void } => {
  let reject!: (error: unknown) => void;
  const promise = new Promise<never>((_resolve, fail) => { reject = fail; });
  return { promise, reject };
};
const trees: Renderer[] = [];
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.replaceProperty(Platform, 'OS', 'web');
  storage.clear();
  jest.clearAllMocks();
  (globalThis as { window?: unknown }).window = { sessionStorage: sessionStorageStub };
  mockAuth.user = null;
  mockFetchPassMetadata.mockReset().mockResolvedValue({ entityType: 'primary' });
  mockSubmitPublicRsvp.mockReset();
  captured.state = null;
});
afterEach(async () => {
  await act(async () => { trees.splice(0).forEach((tree) => tree.unmount()); });
  delete (globalThis as { window?: unknown }).window;
  jest.useRealTimers();
  jest.restoreAllMocks();
});
const mount = async (): Promise<Renderer> => {
  const tree = await renderPage();
  trees.push(tree);
  return tree;
};

test('tester guard: restored pass reopens with the original credential, without submitting again', async () => {
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  expect(replyLabel(tree)).toBe("You're going");
  const pass = nodes(tree, 'rsvp-view-pass')[0];
  expect(pass).toBeDefined();
  await act(async () => { (pass.props.onPress as () => void)(); });
  const popup = captured.state?.successPopup as React.ReactElement<{ children: React.ReactElement<{ visible: boolean; details: { credentials: { entityId: string }[] } }> }>;
  expect(popup.props.children.props.visible).toBe(true);
  expect(popup.props.children.props.details.credentials[0].entityId).toBe('rsvp-restored');
  expect(mockSubmitPublicRsvp).not.toHaveBeenCalled();
});

test('same mounted page must not show event A pass on event B', async () => {
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  expect(replyLabel(tree)).toBe("You're going");
  await updatePage(tree, { id: 'event-b', eventSlug: 'event-b', name: 'Different event' });
  expect(replyLabel(tree)).toBe('Going');
  expect(nodes(tree, 'rsvp-view-pass')).toHaveLength(0);
});

test('same mounted page must not carry anonymous pass into a different signed-in account', async () => {
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  expect(replyLabel(tree)).toBe("You're going");
  mockAuth.user = { id: 'other-account' };
  await updatePage(tree);
  expect(nodes(tree, 'rsvp-view-pass')).toHaveLength(0);
  expect(replyLabel(tree)).toBe('Going');
});

test('logout must not leave the previous account pass on the same mounted page', async () => {
  mockAuth.user = { id: 'account-a' };
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  mockAuth.user = null;
  await updatePage(tree);
  expect(nodes(tree, 'rsvp-view-pass')).toHaveLength(0);
  expect(replyLabel(tree)).toBe('Going');
});

test('clearing the page on logout must not restore the previous account pass on remount', async () => {
  mockAuth.user = { id: 'account-a' };
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  expect(replyLabel(tree)).toBe("You're going");
  mockAuth.user = null;
  await updatePage(tree);
  await act(async () => { tree.unmount(); });
  trees.splice(trees.indexOf(tree), 1);
  const returned = await mount();
  expect(nodes(returned, 'rsvp-view-pass')).toHaveLength(0);
  expect(replyLabel(returned)).toBe('Going');
});

test.each([403, 404, 409])('late %s from an old restore must not erase a newly accepted reply', async (status) => {
  const pending = rejectable();
  mockFetchPassMetadata.mockReturnValue(pending.promise);
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  mockSubmitPublicRsvp.mockResolvedValue({ status: 'not_going', approvalStatus: 'approved', rsvpId: 'new-reply', confirmationToken: null, credentials: [], anonymousRecovery: [] });
  await act(async () => { captured.state?.onNotGoing(); });
  expect(mockSubmitPublicRsvp).toHaveBeenCalledTimes(1);
  expect(JSON.parse(storage.get(STORAGE_KEY)!).rsvpId).toBe('new-reply');
  await act(async () => { pending.reject({ context: { status } }); });
  // UI ownership and tab persistence must both retain the newer accepted reply.
  expect(captured.state?.guestStatus).toBe('not_going');
  expect(storage.has(STORAGE_KEY)).toBe(true);
  expect(JSON.parse(storage.get(STORAGE_KEY)!).rsvpId).toBe('new-reply');
});

test.each([403, 404, 409])('definitive %s with no newer reply returns the mounted owner to an invite', async (status) => {
  const pending = rejectable();
  mockFetchPassMetadata.mockReturnValue(pending.promise);
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  expect(replyLabel(tree)).toBe("You're going");
  await act(async () => { pending.reject({ context: { status } }); });
  expect(replyLabel(tree)).toBe('Going');
  expect(nodes(tree, 'rsvp-view-pass')).toHaveLength(0);
  expect(storage.has(STORAGE_KEY)).toBe(false);
});

test('transient network failure retains the actual mounted pass', async () => {
  mockFetchPassMetadata.mockRejectedValue(new Error('offline'));
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  expect(replyLabel(tree)).toBe("You're going");
  expect(nodes(tree, 'rsvp-view-pass').length).toBeGreaterThan(0);
  expect(storage.has(STORAGE_KEY)).toBe(true);
});

test.each(['ios', 'android'] as const)('%s shared reply owner never consumes web tab credentials', async (platform) => {
  jest.replaceProperty(Platform, 'OS', platform);
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  expect(replyLabel(tree)).toBe('Going');
  expect(nodes(tree, 'rsvp-view-pass')).toHaveLength(0);
  expect(sessionStorageStub.getItem).not.toHaveBeenCalled();
  expect(mockFetchPassMetadata).not.toHaveBeenCalled();
});

test.each([403, 404, 409])('late %s must close an already opened invalidated pass', async (status) => {
  const pending = rejectable();
  mockFetchPassMetadata.mockReturnValue(pending.promise);
  storage.set(STORAGE_KEY, goingSnapshot);
  const tree = await mount();
  await act(async () => { (nodes(tree, 'rsvp-view-pass')[0].props.onPress as () => void)(); });
  await act(async () => { pending.reject({ context: { status } }); });
  expect(replyLabel(tree)).toBe('Going');
  const popup = captured.state?.successPopup as React.ReactElement<{ children: React.ReactElement<{ visible: boolean; details: unknown }> }>;
  expect(popup.props.children.props.visible).toBe(false);
  expect(popup.props.children.props.details).toBeNull();
});
