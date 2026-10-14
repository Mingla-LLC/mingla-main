// @ts-nocheck
const mockInvoke = jest.fn();
const mockSecureGet = jest.fn();
const mockSecureSet = jest.fn();
const mockSecureDelete = jest.fn();
const mockCapture = jest.fn();

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("../../lib/secureStoreSafe", () => ({
  isSecureStoreAvailable: () => true,
  secureGetItem: (...args: unknown[]) => mockSecureGet(...args),
  secureSetItem: (...args: unknown[]) => mockSecureSet(...args),
  secureDeleteItem: (...args: unknown[]) => mockSecureDelete(...args),
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: (...args: unknown[]) => mockCapture(...args) },
}));
jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import {
  createNativeCheckoutRecoveryPointer,
  parseNativeCheckoutRecoveryPointer,
  purgeNativeCheckoutRecovery,
  reconcileNativeCheckout,
} from "../nativeCheckoutRecovery";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const pointer = () =>
  createNativeCheckoutRecoveryPointer({
    checkoutSessionId: "session-3859-tester",
    buyerStatusToken: "buyer-token-3859-tester",
    accountId: "account-3859-tester",
    eventId: "event-3859-tester",
    now: NOW,
  });

beforeEach(async () => {
  jest.clearAllMocks();
  mockSecureGet.mockResolvedValue(null);
  mockSecureSet.mockResolvedValue(undefined);
  mockSecureDelete.mockResolvedValue(undefined);
  await purgeNativeCheckoutRecovery();
  jest.clearAllMocks();
});

test.each([
  ["authorizationUrl", "https://provider.invalid/bearer-secret"],
  ["clientSecret", "pi_secret_forbidden"],
  ["contact", { email: "buyer@example.invalid" }],
  ["intake", { passport: "forbidden" }],
  ["email", "buyer@example.invalid"],
  ["phone", "+15555550100"],
  ["providerReference", "provider-ref-forbidden"],
])(
  "#3859 recovery pointer rejects injected %s instead of persisting payment or PII data",
  (field, injectedValue) => {
    expect(
      parseNativeCheckoutRecoveryPointer(
        JSON.stringify({ ...pointer(), [field]: injectedValue }),
      ),
    ).toBeNull();
  },
);

test("#3859 a plausible order payload cannot override non-terminal server status", async () => {
  mockInvoke.mockResolvedValue({
    data: {
      status: "processing",
      order: {
        orderId: "forged-early-order-3859",
        tickets: [{ id: "forged-early-ticket-3859" }],
        totalCents: 36250000,
        currency: "NGN",
      },
    },
    error: null,
  });

  await expect(
    reconcileNativeCheckout(pointer(), "payment_completed"),
  ).resolves.toMatchObject({ outcome: "pending" });
  expect(mockSecureDelete).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalledWith(
    "purchase_completed",
    expect.anything(),
  );
});
