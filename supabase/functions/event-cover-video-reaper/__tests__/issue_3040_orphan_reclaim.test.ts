// Issue #3040 (T-B14, B-14) — orphaned applied assets are counted (flag off) or
// reclaimed (flag on), and a referenced asset is never touched.
// MINGLA-INVARIANT: I-VIDEO-NO-DESTROY-WHILE-REFERENCED | issue #3040 | no code path destroys a provider asset whose guid has a live reference
//
// FAILS ON REVERT: ignore the admin_config flag (or the reference guard) and
// the flag-off run destroys, or the referenced asset is destroyed.
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

const DAY = 24 * 60 * 60_000;
const applied = (id: string, ageDays: number) => ({
  id, status: "applied", provider: "bunny", target_kind: "event", source_asset_id: `guid-${id}`,
  reaped_at: null, completed_at: isoAgo(ageDays * DAY), created_at: isoAgo(ageDays * DAY + 60_000),
});

Deno.test("#3040 flag off: orphans are only counted", async () => {
  const reaper = makeReaper([applied("orphan", 8), applied("recent", 2)]);
  const body = await quietly(reaper.tick);
  assert(reaper.destroyed.length === 0, `destroyed with the flag off: ${reaper.destroyed.join(",")}`);
  assert(body.orphanReclaim?.enabled === false && body.orphanReclaim?.candidates === 1, JSON.stringify(body.orphanReclaim));
});

Deno.test("#3040 flag on: an unreferenced 8-day orphan is reclaimed; a referenced one never", async () => {
  const reaper = makeReaper([applied("orphan", 8), applied("shown", 9)], {
    adminConfig: [{ key: "cover_video_orphan_reclaim_enabled", value: true }],
    references: { "guid-shown": ["event_cover"] },
  });
  const body = await quietly(reaper.tick);
  assert(reaper.destroyed.includes("guid-orphan") && typeof reaper.job("orphan").reaped_at === "string", "orphan not reclaimed");
  assert(!reaper.destroyed.includes("guid-shown"), "a referenced asset was destroyed");
  assert(body.orphanReclaim?.destroyed === 1, JSON.stringify(body.orphanReclaim));
});
