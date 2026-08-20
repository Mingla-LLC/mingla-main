#!/usr/bin/env node
/**
 * Issue #2207 tester-owned adversarial guard.
 *
 * The implementor guard proves counter and attribution behavior. This guard
 * independently protects the GitHub Actions boundary that makes that behavior
 * useful: PR merge checkouts and main pushes must both run with readable
 * first-parent history and read-only repository permissions.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOW_REL = ".github/workflows/issue-2207-manifest-merge-awareness.yml";
const TESTER_REL = ".github/scripts/__tests__/issue-2207-merged-checkout-workflow.tester.test.mjs";
const IMPLEMENTOR_REL = ".github/scripts/strict-grep/__tests__/issue-2207-manifest-merge-awareness.test.js";
const META_REL = ".github/scripts/strict-grep/meta-1383-manifest-parity.mjs";
const SELF_TEST_FLAG = ["--", "self-test"].join("");

function validateWorkflow(doc) {
  const failures = [];
  const events = doc?.on ?? {};
  const requiredPaths = [
    ".github/scripts/strict-grep/**",
    TESTER_REL,
    WORKFLOW_REL,
  ];
  const requiredEvents = ["pull_request", "push"];

  for (const event of requiredEvents) {
    if (!events[event]) failures.push(`${event} trigger is missing`);
    if (!events[event]?.branches?.includes("main")) failures.push(`${event} does not target main`);
    for (const requiredPath of requiredPaths) {
      if (!events[event]?.paths?.includes(requiredPath)) failures.push(`${event} does not cover ${requiredPath}`);
    }
  }

  if (JSON.stringify(doc?.permissions) !== JSON.stringify({ contents: "read" })) {
    failures.push("workflow permissions are not exactly contents: read");
  }

  const jobs = Object.values(doc?.jobs ?? {});
  if (jobs.length !== 1) failures.push("workflow must retain one auditable blocking job");
  const job = jobs[0] ?? {};
  const steps = job.steps ?? [];
  const checkout = steps.find((step) => String(step?.uses ?? "").startsWith("actions/checkout@"));
  if (!checkout) {
    failures.push("checkout step is missing");
  } else {
    const fetchDepth = Number(checkout.with?.["fetch-depth"] ?? 1);
    if (!Number.isInteger(fetchDepth) || fetchDepth < 4) {
      failures.push("checkout history is too shallow for two first-parent registrations");
    }
    if (checkout.with?.ref != null) {
      failures.push("checkout pins a ref and can bypass GitHub's pull-request merge checkout");
    }
  }

  const commands = steps.filter((step) => typeof step?.run === "string").map((step) => step.run).join("\n");
  for (const required of [TESTER_REL, IMPLEMENTOR_REL, META_REL]) {
    if (!commands.includes(required)) failures.push(`blocking job does not execute ${required}`);
  }
  if (!commands.includes(`${META_REL} ${SELF_TEST_FLAG}`)) {
    failures.push("blocking job does not execute META hostile fixtures");
  }

  return failures;
}

function clone(value) {
  return structuredClone(value);
}

const workflow = YAML.parse(fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf8"));

test("real #2207 workflow protects merged checkout and post-merge main", () => {
  assert.deepEqual(validateWorkflow(workflow), []);
});

test("guard rejects removal of the post-merge main trigger", () => {
  const fixture = clone(workflow);
  delete fixture.on.push;
  assert.match(validateWorkflow(fixture).join("\n"), /push trigger is missing/);
});

test("guard rejects trigger filters that leave the tester proof unwatched", () => {
  const fixture = clone(workflow);
  fixture.on.pull_request.paths = fixture.on.pull_request.paths.filter((candidate) => candidate !== TESTER_REL);
  assert.match(validateWorkflow(fixture).join("\n"), new RegExp(`pull_request does not cover .*${TESTER_REL.split("/").at(-1)}`));
});

test("guard rejects a PR-head ref that would skip the combined merge checkout", () => {
  const fixture = clone(workflow);
  const checkout = Object.values(fixture.jobs)[0].steps.find((step) => String(step?.uses ?? "").startsWith("actions/checkout@"));
  checkout.with.ref = "refs/pull/123/head";
  assert.match(validateWorkflow(fixture).join("\n"), /bypass GitHub's pull-request merge checkout/);
});

test("guard rejects shallow attribution and elevated token permissions", () => {
  const fixture = clone(workflow);
  const checkout = Object.values(fixture.jobs)[0].steps.find((step) => String(step?.uses ?? "").startsWith("actions/checkout@"));
  checkout.with["fetch-depth"] = 1;
  fixture.permissions = { contents: "write" };
  const failures = validateWorkflow(fixture).join("\n");
  assert.match(failures, /too shallow/);
  assert.match(failures, /not exactly contents: read/);
});

test("guard rejects silently unwiring either tester or implementor proof", () => {
  const fixture = clone(workflow);
  const job = Object.values(fixture.jobs)[0];
  job.steps = job.steps.filter((step) => !String(step?.run ?? "").includes(TESTER_REL));
  assert.match(validateWorkflow(fixture).join("\n"), new RegExp(TESTER_REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
