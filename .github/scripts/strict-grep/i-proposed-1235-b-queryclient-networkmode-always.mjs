#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1235
 * I-PROPOSED-1235-B — queryClient `networkMode: "always"`.
 *
 * WHY: React Query's default `networkMode: "online"` lets a
 * `navigator.onLine === false` flap leave a never-fetched query in
 * `fetchStatus: "paused"` with `isLoading` stuck true and no attempt/error — an
 * indefinite spinner with nothing to retry. `networkMode: "always"` forces the
 * query to run regardless of `navigator.onLine`, so a flap can never pause-stick
 * it; combined with withTimeout, a dead network surfaces a bounded error+retry.
 *
 * THIS GATE: assert `mingla-business/src/config/queryClient.ts` sets
 * `networkMode: "always"` inside its `queries` defaults (comments stripped).
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. Self-test (--self-test).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REL = "mingla-business/src/config/queryClient.ts";

const NETWORK_MODE_RE = /networkMode\s*:\s*["']always["']/;

let failures = 0;
const fail = (check, msg) => {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
};
const ok = (check, msg) => console.log(`OK   [${check}] ${msg}`);

function read(rel) {
  const abs = path.join(REPO_ROOT, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    console.error(`fs error reading ${rel}: ${e.message}`);
    process.exit(2);
  }
}
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function runSelfTest() {
  let f = 0;
  const good = stripComments(`
    queries: { staleTime: 1, networkMode: "always", retry: 2 }
  `);
  const bad = stripComments(`
    queries: { staleTime: 1, retry: 2 }
  `);
  if (!NETWORK_MODE_RE.test(good)) {
    console.error("SELF-TEST FAIL: good queryClient not detected");
    f++;
  }
  if (NETWORK_MODE_RE.test(bad)) {
    console.error("SELF-TEST FAIL: reverted queryClient falsely matched");
    f++;
  }
  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1235-B detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

const src = stripComments(read(REL));
if (NETWORK_MODE_RE.test(src)) {
  ok("networkmode-always", `${REL} sets networkMode: "always"`);
} else {
  fail(
    "networkmode-always",
    `${REL} does NOT set networkMode: "always" — an online flap can pause-stick a query with isLoading stuck true and no error. Restore it.`,
  );
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1235-B: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1235-B: PASS · violations=0");
process.exit(0);
