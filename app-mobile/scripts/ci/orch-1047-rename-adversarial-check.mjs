#!/usr/bin/env node
/**
 * ORCH-1047 — adversarial regression check (tester).
 *
 * Independent of the happy-path script: attacks different angles.
 *   A-1: strict-grep gate self-check (subprocess) + fails-on-synthetic.
 *   A-2: SQL migration file exists with the new CHECK constraint literal.
 *   A-3: migration body integrity — DROP + UPDATE + new CHECK in same file.
 *   A-4: trigger function body inserts `'brand_owner'`, not the old label.
 *
 * Append-only per ORCH-0840.
 *
 * Run: `node app-mobile/scripts/ci/orch-1047-rename-adversarial-check.mjs`
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");

const failures = [];
const passes = [];
function check(label, cond, detail = "") {
  if (cond) passes.push(label);
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// ── A-1: invoke the new strict-grep gate as a subprocess.
const gatePath = path.join(
  repoRoot,
  ".github/scripts/strict-grep/orch-1047-brand-owner-renamed.mjs",
);
check("A-1a (strict-grep gate file exists)", fs.existsSync(gatePath));

let gateLivePass = false;
try {
  execFileSync("node", [gatePath], { cwd: repoRoot, stdio: "pipe" });
  gateLivePass = true;
} catch (err) {
  gateLivePass = false;
}
check("A-1b (strict-grep gate PASSES on current tree)", gateLivePass);

let gateSelfTestPass = false;
try {
  execFileSync("node", [gatePath, "--self-test"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  gateSelfTestPass = true;
} catch {
  gateSelfTestPass = false;
}
check("A-1c (strict-grep gate self-test passes)", gateSelfTestPass);

// ── A-2: migration file exists + contains the new CHECK constraint.
const migrationsDir = path.join(repoRoot, "supabase/migrations");
const migrationName = fs
  .readdirSync(migrationsDir)
  .find(
    (n) =>
      n.startsWith("20260819000000_orch_1047_") ||
      /20260\d{6}_orch_1047_.*brand_owner.*rename\.sql/.test(n),
  );
check(
  "A-2a (rename migration file present)",
  !!migrationName,
  migrationName ? "" : "no 20260819…orch_1047…rename.sql found",
);

let migrationSrc = "";
if (migrationName) {
  migrationSrc = fs.readFileSync(
    path.join(migrationsDir, migrationName),
    "utf8",
  );
}
check(
  "A-2b (migration contains new CHECK with brand_owner literal)",
  migrationSrc.includes("CHECK (role = ANY (ARRAY[\n    'brand_owner'") ||
    /CHECK \(role = ANY \(ARRAY\[\s*'brand_owner'/.test(migrationSrc),
);

// ── A-3: migration body integrity — DROP CONSTRAINT + UPDATE + new CHECK,
// all in the same transaction.
check(
  "A-3a (migration drops the old role CHECK constraint)",
  /DROP CONSTRAINT IF EXISTS brand_team_members_role_check/.test(migrationSrc),
);
check(
  "A-3b (migration UPDATEs brand_team_members rows to brand_owner)",
  /UPDATE public\.brand_team_members[\s\S]+?SET role = 'brand_owner'[\s\S]+?WHERE role = 'account_owner'/.test(
    migrationSrc,
  ),
);
check(
  "A-3c (migration is wrapped in a single BEGIN/COMMIT transaction)",
  /\bBEGIN;[\s\S]+COMMIT;\s*$/.test(migrationSrc),
);

// ── A-4: trigger function redefined with brand_owner literal in INSERT VALUES.
check(
  "A-4a (migration redefines biz_create_brand_owner_team_member)",
  /CREATE OR REPLACE FUNCTION public\.biz_create_brand_owner_team_member/.test(
    migrationSrc,
  ),
);
check(
  "A-4b (trigger function INSERTs the new 'brand_owner' literal)",
  /VALUES\s*\([\s\S]+?'brand_owner'/.test(migrationSrc),
);
check(
  "A-4c (biz_role_rank redefined with brand_owner = 60)",
  /WHEN 'brand_owner' THEN 60/.test(migrationSrc),
);

// ── Report
console.log("ORCH-1047 adversarial check");
console.log(`  PASS: ${passes.length}`);
console.log(`  FAIL: ${failures.length}`);
if (failures.length > 0) {
  console.error("Failures:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("All ORCH-1047 adversarial tests PASS.");
