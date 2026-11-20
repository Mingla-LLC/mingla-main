/**
 * #4420 P2-2 — the Guest chat shows its NEWEST 80 messages, oldest first.
 *
 * listMessages used to order ascending with limit 80, so a room with more than
 * 80 messages showed the oldest 80 and never the latest. The mock below
 * applies the query's real order and limit to 120 seeded rows.
 *
 * FAILS ON REVERT: order ascending again (or drop the reverse) and the page is
 * the oldest 80 (or newest first) and this fails.
 */
import { expect, jest, test } from "@jest/globals";

type Row = { id: string; created_at: string; content: string; sender_kind: string; deleted_at: null; conversation_id: string };

const seeded: Row[] = Array.from({ length: 120 }, (_, index) => ({
  id: `m${String(index).padStart(3, "0")}`,
  created_at: new Date(Date.UTC(2026, 10, 19, 9, 0, index)).toISOString(),
  content: `message ${index}`,
  sender_kind: "guest",
  deleted_at: null,
  conversation_id: "x-ty",
}));

function query(rows: Row[]) {
  const orders: { column: keyof Row; ascending: boolean }[] = [];
  let limit = Infinity;
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    order: (column: keyof Row, options: { ascending: boolean }) => {
      orders.push({ column, ascending: options.ascending });
      return builder;
    },
    limit: (n: number) => {
      limit = n;
      return builder;
    },
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
      const sorted = rows.slice().sort((left, right) => {
        for (const { column, ascending } of orders) {
          const cmp = String(left[column]).localeCompare(String(right[column]));
          if (cmp !== 0) return ascending ? cmp : -cmp;
        }
        return 0;
      });
      return Promise.resolve(resolve({ data: sorted.slice(0, limit), error: null }));
    },
  };
  return builder;
}

jest.mock("../supabase", () => ({
  supabase: { from: () => query(seeded) },
}));

// eslint-disable-next-line import/first
import { listMessages } from "../groupChatService";

test("120 messages → the newest 80, oldest first", async () => {
  const result = await listMessages("x-ty");
  expect(result.error).toBeNull();
  expect(result.messages).toHaveLength(80);
  expect(result.messages[0].id).toBe("m040");
  expect(result.messages[79].id).toBe("m119");
  const times = result.messages.map((message) => message.created_at);
  expect(times).toEqual([...times].sort());
});
