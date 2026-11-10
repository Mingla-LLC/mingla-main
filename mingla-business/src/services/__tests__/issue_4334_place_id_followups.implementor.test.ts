/**
 * #4334 follow-ups — the host app keeps a re-picked place's id and reads the
 * saved pin it compares against (implementor proof; the server half is
 * supabase/migrations/__tests__/issue_4334_place_id_followups.implementor.pg17.test.sql).
 *
 *   F-1 brand patch: a moved or re-picked pin carries its (trimmed) id with
 *       both coordinates; blank is none; an untouched brand sends nothing
 *   F-2 updateBrand: the pin goes through biz_update_brand_pin, the rest stays
 *       a table write without the pin; a missing function falls back to the
 *       table write
 *   F-3 trips: a patch that sends a place id goes through the _repick twin
 *       (falling back on PGRST202); any other patch keeps the plain command
 *   F-4 reads: the event detail and list probes carry the saved place id and
 *       precision onto the LiveEvent; the venue host read selects and maps
 *       the venue's place id
 *
 * Fails on revert: remove the pin trio in brandPatch (F-1), the RPC branch in
 * updateBrand (F-2), tripRpcKeepingPins (F-3), or withSavedPin / the venue
 * column (F-4).
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

import { computeDirtyFieldsPatch } from "../../utils/brandPatch";
import type { Brand } from "../../store/currentBrandStore";
import { updateBrand } from "../brandsService";
import { applyTripDraftGraph } from "../tripsService";
import { tripPatchSendsPlaceId } from "../tripPinCommands";
import { fetchBusinessEventById, fetchBusinessEventsForBrand } from "../businessEvents";
import {
  VENUE_DETAILS_HOST_COLUMNS,
  mapVenueDetailsRow,
  type VenueDetailsRow,
} from "../venueDetailsEditService";

const ID = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";
const EVENT = "11111111-1111-4111-8111-111111111111";

const brand = (patch: Partial<Brand> = {}): Brand =>
  ({
    id: "brand-1",
    displayName: "Kaycee",
    slug: "kaycee",
    address: "175 Akin Adesola St",
    lat: 6.4325,
    lng: 3.4236,
    city: "Lagos",
    countryCode: "NG",
    locationProviderPlaceId: ID,
    coverHue: 25,
    role: "owner",
    stats: { events: 0, rev: 0, rev7d: 0, attendees: 0 },
    currentLiveEvent: null,
    ...patch,
  }) as Brand;

/** A chain that records every call and resolves to `result`. */
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

describe("F-1 the brand patch carries the pin with its id", () => {
  test("refined coordinates, same place: both coordinates and the id", () => {
    expect(computeDirtyFieldsPatch(brand({ lat: 6.43251, lng: 3.42361 }), brand())).toEqual({
      lat: 6.43251,
      lng: 3.42361,
      locationProviderPlaceId: ID,
    });
  });

  test("the id is trimmed, blank is none, and an untouched brand sends nothing", () => {
    expect(computeDirtyFieldsPatch(brand({ lat: 6.5, locationProviderPlaceId: `  ${ID} ` }), brand()))
      .toEqual({ lat: 6.5, lng: 3.4236, locationProviderPlaceId: ID });
    expect(computeDirtyFieldsPatch(brand({ lat: 6.5, locationProviderPlaceId: "   " }), brand()))
      .toEqual({ lat: 6.5, lng: 3.4236, locationProviderPlaceId: null });
    expect(computeDirtyFieldsPatch(brand({ locationProviderPlaceId: ` ${ID}` }), brand())).toEqual({});
    expect(computeDirtyFieldsPatch(brand(), brand())).toEqual({});
  });
});

describe("F-2 updateBrand sends the pin through biz_update_brand_pin", () => {
  const row = { id: "brand-1", name: "Kaycee", slug: "kaycee", lat: 6.43251, lng: 3.42361 };

  test("the rest is a table write without the pin; the pin and id go to the RPC", async () => {
    const calls: Array<[string, unknown[]]> = [];
    mockFrom.mockImplementation(() => chain({ data: { id: "brand-1" }, error: null }, calls));
    mockRpc.mockResolvedValue({ data: row, error: null });
    const saved = await updateBrand(
      "brand-1",
      { displayName: "Kaycee Music", lat: 6.43251, lng: 3.42361, locationProviderPlaceId: ID },
      null,
    );
    const update = calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>;
    expect(update).toEqual({ name: "Kaycee Music" });
    expect(mockRpc).toHaveBeenCalledWith("biz_update_brand_pin", {
      p_brand_id: "brand-1",
      p_lat: 6.43251,
      p_lng: 3.42361,
      p_location_place_id: ID,
    });
    expect(saved.lat).toBe(6.43251);
  });

  test("a pin-only patch makes no table write; no pin in the patch makes no RPC call", async () => {
    mockRpc.mockResolvedValue({ data: row, error: null });
    await updateBrand("brand-1", { lat: 1, lng: 2, locationProviderPlaceId: null }, null);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_brand_id: "brand-1", p_lat: 1, p_lng: 2, p_location_place_id: null,
    });

    mockRpc.mockReset();
    mockFrom.mockImplementation(() => chain({ data: row, error: null }));
    await updateBrand("brand-1", { displayName: "Kaycee" }, null);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("before the migration (PGRST202) the pin is written as a table update", async () => {
    const calls: Array<[string, unknown[]]> = [];
    mockRpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    mockFrom.mockImplementation(() => chain({ data: row, error: null }, calls));
    await updateBrand("brand-1", { lat: 6.43251, lng: 3.42361, locationProviderPlaceId: ID }, null);
    const update = calls.find(([m]) => m === "update")?.[1][0];
    expect(update).toEqual({ lat: 6.43251, lng: 3.42361, location_provider_place_id: ID });
  });

  test("any other RPC error is thrown, never swallowed", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "22023", message: "location_place_id_invalid" } });
    await expect(updateBrand("brand-1", { lat: 1, lng: 2, locationProviderPlaceId: "x" }, null))
      .rejects.toMatchObject({ message: "location_place_id_invalid" });
  });
});

