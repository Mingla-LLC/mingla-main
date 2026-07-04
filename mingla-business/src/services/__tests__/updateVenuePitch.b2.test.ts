/**
 * META-ORCH-1290 (B2 addendum) [venue authoring — one submission] — resolves
 * blocker B-2. The listing-page pitch edit must NOT write place_pool via a
 * client-side RLS UPDATE. `updateVenuePitch` now INVOKES the `update_pitch`
 * pipeline action (which owns all authored writes, column-scoped) instead of a
 * direct `supabase.from("place_pool").update(...)`.
 *
 * PROVES (I-PROPOSED-1290-PITCH-WRITES-VIA-PIPELINE-ACTION):
 *   1. updateVenuePitch calls supabase.functions.invoke on the pipeline with
 *      { action: "update_pitch", brand_id, venue_id, place_pool_id, pitch } and
 *      NO is_live / serving-column payload.
 *   2. It NEVER touches supabase.from(...) — i.e. no direct client place_pool
 *      write (the whole point of B-2).
 *   3. It surfaces the REAL server error (via pipelineInvokeError), not the
 *      opaque FunctionsHttpError string.
 *
 * Fails-on-revert: restoring the direct `supabase.from("place_pool").update`
 * path makes assertion (2) fail (`from` gets called) and (1) fail (invoke never
 * fires for update_pitch).
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));

import { supabase } from "../supabase";
import { updateVenuePitch } from "../businessPlaceAuthoringService";

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;
const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

describe("META-ORCH-1290 (B2) updateVenuePitch — pipeline action, not client RLS write", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("invokes the update_pitch pipeline action with brand/venue/place/pitch and NEVER writes place_pool directly", async () => {
    mockInvoke.mockResolvedValue({
      data: { kind: "ok", action: "update_pitch", place_pool_id: "p-1", mode: "apply" },
      error: null,
    } as never);

    await updateVenuePitch({
      brandId: "b-1",
      venueId: "v-1",
      placePoolId: "p-1",
      pitch: "A candlelit natural-wine bar with moody corners.",
    });

    // (1) invoked the pipeline with the exact update_pitch body.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [fnName, opts] = mockInvoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fnName).toBe("run-business-place-authoring-pipeline");
    expect(opts.body).toEqual({
      action: "update_pitch",
      brand_id: "b-1",
      venue_id: "v-1",
      place_pool_id: "p-1",
      pitch: "A candlelit natural-wine bar with moody corners.",
    });
    // Server decides apply-vs-stage — the client never sends is_live / columns.
    expect(opts.body).not.toHaveProperty("is_live");
    expect(opts.body).not.toHaveProperty("generative_summary");
    expect(opts.body).not.toHaveProperty("business_authoring_inputs");

    // (2) B-2: NO direct client place_pool write.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("surfaces the REAL server error from the pipeline, not the opaque one", async () => {
    const fakeResponse = {
      json: async () => ({
        kind: "error",
        code: "PLACE_UPDATE_FAILED",
        message: "place_pool update violated a constraint",
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
      updateVenuePitch({ brandId: "b-1", venueId: "v-1", placePoolId: "p-1", pitch: "x" }),
    ).rejects.toThrow("place_pool update violated a constraint");
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
