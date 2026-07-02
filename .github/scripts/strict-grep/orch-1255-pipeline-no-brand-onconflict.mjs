#!/usr/bin/env node
/**
 * META-ORCH-1255 — I-PROPOSED-1255-PER-VENUE-OPS-NO-SHARED-INVENTORY (DRAFT),
 * edge-fn arm (enforcement (b)).
 *
 * The authoring pipeline's state row is keyed ONE-PER-VENUE. The R-1 bug this
 * kills: `upsertPipelineState` upserted with `onConflict: "brand_id"`, so
 * creating venue #2 silently CLOBBERED venue #1's pipeline row. This gate
 * fails if:
 *   (a) run-business-place-authoring-pipeline/index.ts contains
 *       onConflict: "brand_id" (any quoting/spacing); OR
 *   (b) it does NOT contain onConflict: "venue_id" (the venue keying was
 *       dropped entirely).
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * orch-1186-hours-single-owner.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const TARGET = join(
  root,
  "supabase",
  "functions",
  "run-business-place-authoring-pipeline",
  "index.ts",
);

const BRAND_CONFLICT = /onConflict\s*:\s*["'`]brand_id["'`]/;
const VENUE_CONFLICT = /onConflict\s*:\s*["'`]venue_id["'`]/;

const run = (code) => {
  const failures = [];
  if (BRAND_CONFLICT.test(code)) {
    failures.push(
      'run-business-place-authoring-pipeline upserts with onConflict:"brand_id" — the R-1 venue-clobber bug is back (venue #2 overwrites venue #1\'s pipeline row).',
    );
  }
  if (!VENUE_CONFLICT.test(code)) {
    failures.push(
      'run-business-place-authoring-pipeline no longer upserts with onConflict:"venue_id" — the per-venue pipeline keying was dropped.',
    );
  }
  return failures;
};

if (SELF_TEST) {
  const good = 'await client.from("brand_place_pipeline_state").upsert(row, { onConflict: "venue_id" });';
  const badBrand = 'await client.from("brand_place_pipeline_state").upsert(row, { onConflict: "brand_id" });';
  const badMissing = 'await client.from("brand_place_pipeline_state").insert(row);';
  if (run(good).length !== 0) {
    console.error("SELF-TEST FAIL: clean fixture should pass");
    process.exit(1);
  }
  if (run(badBrand).length === 0) {
    console.error('SELF-TEST FAIL: onConflict:"brand_id" fixture should fail');
    process.exit(1);
  }
  if (run(badMissing).length === 0) {
    console.error("SELF-TEST FAIL: missing venue_id conflict fixture should fail");
    process.exit(1);
  }
  console.log("ORCH-1255 pipeline-no-brand-onconflict gate self-test passed.");
  process.exit(0);
}

if (!existsSync(TARGET)) {
  console.error(`ORCH-1255 gate failed: missing ${TARGET}`);
  process.exit(1);
}
const failures = run(readFileSync(TARGET, "utf8"));
if (failures.length > 0) {
  console.error("ORCH-1255 pipeline-no-brand-onconflict gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1255 pipeline-no-brand-onconflict gate passed.");
