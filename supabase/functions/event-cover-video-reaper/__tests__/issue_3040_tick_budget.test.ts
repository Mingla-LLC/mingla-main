// Issue #3040 (T-B6 reaper half, B-6) — a tick stops starting new work after
// its 45 s budget, so a slow provider can never make ticks overlap.
// MINGLA-INVARIANT: I-VIDEO-BOUNDED-IO | issue #3040 | the reaper tick has a work budget
//
// FAILS ON REVERT: remove the overBudget() checks and the second candidate is
// still worked after the first one consumed the whole budget.
import { REAPER_TICK_BUDGET_MS } from "../index.ts";
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

Deno.test("#3040 one slow provider read exhausts the budget and later candidates wait for the next tick", async () => {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  const reads: string[] = [];
  try {
    const job = (id: string, created: number) => ({
      id, status: "processing", provider: "bunny", target_kind: "event", source_asset_id: `guid-${id}`,
      source_uploaded_at: isoAgo(60_000), created_at: isoAgo(created), reaped_at: null,
    });
    const reaper = makeReaper([job("first", 120_000), job("second", 60_000)], {
      bunnyGetVideo: (guid: string) => {
        reads.push(guid);
        offset += REAPER_TICK_BUDGET_MS + 1_000; // this read "took" longer than the budget
        return Promise.resolve({ ok: false, status: 503, reason: "bunny_get_http_503" });
      },
    });
    const body = await quietly(reaper.tick);
    assert(REAPER_TICK_BUDGET_MS === 45_000, "budget changed");
    assert(reads.length === 1 && reads[0] === "guid-first", `worked ${reads.join(",")}`);
    assert(body.budgetExhausted === true && body.ok === true, JSON.stringify(body));
  } finally {
    Date.now = realNow;
  }
});
