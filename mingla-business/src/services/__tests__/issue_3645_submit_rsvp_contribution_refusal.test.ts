/**
 * Issue #3645 (payments audit item 7 follow-through) — `submitRsvpContribution`
 * (Host app, Host web and buyer web chip-in) rejects with the SERVER's code
 * and floor, read from a real supabase-js `FunctionsHttpError`.
 *
 * Before: the sync `parseRsvpErrorCode` read `error.context.body`, which is a
 * ReadableStream on a real FunctionsHttpError, so every refusal became
 * "Edge Function returned a non-2xx status code" and the panel showed
 * "Couldn't process that" — even `brand_cannot_collect` (paused) and the
 * host's own minimum.
 */
import { FunctionsHttpError } from "@supabase/functions-js";

const mockInvoke = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
jest.mock("../../analytics/webAnalytics", () => ({
  getStoredAdMatchData: () => null,
  getStoredClickAttribution: () => null,
}));
jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));

import { submitRsvpContribution } from "../rsvpEvents";
import { readRsvpErrorBody, readRsvpErrorCode } from "../rsvpErrorCodes";

const httpError = (status: number, body: string): FunctionsHttpError =>
  new FunctionsHttpError(new Response(body, { status, headers: { "Content-Type": "application/json" } }));

const input = {
  eventId: "event-1",
  amountCents: 6_000,
  rsvpId: null,
  guestName: "Guest",
  guestEmail: "guest@example.test",
  surface: "web" as const,
  callerIdempotencyKey: "key-1",
};

const rejection = async (): Promise<Error & { minCents?: unknown }> => {
  try {
    await submitRsvpContribution(input as Parameters<typeof submitRsvpContribution>[0]);
  } catch (err) {
    return err as Error & { minCents?: unknown };
  }
  throw new Error("expected a rejection");
};

beforeEach(() => mockInvoke.mockReset());

describe("#3645 submitRsvpContribution refusal", () => {
  it("a real FunctionsHttpError's context.body is a stream, not the JSON (why the sync parse failed)", () => {
    const error = httpError(422, JSON.stringify({ error: "amount_below_min", minCents: 10_000 }));
    expect(typeof (error.context as Response).text).toBe("function");
    expect(error.message).toBe("Edge Function returned a non-2xx status code");
  });

  it("carries the provider floor: code as message and minCents", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(422, JSON.stringify({ error: "amount_below_min", minCents: 10_000, reason: "provider_minimum" })),
    });
    const err = await rejection();
    expect(err.message).toBe("amount_below_min");
    expect(err.minCents).toBe(10_000);
  });

  it("carries the host minimum", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(422, JSON.stringify({ error: "amount_below_min", minCents: 5_000 })),
    });
    const err = await rejection();
    expect(err.message).toBe("amount_below_min");
    expect(err.minCents).toBe(5_000);
  });

  it("keeps brand_cannot_collect (the panel's paused state)", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(409, JSON.stringify({ error: "brand_cannot_collect" })),
    });
    const err = await rejection();
    expect(err.message).toBe("brand_cannot_collect");
    expect(err.minCents).toBeNull();
  });

  it("drops a malformed floor instead of guessing", async () => {
    for (const minCents of ["10000", -1, 1.5, null]) {
      mockInvoke.mockResolvedValue({
        data: null,
        error: httpError(422, JSON.stringify({ error: "amount_below_min", minCents, reason: "other" })),
      });
      const err = await rejection();
      expect(err.message).toBe("amount_below_min");
      expect(err.minCents).toBeNull();
      }
  });

  it("an unreadable body (HTML relay page, already read) falls back to the error message, never throws past the caller", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(502, "<!doctype html><p>Bad gateway</p>") });
    expect((await rejection()).message).toBe("Edge Function returned a non-2xx status code");

    const consumed = httpError(422, JSON.stringify({ error: "amount_below_min" }));
    await (consumed.context as Response).text();
    mockInvoke.mockResolvedValue({ data: null, error: consumed });
    expect((await rejection()).message).toBe("Edge Function returned a non-2xx status code");
  });

  it("a network failure keeps its message", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function", context: new TypeError("Failed to fetch") },
    });
    expect((await rejection()).message).toBe("Failed to send a request to the Edge Function");
  });
});

describe("#3645 readRsvpErrorBody", () => {
  it("returns the code and the parsed body, and leaves the body readable for the next reader", async () => {
    const error = httpError(422, JSON.stringify({ error: "amount_below_min", minCents: 10_000 }));
    const first = await readRsvpErrorBody(error as never);
    expect(first).toEqual({ code: "amount_below_min", body: { error: "amount_below_min", minCents: 10_000 } });
    expect(await readRsvpErrorCode(error as never)).toBe("amount_below_min");
  });

  it("a JSON body with no error code gives body null and the message", async () => {
    const error = httpError(500, JSON.stringify({ detail: "x" }));
    expect(await readRsvpErrorBody(error as never)).toEqual({
      code: "Edge Function returned a non-2xx status code",
      body: null,
    });
  });
});
