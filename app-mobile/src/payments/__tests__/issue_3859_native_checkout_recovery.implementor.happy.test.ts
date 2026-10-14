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
  captureNativePurchaseCompleted,
  claimNativePurchaseCompleted,
  createNativeCheckoutRecoveryPointer,
  nativePurchaseAnalyticsProperties,
  parseNativeCheckoutRecoveryPointer,
  persistNativeCheckoutRecovery,
  purgeNativeCheckoutRecovery,
  readNativeCheckoutRecovery,
  reconcileNativeCheckout,
} from "../nativeCheckoutRecovery";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const pointer = () =>
  createNativeCheckoutRecoveryPointer({
    checkoutSessionId: "session-3859",
    buyerStatusToken: "buyer-token-3859",
    accountId: "account-3859",
    eventId: "event-3859",
    now: NOW,
  });

const functionError = (status: number, error: string) => ({
  context: {
    status,
    text: jest.fn(async () => JSON.stringify({ error })),
  },
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockSecureGet.mockResolvedValue(null);
  mockSecureSet.mockResolvedValue(undefined);
  mockSecureDelete.mockResolvedValue(undefined);
  await purgeNativeCheckoutRecovery();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

test("#3859 secure pointer is a strict 24-hour allowlist with no payment secrets", async () => {
  const value = pointer();
  expect(value.expiresAt - value.createdAt).toBe(24 * 60 * 60 * 1000);
  expect(await persistNativeCheckoutRecovery(value)).toBe(true);

  const serialized = JSON.parse(mockSecureSet.mock.calls[0][1]) as Record<
    string,
    unknown
  >;
  expect(Object.keys(serialized).sort()).toEqual([
    "accountId",
    "buyerStatusToken",
    "checkoutSessionId",
    "createdAt",
    "eventId",
    "expiresAt",
    "provider",
    "version",
  ]);
  expect(serialized).not.toHaveProperty("clientSecret");
  expect(serialized).not.toHaveProperty("authorizationUrl");
  expect(serialized).not.toHaveProperty("contact");
  expect(serialized).not.toHaveProperty("intake");
  expect(
    parseNativeCheckoutRecoveryPointer(
      JSON.stringify({ ...serialized, clientSecret: "forbidden" }),
    ),
  ).toBeNull();
});

test("#3859 expired secure pointer is deleted before recovery", async () => {
  jest.useFakeTimers().setSystemTime(NOW + 24 * 60 * 60 * 1000 + 1);
  mockSecureGet.mockResolvedValue(JSON.stringify(pointer()));

  await expect(readNativeCheckoutRecovery()).resolves.toBeNull();
  expect(mockSecureDelete).toHaveBeenCalledTimes(1);
  expect(mockInvoke).not.toHaveBeenCalled();
});

test("#3859 transport and 5xx uncertainty stay pending and emit pending once", async () => {
  mockInvoke.mockResolvedValue({
    data: null,
    error: functionError(502, "stripe_unavailable"),
  });

  const first = await reconcileNativeCheckout(pointer(), "payment_completed");
  const second = await reconcileNativeCheckout(pointer(), "recovery");

  expect(first.outcome).toBe("pending");
  expect(second.outcome).toBe("pending");
  expect(mockSecureDelete).not.toHaveBeenCalled();
  expect(
    mockCapture.mock.calls.filter(([name]) => name === "checkout_pending"),
  ).toHaveLength(1);
});

test.each([
  [400, "checkout_session_required"],
  [401, "buyer_status_token_required"],
  [403, "buyer_status_token_invalid"],
  [404, "checkout_session_not_found"],
  [409, "checkout_unavailable"],
])("#3859 HTTP %i clears an invalid recovery pointer without allowing retry", async (status, token) => {
  mockInvoke.mockResolvedValue({
    data: null,
    error: functionError(status, token),
  });

  const result = await reconcileNativeCheckout(pointer(), "recovery");

  expect(result).toMatchObject({
    outcome: "failed",
    token,
    retryable: false,
  });
  expect(mockSecureDelete).toHaveBeenCalledTimes(1);
});

test("#3859 checkout_unavailable is attention, never pending or retryable", async () => {
  mockInvoke.mockResolvedValue({
    data: {
      status: "failed",
      order: null,
      error: "checkout_unavailable",
    },
    error: null,
  });

  const result = await reconcileNativeCheckout(pointer(), "payment_completed");

  expect(result).toMatchObject({
    outcome: "failed",
    token: "checkout_unavailable",
    retryable: false,
  });
  expect(mockSecureDelete).toHaveBeenCalledTimes(1);
});

test("#3859 paid without real tickets remains pending", async () => {
  mockInvoke.mockResolvedValue({
    data: { status: "paid", order: { orderId: "order-3859", tickets: [] } },
    error: null,
  });

  const result = await reconcileNativeCheckout(pointer(), "payment_completed");

  expect(result.outcome).toBe("pending");
  expect(mockSecureDelete).not.toHaveBeenCalled();
  expect(
    mockCapture.mock.calls.filter(([name]) => name === "purchase_completed"),
  ).toHaveLength(0);
});

test("#3859 recovered final order emits purchase once with bounded value and currency", async () => {
  mockInvoke.mockResolvedValue({
    data: {
      status: "paid",
      order: {
        orderId: "order-3859",
        tickets: [{ id: "ticket-3859" }],
        totalCents: 1250,
        currency: "eur",
      },
    },
    error: null,
  });

  await reconcileNativeCheckout(pointer(), "recovery");
  await reconcileNativeCheckout(pointer(), "recovery");

  expect(
    mockCapture.mock.calls.filter(([name]) => name === "purchase_completed"),
  ).toHaveLength(1);
  expect(mockCapture).not.toHaveBeenCalledWith(
    "purchase_completed",
    expect.objectContaining({ order_id: expect.anything() }),
  );
  expect(mockCapture).toHaveBeenCalledWith("purchase_completed", {
    event_id: "event-3859",
    provider: "stripe",
    surface: "consumer_app",
    recovered: true,
    value: 12.5,
    currency: "EUR",
  });
});

test("#3859 immediate purchase helpers claim once and share the bounded signature", () => {
  const input = {
    orderId: "immediate-order-3859",
    eventId: "event-3859",
    provider: "stripe" as const,
    recovered: false,
    totalCents: 1250,
    currency: "eur",
  };

  expect(captureNativePurchaseCompleted(input)).toBe(true);
  expect(captureNativePurchaseCompleted(input)).toBe(false);
  expect(
    mockCapture.mock.calls.filter(([name]) => name === "purchase_completed"),
  ).toHaveLength(1);
  expect(mockCapture).toHaveBeenCalledWith(
    "purchase_completed",
    nativePurchaseAnalyticsProperties({
      eventId: "event-3859",
      provider: "stripe",
      recovered: false,
      totalCents: 1250,
      currency: "eur",
    }),
  );
  expect(claimNativePurchaseCompleted(input.orderId)).toBe(false);
});

test("#3859 purchase analytics omits missing currency instead of fabricating USD", () => {
  expect(
    nativePurchaseAnalyticsProperties({
      eventId: "trip-3859",
      provider: "paystack",
      recovered: false,
      totalCents: 1250,
      currency: undefined,
    }),
  ).toEqual({
    event_id: "trip-3859",
    provider: "paystack",
    surface: "consumer_app",
    recovered: false,
    value: 12.5,
  });
});

test("#3859 only server terminal failure authorizes a fresh retry", async () => {
  mockInvoke.mockResolvedValue({
    data: { status: "failed", order: null, error: "payment_failed" },
    error: null,
  });

  await expect(
    reconcileNativeCheckout(pointer(), "payment_completed"),
  ).resolves.toMatchObject({ outcome: "failed", retryable: true });
  expect(mockSecureDelete).toHaveBeenCalledTimes(1);
});
