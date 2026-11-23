/**
 * #4490 spec 08 O5 part A — PINs on a shared Till device (client half).
 *
 *  1. pinModel: weak PINs (mirror of the server), the pad's typing rules, the
 *     words after a refusal ("Wrong PIN. {n} tries left", locks), who shows on
 *     Who's selling and who may approve.
 *  2. tillStaffSession: the token lives in memory only (never AsyncStorage,
 *     localStorage or the query cache), sign-out clears it, the auto-lock clock.
 *  3. venueTillService: every Till call carries the device's session in the
 *     POST body; a lost session clears it; a refund or a sent void asks for a
 *     fresh PIN and retries with it; a wrong PIN asks again with the reason;
 *     cancelling moves nothing; an account with no session sends exactly what
 *     it sent before.
 *
 * fails-on-revert: each block names the rule it pins.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<(fn: string, options: { body: Record<string, unknown> }) => Promise<unknown>>();
jest.mock("../../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (fn: string, options: { body: Record<string, unknown> }) => mockInvoke(fn, options) },
  },
}));

const mockSetItem = jest.fn();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { setItem: (...a: unknown[]) => mockSetItem(...a), getItem: jest.fn(), removeItem: jest.fn() },
}));

import {
  answerStepUp,
  clearAllTillStaffSessions,
  getTillStaffSession,
  noteTillActivity,
  setTillStaffSession,
  subscribeTillStaff,
  tillSessionEndedReason,
  tillSessionIdle,
} from "../../../../services/tillStaffSession";
import { runSignOutCleanups } from "../../../../utils/signOutCleanups";
import {
  endTillPin,
  fetchTillChecks,
  refundTill,
  TillError,
  unlockTillPin,
  voidTillLine,
} from "../../../../services/venueTillService";
import {
  approvers,
  pinAppend,
  pinComplete,
  pinIsWeak,
  pinRetryMessage,
  personInitials,
  sellerFaces,
  whoStateAfter,
  wrongPinCopy,
} from "../pinModel";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const TOKEN = "ab".repeat(32);

/** A supabase-js FunctionsHttpError-like failure carrying the edge's JSON body. */
function edgeError(body: Record<string, unknown>): { data: null; error: { message: string; context: { json: () => Promise<unknown> } } } {
  return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => body } } };
}
const success = (data: unknown) => ({ data: { kind: "success", data }, error: null });

