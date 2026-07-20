/**
 * Issue #959 [scanner-invite-error-parse] — TESTER adversarial regression.
 *
 * A DIFFERENT ANGLE than the implementor's happy-path suite
 * (issue_959_scanner_functions_error_parse.test.ts, which is accept-heavy): this
 * file attacks the INVITE call site and, critically, pins the exact wrong path
 * the deleted `extractStatus` helper used — `ctx?.response?.status` — so it can
 * never silently resurface and re-collapse every failure to 500.
 *
 * On a real Supabase FunctionsHttpError, `error.context` IS the Response:
 *   - `context.status` is the real HTTP status.
 *   - `context.response` DOES NOT EXIST on a Response (a Response has no
 *     `.response`), so the deleted `ctx?.response?.status` read was always
 *     `undefined` → fallback 500 for EVERY failure.
 *
 * A-2 goes further and attaches a MISLEADING nested `context.response.status`
 * as a trap: a parser that reads `ctx.response.status` would pick up the trap
 * value, never the real top-level status. The correct parser reads
 * `context.status` and ignores the trap.
 *
 * FAILS ON REVERT: reverting the inviteScanner invoke branch to the old
 * `ctx?.response?.status` / `data.error` read collapses the real status/code to
 * 500 / "server", failing the `.status === 403` / `.status === 404` /
 * `.status === 0` / `.status === 409` assertions below. Append-only; never
 * modified.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import {
  inviteScanner,
  acceptScannerInvitation,
  ScannerInvitationServiceError,
  type InviteScannerInput,
} from "../scannerInvitationsService";
import { supabase } from "../supabase";

const invoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

/**
 * A FunctionsHttpError exactly as supabase-js throws it: `context` IS the
 * Response — numeric top-level `.status`, `.clone().json()`, and (by default) NO
 * `.response` key. When `misleadingNestedResponseStatus` is supplied, a bogus
 * `context.response.status` is attached as a TRAP: a parser reading
 * `ctx.response.status` (the deleted helper) would read the trap value or
 * `undefined`, never the real top-level status.
 */
function makeHttpError(
  status: number,
  body: Record<string, unknown>,
  misleadingNestedResponseStatus?: number,
): Error {
  const readJson = async (): Promise<unknown> => body;
  const response: Record<string, unknown> = {
    status,
    ok: false,
    clone: () => ({ json: readJson }),
    json: readJson,
  };
  if (typeof misleadingNestedResponseStatus === "number") {
    response.response = { status: misleadingNestedResponseStatus };
  }
  const err = new Error("Edge Function returned a non-2xx status code");
  err.name = "FunctionsHttpError";
  (err as unknown as { context: unknown }).context = response;
  return err;
}

/** Network failure — `context` is the fetch error, NOT a Response. */
function makeFetchError(): Error {
  const err = new Error("Failed to send a request to the Edge Function");
  err.name = "FunctionsFetchError";
  (err as unknown as { context: unknown }).context = new TypeError("fetch failed");
  return err;
}

const INVITE_INPUT: InviteScannerInput = {
  brandId: "brand_adversarial",
  eventId: null,
  scope: "brand",
  inviteeEmail: "door@example.com",
  inviteeName: "Door Staff",
  canAcceptPayments: true,
};

async function inviteExpectingError(
  error: Error,
): Promise<ScannerInvitationServiceError> {
  invoke.mockResolvedValueOnce({ data: null, error } as never);
  try {
    await inviteScanner(INVITE_INPUT);
  } catch (e) {
    if (e instanceof ScannerInvitationServiceError) return e;
    throw new Error(`expected ScannerInvitationServiceError, got ${String(e)}`);
  }
  throw new Error("inviteScanner resolved but an error was expected");
}

async function acceptExpectingError(
  error: Error,
): Promise<ScannerInvitationServiceError> {
  invoke.mockResolvedValueOnce({ data: null, error } as never);
  try {
    await acceptScannerInvitation("tok_adversarial");
  } catch (e) {
    if (e instanceof ScannerInvitationServiceError) return e;
    throw new Error(`expected ScannerInvitationServiceError, got ${String(e)}`);
  }
  throw new Error("acceptScannerInvitation resolved but an error was expected");
}

describe("Issue #959 — scanner invite error parse (tester adversarial: invite path + deleted-helper guard)", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  // A-1 — the INVITE call site (implementor covers it with a single case)
  // surfaces a real 403 forbidden, never a generic 500 / "server".
  test("inviteScanner: 403 forbidden surfaces real 403 / forbidden (never 500 / server)", async () => {
    const thrown = await inviteExpectingError(
      makeHttpError(403, { error: "forbidden" }),
    );
    expect(thrown.status).toBe(403);
    expect(thrown.code).toBe("forbidden");
    expect(thrown.status).not.toBe(500);
    expect(thrown.code).not.toBe("server");
  });

  // A-2 — the deleted-helper guard: `context.response` is undefined for the real
  // read, and a MISLEADING `context.response.status = 500` trap is attached. The
  // parser MUST read `context.status` (404) and ignore the trap. If the deleted
  // `ctx?.response?.status` ever resurfaces it reads the trap → 500 → both
  // assertions fail.
  test("inviteScanner: reads context.status, never context.response.status (deleted-helper trap)", async () => {
    const thrown = await inviteExpectingError(
      makeHttpError(404, { error: "brand_not_found" }, 500),
    );
    expect(thrown.status).toBe(404);
    expect(thrown.code).toBe("brand_not_found");
    // The trap value must never leak through.
    expect(thrown.status).not.toBe(500);
  });

  // A-3 — network fallback yields status 0, never a fabricated 500.
  test("inviteScanner: network FunctionsFetchError → status 0 / server, never 500", async () => {
    const thrown = await inviteExpectingError(makeFetchError());
    expect(thrown.status).toBe(0);
    expect(thrown.code).toBe("server");
    expect(thrown.status).not.toBe(500);
  });

  // A-4 — end-to-end on the invite path: the thrown value is a real
  // ScannerInvitationServiceError carrying the real status + code.
  test("inviteScanner: thrown error is a ScannerInvitationServiceError carrying real status+code end-to-end", async () => {
    const thrown = await inviteExpectingError(
      makeHttpError(409, { error: "already_invited" }),
    );
    expect(thrown).toBeInstanceOf(ScannerInvitationServiceError);
    expect(thrown.name).toBe("ScannerInvitationServiceError");
    expect(thrown.status).toBe(409);
    expect(thrown.code).toBe("already_invited");
  });

  // A-5 — cross-call-site: the accept path also carries the real status+code
  // end-to-end (403 wrong-account), never a generic 500.
  test("acceptScannerInvitation: carries real 403 / invite_email_mismatch end-to-end (never 500)", async () => {
    const thrown = await acceptExpectingError(
      makeHttpError(403, { error: "invite_email_mismatch" }),
    );
    expect(thrown).toBeInstanceOf(ScannerInvitationServiceError);
    expect(thrown.status).toBe(403);
    expect(thrown.code).toBe("invite_email_mismatch");
    expect(thrown.status).not.toBe(500);
  });
});
