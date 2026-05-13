#!/usr/bin/env node

/**
 * I-ARI-USER-JWT-ONLY (ORCH-0821 invariant)
 *
 * Ari's tool executors MUST use the caller's JWT, never the service role
 * key. Service role bypasses RLS — a single accidental reference in the
 * write path defeats every other cross-tenant safeguard.
 *
 * Scope: supabase/functions/agent-chat/, supabase/functions/agent-confirm-action/
 *
 * Whitelist: _shared/agentRateLimit.ts is the SOLE module allowed to read
 * SUPABASE_SERVICE_ROLE_KEY — it queries SYSTEM tables (rate-limit row counts)
 * which legitimately need admin scope. The agent-chat handler imports
 * `buildServiceClient` from there, NOT the env var itself. Tool executors
 * receive `userClient` (built from the caller's Authorization header) — they
 * never touch service role.
 *
 * This gate scans only the two edge function bodies. Any appearance of
 * SUPABASE_SERVICE_ROLE_KEY, service_role, or createClient with service
 * credentials in those files is a violation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_FILES = [
  "supabase/functions/agent-chat/index.ts",
  "supabase/functions/agent-confirm-action/index.ts",
];

const FORBIDDEN_PATTERNS = [
  { name: "SUPABASE_SERVICE_ROLE_KEY env read", regex: /SUPABASE_SERVICE_ROLE_KEY/ },
  { name: "service_role literal", regex: /service_role/i },
  { name: "serviceRoleKey identifier", regex: /serviceRoleKey/ },
];

const violations = [];
let filesScanned = 0;

for (const rel of TARGET_FILES) {
  const abs = path.join(repoRoot, rel);
  let source;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch (err) {
    console.error(`I-ARI-USER-JWT-ONLY ERROR: could not read ${rel}: ${err.message}`);
    process.exit(2);
  }
  filesScanned++;
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { name, regex } of FORBIDDEN_PATTERNS) {
      if (regex.test(line)) {
        violations.push({
          file: rel,
          line: index + 1,
          pattern: name,
          text: line.trim(),
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    "I-ARI-USER-JWT-ONLY violation: Ari edge function handlers must use caller JWT only.",
  );
  console.error(
    "Service role usage is whitelisted ONLY in supabase/functions/_shared/agentRateLimit.ts",
  );
  console.error(
    "(system-table reads for the rate-limit gate, NOT tool execution).",
  );
  console.error(
    "Fix: replace any service-role client with the user-scoped client built from the Authorization header.",
  );
  console.error(
    "Cross-reference: ARI_DESIGN.md §10.2 C-class threats, SPEC_ORCH-0821 §8.2 I-ARI-USER-JWT-ONLY.",
  );
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.pattern}]  ${v.text}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} file(s); found ${violations.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  `I-ARI-USER-JWT-ONLY OK: scanned ${filesScanned} file(s); no service-role references in Ari handlers.`,
);
process.exit(0);
