/**
 * issue #3281 — the roster page carries each row's booked start(s), read from
 * the page's own orders with the page: deduplicated, batched, scoped to the
 * event, and fail-soft (a failed read leaves the rows as they were).
 */
type Call = { ids: string[]; eventId: string | null };
const calls: Call[] = [];
let ordersResult: { data: unknown; error: unknown } | (() => never) = { data: [], error: null };
let failOnCall: number | null = null;
let stallFromCall: number | null = null;
const mockRpc = jest.fn();
const mockReport = jest.fn();

jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: (...args: unknown[]) => mockReport(...args),
}));

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
          return builder;
        },
        abortSignal: (signal: AbortSignal) => {
          calls.push(call);
          if (stallFromCall !== null && calls.length >= stallFromCall) {
            // Never settles on its own; settles (rejected) only when aborted.
            return new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")));
            });
          }
          if (typeof ordersResult === "function") return ordersResult();
          if (failOnCall !== null && calls.length === failOnCall) {
            return Promise.resolve({ data: null, error: { message: "permission denied" } });
          }
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
import { fetchGuestRoster } from "../guestRosterService";
// eslint-disable-next-line import/first
import { BOOKED_START_BATCH, withBookedStarts } from "../guestRosterBookedStarts";

const row = (key: string, orderIds: string[]) => ({ rosterKey: key, orderIds });
const page = (rows: unknown[]) => ({ rows, summary: {}, nextCursor: null });
const input = {
  eventId: "event-1",
  filter: "all" as const,
  search: "",
  sort: "action_priority" as const,
  bookedStarts: true,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls.length = 0;
  failOnCall = null;
  stallFromCall = null;
  mockReport.mockReset();
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

test("a failed orders read leaves the rows as they were, and is reported", async () => {
  const rows = [row("a", ["o1"])];
  mockRpc.mockResolvedValue({ data: page(rows), error: null });
  ordersResult = { data: null, error: { message: "permission denied" } };
  expect((await fetchGuestRoster(input)).rows).toEqual(rows);
  ordersResult = () => {
    throw new Error("offline");
  };
  expect((await fetchGuestRoster(input)).rows).toEqual(rows);
  await flush();
  expect(mockReport).toHaveBeenCalledTimes(2);
  expect(mockReport.mock.calls[0][0]).toBe("guestRosterBookedStarts");
});

test("a later batch failing keeps the starts earlier batches found", async () => {
  const ids = Array.from({ length: 150 }, (_, i) => `o${i}`);
  // Ids are deduplicated in first-seen order, so o149 is only in batch 2.
  mockRpc.mockResolvedValue({ data: page([row("a", ["o0"]), row("c", ids), row("b", ["o149"])]), error: null });
  ordersResult = {
    data: [
      { id: "o0", booked_start_at: "2026-11-14T18:30:00Z" },
      { id: "o149", booked_start_at: "2026-11-15T09:00:00Z" },
    ],
    error: null,
  };
  failOnCall = 2; // the second batch (o100..o149) fails
  const result = await fetchGuestRoster(input);
  expect(result.rows.map((r) => r.bookedStarts)).toEqual([
    ["2026-11-14T18:30:00Z"],
    ["2026-11-14T18:30:00Z"],
    undefined,
  ]);
  await flush();
  expect(mockReport).toHaveBeenCalledTimes(1);
});

test("without the flag (not an experience) there is no orders read", async () => {
  mockRpc.mockResolvedValue({ data: page([row("a", ["o1"])]), error: null });
  const result = await fetchGuestRoster({ ...input, bookedStarts: false });
  expect(calls).toEqual([]);
  expect(result.rows[0].bookedStarts).toBeUndefined();
});

test("a page with no orders makes no orders read", async () => {
  mockRpc.mockResolvedValue({ data: page([row("a", [])]), error: null });
  await fetchGuestRoster(input);
  expect(calls).toEqual([]);
});

test("a request that never settles is cut at the deadline; the roster still returns", async () => {
  const rows = [row("a", ["o1"])];
  stallFromCall = 1;
  const result = await withBookedStarts(page(rows) as never, "event-1", { deadlineMs: 20 });
  expect(result.rows).toEqual(rows);
  await flush();
  expect(mockReport).toHaveBeenCalledTimes(1);
  expect(String(mockReport.mock.calls[0][1])).toContain("deadline");
});

test("a stall after a successful batch keeps that batch's starts", async () => {
  const ids = Array.from({ length: 150 }, (_, i) => `o${i}`);
  ordersResult = { data: [{ id: "o0", booked_start_at: "2026-11-14T18:30:00Z" }], error: null };
  stallFromCall = 2;
  const result = await withBookedStarts(
    page([row("a", ["o0"]), row("c", ids)]) as never,
    "event-1",
    { deadlineMs: 20 },
  );
  expect(result.rows.map((r) => r.bookedStarts)).toEqual([
    ["2026-11-14T18:30:00Z"],
    ["2026-11-14T18:30:00Z"],
  ]);
  await flush();
  expect(mockReport).toHaveBeenCalledTimes(1);
});
