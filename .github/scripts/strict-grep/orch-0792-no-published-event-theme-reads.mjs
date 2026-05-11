#!/usr/bin/env node
/**
 * ORCH-0792 strict-grep gate — no published-event theme date reads.
 *
 * Enforces invariant I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY:
 * post-publish reads of event timing MUST source from event_dates (directly
 * or via the master_* columns on `business_management_events_view` /
 * `business_public_events_view`), NOT from `theme.business_event.when` JSON.
 *
 * Scans `mingla-business/src/services/` and `supabase/functions/` for
 * forbidden patterns:
 *   • `business_event.when` access on a non-draft path
 *   • `businessEvent.when` JS-side
 *
 * Allowlist (exempt):
 *   • Draft-side mappers and wizard components (theme JSON IS the draft
 *     source of truth pre-publish):
 *       - mingla-business/src/utils/serverDraftEventMapper.ts
 *       - mingla-business/src/store/draftEventStore.ts
 *       - mingla-business/src/components/event/CreatorStep2When.tsx
 *       - mingla-business/src/components/event/EventCreatorWizard.tsx
 *       - mingla-business/src/components/event/EditPublishedScreen.tsx (transitional — see Discovery D-1 in SPEC §17)
 *       - mingla-business/src/services/eventDrafts.ts
 *   • multiDates batch reads from `businessEvent.multiDates` are also
 *     exempt as a transitional compromise; the proper fix is a separate
 *     event_dates batch-fetch helper, queued as a follow-up.
 *   • Any path that explicitly references `business_draft` (drafts only).
 *   • Comments referencing the forbidden pattern (e.g., this gate's docs).
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const ROOTS = [
  "mingla-business/src/services",
  "supabase/functions",
];

const EXEMPT_FILES = new Set([
  "mingla-business/src/utils/serverDraftEventMapper.ts",
  "mingla-business/src/store/draftEventStore.ts",
  "mingla-business/src/components/event/CreatorStep2When.tsx",
  "mingla-business/src/components/event/EventCreatorWizard.tsx",
  "mingla-business/src/components/event/EditPublishedScreen.tsx",
  "mingla-business/src/services/eventDrafts.ts",
]);

const EXEMPT_DIRS = ["__tests__", "node_modules"];

const FORBIDDEN_PATTERNS = [
  /businessEvent\.when\b/, // JS-side: const when = businessEvent.when
  /asRecord\(businessEvent\.when\)/,
  /business_event['"]?\s*->\s*'when'/, // SQL: theme->'business_event'->'when'
];

// multiDates reads we accept (transitional): `businessEvent.multiDates`
// followed by Array.isArray check or as MultiDateEntry[].
const MULTI_DATES_TRANSITIONAL = /businessEvent\.multiDates/;

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "")
    // Strip SQL comments too (line + block)
    .replace(/--[^\n]*$/gm, "");

const walk = (dir, accum = []) => {
  if (!fs.existsSync(dir)) return accum;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXEMPT_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, accum);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") ||
        entry.name.endsWith(".tsx") ||
        entry.name.endsWith(".sql"))
    ) {
      accum.push(full);
    }
  }
  return accum;
};

const failures = [];

for (const baseRel of ROOTS) {
  const base = path.join(root, baseRel);
  for (const filePath of walk(base)) {
    const relPath = path.relative(root, filePath);
    if (EXEMPT_FILES.has(relPath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    const stripped = stripComments(raw);
    const lines = stripped.split("\n");
    lines.forEach((line, idx) => {
      // Skip multiDates transitional reads (logged but not failed)
      if (MULTI_DATES_TRANSITIONAL.test(line)) return;
      for (const pat of FORBIDDEN_PATTERNS) {
        if (pat.test(line)) {
          failures.push(`${relPath}:${idx + 1} matched ${pat} — ${line.trim()}`);
        }
      }
    });
  }
}

if (failures.length > 0) {
  console.error(
    "ORCH-0792-B FAIL: post-publish theme date reads detected. I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY requires sourcing from event_dates (or the master_* columns on the *_events_view).",
  );
  for (const f of failures) console.error("  " + f);
  console.error(
    "If a match is intentionally transitional, add the file to EXEMPT_FILES in this gate and document the transition condition in the spec.",
  );
  process.exit(1);
}

console.log(
  "ORCH-0792-B no-published-event-theme-reads gate passed.",
);
process.exit(0);
