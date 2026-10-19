/**
 * issue #3281 Round 1 PR 1b — native checkout forwards bookedStartAt when set.
 */

const invoke = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock(
  "@mingla/payments-native",
  () => ({
    useStripePaymentSheet: () => ({
      initPaymentSheet: jest.fn(async () => ({})),
      presentPaymentSheet: jest.fn(async () => ({})),
      isPaymentSheetSupported: true,
    }),
  }),
  { virtual: true },
);
jest.mock(
  "@stripe/stripe-react-native",
  () => ({ initStripe: jest.fn(async () => undefined) }),
  { virtual: true },
);
jest.mock(
  "expo-web-browser",
  () => ({ openBrowserAsync: jest.fn(async () => ({})) }),
  { virtual: true },
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useNativeCheckoutFlow } = require("../nativeCheckoutFlow.native") as
  typeof import("../nativeCheckoutFlow.native");

const baseInput = {
  eventId: "ev_experience",
  lines: [{ ticketTypeId: "tt_1", quantity: 2 }],
  buyer: {
    name: "Ada Guest",
    email: "guest@example.com",
    phone: "+2348000000000",
  },
};

const lastBody = (): Record<string, unknown> => {
  const call = invoke.mock.calls[invoke.mock.calls.length - 1];
  expect(call[0]).toBe("ticket-checkout-create");
  return (call[1] as { body: Record<string, unknown> }).body;
};

beforeEach(() => {
  invoke.mockReset();
});

describe("#3281 native checkout bookedStartAt", () => {
  it("forwards bookedStartAt when the open-daily picker chose a time", async () => {
    invoke.mockResolvedValue({
      data: { kind: "free_completed", orderId: "ord_1" },
      error: null,
    });
    const booked = "2026-06-15T11:00:00.000Z";
    await useNativeCheckoutFlow()({
      ...baseInput,
      eventDateId: "11111111-1111-4111-8111-111111111111",
      bookedStartAt: booked,
    });
    expect(lastBody().bookedStartAt).toBe(booked);
  });

  it("omits bookedStartAt when absent (byte-identical body)", async () => {
    invoke.mockResolvedValue({
      data: { kind: "free_completed", orderId: "ord_2" },
      error: null,
    });
    await useNativeCheckoutFlow()({ ...baseInput });
    expect(Object.prototype.hasOwnProperty.call(lastBody(), "bookedStartAt")).toBe(
      false,
    );
  });
});
