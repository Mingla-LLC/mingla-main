// @ts-nocheck
const mockInvoke = jest.fn();
const mockInitPaymentSheet = jest.fn();
const mockPresentPaymentSheet = jest.fn();
const mockInitStripe = jest.fn();
const mockCapture = jest.fn();
const mockOpenBrowserAsync = jest.fn();
let mockSecureValue: string | null = null;

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("../../lib/secureStoreSafe", () => ({
  isSecureStoreAvailable: () => true,
  secureGetItem: jest.fn(async () => mockSecureValue),
  secureSetItem: jest.fn(async (_key: string, value: string) => {
    mockSecureValue = value;
  }),
  secureDeleteItem: jest.fn(async () => {
    mockSecureValue = null;
  }),
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: (...args: unknown[]) => mockCapture(...args) },
}));
jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: { LOCKED: "locked" },
}));
jest.mock("@mingla/payments-native", () => ({
  useStripePaymentSheet: () => ({
    initPaymentSheet: (...args: unknown[]) => mockInitPaymentSheet(...args),
    presentPaymentSheet: (...args: unknown[]) => mockPresentPaymentSheet(...args),
    isPaymentSheetSupported: true,
  }),
}));
jest.mock("@stripe/stripe-react-native", () => ({
  initStripe: (...args: unknown[]) => mockInitStripe(...args),
}));

import { purgeNativeCheckoutRecovery } from "../nativeCheckoutRecovery";
import { useNativeCheckoutFlow } from "../nativeCheckoutFlow";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";

const input = () => ({
  checkoutContractVersion: 2 as const,
  accountId: ACCOUNT,
  eventId: EVENT,
  lines: [
    { ticketTypeId: TICKET, quantity: 1, paymentPlanChoice: "full" as const },
  ],
  buyer: {
    name: "Buyer",
    email: "buyer@example.test",
    phone: "+15555550123",
  },
  displayTitle: "Evening Market",
});

const paymentCreate = (currency = "EUR") => ({
  data: {
    kind: "requires_payment",
    checkoutSessionId: "session-3859",
    buyerStatusToken: "buyer-token-3859",
    totalCents: 1250,
    subtotalCents: 1250,
    taxCents: 0,
    taxBreakdown: [],
    currency,
    clientSecret: "pi_secret_never_persisted",
    paymentIntentId: "pi_3859",
    publishableKey: "pk_test_3859",
    stripeAccountId: "acct_3859",
    customerId: null,
    customerEphemeralKeySecret: null,
  },
  error: null,
});

const paystackCreate = () => ({
  data: {
    kind: "requires_paystack_redirect",
    checkoutSessionId: "paystack-session-3859",
    buyerStatusToken: "paystack-buyer-token-3859",
    authorizationUrl: "https://checkout.paystack.com/checkout-3859",
    returnUrl: "https://host.usemingla.com/checkout/confirm",
    reference: "paystack-reference-3859",
    totalCents: 1250,
    currency: "NGN",
  },
  error: null,
});

const confirmation = (
  status: string,
  order: { orderId: string; tickets: unknown[] } | null = null,
) => ({ data: { status, order }, error: null });

const installStripeTransport = (
  confirmResult: ReturnType<typeof confirmation>,
): void => {
  mockInvoke.mockImplementation(
    async (name: string, options: { body?: { preflight?: boolean } }) => {
      if (name === "ticket-checkout-create") return paymentCreate();
      if (name === "ticket-checkout-status" && options.body?.preflight) {
        return { data: { status: "present_allowed" }, error: null };
      }
      if (name === "ticket-checkout-confirm") return confirmResult;
      throw new Error(`unexpected invoke: ${name}`);
    },
  );
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockSecureValue = null;
  mockInitStripe.mockResolvedValue(undefined);
  mockInitPaymentSheet.mockResolvedValue({});
  mockPresentPaymentSheet.mockResolvedValue({});
  mockOpenBrowserAsync.mockResolvedValue({ type: "dismiss" });
  await purgeNativeCheckoutRecovery();
  jest.clearAllMocks();
});

test("#3859 non-USD PaymentSheet success stays pending until server confirmation", async () => {
  installStripeTransport(confirmation("pending"));

  const result = await useNativeCheckoutFlow()(input());

  expect(result).toMatchObject({
    outcome: "pending",
    title: "Confirming payment",
  });
  expect(mockInitPaymentSheet).toHaveBeenCalledWith(
    expect.objectContaining({
      googlePay: expect.objectContaining({ currencyCode: "eur" }),
    }),
  );
  expect(mockInvoke.mock.calls.map(([name]) => name)).toEqual([
    "ticket-checkout-create",
    "ticket-checkout-status",
    "ticket-checkout-confirm",
  ]);
  expect(mockSecureValue).not.toBeNull();
  expect(mockSecureValue).not.toContain("pi_secret_never_persisted");
});

test("#3859 reopening while pending reconciles instead of creating twice", async () => {
  installStripeTransport(confirmation("pending"));
  const checkout = useNativeCheckoutFlow();

  await checkout(input());
  const recovered = await checkout(input());

  expect(recovered).toMatchObject({ outcome: "pending", recovered: true });
  expect(
    mockInvoke.mock.calls.filter(([name]) => name === "ticket-checkout-create"),
  ).toHaveLength(1);
  expect(mockPresentPaymentSheet).toHaveBeenCalledTimes(1);
});

