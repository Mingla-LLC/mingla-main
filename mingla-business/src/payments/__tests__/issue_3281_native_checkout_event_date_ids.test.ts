/**
 * issue #3281 — the Host app's NATIVE buyer checkout must send the guest's
 * chosen day SET (`eventDateIds`) to `ticket-checkout-create`, and must turn a
 * server refusal into buyer copy instead of the raw token.
 *
 * Production symptom (2026-10-14, MinglaHost/38): a guest on a recurring event
 * with 48 upcoming nights tapped Pay and saw `event_date_choice_required` in
 * red. The public page and cart held the day; `useNativeCheckoutFlow` had no
 * `eventDateIds` field and dropped it, and `extractEdgeFunctionError` returned
 * the server token verbatim.
 *
 * Runtime test: the REAL hook runs against mocked transport and Stripe, and the
 * assertions read the request body the hook actually built.
 */

import fs from "node:fs";
import path from "node:path";

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

const SATURDAY = "11111111-1111-4111-8111-111111111111";
const SUNDAY = "22222222-2222-4222-8222-222222222222";

const baseInput = {
  eventId: "ev_multi_date",
  lines: [{ ticketTypeId: "tt_1", quantity: 2 }],
  buyer: { name: "Ada Guest", email: "guest@example.com", phone: "+2348000000000" },
};

const refusal = (status: number, body: Record<string, unknown>) => ({
  message: "Edge Function returned a non-2xx status code",
  context: {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  },
});

const lastBody = (): Record<string, unknown> => {
  const call = invoke.mock.calls[invoke.mock.calls.length - 1];
  expect(call[0]).toBe("ticket-checkout-create");
  return (call[1] as { body: Record<string, unknown> }).body;
};

beforeEach(() => {
  invoke.mockReset();
});

describe("#3281 native checkout sends the chosen day set", () => {
  it("forwards eventDateIds for a multi-date event", async () => {
    invoke.mockResolvedValue({
      data: { kind: "free_completed", orderId: "ord_1" },
      error: null,
    });
    const run = useNativeCheckoutFlow();
    const outcome = await run({ ...baseInput, eventDateIds: [SATURDAY, SUNDAY] });

    expect(outcome).toEqual({ outcome: "succeeded", orderId: "ord_1" });
    expect(lastBody().eventDateIds).toEqual([SATURDAY, SUNDAY]);
    expect(lastBody().surface).toBe("native");
  });

  it("keeps sending the legacy eventDateId alongside the set", async () => {
    invoke.mockResolvedValue({
      data: { kind: "free_completed", orderId: "ord_2" },
      error: null,
    });
    await useNativeCheckoutFlow()({
      ...baseInput,
      eventDateId: SATURDAY,
      eventDateIds: [SATURDAY],
    });
    expect(lastBody().eventDateId).toBe(SATURDAY);
    expect(lastBody().eventDateIds).toEqual([SATURDAY]);
  });

  it("omits eventDateIds on a single-date checkout (byte-identical body)", async () => {
    invoke.mockResolvedValue({
      data: { kind: "free_completed", orderId: "ord_3" },
      error: null,
    });
    await useNativeCheckoutFlow()({ ...baseInput, eventDateIds: [] });
    expect("eventDateIds" in lastBody()).toBe(false);
    expect("eventDateId" in lastBody()).toBe(false);
  });
});

describe("#3281 native checkout refusals render friendly copy", () => {
  it("maps event_date_choice_required to the date-choice sentence, never the raw token", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: refusal(422, { error: "event_date_choice_required" }),
    });
    const outcome = await useNativeCheckoutFlow()(baseInput);

    expect(outcome.outcome).toBe("failed");
    const message = (outcome as { message: string }).message;
    expect(message).toBe(
      "Choose which date you're coming to, then try again — nothing was reserved.",
    );
    expect(message).not.toContain("event_date_choice_required");
    expect(message).not.toMatch(/[a-z]+_[a-z]+_[a-z]+/);
  });

  it("maps a raise token carried in `detail` too", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: refusal(409, {
        error: "checkout_session_failed",
        detail: "ticket_sales_ended",
      }),
    });
    const outcome = await useNativeCheckoutFlow()(baseInput);
    const message = (outcome as { message: string }).message;
    expect(message).toBe("Sales have closed for this ticket. Nothing was reserved.");
    expect(message).not.toContain("checkout_session_failed");
  });

  it("falls back to the generic paid message for an unknown code, never the raw code", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: refusal(400, { error: "some_brand_new_server_token" }),
    });
    const outcome = await useNativeCheckoutFlow()(baseInput);
    const message = (outcome as { message: string }).message;
    expect(message).toBe(
      "We couldn't start your payment. You have not been charged — please try again.",
    );
    expect(message).not.toContain("some_brand_new_server_token");
  });
});

describe("#3281 the native all-in price check carries the chosen day set", () => {
  const payment = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "app", "checkout", "[eventId]", "payment.tsx"),
    "utf8",
  );

  it("the mode:\"preview\" create body forwards eventDateIds and re-runs when they change", () => {
    const start = payment.indexOf('mode: "preview"');
    expect(start).toBeGreaterThan(-1);
    const effectEnd = payment.indexOf("}, [", start);
    expect(effectEnd).toBeGreaterThan(start);
    const previewBlock = payment.slice(start, effectEnd);
    const codeOnly = previewBlock
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(codeOnly).toMatch(/eventDateIds:\s*\[\.\.\.eventDateIds\]/);

    const depsEnd = payment.indexOf("]);", effectEnd);
    const deps = payment.slice(effectEnd, depsEnd);
    expect(deps).toMatch(/\beventDateIds\b/);
  });
});
