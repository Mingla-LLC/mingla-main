/**
 * ISSUE-1002 create-endpoint destination contract — toward #3697 Wave 2 (#3707).
 *
 * [TEST-MOD-APPROVED #3697] Fan-out is forbidden. This suite pins the refusal:
 *   1. destination_group_id → multi_destination_fanout_forbidden
 *   2. destinations.length > 1 → multi_destination_fanout_forbidden
 *   3. Both gates run before getAdapter / provider work
 *   4. Shared pickCallDestination / pickDestGroupId helpers remain (single-dest path)
 *
 * Run: deno test --allow-read supabase/functions/_shared/__tests__/issue1002_multi_destination_fanout.test.ts
 */

import { assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const CREATE_FN_PATH = new URL(
  "../../admin-ad-create-campaign/index.ts",
  import.meta.url,
);

async function readCreateFn(): Promise<string> {
  return await Deno.readTextFile(CREATE_FN_PATH);
}

Deno.test("ISSUE-1002 · Wave 2 rejects destination_group_id and multi destinations before provider", async () => {
  const src = await readCreateFn();
  const groupGate = src.indexOf("pickDestGroupId(body)");
  const multiLenGate = src.indexOf("body.destinations.length > 1");
  const forbidden = src.indexOf("multi_destination_fanout_forbidden");
  const adapterCall = src.indexOf("getAdapter(platform)");
  assert(groupGate >= 0, "must resolve destination_group_id");
  assert(multiLenGate >= 0, "must reject destinations[] length > 1");
  assert(forbidden >= 0, "must return multi_destination_fanout_forbidden");
  assert(adapterCall >= 0, "provider adapter path must still exist later");
  assert(
    forbidden < adapterCall && groupGate < adapterCall && multiLenGate < adapterCall,
    "fan-out refusal must run before any provider/adapter call",
  );
  assert(/if \(destGroupId\)/.test(src), "destination_group_id alone is refused");
  assert(
    (src.match(/multi_destination_fanout_forbidden/g) ?? []).length >= 2,
    "both group-id and multi-destination branches emit the same detail",
  );
});

Deno.test("ISSUE-1002 · shared destination helpers remain for the single-page path", async () => {
  const src = await readCreateFn();
  assert(
    /function pickCallDestination\(/.test(src),
    "the shared per-call destination resolver must exist",
  );
  assert(
    /function pickDestGroupId\(/.test(src),
    "the shared group-id resolver must exist",
  );
  assert(src.includes("body.destination"), "singular destination still resolved");
  assert(src.includes("body.destinations"), "destinations[] still read (to refuse length > 1)");
});
