#!/usr/bin/env node

/**
 * I-VE5-PARSE-MENU-USER-JWT-ONLY (ORCH-0881)
 *
 * parse-restaurant-menu must use caller JWT only — no service role.
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

const violations = [];

for (const rel of TARGET_FILES) {
  const abs = path.join(repoRoot, rel);
  const source = fs.readFileSync(abs, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { name, regex } of FORBIDDEN_PATTERNS) {
      if (regex.test(line)) {
        violations.push({ file: rel, line: index + 1, name, text: line.trim() });
      }
    }
  });
}

if (violations.length > 0) {
  console.error("I-VE5-PARSE-MENU-USER-JWT-ONLY FAILED:");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.name}: ${v.text}`);
  }
  process.exit(1);
}

console.log(`I-VE5-PARSE-MENU-USER-JWT-ONLY OK (${TARGET_FILES.length} files scanned)`);
