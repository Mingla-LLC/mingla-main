#!/usr/bin/env node
/**
 * META-ORCH-1255 — I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE (DRAFT),
 * strict-grep arm (enforcement (b)). Anon venue reads flow ONLY through
 * venue_public_view (security-definer, verified-only); venue_listings has no
 * anon grant.
 *
 * Fails if mingla-business/src/services/publicEventsService.ts or
 * mingla-business/src/components/venue/PublicVenuePage.tsx (Leg C file —
 * missing = skipped) queries `from("venue_listings")` directly: on the anon
 * buyer web that read would 401 at runtime AND signal a policy widening
 * attempt. SQL runtime complement:
 * supabase/migrations/__tests__/orch_1255_public_view_anon.test.sql.
 *
 * Mirrors the modular self-testing gate pattern (sibling: orch-1186-hours-single-owner.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const FILES = [
  "mingla-business/src/services/publicEventsService.ts",
  "mingla-business/src/components/venue/PublicVenuePage.tsx",
];

const DIRECT_TABLE = /\.from\(\s*["'`]venue_listings["'`]\s*\)/;

const run = (files) => {
  const failures = [];
  for (const f of files) {
    if (f.code === null) continue; // Leg C file not shipped yet — skipped.
    if (DIRECT_TABLE.test(f.code)) {
      failures.push(
        `${f.name}: queries from("venue_listings") directly — anon/public venue reads must go through venue_public_view (definer, verified-only).`,
      );
    }
  }
  return failures;
};

if (SELF_TEST) {
  const clean = [
    {
      name: "mingla-business/src/services/publicEventsService.ts",
      code: 'const { data } = await supabase.from("venue_public_view").select("*");',
    },
    { name: "mingla-business/src/components/venue/PublicVenuePage.tsx", code: null },
  ];
  if (run(clean).length !== 0) {
    console.error("SELF-TEST FAIL: clean fixture should pass");
    process.exit(1);
  }
  const bad = [
    {
      name: "mingla-business/src/services/publicEventsService.ts",
      code: 'const { data } = await supabase.from("venue_listings").select("*");',
    },
  ];
  if (run(bad).length === 0) {
    console.error("SELF-TEST FAIL: direct venue_listings read should fail");
    process.exit(1);
  }
  console.log("ORCH-1255 public-venue-anon-safe gate self-test passed.");
  process.exit(0);
}

const files = FILES.map((rel) => {
  const p = join(root, rel);
  return { name: rel, code: existsSync(p) ? readFileSync(p, "utf8") : null };
});
const failures = run(files);
if (failures.length > 0) {
  console.error("ORCH-1255 public-venue-anon-safe gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1255 public-venue-anon-safe gate passed.");
