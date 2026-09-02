/**
 * Issue #3055 — a migration must not guard itself with an ABSOLUTE row count.
 *
 * THE DEFECT THIS EXISTS TO CATCH
 * `20270530001977_issue_1977_ari_rsvp_guest_contribution.sql` ended with
 *   SELECT count(*) INTO v_count FROM public.ari_cert_capability_requirements;
 *   IF v_count <> 120 THEN RAISE EXCEPTION 'issue_1977_expected_120…'; END IF;
 * `120` was true the day it was written. #2830 later added 12 capabilities, so
 * production holds 132 — the file aborted on its own tail and therefore NEVER
 * RAN ANYWHERE. Every routine in it was unreachable, which is what broke RSVP
 * publish, guest approval and Ari's RSVP actions in production for weeks
 * (#3044, #3047).
 *
 * WHY THE FIX IS NOT `120` -> `132`
 * The contract of record, docs/contracts/ari-capability-ledger.json, holds 132
 * capabilities. Production holds 132 rows. The COUNTS MATCH WHILE THE SETS DO
 * NOT: production carries ari.guests.set_approval and lacks ari.rsvp.update —
 * exactly the two rows #1977 is responsible for swapping. A `<> 132` guard would
 * have passed on a genuinely drifted set. An absolute count is simultaneously
 * too brittle (it rots on the next unrelated row) and too weak (it is blind to a
 * same-count swap). Only a DELTA assertion — net movement against a baseline
 * captured before the migration's own statements, plus explicit membership — is
 * both stable and meaningful.
 *
 * WHY THIS TEST AND NOT A BEHAVIOURAL ONE
 * The CI SQL lane builds its database from EVERY migration file on disk, in sort
 * order, from zero. In that database the requirement table holds exactly 120 rows
 * at the point #1977 runs, so the 120 literal PASSED in CI for the entire period
 * production was broken. A behavioural assertion in that lane structurally cannot
 * observe this bug class. Only a source-shape check can.
 *
 * fails-on-revert: restore any absolute count guard to a migration — including
 * reverting #1977's tail to `IF v_count <> 120` — and `no NEW migration guards
 * itself with an absolute row count` fails.
 */

