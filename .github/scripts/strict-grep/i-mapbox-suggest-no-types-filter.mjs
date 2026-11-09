#!/usr/bin/env node
/* eslint-disable no-console */
// MINGLA-INVARIANT: I-ADDRESS-SUGGEST-NO-TYPE-FILTER | issue #4334 | The Host address suggest request carries no types, country or limit filter; ranking comes from proximity bias only.
/**
 * Strict-grep gate — ORCH-1079 INV-3, Google since #4334
 * I-ADDRESS-SUGGEST-NO-TYPE-FILTER
 *
 * The Host address search (`suggest`) serves venue-NAME search, so it must stay
 * filter-free: Google `places:autocomplete` with no `includedPrimaryTypes` and
 * no `includedRegionCodes`. The Explorer place search (`suggest_places`) keeps
 * its area filter in its OWN builder.
 *
 * Checks in supabase/functions/mapbox-geocode/google.ts:
 *   1. the body of `buildSuggestBody` contains neither filter;
 *   2. `handleSuggest` never calls `buildPlaceSuggestBody`;
 *   3. index.ts routes `case "suggest"` to `handleSuggest`.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. --self-test validates the detector.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GOOGLE = path.join(REPO_ROOT, "supabase/functions/mapbox-geocode/google.ts");
const INDEX = path.join(REPO_ROOT, "supabase/functions/mapbox-geocode/index.ts");
const FILTER_RE = /includedPrimaryTypes|includedRegionCodes/;

export function functionBody(src, name) {
  const start = src.indexOf(`export function ${name}(`) >= 0
    ? src.indexOf(`export function ${name}(`)
    : src.indexOf(`export async function ${name}(`);
  if (start < 0) return null;
  const next = src.slice(start + 10).search(/\nexport (async )?function /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 10 + next);
}

export function check(googleSrc, indexSrc) {
  const problems = [];
  const suggestBody = functionBody(googleSrc, "buildSuggestBody");
  if (suggestBody === null) problems.push("buildSuggestBody missing");
  else if (FILTER_RE.test(suggestBody)) problems.push("buildSuggestBody adds a type/region filter");
  const handle = functionBody(googleSrc, "handleSuggest");
  if (handle === null) problems.push("handleSuggest missing");
  else if (/buildPlaceSuggestBody/.test(handle)) problems.push("handleSuggest uses the place-search builder");
  if (!/case "suggest":\s*\n\s*return handleSuggest\(/.test(indexSrc)) problems.push('case "suggest" is not routed to handleSuggest');
  return problems;
}

if (process.argv.includes("--self-test")) {
  const good = `export function buildSuggestBody(p) {\n  return { input: p.input };\n}\nexport async function handleSuggest(k) {\n  buildSuggestBody({});\n}\n`;
  const goodIndex = `    case "suggest":\n      return handleSuggest(key);`;
  const bad = good.replace("{ input: p.input }", "{ input: p.input, includedPrimaryTypes: [] }");
  const bad2 = good.replace("buildSuggestBody({});", "buildPlaceSuggestBody({});");
  const results = [check(good, goodIndex).length === 0, check(bad, goodIndex).length === 1, check(bad2, goodIndex).length === 1, check(good, `case "suggest": return handleSuggestPlaces(k)`).length === 1];
  if (results.every(Boolean)) {
    console.log("SELF-TEST OK: I-ADDRESS-SUGGEST-NO-TYPE-FILTER detector behaves");
    process.exit(0);
  }
  console.error(`SELF-TEST FAIL: ${JSON.stringify(results)}`);
  process.exit(1);
}

let googleSrc;
let indexSrc;
try {
  googleSrc = fs.readFileSync(GOOGLE, "utf8");
  indexSrc = fs.readFileSync(INDEX, "utf8");
} catch (e) {
  console.error(`fs error: ${e.message}`);
  process.exit(2);
}
const problems = check(googleSrc, indexSrc);
for (const p of problems) console.error(`FAIL [I-ADDRESS-SUGGEST-NO-TYPE-FILTER] ${p}`);
if (problems.length === 0) console.log("OK   [I-ADDRESS-SUGGEST-NO-TYPE-FILTER] Host suggest is filter-free");
process.exit(problems.length > 0 ? 1 : 0);
