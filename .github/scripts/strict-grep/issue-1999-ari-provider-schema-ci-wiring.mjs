#!/usr/bin/env node

/**
 * #1999 — keep the implementor's actual-registry provider contract live in CI.
 *
 * This Class A gate fails if the dedicated workflow, exact Deno target, or
 * source/test path triggers disappear. `--self-test` proves the checker sees
 * omitted targets, conditional execution, and incomplete source coverage.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const WORKFLOW_PATH = ".github/workflows/issue-1999-ari-provider-schema-tests.yml";
const TEST_PATH =
  "supabase/functions/_shared/__tests__/issue_1999_ari_provider_schema_contract.test.ts";
const SOURCE_PATHS = [
  "supabase/functions/_shared/agentGemini.ts",
  "supabase/functions/_shared/agentTools.ts",
  "supabase/functions/_shared/agentDomainTools.ts",
  "supabase/functions/agent-chat/**",
];

export function check(workflowSource, failures) {
  if (!workflowSource.includes("pull_request:")) {
    failures.push("missing pull_request trigger");
  }
  if (!workflowSource.includes("push:")) {
    failures.push("missing push trigger");
  }

  for (const sourcePath of SOURCE_PATHS) {
    const occurrences = workflowSource.split(sourcePath).length - 1;
    if (occurrences < 2) {
      failures.push(`source path is not wired for push and pull_request: ${sourcePath}`);
    }
  }

  const testOccurrences = workflowSource.split(TEST_PATH).length - 1;
  if (testOccurrences < 3) {
    failures.push("exact implementor test must appear in both triggers and the Deno command");
  }

  const exactRun = new RegExp(
    `run:\\s*deno test\\s+${TEST_PATH.replaceAll(".", "\\.")}\\s*(?:\\n|$)`,
  );
  if (!exactRun.test(workflowSource)) {
    failures.push("exact unconditional deno test command is missing");
  }
  if (/if\s+(?:\[\s+-f|test\s+-f)[^\n]*issue_1999/.test(workflowSource)) {
    failures.push("implementor test execution is conditional");
  }
}

if (process.argv.includes("--self-test")) {
  const good = `
on:
  push:
    paths:
      - "supabase/functions/_shared/agentGemini.ts"
      - "supabase/functions/_shared/agentTools.ts"
      - "supabase/functions/_shared/agentDomainTools.ts"
      - "supabase/functions/agent-chat/**"
      - "${TEST_PATH}"
  pull_request:
    paths:
      - "supabase/functions/_shared/agentGemini.ts"
      - "supabase/functions/_shared/agentTools.ts"
      - "supabase/functions/_shared/agentDomainTools.ts"
      - "supabase/functions/agent-chat/**"
      - "${TEST_PATH}"
steps:
  - run: deno test ${TEST_PATH}
`;
  const selfFailures = [];
  const goodFailures = [];
  check(good, goodFailures);
  if (goodFailures.length > 0) {
    selfFailures.push(`GOOD fixture rejected: ${goodFailures.join("; ")}`);
  }

  const missingTarget = good.replace(`  - run: deno test ${TEST_PATH}`, "  - run: deno test other.test.ts");
  const missingFailures = [];
  check(missingTarget, missingFailures);
  if (!missingFailures.some((failure) => failure.includes("exact implementor test"))) {
    selfFailures.push("BAD1 missing exact test target was not rejected");
  }

  const conditional = good.replace(
    `  - run: deno test ${TEST_PATH}`,
    `  - run: if test -f ${TEST_PATH}; then deno test ${TEST_PATH}; fi`,
  );
  const conditionalFailures = [];
  check(conditional, conditionalFailures);
  if (!conditionalFailures.some((failure) => failure.includes("conditional"))) {
    selfFailures.push("BAD2 conditional test execution was not rejected");
  }

  const incomplete = good.replaceAll("supabase/functions/_shared/agentTools.ts", "other.ts");
  const incompleteFailures = [];
  check(incomplete, incompleteFailures);
  if (!incompleteFailures.some((failure) => failure.includes("agentTools.ts"))) {
    selfFailures.push("BAD3 missing registry trigger was not rejected");
  }

  if (selfFailures.length > 0) {
    console.error("issue-1999-ari-provider-schema-ci-wiring self-test FAIL:");
    selfFailures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }
  console.log("issue-1999-ari-provider-schema-ci-wiring self-test PASS (4/4 cases).");
  process.exit(0);
}

const workflowAbsolute = path.join(repoRoot, WORKFLOW_PATH);
const failures = [];
if (!fs.existsSync(workflowAbsolute)) {
  failures.push(`workflow missing: ${WORKFLOW_PATH}`);
} else {
  check(fs.readFileSync(workflowAbsolute, "utf8"), failures);
}
if (!fs.existsSync(path.join(repoRoot, TEST_PATH))) {
  failures.push(`implementor test missing: ${TEST_PATH}`);
}

if (failures.length > 0) {
  console.error("issue-1999-ari-provider-schema-ci-wiring FAIL:");
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log("issue-1999-ari-provider-schema-ci-wiring PASS.");
process.exit(0);
