import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import {
  ContactImportError,
  getContactImportStatus,
} from "../contactImportService";
import { supabase } from "../supabase";

const invoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;
const UNPARSEABLE = Symbol("unparseable");

function functionsHttpError(
  status: number,
  payload: Record<string, unknown> | typeof UNPARSEABLE,
): Error {
  const json = async (): Promise<unknown> => {
    if (payload === UNPARSEABLE) throw new SyntaxError("not json");
    return payload;
  };
  const error = new Error("Edge Function returned a non-2xx status code");
  error.name = "FunctionsHttpError";
  (error as Error & { context: unknown }).context = {
    status,
    ok: false,
    clone: () => ({ json }),
    json,
  };
  return error;
}

async function statusError(error: Error): Promise<ContactImportError> {
  invoke.mockResolvedValueOnce({ data: null, error } as never);
  try {
    await getContactImportStatus("brand-1775", "batch-1775");
  } catch (caught) {
    if (caught instanceof ContactImportError) return caught;
    throw caught;
  }
  throw new Error("expected contact import status to reject");
}

describe("#1775 FunctionsHttpError contract", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  test.each([
    [403, "FORBIDDEN"],
    [409, "PREVIEW_STALE_OR_TAMPERED"],
    [409, "INVALID_MAPPING"],
  ])("preserves HTTP %s server code %s", async (status, code) => {
    const thrown = await statusError(functionsHttpError(status, {
      ok: false,
      requestId: "request-1775",
      error: { code, message: "server decision", retryable: false },
    }));
    expect(thrown.code).toBe(code);
    expect(thrown.message).toBe("server decision");
    expect(thrown.retryable).toBe(false);
    expect(thrown.requestId).toBe("request-1775");
    expect(thrown.code).not.toBe("TEMPORARILY_UNAVAILABLE");
  });

  test.each([
    functionsHttpError(500, UNPARSEABLE),
    Object.assign(new Error("fetch failed"), { name: "FunctionsFetchError" }),
  ])("malformed HTTP/network failure remains retryable generic", async (error) => {
    const thrown = await statusError(error);
    expect(thrown.code).toBe("TEMPORARILY_UNAVAILABLE");
    expect(thrown.retryable).toBe(true);
  });
});