describe("F-3 trip commands keep re-picked pins", () => {
  const pinPatch = {
    event: { business_trip: { departurePlaceId: ID, departureLat: 6.43251, departureLng: 3.42361 } },
  };

  test("only a patch that sends a place id is a pin patch", () => {
    expect(tripPatchSendsPlaceId(pinPatch)).toBe(true);
    expect(tripPatchSendsPlaceId({ theme: { business_trip: { destinationPlaceId: null } } })).toBe(false);
    expect(tripPatchSendsPlaceId({ theme: { business_trip: { destinationPlaceId: ID } } })).toBe(true);
    expect(tripPatchSendsPlaceId({ event: { title: "Lagos" } })).toBe(false);
    expect(tripPatchSendsPlaceId(null)).toBe(false);
  });

  const opts = { expectedUpdatedAt: "2026-11-09T10:00:00Z", operationId: "op-1" };

  test("a pin patch goes through biz_apply_trip_draft_graph_repick", async () => {
    mockRpc.mockResolvedValue({ data: { revision: "r2" }, error: null });
    await applyTripDraftGraph(EVENT, pinPatch, opts);
    expect(mockRpc.mock.calls.map(([n]) => n)).toEqual(["biz_apply_trip_draft_graph_repick"]);
  });

  test("before the migration (PGRST202) it falls back to the plain command, same arguments", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } })
      .mockResolvedValueOnce({ data: { revision: "r2" }, error: null });
    await applyTripDraftGraph(EVENT, pinPatch, opts);
    expect(mockRpc.mock.calls.map(([n]) => n)).toEqual([
      "biz_apply_trip_draft_graph_repick",
      "biz_apply_trip_draft_graph",
    ]);
    expect(mockRpc.mock.calls[1][1]).toEqual(mockRpc.mock.calls[0][1]);
  });

  test("a patch with no place id keeps the plain command", async () => {
    mockRpc.mockResolvedValue({ data: { revision: "r2" }, error: null });
    await applyTripDraftGraph(EVENT, { event: { title: "Lagos" } }, opts);
    expect(mockRpc.mock.calls.map(([n]) => n)).toEqual(["biz_apply_trip_draft_graph"]);
  });
});

describe("F-4 the reads carry the saved pin", () => {
  const viewRow = {
    id: EVENT, brand_id: "brand-1", brand_slug: "b", title: "Rooftop", slug: "rooftop",
    status: "scheduled", visibility: "public", description: "", timezone: "Africa/Lagos",
    management_theme: { business_event: { settings: {} } },
    created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
    published_at: "2026-11-01T00:00:00Z",
  };
  const probe = { id: EVENT, event_type: "event", location_provider_place_id: ID, coordinate_precision: "exact" };
  const tables = (probeRows: unknown, selects: string[]) => (table: string) => {
    if (table === "events") {
      const c = chain({ data: probeRows, error: null });
      const select = c.select as (...a: unknown[]) => unknown;
      c.select = (cols: unknown) => {
        selects.push(String(cols));
        return select(cols);
      };
      return c;
    }
    if (table === "ticket_types") return chain({ data: [], error: null });
    if (table === "event_rsvps") return chain({ data: [], error: null });
    return chain({
      data: Array.isArray(probeRows)
        ? probeRows.map((r) => ({ ...viewRow, id: (r as { id: string }).id }))
        : viewRow,
      error: null,
    });
  };

  test("the detail probe reads the place id and precision onto the LiveEvent", async () => {
    const selects: string[] = [];
    mockFrom.mockImplementation(tables(probe, selects));
    const detail = await fetchBusinessEventById(EVENT);
    expect(selects[0]).toContain("location_provider_place_id, coordinate_precision");
    expect(detail?.event.locationProviderPlaceId).toBe(ID);
    expect(detail?.event.coordinatePrecision).toBe("exact");
  });

  test("the list probe does the same; a pin with no id or precision reads as none", async () => {
    const selects: string[] = [];
    mockFrom.mockImplementation(tables([
      { ...probe, coordinate_precision: "approximate" },
      { ...probe, id: "e-2", location_provider_place_id: null, coordinate_precision: null },
    ], selects));
    const events = await fetchBusinessEventsForBrand("brand-1");
    expect(selects[0]).toContain("location_provider_place_id, coordinate_precision");
    expect(events[0].locationProviderPlaceId).toBe(ID);
    expect(events[0].coordinatePrecision).toBe("approximate");
    expect(events[1].locationProviderPlaceId).toBeNull();
    expect(events[1].coordinatePrecision).toBeNull();
  });

  test("the venue host read selects and maps the venue's place id", () => {
    expect(VENUE_DETAILS_HOST_COLUMNS.split(", ")).toContain("location_provider_place_id");
    const row = {
      id: "v-1", brand_id: "brand-1", name: "Venue", venue_category: "restaurant",
      address: "175 Akin Adesola St", city: "Lagos", country_code: "NG", lat: 6.4, lng: 3.4,
      coordinate_precision: "exact", location_provider_place_id: ID, contact_phone: null,
      contact_phone_country_iso: null, contact_email: null, claim_status: "verified",
      details_change_request_id: null, details_change_status: null,
    } as unknown as VenueDetailsRow;
    expect(mapVenueDetailsRow(row).locationProviderPlaceId).toBe(ID);
  });

});
