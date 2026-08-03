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
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(fileEntries, failures)` is exercised with a GOOD fixture
 * (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The disk-reading
 * main path calls the SAME `check(...)`; the refactor is behavior-preserving
 * (identical verdict on the real tree).
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

/**
 * Pure verdict. `fileEntries` = [{ file, content }] (file = repo-relative path
 * for reporting). Pushes one violation record per offending line into
 * `failures`. Behavior-preserving refactor of the original per-line scan.
 */
function check(fileEntries, failures) {
  for (const { file, content } of fileEntries) {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { name, regex } of FORBIDDEN_PATTERNS) {
        if (regex.test(line)) {
          failures.push({
            file,
            line: index + 1,
            pattern: name,
            text: line.trim(),
          });
        }
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: agent-chat imports the whitelisted buildServiceClient (no forbidden
  // token) and both executors use a caller-JWT userClient → silent.
  const goodEntries = [
    {
      file: "supabase/functions/agent-chat/index.ts",
      content:
        'import { buildServiceClient } from "../_shared/agentRateLimit.ts";\n' +
        'const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });\n' +
        'await userClient.from("brands").select("id");\n',
    },
    {
      file: "supabase/functions/agent-confirm-action/index.ts",
      content:
        'const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });\n' +
        'await userClient.rpc("apply_action");\n',
    },
  ];
  let f = [];
  check(goodEntries, f);
  if (f.length) {
    self.push(
      "GOOD fixture wrongly flagged: " + f.map((v) => `${v.file}:${v.line}`).join("; "),
    );
  }

  // BAD1 (revert-style): a direct SUPABASE_SERVICE_ROLE_KEY read re-added to the
  // agent-chat body → fires.
  const bad1 = [
    {
      file: "supabase/functions/agent-chat/index.ts",
      content:
        'const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));\n',
    },
  ];
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (SUPABASE_SERVICE_ROLE_KEY read in agent-chat) not flagged");

  // BAD2 (regression, different angle): a createClient built with a
  // serviceRoleKey identifier inside agent-confirm-action → fires.
  const bad2 = [
    {
      file: "supabase/functions/agent-confirm-action/index.ts",
      content: "const svc = createClient(url, serviceRoleKey);\n",
    },
  ];
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (serviceRoleKey createClient in agent-confirm-action) not flagged");

  if (self.length) {
    console.error("I-ARI-USER-JWT-ONLY self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-ARI-USER-JWT-ONLY self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const fileEntries = [];
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
  fileEntries.push({ file: rel, content: source });
}

const violations = [];
check(fileEntries, violations);

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
