/**
 * ORCH-1404 [accept-invite-web-error-recovery] — F-2 fails-on-revert contract.
 *
 * PROVES the service reads a Supabase edge-function error's status + code from
 * the RIGHT place. supabase-js throws `FunctionsHttpError(response)` at
 * FunctionsClient.js:266 (`if (!response.ok) throw new FunctionsHttpError(response)`),
 * and FunctionsError stores its third arg as `this.context` (types.js), so for an
 * HTTP error **`error.context` IS the `Response`**:
 *   - real status → `error.context.status`   (NOT `error.context.response.status`)
 *   - real body   → `await error.context.json()`   (supabase-js sets `data = null`
 *     on non-2xx, so the old `data.error` was ALWAYS null → code "server")
 *
 * DO NOT revert `parseFunctionsError` to `context.response.status` / `data.error`:
 * the old wrong-path read returned 500 / "server" for EVERY failure, so the accept
 * screen only ever showed the generic default — never "Wrong account", "Expired",
 * etc. (I-PROPOSED-1404-FUNCTIONS-ERROR-PARSE-CANONICAL.)
 *
 * FAILS ON REVERT: T-1 asserts a 403 mismatch parses to status 403 /
 * "invite_email_mismatch" (NOT 500 / "server"). The pre-1404
 * `extractStatus`/`extractErrorCode` returned 500 / "server" → the `.status === 403`
 * assertion FAILS. Append-only; never modified.
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
  acceptBrandInvitation,
  declineBrandInvitation,
  BrandInvitationServiceError,
} from "../brandInvitationsService";
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

async function acceptAndCatch(error: Error): Promise<BrandInvitationServiceError> {
  invoke.mockResolvedValueOnce({ data: null, error } as never);
  try {
    await acceptBrandInvitation("tok_whatever");
  } catch (e) {
    if (e instanceof BrandInvitationServiceError) return e;
    throw new Error(`expected BrandInvitationServiceError, got: ${String(e)}`);
  }
  throw new Error("acceptBrandInvitation resolved but an error was expected");
}

describe("ORCH-1404 — parseFunctionsError (FunctionsHttpError parse)", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  // T-1 — the load-bearing assertion. 403 invite_email_mismatch → the wrong-account
  // screen. Reverting to the old `context.response.status` / `data.error` read
  // yields 500 / "server" and this FAILS.
  test("403 invite_email_mismatch parses to status 403 / code invite_email_mismatch (NOT 500/server)", async () => {
    const thrown = await acceptAndCatch(
      makeFunctionsHttpError(403, { error: "invite_email_mismatch" }),
    );
    expect(thrown.status).toBe(403);
    expect(thrown.code).toBe("invite_email_mismatch");
    // Explicitly prove it is NOT the generic fallback the old parser produced.
    expect(thrown.status).not.toBe(500);
    expect(thrown.code).not.toBe("server");
  });

  // T-2 — the other reachable HTTP codes each surface their real status + code.
  test.each([
    [404, "invite_not_found"],
    [410, "invite_expired"],
    [410, "invite_already_used"],
    [410, "invite_revoked"],
    [410, "invite_declined"],
    [409, "invite_currency_mismatch"],
    [400, "validation"],
    [401, "unauthenticated"],
  ])("HTTP %s / %s parses through unchanged", async (status, code) => {
    const thrown = await acceptAndCatch(
      makeFunctionsHttpError(status as number, { error: code as string }),
    );
    expect(thrown.status).toBe(status);
    expect(thrown.code).toBe(code);
  });

  // T-3 — unparseable body: keep the REAL status, fall to generic code.
  test("unparseable body keeps the real status, code falls to server", async () => {
    const thrown = await acceptAndCatch(makeFunctionsHttpError(500, UNPARSEABLE));
    expect(thrown.status).toBe(500);
    expect(thrown.code).toBe("server");
  });

  // T-4 — network error (context is NOT a Response): status 0, generic code (never a fake 500).
  test("FunctionsFetchError (network) → status 0 / server, never a fabricated 500", async () => {
    const thrown = await acceptAndCatch(makeFunctionsFetchError());
    expect(thrown.status).toBe(0);
    expect(thrown.code).toBe("server");
  });

  // T-5 — legacy fallback: a hand-thrown error carrying top-level status/code
  // (e.g. a re-thrown BrandInvitationServiceError) still maps correctly.
  test("legacy top-level status/code fallback is preserved", async () => {
    const legacy = Object.assign(new Error("already declined"), {
      status: 410,
      code: "invite_declined",
    });
    const thrown = await acceptAndCatch(legacy);
    expect(thrown.status).toBe(410);
    expect(thrown.code).toBe("invite_declined");
  });

  // T-5b — the decline treat-as-success branch still receives the CORRECT
  // status/code from the new parser: a 410 resolves (does not throw).
  test("declineBrandInvitation treats a 410 as success (parsed status feeds the branch)", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: makeFunctionsHttpError(410, { error: "invite_not_actionable" }),
    } as never);
    await expect(declineBrandInvitation("inv_1")).resolves.toBeUndefined();
  });
});
