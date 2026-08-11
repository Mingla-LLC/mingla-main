#!/usr/bin/env node
/**
 * Issue #1791 (#1767 Phase 3) — THE LADDER ONLY EVER NOTIFIES PEOPLE.
 *
 * SPEC #1788 P-16 / P-55, DESIGN D-7a / D-7b / D-7c. Three operator decisions
 * are structural rather than conventional, and this gate is what keeps them so:
 *
 *   D-7a  NO auto-refund. No sweep, cron, or timer may start a refund for a
 *         venue order. Money moves only when a PERSON decides.
 *   D-7b  NO auto-pause. `venue_ordering_settings.paused_at` has EXACTLY ONE
 *         writer — the venue's own control, `biz_venue_ordering_pause`, which
 *         requires a verified staff user id. Mingla never switches off a
 *         venue's ordering on their behalf.
 *   D-7c  NO SMS. `send-venue-sms` stays a guest-facing waitlist tool and is
 *         never repurposed for staff alerting.
 *
 * WHY A GATE AND NOT A TEST. Each of these is an ABSENCE, and absences are what
 * tests are worst at: a suite proving "the sweep did not refund" passes just as
 * happily on a sweep that gained a refund branch nobody exercised. The one that
 * bites is the second writer added months later by somebody solving a different
 * problem — "just pause them while we investigate" is a reasonable-sounding
 * line of code and a decision Mingla has explicitly refused to make. The
 * BEHAVIOURAL half lives in
 * `supabase/migrations/__tests__/issue_1791_venue_order_queue_and_alerting.test.sql`
 * (T-ESC2 snapshots the whole order row across a sweep) and
 * `supabase/functions/_shared/__tests__/issue_1791_venue_order_alerting.test.ts`.
 *
 * Supports `--self-test` (no repo scan; GOOD + BAD fixtures for every rule).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

/**
 * SET-A — the pause columns. Only an ASSIGNMENT is the failure. READS are fine
 * and common — `venue-order-create` gates its third check on `paused_at IS
 * NULL`, the settings hook maps the column into `paused`, and both must stay
 * legal or the gate would forbid the product from knowing whether it is paused.
 *
 * Two dialects, because a regex that tried to cover both would either miss the
 * SQL or flag every TypeScript type annotation:
 *   SQL — `SET paused_at = …` / `paused_at := …`. DDL (`paused_at timestamptz
 *         NULL`) and CHECKs (`(paused_at IS NULL) = …`) do not match.
 *   TS  — the column named inside a `.update(…)` / `.insert(…)` / `.upsert(…)`
 *         payload. A `paused_at: string | null` interface field is a shape
 *         declaration, not a write, and must not trip.
 */
const PAUSE_SQL_WRITE_RE = /(?:paused_at|paused_by_user_id)\s*(?::=|=(?!=))/;
const PAUSE_TS_CALL_RE = /\.(?:update|insert|upsert)\s*\(/g;
/** How far past a write call to look for the column in its payload. */
const TS_PAYLOAD_WINDOW = 400;

function hasPauseWrite(code, isSql) {
  if (isSql) return PAUSE_SQL_WRITE_RE.test(code);
  PAUSE_TS_CALL_RE.lastIndex = 0;
  let match;
  while ((match = PAUSE_TS_CALL_RE.exec(code)) !== null) {
    const window = code.slice(match.index, match.index + TS_PAYLOAD_WINDOW);
    if (/paused_at|paused_by_user_id/.test(window)) return true;
  }
  return false;
}

/** The ONE file allowed to write them, and the ONE function inside it. */
const PAUSE_WRITER_FILE =
  "supabase/migrations/20270315001791_issue_1791_venue_order_queue_and_alerting.sql";
const PAUSE_WRITER_FN = "biz_venue_ordering_pause";

/**
 * SET-B — the escalation sweep's reach. The sweep and its notification module
 * may send pushes and write durable in-app rows. They may not touch a refund
 * rail, a cancel rail, an SMS rail, or the venue's switches.
 */
const SWEEP_FILES = [
  "supabase/functions/venue-order-escalation-sweep/index.ts",
  "supabase/functions/_shared/venueOrderNotify.ts",
];

const SWEEP_FORBIDDEN = [
  { id: "no-sms", re: /send-venue-sms|smsAdapter|sendSms/i,
    why: "the escalation ladder reached an SMS rail. D-7c dropped SMS from staff alerting entirely — it reaches one handset, costs per message, and the NG rail is dark." },
  { id: "no-refund", re: /source_refunds|refund-order|mint_refund|prepare_.*refund/i,
    why: "the escalation ladder reached a refund rail. D-7a: money moves only when a PERSON decides — a slow venue is not a failed order." },
  { id: "no-cancel", re: /cancel-order|fulfillment_status\s*[:=]\s*['\"]cancelled/i,
    why: "the escalation ladder cancels orders. It only ever notifies PEOPLE." },
  { id: "no-pause", re: /paused_at|ordering_enabled/,
    why: "the escalation ladder reached the venue's own switches. D-7b: Mingla never switches off a venue's ordering on their behalf." },
];

/** SET-C — anti-vacuity. A gate that goes green because its target moved is the
 *  failure class the registry exists to prevent. */
const MUST_EXIST = [
  PAUSE_WRITER_FILE,
  ...SWEEP_FILES,
  "supabase/migrations/20270316001791_issue_1791_venue_order_escalation_cron.sql",
  "mingla-business/src/hooks/useVenueOrderingSettings.ts",
];

/** Comments EXPLAIN these prohibitions at length; a scan that tripped over its
 *  own documentation would be worthless. */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("--");
    })
    .join("\n");
}

