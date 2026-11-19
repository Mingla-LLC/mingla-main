/**
 * issue #3281 — the roster page carries each row's booked start(s), read from
 * the page's own orders with the page: deduplicated, batched, scoped to the
 * event, and fail-soft (a failed read leaves the rows as they were).
 */
type Call = { ids: string[]; eventId: string | null };
const calls: Call[] = [];
let ordersResult: { data: unknown; error: unknown } | (() => never) = { data: [], error: null };
const mockRpc = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => {
      if (table !== "orders") throw new Error(`unexpected table ${table}`);
      const call: Call = { ids: [], eventId: null };
      const builder = {
        select: () => builder,
        in: (_col: string, ids: string[]) => {
          call.ids = ids;
          return builder;
        },
        eq: (_col: string, value: string) => {
          call.eventId = value;
          calls.push(call);
          if (typeof ordersResult === "function") return ordersResult();
          const all = (ordersResult.data ?? []) as Array<{ id: string }>;
          return Promise.resolve({
            data: ordersResult.error ? null : all.filter((o) => call.ids.includes(o.id)),
            error: ordersResult.error,
          });
        },
      };
      return builder;
    },
  },
}));

// eslint-disable-next-line import/first
import { BOOKED_START_BATCH, fetchGuestRoster } from "../guestRosterService";

const row = (key: string, orderIds: string[]) => ({ rosterKey: key, orderIds });
const page = (rows: unknown[]) => ({ rows, summary: {}, nextCursor: null });
const input = { eventId: "event-1", filter: "all" as const, search: "", sort: "action_priority" as const };

beforeEach(() => {
  calls.length = 0;
  ordersResult = { data: [], error: null };
  mockRpc.mockReset();
});

test("rows get their distinct booked starts, in order, from this event's orders", async () => {
  mockRpc.mockResolvedValue({
    data: page([row("a", ["o1", "o2", "o3"]), row("b", ["o4"]), row("c", [])]),
    error: null,
  });
  ordersResult = {
    data: [
      { id: "o1", booked_start_at: "2026-11-15T09:00:00Z" },
      { id: "o2", booked_start_at: "2026-11-14T18:30:00Z" },
      { id: "o3", booked_start_at: "2026-11-14T18:30:00Z" },
      { id: "o4", booked_start_at: null },
    ],
    error: null,
  };
  const result = await fetchGuestRoster(input);
  expect(result.rows.map((r) => r.bookedStarts)).toEqual([
    ["2026-11-14T18:30:00Z", "2026-11-15T09:00:00Z"],
    undefined,
    undefined,
  ]);
  expect(calls).toEqual([{ ids: ["o1", "o2", "o3", "o4"], eventId: "event-1" }]);
});

test("a full page's order ids go in batches", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `o${i}`);
  mockRpc.mockResolvedValue({ data: page([row("a", ids), row("b", ids.slice(0, 10))]), error: null });
  await fetchGuestRoster(input);
  expect(calls.map((c) => c.ids.length)).toEqual([BOOKED_START_BATCH, BOOKED_START_BATCH, 50]);
  expect(new Set(calls.flatMap((c) => c.ids)).size).toBe(250);
});

test("a failed orders read leaves the rows as they were", async () => {
  const rows = [row("a", ["o1"])];
  mockRpc.mockResolvedValue({ data: page(rows), error: null });
  ordersResult = { data: null, error: { message: "permission denied" } };
  expect((await fetchGuestRoster(input)).rows).toEqual(rows);
  ordersResult = () => {
    throw new Error("offline");
  };
  expect((await fetchGuestRoster(input)).rows).toEqual(rows);
});

test("a page with no orders makes no orders read", async () => {
  mockRpc.mockResolvedValue({ data: page([row("a", [])]), error: null });
  await fetchGuestRoster(input);
  expect(calls).toEqual([]);
});
