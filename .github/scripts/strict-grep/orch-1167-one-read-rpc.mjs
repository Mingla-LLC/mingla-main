#!/usr/bin/env node
/**
 * ORCH-1167 [event-page-canonical] — I-PROPOSED-1167-ONE-READ-RPC.
 *
 * All surfaces read the canonical standard-event public page body fields via the
 * ONE RPC `pg_direct_event_checkout_bundle` (SC-7: a field added to the RPC surfaces on all
 * surfaces with one mapper edit). This gate asserts:
 *   • the buyer-web/business service (mingla-business/src/services/publicEventsService.ts)
 *     enters the exact slug/UUID pipeline through the direct bundle, with only
 *     the #1929 SQL-NULL/RSVP compatibility fallback, AND
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

const RPC_RE = /\.rpc\(\s*["']pg_direct_event_checkout_bundle["']/;
const LEGACY_CONSUMER_READ_RE = /\.rpc\(\s*["'](?:pg_public_event_by_slug|pg_public_event_tier_allin|pg_public_ticket_types_remaining)["']|\.from\(\s*["'](?:business_public_events_view|ticket_types)["']/;

function checkFile(src, label) {
  const failures = [];
  if (!RPC_RE.test(src)) {
    failures.push(
      `${label}: does not call supabase.rpc("pg_direct_event_checkout_bundle", …). The ` +
        "standard-event page body MUST read the ONE canonical RPC (SC-7).",
    );
  }
  if (label === "consumer hook" && LEGACY_CONSUMER_READ_RE.test(src)) {
    failures.push(`${label}: parallel legacy standard-event read reintroduced.`);
  }
  if (label === "web/business service") {
    const start = src.indexOf("const isDirectEventBundle");
    const end = src.indexOf("export const fetchPublicBrandEvents", start);
    const pipeline = start >= 0 && end > start ? src.slice(start, end) : src;
    const rpc = pipeline.indexOf('supabase.rpc("pg_direct_event_checkout_bundle"');
    const fallback = pipeline.indexOf('if (data === null) return "fallback"');
    const view = pipeline.indexOf('.from("business_public_events_view")');
    if (!(rpc >= 0 && fallback > rpc && view > fallback)) {
      failures.push(`${label}: bundle-first / SQL-NULL-only fallback ordering changed.`);
    }
    if (!pipeline.includes('row.event_type !== "rsvp"') ||
        !pipeline.includes('row.event_type === "rsvp" ? detailFromRow(row) : null')) {
      failures.push(`${label}: exact RSVP-only fallback admission changed.`);
    }
  }
  return failures;
}

function runSelfTest() {
  const goodConsumer = `const { data } = await supabase.rpc("pg_direct_event_checkout_bundle", { p_brand_slug });`;
  const goodBusiness = `
    const isDirectEventBundle = () => true;
    await supabase.rpc("pg_direct_event_checkout_bundle", {});
    if (data === null) return "fallback";
    supabase.from("business_public_events_view");
    if (row.event_type !== "rsvp") return null;
    return row.event_type === "rsvp" ? detailFromRow(row) : null;
    export const fetchPublicBrandEvents = () => null;
  `;
  const goodPasses = checkFile(goodConsumer, "consumer hook").length === 0 &&
    checkFile(goodBusiness, "web/business service").length === 0;
  const badMutations = [
    goodConsumer.replace("pg_direct_event_checkout_bundle", "pg_public_event_by_slug"),
    `${goodConsumer}\nsupabase.from("business_public_events_view")`,
    `${goodConsumer}\nsupabase.from("ticket_types")`,
    goodBusiness.replace(
      'await supabase.rpc("pg_direct_event_checkout_bundle", {});',
      'supabase.from("business_public_events_view");\nawait supabase.rpc("pg_direct_event_checkout_bundle", {});',
    ),
    goodBusiness.replace('row.event_type !== "rsvp"', 'row.event_type !== "event"'),
    goodBusiness.replace('row.event_type === "rsvp" ? detailFromRow(row) : null', "detailFromRow(row)"),
  ];
  const badFails = badMutations.every((bad, index) =>
    checkFile(bad, index < 3 ? "consumer hook" : "web/business service").length > 0,
  );
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
