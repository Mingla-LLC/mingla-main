#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1235
 * I-PROPOSED-1235-A — full-screen-spinner-gating services use `withTimeout`.
 *
 * WHY: business web data fetches had no settle-guarantee. A Supabase read that
 * hangs (never resolves/errors) pins a full-screen `if (isLoading) <Spinner/>`
 * gate forever; only a reload recovers. The fix wraps every gating fetch at the
 * service layer in `withTimeout(..., DATA_FETCH_TIMEOUT_MS | AUTH_PROBE_TIMEOUT_MS, label)`
 * so a never-settling read becomes a bounded error+Retry.
 *
 * THIS GATE: for each {file, fnName} in the authoritative registry below,
 * extract the fn body and assert it (a) references `withTimeout(` and (b) the
 * file imports from `utils/withTimeout`. A revert (raw `supabase.from(...)`
 * await with no withTimeout) fails CI.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. Self-test (--self-test).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Authoritative registry — every full-screen-spinner-gating service fn (SPEC §2.3).
const REGISTRY = [
  { rel: "mingla-business/src/services/brandsService.ts", fn: "getBrand" },
  { rel: "mingla-business/src/services/brandsService.ts", fn: "getBrands" },
  {
    rel: "mingla-business/src/services/experiencesService.ts",
    fn: "getExperiencesByBrand",
  },
  { rel: "mingla-business/src/services/tripsService.ts", fn: "getTripsByBrand" },
  {
    rel: "mingla-business/src/services/marketing/marketingOverviewService.ts",
    fn: "getMarketingOverview",
  },
];

const IMPORT_RE = /from\s+["'][^"']*utils\/withTimeout["']/;
const WITHTIMEOUT_RE = /withTimeout\s*\(/;

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

// Extract a fn body from the `export ... function <fn>(` declaration to the next
// top-level `\nasync function `, `\nexport ` or `\nfunction ` boundary.
function fnBody(src, fn) {
  const declRe = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${fn}\\s*\\(`,
  );
  const m = declRe.exec(src);
  if (m === null) return null;
  const start = m.index;
  const rest = src.slice(start + m[0].length);
  const boundaries = [
    rest.indexOf("\nasync function "),
    rest.indexOf("\nexport async function "),
    rest.indexOf("\nexport function "),
    rest.indexOf("\nfunction "),
  ].filter((n) => n >= 0);
  const cut = boundaries.length ? Math.min(...boundaries) : -1;
  return cut === -1
    ? src.slice(start)
    : src.slice(start, start + m[0].length + cut);
}

function runSelfTest() {
  let f = 0;
  const goodFile = `
    import { withTimeout, DATA_FETCH_TIMEOUT_MS } from "../utils/withTimeout";
    export async function getBrand(brandId) {
      const { data } = await withTimeout(supabase.from("brands").select("*").maybeSingle(), DATA_FETCH_TIMEOUT_MS, "getBrand:read");
      return data;
    }
  `;
  const badFile = `
    export async function getBrand(brandId) {
      const { data } = await supabase.from("brands").select("*").maybeSingle();
      return data;
    }
  `;
  const gb = fnBody(stripComments(goodFile), "getBrand");
  const bb = fnBody(stripComments(badFile), "getBrand");
  if (!WITHTIMEOUT_RE.test(gb) || !IMPORT_RE.test(stripComments(goodFile))) {
    console.error("SELF-TEST FAIL: good getBrand not detected as time-boxed");
    f++;
  }
  if (WITHTIMEOUT_RE.test(bb) || IMPORT_RE.test(stripComments(badFile))) {
    console.error("SELF-TEST FAIL: reverted getBrand falsely matched withTimeout");
    f++;
  }
  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1235-A detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

for (const { rel, fn } of REGISTRY) {
  const raw = read(rel);
  const src = stripComments(raw);
  if (!IMPORT_RE.test(src)) {
    fail(`${fn}-import`, `${rel} does not import from utils/withTimeout`);
  } else {
    ok(`${fn}-import`, `${rel} imports withTimeout`);
  }
  const body = fnBody(src, fn);
  if (body === null) {
    fail(`${fn}-present`, `${fn} not found in ${rel}`);
    continue;
  }
  if (WITHTIMEOUT_RE.test(body)) {
    ok(`${fn}-timeboxed`, `${fn} wraps its network await(s) in withTimeout`);
  } else {
    fail(
      `${fn}-timeboxed`,
      `${fn} (${rel}) has no withTimeout(...) — a hung read can freeze a full-screen spinner. Restore the settle-guarantee.`,
    );
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1235-A: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1235-A: PASS · violations=0");
process.exit(0);
