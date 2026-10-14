const mockInvoke = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn(),
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: { LOCKED: "locked" },
}));
jest.mock("@mingla/payments-native", () => ({
  useStripePaymentSheet: () => ({
    initPaymentSheet: jest.fn(),
    presentPaymentSheet: jest.fn(),
    isPaymentSheetSupported: true,
  }),
}));
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }));

import {
  clearAllHeldHandoffs,
  useNativeCheckoutFlow,
} from "../nativeCheckoutFlow";

const EVENT = "11111111-1111-4111-8111-111111111111";
const STANDARD = "22222222-2222-4222-8222-222222222222";
const VIP = "33333333-3333-4333-8333-333333333333";
const buyer = {
  name: "Buyer",
  email: "buyer@example.test",
  phone: "+15555550123",
  marketingOptIn: false,
};

const redirectMismatch = {
  data: {
    kind: "requires_web_redirect",
    checkoutSessionId: "checkout",
    buyerStatusToken: "token",
    hostedCheckoutUrl: "https://checkout.example.test",
    totalCents: 425,
    currency: "USD",
  },
  error: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearAllHeldHandoffs();
  mockInvoke.mockResolvedValue(redirectMismatch);
});

test("#3859 Explorer v2 keeps one attempt for a retry and rotates after a line choice changes", async () => {
  const checkout = useNativeCheckoutFlow();
  const input = {
    checkoutContractVersion: 2 as const,
    purchaseTermsAccepted: true,
    eventId: EVENT,
    buyer,
    lines: [
      {
        ticketTypeId: STANDARD,
        quantity: 1,
        paymentPlanChoice: "installments" as const,
      },
      {
        ticketTypeId: VIP,
        quantity: 2,
        paymentPlanChoice: "full" as const,
      },
    ],
  };

  await checkout(input);
  await checkout({ ...input, lines: [...input.lines].reverse() });
  await checkout({
    ...input,
    lines: input.lines.map((line) => ({
      ...line,
      paymentPlanChoice: "full" as const,
    })),
  });

  const bodies = mockInvoke.mock.calls.map((call) => call[1].body);
  expect(bodies).toHaveLength(3);
  expect(bodies[0].checkoutAttemptId).toBe(bodies[1].checkoutAttemptId);
  expect(bodies[0].purchaseTermsAccepted).toBe(true);
  expect(bodies[2].checkoutAttemptId).not.toBe(bodies[0].checkoutAttemptId);
  expect(bodies[0].lines.map(
    (line: { paymentPlanChoice: string }) => line.paymentPlanChoice,
  )).toEqual(["installments", "full"]);
  expect(bodies[0]).not.toHaveProperty("payment_plan_choice");
});

test("#3859 Explorer v2 refuses missing purchase terms before transport", async () => {
  const result = await useNativeCheckoutFlow()({
    checkoutContractVersion: 2,
    eventId: EVENT,
    buyer,
    lines: [{
      ticketTypeId: STANDARD,
      quantity: 1,
      paymentPlanChoice: "full",
    }],
  });

  expect(result.outcome).toBe("failed");
  expect(mockInvoke).not.toHaveBeenCalled();
});

test("#3859 Explorer v2 refuses a missing per-line choice before transport", async () => {
  const result = await useNativeCheckoutFlow()({
    checkoutContractVersion: 2,
    purchaseTermsAccepted: true,
    eventId: EVENT,
    buyer,
    lines: [{ ticketTypeId: STANDARD, quantity: 1 }],
  });

  expect(result.outcome).toBe("failed");
  expect(mockInvoke).not.toHaveBeenCalled();
});
