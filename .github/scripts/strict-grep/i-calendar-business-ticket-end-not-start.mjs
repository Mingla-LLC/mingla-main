#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate for I-CALENDAR-BUSINESS-TICKET-END-NOT-START.
 *
 * Enforces ORCH-0853 [Calendar Active/Archive partition uses event end_at
 * for business-event tickets]:
 *
 *   Any client-side partition of `BusinessEventCalendarRow` (paid business-
 *   event tickets) into past-vs-upcoming buckets in `app-mobile/` MUST
 *   evaluate the effective END timestamp (`masterDateEndUtc` with
 *   `masterDateUtc` fallback), NOT a start-only `masterDateUtc < now`
 *   predicate.
 *
 *   Forbidden patterns in `CalendarTab.tsx`:
 *     - `Date.parse(order.masterDateUtc) < now` (direct start-only)
 *     - `const ts = order.masterDateUtc ? ... : NaN` immediately
 *       followed by `ts < now` (the verbatim pre-0853 predicate)
 *
 *   Required tokens in `CalendarTab.tsx`:
 *     - `masterDateEndUtc` — partition must read the new field
 *     - `effectiveEndTs` — SPEC §3.5.1 canonical variable name
 *
 *   Required tokens in `calendarService.ts`:
 *     - `masterDateEndUtc:` — interface field present
 *     - `end_at ?? null` — mapper propagates from event_dates.end_at
 *
 *   Whitelist: `// SPEC ORCH-0853 OK:` on the same line exempts a finding.
 *
 *   Self-test mode (`--self-test`) validates regex behaviour against an
 *   inlined fixture and exits 1 if expectations are not met.
 *
 * Sibling gates:
 *   - i-consumer-calendar-uses-end-not-start.mjs (ORCH-0850 scheduled-card
 *     partition; same family of bug — end-not-start)
 *
 * Codified: see I-CALENDAR-BUSINESS-TICKET-END-NOT-START in
 *   Mingla_Artifacts/INVARIANT_REGISTRY.md.
 *
 * Exit codes:
 *   0 — all targets pass; required tokens present
 *   1 — at least one forbidden pattern matched OR required token missing OR
 *       self-test failed
 *   2 — file system error
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const APP_MOBILE = path.join(REPO_ROOT, "app-mobile");

const CALENDAR_TAB = path.join(
  APP_MOBILE,
  "src",
  "components",
  "activity",
  "CalendarTab.tsx",
);
const CALENDAR_SERVICE = path.join(
  APP_MOBILE,
  "src",
  "services",
  "calendarService.ts",
);

const FORBIDDEN_TAB = [
  // Direct start-only compare.
  /Date\.parse\(\s*order\.masterDateUtc\s*\)\s*<\s*now\b/,
  // The verbatim pre-0853 predicate: ts variable, masterDateUtc-derived, then `ts < now`.
  // Match across <=4 lines to allow for formatting variants.
  /const\s+ts\s*=\s*order\.masterDateUtc[^\n]*\n(?:[^\n]*\n){0,3}[^\n]*\bts\s*<\s*now\b/,
];

const REQUIRED_TAB = [
  { name: "masterDateEndUtc", re: /\bmasterDateEndUtc\b/ },
  { name: "effectiveEndTs", re: /\beffectiveEndTs\b/ },
];

const REQUIRED_SERVICE = [
  { name: "masterDateEndUtc field declaration", re: /\bmasterDateEndUtc:\s*string\s*\|\s*null/ },
  { name: "mapper end_at propagation", re: /masterDateEndUtc:\s*masterDate\?\.end_at\s*\?\?\s*null/ },
];

const WHITELIST = /\/\/\s*SPEC\s+ORCH-0853\s+OK\s*:/;

