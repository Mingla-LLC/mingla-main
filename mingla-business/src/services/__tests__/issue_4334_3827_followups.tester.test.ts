/**
 * #4334 / #3827 follow-ups — tester adversarial proof (error paths and edges
 * the implementor tests do not take).
 *
 *   A-1 brand: a refused table write for the rest of the patch stops the save
 *       before the pin RPC runs (no pin written behind a failed save)
 *   A-2 brand: a refused pin RPC (not PGRST202) is thrown after the rest was
 *       written, and the pin is NOT then written as a table update
 *   A-3 trips: a PT409 (or any non-PGRST202 error) from the _repick twin is
 *       returned as is; the plain command is never retried with the same
 *       operation id
 *   A-4 trips: a PlaceId that is null, a number or missing never routes to the
 *       twin; a PlaceId under an unrelated key does not either
 *   A-5 routing: a gift push with no usable RSVP id falls back to the normal
 *       resolution; an RSVP enquiry with no id offers nothing
 *
 * Fails on revert: drop the `if (error) throw error` after the rest write in
 * brandPinWrite (A-1), make the fallback catch every error (A-2/A-3), or loosen
 * tripPatchSendsPlaceId to any key presence (A-4).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<Result>>();
const mockFrom = jest.fn<(table: string) => unknown>();
jest.mock("../supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    from: (table: string) => mockFrom(table),
  },
}));
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-1" }) },
}));

import { updateBrand } from "../brandsService";
import { applyTripDraftGraph, updateLiveTripFields } from "../tripsService";
import { tripPatchSendsPlaceId } from "../tripPinCommands";
import { resolveBusinessNavTarget } from "../businessNotificationRouting";
import { brandEnquiryContextOpen } from "../../utils/brandEnquiryDisplay";
import type { BrandEnquiryContext } from "../brandEnquiriesService";

const ID = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";
const EVENT = "11111111-1111-4111-8111-111111111111";

const chain = (result: Result, calls: Array<[string, unknown[]]> = []): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "update"]) {
    c[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return c;
    };
  }
  c.maybeSingle = () => Promise.resolve(result);
  c.single = () => Promise.resolve(result);
  c.then = (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
};

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe("A-1/A-2 the brand save split", () => {
  const pinAndName = { displayName: "Kaycee Music", lat: 6.43251, lng: 3.42361, locationProviderPlaceId: ID };

  test("A-1 a refused rest write stops before the pin RPC", async () => {
    mockFrom.mockImplementation(() => chain({ data: null, error: { code: "42501", message: "rls refused" } }));
    mockRpc.mockResolvedValue({ data: { id: "brand-1" }, error: null });
    await expect(updateBrand("brand-1", pinAndName, null)).rejects.toMatchObject({ message: "rls refused" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("A-2 a refused pin RPC is thrown and the pin is never written as a table update", async () => {
    const calls: Array<[string, unknown[]]> = [];
    mockFrom.mockImplementation(() => chain({ data: { id: "brand-1" }, error: null }, calls));
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "brand_not_found" } });
    await expect(updateBrand("brand-1", pinAndName, null)).rejects.toMatchObject({ message: "brand_not_found" });
    const updates = calls.filter(([m]) => m === "update").map(([, a]) => a[0] as Record<string, unknown>);
    expect(updates).toEqual([{ name: "Kaycee Music" }]);
    expect(updates.some((u) => "lat" in u || "location_provider_place_id" in u)).toBe(false);
  });
});

describe("A-3 the trip twin never double-applies", () => {
  const pinPatch = { event: { business_trip: { departurePlaceId: ID, departureLat: 6.43251, departureLng: 3.42361 } } };
  const opts = { expectedUpdatedAt: "2026-11-09T10:00:00Z", operationId: "op-1" };

  test("a PT409 from the draft twin is surfaced and the plain command is not retried", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "trip_revision_conflict" } });
    await expect(applyTripDraftGraph(EVENT, pinPatch, opts)).rejects.toBeTruthy();
    expect(mockRpc.mock.calls.map(([n]) => n)).toEqual(["biz_apply_trip_draft_graph_repick"]);
  });

  test("a permission error from the live twin is surfaced and the plain command is not retried", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "insufficient_event_permission" } });
    await expect(
      updateLiveTripFields(
        EVENT,
        { theme: { business_trip: { departurePlaceId: ID, departureLat: 6.43251, departureLng: 3.42361 } } } as never,
        "Refined the departure pin",
        opts,
      ),
    ).rejects.toBeTruthy();
    expect(mockRpc.mock.calls.map(([n]) => n)).toEqual(["biz_update_trip_live_command_repick"]);
  });
});

describe("A-4 only a string place id is a pin patch", () => {
  test("null, numbers, missing keys and unrelated keys keep the plain command", () => {
    expect(tripPatchSendsPlaceId({ event: { business_trip: { departurePlaceId: null, departureLat: 1 } } })).toBe(false);
    expect(tripPatchSendsPlaceId({ event: { business_trip: { departurePlaceId: 42 } } })).toBe(false);
    expect(tripPatchSendsPlaceId({ theme: { business_trip: { departureLat: 1, departureLng: 2 } } })).toBe(false);
    expect(tripPatchSendsPlaceId({ business_trip: { departurePlaceId: ID } })).toBe(false);
    expect(tripPatchSendsPlaceId({ event: { departurePlaceId: ID } })).toBe(false);
    expect(tripPatchSendsPlaceId("departurePlaceId")).toBe(false);
  });
});

describe("A-5 routing edges", () => {
  test("a gift push with no usable RSVP id does not invent an /rsvp route", () => {
    const noId = resolveBusinessNavTarget({ type: "business.rsvp_contribution_received" });
    expect(noId === null || !String(noId).startsWith("/rsvp/")).toBe(true);
    const junk = resolveBusinessNavTarget({ type: "business.rsvp_contribution_received", eventId: "../admin" });
    expect(junk === null || !String(junk).startsWith("/rsvp/")).toBe(true);
  });

  test("an RSVP enquiry or offering with no id offers nothing", () => {
    const ctx = (patch: Partial<BrandEnquiryContext>): BrandEnquiryContext =>
      ({ kind: "none", ...patch }) as BrandEnquiryContext;
    expect(brandEnquiryContextOpen(ctx({ kind: "rsvp" }))).toBeNull();
    expect(brandEnquiryContextOpen(ctx({ kind: "offering", offering_kind: "rsvp" }))).toBeNull();
  });
});