import { readdirSync, readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const MIGRATIONS_DIR = path.join(process.cwd(), "..", "supabase", "migrations");

/** The subject of this issue. */
const ISSUE_1977_MIGRATION =
  "20270530001977_issue_1977_ari_rsvp_guest_contribution.sql";
/** The reachable re-publication of #1977's certification delta. */
const ISSUE_3055_MIGRATION =
  "20270617003055_issue_3055_ari_cert_requirement_delta.sql";

/**
 * FROZEN allowlist — the absolute-count guards that already existed when this
 * gate was written. They are NOT endorsed; each is the same trap waiting on the
 * next row, and each is registered on #3055 for a separate issue. They are
 * frozen here so the set can only ever SHRINK: adding a new one fails this test.
 *
 * Deliberately NOT fixed in #3055's change: all three are already applied to
 * production and will never re-run there, and rewriting applied migrations to
 * repair a latent CI-only hazard is a wider change than this issue owns.
 */
const KNOWN_ABSOLUTE_COUNT_GUARDS: readonly string[] = [
  // count(*) FROM public.api_health_services <> 25 — a service registry that
  // grows every time an API is registered. Holds today only because the three
  // later migrations that insert services sort after it.
  "20261120000000_orch_1201_api_health_hub.sql",
  "20261121000000_orch_1201_r2_api_health_classes.sql",
  // count(*) FROM public.public_search_documents <> 0 — "this migration seeds
  // zero documents", asserted over the WHOLE table rather than over the rows the
  // migration itself inserted.
  "20270614002986_issue_2986_public_search_documents.sql",
];

const stripSqlComments = (sql: string): string =>
  sql.replace(/^\s*--.*$/gm, "").replace(/\s--.*$/gm, "");

/**
 * True when the comparison at `from` gates a RAISE EXCEPTION — i.e. it is an
 * assertion that ABORTS the migration, not a branch condition. Without this
 * narrowing the detector flags legitimate empty-database branches such as
 * 20270602002491's `IF v_tickets = 0 THEN RAISE NOTICE … ELSE …`.
 */
const abortsOnMismatch = (sql: string, from: number): boolean => {
  const window = sql.slice(from, from + 600);
  const stop = window.search(/\bELSE\b|\bEND IF\b/i);
  const guarded = stop === -1 ? window : window.slice(0, stop);
  return /RAISE\s+EXCEPTION/i.test(guarded);
};

type Finding = { file: string; table: string; literal: string; form: string };

/**
 * Finds guards that compare an UNQUALIFIED count over a whole public table to an
 * integer literal. Two forms, because both appear in this repo:
 *   direct   IF (SELECT count(*) FROM public.t) <> 25 THEN RAISE EXCEPTION …
 *   via-var  SELECT count(*) INTO v FROM public.t;  …  IF v <> 0 THEN RAISE …
 *
 * A count narrowed by WHERE/JOIN is NOT flagged: those count members of a closed,
 * named set (columns in an IN list, a named trigger, one venue's rows) and cannot
 * drift when unrelated rows are added. The defect is specifically counting an
 * entire growing table.
 */
const findAbsoluteCountGuards = (sql: string, file: string): Finding[] => {
  const code = stripSqlComments(sql);
  const findings: Finding[] = [];

  const direct =
    /count\(\s*\*\s*\)\s*FROM\s+public\.(\w+)\s*\)?\s*(?:<>|!=|=)\s*(\d+)/gi;
  for (const m of code.matchAll(direct)) {
    if (abortsOnMismatch(code, (m.index ?? 0) + m[0].length)) {
      findings.push({ file, table: m[1], literal: m[2], form: "direct" });
    }
  }

  const viaVar =
    /SELECT\s+count\(\s*\*\s*\)\s+INTO\s+(\w+)\s+FROM\s+public\.(\w+)\s*;/gi;
  for (const m of code.matchAll(viaVar)) {
    const after = (m.index ?? 0) + m[0].length;
    const rest = code.slice(after, after + 800);
    const cmp = rest.match(new RegExp(`\\b${m[1]}\\s*(?:<>|!=|=)\\s*(\\d+)`));
    if (cmp && abortsOnMismatch(code, after + (cmp.index ?? 0) + cmp[0].length)) {
      findings.push({ file, table: m[2], literal: cmp[1], form: "via-var" });
    }
  }

  return findings;
};

const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

const readMigration = (name: string): string =>
  readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");

