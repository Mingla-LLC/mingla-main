#!/usr/bin/env node
/**
 * Value-blind Supabase secret capacity audit (#1203).
 *
 * The live path captures Supabase CLI JSON inside this process and immediately
 * reduces it to names. Raw CLI output, metadata, values, and digests are never
 * written to stdout, stderr, annotations, or the Actions summary.
 */

import {
  appendFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
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
const REQUIRED_MANIFEST_KEYS = [
  "schema_version",
  "policy",
  "rollout",
  "exceptions",
  "secrets",
];
const REQUIRED_POLICY_KEYS = [
  "normal_ceiling",
  "absolute_ceiling",
  "platform_managed_prefix",
  "temporary_expiry_hours",
];
const REQUIRED_ROLLOUT_KEYS = [
  "live_audit_mode",
  "transition_stage",
  "issue",
  "expected_user_managed_count",
  "pending_bundle_names",
  "legacy_names",
];
const REQUIRED_BUNDLE_FIELD_KEYS = ["name", "owner", "source_type"];
const FORBIDDEN_METADATA_KEYS = new Set([
  "value",
  "digest",
  "hash",
  "fingerprint",
  "credential_prefix",
  "raw",
]);
const APPROVED_DYNAMIC_CONSUMER_NAMES = new Set([
  "META_DATASET_ID",
  "PAYSTACK_SECRET_KEY_LIVE",
  "PAYSTACK_SECRET_KEY_TEST",
  "STRIPE_PUBLISHABLE_KEY_LIVE",
  "STRIPE_RAK_BALANCES_LIVE",
  "STRIPE_RAK_DETACH_LIVE",
  "STRIPE_RAK_DETACH_TEST",
  "STRIPE_RAK_ONBOARD_LIVE",
  "STRIPE_RAK_ONBOARD_TEST",
  "STRIPE_RAK_REFRESH_STATUS_LIVE",
  "STRIPE_RAK_REFRESH_STATUS_TEST",
  "STRIPE_RAK_TICKET_CHECKOUT_LIVE",
  "STRIPE_RAK_TICKET_CHECKOUT_TEST",
  "STRIPE_RAK_TICKET_REFUND_LIVE",
  "STRIPE_RAK_TICKET_REFUND_TEST",
  "STRIPE_RAK_WEBHOOK_LIVE",
  "STRIPE_RAK_WEBHOOK_TEST",
  "STRIPE_WEBHOOK_SECRET_PLATFORM",
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

function exactKeys(value, required) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...required].sort());
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sourceFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name.includes(".test.") ||
      entry.name === "__tests__"
    ) return [];
    return sourceFiles(resolve(path, entry.name));
  }).filter((candidate) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(candidate));
}

function validateReaderCoverage(record, repoRoot, failures) {
  if (record.source_type === "synthetic_fixture") return;
  const readerFiles = [];
  for (const reader of record.readers) {
    if (
      !nonempty(reader) ||
      reader.startsWith("/") ||
      reader.split("/").includes("..")
    ) {
      failures.push(`${record.name}:reader_path_invalid`);
      continue;
    }
    const absolute = resolve(repoRoot, reader);
    if (!absolute.startsWith(`${resolve(repoRoot)}/`)) {
      failures.push(`${record.name}:reader_path_outside_repo`);
      continue;
    }
    try {
      readerFiles.push(...sourceFiles(absolute));
    } catch {
      failures.push(`${record.name}:reader_path_missing:${reader}`);
    }
  }
  if (readerFiles.length === 0) {
    failures.push(`${record.name}:reader_source_missing`);
    return;
  }
  const combined = readerFiles.map((path) => readFileSync(path, "utf8")).join("\n");
  if (record.bundle_fields.length > 0) {
    for (const field of record.bundle_fields) {
      if (nonempty(field.name) && !combined.includes(field.name)) {
        failures.push(`${record.name}:bundle_field_consumer_missing:${field.name}`);
      }
    }
  } else if (
    !combined.includes(record.name) &&
    !APPROVED_DYNAMIC_CONSUMER_NAMES.has(record.name)
  ) {
    failures.push(`${record.name}:reader_does_not_reference_name`);
  }
}

