#!/usr/bin/env node
/**
 * ORCH-1047 — strict-grep gate enforcing the brand role rename
 * `account_owner` → `brand_owner`.
 *
 * WHY: forensics + product established that "account" is the auth identity
 * (`creator_accounts`) and "brand" is the managed entity. The role on
 * `brand_team_members.role` is per-brand, so the top-of-hierarchy literal
 * MUST be `brand_owner` everywhere — SQL CHECK, RLS, RPCs, TS, UI copy.
 *
 * RULE: zero matches for the literal `account_owner` (case-sensitive) in
 * active source code. Allowlisted surfaces:
 *   - `supabase/migrations/2026050*` baseline squash (audit trail)
 *   - `supabase/migrations/2026051*` + `2026052*` + `2026053*` + `2026060*`
 *     + `2026072*` historical migrations (audit trail; the new
 *     20260819 migration rewrites them at runtime)
 *   - the rename migration itself
 *   - `Mingla_Artifacts/` historical reports + dispatches
 *   - any file with an inline `// orch-strict-grep-allow account_owner`
 *     annotation (explicit opt-out for callers that genuinely need to
 *     reference the dead label for documentation purposes)
 *
 * Self-test (`--self-test`) proves the gate fires on a synthetic file and
 * stays silent on a clean file.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const NEEDLE = "account_owner";

// Roots to walk. Migrations are walked but most files are filtered via
// allowlistMatch below.
const SCAN_ROOTS = [
  "supabase/migrations",
  "supabase/functions",
  "mingla-business/src",
  "mingla-admin/src",
  "app-mobile/src",
  "packages",
];

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
  ".md",
  ".json",
]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".vercel",
  "__tests__",
]);

const HISTORICAL_MIGRATION_PREFIXES = [
  "20260505",
  "20260507",
  "20260511",
  "20260513",
  "20260514",
  "20260526",
  "20260529",
  "20260531",
  "20260602",
  "20260726",
];

const RENAME_MIGRATION_BASENAME =
  "20260819000000_orch_1047_account_owner_to_brand_owner_rename.sql";

const SELF_FILE_BASENAME = "orch-1047-brand-owner-renamed.mjs";

function isAllowlisted(relPath) {
  const base = path.basename(relPath);
  // The rename migration itself documents both labels.
  if (base === RENAME_MIGRATION_BASENAME) return true;
  // This gate script's own name (self-reference safe).
  if (base === SELF_FILE_BASENAME) return true;
  // Historical reports & dispatches — never affect runtime.
  if (relPath.startsWith("Mingla_Artifacts/")) return true;
  // Allow historical migration files that pre-date the rename. Their
  // 'account_owner' literals are audit trail; the new migration rewrites
  // them at runtime. New SQL is required to use brand_owner.
  if (relPath.startsWith("supabase/migrations/")) {
    const migBase = path.basename(relPath);
    if (HISTORICAL_MIGRATION_PREFIXES.some((p) => migBase.startsWith(p))) {
      return true;
    }
  }
  return false;
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (IGNORE_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(full);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name);
      if (EXTENSIONS.has(ext)) yield full;
    }
  }
}

function scanFile(absPath, relPath, failures) {
  if (isAllowlisted(relPath)) return;
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  if (!text.includes(NEEDLE)) return;
  // Line-level scan so we can honor inline allow annotations.
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    if (!line.includes(NEEDLE)) return;
    if (line.includes("orch-strict-grep-allow account_owner")) return;
    failures.push(`${relPath}:${idx + 1}: ${line.trim()}`);
  });
}

function runGate(rootDir) {
  const failures = [];
  for (const rel of SCAN_ROOTS) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const relPath = path.relative(rootDir, file);
      scanFile(file, relPath, failures);
    }
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const tmp = path.join("/tmp", "orch1047-selftest");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, "mingla-business/src/utils"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "supabase/functions/foo"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "supabase/migrations"), { recursive: true });

  // Synthetic clean file — should pass.
  fs.writeFileSync(
    path.join(tmp, "mingla-business/src/utils/brandRole.ts"),
    `export const BRAND_ROLE_RANK = { brand_owner: 60 };\n`,
  );

  // Allowlisted historical migration — should pass even with the needle.
  fs.writeFileSync(
    path.join(tmp, "supabase/migrations/20260505000000_baseline.sql"),
    `-- historical: 'account_owner' was the old label\n`,
  );

  let failures = runGate(tmp);
  if (failures.length !== 0) {
    console.error(
      "ORCH-1047 self-test FAIL: clean tree reported failures:\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }

  // Inject a violating file — should fail.
  fs.writeFileSync(
    path.join(tmp, "supabase/functions/foo/index.ts"),
    `const role = "account_owner";\n`,
  );

  failures = runGate(tmp);
  if (failures.length === 0) {
    console.error(
      "ORCH-1047 self-test FAIL: violating file did NOT trigger the gate",
    );
    process.exit(1);
  }

  // Honor inline opt-out annotation.
  fs.writeFileSync(
    path.join(tmp, "supabase/functions/foo/index.ts"),
    `// the old role was account_owner // orch-strict-grep-allow account_owner\n`,
  );
  failures = runGate(tmp);
  if (failures.length !== 0) {
    console.error(
      "ORCH-1047 self-test FAIL: inline allow annotation did not suppress:\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("ORCH-1047 gate self-test PASS (3/3 cases).");
  process.exit(0);
}

// ---- Live mode
const failures = runGate(root);
if (failures.length > 0) {
  console.error(
    `ORCH-1047 gate FAIL — ${failures.length} match(es) for the dead label "account_owner" in active source code.\n` +
      `The role was renamed to "brand_owner" by migration ${RENAME_MIGRATION_BASENAME}.\n` +
      `Update each call site to use "brand_owner", or add an inline\n` +
      `\`// orch-strict-grep-allow account_owner\` annotation if the reference\n` +
      `is genuinely documentation-only.\n\nMatches:\n${failures.join("\n")}`,
  );
  process.exit(1);
}

console.log("ORCH-1047 gate PASS — no stale account_owner references found.");
