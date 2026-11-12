/**
 * #4271 follow-up tester — adversarial: the buyer name the app sends with a
 * Tap to Pay create is always one the server will store.
 *
 * A different angle from the implementor's suite (which pins that a plain name
 * rides in the body): hostile drafts, end to end from the `draft` route param
 * to the create body.
 *   B1 A name whose 120-unit cut would split an emoji (119 letters + an emoji)
 *      is sent whole, never ending in half a surrogate pair. A lone surrogate
 *      cannot be stored in Postgres text, so the old UTF-16 cut turned this
 *      name into a server error at insert.
 *   B2 Every hostile draft name the app sends satisfies the server's rule:
 *      trimmed (JS trim), not blank, at most 120 characters counted as code
 *      points, no lone surrogate. Blank-looking names (tab, newline, NBSP,
 *      ideographic space) send null.
 *   B3 The name sent is the draft's name, never the phone or another field,
 *      and the create body still carries the phone next to it.
 *
 * fails-on-revert: revert tapToPayDraft's code-point cut to `.slice(0, 120)`
 * -> B1/B2 fail; drop `buyerName` from the flow's createIntent call or from
 * createDoorTapIntent's body -> B3 fails.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<(fn: string, options: { body: Record<string, unknown> }) => Promise<unknown>>();

jest.mock("../../supabase", () => ({
  supabase: {
    functions: { invoke: (fn: string, options: { body: Record<string, unknown> }) => mockInvoke(fn, options) },
  },
}));

import { createDoorTapIntent, type DoorTapIntent } from "../doorTapEdge";
import { TapToPaySaleFlow, type TapToPayServer, type TapToPayTerminalClient } from "../tapToPayFlow";
import { parseTapToPayDraft, type TapToPayDraft } from "../tapToPayDraft";

const INTENT_BODY = {
  paymentIntentId: "pi_bn",
  clientSecret: "pi_bn_secret_x",
  totalCents: 2090,
  currency: "USD",
  stripeAccountId: "acct_1",
  locationId: "tml_1",
};
const INTENT: DoorTapIntent = { ...INTENT_BODY };

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ data: INTENT_BODY, error: null });
});

/** The route param exactly as the door sale builds it (base64 of UTF-8 JSON; Door mode since #4389). */
const draftParam = (buyerName: unknown, extra: Record<string, unknown> = {}): string =>
  Buffer.from(
    JSON.stringify({
      lines: [{ ticketTypeId: "tt_1", quantity: 1 }],
      eventDateId: null,
      buyerName,
      ...extra,
    }),
    "utf8",
  ).toString("base64");

const hasLoneSurrogate = (s: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

/** door-tap-intent's rule, and the column CHECK it protects. */
const serverAccepts = (name: unknown): boolean =>
  name === null ||
  (typeof name === "string" &&
    name === name.trim() &&
    name.length > 0 &&
    Array.from(name).length <= 120 &&
    !hasLoneSurrogate(name));

/** Runs the real sale flow + the real edge client for a draft; returns the create body. */
const sentBody = async (draft: TapToPayDraft): Promise<Record<string, unknown>> => {
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: jest.fn(async () => ({})),
    retrievePaymentIntent: jest.fn(async () => ({
      paymentIntent: { id: "pi_bn", status: "requires_payment_method" },
    })),
    collectPaymentMethod: jest.fn(async () => ({
      paymentIntent: { id: "pi_bn", status: "requires_confirmation" },
    })),
    confirmPaymentIntent: jest.fn(async () => ({
      paymentIntent: { id: "pi_bn", status: "succeeded" },
    })),
    cancelCollectPaymentMethod: jest.fn(async () => ({})),
  };
  const flow = new TapToPaySaleFlow({
    eventId: "evt_1",
    draft,
    clientRequestId: "req-bn",
    terminal,
    server: {
      // The real edge client, so the body is what actually leaves the phone.
      createIntent: async (input) => {
        await createDoorTapIntent(input);
        return INTENT;
      },
      completeIntent: jest.fn<TapToPayServer["completeIntent"]>(async () => ({
        orderId: "ord_1",
        ticketIds: ["t1"],
        receiptQueued: false,
        replayed: false,
      })),
      cancelIntent: jest.fn(async () => {}),
    },
    onState: () => {},
  });
  await flow.start();
  const createCall = mockInvoke.mock.calls.find(([, o]) => o.body.action === "create");
  expect(createCall).toBeDefined();
  return (createCall as [string, { body: Record<string, unknown> }])[1].body;
};

describe("B1 a name is never cut inside an emoji", () => {
  test("119 letters + an emoji is sent whole", async () => {
    const name = "x".repeat(119) + "\u{1F600}"; // 120 characters, 121 UTF-16 units
    const draft = parseTapToPayDraft(draftParam(name));
    expect(draft).not.toBeNull();
    const body = await sentBody(draft as TapToPayDraft);
    expect(body.buyerName).toBe(name);
    expect(hasLoneSurrogate(body.buyerName as string)).toBe(false);
  });

  test("an over-long emoji name is cut to 120 whole characters", async () => {
    const draft = parseTapToPayDraft(draftParam("Ada " + "\u{1F469}\u{1F3FD}".repeat(80)));
    const body = await sentBody(draft as TapToPayDraft);
    const sent = body.buyerName as string;
    expect(Array.from(sent)).toHaveLength(120);
    expect(hasLoneSurrogate(sent)).toBe(false);
  });
});

describe("B2 every hostile draft name is one the server stores", () => {
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
  const hostile: unknown[] = [
    "\t", "\n", "\r\n", " ", "　", "﻿", " \t \n ",
    " 　 Ada Lovelace \t\n",
    "Ada\tLovelace", "Ada\nLovelace",
    "x".repeat(119) + "\u{1F600}",
    "x".repeat(118) + " \u{1F600}\u{1F600}",
    "\u{1F600}".repeat(200),
    family.repeat(30),
    "x".repeat(119) + " " + "y",
    "é".repeat(80),
    42, true, { first: "Ada" }, ["Ada"], null,
  ];
  test.each(hostile.map((h) => [JSON.stringify(h), h]))("%s", async (_label, name) => {
    const draft = parseTapToPayDraft(draftParam(name));
    expect(draft).not.toBeNull();
    const body = await sentBody(draft as TapToPayDraft);
    expect(serverAccepts(body.buyerName)).toBe(true);
  });

  test("blank-looking names send null", async () => {
    for (const blank of ["\t", "\n", " ", "　", " \t \n "]) {
      mockInvoke.mockClear();
      const body = await sentBody(parseTapToPayDraft(draftParam(blank)) as TapToPayDraft);
      expect(body.buyerName).toBeNull();
    }
  });
});

describe("B3 the name rides in its own field", () => {
  test("name and phone are each in their own key", async () => {
    const draft = parseTapToPayDraft(
      draftParam("  Grace Hopper ", { buyerPhone: "+12025550199", phoneCountryIso: "US" }),
    );
    const body = await sentBody(draft as TapToPayDraft);
    expect(body).toMatchObject({
      action: "create",
      buyerName: "Grace Hopper",
      buyerPhone: "+12025550199",
      phoneCountryIso: "US",
    });
    const carriesName = Object.entries(body)
      .filter(([, v]) => typeof v === "string" && (v as string).includes("Grace"))
      .map(([k]) => k);
    expect(carriesName).toEqual(["buyerName"]);
  });
});
