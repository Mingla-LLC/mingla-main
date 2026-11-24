/**
 * #4490 spec 08 O5 part C — a sold-out refund on a Till device asks for a
 * fresh PIN (part A's refund rule) and retries with it; a wrong PIN asks
 * again with the reason; Cancel moves nothing; a signed-in account (no PIN
 * session) is never prompted; a swap never asks.
 * fails-on-revert: drop withStepUp from resolveSoldOut and the first test
 * sees one call and a pin_step_up_required rejection.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<(fn: string, options: { body: Record<string, unknown> }) => Promise<unknown>>();
jest.mock("../../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (fn: string, options: { body: Record<string, unknown> }) => mockInvoke(fn, options) },
  },
}));

import {
  answerStepUp,
  clearAllTillStaffSessions,
  getTillStaffSession,
  setTillStaffSession,
  subscribeTillStaff,
} from "../../../../services/tillStaffSession";
import { resolveSoldOut, StockError } from "../../../../services/venueStockService";
import { stockErrorCopy } from "../stockCopy";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const TOKEN = "cd".repeat(32);
const ORDER = "00000000-4490-4000-8000-0000000000b1";
const LINE = "00000000-4490-4000-8000-0000000000c1";

function edgeError(body: Record<string, unknown>) {
  // A Response-like context: the service reads a clone of it.
  const context = { json: async () => body, clone: () => context };
  return { data: null, error: { message: "Edge Function returned a non-2xx status code", context } };
}
const resolved = { data: { resolution: { resolution: "refund", refundMinor: 2035000, swapName: null, replayed: false } }, error: null };
const tick = () => new Promise((r) => setTimeout(r, 0));
const refund = () =>
  resolveSoldOut({ venueId: VENUE, orderId: ORDER, orderItemIds: [LINE], resolution: "refund", swapMenuItemId: null, requestId: "req-00000001" });

function session(): void {
  setTillStaffSession({
    venueId: VENUE, token: TOKEN, memberId: "m1", memberUserId: "u1", name: "Ada", canApprove: false, autoLockMinutes: 2,
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  clearAllTillStaffSessions();
});

describe("sold-out refund on a Till device: the PIN step-up", () => {
  test("asks for a PIN, asks again after a wrong one with tries left, then runs once as the same decision", async () => {
    session();
    const unsubscribe = subscribeTillStaff(() => undefined);
    mockInvoke
      .mockResolvedValueOnce(edgeError({ error: "pin_step_up_required" }))
      .mockResolvedValueOnce(edgeError({ error: "pin_wrong", code: "pin_wrong", triesLeft: 2 }))
      .mockResolvedValueOnce(resolved);
    const done = refund();
    await tick();
    answerStepUp({ pin: "1111", memberId: null });
    await tick();
    answerStepUp({ pin: "4826", memberId: "manager-row" });
    const result = await done;
    unsubscribe();
    expect(result).toMatchObject({ resolution: "refund", refundMinor: 2035000, replayed: false });
    const bodies = mockInvoke.mock.calls.map((c) => c[1].body);
    expect(mockInvoke.mock.calls.every((c) => c[0] === "venue-order-staff")).toBe(true);
    expect(bodies).toHaveLength(3);
    expect(bodies[0].stepUp).toBeUndefined();
    expect(bodies[1].stepUp).toEqual({ pin: "1111" });
    expect(bodies[2].stepUp).toEqual({ pin: "4826", memberId: "manager-row" });
    // One decision: the same request id every time, so the server refunds once.
    expect(new Set(bodies.map((b) => b.requestId))).toEqual(new Set(["req-00000001"]));
    expect(bodies.every((b) => b.staffSession === TOKEN)).toBe(true);
  });

  test("a wrong PIN does not end the flow: the next answer is awaited", async () => {
    session();
    const unsubscribe = subscribeTillStaff(() => undefined);
    mockInvoke
      .mockResolvedValueOnce(edgeError({ error: "pin_step_up_required" }))
      .mockResolvedValueOnce(edgeError({ error: "pin_wrong", triesLeft: 2 }))
      .mockResolvedValueOnce(resolved);
    const done = refund();
    await tick();
    answerStepUp({ pin: "1111", memberId: null });
    await tick();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    answerStepUp({ pin: "4826", memberId: null });
    await done;
    unsubscribe();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  test("Cancel moves nothing and ends with pin_step_up_cancelled", async () => {
    session();
    mockInvoke.mockResolvedValueOnce(edgeError({ error: "pin_step_up_required" }));
    const done = refund();
    await tick();
    answerStepUp(null);
    await expect(done).rejects.toBeInstanceOf(StockError);
    await expect(done).rejects.toMatchObject({ code: "pin_step_up_cancelled" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test("a lost PIN session ends the session and is not a prompt", async () => {
    session();
    mockInvoke
      .mockResolvedValueOnce(edgeError({ error: "pin_step_up_required" }))
      .mockResolvedValueOnce(edgeError({ error: "pin_session_invalid" }));
    const done = refund();
    await tick();
    answerStepUp({ pin: "4826", memberId: null });
    await expect(done).rejects.toMatchObject({ code: "pin_session_invalid" });
    expect(getTillStaffSession(VENUE)).toBeNull();
  });

  test("without a PIN session (an account signed in as itself) the code is never turned into a prompt", async () => {
    mockInvoke.mockResolvedValueOnce(edgeError({ error: "pin_step_up_required" }));
    await expect(refund()).rejects.toMatchObject({ code: "pin_step_up_required" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(stockErrorCopy("pin_step_up_required")).not.toMatch(/own sign-in/);
  });

  test("a swap that succeeds sends no PIN", async () => {
    session();
    mockInvoke.mockResolvedValueOnce({ data: { resolution: { resolution: "swap", refundMinor: 0, swapName: "Rice", replayed: false } }, error: null });
    const r = await resolveSoldOut({ venueId: VENUE, orderId: ORDER, orderItemIds: [LINE], resolution: "swap", swapMenuItemId: LINE, requestId: "req-00000002" });
    expect(r).toMatchObject({ resolution: "swap", swapName: "Rice" });
    expect(mockInvoke.mock.calls[0][1].body.stepUp).toBeUndefined();
  });
});