describe("#3055 — migrations must not guard themselves with an absolute row count", () => {
  test("liveness: the scan actually reads the migration corpus", () => {
    const files = migrationFiles();
    // A zero needs its denominator. If the directory moved, this test must fail
    // rather than report a clean sweep of nothing.
    expect(files.length).toBeGreaterThan(400);
    for (const name of files) {
      expect(name).toMatch(/^\d{14}_/);
    }
    expect(files).toContain(ISSUE_1977_MIGRATION);
    expect(files).toContain(ISSUE_3055_MIGRATION);
  });

  test("liveness: the detector provably catches the exact defect shape", () => {
    // Without this, a broken detector would make every assertion below pass
    // vacuously — the #2113 "check that carries no information" class.
    const directFixture = `
      DO $$ BEGIN
        IF (SELECT count(*) FROM public.ari_cert_capability_requirements) <> 120 THEN
          RAISE EXCEPTION 'expected_120';
        END IF;
      END $$;`;
    const viaVarFixture = `
      DO $$ DECLARE v_count integer; BEGIN
        SELECT count(*) INTO v_count FROM public.ari_cert_capability_requirements;
        IF v_count <> 120 THEN
          RAISE EXCEPTION 'expected_120:%', v_count;
        END IF;
      END $$;`;
    expect(findAbsoluteCountGuards(directFixture, "fixture.sql")).toHaveLength(1);
    expect(findAbsoluteCountGuards(viaVarFixture, "fixture.sql")).toHaveLength(1);

    // And that it does NOT flag the two legitimate shapes it must tolerate.
    const narrowed = `
      DO $$ DECLARE v_count integer; BEGIN
        SELECT count(*) INTO v_count FROM information_schema.columns
        WHERE table_name = 'events' AND column_name IN ('a','b','c','d');
        IF v_count <> 4 THEN RAISE EXCEPTION 'missing columns'; END IF;
      END $$;`;
    const branchNotAssertion = `
      DO $$ DECLARE v_tickets integer; BEGIN
        SELECT count(*) INTO v_tickets FROM public.tickets;
        IF v_tickets = 0 THEN RAISE NOTICE 'from-zero replay'; ELSE
          RAISE EXCEPTION 'unreachable';
        END IF;
      END $$;`;
    expect(findAbsoluteCountGuards(narrowed, "fixture.sql")).toHaveLength(0);
    expect(findAbsoluteCountGuards(branchNotAssertion, "fixture.sql")).toHaveLength(0);

    // The comment stripper must not let prose describing the retired guard read
    // as the guard itself.
    const proseOnly =
      "-- this used to read: IF (SELECT count(*) FROM public.t) <> 120 THEN RAISE EXCEPTION 'x';\nSELECT 1;";
    expect(findAbsoluteCountGuards(proseOnly, "fixture.sql")).toHaveLength(0);
  });

  test("no NEW migration guards itself with an absolute row count", () => {
    const files = migrationFiles();
    const offenders: Finding[] = [];
    for (const name of files) {
      offenders.push(...findAbsoluteCountGuards(readMigration(name), name));
    }
    expect(files.length).toBeGreaterThan(400);

    const offendingFiles = [...new Set(offenders.map((f) => f.file))].sort();
    const unexpected = offendingFiles.filter(
      (name) => !KNOWN_ABSOLUTE_COUNT_GUARDS.includes(name),
    );
    expect(unexpected).toEqual([]);
  });

  test("the frozen allowlist is exact — no entry may be added, and stale entries must be removed", () => {
    const files = migrationFiles();
    const offenders: Finding[] = [];
    for (const name of files) {
      offenders.push(...findAbsoluteCountGuards(readMigration(name), name));
    }
    const offendingFiles = [...new Set(offenders.map((f) => f.file))].sort();
    // Exact set equality in both directions: a new offender fails, and an
    // allowlist entry that has since been repaired must be deleted from the list
    // rather than left behind granting silent permission.
    expect(offendingFiles).toEqual([...KNOWN_ABSOLUTE_COUNT_GUARDS].sort());
  });

  test("#1977's certification guard no longer compares to an absolute count", () => {
    const sql = readMigration(ISSUE_1977_MIGRATION);
    expect(findAbsoluteCountGuards(sql, ISSUE_1977_MIGRATION)).toEqual([]);

    const code = stripSqlComments(sql);
    // The exception name that aborted every apply must be gone from the SQL.
    expect(code).not.toContain("issue_1977_expected_120_certification_requirements");
    expect(code).not.toMatch(/v_count\s*<>\s*120/);
  });

  test("#1977's guard is delta-shaped: baseline captured, net-zero compared, membership asserted", () => {
    const code = stripSqlComments(readMigration(ISSUE_1977_MIGRATION));

    // The baseline must be captured BEFORE the first statement that mutates the
    // requirement table, or the "net zero" it compares against is meaningless.
    const capture = code.indexOf("set_config('mingla.issue_1977_cert_baseline'");
    const firstMutation = code.indexOf(
      "DELETE FROM public.ari_cert_capability_requirements",
    );
    expect(capture).toBeGreaterThan(-1);
    expect(firstMutation).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(firstMutation);

    const guard = code.match(
      /DO \$cert_requirements\$([\s\S]*?)\$cert_requirements\$;/,
    )?.[1];
    expect(guard).toBeDefined();
    const block = guard as string;

    // (4) net zero against the captured baseline, never against a literal
    expect(block).toContain("current_setting('mingla.issue_1977_cert_baseline'");
    expect(block).toContain("v_final <> v_baseline");
    // a missing baseline must abort, not pass vacuously
    expect(block).toContain("issue_1977_certification_baseline_not_captured");
    // (1) the retired duplicate is gone
    expect(block).toContain("capability_id = 'ari.guests.set_approval'");
    // (2) + (3) both write requirements present with evidence_mode='write'
    expect(block).toContain("('ari.rsvp.update', 'write')");
    expect(block).toContain("('ari.rsvp.contribution_settings', 'write')");
    expect(block).toContain("issue_1977_certification_requirement_drift");
  });

  test("#1977 is explicitly retired, not silently pending", () => {
    const sql = readMigration(ISSUE_1977_MIGRATION);
    // The file must say, in its own header, that db push cannot reach it and
    // which reachable versions own its routines — so the next reader does not
    // spend a week discovering it again.
    expect(sql).toContain("RETIRED AS A PRODUCTION DELIVERY VEHICLE");
    expect(sql).toContain("VERSION-SHADOWED");
    expect(sql).toContain("20270615003044");
    expect(sql).toContain("20270616003047");
    expect(sql).toContain("20270617003055");
  });

  test("#3055 delivers the certification delta at a reachable version, self-wrapped", () => {
    const files = migrationFiles();
    const version = ISSUE_3055_MIGRATION.slice(0, 14);

    // Strictly above production's applied head at the time of writing, and above
    // every other version on disk — a shadowed migration is never applied.
    expect(version > "20270616003047").toBe(true);
    for (const name of files) {
      if (name === ISSUE_3055_MIGRATION) continue;
      expect(name.slice(0, 14) < version).toBe(true);
    }
    // No version collision: exactly one file may carry this prefix, or only one
    // of them can ever be stamped and the loser is skipped while the ledger reads
    // clean.
    expect(files.filter((n) => n.startsWith(version))).toHaveLength(1);

    const sql = readMigration(ISSUE_3055_MIGRATION);
    const code = stripSqlComments(sql);

    // Applied via the Management API, which does not wrap a multi-statement body.
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code.indexOf("BEGIN;")).toBeLessThan(code.indexOf("COMMIT;"));

    // Carries all three of #1977's outstanding certification changes.
    expect(code).toContain(
      "DELETE FROM public.ari_cert_capability_requirements",
    );
    expect(code).toContain("'ari.guests.set_approval'");
    expect(code).toContain("'ari.rsvp.update'");
    expect(code).toContain("'ari.rsvp.contribution_settings'");

    // Delta-shaped guard, same contract as #1977's repaired tail.
    expect(code).toContain("set_config('mingla.issue_3055_cert_baseline'");
    expect(code).toContain("current_setting('mingla.issue_3055_cert_baseline'");
    expect(code).toContain("v_final <> v_baseline");
    expect(code).toContain("issue_3055_certification_baseline_not_captured");
    expect(findAbsoluteCountGuards(sql, ISSUE_3055_MIGRATION)).toEqual([]);

    // The immutability trigger must be dropped AND re-armed inside the same
    // transaction, and the guard must prove it was re-armed before COMMIT.
    expect(code).toContain(
      "DROP TRIGGER IF EXISTS ari_cert_capability_requirements_immutable_trigger",
    );
    expect(code).toContain(
      "CREATE TRIGGER ari_cert_capability_requirements_immutable_trigger",
    );
    expect(code).toContain("issue_3055_certification_immutability_trigger_not_rearmed");
  });
});
