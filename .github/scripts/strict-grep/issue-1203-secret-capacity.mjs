#!/usr/bin/env node
/**
 * Issue #1203 — secret bundles remain bounded and audits remain value-blind.
 * Exit 0 clean, 1 violation, 2 inconclusive. Includes synthetic self-tests.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNTIME_CONFIG = "supabase/functions/_shared/runtimeConfig.ts";
const AUDIT = "scripts/secrets/audit-supabase-secret-budget.mjs";
const MANIFEST = "supabase/secrets.manifest.json";
const CLIENT_ROOTS = ["app-mobile/", "mingla-business/", "mingla-admin/"];

const APPROVED_RUNTIME_FIELDS = [
  "bunny_storage_cap_bytes",
  "bunny_traffic_cap_bytes",
  "event_cover_video_provider",
  "google_ads_api_version",
  "meta_api_version",
  "mingla_footer_address",
  "mingla_logo_url",
  "termii_base_url",
];
const BUNDLE_NAMES = [
  "MINGLA_PAYMENT_MODES_JSON",
  "MINGLA_EMAIL_SENDERS_JSON",
  "MINGLA_DELIVERY_FLAGS_JSON",
  "MINGLA_ALERT_RECIPIENTS_JSON",
  "MINGLA_RUNTIME_CONFIG_JSON",
];
const FORBIDDEN_RUNTIME_WORDS = [
  "token",
  "secret",
  "api_key",
  "account_id",
  "origin",
  "sender_id",
  "app_id",
  "webhook",
  "private_key",
];

export function check({ runtimeSource, auditSource, manifestText, clientFiles }) {
  const violations = [];
  const fieldMatch = runtimeSource.match(
    /RUNTIME_CONFIG_FIELDS:[^=]*=\s*\[([\s\S]*?)\];/,
  );
  if (!fieldMatch) {
    violations.push(`${RUNTIME_CONFIG}:approved_field_list_missing`);
  } else {
    const fields = [...fieldMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    if (JSON.stringify(fields) !== JSON.stringify(APPROVED_RUNTIME_FIELDS)) {
      violations.push(`${RUNTIME_CONFIG}:approved_field_list_changed`);
    }
    for (const field of fields) {
      if (FORBIDDEN_RUNTIME_WORDS.some((word) => field.includes(word))) {
        violations.push(`${RUNTIME_CONFIG}:forbidden_field_class`);
      }
    }
  }
  if (!auditSource.includes('stdio: ["ignore", "pipe", "pipe"]')) {
    violations.push(`${AUDIT}:raw_cli_output_not_captured`);
  }
  if (
    /console\.(?:log|error|warn)\s*\(\s*(?:result\.)?(?:stdout|stderr)\b/.test(auditSource) ||
    /stdio\s*:\s*["']inherit["']/.test(auditSource)
  ) {
    violations.push(`${AUDIT}:raw_cli_output_may_escape`);
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    violations.push(`${MANIFEST}:invalid_json`);
  }
  if (manifest) {
    const names = manifest.secrets?.map((record) => record.name) ?? [];
    if (names.length !== 85 || new Set(names).size !== 85) {
      violations.push(`${MANIFEST}:target_must_be_85_unique_names`);
    }
    const serializedKeys = [];
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        serializedKeys.push(key.toLowerCase());
        walk(child);
      }
    };
    walk(manifest);
    for (const key of ["value", "digest", "hash", "fingerprint", "raw"]) {
      if (serializedKeys.includes(key)) violations.push(`${MANIFEST}:forbidden_${key}_key`);
    }
  }
  for (const file of clientFiles) {
    for (const name of BUNDLE_NAMES) {
      if (file.text.includes(name)) violations.push(`${file.path}:client_bundle_exposure:${name}`);
    }
  }
  return violations;
}

function selfTest() {
  const clean = {
    runtimeSource:
      `export const RUNTIME_CONFIG_FIELDS: readonly string[] = [${
        APPROVED_RUNTIME_FIELDS.map((field) => `"${field}"`).join(",")
      }];`,
    auditSource: 'spawnSync("supabase", [], { stdio: ["ignore", "pipe", "pipe"] });',
    manifestText: JSON.stringify({
      secrets: Array.from({ length: 85 }, (_, index) => ({ name: `SYNTH_${index}` })),
    }),
    clientFiles: [{ path: "app-mobile/src/ok.ts", text: "export const ok = true;" }],
  };
  if (check(clean).length !== 0) throw new Error("clean_fixture_failed");
  if (
    check({
      ...clean,
      runtimeSource:
        'export const RUNTIME_CONFIG_FIELDS: readonly string[] = ["api_key"];',
    }).length === 0
  ) throw new Error("credential_field_fixture_passed");
  if (
    check({
      ...clean,
      auditSource: 'spawnSync("supabase", [], { stdio: "inherit" });',
    }).length === 0
  ) throw new Error("raw_output_fixture_passed");
  if (
    check({
      ...clean,
      clientFiles: [{ path: "app-mobile/src/bad.ts", text: BUNDLE_NAMES[0] }],
    }).length === 0
  ) throw new Error("client_exposure_fixture_passed");
  console.log("issue-1203 secret-capacity self-test OK (4/4 cases).");
}

function trackedClientFiles() {
  const paths = execFileSync("git", ["ls-files", ...CLIENT_ROOTS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).split("\n").filter(Boolean);
  return paths.filter((path) => /\.(?:ts|tsx|js|jsx|json|mjs|cjs)$/.test(path)).map((path) => ({
    path,
    text: readFileSync(resolve(REPO_ROOT, path), "utf8"),
  }));
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  let clientFiles;
  try {
    clientFiles = await trackedClientFiles();
  } catch (error) {
    console.error("issue-1203 secret-capacity: client scan failed", error.message);
    process.exit(2);
  }
  const violations = check({
    runtimeSource: readFileSync(resolve(REPO_ROOT, RUNTIME_CONFIG), "utf8"),
    auditSource: readFileSync(resolve(REPO_ROOT, AUDIT), "utf8"),
    manifestText: readFileSync(resolve(REPO_ROOT, MANIFEST), "utf8"),
    clientFiles,
  });
  if (violations.length > 0) {
    violations.forEach((violation) =>
      console.error(`::error title=Issue 1203 secret capacity::${violation}`)
    );
    process.exit(1);
  }
  console.log("issue-1203 secret-capacity guard PASS.");
}

await main();
