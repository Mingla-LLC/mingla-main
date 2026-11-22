// @ts-nocheck
/**
 * #4490 Explorer W4 — Constitution rule 6, logout clears everything: the
 * sign-out funnel (`performPrivateAuthCleanup`, also account switch and JWT
 * expiry) deletes the venue checkout recovery pointer
 * (`mingla_venue_checkout_recovery_v1`) and the held venue payment page.
 *
 * BEHAVIOURAL: the pointer is written through the real module into a stand-in
 * SecureStore, the real cleanup runs, and the store is read back.
 *
 * FAILS-ON-REVERT: remove `clearVenueCheckoutRecovery()` from
 * `purgeNativeCheckoutRecovery` and S-1 fails.
 */
const mockSecure = new Map<string, string>();

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("../../lib/secureStoreSafe", () => ({
  isSecureStoreAvailable: () => true,
  secureGetItem: async (k: string) => (mockSecure.has(k) ? mockSecure.get(k) : null),
  secureSetItem: async (k: string, v: string) => {
    mockSecure.set(k, v);
  },
  secureDeleteItem: async (k: string) => {
    mockSecure.delete(k);
  },
}));
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, auth: { signOut: jest.fn(() => Promise.resolve({ error: null })) } },
}));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn(),
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: { CANCEL: "cancel", DISMISS: "dismiss", OPENED: "opened", LOCKED: "locked" },
}));
jest.mock("@mingla/payments-native", () => ({
  useStripePaymentSheet: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn(), isPaymentSheetSupported: true }),
  isStripeGooglePayTestEnv: () => true,
}));
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getAllKeys: jest.fn(async () => []), multiRemove: jest.fn(async () => undefined) },
}));
jest.mock("../../config/queryClient", () => ({
  queryClient: { cancelQueries: jest.fn(() => Promise.resolve()), removeQueries: jest.fn(), clear: jest.fn() },
}));
jest.mock("../../store/appStore", () => ({ useAppStore: { getState: () => ({ clearUserData: jest.fn() }) } }));
jest.mock("../../utils/queryPersistence", () => ({ shouldRemoveForAuthChange: () => true }));
jest.mock("../../services/appsFlyerService", () => ({ clearAppsFlyerUserId: jest.fn(), resetAppsFlyerDeviceCache: jest.fn() }));
jest.mock("../../services/nativeAdAttributionService", () => ({ clearNativeAdAttribution: jest.fn(() => Promise.resolve()) }));
jest.mock("../../services/oneSignalService", () => ({ logoutOneSignal: jest.fn() }));
jest.mock("../../services/revenueCatService", () => ({ logoutRevenueCatIfIdentified: jest.fn(() => Promise.resolve()) }));
jest.mock("../../services/mixpanelService", () => ({ mixpanelService: { trackLogout: jest.fn() } }));
jest.mock("../../services/realtimeService", () => ({ realtimeService: { clearQueue: jest.fn() } }));
jest.mock("../../services/postHogService", () => ({ postHogService: { capture: jest.fn(), reset: jest.fn() } }));

import { holdHandoff, readHeldHandoff, monotonicNow } from "@mingla/payments-native/paystackHeldHandoff";

import {
  createVenueCheckoutRecoveryPointer,
  persistVenueCheckoutRecovery,
  readVenueCheckoutRecovery,
} from "../nativeCheckoutRecovery";
import { performPrivateAuthCleanup } from "../../utils/authCleanup";

const VENUE_KEY = "mingla_venue_checkout_recovery_v1";
const GROUP = "00000000-4490-4000-8000-0000000004e1";

const writePointer = async () => {
  const pointer = createVenueCheckoutRecoveryPointer({
    kind: "venue_offer",
    id: GROUP,
    accountId: "account-a",
    provider: "paystack",
    holdUntil: null,
  });
  expect(await persistVenueCheckoutRecovery(pointer)).toBe(true);
  expect(await readVenueCheckoutRecovery()).toEqual(pointer);
};

beforeEach(() => mockSecure.clear());

it("S-1 sign-out deletes the venue recovery pointer", async () => {
  await writePointer();
  await performPrivateAuthCleanup({ reason: "test: #4490 W4 sign-out" });
  expect(mockSecure.has(VENUE_KEY)).toBe(false);
  expect(await readVenueCheckoutRecovery()).toBeNull();
});

it("S-2 a cleanup that skips the integrations (JWT expiry / account switch) deletes it too", async () => {
  await writePointer();
  await performPrivateAuthCleanup({ reason: "test: #4490 W4 no-integrations", includeIntegrations: false });
  expect(mockSecure.has(VENUE_KEY)).toBe(false);
});

it("S-3 the held venue payment page dies with the session", async () => {
  holdHandoff(GROUP, {
    fingerprint: "pay-key-0001",
    authorizationUrl: "https://checkout.paystack.test/held",
    checkoutSessionId: GROUP,
    buyerStatusToken: "",
    cachedAt: Date.now(),
    cachedAtMono: monotonicNow(),
    lifetimeMs: 60_000,
  });
  expect(readHeldHandoff(GROUP, "pay-key-0001")).not.toBeNull();
  await performPrivateAuthCleanup({ reason: "test: #4490 W4 held page" });
  expect(readHeldHandoff(GROUP, "pay-key-0001")).toBeNull();
});
