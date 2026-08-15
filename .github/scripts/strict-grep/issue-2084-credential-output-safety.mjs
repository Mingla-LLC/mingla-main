#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  utility: "scripts/security/issue_2084_safe_credential_inventory.mjs",
  tests: "scripts/security/issue_2084_safe_credential_inventory.test.mjs",
  tester: "scripts/security/issue_2084_safe_credential_inventory.tester.adversarial.test.mjs",
  runbook: "docs/runbooks/B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md",
  workflow: ".github/workflows/issue-2084-credential-output-safety.yml",
};

const REQUIRED = {
  utility: [
    "MAX_INPUT_BYTES",
    "SAFE_PATH_IDS",
    "UNCLASSIFIED_PATH",
    "timingSafeEqual",
    "CREDENTIAL_LIKE_ARGUMENT",
    "UNKNOWN_CREDENTIAL_CLASS",
    "SENSITIVE_PATH_INPUT",
    "readSync",
    "safeFailure",
    "exactKeys(input, ROOT_KEYS)",
  ],
  tests: [
    "one-separator webhook value never reaches output",
    "multi-separator secret and restricted tokens never reach output",
    "digest equality emits only slot and MATCH or NO_MATCH",
    "malformed JSON fails through the same sanitizer",
    "newline and control injection is rejected without reflection",
    "nested exception content is ignored by safeFailure",
    "unknown credential formats fail closed",
    "credential-like argv is rejected without echo",
    "malicious label and path inputs never echo",
    "oversized input fails without outputting the payload",
    "extra requested output fields fail the closed schema",
  ],
  tester: [
    "combined header URL bearer and webhook material collapses to one closed class",
    "nested aggregate causes with Unicode separators never cross the failure boundary",
    "a near-limit valid credential is classified without partial or full reflection",
    "a malicious Unicode label cannot echo embedded credentials or inject output rows",
  ],
  runbook: [
    "one endpoint at a time",
    "provider-native delayed expiry",
    "up to three days",
    "post-expiry new-only",
    "STRIPE_WEBHOOK_SECRET_PREVIOUS` remains absent",
  ],
  workflow: [
    "pull_request:",
    "push:",
    "node-version: 20",
    "node --test",
    "scripts/security/issue_2084_safe_credential_inventory.test.mjs",
    "scripts/security/issue_2084_safe_credential_inventory.tester.adversarial.test.mjs",
    "node .github/scripts/strict-grep/issue-2084-credential-output-safety.mjs --self-test",
    "node .github/scripts/strict-grep/issue-2084-credential-output-safety.mjs",
  ],
};

export function violations(files) {
  const found = [];
  for (const [name, needles] of Object.entries(REQUIRED)) {
    for (const needle of needles) {
      if (!files[name]?.includes(needle)) found.push(`${name}:missing:${needle}`);
    }
  }
  if (files.utility?.includes('.split("_")') || files.utility?.includes(".split('_')")) {
    found.push("utility:forbidden:delimiter-slicing");
  }
  for (const unsafe of ["console.log(error", "console.error(error", "error.message", "error.cause"]) {
    if (files.utility?.includes(unsafe)) found.push(`utility:forbidden:${unsafe}`);
  }
  const testerPath = "scripts/security/issue_2084_safe_credential_inventory.tester.adversarial.test.mjs";
  const testerPathOccurrences = files.workflow?.split(testerPath).length - 1;
  if (testerPathOccurrences !== 3) {
    found.push("workflow:tester-path-must-cover-pr-push-and-command");
  }
  return found;
}

function cleanFixture() {
  const fixture = Object.fromEntries(Object.entries(REQUIRED).map(([name, needles]) => [name, needles.join("\n")]));
  const testerPath = "scripts/security/issue_2084_safe_credential_inventory.tester.adversarial.test.mjs";
  fixture.workflow += `\n${testerPath}\n${testerPath}`;
  return fixture;
}

function selfTest() {
  const clean = cleanFixture();
  if (violations(clean).length !== 0) throw new Error("clean fixture rejected");

  const mutations = [
    ["utility", "timingSafeEqual", "constant-time comparison removal"],
    ["runbook", "up to three days", "retry-horizon truth removal"],
    ["workflow", "push:", "push enforcement removal"],
    ["tests", "malformed JSON fails through the same sanitizer", "regression removal"],
    ["tester", "a malicious Unicode label cannot echo embedded credentials or inject output rows", "tester regression removal"],
  ];
  for (const [file, token, name] of mutations) {
    const fixture = { ...clean, [file]: clean[file].replace(token, "") };
    if (violations(fixture).length === 0) throw new Error(`${name} was not rejected`);
  }
  if (violations({ ...clean, utility: `${clean.utility}\nvalue.split("_")` }).length === 0) {
    throw new Error("delimiter slicing was not rejected");
  }
  if (violations({ ...clean, workflow: clean.workflow.replaceAll("scripts/security/issue_2084_safe_credential_inventory.tester.adversarial.test.mjs", "") }).length === 0) {
    throw new Error("tester PR/push/command wiring removal was not rejected");
  }
  process.stdout.write("issue-2084 credential-output safety self-test passed\n");
}

function main() {
  if (process.argv.slice(2).includes("--self-test")) {
    selfTest();
    return;
  }
  const files = Object.fromEntries(Object.entries(PATHS).map(([name, path]) => [name, readFileSync(resolve(ROOT, path), "utf8")]));
  const found = violations(files);
  if (found.length > 0) {
    process.stderr.write(`issue-2084 credential-output safety failed (${found.length} static violations)\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("issue-2084 credential-output safety passed\n");
}

main();