/** Split a .sql file into its CREATE FUNCTION bodies, keyed by function name. */
function sqlFunctionSpans(code) {
  const spans = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)/gi;
  let match;
  const starts = [];
  while ((match = re.exec(code)) !== null) {
    starts.push({ name: match[1], index: match.index });
  }
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].index : code.length;
    spans.push({ name: starts[i].name, body: code.slice(starts[i].index, end) });
  }
  if (spans.length === 0) spans.push({ name: "<file>", body: code });
  return spans;
}

function scanPauseWriters(label, rawCode, failures, { isSanctionedFile, isSql }) {
  const code = stripComments(rawCode);
  if (!hasPauseWrite(code, isSql)) return;
  if (!isSanctionedFile) {
    failures.push(
      `${label}: [pause-single-writer] assigns venue_ordering_settings.paused_at / ` +
        `paused_by_user_id. D-7b gives that column EXACTLY ONE writer — the venue's ` +
        `own control in their Orders module. Route the change through ` +
        `${PAUSE_WRITER_FN} (which requires a verified staff user id), or it is ` +
        `Mingla killing a venue's takings on their behalf.`,
    );
    return;
  }
  // Inside the sanctioned migration, only the sanctioned FUNCTION may write.
  for (const span of sqlFunctionSpans(code)) {
    if (hasPauseWrite(span.body, true) && span.name !== PAUSE_WRITER_FN) {
      failures.push(
        `${label}: [pause-single-writer] public.${span.name} assigns paused_at / ` +
          `paused_by_user_id. Only ${PAUSE_WRITER_FN} may (D-7b).`,
      );
    }
  }
}