test("#3859 PaymentSheet cancellation reconciles first and late success wins", async () => {
  installStripeTransport(
    confirmation("paid", {
      orderId: "order-3859",
      tickets: [{ ticketId: "ticket-issued" }],
    }),
  );
  mockPresentPaymentSheet.mockResolvedValue({
    error: { code: "Canceled", message: "Canceled" },
  });

  const result = await useNativeCheckoutFlow()(input());

  expect(result).toMatchObject({
    outcome: "succeeded",
    orderId: "order-3859",
    provider: "stripe",
  });
  expect(mockSecureValue).toBeNull();
  // The screen that owns the successful submission emits purchase_completed.
  // Recovery owns it only when it discovers the success after a restart.
  expect(
    mockCapture.mock.calls.filter(([name]) => name === "purchase_completed"),
  ).toHaveLength(0);
});

test("#3859 init failure purges the pointer because provider UI never opened", async () => {
  mockInvoke.mockResolvedValueOnce(paymentCreate());
  mockInitPaymentSheet.mockResolvedValue({
    error: { message: "invalid configuration" },
  });

  const result = await useNativeCheckoutFlow()(input());

  expect(result.outcome).toBe("failed");
  expect(mockSecureValue).toBeNull();
  expect(mockPresentPaymentSheet).not.toHaveBeenCalled();
});

test("#3859 Stripe SDK init exception purges the pointer before provider UI", async () => {
  mockInvoke.mockResolvedValueOnce(paymentCreate());
  mockInitStripe.mockRejectedValue(new Error("sdk initialization failed"));

  const result = await useNativeCheckoutFlow()(input());

  expect(result.outcome).toBe("failed");
  expect(mockSecureValue).toBeNull();
  expect(mockInitPaymentSheet).not.toHaveBeenCalled();
  expect(mockPresentPaymentSheet).not.toHaveBeenCalled();
});

test("#3859 preflight refusal purges the pointer before provider UI opens", async () => {
  mockInvoke.mockImplementation(async (name: string) => {
    if (name === "ticket-checkout-create") return paymentCreate();
    if (name === "ticket-checkout-status") {
      return { data: { status: "failed" }, error: null };
    }
    throw new Error(`unexpected invoke: ${name}`);
  });

  const result = await useNativeCheckoutFlow()(input());

  expect(result).toMatchObject({
    outcome: "failed",
    message: "This sale is no longer available.",
  });
  expect(mockSecureValue).toBeNull();
  expect(mockPresentPaymentSheet).not.toHaveBeenCalled();
});

test("#3859 confirmed provider cancellation alone authorizes review and retry", async () => {
  installStripeTransport(confirmation("failed"));
  mockPresentPaymentSheet.mockResolvedValue({
    error: { code: "Canceled", message: "Canceled" },
  });

  const result = await useNativeCheckoutFlow()(input());

  expect(result).toMatchObject({ outcome: "canceled", retryable: true });
  expect(mockSecureValue).toBeNull();
});

test("#3859 free completion leaves purchase analytics to the submitting screen", async () => {
  mockInvoke.mockResolvedValue({
    data: { kind: "free_completed", orderId: "free-order-3859" },
    error: null,
  });
  const checkout = useNativeCheckoutFlow();

  const result = await checkout(input());
  await checkout(input());

  expect(result).toEqual({
    outcome: "succeeded",
    orderId: "free-order-3859",
    provider: "free",
  });
  expect(mockSecureValue).toBeNull();
  expect(
    mockCapture.mock.calls.filter(([name]) => name === "purchase_completed"),
  ).toHaveLength(0);
});

test("#3859 v2 Paystack behavior is preserved and success names its provider", async () => {
  mockInvoke
    .mockResolvedValueOnce(paystackCreate())
    .mockResolvedValueOnce({
      data: {
        status: "paid",
        order: {
          orderId: "paystack-order-3859",
          tickets: [{ ticketId: "paystack-ticket-3859" }],
        },
      },
      error: null,
    });

  const result = await useNativeCheckoutFlow()(input());

  expect(result).toEqual({
    outcome: "succeeded",
    orderId: "paystack-order-3859",
    provider: "paystack",
  });
  expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
    "https://checkout.paystack.com/checkout-3859",
  );
  expect(mockInitPaymentSheet).not.toHaveBeenCalled();
  expect(mockPresentPaymentSheet).not.toHaveBeenCalled();
  expect(mockSecureValue).toBeNull();
});

test("#3859 released v1 Stripe caller preserves immediate legacy behavior", async () => {
  installStripeTransport(confirmation("pending"));
  const legacy = input();

  const result = await useNativeCheckoutFlow()({
    eventId: legacy.eventId,
    buyer: legacy.buyer,
    lines: [{ ticketTypeId: TICKET, quantity: 1 }],
  });

  expect(result).toEqual({ outcome: "succeeded", orderId: "session-3859" });
  expect(
    mockInvoke.mock.calls.filter(([name]) => name === "ticket-checkout-confirm"),
  ).toHaveLength(0);
  expect(mockSecureValue).toBeNull();
});
