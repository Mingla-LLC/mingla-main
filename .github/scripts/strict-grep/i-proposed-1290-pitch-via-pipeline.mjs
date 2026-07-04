#!/usr/bin/env node
/**
 * META-ORCH-1290 (B2 addendum) — I-PROPOSED-1290-PITCH-WRITES-VIA-PIPELINE-ACTION
 * (DRAFT).
 *
 * Blocker B-2: Leg B persisted the listing-page pitch with a DIRECT client
 * `supabase.from("place_pool").update(...)`, gated only by the row-level RLS
 * policy `place_pool_business_owner_update` + `GRANT ALL ON place_pool TO
 * authenticated`. That row-level UPDATE power lets an owner set ANY column of
 * their own place_pool row via PostgREST (self-publish is_servable, forge
 * ai_signal_scores), bypassing admin approval + the bouncer + scoring — a
 * violation of the authored-writes-are-RPC/service-role-only architecture
 * (META-ORCH-1255/1263).
 *
 * This gate FAILS if:
 *   (a) `updateVenuePitch` in businessPlaceAuthoringService.ts does NOT invoke
 *       the pipeline `update_pitch` action; OR
 *   (b) `updateVenuePitch`'s body reintroduces a direct client place_pool write
 *       (`.from("place_pool")` inside the function); OR
 *   (c) the authoring-pipeline edge fn does NOT own an `update_pitch` handler
 *       (the `handleUpdatePitch` definition + the dispatch branch).
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * i-proposed-1290-pitch-consumer-facing.mjs / orch-1255-pipeline-no-brand-onconflict.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const SERVICE = join(
  root,
  "mingla-business",
  "src",
  "services",
  "businessPlaceAuthoringService.ts",
);
const EDGE = join(
  root,
  "supabase",
  "functions",
  "run-business-place-authoring-pipeline",
  "index.ts",
);

// Isolate the updateVenuePitch function body (from its export to the next export).
function updateVenuePitchBody(serviceSrc) {
  const start = serviceSrc.indexOf("export async function updateVenuePitch");
  if (start < 0) return null;
  const next = serviceSrc.indexOf("\nexport ", start + 1);
  return serviceSrc.slice(start, next < 0 ? serviceSrc.length : next);
}

const run = (serviceSrc, edgeSrc) => {
  const failures = [];
  const body = updateVenuePitchBody(serviceSrc);
  if (body === null) {
    failures.push("businessPlaceAuthoringService.ts no longer exports updateVenuePitch.");
  } else {
    if (
      !body.includes("supabase.functions.invoke") ||
      !/action:\s*["'`]update_pitch["'`]/.test(body)
    ) {
      failures.push(
        "updateVenuePitch does NOT invoke the pipeline `update_pitch` action — the pitch write must go through the authoring pipeline (B-2).",
      );
    }
    if (/\.from\(\s*["'`]place_pool["'`]\s*\)/.test(body)) {
      failures.push(
        "updateVenuePitch reintroduced a direct client place_pool write (`.from(\"place_pool\")`) — the RLS-gated owner UPDATE is B-2 and is forbidden for the pitch.",
      );
    }
  }
  if (
    !/export\s+async\s+function\s+handleUpdatePitch/.test(edgeSrc) ||
    !/action\s*===\s*["'`]update_pitch["'`]/.test(edgeSrc)
  ) {
    failures.push(
      "run-business-place-authoring-pipeline/index.ts no longer owns the `update_pitch` action (handleUpdatePitch + dispatch branch) — the pitch write has no server-side home.",
    );
  }
  return failures;
};

if (SELF_TEST) {
  const goodService = `
export async function updateVenuePitch(input: { brandId: string }): Promise<void> {
  const { data, error } = await supabase.functions.invoke("run-business-place-authoring-pipeline", {
    body: { action: "update_pitch", brand_id: input.brandId },
  });
  if (error !== null) throw error;
}
export async function next() {}
`;
  const goodEdge = `
export async function handleUpdatePitch(client, brand, venue, body) { return jsonResponse(200, {}); }
if (body.action === "update_pitch") { return await handleUpdatePitch(c, brand, venue, body); }
`;
  const badServiceDirect = `
export async function updateVenuePitch(input: { placePoolId: string }): Promise<void> {
  const { error } = await supabase.from("place_pool").update({ generative_summary: input.placePoolId }).eq("id", input.placePoolId);
  if (error !== null) throw error;
}
export async function next() {}
`;
  const badEdgeMissing = "// no handler here";

  if (run(goodService, goodEdge).length !== 0) {
    console.error("SELF-TEST FAIL: clean fixtures should pass");
    process.exit(1);
  }
  if (run(badServiceDirect, goodEdge).length === 0) {
    console.error("SELF-TEST FAIL: direct place_pool write fixture should fail");
    process.exit(1);
  }
  if (run(goodService, badEdgeMissing).length === 0) {
    console.error("SELF-TEST FAIL: missing edge update_pitch handler should fail");
    process.exit(1);
  }
  console.log("META-ORCH-1290 pitch-via-pipeline gate self-test passed.");
  process.exit(0);
}

for (const target of [SERVICE, EDGE]) {
  if (!existsSync(target)) {
    console.error(`META-ORCH-1290 pitch-via-pipeline gate failed: missing ${target}`);
    process.exit(1);
  }
}
const failures = run(readFileSync(SERVICE, "utf8"), readFileSync(EDGE, "utf8"));
if (failures.length > 0) {
  console.error("META-ORCH-1290 pitch-via-pipeline gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("META-ORCH-1290 pitch-via-pipeline gate passed.");
