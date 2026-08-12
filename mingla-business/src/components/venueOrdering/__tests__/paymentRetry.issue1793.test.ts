// Issue #1793 rework — the hosted return page resumes through the possession-
// token status read. It never calls create again and receives the same provider
// URL for both Stripe Checkout and Paystack.

const invoke = jest.fn();

jest.mock("../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

import { resumeVenueOrderPayment } from "../../../services/venueOrderingService";

beforeEach(() => invoke.mockReset());

test.each([
  [
    "Stripe Checkout",
    {
      kind: "requires_web_redirect",
      url: "https://checkout.stripe.com/c/pay/cs_same",
    },
    "https://checkout.stripe.com/c/pay/cs_same",
  ],
  [
    "Paystack",
    {
      kind: "requires_paystack_redirect",
      authorizationUrl: "https://checkout.paystack.com/same-transaction",
    },
    "https://checkout.paystack.com/same-transaction",
  ],
])("T-1793-R6 — %s resumes the existing hosted object without a second create", async (
  _provider,
  paymentContinuation,
  expectedUrl,
) => {
  invoke.mockResolvedValue({ data: { paymentContinuation }, error: null });

  await expect(
    resumeVenueOrderPayment("order-same", "buyer-status-token"),
  ).resolves.toBe(expectedUrl);

  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("venue-order-status", {
    body: {
      orderId: "order-same",
      buyerStatusToken: "buyer-status-token",
      includePaymentContinuation: true,
    },
  });
  expect(invoke).not.toHaveBeenCalledWith(
    "venue-order-create",
    expect.anything(),
  );
});

test("T-1793-R7 — an unusable provider object has no retry URL", async () => {
  invoke.mockResolvedValue({
    data: { paymentContinuation: null },
    error: null,
  });
  await expect(
    resumeVenueOrderPayment("order-same", "buyer-status-token"),
  ).resolves.toBeNull();
});
