/**
 * issue #3281 — TESTER ADVERSARIAL regression (different angle from the
 * implementor's happy-path suite).
 *
 * The implementor proves three hand-picked refusals map to copy. This suite
 * proves the INVARIANT instead: for EVERY bounded `error` token that
 * `ticket-checkout-create` can return (read live from the edge function source,
 * so a token added later is covered automatically), in EVERY body shape the
 * transport can hand the client — top-level `error`, token in `detail`, a
 * non-JSON plain-text body, a token under `message`, a nested object — and at
 * every refusal status, the message the native Pay screen renders never
 * contains the raw token or any snake_case code.
 *
 * It also attacks the request side with malformed day sets: empty-string ids
 * are never sent, an all-empty set is omitted entirely, and two consecutive Pay
 * taps with different sets each send their OWN set (no stale capture).
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

const EDGE_SOURCE = fs.readFileSync(
  path.join(
    __dirname,
    "..", "..", "..", "..",
    "supabase", "functions", "ticket-checkout-create", "index.ts",
  ),
  "utf8",
);

/** Every bounded token the edge function can put in `error`. */
const SERVER_TOKENS: string[] = Array.from(
  new Set(
    Array.from(EDGE_SOURCE.matchAll(/error:\s*"([a-z][a-z0-9_]*)"/g)).map(
      (m) => m[1],
    ),
  ),
).filter((token) => token.includes("_"));

const SNAKE_CASE = /[a-z0-9]+_[a-z0-9_]+/;

type Shape = { name: string; build: (token: string) => unknown };

const jsonContext = (status: number, body: unknown) => ({
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const SHAPES: Shape[] = [
  {
    name: "top-level error",
    build: (t) => ({ error: t }),
  },
  {
    name: "token in detail",
    build: (t) => ({ error: "checkout_session_failed", detail: t }),
  },
  {
    name: "token under message",
    build: (t) => ({ message: t }),
  },
  {
    name: "nested detail object",
    build: (t) => ({ error: { code: t }, detail: { message: t } }),
  },
];

const STATUSES = [400, 409, 422, 500];

const baseInput = {
  eventId: "ev_recurring",
  lines: [{ ticketTypeId: "tt_1", quantity: 1 }],
  buyer: { name: "Ada Guest", email: "guest@example.com", phone: "+2348000000000" },
};

const SATURDAY = "11111111-1111-4111-8111-111111111111";
const SUNDAY = "22222222-2222-4222-8222-222222222222";

const bodyOfCall = (index: number): Record<string, unknown> =>
  (invoke.mock.calls[index][1] as { body: Record<string, unknown> }).body;

const renderedMessage = async (error: unknown): Promise<string> => {
  invoke.mockResolvedValueOnce({ data: null, error });
  const outcome = await useNativeCheckoutFlow()(baseInput);
  expect(outcome.outcome).toBe("failed");
  const message = (outcome as { message: unknown }).message;
  expect(typeof message).toBe("string");
  return message as string;
};

beforeEach(() => {
  invoke.mockReset();
});

describe("#3281 adversarial: no server token ever reaches the native Pay screen", () => {
  it("the edge source yields a real refusal list (guards against a vacuous loop)", () => {
    expect(SERVER_TOKENS.length).toBeGreaterThan(15);
    expect(SERVER_TOKENS).toContain("event_date_choice_required");
    expect(SERVER_TOKENS).toContain("occurrence_not_found");
  });

  it("every token x every JSON body shape x every status renders buyer copy", async () => {
    const leaks: string[] = [];
    for (const token of SERVER_TOKENS) {
      for (const shape of SHAPES) {
        for (const status of STATUSES) {
          const message = await renderedMessage({
            message: "Edge Function returned a non-2xx status code",
            context: jsonContext(status, shape.build(token)),
          });
          if (
            message.length === 0 ||
            message.includes(token) ||
            SNAKE_CASE.test(message) ||
            message.includes("non-2xx")
          ) {
            leaks.push(`${status} ${shape.name} ${token} -> ${message}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("a NON-JSON plain-text body carrying the token is never echoed", async () => {
    const leaks: string[] = [];
    for (const token of SERVER_TOKENS) {
      const message = await renderedMessage({
        message: "Edge Function returned a non-2xx status code",
        context: {
          status: 422,
          json: async () => {
            throw new SyntaxError("Unexpected token");
          },
          text: async () => token,
        },
      });
      if (message.includes(token) || SNAKE_CASE.test(message)) {
        leaks.push(`${token} -> ${message}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("an error with no readable body and a raw framework message is not echoed", async () => {
    const message = await renderedMessage({
      message: "event_date_choice_required",
    });
    expect(message).not.toContain("event_date_choice_required");
    expect(SNAKE_CASE.test(message)).toBe(false);
  });
});

describe("#3281 adversarial: malformed and changing day sets", () => {
  const ok = { data: { kind: "free_completed", orderId: "ord" }, error: null };

  it("strips empty-string ids and never sends an empty id to the server", async () => {
    invoke.mockResolvedValue(ok);
    await useNativeCheckoutFlow()({
      ...baseInput,
      eventDateIds: ["", SATURDAY, "", SUNDAY],
    });
    const sent = bodyOfCall(0).eventDateIds as string[];
    expect(sent).toEqual([SATURDAY, SUNDAY]);
    expect(sent).not.toContain("");
  });

  it("an all-empty day set is omitted, not sent as [] or ['']", async () => {
    invoke.mockResolvedValue(ok);
    await useNativeCheckoutFlow()({ ...baseInput, eventDateIds: ["", ""] });
    expect("eventDateIds" in bodyOfCall(0)).toBe(false);
  });

  it("duplicated ids still reach the server (it de-duplicates) with the day present", async () => {
    invoke.mockResolvedValue(ok);
    await useNativeCheckoutFlow()({
      ...baseInput,
      eventDateIds: [SATURDAY, SATURDAY],
    });
    const sent = bodyOfCall(0).eventDateIds as string[];
    expect(new Set(sent)).toEqual(new Set([SATURDAY]));
  });

  it("two Pay taps with different day sets each send their own latest set", async () => {
    invoke.mockResolvedValue(ok);
    const run = useNativeCheckoutFlow();
    await run({ ...baseInput, eventDateIds: [SATURDAY] });
    await run({ ...baseInput, eventDateIds: [SUNDAY] });
    expect(bodyOfCall(0).eventDateIds).toEqual([SATURDAY]);
    expect(bodyOfCall(1).eventDateIds).toEqual([SUNDAY]);
  });
});
