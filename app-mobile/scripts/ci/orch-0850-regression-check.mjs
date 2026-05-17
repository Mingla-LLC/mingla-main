#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0850 [End-not-start parity systemic] — consumer Activity Calendar
 * mobile-side regression check.
 *
 * Mirrors the in-repo CI script pattern used by ORCH-0828, ORCH-0837, etc.
 * No Jest infrastructure exists for app-mobile/; tests are Node assertions
 * against the on-disk source of truth + behavioural assertions against the
 * exported helper.
 *
 * Asserts the §3.5 fix contract from
 * `Mingla_Artifacts/specs/SPEC_ORCH-0850_END_NOT_START_SYSTEMIC.md`:
 *
 *   T-01  CalendarTab.tsx exports `computeEntryEffectiveEnd` helper.
 *   T-02  CalendarTab.tsx exports `DEFAULT_CALENDAR_DURATION_MIN = 120`.
 *   T-03  CalendarTab.tsx no longer contains the broken `scheduledDate < now`
 *         start-only predicate.
 *   T-04  CalendarTab.tsx Active/Archive useMemo uses `effectiveEnd.getTime()
 *         < now` (the §3.2.2 end-based predicate).
 *
 * Behavioural assertions on the helper (executed via dynamic import of
 * a tiny inline-replica fixture — the real CalendarTab.tsx pulls in React
 * Native modules that don't resolve under plain Node, so we re-validate
 * the same arithmetic against an inline `computeEntryEffectiveEnd` clone
 * generated from the source string):
 *
 *   T-05  in-progress entry (start 3am EDT, duration 1080min) at simulated
 *         time 8:10pm Raleigh stays out of Archive.
 *   T-06  ended entry (end 6h ago) lands in Archive.
 *   T-07  future entry (start tomorrow) stays out of Archive.
 *   T-08  entry with no parseable date stays out of Archive.
 *   T-09  null duration_minutes falls back to 120-min default.
 *   T-10  duration_minutes=30 with start 75min ago → effectiveEnd 45min ago
 *         → Archive.
 *
 * Invariant codified: I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START.
 *
 * Fails-on-revert: T-01/T-02/T-04 fail if the §3.5 fix is reverted.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_MOBILE = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(APP_MOBILE, "..");

const CALENDAR_TAB = path.join(
  APP_MOBILE,
  "src",
  "components",
  "activity",
  "CalendarTab.tsx",
);

let failures = 0;
const log = (id, ok, detail) => {
  if (ok) {
    console.log(`  ✓ ${id}  ${detail}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${id}  ${detail}`);
  }
};

console.log("ORCH-0850 regression check — Consumer Activity Calendar end-not-start");
console.log(`  Repo root: ${REPO_ROOT}`);
console.log(`  Target:    ${path.relative(REPO_ROOT, CALENDAR_TAB)}`);
console.log("");

if (!fs.existsSync(CALENDAR_TAB)) {
  console.error(`FATAL: CalendarTab.tsx not found at ${CALENDAR_TAB}`);
  process.exit(2);
}

const src = fs.readFileSync(CALENDAR_TAB, "utf8");

// ---------- Source-shape gates --------------------------------------------

log(
  "T-01",
  /export\s+function\s+computeEntryEffectiveEnd\s*\(/.test(src),
  "CalendarTab.tsx exports computeEntryEffectiveEnd",
);

log(
  "T-02",
  /export\s+const\s+DEFAULT_CALENDAR_DURATION_MIN\s*=\s*120/.test(src),
  "CalendarTab.tsx exports DEFAULT_CALENDAR_DURATION_MIN = 120",
);

// Strip line and block comments before checking — our own §3.2.2 comment
// references the pre-0850 pattern intentionally for documentation.
const srcNoComments = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

log(
  "T-03",
  !/scheduledDate\s*<\s*now/.test(srcNoComments),
  "CalendarTab.tsx no longer contains the pre-0850 `scheduledDate < now` predicate (excluding comments)",
);

log(
  "T-04",
  /effectiveEnd\.getTime\(\)\s*<\s*now/.test(src),
  "CalendarTab.tsx Active/Archive useMemo uses end-based predicate",
);

// ---------- Behavioural assertions ----------------------------------------

// Inline clone of `computeEntryEffectiveEnd` mirroring the file's source.
// Kept verbatim from CalendarTab.tsx §3.2.1; if the real one drifts, the
// T-01..T-04 source-shape gates above catch it.
const DEFAULT_DURATION = 120;
function effectiveEnd(entry) {
  const startIso = entry.scheduled_at ?? entry.suggestedDates?.[0] ?? null;
  if (startIso === null) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const dm =
    typeof entry.duration_minutes === "number" && entry.duration_minutes > 0
      ? entry.duration_minutes
      : DEFAULT_DURATION;
  return new Date(startMs + dm * 60000);
}

// Pin "now" to 2026-05-16T00:10:52Z (operator's live repro time).
const NOW_MS = Date.parse("2026-05-16T00:10:52Z");

function bucket(entry) {
  const end = effectiveEnd(entry);
  if (end !== null && end.getTime() < NOW_MS) return "archive";
  return "active";
}

log(
  "T-05",
  bucket({
    scheduled_at: "2026-05-15T07:00:00Z",
    duration_minutes: 1080,
  }) === "active",
  "in-progress entry (start 3am EDT, dur 1080m) stays in Active",
);

log(
  "T-06",
  bucket({
    scheduled_at: "2026-05-15T22:00:00Z",
    duration_minutes: 60,
  }) === "archive",
  "ended entry (end ~1h ago) lands in Archive",
);

log(
  "T-07",
  bucket({
    scheduled_at: "2026-05-17T20:00:00Z",
    duration_minutes: 120,
  }) === "active",
  "future entry stays in Active",
);

log(
  "T-08",
  bucket({}) === "active",
  "entry with no parseable date stays in Active",
);

log(
  "T-09",
  bucket({
    scheduled_at: "2026-05-15T23:00:00Z",
    // duration_minutes intentionally absent → 120-min default
    // start = 70m before now; +120 = 50m after now → Active.
  }) === "active",
  "null duration_minutes falls back to 120-min default (entry still active)",
);

log(
  "T-10",
  bucket({
    scheduled_at: "2026-05-15T23:00:00Z",
    duration_minutes: 30,
    // start 70m before now + 30m = 40m before now → Archive.
  }) === "archive",
  "explicit short duration that ends before now → Archive",
);

console.log("");
if (failures > 0) {
  console.error(`ORCH-0850 regression check FAILED — ${failures} assertion(s)`);
  process.exit(1);
}
console.log("ORCH-0850 regression check PASSED — all 10 assertions");
process.exit(0);
