/**
 * #4490 spec 08 O5 fix 3 — the Host side of "a fresh PIN, used once":
 * - a swap to something cheaper gives money back, so only someone who may
 *   refund can pick it (a same-price swap stays open to anyone who may swap);
 * - the day-close PDF on a Till device asks for the export PIN (as the CSV
 *   does) and is sent again with it; a signed-in account is never asked;
 * - the CSV formula guard reads the first non-space character (full-width
 *   = + - @ too) and keeps an international phone number as quoted text with
 *   no visible apostrophe;
 * - the new server codes have words.
 * fails-on-revert: let a cheaper swap be picked without refund rights and
 * F3B-1 fails; send the PDF once without the step-up loop and F3B-2 fails;
 * go back to the first-character formula rule and F3B-4 fails.
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
  setTillStaffSession,
  subscribeTillStaff,
  useTillStepUp,
} from "../../../../services/tillStaffSession";
import { requestFloorPdf, StationError } from "../../../../services/venueStationService";
import { csvTextCell } from "../../../../utils/csvCell";
import { CLOSE_ERROR_COPY } from "../../close/dayCloseCopy";
import { STOCK_ERROR_COPY } from "../stockCopy";
import { swapChoice, swapPickable } from "../stockModel";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const TOKEN = "ef".repeat(32);
const tick = () => new Promise((r) => setTimeout(r, 0));

function edgeError(body: Record<string, unknown>) {
  const context = { json: async () => body, clone: () => context };
  return { data: null, error: { message: "Edge Function returned a non-2xx status code", context } };
}
const pdf = { data: { signedUrl: "https://storage.test/x.pdf", expiresAt: "2026-11-24T00:00:00Z", filename: "day.pdf" }, error: null };

beforeEach(() => {
  mockInvoke.mockReset();
  clearAllTillStaffSessions();
});

describe("F3B-1 a swap that gives money back is a refund", () => {
  const line = { quantity: 1, lineTotalMinor: 550000, station: "kitchen" };
  test("cheaper: only with refund rights; same price: always; dearer and other station: never", () => {
    const cheaper = swapChoice(line, { priceMinor: 400000, station: "kitchen" });
    const same = swapChoice(line, { priceMinor: 550000, station: "kitchen" });
    expect(swapPickable(cheaper, true)).toBe(true);
    expect(swapPickable(cheaper, false)).toBe(false);
    expect(swapPickable(same, false)).toBe(true);
    expect(swapPickable(swapChoice(line, { priceMinor: 600000, station: "kitchen" }), true)).toBe(false);
    expect(swapPickable(swapChoice(line, { priceMinor: 100, station: "bar" }), true)).toBe(false);
  });
});

describe("F3B-2 the day-close PDF on a Till device asks for the export PIN", () => {
  test("the server asks, the open screen gets an export prompt, the PDF is sent again with the PIN", async () => {
    setTillStaffSession({
      venueId: VENUE, token: TOKEN, memberId: "m1", memberUserId: "u1", name: "Ada", canApprove: false, autoLockMinutes: 2,
    });
    const unsubscribe = subscribeTillStaff(() => undefined);
    mockInvoke
      .mockResolvedValueOnce(edgeError({ code: "pin_step_up_required" }))
      .mockResolvedValueOnce(edgeError({ code: "pin_wrong", triesLeft: 2 }))
      .mockResolvedValueOnce(pdf);
    const done = requestFloorPdf({ kind: "day_close", venueId: VENUE, date: "2026-11-23" });
    await tick();
    answerStepUp({ pin: "1111", memberId: null });
    await tick();
    answerStepUp({ pin: "4826", memberId: "manager-row" });
    const link = await done;
    unsubscribe();
    expect(link.signedUrl).toBe("https://storage.test/x.pdf");
    const bodies = mockInvoke.mock.calls.map((c) => c[1].body);
    expect(mockInvoke.mock.calls.every((c) => c[0] === "venue-floor-pdf")).toBe(true);
    expect(bodies).toHaveLength(3);
    expect(bodies[0].stepUp).toBeUndefined();
    expect(bodies[1].stepUp).toEqual({ pin: "1111" });
    expect(bodies[2].stepUp).toEqual({ pin: "4826", memberId: "manager-row" });
    expect(bodies.every((b) => b.staffSession === TOKEN)).toBe(true);
  });

  test("Cancel moves nothing: pin_step_up_cancelled, one call", async () => {
    setTillStaffSession({
      venueId: VENUE, token: TOKEN, memberId: "m1", memberUserId: "u1", name: "Ada", canApprove: false, autoLockMinutes: 2,
    });
    mockInvoke.mockResolvedValueOnce(edgeError({ code: "pin_step_up_required" }));
    const done = requestFloorPdf({ kind: "day_close", venueId: VENUE, date: "2026-11-23" });
    await tick();
    answerStepUp(null);
    await expect(done).rejects.toMatchObject({ code: "pin_step_up_cancelled" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test("a signed-in account (no PIN session) is never prompted; the refusal comes back as it is", async () => {
    mockInvoke.mockResolvedValueOnce(edgeError({ code: "not_authorized" }));
    await expect(requestFloorPdf({ kind: "day_close", venueId: VENUE, date: "2026-11-23" }))
      .rejects.toBeInstanceOf(StationError);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][1].body.staffSession).toBeUndefined();
    expect(typeof useTillStepUp).toBe("function");
  });
});

describe("F3B-4 the CSV formula guard reads the first non-space character", () => {
  test("leading spaces, full-width signs, a tab or a line break before a formula: written as text", () => {
    for (const hostile of ["  =1+1", " +SUM(A1)", "＝1+1", "＋1", "－1", "＠cmd", " \t=1", "\n=1", "　=1"]) {
      const cell = csvTextCell(hostile);
      expect(cell.startsWith("\"'")).toBe(true);
    }
  });
  test("an international phone number stays quoted text with no apostrophe; anything else after + is still neutralised", () => {
    expect(csvTextCell("+2348012345678")).toBe("\"+2348012345678\"");
    expect(csvTextCell("+234 801 234")).toBe("\"'+234 801 234\"");
    expect(csvTextCell("+1+1")).toBe("\"'+1+1\"");
    expect(csvTextCell("Table 4")).toBe("Table 4");
    expect(csvTextCell("08012345678")).toBe("08012345678");
  });
});

describe("F3B-5 the new server codes have words", () => {
  test("stale close, fresh PIN, reused sold-out key", () => {
    expect(CLOSE_ERROR_COPY.day_close_request_stale).toMatch(/reopened/);
    expect(CLOSE_ERROR_COPY.pin_step_up_required).toBeTruthy();
    expect(STOCK_ERROR_COPY.sold_out_key_reused).toBeTruthy();
    expect(STOCK_ERROR_COPY.pin_step_up_cancelled).toBe("Nothing was changed.");
  });
});
