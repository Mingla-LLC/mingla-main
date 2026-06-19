#!/usr/bin/env node
/**
 * ORCH-1167 [event-page-canonical] — I-PROPOSED-1167-ONE-READ-RPC.
 *
 * All surfaces read the canonical standard-event public page body fields via the
 * ONE RPC `pg_public_event_by_slug` (SC-7: a field added to the RPC surfaces on all
 * surfaces with one mapper edit). This gate asserts:
 *   • the buyer-web/business service (mingla-business/src/services/publicEventsService.ts)
 *     calls supabase.rpc("pg_public_event_by_slug", …) for the standard-event body
 *     fields (fetchCanonicalEventBodyFields), AND
 *   • the consumer hook (app-mobile/src/hooks/usePublicEventBySlug.ts) calls it too.
 *
 * Fails if either surface no longer reads the RPC (a divergent read was reintroduced
 * for the standard-event page body). Self-test proves a stripped reader trips it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SURFACES = [
  {
    label: "web/business service",
    file: "mingla-business/src/services/publicEventsService.ts",
  },
  {
    label: "consumer hook",
    file: "app-mobile/src/hooks/usePublicEventBySlug.ts",
  },
];

const RPC_RE = /\.rpc\(\s*["']pg_public_event_by_slug["']/;

function checkFile(src, label) {
  return RPC_RE.test(src)
    ? []
    : [
        `${label}: does not call supabase.rpc("pg_public_event_by_slug", …). The ` +
          "standard-event page body MUST read the ONE canonical RPC (SC-7).",
      ];
}

function runSelfTest() {
  const good = `const { data } = await supabase.rpc("pg_public_event_by_slug", { p_brand_slug });`;
  const bad = `const { data } = await supabase.from("business_public_events_view").select("*");`;
  const goodPasses = checkFile(good, "synthetic-good").length === 0;
  const badFails = checkFile(bad, "synthetic-bad").length > 0;
  if (!goodPasses) {
    console.error("SELF-TEST FAIL: RPC reader wrongly tripped the gate.");
    process.exit(1);
  }
  if (!badFails) {
    console.error("SELF-TEST FAIL: non-RPC reader did not trip the gate.");
    process.exit(1);
  }
  console.log("ORCH-1167 one-read-rpc gate SELF-TEST PASS.");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const failures = [];
  for (const { label, file } of SURFACES) {
    const path = join(root, file);
    if (!existsSync(path)) {
      failures.push(`${label}: ${file} missing.`);
      continue;
    }
    failures.push(...checkFile(readFileSync(path, "utf8"), label));
  }
  if (failures.length > 0) {
    console.error("\nORCH-1167 one-read-rpc gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("ORCH-1167 one-read-rpc gate PASS.");
}
