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
import { googlePlaceIdOrNull } from "../brandPinWrite";
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
    expect(mockRpc.mock.calls.map(([n]) => n)).toEqual(["biz_repick_apply_trip_draft_graph"]);
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
    expect(mockRpc.mock.calls.map(([n]) => n)).toEqual(["biz_repick_update_trip_live_command"]);
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

// Retest of the rework (head 53503c718f): R-1, R-2.

describe("R-1 googlePlaceIdOrNull keeps exactly what places_is_google_place_id accepts", () => {
  // The SQL rule (20280521004334): length 10..1024, ^[A-Za-z0-9_-]+$, not ^dXJuOm.
  const sqlRule = (id: string): boolean =>
    id.length >= 10 && id.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(id) && !/^dXJuOm/.test(id);

  test("boundaries, alphabet and the retired-vendor urn prefix agree with the server", () => {
    const cases = [
      "a".repeat(9), "a".repeat(10), "a".repeat(1024), "a".repeat(1025),
      "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0", "ChIJ-abc_DEF-123", "ChIJ.abcdefgh", "ChIJ abcdefgh",
      "ChIJ=abcdefgh", "ChIJéabcdefgh", "dXJuOm1ieHBvaTp4eXo", "dxjuom1iehbvatp4exo",
      "poi.12345", "", "ChIJ abcdefg",
    ];
    for (const id of cases) expect([id, googlePlaceIdOrNull(id) !== null]).toEqual([id, sqlRule(id)]);
  });

  test("null, undefined and blank are none; surrounding whitespace is trimmed before the check", () => {
    expect(googlePlaceIdOrNull(null)).toBeNull();
    expect(googlePlaceIdOrNull(undefined)).toBeNull();
    expect(googlePlaceIdOrNull("   ")).toBeNull();
    expect(googlePlaceIdOrNull("  ChIJ0Wq9hS_1OxARsFOw5qkW6Y0\n")).toBe("ChIJ0Wq9hS_1OxARsFOw5qkW6Y0");
  });
});

describe("R-2 the pin RPC only ever writes both coordinates together", () => {
  const row = { id: "brand-1", name: "Kaycee", slug: "kaycee", lat: null, lng: null };

  test("a cleared pin (both null) goes through the RPC with both nulls and no id", async () => {
    mockRpc.mockResolvedValue({ data: row, error: null });
    await updateBrand("brand-1", { lat: null, lng: null, locationProviderPlaceId: ID } as never, null);
    expect(mockRpc.mock.calls[0]).toEqual([
      "biz_update_brand_pin",
      { p_brand_id: "brand-1", p_lat: null, p_lng: null, p_location_place_id: ID },
    ]);
  });

  test("one coordinate alone, with or without an id, never calls the RPC and writes only what was sent", async () => {
    const calls: Array<[string, unknown[]]> = [];
    mockFrom.mockImplementation(() => chain({ data: { ...row, lat: 6.5, lng: 3.4 }, error: null }, calls));
    await updateBrand("brand-1", { lng: 3.5, locationProviderPlaceId: ID }, null);
    expect(mockRpc).not.toHaveBeenCalled();
    const updates = calls.filter(([m]) => m === "update").map(([, a]) => a[0]);
    expect(updates).toEqual([{ lng: 3.5, location_provider_place_id: ID }]);
  });
});
