#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * I-PROPOSED-BV — REALTIME_TABLE_IN_PUBLICATION_OR_NO_SUBSCRIPTION
 *
 * Any client-side `postgres_changes` subscription targeting a Postgres
 * table T (via `.on("postgres_changes", { ..., table: "T", ... })`) MUST
 * satisfy ONE of:
 *   (a) Table T is in the BASELINE_PUBLICATION_TABLES allowlist below
 *       (the snapshot of the live `supabase_realtime` publication as of
 *       2026-05-17, captured during ORCH-0854 close), OR
 *   (b) The repo contains a migration under `supabase/migrations/` with
 *       `ALTER PUBLICATION supabase_realtime ADD TABLE public.T`, OR
 *   (c) The subscription is annotated with a `REALTIME-INERT-OK: ORCH-NNNN
 *       <reason>` comment within 3 lines of the `.on(` call.
 *
 * Established by ORCH-0854 [Consumer ticket status live-flip valid→used on
 * scan]. Reason: two confirmed instances of the silent-failure trap where
 * a client subscription was wired against an unpublished table —
 * ORCH-0816 [Brand KPI tile freshness + Realtime] (orders) and ORCH-0854
 * (tickets). Without this gate, a third instance would land as a user bug,
 * not a CI failure.
 *
 * Why the allowlist: the production publication was populated partly via
 * Supabase Dashboard (pre-migration-tracking era) and partly via on-disk
 * migrations. Pure migration-grep would false-positive on 60+ legacy
 * subscriptions. The allowlist freezes today's known-good state; every
 * NEW subscription added going forward must either add its table to the
 * allowlist (after a migration adds it to the publication AND operator
 * applies it via `supabase db push`) or annotate with the inert-OK
 * exemption.
 *
 * Updating the allowlist: when a new ALTER PUBLICATION migration ships,
 * append its table to the BASELINE_PUBLICATION_TABLES set in the SAME PR.
 *
 * Scope: scans `app-mobile/src/`, `mingla-business/src/`,
 * `mingla-admin/src/` for postgres_changes subscriptions.
 *
 * Exit 1 on any unpaired subscription.
 */

/**
 * BASELINE_PUBLICATION_TABLES — snapshot of `pg_publication_tables` where
 * `pubname = 'supabase_realtime'` as observed on remote project
 * `gqnoajqerqhnvulmnyvv` at 2026-05-17 during ORCH-0854 close. New
 * publication-add migrations append here in the same PR that lands the
 * migration file. Removing an entry requires a matching DROP TABLE
 * migration (or operator-confirmed dashboard removal) and explicit
 * ORCH-NNNN justification in the commit body.
 */
const BASELINE_PUBLICATION_TABLES = new Set([
  "board_card_messages",
  "board_card_rsvps",
  "board_message_reactions",
  "board_messages",
  "board_participant_presence",
  "board_saved_cards",
  "board_votes",
  "calendar_entries",
  "collaboration_invites",
  "collaboration_sessions",
  "conversation_participants",
  "conversation_presence",
  "conversations",
  "friends",
  "leaderboard_presence",
  "messages",
  "notifications",
  "orders",
  "pair_requests",
  "pairings",
  "pending_pair_invites",
  "reservations",
  "session_participants",
  "tag_along_requests",
  "ticket_checkout_sessions",
  "tickets",
  "venue_waitlist",
]);

/**
 * LEGACY_KNOWN_UNPUBLISHED_SUBSCRIPTIONS — client subscriptions that
 * already exist in the codebase but target tables NOT in the live
 * publication. These subscriptions are SILENTLY NO-OP today. Discovered
 * during ORCH-0854 implementation when this gate first ran. Tracked as a
 * Discovery for Orchestrator in
 * `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP.md`.
 * A follow-up ORCH must decide per table: (a) add the table to the
 * publication via migration AND move the entry to
 * BASELINE_PUBLICATION_TABLES, OR (b) remove the subscription if it is
 * dead code. Until then this list keeps the gate from blocking the
 * ORCH-0854 PR while making the bug class visible in CI logs as WARN
 * lines (not failures).
 */
const LEGACY_KNOWN_UNPUBLISHED_SUBSCRIPTIONS = new Set([
  "boards",
  "board_collaborators",
  "board_experiences",
  "board_message_reads",
  "board_session_preferences",
  "friend_requests",
  "message_reads",
  "pending_invites",
  "session_decks",
  "stripe_connect_accounts",
  "stripe_external_accounts",
]);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const clientScanDirs = [
  "app-mobile/src",
  "mingla-business/src",
  "mingla-admin/src",
];

