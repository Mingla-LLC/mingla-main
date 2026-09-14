#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const WORKFLOW_REL = ".github/workflows/issue-2099-pending-venue-identity-correction-tests.yml";
const MAIN_HEALTH_REL = "scripts/ci/main-health.mjs";
const TEST_REL = "scripts/ci/issue-3325-baseline-push-health.implementor.happy.test.mjs";
const BASELINE_REL = "mingla-business/scripts/ci/bundle-baseline.json";
const MAIN_HEALTH_TRIGGER_REL = "scripts/ci/main-health.mjs";

const read = (relativePath) => readFileSync(join(ROOT, relativePath), "utf8");

export function auditContract({ workflow, mainHealth }) {
  const failures = [];
  const anchorStart = workflow.indexOf("    paths: &issue2099Paths\n");
  const pushStart = workflow.indexOf("  push:\n", anchorStart + 1);
  const anchor =
    anchorStart >= 0 && pushStart > anchorStart
      ? workflow.slice(anchorStart, pushStart)
      : "";

  if (!anchor) failures.push("the shared issue2099Paths trigger list is missing");
  if (!anchor.includes(`      - "${BASELINE_REL}"`)) {
    failures.push("the run-time bundle baseline is absent from issue2099Paths");
  }
  if (!anchor.includes(`      - "${TEST_REL}"`)) {
    failures.push("the #3325 regression test cannot trigger the workflow that runs it");
  }
  if (!anchor.includes(`      - "${MAIN_HEALTH_TRIGGER_REL}"`)) {
    failures.push("the main-health policy read by #3325 cannot trigger its regression test");
  }
  if (
    !workflow.includes(
      "  push:\n    branches: [main]\n    paths: *issue2099Paths\n",
    )
  ) {
    failures.push("push to main no longer reuses the complete issue2099Paths list");
  }
  if (!workflow.includes(`run: node ${TEST_REL} --self-test`)) {
    failures.push("the fails-on-revert fixtures are not executed by the workflow");
  }
  if (!workflow.includes(`run: node ${TEST_REL}\n`)) {
    failures.push("the live #3325 trigger contract is not executed by the workflow");
  }
  if (
    !workflow.includes(
      'readFileSync("./scripts/ci/bundle-baseline.json", "utf8")',
    )
  ) {
    failures.push("SC-4 no longer reads the baseline file at run time");
  }
  if (
    !mainHealth.includes(
      'export const ADMITTED_RUN_EVENTS = Object.freeze(["push", "schedule"]);',
    )
  ) {
    failures.push("main-health admitted run events changed from push and schedule");
  }

  return failures;
}

const sources = {
  workflow: read(WORKFLOW_REL),
  mainHealth: read(MAIN_HEALTH_REL),
};

if (process.argv.includes("--self-test")) {
  assert.deepEqual(auditContract(sources), []);

  const mutations = [
    {
      label: "missing baseline trigger",
      expected: "run-time bundle baseline is absent",
      sources: {
        ...sources,
        workflow: sources.workflow.replace(
          `      - "${BASELINE_REL}"\n`,
          "",
        ),
      },
    },
    {
      label: "test cannot trigger itself",
      expected: "regression test cannot trigger",
      sources: {
        ...sources,
        workflow: sources.workflow.replace(`      - "${TEST_REL}"\n`, ""),
      },
    },
    {
      label: "main-health input cannot trigger the test",
      expected: "main-health policy read by #3325 cannot trigger",
      sources: {
        ...sources,
        workflow: sources.workflow.replace(
          `      - "${MAIN_HEALTH_TRIGGER_REL}"\n`,
          "",
        ),
      },
    },
    {
      label: "push list is narrowed",
      expected: "push to main no longer reuses",
      sources: {
        ...sources,
        workflow: sources.workflow.replace(
          "    paths: *issue2099Paths\n",
          `    paths:\n      - "${WORKFLOW_REL}"\n`,
        ),
      },
    },
    {
      label: "fails-on-revert step removed",
      expected: "fails-on-revert fixtures are not executed",
      sources: {
        ...sources,
        workflow: sources.workflow.replace(
          `run: node ${TEST_REL} --self-test`,
          `run: node ${TEST_REL}`,
        ),
      },
    },
    {
      label: "runtime baseline read removed",
      expected: "SC-4 no longer reads",
      sources: {
        ...sources,
        workflow: sources.workflow.replace(
          'readFileSync("./scripts/ci/bundle-baseline.json", "utf8")',
          'readFileSync("./scripts/ci/frozen-baseline.json", "utf8")',
        ),
      },
    },
    {
      label: "manual runs admitted as green evidence",
      expected: "admitted run events changed",
      sources: {
        ...sources,
        mainHealth: sources.mainHealth.replace(
          'Object.freeze(["push", "schedule"])',
          'Object.freeze(["push", "schedule", "workflow_dispatch"])',
        ),
      },
    },
  ];

  for (const mutation of mutations) {
    const failures = auditContract(mutation.sources);
    assert.ok(
      failures.some((failure) => failure.includes(mutation.expected)),
      `${mutation.label}: expected ${mutation.expected}; got ${failures.join(" | ") || "no failure"}`,
    );
  }

  console.log(`#3325 self-test PASS (${mutations.length} revert mutations rejected).`);
  process.exit(0);
}

const failures = auditContract(sources);
if (failures.length > 0) {
  console.error("#3325 baseline push-health contract FAILED:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "#3325 PASS: baseline-only main pushes refresh the bundle reader; manual runs remain inadmissible.",
);
