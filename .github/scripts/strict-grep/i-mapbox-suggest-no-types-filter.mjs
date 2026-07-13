#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1079 [Business-venue Google→Mapbox sweep]
 * INV-3 · I-MAPBOX-SUGGEST-NO-TYPES-FILTER
 *
 * The BUSINESS venue-name search in mapbox-geocode MUST stay filter-free. Adding
 * a `types` parameter (e.g. types=address) would exclude POIs and regress
 * venue-name search — the whole point of the sweep is that a brand can search a
 * venue/business BY NAME. Default types = ALL (POI included):
 *   https://docs.mapbox.com/api/search/search-box/#get-suggestions
 *
 * ── ORCH-1365 [location-search-relevance] — SCOPED, NOT WEAKENED ──────────────
 * [TEST-MOD-APPROVED ORCH-1365]
 * ORCH-1365 added an ADDITIVE consumer place-search action (`suggest_places`)
 * whose SEPARATE builder `buildPlaceSuggestUrl` DELIBERATELY carries
 * `&types=place,locality,…` + `&country=` to drop POI noise for the consumer
 * Preferences field. That is a DIFFERENT code path from the business
 * `suggest`/`buildSuggestUrl`. A whole-file `types=` scan would now false-fail on
 * the (correct, intended) consumer builder, so this gate is SCOPED to the
 * BUSINESS surface only — it still proves the business guarantee, and it is
 * NOT weakened:
 *   1. the business builder `buildSuggestUrl` body has NO `types`/`country`;
 *   2. the business handler `handleSuggest` NEVER calls `buildPlaceSuggestUrl`
 *      (the isolation wall — business must not borrow the filtered builder);
 *   3. the `handleForward` builder path is also asserted filter-free.
 * The consumer `buildPlaceSuggestUrl` / `handleSuggestPlaces` are intentionally
 * OUT of scope for the no-types assertion (they are supposed to filter).
 *
 * Target: supabase/functions/mapbox-geocode/index.ts
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detectors + scoping against fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const TARGET = path.join(
  REPO_ROOT,
  "supabase",
  "functions",
  "mapbox-geocode",
  "index.ts",
);

