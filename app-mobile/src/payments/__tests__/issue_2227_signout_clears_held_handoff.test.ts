/**
 * issue #2227 [paystack payment page] QA F-3 — the held Paystack page must not
 * survive sign-out. Constitution #6: logout clears everything.
 *
 * WHY THIS EXISTS. `nativeCheckoutFlow` holds the buyer's own Paystack
 * authorization URL in a module-level Map so a second tap on the SAME cart
 * re-opens the page they were already given instead of asking the server for a
 * second checkout. That URL is a BEARER CAPABILITY to a live payment page and
 * it is scoped to one buyer. The module refuses to persist it to disk for that
 * reason; the QA on #2227 found that it nevertheless outlived
 * `performPrivateAuthCleanup`, which is the single funnel for sign-out, account
 * switch and JWT expiry.
 *
 * THE ASSERTION IS BEHAVIOURAL, not a grep. The observable for "the hold is
 * gone" is the buyer-visible one: after signing out, the identical cart no
 * longer replays the old page — it goes back to the server for a fresh
 * checkout, and the browser is sent to the NEW url.
 *
 * Fails on revert: delete the `clearAllHeldHandoffs()` call from
 * `performPrivateAuthCleanup` (true line deletion) and both cleanup tests go
 * red — the replay fires, no second create runs, and the browser is handed the
 * previous session's page.
 */

const mockInvoke = jest.fn();
const mockSignOut = jest.fn();
const mockOpenBrowserAsync = jest.fn();
const mockClearUserData = jest.fn();
const mockGetAllKeys = jest.fn();
const mockMultiRemove = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    auth: { signOut: (...a: unknown[]) => mockSignOut(...a) },
  },
}));

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...a: unknown[]) => mockOpenBrowserAsync(...a),
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: {
    CANCEL: "cancel",
    DISMISS: "dismiss",
    OPENED: "opened",
    LOCKED: "locked",
  },
}));

jest.mock("@mingla/payments-native", () => ({
  useStripePaymentSheet: () => ({
    initPaymentSheet: jest.fn(),
    presentPaymentSheet: jest.fn(),
    isPaymentSheetSupported: true,
  }),
}));

jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }));

// --- the auth-cleanup funnel's own collaborators -----------------------------

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getAllKeys: (...a: unknown[]) => mockGetAllKeys(...a),
    multiRemove: (...a: unknown[]) => mockMultiRemove(...a),
  },
}));

jest.mock("../../config/queryClient", () => ({
  queryClient: {
    cancelQueries: jest.fn(() => Promise.resolve()),
    removeQueries: jest.fn(),
    clear: jest.fn(),
  },
}));

jest.mock("../../store/appStore", () => ({
  useAppStore: { getState: () => ({ clearUserData: mockClearUserData }) },
}));

jest.mock("../../utils/queryPersistence", () => ({
  shouldRemoveForAuthChange: () => true,
}));

jest.mock("../../services/appsFlyerService", () => ({
  clearAppsFlyerUserId: jest.fn(),
  resetAppsFlyerDeviceCache: jest.fn(),
}));

jest.mock("../../services/nativeAdAttributionService", () => ({
  clearNativeAdAttribution: jest.fn(() => Promise.resolve()),
}));

jest.mock("../../services/oneSignalService", () => ({ logoutOneSignal: jest.fn() }));
jest.mock("../../services/revenueCatService", () => ({
  logoutRevenueCatIfIdentified: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../services/mixpanelService", () => ({
  mixpanelService: { trackLogout: jest.fn() },
}));
jest.mock("../../services/realtimeService", () => ({
  realtimeService: { clearQueue: jest.fn() },
}));

import { useNativeCheckoutFlow } from "../nativeCheckoutFlow";
import {
  performPrivateAuthCleanup,
  signOutWithPrivateCleanup,
} from "../../utils/authCleanup";

const PAGE_ONE = "https://checkout.paystack.com/BUYER-ONE-PAGE";
const PAGE_TWO = "https://checkout.paystack.com/BUYER-TWO-PAGE";

let seq = 0;
const nextEvent = (): string => `event-f3-${++seq}`;

const inputFor = (eventId: string) => ({
  eventId,
  lines: [{ ticketTypeId: "tt-ga", quantity: 1 }],
  buyer: { name: "Ada Buyer", email: "ada@example.com", phone: "+2348012345678" },
});

