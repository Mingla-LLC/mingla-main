#!/usr/bin/env node
/**
 * I-PROPOSED-TR2-EVENTS-TYPE-FILTER strict-grep gate.
 *
 * Every `.from("events")` query in mingla-business/src/services/ +
 * mingla-business/src/hooks/ MUST either:
 *   (a) chain `.eq("event_type", "event")` or `.eq("event_type", "trip")`
 *       within ~12 lines after the `.from("events")` line, OR
 *   (b) be preceded by an allowlist comment on the immediately previous
 *       non-blank line:
 *       // orch-strict-grep-allow events-type-filter — <reason>
 *
 * Rationale: ORCH-0859 [Tr2 Minimum Viable Trip] introduced event_type =
 * 'event' | 'experience' | 'trip' on the unified events table. Without
 * explicit filters, trip rows leak into event-only UI (and vice versa),
 * causing the bug surfaces tracked in REWORK 2 + REWORK 3 (operator
 * smoke #1, #3, #6 + RETEST 1 P0). This gate prevents future
 * regressions by failing PRs that add new unfiltered events queries.
 *
 * Scope: src/services/ + src/hooks/ ONLY. App layer + components consume
 * via hooks/services. Tests under __tests__/ ignored.
 *
 * Also covers `.from("business_management_events_view")` +
 * `.from("business_public_events_view")` — those views don't expose
 * event_type and need a follow-up `.in("id", ids)`/`.eq("id", id)` probe
 * against events table; the allowlist tag is required at the view-query
 * line and the follow-up probe must filter on event_type.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 *
 * Established by: ORCH-0859 REWORK 3 dispatch.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "mingla-business", "src", "services"),
  join(REPO_ROOT, "mingla-business", "src", "hooks"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow events-type-filter";

// Match either `.from("events")` OR `.from("business_*events_view")`.
const FROM_RE = /\.from\(\s*["'](?:events|business_(?:management|public)_events_view)["']\s*\)/;
// event_type filter pattern — covers .eq("event_type", "event"|"trip"|"experience")
const TYPE_FILTER_RE = /\.eq\(\s*["']event_type["']\s*,\s*["'](?:event|trip|experience)["']\s*\)/;
// Detect inserts/updates that explicitly write event_type in the payload.
const TYPE_PAYLOAD_RE = /event_type\s*:\s*["'](?:event|trip|experience)["']/;
// Window of lines after .from("events") to look for the filter
const FILTER_WINDOW_LINES = 14;

let violations = 0;
let filesScanned = 0;

function* walkTsTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkTsTsx(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!FROM_RE.test(line)) continue;
    // Skip if the match is inside a line comment (e.g. a doc/allowlist
    // comment that quotes `.from("events")` for explanatory purposes).
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

    // Allowlist check: scan up to 5 lines back for the tag (handles
    // multi-line query expressions like `const X = await supabase\n.from(...)`).
    let allowlisted = false;
    for (let k = i - 1; k >= Math.max(0, i - 5); k -= 1) {
      if (lines[k].includes(ALLOWLIST_TAG)) {
        allowlisted = true;
        break;
      }
    }
    if (allowlisted) continue;

    // Filter window: look forward up to FILTER_WINDOW_LINES for the
    // event_type filter OR a payload-side event_type assignment.
    const end = Math.min(lines.length, i + FILTER_WINDOW_LINES + 1);
    let found = false;
    for (let j = i; j < end; j += 1) {
      if (TYPE_FILTER_RE.test(lines[j]) || TYPE_PAYLOAD_RE.test(lines[j])) {
        found = true;
        break;
      }
    }
    if (!found) {
      violations += 1;
      const rel = relative(REPO_ROOT, file);
      console.error(
        `✗ ${rel}:${i + 1} — .from(...) query missing event_type filter within ${FILTER_WINDOW_LINES} lines (or allowlist comment)`,
      );
      console.error(`    > ${line.trim()}`);
      console.error(
        `    fix: add .eq("event_type", "event"|"trip"|"experience") OR set event_type in INSERT payload OR add comment:`,
      );
      console.error(`    // ${ALLOWLIST_TAG} — <reason>`);
    }
  }
}

for (const dir of SCAN_DIRS) {
  for (const file of walkTsTsx(dir)) {
    filesScanned += 1;
    checkFile(file);
  }
}

console.log(
  `I-PROPOSED-TR2-EVENTS-TYPE-FILTER: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
