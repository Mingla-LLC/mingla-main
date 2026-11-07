/**
 * #4271 tap-address — a brand whose address is incomplete is led into setup,
 * which says what to add; it is never told "this phone can't take taps".
 *
 * The server refuses with tap_not_available + reason address_missing when the
 * brand's address has no state and ZIP (US) or postcode (UK). Before this fix
 * the sale flow read that refusal as "not on this phone" and the setup screen
 * asked only for "the brand's address".
 *
 * fails-on-revert: deleting the address_missing branch in TapToPaySaleFlow
 * (createIntent) or restoring the old setup copy fails an assertion here.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../supabase", () => ({ supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() } }));

import { DoorTapError } from "../doorTapEdge";
import {
  TapToPaySaleFlow,
  type TapSaleState,
  type TapToPayServer,
  type TapToPayTerminalClient,
} from "../tapToPayFlow";
import { runTapToPaySetup, TAP_ADDRESS_MISSING_COPY } from "../tapToPaySetup";
import type { TapToPayDraft } from "../tapToPayDraft";
import { buildDoorPaymentOptions } from "../../../components/door/doorPaymentOptions";

const DRAFT = {
  lines: [{ ticketTypeId: "t", quantity: 1 }],
  eventDateId: null,
  buyerPhone: null,
  phoneCountryIso: null,
} as unknown as TapToPayDraft;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
};

const saleWithRefusal = (refusal: DoorTapError) => {
  const states: TapSaleState[] = [];
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: jest.fn(async () => ({})),
    retrievePaymentIntent: jest.fn(async () => ({})),
    collectPaymentMethod: jest.fn(async () => ({})),
    confirmPaymentIntent: jest.fn(async () => ({})),
    cancelCollectPaymentMethod: jest.fn(async () => ({})),
  };
  const createIntent = jest.fn<TapToPayServer["createIntent"]>(async () => {
    throw refusal;
  });
  const flow = new TapToPaySaleFlow({
    eventId: "e",
    draft: DRAFT,
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    terminal,
    server: {
      createIntent,
      cancelIntent: jest.fn(async () => undefined),
      completeIntent: jest.fn(async () => ({ orderId: "o", ticketIds: [], receiptQueued: false, replayed: false })),
    },
    onState: (s) => states.push(s),
  });
  return { flow, states, terminal };
};

describe("#4271 tap-address: the door sheet still offers Tap to Pay", () => {
  test("availability has no address input, so an available brand lists Tap to Pay first", () => {
    for (const needsSetup of [true, false]) {
      const options = buildDoorPaymentOptions({
        eventCurrency: "USD",
        tapToPay: { available: true, needsSetup },
        platform: "ios",
      });
      expect(options[0]).toMatchObject({ id: "tap_to_pay", disabled: false });
    }
  });

  test("unchanged when Tap to Pay is not available: no row", () => {
    const options = buildDoorPaymentOptions({
      eventCurrency: "USD",
      tapToPay: { available: false, needsSetup: false },
      platform: "ios",
    });
    expect(options.some((o) => o.id === "tap_to_pay")).toBe(false);
  });
});

describe("#4271 tap-address: a sale refused for the address goes to setup", () => {
  test("tap_not_available + address_missing → needs_setup, never 'not on this phone', reader untouched", async () => {
    const h = saleWithRefusal(new DoorTapError("tap_not_available", "address_missing"));
    await h.flow.start();
    await flush();
    const kinds = h.states.map((s) => s.kind);
    expect(kinds).toContain("needs_setup");
    expect(kinds).not.toContain("not_on_this_phone");
    expect(h.terminal.ensureReaderConnected).not.toHaveBeenCalled();
  });

  test("any other tap_not_available still reads as not available here", async () => {
    const h = saleWithRefusal(new DoorTapError("tap_not_available"));
    await h.flow.start();
    await flush();
    const kinds = h.states.map((s) => s.kind);
    expect(kinds).toContain("not_on_this_phone");
    expect(kinds).not.toContain("needs_setup");
  });
});

describe("#4271 tap-address: setup says exactly what to add", () => {
  const setup = (fetchLocation: () => Promise<string>) =>
    runTapToPaySetup({
      os: "ios",
      checkDeviceSupport: async () => ({ supported: true }),
      fetchLocation,
      ensureReaderConnected: async () => ({}),
      showHowToTap: async () => undefined,
      markComplete: async () => undefined,
    });

  test("address_missing → the full-address message", async () => {
    await expect(
      setup(async () => {
        throw new DoorTapError("tap_not_available", "address_missing");
      }),
    ).resolves.toEqual({ kind: "failed", message: TAP_ADDRESS_MISSING_COPY });
    expect(TAP_ADDRESS_MISSING_COPY).toBe(
      "Add your brand's full address (street, city, state and ZIP) in brand settings, then set up Tap to Pay again.",
    );
  });

  test("a brand whose address is complete sets up as before", async () => {
    await expect(setup(async () => "tml_1")).resolves.toEqual({ kind: "done", locationId: "tml_1" });
  });
});
