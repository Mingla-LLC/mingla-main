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

const ownedRegion = (src, startNeedle, endNeedle) => {
  const start = src.indexOf(startNeedle);
  const nextStart = src.indexOf(startNeedle, start + 1);
  const end = src.indexOf(endNeedle);
  const nextEnd = src.indexOf(endNeedle, end + 1);
  if (start < 0 || end <= start || nextStart >= 0 || nextEnd >= 0) return null;
  return src.slice(start, end);
};

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
    const payloadHelper = ownedRegion(
      src,
      "const fetchDirectEventBundlePayload = async",
      "const readDirectEventBundle = async",
    );
    const readerHelper = ownedRegion(
      src,
      "const readDirectEventBundle = async",
      "export const getPublicEventBySlug = async",
    );
    const downstream = ownedRegion(
      src,
      "export const getPublicEventBySlug = async",
      "export const fetchPublicBrandEvents = async",
    );
    if (payloadHelper === null || readerHelper === null || downstream === null) {
      failures.push(
        `${label}: staged bundle helper boundaries missing, reordered, or ambiguous ` +
        `(payload=${payloadHelper !== null}, reader=${readerHelper !== null}, downstream=${downstream !== null}).`,
      );
      return failures;
    }

    const rpc = payloadHelper.search(RPC_RE);
    const errorThrow = payloadHelper.search(/if\s*\(\s*error(?:\s*!==\s*null)?\s*\)\s*throw\s+error\s*;/);
    const dataNull = payloadHelper.search(/if\s*\(\s*data\s*===\s*null\s*\)\s*return\s+null\s*;/);
    const validation = payloadHelper.search(/if\s*\(\s*!isDirectEventBundle\(\s*data\s*\)\s*\)/);
    const invalid = payloadHelper.indexOf('"invalid_direct_event_checkout_bundle"');
    const validReturn = payloadHelper.search(/return\s+data\s*;/);
    if (!(rpc >= 0 && errorThrow > rpc && dataNull > errorThrow && validation > dataNull && invalid > validation && validReturn > invalid)) {
      failures.push(`${label}: payload helper RPC/error/null/validation ordering changed.`);
    }
    if (/data\s*===\s*null[^;{}]*["']fallback["']/.test(payloadHelper)) {
      failures.push(`${label}: payload helper must return null, never fallback, for SQL NULL.`);
    }

    const payloadCall = readerHelper.search(/fetchDirectEventBundlePayload\(\s*args\s*\)/);
    const stagedReader = /return\s+payload\s*===\s*null\s*\?\s*["']fallback["']\s*:\s*detailFromDirectBundle\(\s*payload\s*\)\s*;/.test(readerHelper) ||
      /if\s*\(\s*payload\s*===\s*null\s*\)\s*return\s+["']fallback["']\s*;\s*return\s+detailFromDirectBundle\(\s*payload\s*\)\s*;/.test(readerHelper);
    if (payloadCall < 0 || !stagedReader) {
      failures.push(`${label}: reader helper must map only literal payload null to fallback.`);
    }

    const directRead = downstream.search(/readDirectEventBundle\s*\(/);
    const fallbackDecision = downstream.search(/if\s*\(\s*direct\s*!==\s*["']fallback["']\s*\)\s*return\s+direct\s*;/);
    const view = downstream.search(/\.from\(\s*["']business_public_events_view["']\s*\)/);
    if (!(directRead >= 0 && fallbackDecision > directRead && view > fallbackDecision)) {
      failures.push(`${label}: bundle reader fallback must precede the legacy view.`);
    }
    if (!downstream.includes('row.event_type !== "rsvp"') ||
        !downstream.includes('row.event_type === "rsvp" ? detailFromRow(row) : null')) {
      failures.push(`${label}: exact RSVP-only fallback admission changed.`);
    }
  }
  return failures;
}

function runSelfTest() {
  const goodConsumer = `const { data } = await supabase.rpc("pg_direct_event_checkout_bundle", { p_brand_slug });`;
  const goodBusiness = `
    const fetchDirectEventBundlePayload = async (args) => {
      const { data, error } = await supabase.rpc("pg_direct_event_checkout_bundle", args);
      if (error !== null) throw error;
      if (data === null) return null;
      if (!isDirectEventBundle(data)) {
        throw new Error("invalid_direct_event_checkout_bundle");
      }
      return data;
    };
    const readDirectEventBundle = async (args) => {
      const payload = await fetchDirectEventBundlePayload(args);
      return payload === null ? "fallback" : detailFromDirectBundle(payload);
    };
    export const getPublicEventBySlug = async () => {
      const direct = await readDirectEventBundle({});
      if (direct !== "fallback") return direct;
      supabase.from("business_public_events_view");
      if (row.event_type !== "rsvp") return null;
      return row.event_type === "rsvp" ? detailFromRow(row) : null;
    };
    export const fetchPublicBrandEvents = async () => null;
  `;
  const goodFailures = [
    ...checkFile(goodConsumer, "consumer hook"),
    ...checkFile(goodBusiness, "web/business service"),
  ];
  const goodPasses = goodFailures.length === 0;
  const badMutations = [
    goodConsumer.replace("pg_direct_event_checkout_bundle", "pg_public_event_by_slug"),
    `${goodConsumer}\nsupabase.from("business_public_events_view")`,
    `${goodConsumer}\nsupabase.from("ticket_types")`,
    goodBusiness.replace("pg_direct_event_checkout_bundle", "pg_public_event_by_slug"),
    goodBusiness.replace(
      "if (error !== null) throw error;\n      if (data === null) return null;",
      "if (data === null) return null;\n      if (error !== null) throw error;",
    ),
    goodBusiness.replace("if (data === null) return null;", 'if (data === null) return "fallback";'),
    goodBusiness.replace("if (!isDirectEventBundle(data)) {", "if (data) {"),
    goodBusiness.replace('throw new Error("invalid_direct_event_checkout_bundle");', "return null;"),
    goodBusiness.replace('return payload === null ? "fallback" : detailFromDirectBundle(payload);', 'return payload ? detailFromDirectBundle(payload) : "fallback";'),
    goodBusiness.replace(
      "if (data === null) return null;",
      "if (false) return null;",
    ).replace(
      "const readDirectEventBundle = async (args) => {",
      "if (data === null) return null;\n    const readDirectEventBundle = async (args) => {",
    ),
    goodBusiness.replace(
      'return payload === null ? "fallback" : detailFromDirectBundle(payload);',
      'return payload ? detailFromDirectBundle(payload) : "fallback";',
    ).replace(
      "export const getPublicEventBySlug = async () => {",
      'if (payload === null) return "fallback";\n    export const getPublicEventBySlug = async () => {',
    ),
    goodBusiness.replace(
      'const direct = await readDirectEventBundle({});\n      if (direct !== "fallback") return direct;\n      supabase.from("business_public_events_view");',
      'supabase.from("business_public_events_view");\n      const direct = await readDirectEventBundle({});\n      if (direct !== "fallback") return direct;',
    ),
    goodBusiness.replace('row.event_type !== "rsvp"', 'row.event_type !== "event"'),
    goodBusiness.replace('row.event_type === "rsvp" ? detailFromRow(row) : null', "detailFromRow(row)"),
  ];
  const badFails = badMutations.every((bad, index) =>
    checkFile(bad, index < 3 ? "consumer hook" : "web/business service").length > 0,
  );
  if (!goodPasses) {
    console.error("SELF-TEST FAIL: RPC reader wrongly tripped the gate.");
    for (const failure of goodFailures) console.error(`  ${failure}`);
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
