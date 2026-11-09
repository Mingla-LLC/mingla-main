/**
 * #4334 §4.12 — the venue pool match sends the picked Google place id so the
 * server looks the pool up directly (no Google text search).
 * Fails-on-revert: drop the `google_place_id` spread in matchPoolByAddress → red.
 */
import { describe, expect, jest, test } from "@jest/globals";

const invoke = jest.fn<(fn: string, o: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: null }>>();
jest.mock("../../services/supabase", () => ({ __esModule: true, supabase: { functions: { invoke: (...a: [string, { body: Record<string, unknown> }]) => invoke(...a) } } }));

import { matchPoolByAddress } from "../../services/poolSearchService";

describe("#4334 — pool match by the picked Google id", () => {
  test("the picked id is sent as google_place_id", async () => {
    invoke.mockResolvedValue({ data: { match: null }, error: null });
    await matchPoolByAddress({ formattedAddress: "175 Akin Adesola St", lat: 6.43, lng: 3.42, googlePlaceId: "ChIJ0Wq9hS_1OxAR" });
    expect(invoke.mock.calls[0][0]).toBe("venue-address-pool-match");
    expect(invoke.mock.calls[0][1].body).toEqual({ formatted_address: "175 Akin Adesola St", lat: 6.43, lng: 3.42, google_place_id: "ChIJ0Wq9hS_1OxAR" });
  });

  test("without a picked id the request is unchanged", async () => {
    invoke.mockClear();
    invoke.mockResolvedValue({ data: { match: null }, error: null });
    await matchPoolByAddress({ formattedAddress: "x st", lat: 1, lng: 2 });
    expect(invoke.mock.calls[0][1].body).toEqual({ formatted_address: "x st", lat: 1, lng: 2 });
  });
});
