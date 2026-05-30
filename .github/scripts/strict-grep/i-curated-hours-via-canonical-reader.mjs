#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * I-CURATED-HOURS-VIA-CANONICAL-READER (ORCH-1019 invariant)
 *
 * Every opening-hours / availability check in `app-mobile/` MUST read hours via
 * `extractWeekdayText(openingHours)` and evaluate open/closed via
 * `isPlaceOpenAt(...)` from `openingHoursUtils.ts`. No code under
 * `app-mobile/src` may index an `openingHours` value by a weekday name
 * (`openingHours[dayName]`, `openingHours?.["Saturday"]`, `oh[weekday]`, etc.).
 *
 * Established after ORCH-1019: SavedTab's bespoke day-key parser
 * (`stop.openingHours?.[dayName]`) returned false-OK ("All Stops Are Open!")
 * on the Google Places v1 `weekdayDescriptions` shape — the day key was never
 * present at runtime, so every stop reported open.
 *
 * Scope: app-mobile/src (.ts + .tsx), skipping __tests__, node_modules, and
 * openingHoursUtils.ts itself (the canonical reader legitimately maps day
 * records internally).
 *
 * Self-test (`--self-test`): plant `openingHours["Monday"]` → must match
 * (would-fail); a canonical `extractWeekdayText(openingHours)` line → must NOT
 * match. Exits 1 if either expectation is wrong.
 *
 * Exit codes:
 *   0 — clean tree (or self-test passed)
 *   1 — a forbidden day-key lookup matched (or self-test failed)
 *   2 — file system error
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCAN_ROOT = path.join(REPO_ROOT, "app-mobile", "src");

const DAY_NAMES =
  "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";

// Forbidden patterns: a member/computed access on an identifier ending in
// openingHours / opening_hours keyed by a weekday literal or a day-typed var.
const FORBIDDEN = [
  // computed access with a string-literal weekday, e.g. openingHours["Monday"]
  {
    name: "openingHours[\"<Weekday>\"] literal",
    regex: new RegExp(
      `\\bopening_?[Hh]ours\\s*\\??\\.?\\s*\\[\\s*['"\`](?:${DAY_NAMES})['"\`]\\s*\\]`,
      "i",
    ),
  },
  // optional-chained literal day property, e.g. openingHours?.Saturday
  {
    name: "openingHours?.<Weekday> property",
    regex: new RegExp(
      `\\bopening_?[Hh]ours\\s*\\?\\.\\s*(?:${DAY_NAMES})\\b`,
      "i",
    ),
  },
  // computed access keyed by a day-name-ish variable, e.g.
  //   openingHours?.[dayName] / openingHours[weekday] / openingHours[day]
  {
    name: "openingHours[<dayName|weekday|day>] variable",
    regex:
      /\bopening_?[Hh]ours\s*\??\.?\s*\[\s*(?:dayName|weekday|weekdayName|day)\s*\]/i,
  },
];

// Self-test ------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const shouldMatch = [
    `const h = stop.openingHours?.["Monday"];`,
    `const h = stop.openingHours["Saturday"];`,
    `const h = openingHours?.Saturday;`,
    `const h = stop.openingHours?.[dayName];`,
    `const h = openingHours[weekday];`,
  ];
  const shouldNotMatch = [
    `const wt = extractWeekdayText(stop.openingHours);`,
    `openingHours: entry.experience?.openingHours,`,
    `const open = isPlaceOpenAt(weekdayText, arrivalTime, utcOffset);`,
    `const offset = stop.utcOffsetMinutes ?? null;`,
  ];
  let ok = true;
  for (const line of shouldMatch) {
    const hit = FORBIDDEN.some((p) => p.regex.test(line));
    if (!hit) {
      console.error(`SELF-TEST FAIL: expected a match but got none → ${line}`);
      ok = false;
    }
  }
  for (const line of shouldNotMatch) {
    const hit = FORBIDDEN.some((p) => p.regex.test(line));
    if (hit) {
      console.error(`SELF-TEST FAIL: expected NO match but matched → ${line}`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log("i-curated-hours-via-canonical-reader self-test PASSED");
  process.exit(0);
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      entry.name !== "openingHoursUtils.ts"
    ) {
      yield full;
    }
  }
}

const violations = [];
let filesScanned = 0;

try {
  if (!fs.existsSync(SCAN_ROOT)) {
    console.error(`MISSING SCAN ROOT: ${path.relative(REPO_ROOT, SCAN_ROOT)}`);
    process.exit(2);
  }
  for (const file of walk(SCAN_ROOT)) {
    filesScanned++;
    const source = fs.readFileSync(file, "utf8");
    // strip block comments, then per-line strip line comments
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const lines = stripped.split(/\r?\n/);
    lines.forEach((raw, index) => {
      const noLineComment = raw.replace(/\/\/.*$/, "");
      for (const { name, regex } of FORBIDDEN) {
        if (regex.test(noLineComment)) {
          violations.push({
            file: path.relative(REPO_ROOT, file),
            line: index + 1,
            pattern: name,
            text: raw.trim(),
          });
        }
      }
    });
  }
} catch (err) {
  console.error(`FILE SYSTEM ERROR: ${err.message}`);
  process.exit(2);
}

if (violations.length > 0) {
  console.error(
    "I-CURATED-HOURS-VIA-CANONICAL-READER violation: read openingHours via",
  );
  console.error(
    "extractWeekdayText() + isPlaceOpenAt() (openingHoursUtils.ts) — never index",
  );
  console.error("a weekday key directly on an openingHours value.");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.pattern}]  ${v.text}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} file(s) under app-mobile/src; found ${violations.length} violation(s).`,
  );
  console.error(
    "See I-CURATED-HOURS-VIA-CANONICAL-READER in INVARIANT_REGISTRY.md (ORCH-1019).",
  );
  process.exit(1);
}

console.log(
  `i-curated-hours-via-canonical-reader OK: scanned ${filesScanned} file(s) under app-mobile/src; no direct openingHours day-key lookup found.`,
);
process.exit(0);
