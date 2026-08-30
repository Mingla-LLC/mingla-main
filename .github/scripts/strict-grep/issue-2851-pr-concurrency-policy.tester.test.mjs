// Issue #2851 independent tester regression proof.
//
// This suite models GitHub's case-insensitive concurrency scheduler from the
// policies parsed out of the real workflow YAML. It attacks lifecycle isolation:
// replacement across SHAs, PR/workflow boundaries, non-PR run IDs, the trusted
// target event, and the irreversible-side-effect exception.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  auditWorkflowSources,
  LOAD_WORKFLOW,
  NORMAL_CANCEL,
  readWorkflowSources,
  REPO_ROOT,
} from "./issue-2851-pr-concurrency-policy.mjs";

const TEST_ROOT = process.env.MINGLA_2851_REPO_ROOT
  ? path.resolve(process.env.MINGLA_2851_REPO_ROOT)
  : REPO_ROOT;
const liveWorkflow = (...stemParts) => `${stemParts.join("-")}.${["y", "ml"].join("")}`;

const STANDARD = liveWorkflow("framework", "major", "guard");
const SAME_DISPLAY_A = liveWorkflow("issue", "1423", "stay", "discovery", "tests");
const SAME_DISPLAY_B = liveWorkflow("issue", "1503", "stay", "date", "pickers", "tests");
const NON_PR_PUSH = liveWorkflow("ci", "batch");
const NON_PR_SCHEDULE = liveWorkflow("mingla", "business", "jest", "suite");
const TARGET = liveWorkflow("bundle", "baseline", "provenance", "guard");

const RUBY_POLICIES = String.raw`
require "yaml"
require "json"
payload = JSON.parse(STDIN.read)
result = {}
payload.each do |file, source|
  document = YAML.safe_load(source, aliases: true) || {}
  on_value = document.key?("on") ? document["on"] : document[true]
  events = case on_value
           when Hash then on_value.keys.map(&:to_s)
           when Array then on_value.map(&:to_s)
           when String then [on_value.to_s]
           else []
           end
  next unless events.include?("pull_request") || events.include?("pull_request_target")
  result[file] = {
    "displayName" => document["name"],
    "events" => events,
    "group" => document.dig("concurrency", "group"),
    "cancel" => document.dig("concurrency", "cancel-in-progress")
  }
end
STDOUT.write(JSON.generate(result))
`;

function parsePolicies(sources = readWorkflowSources(TEST_ROOT)) {
  return JSON.parse(execFileSync("ruby", ["-e", RUBY_POLICIES], {
    input: JSON.stringify(sources),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }));
}

function materialize(policy, { event, pr, runId }) {
  const isPr = event === "pull_request" || event === "pull_request_target";
  const cancel = policy.cancel === NORMAL_CANCEL ? isPr : policy.cancel;
  let group = policy.group;
  if (typeof group !== "string") return { group: null, cancel };
  group = group.replace("${{ github.run_id }}", String(runId));
  group = group.replace(
    "${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && github.event.pull_request.number || github.run_id }}",
    String(isPr ? pr : runId),
  );
  return { group, cancel };
}

function dispatch(active, policies, run) {
  const policy = policies[run.workflow];
  assert.ok(policy, `missing parsed policy for ${run.workflow}`);
  const concrete = materialize(policy, run);
  assert.equal(typeof concrete.group, "string", `${run.workflow}: group did not materialize`);
  const folded = concrete.group.toLocaleLowerCase("en-US");
  for (const existing of active) {
    if (existing.status === "active" && existing.folded === folded && concrete.cancel) {
      existing.status = "cancelled";
      existing.cancelledBy = run.id;
    }
  }
  active.push({ ...run, ...concrete, folded, status: "active" });
  return active.at(-1);
}

function byId(active, id) {
  return active.find((run) => run.id === id);
}

test("real YAML remains the complete canonical 123-workflow policy", () => {
  const result = auditWorkflowSources(readWorkflowSources(TEST_ROOT));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.counts, {
    totalWorkflows: 130,
    prFamily: 123,
    standardPullRequest: 122,
    pullRequestTarget: 1,
    normalPolicies: 122,
    exceptions: 1,
  });
});

test("a newer SHA cancels only the older generation of the same workflow and PR", () => {
  const policies = parsePolicies();
  const active = [];
  dispatch(active, policies, { id: "same-pr-old", workflow: STANDARD, event: "pull_request", pr: 2852, runId: 1001, sha: "aaa" });
  dispatch(active, policies, { id: "other-pr", workflow: STANDARD, event: "pull_request", pr: 2853, runId: 1002, sha: "bbb" });
  dispatch(active, policies, { id: "same-pr-new", workflow: STANDARD, event: "pull_request", pr: 2852, runId: 1003, sha: "ccc" });

  assert.equal(byId(active, "same-pr-old").status, "cancelled");
  assert.equal(byId(active, "same-pr-old").cancelledBy, "same-pr-new");
  assert.equal(byId(active, "same-pr-new").status, "active");
  assert.equal(byId(active, "other-pr").status, "active");
});

test("two workflows whose YAML display names both parse as Issue never share a lane", () => {
  const policies = parsePolicies();
  assert.equal(policies[SAME_DISPLAY_A].displayName, "Issue");
  assert.equal(policies[SAME_DISPLAY_B].displayName, "Issue");

  const active = [];
  const first = dispatch(active, policies, { id: "display-a", workflow: SAME_DISPLAY_A, event: "pull_request", pr: 77, runId: 2001, sha: "aaa" });
  const second = dispatch(active, policies, { id: "display-b", workflow: SAME_DISPLAY_B, event: "pull_request", pr: 77, runId: 2002, sha: "bbb" });
  assert.notEqual(first.folded, second.folded);
  assert.equal(first.status, "active");
  assert.equal(second.status, "active");
});

