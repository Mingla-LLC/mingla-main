/**
 * ISSUE-1002 [Campaign Builder multi-destination fan-out] — Wave 4 (final) of
 * epic #977. Edge source-contract suite over admin-ad-create-campaign.
 *
 * The fn calls serve() at module load, so (like the ISSUE-927 create-branch
 * suite) it is pinned by asserting the SOURCE contract, not by importing it.
 *
 * Forensic Lane C proved the backend was single-destination at every layer:
 * `interface DestinationInput` (singular), five COPY-PASTED
 * `(body.destination ?? {}) as DestinationInput` picks, and no way to group the
 * ad_campaigns rows a fan-out produces. This suite pins the fix and FAILS ON
 * REVERT:
 *   1. The request accepts a `destinations` array (DestinationInput[]) + a
 *      `destination_group_id` — resolved by ONE shared helper (`pickCallDestination`
 *      / `pickDestGroupId`), which also DE-DUPLICATES the five copy-pasted picks
 *      (the old inline pattern is gone).
 *   2. ALL FIVE ad_campaigns inserts persist `dest_group_id: destGroupId`, so the
 *      N rows of one fan-out share a group id.
 *   3. Backward compat: the singular `destination` is still resolved first, so a
 *      single-destination call behaves exactly as before.
 *
 * Run: deno test --allow-read supabase/functions/_shared/__tests__/issue1002_multi_destination_fanout.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const CREATE_FN_PATH = new URL(
  "../../admin-ad-create-campaign/index.ts",
  import.meta.url,
);

async function readCreateFn(): Promise<string> {
  return await Deno.readTextFile(CREATE_FN_PATH);
}

/** Count non-overlapping occurrences of a literal marker. */
function countOf(src: string, marker: string): number {
  let n = 0;
  let i = src.indexOf(marker);
  while (i >= 0) {
    n += 1;
    i = src.indexOf(marker, i + marker.length);
  }
  return n;
}

Deno.test("ISSUE-1002 · the request accepts a destinations[] array + a group id", async () => {
  const src = await readCreateFn();
  // The forward contract: the endpoint reads `body.destinations` (the array) and
  // `body.destination_group_id`, in addition to the legacy singular `destination`.
  assert(src.includes("body.destinations"), "must read the destinations[] array");
  assert(src.includes("body.destination_group_id"), "must read the destination_group_id");
  assert(
    /function pickCallDestination\(/.test(src),
    "the shared per-call destination resolver must exist",
  );
  assert(
    /function pickDestGroupId\(/.test(src),
    "the shared group-id resolver must exist",
  );
});

Deno.test("ISSUE-1002 · pickCallDestination prefers the singular destination (backward compat), falls back to destinations[0]", async () => {
  const src = await readCreateFn();
  // Backward compat: the singular `body.destination` is resolved FIRST, so every
  // pre-1002 caller (and every single-destination build) is unchanged.
  const fnStart = src.indexOf("function pickCallDestination(");
  assert(fnStart >= 0);
  const fnBody = src.slice(fnStart, fnStart + 700);
  assert(fnBody.includes("body.destination"), "resolves the singular destination");
  assert(fnBody.includes("body.destinations"), "falls back to the destinations[] array");
  assert(
    fnBody.indexOf("body.destination") < fnBody.indexOf("body.destinations"),
    "singular destination is preferred (resolved before the array) — backward compatible",
  );
});

Deno.test("ISSUE-1002 · the 5 copy-pasted destination picks are de-duplicated to the shared resolver", async () => {
  const src = await readCreateFn();
  // All five per-platform blocks now pick via the one resolver...
  assertEquals(
    countOf(src, "pickCallDestination(body)"),
    5,
    "all five per-platform blocks resolve the destination through the shared helper",
  );
  // ...and the old inline copy-paste (ISSUE-977 Lane C discovery #2) is gone.
  assertEquals(
    countOf(src, "(body.destination ?? {}) as DestinationInput"),
    0,
    "the copy-pasted inline destination pick is removed",
  );
});

Deno.test("ISSUE-1002 · ALL FIVE ad_campaigns inserts persist dest_group_id (fan-out rows share the group)", async () => {
  const src = await readCreateFn();
  assertEquals(
    countOf(src, "dest_group_id: destGroupId"),
    5,
    "every one of the five ad_campaigns inserts carries the shared group id",
  );
  // The group id is derived once, from the request, via the shared resolver.
  assert(
    src.includes("const destGroupId = pickDestGroupId(body)"),
    "the group id is resolved once per request",
  );
});
