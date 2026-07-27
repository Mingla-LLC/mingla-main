#!/usr/bin/env node

/**
 * I-VE5-PARSE-MENU-USER-JWT-ONLY (ORCH-0881)
 *
 * parse-restaurant-menu must use caller JWT only — no service role.
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(fileEntries, failures)` is exercised with a GOOD fixture
 * (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The disk-reading
 * main path calls the SAME `check(...)`; behavior-preserving refactor.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_FILES = [
  "supabase/functions/parse-restaurant-menu/index.ts",
];

const FORBIDDEN_PATTERNS = [
  { name: "SUPABASE_SERVICE_ROLE_KEY env read", regex: /SUPABASE_SERVICE_ROLE_KEY/ },
  { name: "service_role literal", regex: /service_role/i },
  { name: "serviceRoleKey identifier", regex: /serviceRoleKey/ },
];

/**
 * Pure verdict. `fileEntries` = [{ file, content }]. Pushes one violation
 * record per offending line into `failures`. Behavior-preserving refactor of
 * the original per-line scan.
 */
function check(fileEntries, failures) {
  for (const { file, content } of fileEntries) {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { name, regex } of FORBIDDEN_PATTERNS) {
        if (regex.test(line)) {
          failures.push({ file, line: index + 1, name, text: line.trim() });
        }
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: caller-JWT client only → silent.
  const goodEntries = [
    {
      file: "supabase/functions/parse-restaurant-menu/index.ts",
      content:
        'const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });\n' +
        'await userClient.from("places").select("id");\n',
    },
  ];
  let f = [];
  check(goodEntries, f);
  if (f.length) {
    self.push("GOOD fixture wrongly flagged: " + f.map((v) => `${v.file}:${v.line}`).join("; "));
  }

  // BAD1 (revert-style): a SUPABASE_SERVICE_ROLE_KEY env read re-added → fires.
  const bad1 = [
    {
      file: "supabase/functions/parse-restaurant-menu/index.ts",
      content: 'const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));\n',
    },
  ];
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (SUPABASE_SERVICE_ROLE_KEY read) not flagged");

  // BAD2 (regression, different angle): an inline createClient with a
  // serviceRoleKey identifier → fires.
  const bad2 = [
    {
      file: "supabase/functions/parse-restaurant-menu/index.ts",
      content: "const svc = createClient(url, serviceRoleKey);\n",
    },
  ];
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (serviceRoleKey createClient) not flagged");

  if (self.length) {
    console.error("I-VE5-PARSE-MENU-USER-JWT-ONLY self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-VE5-PARSE-MENU-USER-JWT-ONLY self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const fileEntries = [];
for (const rel of TARGET_FILES) {
  const abs = path.join(repoRoot, rel);
  const source = fs.readFileSync(abs, "utf8");
  fileEntries.push({ file: rel, content: source });
}

const violations = [];
check(fileEntries, violations);

if (violations.length > 0) {
  console.error("I-VE5-PARSE-MENU-USER-JWT-ONLY FAILED:");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.name}: ${v.text}`);
  }
  process.exit(1);
}

console.log(`I-VE5-PARSE-MENU-USER-JWT-ONLY OK (${TARGET_FILES.length} files scanned)`);
