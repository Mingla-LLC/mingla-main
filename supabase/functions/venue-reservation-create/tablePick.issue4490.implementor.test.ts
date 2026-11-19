// #4490 P5 — the guest's table pick is read from the same map the guest sees.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { tablePickStatus } from "./tablePick.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const T1 = "00000000-4490-4000-8000-0000000000b1";
const T2 = "00000000-4490-4000-8000-0000000000b2";

function client(rows: Array<Record<string, unknown>>) {
  return {
    rpc: (_name: string, _params: Record<string, unknown>) =>
      Promise.resolve({ data: rows, error: null }),
  };
}

Deno.test("a free table is free; a taken one is table_taken", async () => {
  const rows = [
    { option_kind: "table", table_ids: [T1], status: "free" },
    { option_kind: "table", table_ids: [T2], status: "taken" },
  ];
  assertEquals(
    await tablePickStatus(client(rows), VENUE, "2026-11-21T19:00:00Z", 4, [T1]),
    "free",
  );
  assertEquals(
    await tablePickStatus(client(rows), VENUE, "2026-11-21T19:00:00Z", 4, [T2]),
    "table_taken",
  );
});

Deno.test("a joined pair matches in any order; not pickable and not fit are plain codes", async () => {
  const rows = [
    { option_kind: "join", table_ids: [T1, T2], status: "free" },
    { option_kind: "table", table_ids: [T1], status: "not_pickable" },
  ];
  assertEquals(
    await tablePickStatus(client(rows), VENUE, "2026-11-21T19:00:00Z", 8, [
      T2,
      T1,
    ]),
    "free",
  );
  assertEquals(
    await tablePickStatus(client(rows), VENUE, "2026-11-21T19:00:00Z", 2, [T1]),
    "table_not_pickable",
  );
  assertEquals(
    await tablePickStatus(client(rows), VENUE, "2026-11-21T19:00:00Z", 2, [T2]),
    "table_not_fit",
  );
});

Deno.test("an empty map means pick a table is off", async () => {
  assertEquals(
    await tablePickStatus(client([]), VENUE, "2026-11-21T19:00:00Z", 2, [T1]),
    "table_pick_unavailable",
  );
});
