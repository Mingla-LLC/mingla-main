/**
 * issue #3281 — the Host app's native ticket checkout sends checkout contract
 * v2, so a line's plan choice, dates and extras reach `ticket-checkout-create`
 * under one attempt id. A cart the contract refuses fails closed: nothing is
 * sent. v1 (trip / experience) keeps its body.
 *
 * Runtime test: the REAL hook runs against mocked transport and Stripe, and the
 * assertions read the request body the hook actually built.
 */

const invoke = jest.fn();
const initPaymentSheet = jest.fn(async (_config: unknown) => ({}));
const presentPaymentSheet = jest.fn(
  async (): Promise<{ error?: { code: string; message: string } }> => ({}),
);

jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock(
  "@mingla/payments-native",
  () => ({
    isStripeGooglePayTestEnv: () => true,
    useStripePaymentSheet: () => ({
      initPaymentSheet: (config: unknown) => initPaymentSheet(config),
      presentPaymentSheet: () => presentPaymentSheet(),
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
type NativeCheckoutInput = import("../nativeCheckoutFlow.native").NativeCheckoutInput;

const EVENT = "32810000-0000-4000-8000-000000000001";
const GENERAL = "32810000-0000-4000-8000-0000000000b2";
const VIP = "32810000-0000-4000-8000-0000000000a1";
const DINNER = "32810000-0000-4000-8000-0000000000d1";
const SATURDAY = "32810000-0000-4000-8000-0000000000e1";
const ATTEMPT = "32810000-0000-4000-8000-0000000000f1";

const v2Input = (over: Partial<NativeCheckoutInput> = {}): NativeCheckoutInput => ({
  eventId: EVENT,
  // Cart lines carry display fields too; v2 must send only the contract's.
  lines: [
    {
      ticketTypeId: GENERAL,
      quantity: 2,
      paymentPlanChoice: "full",
      addOns: [{ addOnId: DINNER, quantity: 2 }],
      ticketName: "General",
      unitPrice: 20,
    } as NativeCheckoutInput["lines"][number],
    {
      ticketTypeId: VIP,
      quantity: 1,
      paymentPlanChoice: "full",
      byDate: { [SATURDAY]: 1 },
    },
  ],
  buyer: { name: "Ada Guest", email: "ada@example.test", phone: "+447700900123" },
  checkoutContractVersion: 2,
  checkoutAttemptId: ATTEMPT,
  purchaseTermsAccepted: true,
  quoteDigest: "qd",
  quoteListDigest: "qld",
  eventDateIds: [SATURDAY],
  ...over,
});

const createBodies = (): Array<Record<string, unknown>> =>
  invoke.mock.calls
    .filter((call) => call[0] === "ticket-checkout-create")
    .map((call) => (call[1] as { body: Record<string, unknown> }).body);

const freeCompleted = () =>
  invoke.mockResolvedValue({
    data: { kind: "free_completed", orderId: "ord_1" },
    error: null,
  });

beforeEach(() => {
  invoke.mockReset();
  initPaymentSheet.mockClear();
  presentPaymentSheet.mockReset();
  presentPaymentSheet.mockResolvedValue({});
});

describe("#3281 native checkout v2 body", () => {
  it("sends the v2 fields, the link token and the normalized lines with extras", async () => {
    freeCompleted();
    const outcome = await useNativeCheckoutFlow()(
      v2Input({ ticketLinkToken: "link-tok", discountCode: "SAVE10" }),
    );
    expect(outcome).toEqual({ outcome: "succeeded", orderId: "ord_1" });
    const [body] = createBodies();
    expect(body).toMatchObject({
      eventId: EVENT,
      surface: "native",
      returnContract: "host_v1",
      checkoutContractVersion: 2,
      checkoutAttemptId: ATTEMPT,
      purchaseTermsAccepted: true,
      ticketLinkToken: "link-tok",
      discountCode: "SAVE10",
      quoteDigest: "qd",
      quoteListDigest: "qld",
      eventDateIds: [SATURDAY],
    });
    // Sorted by ticket id (shared normalizer); display fields never sent.
    expect(body.lines).toEqual([
      {
        ticketTypeId: VIP,
        quantity: 1,
        paymentPlanChoice: "full",
        byDate: { [SATURDAY]: 1 },
      },
      {
        ticketTypeId: GENERAL,
        quantity: 2,
        paymentPlanChoice: "full",
        addOns: [{ addOnId: DINNER, quantity: 2 }],
      },
    ]);
    expect("payment_plan_choice" in body).toBe(false);
  });

  it("omits the link token when there is none", async () => {
    freeCompleted();
    await useNativeCheckoutFlow()(v2Input());
    expect("ticketLinkToken" in createBodies()[0]).toBe(false);
  });

  it("v1 (trip / experience) keeps its body: no v2 fields, scalar plan choice kept", async () => {
    freeCompleted();
    await useNativeCheckoutFlow()({
      eventId: "ev_trip",
      lines: [{ ticketTypeId: "tt_1", quantity: 1 }],
      buyer: { name: "Ada", email: "a@example.test", phone: "+447700900123" },
      paymentPlanChoice: "installments",
    });
    const [body] = createBodies();
    expect(body.lines).toEqual([{ ticketTypeId: "tt_1", quantity: 1 }]);
    expect(body.payment_plan_choice).toBe("installments");
    expect("checkoutContractVersion" in body).toBe(false);
    expect("checkoutAttemptId" in body).toBe(false);
    expect("purchaseTermsAccepted" in body).toBe(false);
  });
});

describe("#3281 native checkout v2 fails closed before any network call", () => {
  const cases: Array<[string, Partial<NativeCheckoutInput>, RegExp]> = [
    ["terms not accepted", { purchaseTermsAccepted: false }, /Accept the terms/],
    ["terms missing", { purchaseTermsAccepted: undefined }, /Accept the terms/],
    ["no attempt id", { checkoutAttemptId: undefined }, /not been charged/],
    ["a malformed attempt id", { checkoutAttemptId: "attempt-1" }, /not been charged/],
    ["a scalar plan choice", { paymentPlanChoice: "full" }, /not been charged/],
    [
      "a line without a plan choice",
      { lines: [{ ticketTypeId: GENERAL, quantity: 1 }] },
      /not been charged/,
    ],
    [
      "a ticket id the database cannot issue",
      { lines: [{ ticketTypeId: "tt_1", quantity: 1, paymentPlanChoice: "full" }] },
      /not been charged/,
    ],
    [
      "a duplicate ticket line",
      {
        lines: [
          { ticketTypeId: GENERAL, quantity: 1, paymentPlanChoice: "full" },
          { ticketTypeId: GENERAL, quantity: 2, paymentPlanChoice: "full" },
        ],
      },
      /not been charged/,
    ],
    ["an empty cart", { lines: [] }, /not been charged/],
  ];

  it.each(cases)("%s", async (_name, over, message) => {
    freeCompleted();
    const outcome = await useNativeCheckoutFlow()(v2Input(over));
    expect(outcome.outcome).toBe("failed");
    expect((outcome as { message: string }).message).toMatch(message);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("#3281 native checkout v2 responses", () => {
  it("still maps a review refusal to the review model", async () => {
    const quote = { buyerTotalCents: 4200, currency: "GBP" };
    const body = { error: "checkout_review_required", detail: "fingerprint", quote };
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          status: 409,
          json: async () => body,
          text: async () => JSON.stringify(body),
          clone() {
            return this;
          },
        },
      },
    });
    const outcome = await useNativeCheckoutFlow()(v2Input());
    expect(outcome.outcome).toBe("failed");
    expect((outcome as { review?: unknown }).review).toEqual({
      kind: "review_required",
      detail: "fingerprint",
      quote,
      previousTotalCents: null,
    });
  });

  it("prices Apple Pay at the server total, which includes the extras", async () => {
    invoke.mockImplementation(async (fn: string) =>
      fn === "ticket-checkout-status"
        ? { data: { status: "present_allowed" }, error: null }
        : {
            data: {
              kind: "requires_payment",
              checkoutSessionId: "cs_1",
              buyerStatusToken: "bst",
              totalCents: 6550,
              subtotalCents: 6000,
              taxCents: 0,
              taxBreakdown: [],
              currency: "usd",
              clientSecret: "pi_secret",
              paymentIntentId: "pi_1",
              publishableKey: "pk_test",
              stripeAccountId: "acct_1",
              customerId: null,
              customerEphemeralKeySecret: null,
            },
            error: null,
          },
    );
    const outcome = await useNativeCheckoutFlow()(
      v2Input({ displayTitle: "Night Market" }),
    );
    expect(outcome).toEqual({ outcome: "succeeded", orderId: "cs_1" });
    const config = initPaymentSheet.mock.calls[0][0] as {
      applePay: { cartItems: Array<{ label: string; amount: string }> };
    };
    expect(config.applePay.cartItems).toEqual([
      { label: "Night Market", amount: "65.50", paymentType: "Immediate" },
    ]);
  });

  it("a PaymentSheet cancel is a cancel, not a failure", async () => {
    invoke.mockImplementation(async (fn: string) =>
      fn === "ticket-checkout-status"
        ? { data: { status: "present_allowed" }, error: null }
        : {
            data: {
              kind: "requires_payment",
              checkoutSessionId: "cs_2",
              buyerStatusToken: "bst",
              totalCents: 100,
              currency: "usd",
              clientSecret: "pi_secret",
              publishableKey: "pk_test",
              stripeAccountId: "acct_1",
              customerId: null,
              customerEphemeralKeySecret: null,
            },
            error: null,
          },
    );
    presentPaymentSheet.mockResolvedValue({
      error: { code: "Canceled", message: "canceled" },
    });
    expect(await useNativeCheckoutFlow()(v2Input())).toEqual({
      outcome: "canceled",
    });
  });
});
