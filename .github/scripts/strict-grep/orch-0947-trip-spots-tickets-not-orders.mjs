#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-0947 [Trip dashboard Spots tile counts tickets,
 * not orders].
 *
 * Enforces I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE for the planner dashboard:
 * `travelersCount` must not reappear in trip/[id]/index.tsx because that
 * identifier represented client-side order counts, not seat-holding tickets.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DASHBOARD = path.join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "trip",
  "[id]",
  "index.tsx",
);

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`FATAL: could not read ${filePath}: ${err.message}`);
    process.exit(2);
  }
}

const source = readSource(DASHBOARD);
const offenders = source
  .split("\n")
  .map((line, index) => ({ line, lineNumber: index + 1 }))
  .filter(({ line }) => line.includes("travelersCount"));

if (offenders.length > 0) {
  console.error(
    "FAIL [ORCH-0947] trip dashboard must use trip.ticketsSoldCount, not travelersCount order-count semantics:",
  );
  for (const offender of offenders) {
    console.error(`  L${offender.lineNumber}: ${offender.line.trim()}`);
  }
  process.exit(1);
}

console.log(
  "OK   [ORCH-0947] trip dashboard has no travelersCount order-count path",
);
