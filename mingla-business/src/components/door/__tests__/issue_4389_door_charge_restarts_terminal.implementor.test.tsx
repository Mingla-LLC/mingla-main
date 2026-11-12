/* eslint-disable import/first */
/**
 * #4389 (iPhone 15 recording 23:10, ~304–330 s) — the app reopened while the
 * local functions server was restarting, so Stripe Terminal's start failed
 * (no connection token). Charge in Door mode, for a brand already set up on
 * this phone, then handed the basket straight to the Tap to Pay route, which
 * showed the full setup screen with the stale red "Couldn't start…".
 *
 *   D1 Charge with a failed Terminal start restarts Terminal, shows "starting"
 *      in place and does NOT hand off;
 *   D2 once the restart is ready, the same Charge carries on (the sale starts);
 *   D3 only a restart that fails again hands off (the route shows Try again).
 *
 * FAILS ON REVERT: the `session.status === "error"` restart branch removed →
 * D1 hands off at once.
 */
import React from "react";
import { describe, expect, jest, test, beforeEach } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { unmount: () => void };
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

const mockCreateIntent = jest.fn(() => new Promise(() => undefined));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../../hooks/useEventDoorSales", () => ({ doorSaleKeys: { byEvent: () => ["door-sales"] } }));
jest.mock("../../../services/terminal/doorTapEdge", () => ({
  createDoorTapIntent: (...a: unknown[]) => mockCreateIntent(...(a as [])),
  completeDoorTapIntent: jest.fn(),
  cancelDoorTapIntent: jest.fn(async () => undefined),
  markDoorTapOutcomeSeen: jest.fn(async () => undefined),
  DoorTapError: class DoorTapError extends Error {},
}));

import { useDoorModeTapSale, type DoorModeTapSale } from "../useDoorModeTapSale";
import { resetTapToPaySessionForTests, updateTapToPaySession } from "../../../services/terminal/tapToPaySession";

const DRAFT = { lines: [{ ticketTypeId: "tier-1", quantity: 1 }], eventDateId: null, buyerPhone: null, phoneCountryIso: null };
const client = {
  ensureReaderConnected: jest.fn(async () => ({})),
  checkDeviceSupport: async () => ({ supported: true }),
  retrievePaymentIntent: async () => ({}),
  collectPaymentMethod: async () => ({}),
  confirmPaymentIntent: async () => ({}),
  cancelCollectPaymentMethod: async () => ({}),
};

let api: DoorModeTapSale | null = null;
const handOff = jest.fn();
const Probe = (): null => {
  api = useDoorModeTapSale({ eventId: "event-1", handOff });
  return null;
};
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await TestRenderer.act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  resetTapToPaySessionForTests();
  handOff.mockClear();
  mockCreateIntent.mockClear();
  api = null;
});

const start = async (retry: jest.Mock): Promise<{ unmount: () => void }> => {
  updateTapToPaySession({ status: "error", client: null, errorMessage: "Couldn't start.", retryInitialize: retry } as never);
  let r: { unmount: () => void } | null = null;
  await TestRenderer.act(async () => { r = TestRenderer.create(<Probe />); });
  await TestRenderer.act(async () => api?.charge(DRAFT as never, "basket-1"));
  await flush();
  return r as unknown as { unmount: () => void };
};

describe("#4389 — Charge on a set-up phone restarts a failed Terminal in place", () => {
  test("D1: restart, 'starting', no hand-off", async () => {
    const retry = jest.fn();
    const r = await start(retry);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(handOff).not.toHaveBeenCalled();
    expect(api?.state.kind).toBe("starting");
    r.unmount();
  });

  test("D2: the restart comes up ready → the same Charge starts the sale", async () => {
    const r = await start(jest.fn());
    await TestRenderer.act(async () => updateTapToPaySession({ status: "initializing" } as never));
    await TestRenderer.act(async () => updateTapToPaySession({ status: "ready", client, errorMessage: null } as never));
    await flush();
    expect(handOff).not.toHaveBeenCalled();
    expect(mockCreateIntent).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  test("D3: a restart that fails again hands off", async () => {
    const r = await start(jest.fn());
    await TestRenderer.act(async () => updateTapToPaySession({ status: "initializing" } as never));
    await TestRenderer.act(async () => updateTapToPaySession({ status: "error", errorMessage: "Couldn't start." } as never));
    await flush();
    expect(handOff).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});
