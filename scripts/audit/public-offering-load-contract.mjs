#!/usr/bin/env node
/**
 * #426 G1 — Regression contract: public offering load harness present.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const REQUIRED = [
  "scripts/load/public-event-bundle.js",
  "scripts/load/public-trip-read.js",
  "scripts/load/public-experience-read.js",
  "scripts/load/public-offering-fanout.js",
  "scripts/load/lib/public-read.js",
  "mingla-business/api/trip-checkout-bundle.js",
  "mingla-business/api/experience-checkout-bundle.js",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const rel of REQUIRED) {
  if (!existsSync(join(ROOT, rel))) fail(`missing ${rel}`);
}

const validate = readFileSync(join(ROOT, "scripts/load/validate-k6-scripts.mjs"), "utf8");
for (const name of [
  "public-event-bundle.js",
  "public-trip-read.js",
  "public-experience-read.js",
  "public-offering-fanout.js",
]) {
  if (!validate.includes(`"${name}"`)) {
    fail(`validate-k6-scripts.mjs must require ${name}`);
  }
}

const runStaging = readFileSync(join(ROOT, "scripts/load/run-staging.sh"), "utf8");
if (!runStaging.includes("public-event-bundle")) {
  fail("run-staging.sh must alias public-event-bundle");
}

const tripApi = readFileSync(
  join(ROOT, "mingla-business/api/trip-checkout-bundle.js"),
  "utf8",
);
if (!tripApi.includes("s-maxage=${CACHE_SECONDS}") && !tripApi.includes("s-maxage=")) {
  fail("trip-checkout-bundle must set s-maxage cache");
}
if (!tripApi.includes("pg_public_trip_by_slug")) {
  fail("trip-checkout-bundle must call pg_public_trip_by_slug");
}

const expApi = readFileSync(
  join(ROOT, "mingla-business/api/experience-checkout-bundle.js"),
  "utf8",
);
if (!expApi.includes("pg_public_experience_by_slug")) {
  fail("experience-checkout-bundle must call pg_public_experience_by_slug");
}

console.log("PASS: public offering load contract (#426)");
process.exit(0);