const migrationsDir = path.join(repoRoot, "supabase/migrations");

/** Recursively collect .ts/.tsx/.js/.jsx files under a directory. */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Read all migrations and concatenate their contents (we only grep). */
function readMigrationCorpus() {
  try {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => path.join(migrationsDir, f));
    return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  } catch {
    return "";
  }
}

function publicationHas(migrationCorpus, tableName) {
  // Match `ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>;`
  // with flexible whitespace.
  const re = new RegExp(
    `ALTER\\s+PUBLICATION\\s+supabase_realtime\\s+ADD\\s+TABLE\\s+public\\.${tableName}\\b`,
    "i",
  );
  return re.test(migrationCorpus);
}

const migrationCorpus = readMigrationCorpus();

const subscriptionRe =
  /\.on\(\s*["']postgres_changes["']\s*,\s*\{([\s\S]*?)\}/g;
const tableRe = /\btable:\s*["']([a-zA-Z0-9_]+)["']/;

const violations = [];
const warnings = [];
let subscriptionCount = 0;

for (const rel of clientScanDirs) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;
  const files = walk(abs);
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("postgres_changes")) continue;
    const lines = src.split(/\r?\n/);
    let match;
    while ((match = subscriptionRe.exec(src)) !== null) {
      subscriptionCount += 1;
      const optionsBody = match[1];
      const tableMatch = tableRe.exec(optionsBody);
      if (!tableMatch) continue; // wildcard or schema-level — skip
      const table = tableMatch[1];

      // Determine line of the `.on(` start for exemption-comment check.
      const onIndex = match.index;
      const upTo = src.slice(0, onIndex);
      const lineNumber = upTo.split(/\r?\n/).length;

      // Exemption: look for `REALTIME-INERT-OK: ORCH-NNNN` within 3 lines
      // above the subscription call.
      const exemptWindow = lines
        .slice(Math.max(0, lineNumber - 4), lineNumber)
        .join("\n");
      const exempt = /REALTIME-INERT-OK:\s*ORCH-\d{4}/.test(exemptWindow);
      if (exempt) continue;

      const inBaseline = BASELINE_PUBLICATION_TABLES.has(table);
      const inMigrations = publicationHas(migrationCorpus, table);
      const isLegacyKnown = LEGACY_KNOWN_UNPUBLISHED_SUBSCRIPTIONS.has(table);
      if (!inBaseline && !inMigrations) {
        const entry = {
          file: path.relative(repoRoot, file),
          line: lineNumber,
          table,
        };
        if (isLegacyKnown) {
          warnings.push(entry);
        } else {
          violations.push(entry);
        }
      }
    }
    subscriptionRe.lastIndex = 0;
  }
}

console.log(
  `\nI-PROPOSED-BV: REALTIME_TABLE_IN_PUBLICATION_OR_NO_SUBSCRIPTION\n` +
    `Scanned ${subscriptionCount} postgres_changes subscription(s) across ${clientScanDirs.join(", ")}.\n`,
);

if (warnings.length > 0) {
  console.log(
    `  [WARN] ${warnings.length} legacy unpublished subscription(s) — tracked for follow-up ORCH:`,
  );
  for (const w of warnings) {
    console.log(`         ${w.file}:${w.line} → \`${w.table}\` (silently no-op until publication-added or removed)`);
  }
  console.log("");
}

if (violations.length === 0) {
  console.log(
    "  [PASS] every NEW subscribed table is in BASELINE_PUBLICATION_TABLES or has a paired publication-add migration.\n",
  );
  process.exit(0);
}

for (const v of violations) {
  console.log(
    `  [FAIL] ${v.file}:${v.line} subscribes to table \`${v.table}\` but the table is NOT in BASELINE_PUBLICATION_TABLES and no migration contains \`ALTER PUBLICATION supabase_realtime ADD TABLE public.${v.table}\`.`,
  );
}
console.log(
  `\nFix options:\n` +
    `  (a) Add a migration to \`supabase/migrations/\` containing \`ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>;\` AND append the table name to BASELINE_PUBLICATION_TABLES in this gate, OR\n` +
    `  (b) Annotate the subscription with \`REALTIME-INERT-OK: ORCH-NNNN <reason>\` within 3 lines of the .on( call if the subscription is intentionally inert.\n`,
);
process.exit(1);
