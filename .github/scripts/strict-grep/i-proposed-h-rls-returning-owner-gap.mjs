#!/usr/bin/env node
/**
 * I-PROPOSED-H strict-grep gate — RLS-RETURNING-OWNER-GAP-PREVENTED.
 *
 * Per Mingla_Artifacts/specs/SPEC_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md §5
 * + INVARIANT_REGISTRY I-PROPOSED-H — registry pattern.
 *
 * Closes RC-0728 (RLS-RETURNING-OWNER-GAP). Bug class: supabase-js mutations
 * on RLS-gated tables fail with code 42501 even when the mutation policy's
 * WITH CHECK passes — because (a) RETURNING (default for .insert/.update/
 * .delete chained with .select()) evaluates SELECT policies on the
 * post-mutation row, and (b) UPDATE WITH CHECK evaluates against the new
 * row state. If those evaluations route through SECURITY DEFINER helpers
 * with snapshot quirks or column-gate dependencies, mutations roll back.
 * The fix pattern: pair every owner-callable mutation policy with a
 * direct-predicate (auth.uid()-based) owner-SELECT (and direct-predicate
 * owner-UPDATE for soft-delete) that bypasses SECURITY DEFINER helpers.
 *
 * Gate logic:
 *   For every CREATE POLICY ... FOR (INSERT|UPDATE|DELETE) on public.*
 *   in supabase/migrations/*.sql:
 *     The same table MUST have at least one CREATE POLICY ... FOR SELECT
 *     somewhere in supabase/migrations/ whose USING clause uses auth.uid()
 *     directly AND does not route exclusively through a SECURITY DEFINER
 *     helper (matched as biz_*_for_caller(...) pattern).
 *   Unless the migration explicitly waives the rule with the magic comment:
 *     -- I-RLS-OWNER-GAP-WAIVER: <ORCH-ID> <reason>
 *   immediately above the CREATE POLICY statement (within ~3 lines).
 *
 * The waiver mechanism exists for genuinely service-role-only tables (e.g.,
 * audit_log) where direct-predicate owner-SELECT doesn't make sense.
 *
 * Detection approach: regex-based parsing. CREATE POLICY syntax in our
 * migrations is stylized + multi-line but predictable; a SQL AST parser
 * (libpg_query) would be safer but adds a heavy dependency. Regex is
 * sufficient given the consistent local style.
 *
 * Self-test:
 *   node i-proposed-h-rls-returning-owner-gap.mjs --self-test
 *   → creates synthetic violating + passing migrations in a temp dir,
 *     asserts the gate FAILS on violation and PASSES on compliance,
 *     cleans up, exits 0 if both behaviours hold.
 *
 * Exit codes:
 *   0 — no violations (clean) OR self-test passed
 *   1 — at least one violation OR self-test failed
 *   2 — script error (file system error, parse failure)
 *
 * Established by: ORCH-0734 SPEC §5 + DEC-XXX [DEC ID confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const DEFAULT_MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const WAIVER_TAG = "I-RLS-OWNER-GAP-WAIVER";

// Going-forward enforcement only.
// The invariant exists from ORCH-0734 onward. Pre-existing migrations
// (the squash baseline 20260505000000 and earlier) capture historical
// state where the bug class was discovered but not yet fixed across the
// entire schema. They contain ~35 legacy mutation policies on out-of-scope
// tables (events, orders, ticket_types, admin_*, etc.) that lack matching
// direct-predicate owner-SELECT policies — those are real bugs but were
// out of ORCH-0734 scope. Future cycles (ORCH-0735+) audit them.
//
// Cutoff: migration filenames whose 14-digit timestamp prefix is >= this
// value are scanned. Earlier migrations are exempt.
const CUTOFF_TIMESTAMP = "20260507000000";

// Match `CREATE POLICY "name" ON [public.|"public".]tablename FOR (INSERT|UPDATE|DELETE|SELECT) ...`
// across multiple lines until the next semicolon. Tolerates both forms:
//   ON public.brands ...
//   ON "public"."brands" ...
// The schema qualifier is optional (defaults to public).
const POLICY_PATTERN = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+(?:AS\s+(?:PERMISSIVE|RESTRICTIVE)\s+)?FOR\s+(INSERT|UPDATE|DELETE|SELECT)\b([\s\S]*?);/gi;

// Within a captured policy body, find USING clause text (everything after USING up to
// next clause keyword or end). Returns string or null.
function extractUsingClause(body) {
  const match = body.match(/\bUSING\s*\(([\s\S]*?)\)\s*(?:WITH\s+CHECK|;|$)/i);
  return match ? match[1] : null;
}

// True if a USING clause looks like a direct-predicate owner check:
//   - contains auth.uid() OR auth.role()
//   - AND does NOT route exclusively via biz_*_for_caller helper
//     (i.e., contains auth.uid() OUTSIDE of any helper-call wrapper)
//
// Permissive check: if the predicate text contains `auth.uid()` and
// doesn't only appear inside `biz_*_for_caller(... auth.uid() ...)`, we
// consider it direct. We approximate by stripping helper-call invocations
// and checking if `auth.uid()` remains.
function isDirectPredicateUsing(usingText) {
  if (!usingText) return false;
  // Strip biz_*_for_caller(...) and "biz_*_for_caller"(...) invocations
  // (handles both quoted and unquoted forms in the squash baseline).
  let stripped = usingText.replace(/"?biz_[a-z_]+_for_caller"?\s*\([^()]*\)/gi, "<HELPER>");
  // auth.uid() or "auth"."uid"() — both forms accepted as direct predicates.
  return /(?:\bauth\.uid\s*\(\s*\)|"auth"\."uid"\s*\(\s*\))/i.test(stripped);
}

function readSqlFiles(dir, opts = {}) {
  const { applyCutoff = true } = opts;
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return out;
    throw e;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile() || !name.endsWith(".sql")) continue;
    // Going-forward enforcement: skip migrations earlier than the cutoff
    // unless we're in self-test mode (where we control the fixture filenames).
    if (applyCutoff) {
      const tsMatch = name.match(/^(\d{14})_/);
      if (tsMatch && tsMatch[1] < CUTOFF_TIMESTAMP) continue;
    }
    out.push(full);
  }
  return out;
}

function findWaiverAbove(source, matchIndex) {
  // Look at the ~6 lines preceding matchIndex for the waiver tag.
  const slice = source.slice(Math.max(0, matchIndex - 600), matchIndex);
  return slice.includes(WAIVER_TAG);
}

function audit(migrationsDir, opts = {}) {
  const files = readSqlFiles(migrationsDir, opts);
  // Collect: per-table, the set of mutations declared and the set of
  // direct-predicate SELECTs declared.
  // We accumulate ACROSS ALL files (a SELECT policy can be in a different
  // migration than the mutation policy — both being applied means current
  // DB state has both).
  const mutationsByTable = new Map(); // table -> [{file, line, cmd, name, hasWaiver}]
  const directSelectsByTable = new Map(); // table -> count

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const matches = source.matchAll(POLICY_PATTERN);
    for (const m of matches) {
      const policyName = m[1];
      const tableName = m[2].toLowerCase();
      const cmd = m[3].toUpperCase();
      const body = m[4];
      const lineNumber = source.slice(0, m.index).split("\n").length;

      if (cmd === "SELECT") {
        const using = extractUsingClause(body);
        if (isDirectPredicateUsing(using)) {
          directSelectsByTable.set(tableName, (directSelectsByTable.get(tableName) ?? 0) + 1);
        }
      } else if (cmd === "INSERT" || cmd === "UPDATE" || cmd === "DELETE") {
        const hasWaiver = findWaiverAbove(source, m.index);
        if (!mutationsByTable.has(tableName)) mutationsByTable.set(tableName, []);
        mutationsByTable.get(tableName).push({ file, line: lineNumber, cmd, name: policyName, hasWaiver });
      }
    }
  }

  const violations = [];
  for (const [table, mutations] of mutationsByTable.entries()) {
    const directSelectCount = directSelectsByTable.get(table) ?? 0;
    if (directSelectCount === 0) {
      // For each mutation, check waiver. If all mutations on this table are
      // waivered, no violation. Otherwise, every non-waivered mutation is a
      // violation.
      for (const mut of mutations) {
        if (!mut.hasWaiver) {
          violations.push({
            table,
            file: mut.file,
            line: mut.line,
            cmd: mut.cmd,
            policyName: mut.name,
          });
        }
      }
    }
  }

  return { violations, mutationsByTable, directSelectsByTable };
}

function reportViolations(violations) {
  if (violations.length === 0) {
    console.log("[I-PROPOSED-H] PASS — no RLS-RETURNING-OWNER-GAP violations found.");
    return 0;
  }
  console.error("[I-PROPOSED-H] FAIL — " + violations.length + " violation(s):");
  console.error("");
  for (const v of violations) {
    const rel = v.file.replace(REPO_ROOT + sep, "");
    console.error("  " + rel + ":" + v.line + " — public." + v.table + " has " + v.cmd + " policy \"" + v.policyName + "\" but no direct-predicate owner-SELECT policy admits the post-mutation row.");
  }
  console.error("");
  console.error("Fix: add a CREATE POLICY ... FOR SELECT TO authenticated USING (<col> = auth.uid()) on the same table, OR waive with a comment immediately above the violating policy:");
  console.error("    -- " + WAIVER_TAG + ": <ORCH-ID> <reason>");
  console.error("");
  console.error("Why: Postgres evaluates SELECT policies during INSERT...RETURNING and UPDATE WITH CHECK in subtle ways. SECURITY DEFINER helper functions (e.g., biz_*_for_caller) can fail to admit just-INSERTed rows or rows whose post-mutation state has deleted_at IS NOT NULL. Direct-predicate owner-SELECT policies bypass these failure modes. See INVARIANT_REGISTRY I-PROPOSED-H + RC-0728.");
  return 1;
}

async function selfTest() {
  const tmpRoot = mkdtempSync(join(tmpdir(), "i-proposed-h-test-"));
  let exitCode = 0;
  try {
    // Test 1: violating migration → gate must FAIL.
    const violDir = join(tmpRoot, "violating");
    const passDir = join(tmpRoot, "passing");
    const waiverDir = join(tmpRoot, "waiver");
    for (const d of [violDir, passDir, waiverDir]) {
      try { statSync(d); } catch { /* continue */ }
    }
    // Use mkdir-equivalent via writeFileSync into a path; Node will fail without
    // the directory, so we use mkdirSync.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(violDir, { recursive: true });
    mkdirSync(passDir, { recursive: true });
    mkdirSync(waiverDir, { recursive: true });

    // 1. Violating: INSERT policy with no direct-predicate owner SELECT.
    writeFileSync(
      join(violDir, "001_violation.sql"),
      `CREATE POLICY "Bad insert" ON public.test_table FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());\n` +
      `CREATE POLICY "Helper-only select" ON public.test_table FOR SELECT TO authenticated USING (biz_is_owner_for_caller(id));\n`,
    );
    const violResult = audit(violDir, { applyCutoff: false });
    if (violResult.violations.length === 0) {
      console.error("[SELF-TEST] FAIL — violating fixture should have produced a violation but produced 0.");
      exitCode = 1;
    } else {
      console.log("[SELF-TEST] PASS — violating fixture produced " + violResult.violations.length + " violation(s) as expected.");
    }

    // 2. Passing: INSERT policy + direct-predicate owner SELECT.
    writeFileSync(
      join(passDir, "002_passing.sql"),
      `CREATE POLICY "Owner insert" ON public.test_table FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());\n` +
      `CREATE POLICY "Owner select" ON public.test_table FOR SELECT TO authenticated USING (account_id = auth.uid());\n`,
    );
    const passResult = audit(passDir, { applyCutoff: false });
    if (passResult.violations.length !== 0) {
      console.error("[SELF-TEST] FAIL — passing fixture should have produced 0 violations but produced " + passResult.violations.length + ".");
      for (const v of passResult.violations) console.error("  unexpected violation: public." + v.table + " " + v.cmd);
      exitCode = 1;
    } else {
      console.log("[SELF-TEST] PASS — passing fixture produced 0 violations as expected.");
    }

    // 3. Waiver: violating policy with magic comment immediately above → gate must PASS.
    writeFileSync(
      join(waiverDir, "003_waiver.sql"),
      `-- I-RLS-OWNER-GAP-WAIVER: ORCH-XXX service-role-only audit table\n` +
      `CREATE POLICY "Service role insert" ON public.test_table FOR INSERT TO authenticated WITH CHECK (true);\n`,
    );
    const waiverResult = audit(waiverDir, { applyCutoff: false });
    if (waiverResult.violations.length !== 0) {
      console.error("[SELF-TEST] FAIL — waiver fixture should have produced 0 violations but produced " + waiverResult.violations.length + ".");
      exitCode = 1;
    } else {
      console.log("[SELF-TEST] PASS — waiver fixture produced 0 violations as expected.");
    }

    if (exitCode === 0) {
      console.log("");
      console.log("[SELF-TEST] ALL THREE FIXTURES PASSED — gate behaves correctly.");
    } else {
      console.error("");
      console.error("[SELF-TEST] AT LEAST ONE FIXTURE FAILED — see above.");
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  return exitCode;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    process.exit(await selfTest());
  }
  const dir = args[0] ?? DEFAULT_MIGRATIONS_DIR;
  console.log("[I-PROPOSED-H] Auditing " + dir + " ...");
  let result;
  try {
    result = audit(dir);
  } catch (e) {
    console.error("[I-PROPOSED-H] Script error: " + (e.message ?? e));
    process.exit(2);
  }
  const tableCount = result.mutationsByTable.size;
  const selectCount = [...result.directSelectsByTable.values()].reduce((a, b) => a + b, 0);
  console.log("[I-PROPOSED-H] Scanned " + tableCount + " table(s) with mutation policies; found " + selectCount + " direct-predicate owner-SELECT policy/policies across all tables.");
  process.exit(reportViolations(result.violations));
}

main().catch((e) => {
  console.error("[I-PROPOSED-H] Unhandled error: " + (e.stack ?? e));
  process.exit(2);
});
