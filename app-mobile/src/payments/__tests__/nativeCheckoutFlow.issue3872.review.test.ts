const mockInvoke = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
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

import { useNativeCheckoutFlow } from "../nativeCheckoutFlow";

const quote = {
  kind: "quote",
  currency: "USD",
  lines: [],
  listSubtotalCents: 5000,
  discountCents: 1000,
  netSubtotalCents: 4000,
  dueTodayNetCents: 4000,
  dueTodayListCents: 5000,
  installmentSchedule: null,
  discounts: [],
  codeOutcome: { status: "none", reason: null, required: null, with: null, replaced: [] },
  notices: [],
  quoteDigest: "new-digest",
  quoteListDigest: "new-list-digest",
  feesCents: 0,
  taxCents: 0,
  buyerTotalCents: 4000,
  calculationId: null,
  subtotalCents: 4000,
  totalCents: 4000,
};

test("#3872 a native 409 returns a review outcome with the revised server quote", async () => {
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: {
        status: 409,
        text: async () => JSON.stringify({
          error: "checkout_review_required",
          detail: "discount_changed",
          quote,
        }),
      },
    },
  });

  const result = await useNativeCheckoutFlow()({
    eventId: "event-3872",
    lines: [{ ticketTypeId: "tier-3872", quantity: 1 }],
    buyer: { name: "Buyer", email: "buyer@example.test", phone: "+15555550123" },
    acceptedTotalCents: 5000,
    quoteDigest: "old-digest",
    quoteListDigest: "old-list-digest",
  });

  expect(result).toEqual({
    outcome: "review",
    review: {
      kind: "review_required",
      detail: "discount_changed",
      quote,
      previousTotalCents: 5000,
    },
  });
});
