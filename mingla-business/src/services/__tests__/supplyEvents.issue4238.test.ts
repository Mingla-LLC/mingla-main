// MINGLA-INVARIANT: I-4238-HOST-SUPPLY-EVENTS | issue #4238 | the Host app logs mingla_trip_published and mingla_experience_published at the publish-succeeded point (the twins of mingla_event_published), and never when the publish fails.
/**
 * #4238 W6-12, trip half. Runs the real `publishTrip` against a mocked
 * Supabase client and a mocked AppsFlyer service, and checks what is logged:
 *   - a publish the server accepts logs `mingla_trip_published` once, with the
 *     trip id and the brand id read back from the published trip;
 *   - a publish the server refuses (RPC error, `ok: false`), or a trip that
 *     cannot be read back, logs nothing.
 * The experience half is `src/components/experience/__tests__/
 * issue_4238_experience_supply_event.implementor.test.tsx`.
 */
/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type Terminal = { data?: unknown; error?: unknown };
type RpcAnswer = { data: unknown; error: { code?: string; message?: string } | null };

const mockFrom = jest.fn<(table: string) => unknown>();
const mockRpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcAnswer>>();
const mockLogAppsFlyerEvent = jest.fn<(name: string, values: Record<string, unknown>) => void>();

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u-4238" } } }) },
  },
}));
jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: (name: string, values: Record<string, unknown>) =>
    mockLogAppsFlyerEvent(name, values),
}));

import { publishTrip } from "../tripsService";
import { createChainableQuery } from "./__helpers__/supabaseMock";

const EVENT_ID = "42380000-0000-4000-8000-0000000000a1";
const BRAND_ID = "42380000-0000-4000-8000-0000000000b1";
const REVISION = "2027-03-01T10:00:00.000001+00:00";

const TRIP_ROW = {
  id: EVENT_ID,
  brand_id: BRAND_ID,
  event_type: "trip",
  title: "Lisbon weekend",
  status: "published",
  published_at: "2027-03-01T10:05:00Z",
  updated_at: REVISION,
  deleted_at: null,
  brands: { slug: "lisbon-trips" },
};

let tripRow: Record<string, unknown> | null = TRIP_ROW;

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockLogAppsFlyerEvent.mockReset();
  tripRow = TRIP_ROW;
  mockFrom.mockImplementation((table: string) => {
    const terminal: Terminal =
      table === "events" ? { data: tripRow, error: null } : { data: [], error: null };
    return createChainableQuery(terminal);
  });
  mockRpc.mockImplementation(async (fn: string) => {
    if (fn === "biz_publish_trip_command") {
      return { data: { ok: true, event: { id: EVENT_ID } }, error: null };
    }
    if (fn === "biz_trip_tickets_sold") return { data: 0, error: null };
    return { data: {}, error: null };
  });
});

const supplyCalls = (): [string, Record<string, unknown>][] =>
  mockLogAppsFlyerEvent.mock.calls.filter(([name]) => name === "mingla_trip_published");

describe("#4238 W6-12 a published trip logs mingla_trip_published", () => {
  test("a publish the server accepts logs the event once, with the trip and brand ids", async () => {
    const trip = await publishTrip(EVENT_ID, {}, { revision: { current: REVISION } });
    expect(trip.brandId).toBe(BRAND_ID);
    expect(mockRpc.mock.calls.map(([fn]) => fn)).toContain("biz_publish_trip_command");
    expect(supplyCalls()).toEqual([
      ["mingla_trip_published", { event_id: EVENT_ID, brand_id: BRAND_ID }],
    ]);
  });

  test("a publish the server refuses with an RPC error logs nothing", async () => {
    mockRpc.mockImplementation(async (fn: string) =>
      fn === "biz_publish_trip_command"
        ? { data: null, error: { code: "P0001", message: "trip_days_required" } }
        : { data: {}, error: null },
    );
    await expect(
      publishTrip(EVENT_ID, {}, { revision: { current: REVISION } }),
    ).rejects.toBeTruthy();
    expect(supplyCalls()).toEqual([]);
  });

  test("a publish the server answers ok:false logs nothing", async () => {
    mockRpc.mockImplementation(async (fn: string) =>
      fn === "biz_publish_trip_command"
        ? { data: { ok: false, reason: "stripe_not_ready" }, error: null }
        : { data: {}, error: null },
    );
    await expect(
      publishTrip(EVENT_ID, {}, { revision: { current: REVISION } }),
    ).rejects.toBeTruthy();
    expect(supplyCalls()).toEqual([]);
  });

  test("a trip that cannot be read back after publish logs nothing", async () => {
    tripRow = null;
    await expect(
      publishTrip(EVENT_ID, {}, { revision: { current: REVISION } }),
    ).rejects.toThrow("publishTrip: trip not found after publish");
    expect(supplyCalls()).toEqual([]);
  });

  test("an AppsFlyer failure never fails the publish", async () => {
    mockLogAppsFlyerEvent.mockImplementation(() => {
      throw new Error("native module missing");
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const trip = await publishTrip(EVENT_ID, {}, { revision: { current: REVISION } });
    expect(trip.id).toBe(EVENT_ID);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
