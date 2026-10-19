// Issue #3040 (T-B13, B-13) — a job whose client vanished before the provider
// was ever asked for an asset still ends, server-side.
// MINGLA-INVARIANT: I-VIDEO-READY-HAS-OWNER | issue #3040 | every non-terminal job has a server owner with a finite bound
//
// FAILS ON REVERT: remove the allocation-abandoned step and the 11-minute job
// stays `source_uploading` forever (no read, no claim ever sees it).
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

const MIN = 60_000;
const job = (id: string, overrides: Record<string, unknown>) => ({
  id, status: "source_uploading", provider: "bunny", target_kind: "event", source_asset_id: null,
  provider_allocation_uncertain_at: null, reaped_at: null, created_at: isoAgo(11 * MIN), ...overrides,
});

Deno.test("#3040 no asset, no uncertainty, 11 minutes old → failed allocation_abandoned", async () => {
  const reaper = makeReaper([job("abandoned", {}), job("young", { created_at: isoAgo(5 * MIN) })]);
  const body = await quietly(reaper.tick);
  assert(reaper.job("abandoned").status === "failed" && reaper.job("abandoned").failure_code === "allocation_abandoned", JSON.stringify(reaper.job("abandoned")));
  assert(reaper.job("young").status === "source_uploading", "a 5-minute job was failed");
  assert(body.allocationAbandoned === 1, JSON.stringify(body));
});

Deno.test("#3040 an uncertain allocation title lookup cannot resolve for 30 minutes → allocation_unresolved", async () => {
  const reaper = makeReaper([
    job("uncertain", {
      provider_allocation_uncertain_at: isoAgo(31 * MIN),
      provider_allocation_identity: "uncertain",
      created_at: isoAgo(32 * MIN),
    }),
  ], { bunnyFindVideoByTitle: () => Promise.resolve({ ok: false, reason: "bunny_lookup_network_TimeoutError" }) });
  const body = await quietly(reaper.tick);
  const row = reaper.job("uncertain");
  assert(row.status === "failed" && row.failure_code === "allocation_unresolved", JSON.stringify(row));
  assert(body.allocationUnresolved === 1, JSON.stringify(body));
});
