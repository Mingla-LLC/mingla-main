#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0963 — public brand page trip RPC + route segregation.
 *
 * C1/C3 from the original kind-branched gate were retired by
 * META-ORCH-0972 Sub-D because public tabs are now data-driven.
 *
 * Two assertions remain:
 *   1. publicEventsService.ts contains `pg_public_trips_by_brand` RPC call
 *   2. No file outside the allowlist uses positive `event_type === 'trip'`
 *      filter in client code (only the explicit rejection in
 *      fetchPublicBrandEvents + the trip-only resolver getPublicTripById are
 *      allowed).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SERVICE_FILE = path.join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "publicEventsService.ts",
);
const BUSINESS_SRC = path.join(REPO_ROOT, "mingla-business", "src");

let failed = 0;

function assertContains(file, needle, label) {
  if (!fs.existsSync(file)) {
    console.error(`FAIL [${label}] file not found: ${path.relative(REPO_ROOT, file)}`);
    failed++;
    return;
  }
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(needle)) {
    console.error(
      `FAIL [${label}] ${path.relative(REPO_ROOT, file)} missing required substring: ${JSON.stringify(needle)}`,
    );
    failed++;
  } else {
    console.log(`OK   [${label}] ${path.relative(REPO_ROOT, file)} contains ${JSON.stringify(needle.slice(0, 60))}`);
  }
}

// Assertion C2: publicEventsService.ts calls the public-trips RPC
assertContains(
  SERVICE_FILE,
  `pg_public_trips_by_brand`,
  "C2: publicEventsService calls pg_public_trips_by_brand RPC",
);

// Assertion C4: No positive `event_type === 'trip'` filter in client code outside the allowlist.
// Allowed sites (both already annotated with orch-strict-grep-allow markers):
//   - publicEventsService.ts:fetchPublicBrandEvents (NEGATIVE filter — rejects trips)
//   - publicEventsService.ts:getPublicTripById (trip-ONLY resolver — opposite scope, intentional)
//   - publicEventsService.ts:fetchPublicBrandTrips (new ORCH-0963 — but uses the RPC, no client-side filter)
const POSITIVE_TRIP_FILTER = /event_type\s*===\s*['"]trip['"]/;
const allowedFiles = new Set([
  // The public service file is the ORCH-0963 trip-fetch authority.
  path.join("mingla-business", "src", "services", "publicEventsService.ts"),
  // ORCH-0859 pre-existing: businessEvents.ts (organiser-side event list)
  // and routeForEventRow.ts (event-vs-trip route helper) carry the
  // canonical event-type-filter under I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE.
  // Both have `orch-strict-grep-allow events-type-filter` markers in source.
  path.join("mingla-business", "src", "services", "businessEvents.ts"),
  path.join("mingla-business", "src", "utils", "routeForEventRow.ts"),
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (
      entry.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx"))
    ) {
      out.push(full);
    }
  }
  return out;
}

const offenders = [];
for (const file of walk(BUSINESS_SRC)) {
  const rel = path.relative(REPO_ROOT, file);
  if (allowedFiles.has(rel)) continue;
  const src = fs.readFileSync(file, "utf8");
  if (POSITIVE_TRIP_FILTER.test(src)) {
    offenders.push(rel);
  }
}
if (offenders.length > 0) {
  console.error(
    `FAIL [C4: no-positive-event-type-trip-filter] offenders:\n${offenders
      .map((f) => `  - ${f}`)
      .join("\n")}`,
  );
  failed++;
} else {
  console.log(
    `OK   [C4: no-positive-event-type-trip-filter] no offenders outside allowlist`,
  );
}

if (failed > 0) {
  console.error(`\nORCH-0963 strict-grep: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nORCH-0963 strict-grep: 2/2 assertions PASS`);
