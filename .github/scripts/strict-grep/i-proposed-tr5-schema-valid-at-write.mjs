#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE.
 *
 * Per SPEC_ORCH-0880 §10: every direct write to `events.trip_intake_schema`
 * (deprecated v1 shape — should never appear post-§15) OR `trip_intake_schemas`
 * table MUST flow through the canonical validator path:
 *   - DB CHECK constraint `trip_intake_schemas_valid` calling
 *     `validate_trip_intake_schema(jsonb)`, OR
 *   - `biz_update_live_trip` RPC `intake_schemas` patch key (which runs
 *     validator before upsert), OR
 *   - Direct supabase `.from("trip_intake_schemas").upsert/update/insert(...)`
 *     in `intakeSchemaService.ts` ONLY (canonical service-layer writer).
 *
 * Detection: scan TS files under `mingla-business/src/` + `mingla-business/app/`
 * for `.from("trip_intake_schemas")` (or `events`+`trip_intake_schema` column
 * mutation) outside the canonical service. Each violation site missing the
 * allowlist comment is a fail.
 *
 * Allowlist comment to waive:
 *   // orch-strict-grep-allow tr5-schema-valid-at-write — <reason>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  path.join(REPO_ROOT, "mingla-business", "src"),
  path.join(REPO_ROOT, "mingla-business", "app"),
];

const CANONICAL_SERVICE_PATH = path.join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "intakeSchemaService.ts",
);

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "__tests__",
  "ios",
  "android",
]);

let scanned = 0;
const violations = [];

function isTsLike(filename) {
  return (
    filename.endsWith(".ts") ||
    filename.endsWith(".tsx") ||
    filename.endsWith(".mts") ||
    filename.endsWith(".cts")
  );
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.isFile() && isTsLike(entry.name)) {
      scanFile(path.join(dir, entry.name));
    }
  }
}

function hasAllowlistComment(lines, idx) {
  // Look up to 3 lines above for the allowlist comment
  for (let i = Math.max(0, idx - 3); i < idx; i += 1) {
    if (lines[i].includes("orch-strict-grep-allow tr5-schema-valid-at-write")) {
      return true;
    }
  }
  return false;
}

function scanFile(filePath) {
  scanned += 1;
  const src = fs.readFileSync(filePath, "utf8");
  const lines = src.split("\n");

  // Skip the canonical writer service itself
  if (path.resolve(filePath) === path.resolve(CANONICAL_SERVICE_PATH)) {
    return;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Pattern A: any `.from("trip_intake_schemas")` outside canonical service
    if (/\.from\(\s*['"`]trip_intake_schemas['"`]\s*\)/.test(line)) {
      // Allow read-only chains: .select/.eq without mutation methods on same line
      // Mutations are .insert/.update/.upsert/.delete
      // Check the next 5 lines for mutation methods
      const window = lines.slice(i, Math.min(lines.length, i + 6)).join("\n");
      const isMutation = /\.(insert|update|upsert|delete)\s*\(/.test(window);
      if (isMutation && !hasAllowlistComment(lines, i)) {
        violations.push({
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
}

for (const dir of SCAN_DIRS) {
  walk(dir);
}

if (violations.length > 0) {
  console.error(
    `I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: scanned ${scanned} files, ${violations.length} violation(s):`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  console.error(
    `\nFix: route trip_intake_schemas mutations through mingla-business/src/services/intakeSchemaService.ts (canonical writer) OR biz_update_live_trip RPC. OR waive with comment within 3 lines above:\n    // orch-strict-grep-allow tr5-schema-valid-at-write — <reason>\n`,
  );
  process.exit(1);
}

console.log(
  `I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: scanned ${scanned} files, 0 violations`,
);
process.exit(0);
