/** #2230 native payment contract: day scope reaches the actual create request and fingerprint. */
const mockInvoke = jest.fn();
const mockOpenBrowserAsync = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
  WebBrowserResultType: { LOCKED: "locked", DISMISS: "dismiss" },
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

let sequence = 0;
const input = (extra: Record<string, unknown> = {}) => ({
  eventId: `event-2230-${++sequence}`,
  lines: [{ ticketTypeId: "ga", quantity: 1 }],
  buyer: { name: "Ada", email: "ada@example.com", phone: "+2348000000000" },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearAllHeldHandoffs();
  mockOpenBrowserAsync.mockResolvedValue({ type: "locked" });
});

describe("#2230 native day payload", () => {
  it("sends a deduplicated day set in the actual ticket-checkout-create body", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "order-1" },
      error: null,
    });
    await useNativeCheckoutFlow()(
      input({ eventDateIds: ["day-1", "day-2", "day-2"] }),
    );
    const create = mockInvoke.mock.calls.find(
      (call) => call[0] === "ticket-checkout-create",
    );
    expect(create?.[1].body.eventDateIds).toEqual(["day-1", "day-2"]);
  });

  it("omits the plural key for single-day checkout and preserves singular eventDateId", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "order-2" },
      error: null,
    });
    await useNativeCheckoutFlow()(input({ eventDateId: "experience-day" }));
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.eventDateId).toBe("experience-day");
    expect(Object.prototype.hasOwnProperty.call(body, "eventDateIds")).toBe(
      false,
    );
  });

  it("changes the held-cart fingerprint when the selected day set changes", async () => {
    const eventId = `event-fingerprint-${++sequence}`;
    const base = {
      eventId,
      lines: [{ ticketTypeId: "ga", quantity: 1 }],
      buyer: { name: "Ada", email: "ada@example.com", phone: "+2348000000000" },
    };
    const redirect = (suffix: string) => ({
      data: {
        kind: "requires_paystack_redirect",
        checkoutSessionId: `session-${suffix}`,
        buyerStatusToken: `token-${suffix}`,
        authorizationUrl: `https://checkout.example/${suffix}`,
        returnUrl: "https://host.usemingla.com/return",
        reference: suffix,
        totalCents: 100,
        currency: "NGN",
      },
      error: null,
    });
    mockInvoke
      .mockResolvedValueOnce(redirect("a"))
      .mockResolvedValueOnce(redirect("b"));
    await useNativeCheckoutFlow()({ ...base, eventDateIds: ["day-1"] });
    await useNativeCheckoutFlow()({ ...base, eventDateIds: ["day-2"] });
    expect(
      mockInvoke.mock.calls.filter(
        (call) => call[0] === "ticket-checkout-create",
      ),
    ).toHaveLength(2);
  });
});
