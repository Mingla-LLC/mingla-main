#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate for I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START.
 *
 * Enforces ORCH-0850 [End-not-start parity systemic]:
 *   Any client-side partition of consumer calendar / saved-card entries into
 *   past-vs-upcoming buckets in `app-mobile/` MUST evaluate effectiveEnd =
 *   scheduled_at + (duration_minutes ?? 120 minutes), NOT the start instant.
 *
 *   Forbidden patterns in the consumer Activity / Saved / Calendar surfaces:
 *     - `scheduledDate < now` (the verbatim pre-0850 predicate)
 *     - `new Date(entry.scheduled_at) < new Date()` (start-only literal)
 *     - `Date.parse(entry.scheduled_at) < Date.now()` (start-only epoch)
 *     - `new Date(entry.suggestedDates?.[0]) < new Date()` (start-only via fallback)
 *
 *   Whitelist: `// SPEC ORCH-0850 OK:` comment on the same line exempts it.
 *
 *   Required presence:
 *     - CalendarTab.tsx MUST contain `computeEntryEffectiveEnd` AND
 *       `DEFAULT_CALENDAR_DURATION_MIN`.
 *
 *   Self-test mode (`--self-test`) validates the regex against an inlined
 *   fixture and exits 1 if the regex does NOT match.
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

const TARGETS = [
  path.join(APP_MOBILE, "src", "components", "activity", "CalendarTab.tsx"),
  path.join(APP_MOBILE, "src", "components", "activity", "SavedTab.tsx"),
  path.join(APP_MOBILE, "src", "hooks", "useCalendarEntries.ts"),
  path.join(APP_MOBILE, "src", "hooks", "useCollaborationCalendar.ts"),
];

const CALENDAR_TAB = TARGETS[0];

const FORBIDDEN = [
  /scheduledDate\s*<\s*now\b/,
  /new\s+Date\(\s*entry\.scheduled_at\s*\)\s*<\s*new\s+Date\(\s*\)/,
  /Date\.parse\(\s*entry\.scheduled_at\s*\)\s*<\s*Date\.now\(\s*\)/,
  /new\s+Date\(\s*entry\.suggestedDates\?\.\[0\]\s*\)\s*<\s*new\s+Date\(\s*\)/,
];

const WHITELIST = /\/\/\s*SPEC\s+ORCH-0850\s+OK\s*:/;

// Self-test -------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const fixture = `if (scheduledDate < now) { archive.push(entry); }`;
  if (!FORBIDDEN[0].test(fixture)) {
    console.error("SELF-TEST FAIL: scheduledDate-regex did not match fixture");
    process.exit(1);
  }
  console.log("i-consumer-calendar-uses-end-not-start self-test PASSED");
  process.exit(0);
}

let failures = 0;

// Scan forbidden patterns -----------------------------------------------------
for (const file of TARGETS) {
  if (!fs.existsSync(file)) {
    console.error(`MISSING TARGET: ${path.relative(REPO_ROOT, file)}`);
    process.exit(2);
  }
  const content = fs.readFileSync(file, "utf8");
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (WHITELIST.test(raw)) continue;
    const noLineComment = raw.replace(/\/\/.*$/, "");
    for (let p = 0; p < FORBIDDEN.length; p += 1) {
      if (FORBIDDEN[p].test(noLineComment)) {
        console.error(
          `${path.relative(REPO_ROOT, file)}:${i + 1}: forbidden start-only past-decision pattern (rule ${p + 1}).`,
        );
        console.error(`  Line: ${raw.trim()}`);
        failures += 1;
      }
    }
  }
}

// Required-presence checks on CalendarTab.tsx ---------------------------------
const calendarSrc = fs.readFileSync(CALENDAR_TAB, "utf8");
if (!/\bcomputeEntryEffectiveEnd\b/.test(calendarSrc)) {
  console.error(
    `${path.relative(REPO_ROOT, CALENDAR_TAB)}: MISSING required symbol \`computeEntryEffectiveEnd\` — the end-based bucket helper.`,
  );
  failures += 1;
}
if (!/\bDEFAULT_CALENDAR_DURATION_MIN\b/.test(calendarSrc)) {
  console.error(
    `${path.relative(REPO_ROOT, CALENDAR_TAB)}: MISSING required symbol \`DEFAULT_CALENDAR_DURATION_MIN\` — the 120-min default constant.`,
  );
  failures += 1;
}

if (failures > 0) {
  console.error("");
  console.error(
    `i-consumer-calendar-uses-end-not-start: ${failures} violation(s). See I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START in INVARIANT_REGISTRY.md.`,
  );
  process.exit(1);
}
console.log("i-consumer-calendar-uses-end-not-start PASSED");
process.exit(0);
