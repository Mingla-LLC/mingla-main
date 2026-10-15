// @ts-nocheck
const mockInvoke = jest.fn();
const mockInitPaymentSheet = jest.fn();
const mockPresentPaymentSheet = jest.fn();
const mockInitStripe = jest.fn();
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
  postHogService: { capture: jest.fn() },
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
    presentPaymentSheet: (...args: unknown[]) =>
      mockPresentPaymentSheet(...args),
    isPaymentSheetSupported: true,
  }),
}));
jest.mock("@stripe/stripe-react-native", () => ({
  initStripe: (...args: unknown[]) => mockInitStripe(...args),
}));

import {
  clearAllHeldHandoffs,
  useNativeCheckoutFlow,
} from "../nativeCheckoutFlow";
import { purgeNativeCheckoutRecovery } from "../nativeCheckoutRecovery";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";

const input = () => ({
  checkoutContractVersion: 2 as const,
  purchaseTermsAccepted: true,
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

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockSecureValue = null;
  clearAllHeldHandoffs();
  await purgeNativeCheckoutRecovery();
  mockOpenBrowserAsync.mockResolvedValue({ type: "dismiss" });
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("#3859 v2 Paystack waits for issued tickets and survives process death without provider secrets", async () => {
  mockInvoke.mockResolvedValueOnce(paystackCreate()).mockResolvedValueOnce({
    data: {
      status: "paid",
      order: { orderId: "paystack-order-3859", tickets: [] },
    },
    error: null,
  });

  const first = await useNativeCheckoutFlow()(input());

  expect(first).toMatchObject({
    outcome: "pending",
    title: "Confirming payment",
  });
  expect(mockSecureValue).not.toBeNull();
  const persisted = JSON.parse(mockSecureValue as string);
  expect(persisted).toEqual({
    version: 1,
    checkoutSessionId: "paystack-session-3859",
    buyerStatusToken: "paystack-buyer-token-3859",
    accountId: ACCOUNT,
    eventId: EVENT,
    provider: "paystack",
    createdAt: expect.any(Number),
    expiresAt: expect.any(Number),
  });
  expect(JSON.stringify(persisted)).not.toMatch(
    /authorizationUrl|reference|buyer@example|contact|intake/,
  );

  // Simulate process death: memory-only Paystack handoff disappears, while
  // the minimal secure pointer survives and the server becomes authoritative.
  clearAllHeldHandoffs();
  mockInvoke.mockResolvedValueOnce({
    data: {
      status: "paid",
      order: {
        orderId: "paystack-order-3859",
        tickets: [{ ticketId: "paystack-ticket-3859" }],
        totalCents: 1250,
        currency: "NGN",
      },
    },
    error: null,
  });

  const recovered = await useNativeCheckoutFlow()(input());

  expect(recovered).toEqual({
    outcome: "succeeded",
    orderId: "paystack-order-3859",
    provider: "paystack",
    title: "You’re booked",
    recovered: true,
  });
  expect(mockSecureValue).toBeNull();
  expect(
    mockInvoke.mock.calls.filter(([name]) => name === "ticket-checkout-create"),
  ).toHaveLength(1);
  expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(1);
});

test("#3859 v2 Paystack clears recovery when the provider page never opened", async () => {
  mockInvoke.mockResolvedValueOnce(paystackCreate());
  mockOpenBrowserAsync.mockRejectedValueOnce(new Error("browser unavailable"));

  const result = await useNativeCheckoutFlow()(input());

  expect(result).toMatchObject({ outcome: "failed" });
  expect(mockSecureValue).toBeNull();
  expect(
    mockInvoke.mock.calls.filter(([name]) => name === "ticket-checkout-status"),
  ).toHaveLength(0);
});