function session(): void {
  setTillStaffSession({
    venueId: VENUE, token: TOKEN, memberId: "m1", memberUserId: "u1", name: "Ada", canApprove: false, autoLockMinutes: 2,
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockSetItem.mockReset();
  clearAllTillStaffSessions();
});

describe("1. pinModel", () => {
  test("weak PINs mirror the server: 0000, 1234, 4321, one digit repeated, straight runs, not 4-6 digits", () => {
    for (const p of ["0000", "1111", "1234", "4321", "012345", "98765", "123", "1234567", "12a4", ""]) {
      expect(pinIsWeak(p)).toBe(true);
    }
    for (const p of ["2580", "1235", "739104", "9157"]) expect(pinIsWeak(p)).toBe(false);
  });

  test("the pad takes digits only, at most six; OK needs four", () => {
    let pin = "";
    for (const d of ["1", "x", "2", "3"]) pin = pinAppend(pin, d);
    expect(pin).toBe("123");
    expect(pinComplete(pin)).toBe(false);
    for (const d of ["4", "5", "6", "7"]) pin = pinAppend(pin, d);
    expect(pin).toBe("123456");
    expect(pinComplete(pin)).toBe(true);
  });

  test("refusals in words: tries left, the 5-minute lock, the hard lock, no money rights", () => {
    expect(wrongPinCopy(3)).toBe("Wrong PIN. 3 tries left");
    expect(wrongPinCopy(1)).toBe("Wrong PIN. 1 try left");
    expect(wrongPinCopy(null)).toBe("Wrong PIN. Try again.");
    expect(pinRetryMessage({ code: "pin_hard_locked", triesLeft: null, lockedUntil: null })).toBe("Ask a manager to unlock your PIN");
    expect(pinRetryMessage({ code: "pin_locked", triesLeft: null, lockedUntil: "2028-01-01T21:19:00" })).toContain("Locked for 5 minutes");
    expect(pinRetryMessage({ code: "pin_no_rights", triesLeft: null, lockedUntil: null })).toContain("money rights");
    expect(pinRetryMessage({ code: "till_failed", triesLeft: null, lockedUntil: null })).toBeNull();
    expect(whoStateAfter("m1", { code: "pin_locked", triesLeft: null, lockedUntil: "x" }).kind).toBe("locked");
    expect(whoStateAfter("m1", { code: "pin_hard_locked", triesLeft: null, lockedUntil: null }).kind).toBe("hard");
    expect(whoStateAfter("m1", { code: "pin_wrong", triesLeft: 2, lockedUntil: null })).toEqual({ kind: "pin", memberId: "m1", error: "Wrong PIN. 2 tries left" });
  });

  test("Who's selling shows sellers; approvals list money rights (a finance manager approves, never sells)", () => {
    const people = [
      { memberId: "a", name: "Ada Okafor", role: "venue_staff", profile: "custom", canSell: true, canApprove: false, canManage: false },
      { memberId: "f", name: "Femi", role: "finance_manager", profile: null, canSell: false, canApprove: true, canManage: false },
      { memberId: "c", name: "Chioma", role: "venue_staff", profile: "restaurant_manager", canSell: true, canApprove: true, canManage: true },
    ];
    expect(sellerFaces(people).map((p) => p.memberId)).toEqual(["a", "c"]);
    expect(approvers(people).map((p) => p.memberId)).toEqual(["f", "c"]);
    expect(personInitials("Ada Okafor")).toBe("AO");
  });
});

describe("2. tillStaffSession: memory only", () => {
  test("the token is never written to AsyncStorage or localStorage; sign-out clears it", () => {
    const ls = { setItem: jest.fn() };
    (globalThis as unknown as { localStorage?: unknown }).localStorage = ls;
    session();
    expect(getTillStaffSession(VENUE)?.token).toBe(TOKEN);
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(ls.setItem).not.toHaveBeenCalled();
    runSignOutCleanups();
    expect(getTillStaffSession(VENUE)).toBeNull();
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  });

  test("the auto-lock clock: idle after the venue's minutes without a touch; a touch restarts it", () => {
    setTillStaffSession({ venueId: VENUE, token: TOKEN, memberId: "m1", memberUserId: "u1", name: "Ada", canApprove: false, autoLockMinutes: 2 }, 1_000);
    const s = getTillStaffSession(VENUE);
    expect(s).not.toBeNull();
    if (s === null) return;
    expect(tillSessionIdle(s, 1_000 + 119_000)).toBe(false);
    expect(tillSessionIdle(s, 1_000 + 120_000)).toBe(true);
    noteTillActivity(VENUE, 100_000);
    expect(tillSessionIdle(s, 1_000 + 120_000)).toBe(false);
  });

  test("auto-lock ends the session here and tells the server; Who's selling then says why", async () => {
    session();
    mockInvoke.mockResolvedValueOnce(success({ ended: 1 }));
    await endTillPin(VENUE, "auto_lock");
    expect(getTillStaffSession(VENUE)).toBeNull();
    expect(tillSessionEndedReason(VENUE)).toBe("auto_lock");
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ action: "pin_end", venueId: VENUE, staffSession: TOKEN, reason: "auto_lock" });
  });
});