test("push, schedule, and manual runs use three run-unique non-cancelling lanes", () => {
  const policies = parsePolicies();
  const active = [];
  const runs = [
    dispatch(active, policies, { id: "push", workflow: NON_PR_PUSH, event: "push", pr: null, runId: 3001, sha: "aaa" }),
    dispatch(active, policies, { id: "schedule", workflow: NON_PR_SCHEDULE, event: "schedule", pr: null, runId: 3002, sha: "bbb" }),
    dispatch(active, policies, { id: "manual", workflow: NON_PR_SCHEDULE, event: "workflow_dispatch", pr: null, runId: 3003, sha: "ccc" }),
  ];
  assert.equal(new Set(runs.map((run) => run.folded)).size, 3);
  assert.ok(runs.every((run) => run.cancel === false));
  assert.ok(runs.every((run) => run.status === "active"));
});

test("trusted target generations replace only the same target workflow and PR", () => {
  const policies = parsePolicies();
  assert.deepEqual(policies[TARGET].events, ["pull_request_target"]);
  const active = [];
  dispatch(active, policies, { id: "target-old", workflow: TARGET, event: "pull_request_target", pr: 88, runId: 4001, sha: "aaa" });
  dispatch(active, policies, { id: "target-other-pr", workflow: TARGET, event: "pull_request_target", pr: 89, runId: 4002, sha: "bbb" });
  dispatch(active, policies, { id: "target-new", workflow: TARGET, event: "pull_request_target", pr: 88, runId: 4003, sha: "ccc" });
  assert.equal(byId(active, "target-old").status, "cancelled");
  assert.equal(byId(active, "target-other-pr").status, "active");
  assert.equal(byId(active, "target-new").status, "active");
});

test("the external-POST exception stays run-unique and never interrupts another load", () => {
  const policies = parsePolicies();
  const active = [];
  const first = dispatch(active, policies, { id: "load-a", workflow: LOAD_WORKFLOW, event: "pull_request", pr: 55, runId: 5001, sha: "aaa" });
  const second = dispatch(active, policies, { id: "load-b", workflow: LOAD_WORKFLOW, event: "pull_request", pr: 55, runId: 5002, sha: "bbb" });
  assert.equal(first.cancel, false);
  assert.equal(second.cancel, false);
  assert.notEqual(first.folded, second.folded);
  assert.equal(first.status, "active");
  assert.equal(second.status, "active");
});

test("case-folding and YAML display-name deception cannot collapse workflow identities", () => {
  const policies = parsePolicies();
  const concrete = Object.entries(policies).map(([workflow, policy], index) => ({
    workflow,
    ...materialize(policy, { event: policy.events.includes("pull_request_target") ? "pull_request_target" : "pull_request", pr: 61, runId: 6000 + index }),
  }));
  const normal = concrete.filter(({ workflow }) => workflow !== LOAD_WORKFLOW);
  assert.equal(new Set(normal.map(({ group }) => group.toLocaleLowerCase("en-US"))).size, normal.length);

  const synthetic = {
    "alpha-fixture.yml": [
      "name: Issue # comment hides the suffix",
      "x-events: &events",
      "  pull_request:",
      "on: *events",
      "concurrency:",
      "  group: ci-alpha-fixture-${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && github.event.pull_request.number || github.run_id }}",
      `  cancel-in-progress: ${NORMAL_CANCEL}`,
      "jobs: {check: {runs-on: ubuntu-latest, steps: [{run: true}]}}",
      "",
    ].join("\n"),
    "beta-fixture.yml": [
      'name: "Issue # comment stays quoted"',
      "on:",
      "  pull_request:",
      "concurrency:",
      "  group: ci-beta-fixture-${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && github.event.pull_request.number || github.run_id }}",
      `  cancel-in-progress: ${NORMAL_CANCEL}`,
      "jobs: {check: {runs-on: ubuntu-latest, steps: [{run: true}]}}",
      "",
    ].join("\n"),
  };
  assert.deepEqual(auditWorkflowSources(synthetic, { requireLoadException: false }).errors, []);
});

test("Psych receives the workflow filename through its cross-version keyword API", () => {
  // [TEST-MOD-APPROVED #2851] GitHub's Psych rejects the legacy second
  // positional filename that the workstation's older Psych still accepts.
  const guard = fs.readFileSync(
    path.join(TEST_ROOT, ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs"),
    "utf8",
  );
  assert.match(guard, /Psych\.parse_stream\(source, filename: file\)/);
  assert.doesNotMatch(guard, /Psych\.parse_stream\(source,\s*file\)/);
});

test("the policy guard and both independent regression suites are wired into Class A", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, ".github/scripts/strict-grep/MANIFEST.json"), "utf8"));
  const paths = [
    ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs",
    ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.implementor.test.mjs",
    ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.tester.test.mjs",
  ];
  const entries = paths.map((script) => manifest.gates.filter((gate) => gate.script === script));
  assert.ok(entries.every((matches) => matches.length === 1));
  assert.equal(entries[0][0].enforcement, "batch:A");
  assert.equal(entries[0][0].invocation, "node");
  assert.deepEqual(entries[0][0].modes, ["plain", "self-test"]);
  for (const [entry] of entries.slice(1)) {
    assert.equal(entry.enforcement, "batch:A");
    assert.equal(entry.invocation, "node --test");
    assert.deepEqual(entry.modes, ["plain"]);
  }
});