// ─── Self-test ──────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const forbiddenFixture = `const ts = order.masterDateUtc ? Date.parse(order.masterDateUtc) : Number.NaN;\n      if (Number.isFinite(ts) && ts < now) { archive.push(order); }`;
  if (!FORBIDDEN_TAB[1].test(forbiddenFixture)) {
    console.error(
      "SELF-TEST FAIL: ts-variable forbidden-pattern regex did not match fixture",
    );
    process.exit(1);
  }
  const directFixture = `if (Date.parse(order.masterDateUtc) < now) {}`;
  if (!FORBIDDEN_TAB[0].test(directFixture)) {
    console.error(
      "SELF-TEST FAIL: direct start-only forbidden-pattern regex did not match fixture",
    );
    process.exit(1);
  }
  const okFixture = `const endTs = order.masterDateEndUtc ? Date.parse(order.masterDateEndUtc) : Number.NaN;\nconst effectiveEndTs = Number.isFinite(endTs) ? endTs : startTs;\nif (effectiveEndTs < now) { archive.push(order); }`;
  if (FORBIDDEN_TAB[0].test(okFixture) || FORBIDDEN_TAB[1].test(okFixture)) {
    console.error(
      "SELF-TEST FAIL: end-based fixture matched a forbidden pattern (false positive).",
    );
    process.exit(1);
  }
  console.log("i-calendar-business-ticket-end-not-start self-test PASSED");
  process.exit(0);
}

// ─── Scan ───────────────────────────────────────────────────────────────────
let failures = 0;

if (!fs.existsSync(CALENDAR_TAB)) {
  console.error(`MISSING TARGET: ${path.relative(REPO_ROOT, CALENDAR_TAB)}`);
  process.exit(2);
}
if (!fs.existsSync(CALENDAR_SERVICE)) {
  console.error(`MISSING TARGET: ${path.relative(REPO_ROOT, CALENDAR_SERVICE)}`);
  process.exit(2);
}

const tabSrc = fs.readFileSync(CALENDAR_TAB, "utf8");
const serviceSrc = fs.readFileSync(CALENDAR_SERVICE, "utf8");

// Forbidden-pattern scan (strip block comments first; honor //-line whitelist).
const tabStripped = tabSrc.replace(/\/\*[\s\S]*?\*\//g, "");
const tabLines = tabStripped.split("\n");
for (let i = 0; i < tabLines.length; i += 1) {
  if (WHITELIST.test(tabLines[i])) continue;
  const noLineComment = tabLines[i].replace(/\/\/.*$/, "");
  if (FORBIDDEN_TAB[0].test(noLineComment)) {
    console.error(
      `${path.relative(REPO_ROOT, CALENDAR_TAB)}:${i + 1}: forbidden direct start-only compare \`Date.parse(order.masterDateUtc) < now\` — partition must use \`effectiveEndTs\`.`,
    );
    console.error(`  Line: ${tabLines[i].trim()}`);
    failures += 1;
  }
}
// Multi-line `const ts = ... ts < now` scan against the whole stripped source.
if (FORBIDDEN_TAB[1].test(tabStripped)) {
  console.error(
    `${path.relative(REPO_ROOT, CALENDAR_TAB)}: forbidden pre-0853 predicate \`const ts = order.masterDateUtc ? ... : NaN; ... ts < now\` detected — this is the exact bug ORCH-0853 fixes.`,
  );
  failures += 1;
}

// Required-presence checks on CalendarTab.tsx.
for (const req of REQUIRED_TAB) {
  if (!req.re.test(tabSrc)) {
    console.error(
      `${path.relative(REPO_ROOT, CALENDAR_TAB)}: MISSING required token \`${req.name}\` — partition must read end-of-event timestamp via SPEC-canonical names.`,
    );
    failures += 1;
  }
}

// Required-presence checks on calendarService.ts.
for (const req of REQUIRED_SERVICE) {
  if (!req.re.test(serviceSrc)) {
    console.error(
      `${path.relative(REPO_ROOT, CALENDAR_SERVICE)}: MISSING required token \`${req.name}\`.`,
    );
    failures += 1;
  }
}

if (failures > 0) {
  console.error("");
  console.error(
    `i-calendar-business-ticket-end-not-start: ${failures} violation(s). See I-CALENDAR-BUSINESS-TICKET-END-NOT-START in INVARIANT_REGISTRY.md.`,
  );
  process.exit(1);
}
console.log("i-calendar-business-ticket-end-not-start PASSED");
process.exit(0);
