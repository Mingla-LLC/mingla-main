#!/usr/bin/env node
/**
 * issue #2160 strict-grep gate — A PASS IS REFUSED ON A DAY IT WAS NOT ISSUED
 * FOR, AND THE SCAN RECORDS WHICH DAY IT ADMITTED.
 *
 * Enforces I-PROPOSED-2160-A TICKET-IS-THE-DAY-AUTHORITY and
 * I-PROPOSED-2160-E DAY-BOUND-PASS-ADMITS-ONLY-ITS-DAY.
 *
 * This is the ONE enforcement site for that invariant. `biz_ticket_scan` is the
 * live door: if it is wrong, guests are either turned away at a door they paid
 * for or admitted twice. A migration that re-emits it and quietly drops the day
 * ladder would leave every other check green — the pass would still scan, it
 * would simply scan on the wrong day.
 *
 * Locates the latest migration defining `biz_ticket_scan` (highest filename
 * prefix) and asserts:
 *
 *   1. it reads the PASS'S OWN day set (`ticket_event_dates`), not the event's;
 *   2. it dedupes by the `scan_events` LEDGER, not by `tickets.status` alone —
 *      an all_days pass admits once PER DAY, so status cannot answer it;
 *   3. the `scan_events` INSERT carries `event_date_id`, so an admission is
 *      attributable to a day;
 *   4. the ORCH-0793 grace window and the ORCH-1051 dual scanner-auth paths
 *      survived the re-emit.
 *
 * `--self-test` proves fail-on-revert with a GOOD fixture and 3 DISTINCT BAD
 * fixtures, including the exact revert this gate exists for.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const MIGRATIONS_DIR = path.join(root, "supabase", "migrations");

const OWN_DAY_SET = /ticket_event_dates/;
const LEDGER_DEDUPE =
  /scan_events[\s\S]{0,400}?event_date_id\s*=\s*v_target_day[\s\S]{0,200}?scan_result\s*=\s*'success'/;
const RECORDS_THE_DAY = /INSERT\s+INTO\s+public\.scan_events[\s\S]{0,900}?event_date_id/;
const GRACE_WINDOW = /c_grace_before[\s\S]{0,4000}c_grace_after/;
const SCANNER_AUTH_BOTH = [/event_scanners/, /brand_team_members/];

export function check(body, failures, latestPath = "<latest migration>") {
  if (!OWN_DAY_SET.test(body)) {
    failures.push(
      `${latestPath}: biz_ticket_scan never reads public.ticket_event_dates. ` +
        "The day a pass admits is that table and nothing else " +
        "(I-PROPOSED-2160-A). Without it the scan falls back to the EVENT's " +
        "occurrences, so a guest who bought Saturday walks in on Sunday and a " +
        "Sunday guest is refused on Saturday.",
    );
  }
  if (!LEDGER_DEDUPE.test(body)) {
    failures.push(
      `${latestPath}: biz_ticket_scan no longer dedupes a day-scoped admission ` +
        "against the scan_events ledger. `tickets.status` CANNOT answer " +
        "\"already admitted?\" for an all_days pass, because that pass " +
        "legitimately admits once PER DAY and stays `valid` in between. " +
        "Reverting to a status check either admits it twice on one day or " +
        "refuses it on its second day.",
    );
  }
  if (!RECORDS_THE_DAY.test(body)) {
    failures.push(
      `${latestPath}: the scan_events INSERT no longer carries event_date_id. ` +
        "A scan must record WHICH day it admitted (SC-10); without it an " +
        "admission is anonymous and the per-day roster cannot be built.",
    );
  }
  if (!GRACE_WINDOW.test(body)) {
    failures.push(
      `${latestPath}: the ORCH-0793 grace-window constants did not survive the ` +
        "biz_ticket_scan re-emit (I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED).",
    );
  }
  for (const re of SCANNER_AUTH_BOTH) {
    if (!re.test(body)) {
      failures.push(
        `${latestPath}: the ORCH-1051 scanner-auth path ${re} did not survive ` +
          "the biz_ticket_scan re-emit (I-PROPOSED-BC).",
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const good = [
    "CREATE OR REPLACE FUNCTION public.biz_ticket_scan(...)",
    "  c_grace_before constant interval := interval '120 minutes';",
    "  IF NOT (EXISTS (SELECT 1 FROM public.event_scanners es)",
    "     OR EXISTS (SELECT 1 FROM public.brand_team_members m)) THEN",
    "    RAISE EXCEPTION 'scanner_not_authorized'; END IF;",
    "  SELECT count(*) INTO v_day_count FROM public.ticket_event_dates ted",
    "   WHERE ted.ticket_id = v_ticket.id;",
    "  c_grace_after;",
    "  ELSIF EXISTS (SELECT 1 FROM public.scan_events se",
    "     WHERE se.ticket_id = v_ticket.id",
    "       AND se.event_date_id = v_target_day",
    "       AND se.scan_result = 'success') THEN v_scan_result := 'duplicate';",
    "  INSERT INTO public.scan_events (ticket_id, event_id, scanner_user_id,",
    "    scan_result, client_offline, event_date_id, synced_at, metadata)",
    "  VALUES (...);",
  ].join("\n");

  let f = [];
  check(good, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 — THE REVERT THIS GATE EXISTS FOR: drop the pass's own day set.
  f = [];
  check(good.replaceAll("ticket_event_dates", "event_dates"), f);
  if (f.length === 0) self.push("BAD1 (own day set removed) not flagged");

  // BAD2 — dedupe by status again instead of by the ledger.
  f = [];
  check(
    good.replace(
      "  ELSIF EXISTS (SELECT 1 FROM public.scan_events se\n" +
        "     WHERE se.ticket_id = v_ticket.id\n" +
        "       AND se.event_date_id = v_target_day\n" +
        "       AND se.scan_result = 'success') THEN v_scan_result := 'duplicate';",
      "  ELSIF v_ticket.status = 'used' THEN v_scan_result := 'duplicate';",
    ),
    f,
  );
  if (f.length === 0) self.push("BAD2 (ledger dedupe reverted to status) not flagged");

  // BAD3 — the admitting day stops being recorded.
  f = [];
  check(
    good.replace(
      "    scan_result, client_offline, event_date_id, synced_at, metadata)",
      "    scan_result, client_offline, synced_at, metadata)",
    ),
    f,
  );
  if (f.length === 0) self.push("BAD3 (admitting day not recorded) not flagged");

  if (self.length) {
    console.error("issue-2160 day-bound-scan self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("issue-2160 day-bound-scan self-test PASS (4/4 cases).");
  process.exit(0);
}

const failures = [];
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const matching = files.filter((f) =>
  /CREATE OR REPLACE FUNCTION\s+public\.biz_ticket_scan/i.test(
    fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"),
  )
);
if (matching.length === 0) {
  failures.push(
    "supabase/migrations/: no migration defines biz_ticket_scan — the " +
      "day-bound admission invariant cannot be enforced.",
  );
} else {
  const latest = matching[matching.length - 1];
  check(
    fs.readFileSync(path.join(MIGRATIONS_DIR, latest), "utf8"),
    failures,
    `supabase/migrations/${latest}`,
  );
}
if (failures.length > 0) {
  console.error("issue-2160 day-bound-scan gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("issue-2160 day-bound-scan gate passed.");
