/**
 * #4271 follow-up — the buyer name a host types for a Tap to Pay sale is sent
 * with door-tap-intent create, the same way the buyer phone is, so the server
 * saves it on the sale (orders.buyer_name). Before this the name only showed on
 * the paid screen and the sale detail had none.
 *
 * Pins:
 *  1. createDoorTapIntent puts `buyerName` in the create body next to
 *     buyerPhone / phoneCountryIso; null when the host typed none.
 *  2. The sale flow hands the draft's name to createIntent; a draft without a
 *     name (an older link) sends null.
 *  3. The draft keeps the name trimmed and at most 120 characters (counted as
 *     characters, never cutting an emoji in half), the cash door sale's rule.
 *  4. The server's 400 buyer_name_invalid keeps its code (it is a known door-tap
 *     code, not "unknown") and the host sees "Check the buyer's name and try
 *     again." instead of the generic failure.
 *
 * fails-on-revert: dropping `buyerName` from the create body or from the flow's
 * createIntent call, dropping buyer_name_invalid from KNOWN_CODES, or dropping
 * its copy from the flow's server message fails an assertion here.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<(fn: string, options: { body: Record<string, unknown> }) => Promise<unknown>>();

jest.mock("../../supabase", () => ({
  supabase: {
    functions: { invoke: (fn: string, options: { body: Record<string, unknown> }) => mockInvoke(fn, options) },
  },
}));

import { createDoorTapIntent, DoorTapError, type DoorTapIntent } from "../doorTapEdge";
import {
  TapToPaySaleFlow,
  type TapToPayServer,
  type TapToPayTerminalClient,
} from "../tapToPayFlow";
import { encodeTapToPayDraft, parseTapToPayDraft, type TapToPayDraft } from "../tapToPayDraft";

const INTENT_BODY = {
  paymentIntentId: "pi_name",
  clientSecret: "pi_name_secret_x",
  totalCents: 2090,
  currency: "USD",
  stripeAccountId: "acct_1",
  locationId: "tml_1",
};

const INTENT: DoorTapIntent = { ...INTENT_BODY };

const baseInput = {
  eventId: "evt_1",
  eventDateId: null,
  lines: [{ ticketTypeId: "tt_1", quantity: 1 }],
  clientRequestId: "req-1",
  buyerPhone: "+12025550123",
  phoneCountryIso: "US",
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ data: INTENT_BODY, error: null });
});

describe("create sends the buyer name like the phone", () => {
  test("the typed name rides in the create body", async () => {
    await createDoorTapIntent({ ...baseInput, buyerName: "Ada Lovelace" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [fn, options] = mockInvoke.mock.calls[0];
    expect(fn).toBe("door-tap-intent");
    expect(options.body).toMatchObject({
      action: "create",
      buyerPhone: "+12025550123",
      phoneCountryIso: "US",
      buyerName: "Ada Lovelace",
    });
  });

  test("no name sends null (the server stores none)", async () => {
    await createDoorTapIntent({ ...baseInput, buyerName: null });
    const [, options] = mockInvoke.mock.calls[0];
    expect(options.body.buyerName).toBeNull();
  });
});

const makeFlow = (draft: TapToPayDraft) => {
  const createIntent = jest.fn<TapToPayServer["createIntent"]>(async () => INTENT);
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: jest.fn(async () => ({})),
    retrievePaymentIntent: jest.fn(async () => ({
      paymentIntent: { id: "pi_name", status: "requires_payment_method" },
    })),
    collectPaymentMethod: jest.fn(async () => ({
      paymentIntent: { id: "pi_name", status: "requires_confirmation" },
    })),
    confirmPaymentIntent: jest.fn(async () => ({
      paymentIntent: { id: "pi_name", status: "succeeded" },
    })),
    cancelCollectPaymentMethod: jest.fn(async () => ({})),
  };
  const flow = new TapToPaySaleFlow({
    eventId: "evt_1",
    draft,
    clientRequestId: "req-1",
    terminal,
    server: {
      createIntent,
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
  return { flow, createIntent };
};

describe("the sale flow passes the draft's name to create", () => {
  test("a typed name is sent", async () => {
    const h = makeFlow({
      lines: [{ ticketTypeId: "tt_1", quantity: 1 }],
      eventDateId: null,
      buyerPhone: null,
      phoneCountryIso: null,
      buyerName: "Ada Lovelace",
    });
    await h.flow.start();
    expect(h.createIntent).toHaveBeenCalledTimes(1);
    expect(h.createIntent.mock.calls[0][0]).toMatchObject({
      buyerName: "Ada Lovelace",
      buyerPhone: null,
    });
  });

  test("a draft without a name (older link) sends null", async () => {
    const h = makeFlow({
      lines: [{ ticketTypeId: "tt_1", quantity: 1 }],
      eventDateId: null,
      buyerPhone: "+12025550123",
      phoneCountryIso: "US",
    });
    await h.flow.start();
    expect(h.createIntent.mock.calls[0][0].buyerName).toBeNull();
  });
});

describe("the draft keeps the name by the cash sale's rule", () => {
  const roundTrip = (buyerName: string): string | null | undefined =>
    parseTapToPayDraft(
      encodeTapToPayDraft({
        lines: [{ ticketTypeId: "tt_1", quantity: 1 }],
        eventDateId: null,
        buyerPhone: null,
        phoneCountryIso: null,
        buyerName,
      }),
    )?.buyerName;

  test("trimmed", () => {
    expect(roundTrip("  Ada  ")).toBe("Ada");
  });

  test("blank is no name", () => {
    expect(roundTrip("   ")).toBeUndefined();
  });

  test("at most 120 characters, counted as characters", () => {
    const emoji = "\u{1F600}";
    const kept = roundTrip(emoji.repeat(130));
    expect(kept).toBeDefined();
    expect(Array.from(kept as string)).toHaveLength(120);
    expect(kept).toBe(emoji.repeat(120));
  });
});

describe("a refused buyer name tells the host what to fix", () => {
  const refuseName = () =>
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { status: 400, text: async () => JSON.stringify({ error: "buyer_name_invalid" }) },
      },
    });

  test("the 400 keeps its buyer_name_invalid code", async () => {
    refuseName();
    const caught = await createDoorTapIntent({ ...baseInput, buyerName: "Ada" }).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(DoorTapError);
    expect((caught as DoorTapError).code).toBe("buyer_name_invalid");
  });

  test("the sale screen says to check the buyer's name", async () => {
    refuseName();
    const h = makeFlow({
      lines: [{ ticketTypeId: "tt_1", quantity: 1 }],
      eventDateId: null,
      buyerPhone: null,
      phoneCountryIso: null,
      buyerName: "Ada",
    });
    h.createIntent.mockImplementation((input) => createDoorTapIntent(input));
    await h.flow.start();
    expect(h.flow.getState()).toEqual({ kind: "failed", message: "Check the buyer's name and try again." });
  });
});
