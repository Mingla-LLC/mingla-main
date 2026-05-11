#!/usr/bin/env node
/**
 * ORCH-0792 strict-grep gate — publish RPC writes event_dates.
 *
 * Enforces: the LATEST migration defining `business_publish_event_draft`
 * MUST contain `INSERT INTO public.event_dates`. If a future migration
 * supersedes the ORCH-0792 definition and forgets the event_dates write,
 * this gate fails and prevents the regression from shipping.
 *
 * Promotes invariant I-PROPOSED-AX EVENT_HAS_MASTER_DATE.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const migrationsDir = path.join(root, "supabase/migrations");
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .reverse(); // descending — latest first

const FN_MARKER = "CREATE OR REPLACE FUNCTION public.business_publish_event_draft";
const INSERT_MARKER = "INSERT INTO public.event_dates";

let latestDefiningFile = null;
for (const f of files) {
  const body = fs.readFileSync(path.join(migrationsDir, f), "utf8");
  if (body.includes(FN_MARKER)) {
    latestDefiningFile = { name: f, body };
    break;
  }
}

if (latestDefiningFile === null) {
  console.error(
    "ORCH-0792-A FAIL: no migration defines `business_publish_event_draft`. Expected the ORCH-0792 publish RPC migration.",
  );
  process.exit(1);
}

if (!latestDefiningFile.body.includes(INSERT_MARKER)) {
  console.error(
    `ORCH-0792-A FAIL: latest publish RPC definition (${latestDefiningFile.name}) does not contain \`${INSERT_MARKER}\`. The publish path must write event_dates rows before flipping events.status to scheduled. Restore the ORCH-0792 INSERT block or update this gate if the architecture has intentionally changed.`,
  );
  process.exit(1);
}

console.log(
  `ORCH-0792-A publish-writes-event-dates gate passed (verified ${latestDefiningFile.name}).`,
);
process.exit(0);
