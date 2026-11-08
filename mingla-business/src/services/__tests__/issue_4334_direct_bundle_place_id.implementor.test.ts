/**
 * issue #4334 N-1 (retest 2) — the buyer page's REAL read carries the Google
 * place id.
 *
 * The buyer event page resolves through `pg_direct_event_checkout_bundle` first
 * (`getPublicEventBySlug` / `getPublicEventById` → the private
 * `detailFromDirectBundle`); the `pg_public_event_by_slug` merge only runs on the
 * fallback. Only the Supabase transport is mocked here, so the real mapper runs.
 *
 *   D-1  the bundle's googlePlaceId lands on the event (by id and by slug)
 *   D-2  null (street withheld), absent (older bundle) and non-string values map to null
 *   D-3  the direct path never touches the fallback view
 *
 * FAILS-ON-REVERT: drop the `event.googlePlaceId =` assignment in
 * detailFromDirectBundle and D-1 fails.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

/* eslint-disable import/first */
import { getPublicEventById, getPublicEventBySlug } from "../publicEventsService";
/* eslint-enable import/first */

const EVENT_ID = "0b6f7a1e-4334-4c1a-9d2e-5f0a4334b001";
const PLACE_ID = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";

const bundle = (patch: Record<string, unknown>): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: "brand-4334",
  brandSlug: "didi",
  eventSlug: "museum-night",
  name: "Museum Night",
  description: "",
  status: "scheduled",
  timezone: "Africa/Lagos",
  masterStartAt: "2099-10-13T19:00:00.000Z",
  masterEndAt: "2099-10-13T23:00:00.000Z",
  tickets: [],
  brand: {
    id: "brand-4334",
    slug: "didi",
    name: "Didi Museum",
    address: null,
    coverMediaUrl: null,
  },
  occurrences: [
    {
      id: "n1",
      startAt: "2099-10-13T19:00:00.000Z",
      endAt: "2099-10-13T23:00:00.000Z",
      timezone: "Africa/Lagos",
      isMaster: true,
    },
  ],
  isMultiDate: false,
  isRecurring: false,
  multiDatePricingMode: "per_day",
  ...patch,
});

const serve = (payload: Record<string, unknown>): void => {
  mockRpc.mockImplementation((name: unknown) => {
    if (name !== "pg_direct_event_checkout_bundle") {
      throw new Error(`Unexpected RPC ${String(name)}`);
    }
    return Promise.resolve({ data: payload, error: null });
  });
};

const byId = async (payload: Record<string, unknown>) => {
  serve(payload);
  const detail = await getPublicEventById(EVENT_ID);
  if (detail === null) throw new Error("bundle did not resolve");
  return detail;
};

describe("#4334 N-1 — the direct bundle's googlePlaceId reaches the buyer page", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  test("D-1 the place id is carried by id and by slug", async () => {
    expect((await byId(bundle({ googlePlaceId: PLACE_ID }))).event.googlePlaceId).toBe(PLACE_ID);
    serve(bundle({ googlePlaceId: PLACE_ID }));
    const bySlug = await getPublicEventBySlug("didi", "museum-night");
    expect(bySlug?.event.googlePlaceId).toBe(PLACE_ID);
  });

  test("D-2 withheld, absent or malformed ids map to null", async () => {
    expect((await byId(bundle({ googlePlaceId: null }))).event.googlePlaceId).toBeNull();
    expect((await byId(bundle({}))).event.googlePlaceId).toBeNull();
    expect((await byId(bundle({ googlePlaceId: "" }))).event.googlePlaceId).toBeNull();
    expect((await byId(bundle({ googlePlaceId: 42 }))).event.googlePlaceId).toBeNull();
  });

  test("D-3 the direct path answers without the fallback view", async () => {
    await byId(bundle({ googlePlaceId: PLACE_ID }));
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