const paystackCreate = (eventId: string, authorizationUrl: string) => ({
  data: {
    kind: "requires_paystack_redirect",
    checkoutSessionId: `cs-${eventId}`,
    buyerStatusToken: `bst-${eventId}`,
    authorizationUrl,
    returnUrl: `https://host.usemingla.com/checkout/${eventId}/confirm`,
    reference: `ref-${eventId}`,
    totalCents: 10000,
    currency: "NGN",
  },
  error: null,
});

const countCreates = (): number =>
  mockInvoke.mock.calls.filter((c: unknown[]) => c[0] === "ticket-checkout-create").length;

const openedUrls = (): unknown[] =>
  mockOpenBrowserAsync.mock.calls.map((c: unknown[]) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAllKeys.mockResolvedValue([]);
  mockMultiRemove.mockResolvedValue(undefined);
  mockSignOut.mockResolvedValue({ error: null });
  // `locked` resolves immediately and never polls, so the hold is written and
  // observed without paying the 25-second confirmation window.
  mockOpenBrowserAsync.mockResolvedValue({ type: "locked" });
});

describe("#2227 F-3 — the held payment page dies with the session", () => {
  it("signing out clears it: the same cart creates afresh instead of replaying", async () => {
    const eventId = nextEvent();

    // Buyer one is handed a live Paystack page. It is HELD.
    mockInvoke.mockResolvedValue(paystackCreate(eventId, PAGE_ONE));
    await useNativeCheckoutFlow()(inputFor(eventId));
    expect(countCreates()).toBe(1);
    expect(openedUrls()).toEqual([PAGE_ONE]);

    // Still signed in: the identical cart replays the held page and asks the
    // server for nothing. This is what proves the hold was actually live.
    await useNativeCheckoutFlow()(inputFor(eventId));
    expect(countCreates()).toBe(1);
    expect(openedUrls()).toEqual([PAGE_ONE, PAGE_ONE]);

    // Sign out through the real entry point.
    const result = await signOutWithPrivateCleanup("test: #2227 F-3");
    expect(result.error).toBeNull();
    expect(mockSignOut).toHaveBeenCalledTimes(1);

    // The next buyer on this device rebuilds the identical cart. The old page
    // must be unreachable — a create runs, and the browser gets the NEW url.
    mockInvoke.mockResolvedValue(paystackCreate(eventId, PAGE_TWO));
    await useNativeCheckoutFlow()(inputFor(eventId));
    expect(countCreates()).toBe(2);
    expect(openedUrls()).toEqual([PAGE_ONE, PAGE_ONE, PAGE_TWO]);
    expect(openedUrls()).not.toContain(undefined);
  });

  it("clears on a cleanup that skips the integrations (JWT expiry / account switch)", async () => {
    const eventId = nextEvent();

    mockInvoke.mockResolvedValue(paystackCreate(eventId, PAGE_ONE));
    await useNativeCheckoutFlow()(inputFor(eventId));
    expect(countCreates()).toBe(1);

    // A private-data clear that skips the integrations is still a private-data
    // clear; the hold may not be exempted by that flag.
    await performPrivateAuthCleanup({
      reason: "test: #2227 F-3 no-integrations",
      includeIntegrations: false,
    });

    mockInvoke.mockResolvedValue(paystackCreate(eventId, PAGE_TWO));
    await useNativeCheckoutFlow()(inputFor(eventId));
    expect(countCreates()).toBe(2);
    expect(openedUrls()).toEqual([PAGE_ONE, PAGE_TWO]);
  });

  it("clears EVERY event's hold, not just the last one touched", async () => {
    const eventA = nextEvent();
    const eventB = nextEvent();

    mockInvoke.mockResolvedValue(paystackCreate(eventA, PAGE_ONE));
    await useNativeCheckoutFlow()(inputFor(eventA));
    mockInvoke.mockResolvedValue(paystackCreate(eventB, PAGE_ONE));
    await useNativeCheckoutFlow()(inputFor(eventB));
    expect(countCreates()).toBe(2);

    await performPrivateAuthCleanup({ reason: "test: #2227 F-3 all events" });

    mockInvoke.mockResolvedValue(paystackCreate(eventA, PAGE_TWO));
    await useNativeCheckoutFlow()(inputFor(eventA));
    mockInvoke.mockResolvedValue(paystackCreate(eventB, PAGE_TWO));
    await useNativeCheckoutFlow()(inputFor(eventB));

    expect(countCreates()).toBe(4);
    expect(openedUrls()).toEqual([PAGE_ONE, PAGE_ONE, PAGE_TWO, PAGE_TWO]);
  });
});
