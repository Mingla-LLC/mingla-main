#!/usr/bin/env node
/**
 * issue #2160 / #2161 strict-grep gate — NO GUEST-FACING CLIENT MAY READ
 * `public.event_dates` DIRECTLY.
 *
 * Enforces I-PROPOSED-2160-D OCCURRENCES-TRAVEL-WITH-THE-EVENT.
 *
 * WHY THIS GATE EXISTS AT ALL. #2135 loaded the EVENT through a SECURITY
 * DEFINER RPC (which deliberately serves UNLISTED events to anyone holding the
 * link) but loaded its OCCURRENCES through an RLS-gated table read. Two access
 * paths for one page, and they disagreed: on an unlisted event the page
 * rendered and the days silently did not. No error surfaced — it looked exactly
 * like a single-date event. That is #2161.
 *
 * The failure mode this gate catches is a QUIET one: someone re-adds a
 * `.from("event_dates")` read to a guest surface because it is the shortest way
 * to get a date, and it works perfectly on every public event they test with.
 *
 * NOT A LINTER FOR THE WHOLE REPO. Organiser-authenticated surfaces legitimately
 * read event_dates under their own policies. Only the anon-tolerant guest paths
 * are covered.
 *
 * `--self-test` proves fail-on-revert with a GOOD fixture and 2 DISTINCT BAD
 * fixtures.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

// The anon-tolerant guest read paths for a standard EVENT. Each is a file a
// guest's browser executes without ever signing in.
const GUARDED = [
  "mingla-business/src/services/publicEventOccurrencesService.ts",
  "mingla-business/src/services/publicEventsService.ts",
  "mingla-business/src/hooks/usePublicEvents.ts",
  "mingla-business/src/components/event/MultiDateDayChooser.tsx",
  "mingla-business/src/components/event/PublicEventPage.tsx",
  "mingla-business/app/checkout/[eventId]/index.tsx",
];

const DIRECT_READ = /\.from\(\s*["'`]event_dates["'`]\s*\)/;

// An EXPLICIT, greppable opt-out. A read may be exempted only by naming itself
// on the preceding lines with a reason. This is deliberately noisy: the failure
// mode being guarded against is a read that nobody notices, so an exception must
// be something a reviewer trips over, not a quietly shortened allowlist.
const ALLOW_MARKER = /issue-2160-strict-grep-allow\s+[A-Z0-9-]+/;

export function check(source, relPath, failures) {
  // Strip any block that carries the explicit marker within the 20 lines before
  // the read, so an exempted read does not trip the scan.
  const lines = source.split("\n");
  const kept = lines.filter((line, i) => {
    if (!DIRECT_READ.test(line) && !/\.from\($/.test(line.trim())) return true;
    const window = lines.slice(Math.max(0, i - 20), i).join("\n");
    return !ALLOW_MARKER.test(window);
  });
  source = kept.join("\n");
  if (DIRECT_READ.test(source)) {
    failures.push(
      `${relPath}: reads public.event_dates DIRECTLY. A guest-facing surface ` +
        "must obtain occurrences from the same SECURITY DEFINER reader that " +
        "served the event (pg_direct_event_checkout_bundle -> " +
        "PublicEventDetail.occurrences). A direct read is RLS-gated and " +
        "returns NOTHING for an UNLISTED event whose page renders perfectly — " +
        "silently, with no error. That is issue #2161, and widening the anon " +
        "event_dates policy is NOT the fix: it would leak the existence and " +
        "schedule of every unlisted offering to enumeration.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const good =
    'const occurrences = publicEventQuery.data?.occurrences ?? EMPTY;\n' +
    'const { data } = await supabase.rpc("pg_direct_event_checkout_bundle", args);';
  let f = [];
  check(good, "good.ts", f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 — the exact shape #2161 shipped.
  f = [];
  check(
    'const { data } = await supabase.from("event_dates").select("id, start_at")',
    "bad1.ts",
    f,
  );
  if (f.length === 0) self.push("BAD1 (double-quoted direct read) not flagged");

  // BAD2 — a different quoting style plus whitespace, same defect.
  f = [];
  check("supabase\n  .from( 'event_dates' )\n  .select('*')", "bad2.ts", f);
  if (f.length === 0) self.push("BAD2 (single-quoted spaced direct read) not flagged");

  // BAD3-inverse — an EXPLICITLY marked read is allowed, and only that one.
  f = [];
  check(
    "// issue-2160-strict-grep-allow TRIP-SIDECAR-LATENT-NOT-LIVE\n" +
      'supabase.from("event_dates").select("*")',
    "marked.ts",
    f,
  );
  if (f.length !== 0) self.push("MARKED fixture wrongly flagged: " + f.join("; "));

  f = [];
  check(
    "// issue-2160-strict-grep-allow SOMETHING\n".repeat(1) +
      "\n".repeat(25) +
      'supabase.from("event_dates").select("*")',
    "faraway.ts",
    f,
  );
  if (f.length === 0) {
    self.push("a marker 25 lines away must NOT exempt the read, but did");
  }

  if (self.length) {
    console.error("issue-2160 occurrences-not-read-directly self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("issue-2160 occurrences-not-read-directly self-test PASS (5/5 cases).");
  process.exit(0);
}

const failures = [];
let scanned = 0;
for (const rel of GUARDED) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(
      `${rel}: guarded guest-surface file is missing. If it moved, update this ` +
        "gate's allowlist in the same change — a silently unguarded path is " +
        "how #2161 happened.",
    );
    continue;
  }
  scanned += 1;
  check(fs.readFileSync(abs, "utf8"), rel, failures);
}

if (failures.length > 0) {
  console.error("issue-2160 occurrences-not-read-directly gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `issue-2160 occurrences-not-read-directly gate passed (${scanned} guest surfaces).`,
);
