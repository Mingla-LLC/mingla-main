// #4238 AC 2/3: "Started checkout" — ad-tap visits (click ids) with a
// checkout session within 7 days of the tap, never below counted purchases,
// null (hidden) on any read failure.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hostAdCheckoutStartedCount, loadHostAdCheckoutStarted } from "../hostAdOverview.ts";

const touch = (id: string, click: string, at = "2026-11-10T10:00:00Z") => ({ id, click_id: click, created_at: at });
const session = (click: string, at: string) => ({ attribution_click_id: click, created_at: at });

Deno.test("#4238 checkout: a session outside the 7-day window is not counted", () => {
  assertEquals(
    hostAdCheckoutStartedCount({
      touches: [touch("t1", "k1"), touch("t2", "k2")],
      sessions: [session("k1", "2026-11-17T09:59:00Z"), session("k2", "2026-11-17T10:00:01Z"), session("k2", "2026-11-10T09:00:00Z")],
      purchaseTouchIds: [],
      bought: 0,
    }),
    1,
  );
});

Deno.test("#4238 checkout: two sessions on one click id count once", () => {
  assertEquals(
    hostAdCheckoutStartedCount({
      touches: [touch("t1", "k1")],
      sessions: [session("k1", "2026-11-10T10:05:00Z"), session("k1", "2026-11-11T10:05:00Z")],
      purchaseTouchIds: [],
      bought: 0,
    }),
    1,
  );
});

Deno.test("#4238 checkout: a purchase without a session lifts the count to at least bought", () => {
  assertEquals(
    hostAdCheckoutStartedCount({ touches: [touch("t1", "k1")], sessions: [], purchaseTouchIds: ["t1", "t9"], bought: 2 }),
    2,
  );
  assertEquals(
    hostAdCheckoutStartedCount({ touches: [touch("t1", "k1")], sessions: [], purchaseTouchIds: ["t1"], bought: 3 }),
    3,
  );
});

type Call = { table: string; from: number; to: number; inValues: string[] };

function fakeDb(tables: Record<string, Record<string, unknown>[]>, fail: string | null = null) {
  const calls: Call[] = [];
  return {
    calls,
    from(table: string) {
      let column = "";
      let values: string[] = [];
      const q = {
        select: () => q,
        order: () => q,
        in: (col: string, vals: string[]) => {
          column = col;
          values = vals;
          return q;
        },
        range: (from: number, to: number) => {
          calls.push({ table, from, to, inValues: values });
          if (fail === table) return Promise.resolve({ data: null, error: { message: "boom" } });
          const rows = (tables[table] ?? []).filter((row) => values.includes(String(row[column])));
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return q;
    },
  };
}

Deno.test("#4238 checkout: reads every page past 1000 touches", async () => {
  const touches = Array.from({ length: 2300 }, (_, i) => ({
    id: `t${i}`,
    click_id: `k${i}`,
    campaign_id: "c1",
    created_at: "2026-11-10T10:00:00Z",
  }));
  const db = fakeDb({
    ad_attribution_touches: touches,
    ticket_checkout_sessions: [
      { attribution_click_id: "k5", created_at: "2026-11-10T11:00:00Z" },
      { attribution_click_id: "k2250", created_at: "2026-11-10T11:00:00Z" },
    ],
  });
  const count = await loadHostAdCheckoutStarted(db, { campaignIds: ["c1"], purchaseTouchIds: [], bought: 0 });
  assertEquals(count, 2);
  assertEquals(db.calls.filter((c) => c.table === "ad_attribution_touches").map((c) => c.from), [0, 1000, 2000]);
  // sessions are read in chunks of 200 click ids
  const sessionCalls = db.calls.filter((c) => c.table === "ticket_checkout_sessions");
  assertEquals(sessionCalls.length, 12);
  assertEquals(Math.max(...sessionCalls.map((c) => c.inValues.length)), 200);
});

Deno.test("#4238 checkout: a read error is null, never 0", async () => {
  const touches = [{ id: "t1", click_id: "k1", campaign_id: "c1", created_at: "2026-11-10T10:00:00Z" }];
  assertEquals(
    await loadHostAdCheckoutStarted(fakeDb({ ad_attribution_touches: touches }, "ad_attribution_touches"), { campaignIds: ["c1"], purchaseTouchIds: [], bought: 0 }),
    null,
  );
  assertEquals(
    await loadHostAdCheckoutStarted(fakeDb({ ad_attribution_touches: touches }, "ticket_checkout_sessions"), { campaignIds: ["c1"], purchaseTouchIds: ["t1"], bought: 1 }),
    null,
  );
});