describe("3. venueTillService and the PIN session", () => {
  test("an account with no PIN session sends exactly what it sent before (no staffSession key)", async () => {
    mockInvoke.mockResolvedValueOnce(success({ open: [], paid: [] }));
    await fetchTillChecks(VENUE);
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ action: "checks", venueId: VENUE });
  });

  test("a Till device's calls carry the session in the POST body", async () => {
    session();
    mockInvoke.mockResolvedValueOnce(success({ open: [], paid: [] }));
    await fetchTillChecks(VENUE);
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ action: "checks", venueId: VENUE, staffSession: TOKEN });
  });

  test("a lost session (ended, expired, idle, another device) clears it, so Who's selling shows", async () => {
    session();
    mockInvoke.mockResolvedValueOnce(edgeError({ code: "pin_session_invalid" }));
    await expect(fetchTillChecks(VENUE)).rejects.toMatchObject({ code: "pin_session_invalid" });
    expect(getTillStaffSession(VENUE)).toBeNull();
    expect(tillSessionEndedReason(VENUE)).toBe("server");
  });

  test("unlock keeps the token in memory only and never in the result", async () => {
    mockInvoke.mockResolvedValueOnce(success({ staffSession: TOKEN, autoLockMinutes: 3, member: { memberId: "m1", userId: "u1", name: "Ada", canApprove: true } }));
    const result = await unlockTillPin({ venueId: VENUE, memberId: "m1", pin: "2580" });
    expect(result).toBeUndefined();
    expect(getTillStaffSession(VENUE)).toMatchObject({ token: TOKEN, name: "Ada", autoLockMinutes: 3, canApprove: true });
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  test("a refund asks for a fresh PIN, retries with it, asks again after a wrong one, and runs once", async () => {
    session();
    const unsubscribe = subscribeTillStaff(() => undefined);
    mockInvoke
      .mockResolvedValueOnce(edgeError({ code: "pin_step_up_required" }))
      .mockResolvedValueOnce(edgeError({ code: "pin_wrong", triesLeft: 4 }))
      .mockResolvedValueOnce(success({ sale: null, refund: { id: "r1" } }));
    const done = refundTill({ venueId: VENUE, paymentId: "p1", amountMinor: 100, tipMinor: 0, reason: "Wrong drink", restock: false, clientRequestId: "c1" } as never);
    // The open sheet answers the first prompt with a wrong PIN, the second with a manager's.
    await new Promise((r) => setTimeout(r, 0));
    answerStepUp({ pin: "1111", memberId: null });
    await new Promise((r) => setTimeout(r, 0));
    answerStepUp({ pin: "4826", memberId: "manager-row" });
    await done;
    unsubscribe();
    const bodies = mockInvoke.mock.calls.map((c) => c[1].body);
    expect(bodies).toHaveLength(3);
    expect(bodies[0].stepUp).toBeUndefined();
    expect(bodies[1].stepUp).toEqual({ pin: "1111" });
    expect(bodies[2].stepUp).toEqual({ pin: "4826", memberId: "manager-row" });
    expect(bodies.every((b) => b.staffSession === TOKEN)).toBe(true);
  });

  test("cancelling the PIN moves nothing and says so", async () => {
    session();
    mockInvoke.mockResolvedValueOnce(edgeError({ code: "pin_step_up_required" }));
    const done = voidTillLine({ venueId: VENUE, saleId: "s1", orderItemId: "i1", reason: "made wrong", restock: false, expectedVersion: 3 } as never);
    await new Promise((r) => setTimeout(r, 0));
    answerStepUp(null);
    await expect(done).rejects.toBeInstanceOf(TillError);
    await expect(done).rejects.toMatchObject({ code: "pin_step_up_cancelled" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test("without a PIN session a step-up code is never turned into a prompt (an owner's own phone)", async () => {
    mockInvoke.mockResolvedValueOnce(edgeError({ code: "pin_step_up_required" }));
    await expect(refundTill({ venueId: VENUE, paymentId: "p1", amountMinor: 100, tipMinor: 0, reason: "x", restock: false, clientRequestId: "c1" } as never))
      .rejects.toMatchObject({ code: "pin_step_up_required" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
