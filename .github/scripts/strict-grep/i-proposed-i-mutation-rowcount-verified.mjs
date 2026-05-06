#!/usr/bin/env node
/**
 * I-PROPOSED-I strict-grep gate — MUTATION-ROWCOUNT-VERIFIED.
 *
 * Per Mingla_Artifacts/specs/SPEC_ORCH_0734_REWORK_DELETE_FIX.md §5
 * + INVARIANT_REGISTRY I-PROPOSED-I — registry pattern.
 *
 * Closes RC-0734-RW-A (silent 0-row mutation). Bug class: supabase-js mutations
 * that target a specific row by ID (.eq("id", X) style) silently return success
 * when 0 rows match (RLS denial / wrong ID / already-mutated state). Without
 * .select() chain, supabase-js returns no error AND no rowcount info — the
 * service code can't distinguish "1 row updated" from "0 rows updated."
 * Result: false-positive UX feedback (green Toast for a no-op).
 *
 * The fix pattern: every mutation against a specific row by ID MUST chain
 * .select(...) (or .maybeSingle() / .single()) so the service can verify
 * rowcount > 0 and throw a structured error on 0-row no-ops.
 *
 * Gate logic (scope: mingla-business/src/services/*.ts):
 *   For every `.update(` or `.delete(` call expression:
 *     If the chain (within ~30 lines downstream) does NOT include
 *     `.select(`, `.single(`, or `.maybeSingle(` → VIOLATION
 *   Unless the mutation has a magic waiver comment within ~3 lines above:
 *     `// I-MUTATION-ROWCOUNT-WAIVER: <ORCH-ID> <reason>`
 *   The waiver mechanism exists for genuinely fire-and-forget cleanup
 *   mutations where rowcount verification doesn't make sense (e.g.,
 *   bulk-cleanup operations idempotent by design).
 *
 * Detection approach: regex-based parsing of TypeScript builder chains.
 * supabase-js call chains are stylized + readable; regex is sufficient.
 *
 * Self-test:
 *   node i-proposed-i-mutation-rowcount-verified.mjs --self-test
 *   → creates synthetic violating + passing + waivered fixture services in
 *     a temp dir, asserts the gate FAILS on violation and PASSES on
 *     compliance/waiver, cleans up, exits 0 if all three behaviours hold.
 *
 * Exit codes:
 *   0 — no violations (clean) OR self-test passed
 *   1 — at least one violation OR self-test failed
 *   2 — script error (file system error, parse failure)
 *
 * Established by: ORCH-0734 REWORK SPEC §5 + DEC-XXX [DEC ID confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const DEFAULT_SCAN_DIR = join(REPO_ROOT, "mingla-business", "src", "services");
const WAIVER_TAG = "I-MUTATION-ROWCOUNT-WAIVER";

// Look-window for downstream chain methods — most chains finish within ~30
// lines. We scan that many lines after the .update(/.delete( call before
// concluding "no .select()" was chained.
const CHAIN_LOOKAHEAD_LINES = 30;

// Match `.update(` or `.delete(` at the start of a method-call chain link.
// Excludes nested matches by requiring boundary characters before the dot.
const MUTATION_PATTERN = /(?<![A-Za-z0-9_$])\.(update|delete)\s*\(/g;

// Match `.select(`, `.single(`, or `.maybeSingle(` anywhere in a chain.
const RETURNING_PATTERN = /\.(select|single|maybeSingle)\s*\(/;

function readTsFiles(dir) {
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
    if (st.isDirectory()) {
      out.push(...readTsFiles(full));
    } else if (st.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

function findWaiverAbove(lines, lineIndex) {
  // Scan up to 3 lines above lineIndex for the waiver tag.
  const start = Math.max(0, lineIndex - 3);
  for (let i = start; i < lineIndex; i++) {
    if (lines[i].includes(WAIVER_TAG)) return true;
  }
  return false;
}

function audit(scanDir) {
  const files = readTsFiles(scanDir);
  const violations = [];
  let totalMutationsFound = 0;
  let totalCompliantChains = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");

    // Find every .update( or .delete( in the file.
    let match;
    const pattern = new RegExp(MUTATION_PATTERN.source, "g");
    while ((match = pattern.exec(source)) !== null) {
      totalMutationsFound++;
      const op = match[1]; // "update" or "delete"
      const charIndex = match.index;
      const lineNumber = source.slice(0, charIndex).split("\n").length;
      const lineIndex = lineNumber - 1; // 0-based

      // Look ahead within CHAIN_LOOKAHEAD_LINES for .select(/.single(/.maybeSingle(.
      // We stop the chain at the next semicolon at top level (heuristic: line
      // ending with ";" not preceded by an open paren).
      let chainEnd = Math.min(lines.length, lineIndex + CHAIN_LOOKAHEAD_LINES);
      let foundReturning = false;
      let semicolonBreak = false;
      for (let i = lineIndex; i < chainEnd; i++) {
        const ln = lines[i];
        if (RETURNING_PATTERN.test(ln)) {
          foundReturning = true;
          break;
        }
        // Stop at semicolon-terminated chain (statement end)
        // Only count semicolon AFTER we've seen the .update(/.delete( on this
        // line or after, and only if the line ends with ; (not in a string).
        if (i > lineIndex && /;\s*(\/\/|$)/.test(ln) && !ln.includes(`.${op}(`)) {
          semicolonBreak = true;
          break;
        }
      }

      if (foundReturning) {
        totalCompliantChains++;
        continue;
      }

      // Check for waiver above the mutation line.
      const hasWaiver = findWaiverAbove(lines, lineIndex);
      if (hasWaiver) {
        totalCompliantChains++;
        continue;
      }

      violations.push({
        file,
        line: lineNumber,
        op,
        snippet: lines[lineIndex].trim().slice(0, 120),
      });
    }
  }

  return { violations, totalMutationsFound, totalCompliantChains };
}

function reportViolations(violations) {
  if (violations.length === 0) {
    console.log("[I-PROPOSED-I] PASS — no MUTATION-ROWCOUNT-VERIFIED violations found.");
    return 0;
  }
  console.error("[I-PROPOSED-I] FAIL — " + violations.length + " violation(s):");
  console.error("");
  for (const v of violations) {
    const rel = v.file.replace(REPO_ROOT + sep, "");
    console.error("  " + rel + ":" + v.line + " — `." + v.op + "(...)` chain has no `.select(/.single(/.maybeSingle(` and no waiver comment.");
    console.error("    " + v.snippet);
  }
  console.error("");
  console.error("Fix: chain `.select(\"id\")` (or .single() / .maybeSingle()) after .update() or .delete() so the service can verify rowcount > 0. Without it, supabase-js silently treats 0-row mutations as success — RC-0734-RW-A.");
  console.error("");
  console.error("Or waive with a comment immediately above (within 3 lines):");
  console.error("    // " + WAIVER_TAG + ": <ORCH-ID> <reason>");
  console.error("");
  console.error("See INVARIANT_REGISTRY I-PROPOSED-I + RC-0734-RW-A for the full rationale.");
  return 1;
}

async function selfTest() {
  const tmpRoot = mkdtempSync(join(tmpdir(), "i-proposed-i-test-"));
  let exitCode = 0;
  try {
    const violDir = join(tmpRoot, "violating");
    const passDir = join(tmpRoot, "passing");
    const waiverDir = join(tmpRoot, "waiver");
    mkdirSync(violDir, { recursive: true });
    mkdirSync(passDir, { recursive: true });
    mkdirSync(waiverDir, { recursive: true });

    // 1. Violating: .update() with no .select() chain.
    writeFileSync(
      join(violDir, "violatingService.ts"),
      [
        "import { supabase } from './supabase';",
        "export async function violatingService(brandId: string): Promise<void> {",
        "  const { error } = await supabase",
        "    .from('brands')",
        "    .update({ deleted_at: new Date().toISOString() })",
        "    .eq('id', brandId);",
        "  if (error) throw error;",
        "}",
      ].join("\n"),
    );
    const violResult = audit(violDir);
    if (violResult.violations.length === 0) {
      console.error("[SELF-TEST] FAIL — violating fixture should have produced a violation but produced 0.");
      exitCode = 1;
    } else {
      console.log("[SELF-TEST] PASS — violating fixture produced " + violResult.violations.length + " violation(s) as expected.");
    }

    // 2. Passing: .update() with .select() chain.
    writeFileSync(
      join(passDir, "passingService.ts"),
      [
        "import { supabase } from './supabase';",
        "export async function passingService(brandId: string): Promise<void> {",
        "  const { data, error } = await supabase",
        "    .from('brands')",
        "    .update({ deleted_at: new Date().toISOString() })",
        "    .eq('id', brandId)",
        "    .select('id');",
        "  if (error) throw error;",
        "  if (data === null || data.length === 0) throw new Error('0 rows');",
        "}",
      ].join("\n"),
    );
    const passResult = audit(passDir);
    if (passResult.violations.length !== 0) {
      console.error("[SELF-TEST] FAIL — passing fixture should have produced 0 violations but produced " + passResult.violations.length + ".");
      for (const v of passResult.violations) console.error("  unexpected violation: " + v.file + ":" + v.line + " " + v.op);
      exitCode = 1;
    } else {
      console.log("[SELF-TEST] PASS — passing fixture produced 0 violations as expected.");
    }

    // 3. Waiver: .update() with no .select() but with magic comment.
    writeFileSync(
      join(waiverDir, "waiverService.ts"),
      [
        "import { supabase } from './supabase';",
        "export async function waiverService(): Promise<void> {",
        "  // I-MUTATION-ROWCOUNT-WAIVER: ORCH-XXX bulk-cleanup mutation, idempotent by design",
        "  const { error } = await supabase",
        "    .from('cleanup_table')",
        "    .delete()",
        "    .lt('expires_at', new Date().toISOString());",
        "  if (error) throw error;",
        "}",
      ].join("\n"),
    );
    const waiverResult = audit(waiverDir);
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
  const dir = args[0] ?? DEFAULT_SCAN_DIR;
  console.log("[I-PROPOSED-I] Auditing " + dir + " ...");
  let result;
  try {
    result = audit(dir);
  } catch (e) {
    console.error("[I-PROPOSED-I] Script error: " + (e.message ?? e));
    process.exit(2);
  }
  console.log(
    "[I-PROPOSED-I] Scanned " +
      result.totalMutationsFound +
      " mutation site(s); " +
      result.totalCompliantChains +
      " compliant; " +
      result.violations.length +
      " violation(s).",
  );
  process.exit(reportViolations(result.violations));
}

main().catch((e) => {
  console.error("[I-PROPOSED-I] Unhandled error: " + (e.stack ?? e));
  process.exit(2);
});
