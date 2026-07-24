#!/usr/bin/env node
/**
 * Value-blind Supabase secret capacity audit (#1203).
 *
 * The live path captures Supabase CLI JSON inside this process and immediately
 * reduces it to names. Raw CLI output, metadata, values, and digests are never
 * written to stdout, stderr, annotations, or the Actions summary.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
export const DEFAULT_MANIFEST = resolve(REPO_ROOT, "supabase", "secrets.manifest.json");
const REQUIRED_RECORD_KEYS = [
  "name",
  "class",
  "owner",
  "backup_owner",
  "readers",
  "source_type",
  "rotation_or_review_days",
  "expires_at",
  "issue",
  "status",
  "bundle_fields",
];
const FORBIDDEN_METADATA_KEYS = new Set([
  "value",
  "digest",
  "hash",
  "fingerprint",
  "credential_prefix",
  "raw",
]);

function parseDate(value) {
  if (typeof value !== "string") return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function currentException(exceptions, nowMs) {
  return exceptions.find((exception) =>
    exception &&
    typeof exception === "object" &&
    typeof exception.issue === "number" &&
    typeof exception.owner === "string" &&
    typeof exception.approved_by === "string" &&
    parseDate(exception.expires_at) !== null &&
    parseDate(exception.expires_at) > nowMs
  );
}

function inspectForbiddenKeys(value, path = "manifest", failures = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectForbiddenKeys(entry, `${path}[${index}]`, failures)
    );
    return failures;
  }
  if (!value || typeof value !== "object") return failures;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      failures.push(`${path}.${key}:forbidden_metadata_key`);
    }
    inspectForbiddenKeys(child, `${path}.${key}`, failures);
  }
  return failures;
}

export function validateManifest(manifest, nowMs = Date.now()) {
  const failures = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest:not_object"];
  }
  if (manifest.schema_version !== 1) failures.push("manifest:schema_version");
  if (!manifest.policy || typeof manifest.policy !== "object") {
    failures.push("manifest:policy_missing");
  }
  if (!Array.isArray(manifest.exceptions)) failures.push("manifest:exceptions_not_array");
  if (!Array.isArray(manifest.secrets)) return [...failures, "manifest:secrets_not_array"];
  failures.push(...inspectForbiddenKeys(manifest));

  const seen = new Set();
  for (const record of manifest.secrets) {
    const name = record && typeof record.name === "string" ? record.name : "invalid_name";
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      failures.push(`${name}:record_not_object`);
      continue;
    }
    for (const key of REQUIRED_RECORD_KEYS) {
      if (!Object.hasOwn(record, key)) failures.push(`${name}:missing_${key}`);
    }
    if (!/^(?:[A-Z][A-Z0-9_]*|app\.qr_token_pepper)$/.test(name)) {
      failures.push(`${name}:unsafe_name`);
    }
    if (name.startsWith("SUPABASE_")) failures.push(`${name}:platform_managed_in_manifest`);
    if (seen.has(name)) failures.push(`${name}:duplicate`);
    seen.add(name);
    if (typeof record.owner !== "string" || record.owner.length === 0) {
      failures.push(`${name}:owner_missing`);
    }
    if (typeof record.backup_owner !== "string" || record.backup_owner.length === 0) {
      failures.push(`${name}:backup_owner_missing`);
    }
    if (!Array.isArray(record.readers) || record.readers.length === 0) {
      failures.push(`${name}:consumerless`);
    }
    if (
      !Number.isInteger(record.rotation_or_review_days) ||
      record.rotation_or_review_days <= 0
    ) {
      failures.push(`${name}:review_interval_invalid`);
    }
    if (record.expires_at !== null) {
      const expiry = parseDate(record.expires_at);
      if (expiry === null) failures.push(`${name}:expiry_invalid`);
      else if (expiry <= nowMs) failures.push(`${name}:expired`);
    }
    if (!Array.isArray(record.bundle_fields)) failures.push(`${name}:bundle_fields_not_array`);
    for (const field of Array.isArray(record.bundle_fields) ? record.bundle_fields : []) {
      if (
        !field ||
        typeof field !== "object" ||
        typeof field.name !== "string" ||
        typeof field.owner !== "string" ||
        typeof field.source_type !== "string"
      ) {
        failures.push(`${name}:bundle_field_metadata_invalid`);
      }
    }
  }
  return failures;
}

export function auditSecretBudget({
  manifest,
  liveNames,
  nowMs = Date.now(),
}) {
  const failures = validateManifest(manifest, nowMs);
  const warnings = [];
  const expected = manifest.secrets.map((record) => record.name).sort();
  const actual = [...new Set(liveNames.filter((name) => !name.startsWith("SUPABASE_")))].sort();
  const duplicates = liveNames.filter((name, index) => liveNames.indexOf(name) !== index);
  duplicates.forEach((name) => failures.push(`${name}:duplicate_live_name`));
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  expected.filter((name) => !actualSet.has(name)).forEach((name) =>
    failures.push(`${name}:missing_live_name`)
  );
  actual.filter((name) => !expectedSet.has(name)).forEach((name) =>
    failures.push(`${name}:unexpected_live_name`)
  );

  const count = actual.length;
  const exception = currentException(manifest.exceptions ?? [], nowMs);
  if (count <= 85) {
    // normal state
  } else if (count <= 90 && exception) {
    warnings.push(
      `secret_budget_exception:count=${count}:issue=${exception.issue}:expires_at=${exception.expires_at}`,
    );
  } else if (count <= 90) {
    failures.push(`secret_budget_breach:count=${count}:approved_exception_required`);
  } else {
    failures.push(`secret_budget_breach:count=${count}:absolute_ceiling_exceeded`);
  }

  return {
    ok: failures.length === 0,
    count,
    freeSlots: Math.max(0, 100 - count),
    failures: [...new Set(failures)].sort(),
    warnings: [...new Set(warnings)].sort(),
  };
}

function liveNamesFromSupabase(projectRef) {
  const result = spawnSync(
    "supabase",
    ["secrets", "list", "--project-ref", projectRef, "--output", "json"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0) throw new Error("supabase_secret_list_failed");
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    throw new Error("supabase_secret_list_unparseable");
  }
  if (!Array.isArray(rows)) throw new Error("supabase_secret_list_not_array");
  return rows.map((row) => row?.name).filter((name) => typeof name === "string");
}

function fixtureNames(path) {
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  const names = Array.isArray(fixture) ? fixture : fixture.names;
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
    throw new Error("names_fixture_invalid");
  }
  return names;
}

function emit(result) {
  const level = result.ok ? "notice" : "error";
  console.log(
    `::${level} title=Supabase secret budget::user_managed=${result.count}, free_slots=${result.freeSlots}`,
  );
  for (const warning of result.warnings) {
    console.log(`::warning title=Supabase secret budget::${warning}`);
  }
  for (const failure of result.failures) {
    console.log(`::error title=Supabase secret budget::${failure}`);
  }
  const summary = [
    "## Supabase secret capacity",
    "",
    `- User-managed names: ${result.count}`,
    `- Free slots: ${result.freeSlots}`,
    `- Result: ${result.ok ? "PASS" : "FAIL"}`,
    ...result.warnings.map((warning) => `- Warning: ${warning}`),
    ...result.failures.map((failure) => `- Failure: ${failure}`),
    "",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  } else {
    console.log(summary);
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const manifestPath = resolve(argValue("--manifest") ?? DEFAULT_MANIFEST);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  let liveNames;
  if (process.argv.includes("--manifest-only")) {
    liveNames = manifest.secrets.map((record) => record.name);
  } else if (argValue("--fixture")) {
    liveNames = fixtureNames(resolve(argValue("--fixture")));
  } else {
    const projectRef = argValue("--project-ref") ?? process.env.SUPABASE_PROJECT_REF;
    if (!projectRef) throw new Error("supabase_project_ref_missing");
    liveNames = liveNamesFromSupabase(projectRef);
  }
  const result = auditSecretBudget({ manifest, liveNames });
  emit(result);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "audit_failed";
    console.error(`::error title=Supabase secret budget::${reason}`);
    process.exit(2);
  }
}
