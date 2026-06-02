/**
 * META-ORCH-1009 Sub-E B6 — regression test.
 *
 * When the edge function returns a non-2xx response, supabase-js surfaces a
 * FunctionsHttpError whose `.message` is the opaque "Edge Function returned a
 * non-2xx status code" string and stashes the real Response on `.context`.
 * upsertTier1Place must read the structured `{ code, message }` body off
 * `.context` and throw THAT — so the venue-submit flow shows the real reason
 * instead of the generic "Could not submit. Try again." Seth saw.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));

import { supabase } from "../supabase";
import { upsertTier1Place } from "../businessPlaceAuthoringService";

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

describe("upsertTier1Place B6 error surfacing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws the REAL server message from the error context body, not the opaque one", async () => {
    const fakeResponse = {
      json: async () => ({
        kind: "error",
        code: "place_insert_failed",
        message: "place_pool insert violated check constraint",
      }),
    };
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: fakeResponse,
      },
    } as never);

    await expect(
      upsertTier1Place({ brandId: "b-1", selectedPlacePoolId: null, draft: {} as never }),
    ).rejects.toThrow("place_pool insert violated check constraint");
  });

  it("falls back to the opaque message when the body can't be parsed", async () => {
    const fakeResponse = {
      json: async () => {
        throw new Error("not json");
      },
    };
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: fakeResponse,
      },
    } as never);

    await expect(
      upsertTier1Place({ brandId: "b-1", selectedPlacePoolId: null, draft: {} as never }),
    ).rejects.toThrow("Edge Function returned a non-2xx status code");
  });
});