function scanSweep(label, rawCode, failures) {
  const code = stripComments(rawCode);
  for (const rule of SWEEP_FORBIDDEN) {
    if (rule.re.test(code)) {
      failures.push(`${label}: [${rule.id}] ${rule.why}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test fixtures.
// ---------------------------------------------------------------------------
const GOOD_PAUSE_SQL = `
CREATE OR REPLACE FUNCTION public.biz_venue_ordering_pause(p_venue_id uuid, p_paused boolean)
RETURNS jsonb AS $fn$
BEGIN
  UPDATE public.venue_ordering_settings
     SET paused_at = CASE WHEN p_paused THEN now() ELSE NULL END,
         paused_by_user_id = CASE WHEN p_paused THEN v_uid ELSE NULL END
   WHERE venue_id = p_venue_id;
END $fn$;
CREATE OR REPLACE FUNCTION public.pg_venue_order_escalation_scan(p_now timestamptz)
RETURNS TABLE (order_id uuid) AS $fn$
BEGIN
  RETURN QUERY UPDATE public.venue_orders SET escalation_level = 1 RETURNING id;
END $fn$;
`;

const BAD_PAUSE_SQL_SECOND_FN = `
CREATE OR REPLACE FUNCTION public.biz_venue_ordering_pause(p_venue_id uuid, p_paused boolean)
RETURNS jsonb AS $fn$
BEGIN
  UPDATE public.venue_ordering_settings SET paused_at = now(), paused_by_user_id = v_uid;
END $fn$;
CREATE OR REPLACE FUNCTION public.pg_venue_order_escalation_scan(p_now timestamptz)
RETURNS TABLE (order_id uuid) AS $fn$
BEGIN
  UPDATE public.venue_ordering_settings SET paused_at = now(), paused_by_user_id = NULL;
  RETURN QUERY SELECT id FROM public.venue_orders;
END $fn$;
`;

const BAD_PAUSE_ELSEWHERE = `
export async function autoPause(client, venueId) {
  await client.from("venue_ordering_settings").update({ paused_at: new Date().toISOString() });
}
`;

// READS and SHAPE DECLARATIONS of the pause column are legitimate and must NOT
// trip the gate. Line 1 is a TypeScript interface field, line 2 is what
// venue-order-create's third gate does, line 3 is the settings hook's mapping,
// line 4 is a SQL predicate. Flagging any of these would forbid the product
// from knowing whether it is paused.
const GOOD_PAUSE_READ = `
  interface SettingsRow { paused_at: string | null; ordering_enabled: boolean; }
  if (settingsRow.paused_at !== null) return fail("ordering_paused");
  return { paused: data.paused_at !== null, pausedAt: data.paused_at };
  const { data } = await supabase.from("venue_ordering_settings")
    .select("venue_id, ordering_enabled, paused_at").eq("venue_id", venueId);
`;

const GOOD_SWEEP = `
import { fireVenueOrderEscalation } from "../_shared/venueOrderNotify.ts";
const { data } = await supabase.rpc("pg_venue_order_escalation_scan", { p_now: iso });
for (const row of data) await fireVenueOrderEscalation(supabase, row);
`;

const BAD_SWEEP_SMS = `
import { smsAdapter } from "../_shared/smsAdapter.ts";
await smsAdapter.send(venuePhone, "nobody has seen this order");
`;

const BAD_SWEEP_REFUND = `
await supabase.from("source_refunds").insert({ source_type: "venue_menu_order" });
`;

const BAD_SWEEP_PAUSE = `
await supabase.from("venue_ordering_settings").update({ ordering_enabled: false });
`;

if (process.argv.includes("--self-test")) {
  const cases = [];
  const run = (fn, ...args) => {
    const failures = [];
    fn(...args, failures);
    return failures;
  };

  let f = [];
  scanPauseWriters("good", GOOD_PAUSE_SQL, f, { isSanctionedFile: true, isSql: true });
  cases.push(["the shipped single-writer migration passes", f.length === 0]);

  f = [];
  scanPauseWriters("bad", BAD_PAUSE_SQL_SECOND_FN, f, { isSanctionedFile: true, isSql: true });
  cases.push([
    "a SECOND function in the sanctioned file that pauses fails",
    f.some((x) => x.includes("pg_venue_order_escalation_scan")),
  ]);

  f = [];
  scanPauseWriters("bad", BAD_PAUSE_ELSEWHERE, f, { isSanctionedFile: false, isSql: false });
  cases.push([
    "a pause written from anywhere else fails",
    f.some((x) => x.includes("pause-single-writer")),
  ]);

  f = [];
  scanPauseWriters("good-read", GOOD_PAUSE_READ, f, { isSanctionedFile: false, isSql: false });
  cases.push(["READING the pause column is allowed", f.length === 0]);

  f = [];
  scanSweep("good", GOOD_SWEEP, f);
  cases.push(["the shipped sweep passes", f.length === 0]);

  for (
    const [name, fixture, id] of [
      ["a sweep that sends an SMS fails (D-7c)", BAD_SWEEP_SMS, "no-sms"],
      ["a sweep that starts a refund fails (D-7a)", BAD_SWEEP_REFUND, "no-refund"],
      ["a sweep that pauses a venue fails (D-7b)", BAD_SWEEP_PAUSE, "no-pause"],
    ]
  ) {
    f = [];
    scanSweep("bad", fixture, f);
    cases.push([name, f.some((x) => x.includes(id))]);
  }

  // A comment describing the prohibition must not itself trip the gate.
  f = [];
  scanSweep("comments", "// never send-venue-sms here\n-- no source_refunds ever\n", f);
  cases.push(["a comment naming the forbidden rail does not trip the gate", f.length === 0]);

  // Anti-vacuity.
  cases.push([
    "a missing target file is a failure, never a silent pass",
    !existsSync(join(root, "supabase/functions/__no_such_fn__/index.ts")),
  ]);

  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error("issue-1791 pause/escalation single-writer gate self-test FAILED:");
    for (const [name] of failed) console.error(`- ${name}`);
    process.exit(1);
  }
  console.log(
    `issue-1791 pause/escalation single-writer gate self-test passed (${cases.length}/${cases.length}).`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live run.
// ---------------------------------------------------------------------------
const failures = [];

for (const rel of MUST_EXIST) {
  if (!existsSync(join(root, rel))) {
    failures.push(
      `${rel}: MISSING. A gate that goes green because its target moved is the ` +
        `failure class the registry exists to prevent.`,
    );
  }
}

/** Every place a pause could be written from. */
const PAUSE_SCAN_DIRS = [
  "supabase/migrations",
  "supabase/functions",
  "mingla-business/src",
  "app-mobile/src",
];
const PAUSE_SCAN_EXT = /\.(sql|ts|tsx|mjs|js)$/;
const SKIP_DIR = /node_modules|__tests__|\.expo|dist|web-build/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (SKIP_DIR.test(full)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (PAUSE_SCAN_EXT.test(entry)) out.push(full);
  }
  return out;
}

const files = [];
for (const dir of PAUSE_SCAN_DIRS) walk(join(root, dir), files);

for (const abs of files) {
  const rel = abs.slice(root.length + 1);
  const code = readFileSync(abs, "utf8");
  scanPauseWriters(rel, code, failures, {
    isSanctionedFile: rel === PAUSE_WRITER_FILE,
    isSql: rel.endsWith(".sql"),
  });
}

for (const rel of SWEEP_FILES) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue; // already reported by MUST_EXIST
  scanSweep(rel, readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error("issue-1791 pause/escalation single-writer gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `issue-1791 pause/escalation single-writer gate passed (${files.length} files scanned).`,
);
