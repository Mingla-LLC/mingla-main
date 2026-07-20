/**
 * Issue #959 [scanner-invite-error-parse] — fails-on-revert contract.
 *
 * Byte-identical sibling of the shipped ORCH-1404 fix, applied to the SCANNER
 * invite flow. PROVES scannerInvitationsService reads a Supabase edge-function
 * error's status + code from the RIGHT place. supabase-js throws
 * `FunctionsHttpError(response)` at FunctionsClient.js:266
 * (`if (!response.ok) throw new FunctionsHttpError(response)`), and FunctionsError
 * stores its third arg as `this.context` (types.js), so for an HTTP error
 * **`error.context` IS the `Response`**:
 *   - real status → `error.context.status`   (NOT `error.context.response.status`)
 *   - real body   → `await error.context.json()`   (supabase-js sets `data = null`
 *     on non-2xx, so the old `data.error` was ALWAYS null → code "server")
 *
 * DO NOT revert the scanner service to `context.response.status` / `data.error`
 * (the deleted `extractStatus`/`extractErrorCode`): that wrong-path read returned
 * 500 / "server" for EVERY failure, so a real reason (expired / revoked / already
 * used / wrong account) could never reach the user.
 *
 * FAILS ON REVERT: T-1 asserts a 410 invite_expired parses to status 410 /
 * "invite_expired" (NOT 500 / "server"). Reverting to the old extract helpers
 * yields 500 / "server" → the `.status === 410` assertion FAILS. Append-only;
 * never modified.
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

const UNPARSEABLE = Symbol("unparseable-body");

/**
 * Build a `FunctionsHttpError`-shaped error whose `context` is a Response-like
 * object (numeric `.status` + `.clone().json()`), exactly as supabase-js throws.
 */
function makeFunctionsHttpError(
  status: number,
  body: Record<string, unknown> | typeof UNPARSEABLE,
): Error {
  const readJson = async (): Promise<unknown> => {
    if (body === UNPARSEABLE) throw new SyntaxError("Unexpected token < in JSON");
    return body;
  };
  const response = {
    status,
    ok: false,
    clone: () => ({ json: readJson }),
    json: readJson,
  };
  const err = new Error("Edge Function returned a non-2xx status code");
  err.name = "FunctionsHttpError";
  // The load-bearing shape: context IS the Response.
  (err as unknown as { context: unknown }).context = response;
  return err;
}

/** A network failure — `context` is the fetch error, NOT a Response. */
function makeFunctionsFetchError(): Error {
  const err = new Error("Failed to send a request to the Edge Function");
  err.name = "FunctionsFetchError";
  (err as unknown as { context: unknown }).context = new TypeError("fetch failed");
  return err;
}

const INVITE_INPUT: InviteScannerInput = {
  brandId: "brand_1",
  eventId: null,
  scope: "brand",
  inviteeEmail: "scanner@example.com",
  inviteeName: "Scanner One",
  canAcceptPayments: false,
};

async function acceptAndCatch(
  error: Error,
): Promise<ScannerInvitationServiceError> {
  invoke.mockResolvedValueOnce({ data: null, error } as never);
  try {
    await acceptScannerInvitation("tok_whatever");
  } catch (e) {
    if (e instanceof ScannerInvitationServiceError) return e;
    throw new Error(`expected ScannerInvitationServiceError, got: ${String(e)}`);
  }
  throw new Error("acceptScannerInvitation resolved but an error was expected");
}

async function inviteAndCatch(
  error: Error,
): Promise<ScannerInvitationServiceError> {
  invoke.mockResolvedValueOnce({ data: null, error } as never);
  try {
    await inviteScanner(INVITE_INPUT);
  } catch (e) {
    if (e instanceof ScannerInvitationServiceError) return e;
    throw new Error(`expected ScannerInvitationServiceError, got: ${String(e)}`);
  }
  throw new Error("inviteScanner resolved but an error was expected");
}

describe("Issue #959 — scanner invite error parse (FunctionsHttpError)", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  // T-1 — the load-bearing assertion. A 410 expired invite → the accept screen's
  // "expired" copy. Reverting to the old `context.response.status` / `data.error`
  // read yields 500 / "server" and this FAILS.
  test("acceptScannerInvitation: 410 invite_expired parses to 410 / invite_expired (NOT 500/server)", async () => {
    const thrown = await acceptAndCatch(
      makeFunctionsHttpError(410, { error: "invite_expired" }),
    );
    expect(thrown.status).toBe(410);
    expect(thrown.code).toBe("invite_expired");
    // Explicitly prove it is NOT the generic fallback the old parser produced.
    expect(thrown.status).not.toBe(500);
    expect(thrown.code).not.toBe("server");
  });

  // T-2 — every reachable accept HTTP code surfaces its real status + code.
  test.each([
    [404, "invite_not_found"],
    [410, "invite_revoked"],
    [410, "invite_already_used"],
    [403, "invite_email_mismatch"],
    [409, "already_scanner"],
    [400, "validation"],
    [401, "unauthenticated"],
  ])(
    "acceptScannerInvitation: HTTP %s / %s parses through unchanged",
    async (status, code) => {
      const thrown = await acceptAndCatch(
        makeFunctionsHttpError(status as number, { error: code as string }),
      );
      expect(thrown.status).toBe(status);
      expect(thrown.code).toBe(code);
    },
  );

  // T-3 — the OTHER call site (inviteScanner) must read the SAME right place.
  // 403 forbidden (caller not event_manager+) → real 403 / forbidden, not 500.
  test("inviteScanner: 403 forbidden parses to 403 / forbidden (NOT 500/server)", async () => {
    const thrown = await inviteAndCatch(
      makeFunctionsHttpError(403, { error: "forbidden" }),
    );
    expect(thrown.status).toBe(403);
    expect(thrown.code).toBe("forbidden");
    expect(thrown.status).not.toBe(500);
    expect(thrown.code).not.toBe("server");
  });

  // T-4 — unparseable body: keep the REAL status, fall to generic code.
  test("acceptScannerInvitation: unparseable body keeps the real status, code falls to server", async () => {
    const thrown = await acceptAndCatch(makeFunctionsHttpError(500, UNPARSEABLE));
    expect(thrown.status).toBe(500);
    expect(thrown.code).toBe("server");
  });

  // T-5 — network error (context is NOT a Response): status 0, generic code
  // (never a fabricated 500).
  test("network FunctionsFetchError → status 0 / server, never a fabricated 500", async () => {
    const thrown = await acceptAndCatch(makeFunctionsFetchError());
    expect(thrown.status).toBe(0);
    expect(thrown.code).toBe("server");
  });
});