const TYPES_FILTER_RES = [
  /\btypes\s*[=:]\s*["'`]?(address|poi|place|category)/,
  /searchParams\.(set|append)\(\s*["']types["']/,
  /[?&]types=/,
];
const COUNTRY_FILTER_RES = [
  /searchParams\.(set|append)\(\s*["']country["']/,
  /[?&]country=/,
];

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`fs error reading ${filePath}: ${e.message}`);
    process.exit(2);
  }
}

/**
 * Extract a top-level function block by its signature. Skips the parameter list
 * FIRST (so a default-object param like `opts: SearchOpts = {}` doesn't get
 * mistaken for the body), then brace-matches the function BODY from its opening
 * `{` to the matching `}`. Balanced against template-literal `${…}` since those
 * braces are themselves balanced. Returns null when not found.
 */
function extractBlock(src, startRe) {
  const m = startRe.exec(src);
  if (!m) return null;
  const from = m.index;

  // 1. Paren-match the parameter list so its braces/defaults are skipped.
  const parenStart = src.indexOf("(", from);
  if (parenStart === -1) return null;
  let pdepth = 0;
  let afterParams = -1;
  for (let i = parenStart; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(") pdepth += 1;
    else if (ch === ")") {
      pdepth -= 1;
      if (pdepth === 0) {
        afterParams = i + 1;
        break;
      }
    }
  }
  if (afterParams === -1) return null;

  // 2. The function BODY opens at the first `{` after the params (past any
  //    `: ReturnType` annotation).
  const braceStart = src.indexOf("{", afterParams);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return null;
}

function hasTypesFilter(src) {
  return TYPES_FILTER_RES.some((re) => re.test(src));
}
function hasCountryFilter(src) {
  return COUNTRY_FILTER_RES.some((re) => re.test(src));
}

/**
 * The core check, run against the full file source. Returns an array of failure
 * strings (empty = pass). Used by both the live run and the self-test.
 */
function checkBusinessFilterFree(src) {
  const problems = [];

  const buildSuggest = extractBlock(
    src,
    /\bexport function buildSuggestUrl\s*\(/,
  );
  if (buildSuggest === null) {
    problems.push(
      "business builder `buildSuggestUrl` not found — cannot prove it is filter-free",
    );
  } else {
    if (hasTypesFilter(buildSuggest)) {
      problems.push(
        "buildSuggestUrl (business venue-name search) adds a `types` filter — excludes POIs, regresses venue-name search (ORCH-1079 §2.2)",
      );
    }
    if (hasCountryFilter(buildSuggest)) {
      problems.push(
        "buildSuggestUrl (business venue-name search) adds a `country` filter — over-restricts explore-anywhere business search (ORCH-1079 INV-3)",
      );
    }
  }

  const buildForward = extractBlock(
    src,
    /\bexport function buildForwardUrl\s*\(/,
  );
  if (buildForward !== null) {
    if (hasTypesFilter(buildForward) || hasCountryFilter(buildForward)) {
      problems.push(
        "buildForwardUrl adds a types/country filter — the forward path must stay filter-free (ORCH-1079 INV-3)",
      );
    }
  }

  // Isolation wall — the business handler must NOT borrow the filtered consumer
  // builder. `buildPlaceSuggestUrl` may appear ONLY inside handleSuggestPlaces.
  const handleSuggest = extractBlock(
    src,
    /\basync function handleSuggest\s*\(/,
  );
  if (handleSuggest === null) {
    problems.push("business handler `handleSuggest` not found");
  } else if (handleSuggest.includes("buildPlaceSuggestUrl")) {
    problems.push(
      "handleSuggest (business) calls buildPlaceSuggestUrl — the business path must use the filter-free buildSuggestUrl (ORCH-1365 isolation wall)",
    );
  }

  return problems;
}

function runSelfTest() {
  let selfFail = 0;
  const expect = (cond, msg) => {
    if (!cond) {
      console.error(`SELF-TEST FAIL: ${msg}`);
      selfFail += 1;
    }
  };

  // Detector unit behavior.
  const goodCall =
    `\`\${MAPBOX_SEARCHBOX_BASE}/suggest?q=\${q}&session_token=\${t}&access_token=\${k}&limit=5\``;
  expect(!hasTypesFilter(goodCall), "filter-free suggest call false-positive");
  expect(
    hasTypesFilter(`const url = "/suggest?q=" + q + "&types=address&limit=5";`),
    "&types=address not flagged",
  );
  expect(
    hasTypesFilter(`url.searchParams.set("types", "poi");`),
    "searchParams.set('types') not flagged",
  );
  expect(hasTypesFilter(`const u = "/suggest?types=poi&q=" + q;`), "?types=poi not flagged");
  expect(hasCountryFilter(`u += "&country=" + c;`), "&country= not flagged");

  // Scoping fixtures — a filter-free BUSINESS builder + a FILTERED consumer
  // builder in the SAME file must PASS (the ORCH-1365 world).
  const GOOD_FILE = `
export function buildSuggestUrl(base, token, q, st, opts = {}) {
  let url = \`\${base}/suggest?q=\${q}&session_token=\${st}&access_token=\${token}\`;
  if (opts.proximity) url += \`&proximity=\${opts.proximity}\`;
  url += \`&limit=5\`;
  return url;
}
export function buildPlaceSuggestUrl(base, token, q, st, opts = {}) {
  let url = \`\${base}/suggest?q=\${q}&session_token=\${st}&access_token=\${token}&types=place,locality\`;
  if (opts.country) url += \`&country=\${opts.country}\`;
  return url;
}
async function handleSuggest(token, q, st, opts = {}) {
  const url = buildSuggestUrl(BASE, token, q, st, opts);
  return url;
}
async function handleSuggestPlaces(token, q, st, opts = {}) {
  const url = buildPlaceSuggestUrl(BASE, token, q, st, opts);
  return url;
}`;
  expect(
    checkBusinessFilterFree(GOOD_FILE).length === 0,
    "scoped gate false-fails on the correct ORCH-1365 shape (filtered consumer builder is out of scope)",
  );

  // BAD #1 — a types filter LEAKS into the business builder → must FAIL.
  const BAD_BUSINESS_TYPES = GOOD_FILE.replace(
    "url += `&limit=5`;",
    "url += `&types=address&limit=5`;",
  );
  expect(
    checkBusinessFilterFree(BAD_BUSINESS_TYPES).length > 0,
    "types filter in buildSuggestUrl not caught (business guarantee broken)",
  );

  // BAD #2 — business handler borrows the filtered consumer builder → must FAIL.
  const BAD_ISOLATION = GOOD_FILE.replace(
    "const url = buildSuggestUrl(BASE, token, q, st, opts);",
    "const url = buildPlaceSuggestUrl(BASE, token, q, st, opts);",
  );
  expect(
    checkBusinessFilterFree(BAD_ISOLATION).length > 0,
    "handleSuggest calling buildPlaceSuggestUrl not caught (isolation wall broken)",
  );

  // BAD #3 — country filter LEAKS into the business builder → must FAIL.
  const BAD_BUSINESS_COUNTRY = GOOD_FILE.replace(
    "if (opts.proximity) url += `&proximity=${opts.proximity}`;",
    "if (opts.country) url += `&country=${opts.country}`;",
  );
  expect(
    checkBusinessFilterFree(BAD_BUSINESS_COUNTRY).length > 0,
    "country filter in buildSuggestUrl not caught",
  );

  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log(
    "SELF-TEST OK: I-MAPBOX-SUGGEST-NO-TYPES-FILTER detectors + ORCH-1365 scoping behave",
  );
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

if (!fs.existsSync(TARGET)) {
  fail(
    "INV-3: target-present",
    `mapbox-geocode/index.ts missing at ${path.relative(REPO_ROOT, TARGET)}`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

const src = readSource(TARGET);
const problems = checkBusinessFilterFree(src);
if (problems.length > 0) {
  for (const p of problems) fail("INV-3: business-no-types-filter", p);
} else {
  ok(
    "INV-3: business-no-types-filter",
    "business suggest/forward builders are filter-free + handleSuggest does not borrow the consumer place builder (POIs resolve by name)",
  );
}

process.exit(failures > 0 ? 1 : 0);