export function validateManifest(
  manifest,
  nowMs = Date.now(),
  repoRoot = REPO_ROOT,
) {
  const failures = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest:not_object"];
  }
  if (!exactKeys(manifest, REQUIRED_MANIFEST_KEYS)) {
    failures.push("manifest:keys_invalid");
  }
  if (manifest.schema_version !== 1) failures.push("manifest:schema_version");
  if (!exactKeys(manifest.policy, REQUIRED_POLICY_KEYS)) {
    failures.push("manifest:policy_invalid");
  } else {
    if (manifest.policy.normal_ceiling !== 85) failures.push("manifest:normal_ceiling");
    if (manifest.policy.absolute_ceiling !== 90) failures.push("manifest:absolute_ceiling");
    if (manifest.policy.platform_managed_prefix !== "SUPABASE_") {
      failures.push("manifest:platform_prefix");
    }
    if (manifest.policy.temporary_expiry_hours !== 72) {
      failures.push("manifest:temporary_expiry_hours");
    }
  }
  if (!exactKeys(manifest.rollout, REQUIRED_ROLLOUT_KEYS)) {
    failures.push("manifest:rollout_invalid");
  } else {
    if (!["transition", "enforced"].includes(manifest.rollout.live_audit_mode)) {
      failures.push("manifest:live_audit_mode_invalid");
    }
    if (
      manifest.rollout.live_audit_mode === "transition" &&
      manifest.rollout.transition_stage !== "pre_rollout"
    ) failures.push("manifest:transition_stage_invalid");
    if (manifest.rollout.issue !== 1203) failures.push("manifest:rollout_issue");
    if (
      !Number.isInteger(manifest.rollout.expected_user_managed_count) ||
      manifest.rollout.expected_user_managed_count < 0 ||
      manifest.rollout.expected_user_managed_count > 100
    ) failures.push("manifest:rollout_count_invalid");
    for (const key of ["pending_bundle_names", "legacy_names"]) {
      const names = manifest.rollout[key];
      if (
        !Array.isArray(names) ||
        names.length === 0 ||
        names.some((name) => !nonempty(name)) ||
        new Set(names).size !== names.length
      ) failures.push(`manifest:${key}_invalid`);
    }
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
    if (!exactKeys(record, REQUIRED_RECORD_KEYS)) failures.push(`${name}:record_keys_invalid`);
    if (!/^(?:[A-Z][A-Z0-9_]*|app\.qr_token_pepper)$/.test(name)) {
      failures.push(`${name}:unsafe_name`);
    }
    if (name.startsWith("SUPABASE_")) failures.push(`${name}:platform_managed_in_manifest`);
    if (seen.has(name)) failures.push(`${name}:duplicate`);
    seen.add(name);
    if (typeof record.owner !== "string" || record.owner.length === 0) {
      failures.push(`${name}:owner_missing`);
    }
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(record.class ?? "")) {
      failures.push(`${name}:class_invalid`);
    }
    if (!/^[a-z][a-z0-9_]{1,127}$/.test(record.source_type ?? "")) {
      failures.push(`${name}:source_type_invalid`);
    }
    if (!["active", "temporary"].includes(record.status)) {
      failures.push(`${name}:status_invalid`);
    }
    if (!Number.isInteger(record.issue) || record.issue <= 0) {
      failures.push(`${name}:issue_invalid`);
    }
    if (typeof record.backup_owner !== "string" || record.backup_owner.length === 0) {
      failures.push(`${name}:backup_owner_missing`);
    }
    if (!Array.isArray(record.readers) || record.readers.length === 0) {
      failures.push(`${name}:consumerless`);
    } else if (
      record.readers.some((reader) => !nonempty(reader)) ||
      new Set(record.readers).size !== record.readers.length
    ) {
      failures.push(`${name}:readers_invalid`);
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
    const bundleFields = Array.isArray(record.bundle_fields) ? record.bundle_fields : [];
    if (
      new Set(bundleFields.map((field) => field?.name)).size !== bundleFields.length
    ) failures.push(`${name}:bundle_fields_duplicate`);
    for (const field of bundleFields) {
      if (
        !field ||
        typeof field !== "object" ||
        !exactKeys(field, REQUIRED_BUNDLE_FIELD_KEYS) ||
        !nonempty(field.name) ||
        !nonempty(field.owner) ||
        !nonempty(field.source_type)
      ) {
        failures.push(`${name}:bundle_field_metadata_invalid`);
      }
    }
    if (Array.isArray(record.readers) && Array.isArray(record.bundle_fields)) {
      validateReaderCoverage(record, repoRoot, failures);
    }
  }
  if (manifest.rollout && Array.isArray(manifest.secrets)) {
    const rolloutRecords = manifest.secrets.filter((record) =>
      record.source_type !== "synthetic_fixture"
    );
    const targetNames = new Set(rolloutRecords.map((record) => record.name));
    const bundleNames = rolloutRecords
      .filter((record) => record.bundle_fields?.length > 0)
      .map((record) => record.name)
      .sort();
    const pendingNames = [...(manifest.rollout.pending_bundle_names ?? [])].sort();
    if (JSON.stringify(bundleNames) !== JSON.stringify(pendingNames)) {
      failures.push("manifest:pending_bundle_names_mismatch");
    }
    if (
      (manifest.rollout.legacy_names ?? []).some((name) =>
        targetNames.has(name) ||
        !/^[A-Z][A-Z0-9_]*$/.test(name)
      )
    ) failures.push("manifest:legacy_names_invalid");
    const expectedRolloutCount = manifest.rollout.live_audit_mode === "enforced"
      ? targetNames.size
      : targetNames.size - pendingNames.length +
        (manifest.rollout.legacy_names?.length ?? 0);
    if (manifest.rollout.expected_user_managed_count !== expectedRolloutCount) {
      failures.push("manifest:rollout_count_mismatch");
    }
  }
  return failures;
}

export function auditSecretBudget({
  manifest,
  liveNames,
  nowMs = Date.now(),
  liveAudit = false,
}) {
  const failures = validateManifest(manifest, nowMs);
  const warnings = [];
  let expected = manifest.secrets.map((record) => record.name).sort();
  if (liveAudit && manifest.rollout?.live_audit_mode === "transition") {
    const pending = new Set(manifest.rollout.pending_bundle_names);
    expected = [
      ...expected.filter((name) => !pending.has(name)),
      ...manifest.rollout.legacy_names,
    ].sort();
    warnings.push(
      `secret_budget_transition:stage=${manifest.rollout.transition_stage}:issue=${manifest.rollout.issue}`,
    );
  }
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
  if (liveAudit && manifest.rollout?.live_audit_mode === "transition") {
    if (count !== manifest.rollout.expected_user_managed_count) {
      failures.push(
        `secret_budget_transition_count:expected=${manifest.rollout.expected_user_managed_count}:actual=${count}`,
      );
    }
  } else if (count <= 85) {
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
  const result = auditSecretBudget({
    manifest,
    liveNames,
    liveAudit: !process.argv.includes("--manifest-only") &&
      !process.argv.includes("--final-target"),
  });
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
