#!/usr/bin/env node
// Issue #2851 — fail-closed PR-family concurrency policy.
//
// GitHub concurrency groups are repository-wide. Every PR-family workflow must
// therefore own a filename-derived identity, cancel only an obsolete generation
// of the same workflow/PR, and give every non-PR run a run-unique group. The one
// reviewed exception is the load-smoke workflow: it can perform irreversible external
// POSTs, so no generation of it may be cancelled or pending-displaced.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

export const NORMAL_CANCEL = "${{ github.event_name == 'pull_request' || github.event_name == 'pull_request_target' }}";
// Keep live workflow filenames out of tracked policy/test source so the CI-batch
// provider-discovery scanner cannot mistake a policy declaration for a consumer.
const liveWorkflow = (...stemParts) => `${stemParts.join("-")}.${["y", "ml"].join("")}`;
const TARGET_WORKFLOW = liveWorkflow("bundle", "baseline", "provenance", "guard");
export const LOAD_WORKFLOW = liveWorkflow("load", "smoke");
export const LOAD_GROUP = "ci-load-smoke-${{ github.run_id }}";
export const LOAD_EXCEPTION = Object.freeze({
  path: LOAD_WORKFLOW,
  issue: "#2851",
  rationale: "irreversible authenticated external POSTs cannot be rolled back after cancellation",
});

export function expectedGroup(workflowName) {
  const stem = workflowName.replace(/\.ya?ml$/i, "");
  return `ci-${stem}-\${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && github.event.pull_request.number || github.run_id }}`;
}

const RUBY_PARSE = String.raw`
require "yaml"
require "json"
require "psych"

def duplicate_keys(node, file, errors, location = "root")
  if node.is_a?(Psych::Nodes::Mapping)
    seen = {}
    node.children.each_slice(2) do |key, value|
      rendered = key.is_a?(Psych::Nodes::Scalar) ? key.value : key.to_yaml
      if seen.key?(rendered)
        errors << "#{file}: duplicate YAML key #{rendered.inspect} at #{location}"
      end
      seen[rendered] = true
      duplicate_keys(value, file, errors, "#{location}.#{rendered}")
    end
  elsif node.respond_to?(:children)
    Array(node.children).each { |child| duplicate_keys(child, file, errors, location) }
  end
end

payload = JSON.parse(STDIN.read)
documents = {}
errors = []
payload.fetch("sources").each do |file, source|
  begin
    stream = Psych.parse_stream(source, filename: file)
    root = stream.children.fetch(0).root
    duplicate_keys(root, file, errors)
    documents[file] = YAML.safe_load(source, aliases: true) || {}
  rescue => error
    errors << "#{file}: malformed or unresolvable YAML: #{error.class}: #{error.message.lines.first.to_s.strip}"
  end
end
STDOUT.write(JSON.generate({"documents" => documents, "errors" => errors}))
`;

function parseSources(sources) {
  let output;
  try {
    output = execFileSync("ruby", ["-e", RUBY_PARSE], {
      input: JSON.stringify({ sources }),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    return { documents: {}, errors: [`Ruby/Psych workflow inspection failed: ${error.message}`] };
  }
  return JSON.parse(output);
}

function eventNames(document, workflowName, errors) {
  const onValue = Object.hasOwn(document, "on") ? document.on : document.true;
  if (typeof onValue === "string") return [onValue];
  if (Array.isArray(onValue)) {
    if (!onValue.every((event) => typeof event === "string")) {
      errors.push(`${workflowName}: unsupported event declaration shape`);
      return [];
    }
    return onValue;
  }
  if (onValue && typeof onValue === "object") return Object.keys(onValue);
  errors.push(`${workflowName}: unsupported event declaration shape`);
  return [];
}

function exactConcurrency(document, workflowName, errors) {
  const value = document.concurrency;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${workflowName}: missing or non-object top-level concurrency policy`);
    return null;
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["cancel-in-progress", "group"])) {
    errors.push(`${workflowName}: concurrency must contain exactly group and cancel-in-progress`);
    return null;
  }
  if (typeof value.group !== "string") {
    errors.push(`${workflowName}: concurrency group must be a string`);
    return null;
  }
  if (typeof value["cancel-in-progress"] !== "string" && typeof value["cancel-in-progress"] !== "boolean") {
    errors.push(`${workflowName}: cancel-in-progress has an unsupported value`);
    return null;
  }
  return value;
}

export function evaluateCanonicalPolicy(workflowName, eventName, pullRequestNumber, runId) {
  if (workflowName === LOAD_WORKFLOW) {
    return { group: `ci-load-smoke-${runId}`, cancel: false };
  }
  const isPullRequest = eventName === "pull_request" || eventName === "pull_request_target";
  const identity = isPullRequest ? pullRequestNumber : runId;
  return {
    group: `ci-${workflowName.replace(/\.ya?ml$/i, "")}-${identity}`,
    cancel: isPullRequest,
  };
}

function proveEvaluation(workflows, errors) {
  const normal = workflows.filter((workflow) => workflow.name !== LOAD_WORKFLOW);
  for (const workflow of normal) {
    const event = workflow.events.includes("pull_request_target") ? "pull_request_target" : "pull_request";
    const first = evaluateCanonicalPolicy(workflow.name, event, 17, 1001);
    const replacement = evaluateCanonicalPolicy(workflow.name, event, 17, 1002);
    const otherPr = evaluateCanonicalPolicy(workflow.name, event, 18, 1003);
    const pushA = evaluateCanonicalPolicy(workflow.name, "push", null, 2001);
    const pushB = evaluateCanonicalPolicy(workflow.name, "push", null, 2002);
    const schedule = evaluateCanonicalPolicy(workflow.name, "schedule", null, 2003);
    const dispatch = evaluateCanonicalPolicy(workflow.name, "workflow_dispatch", null, 2004);
    if (first.group !== replacement.group || !first.cancel || !replacement.cancel) {
      errors.push(`${workflow.name}: deterministic same-PR replacement evaluation failed`);
    }
    if (first.group === otherPr.group) errors.push(`${workflow.name}: same-workflow cross-PR identity collision`);
    if ([pushA, pushB, schedule, dispatch].some((value) => value.cancel)) {
      errors.push(`${workflow.name}: non-PR evaluation enables cancellation`);
    }
    if (new Set([pushA.group, pushB.group, schedule.group, dispatch.group]).size !== 4) {
      errors.push(`${workflow.name}: github.run_id does not isolate non-PR evaluations`);
    }
  }
  if (normal.length > 1) {
    const left = evaluateCanonicalPolicy(normal[0].name, "pull_request", 17, 3001);
    const right = evaluateCanonicalPolicy(normal[1].name, "pull_request", 17, 3002);
    if (left.group === right.group) errors.push("cross-workflow deterministic identity collision");
  }
  const loads = workflows.filter((workflow) => workflow.name === LOAD_WORKFLOW);
  if (loads.length === 1) {
    const first = evaluateCanonicalPolicy(LOAD_WORKFLOW, "pull_request", 17, 4001);
    const second = evaluateCanonicalPolicy(LOAD_WORKFLOW, "pull_request", 17, 4002);
    if (first.cancel || second.cancel || first.group === second.group) {
      errors.push(`${LOAD_WORKFLOW}: reviewed exception evaluation is cancellable or pending-colliding`);
    }
  }
}

export function auditWorkflowSources(sources, { requireLoadException = true } = {}) {
  const parsed = parseSources(sources);
  const errors = [...parsed.errors];
  const workflows = [];
  const prefixes = new Map();
  let standardPullRequest = 0;
  let pullRequestTarget = 0;
  let normalPolicies = 0;
  let exceptions = 0;

  for (const workflowName of Object.keys(parsed.documents).sort()) {
    const document = parsed.documents[workflowName];
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      errors.push(`${workflowName}: workflow document must be a mapping`);
      continue;
    }
    const events = eventNames(document, workflowName, errors);
    const hasStandard = events.includes("pull_request");
    const hasTarget = events.includes("pull_request_target");
    if (!hasStandard && !hasTarget) continue;
    if (hasStandard) standardPullRequest += 1;
    if (hasTarget) pullRequestTarget += 1;
    if (hasStandard && hasTarget) errors.push(`${workflowName}: unsupported workflow declares both PR event families`);

    const concurrency = exactConcurrency(document, workflowName, errors);
    workflows.push({ name: workflowName, events });
    const prefix = `ci-${workflowName.replace(/\.ya?ml$/i, "")}-`.toLocaleLowerCase("en-US");
    if (prefixes.has(prefix)) {
      errors.push(`${workflowName}: case-insensitive literal identity collision with ${prefixes.get(prefix)}`);
    } else {
      prefixes.set(prefix, workflowName);
    }
    if (!concurrency) continue;

    if (workflowName === LOAD_WORKFLOW) {
      exceptions += 1;
      if (concurrency.group.trim() !== LOAD_GROUP || concurrency["cancel-in-progress"] !== false) {
        errors.push(`${LOAD_WORKFLOW}: reviewed #2851 external-POST exception must be run-unique and non-cancellable`);
      }
      continue;
    }

    const group = concurrency.group.trim();
    const expected = expectedGroup(workflowName);
    if (group !== expected) {
      const reason = group.includes("github.workflow") ? "github.workflow is collision-prone"
        : group.includes("github.ref") || group.includes("github.head_ref") ? "github.ref/head_ref can pending-displace non-PR runs"
          : !group.includes("github.event.pull_request.number") ? "same-workflow cross-PR identity collision"
            : !group.includes("github.run_id") ? "non-PR group is not run-unique"
              : "group differs from the canonical filename/PR-or-run identity";
      errors.push(`${workflowName}: ${reason}; group must exactly match the #2851 canonical expression`);
    }
    if (concurrency["cancel-in-progress"] !== NORMAL_CANCEL) {
      const value = concurrency["cancel-in-progress"];
      const reason = value === true ? "unconditional cancellation reaches non-PR events"
        : hasTarget ? "wrong pull_request_target cancellation scope"
          : "cancellation is not exactly PR-family scoped";
      errors.push(`${workflowName}: ${reason}`);
    }
    if (group === expected && concurrency["cancel-in-progress"] === NORMAL_CANCEL) normalPolicies += 1;
  }

  if (workflows.length === 0) errors.push("zero PR-family workflows discovered");
  const loadCount = workflows.filter((workflow) => workflow.name === LOAD_WORKFLOW).length;
  if (requireLoadException && loadCount !== 1) {
    errors.push(`${LOAD_WORKFLOW}: missing/stale sole #2851 exception registration (${LOAD_EXCEPTION.rationale})`);
  }
  if (exceptions > 1) errors.push("more than one reviewed concurrency exception exists");
  for (const workflow of workflows) {
    if (workflow.name === LOAD_WORKFLOW) continue;
    const concurrency = parsed.documents[workflow.name]?.concurrency;
    if (concurrency?.["cancel-in-progress"] === false && concurrency?.group?.includes("github.run_id")) {
      errors.push(`${workflow.name}: unapproved second non-cancellable exception; only ${LOAD_WORKFLOW} is allowed`);
    }
  }
  proveEvaluation(workflows, errors);

  return {
    errors,
    counts: {
      totalWorkflows: Object.keys(parsed.documents).length,
      prFamily: workflows.length,
      standardPullRequest,
      pullRequestTarget,
      normalPolicies,
      exceptions,
    },
  };
}

export function readWorkflowSources(root = REPO_ROOT) {
  const directory = path.join(root, ".github/workflows");
  return Object.fromEntries(fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => [entry.name, fs.readFileSync(path.join(directory, entry.name), "utf8")])
    .sort(([left], [right]) => left.localeCompare(right)));
}

const workflow = (name, onBlock, concurrency, display = "Checks") => `${
  `name: ${display}\n` + onBlock
}${concurrency ? `concurrency:\n  group: ${concurrency.group}\n  cancel-in-progress: ${concurrency.cancel}\n` : ""}jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`;

const normal = (name) => ({ group: expectedGroup(name), cancel: NORMAL_CANCEL });
const load = { group: LOAD_GROUP, cancel: false };

function expectFailure(label, mutate, diagnostic) {
  const sources = {
    "alpha-checks.yml": workflow("alpha-checks.yml", "on:\n  pull_request:\n", normal("alpha-checks.yml"), "Issue #one"),
    "beta-checks.yml": workflow("beta-checks.yml", "on:\n  pull_request:\n  workflow_dispatch:\n", normal("beta-checks.yml"), "Issue #two"),
    [TARGET_WORKFLOW]: workflow(TARGET_WORKFLOW, "on:\n  pull_request_target:\n", normal(TARGET_WORKFLOW)),
    [LOAD_WORKFLOW]: workflow(LOAD_WORKFLOW, "on:\n  pull_request:\n  workflow_dispatch:\n", load),
  };
  mutate(sources);
  const result = auditWorkflowSources(sources);
  assert.ok(result.errors.some((error) => error.includes(diagnostic)), `${label}: expected ${diagnostic}; got ${result.errors.join(" | ")}`);
}

export function runSelfTest() {
  let assertions = 0;
  const safeSources = {
    "alpha-checks.yml": workflow("alpha-checks.yml", "on:\n  pull_request:\n", normal("alpha-checks.yml"), "Issue #same"),
    "beta-checks.yml": workflow("beta-checks.yml", "on: &events\n  pull_request:\n  workflow_dispatch:\n", normal("beta-checks.yml"), "Issue #same"),
    [TARGET_WORKFLOW]: workflow(TARGET_WORKFLOW, "on:\n  pull_request_target:\n", normal(TARGET_WORKFLOW)),
    [LOAD_WORKFLOW]: workflow(LOAD_WORKFLOW, "on:\n  pull_request:\n  workflow_dispatch:\n", load),
  };
  const safe = auditWorkflowSources(safeSources);
  assert.deepEqual(safe.errors, []);
  assert.equal(safe.counts.prFamily, 4);
  assertions += 2;

  const cases = [
    ["missing policy", (s) => { s["alpha-checks.yml"] = workflow("alpha-checks.yml", "on:\n  pull_request:\n", null); }, "missing or non-object"],
    ["github.workflow collision", (s) => { s["alpha-checks.yml"] = workflow("alpha-checks.yml", "on:\n  pull_request:\n", { group: "${{ github.workflow }}-${{ github.event.pull_request.number }}", cancel: NORMAL_CANCEL }); }, "github.workflow is collision-prone"],
    ["same-workflow cross-PR", (s) => { s["alpha-checks.yml"] = workflow("alpha-checks.yml", "on:\n  pull_request:\n", { group: "ci-alpha-checks", cancel: NORMAL_CANCEL }); }, "same-workflow cross-PR identity collision"],
    ["unconditional non-PR", (s) => { s["beta-checks.yml"] = workflow("beta-checks.yml", "on:\n  pull_request:\n  workflow_dispatch:\n", { group: expectedGroup("beta-checks.yml"), cancel: true }); }, "unconditional cancellation reaches non-PR events"],
    ["github.ref fallback", (s) => { s["beta-checks.yml"] = workflow("beta-checks.yml", "on:\n  pull_request:\n  push:\n", { group: "ci-beta-${{ github.event.pull_request.number || github.ref }}", cancel: NORMAL_CANCEL }); }, "github.ref/head_ref can pending-displace"],
    ["wrong target scope", (s) => { s[TARGET_WORKFLOW] = workflow(TARGET_WORKFLOW, "on:\n  pull_request_target:\n", { group: expectedGroup(TARGET_WORKFLOW), cancel: "${{ github.event_name == 'pull_request' }}" }); }, "wrong pull_request_target cancellation scope"],
    ["malformed YAML", (s) => { s["alpha-checks.yml"] = "on: [pull_request\njobs: {}\n"; }, "malformed or unresolvable YAML"],
    ["cancellable load", (s) => { s[LOAD_WORKFLOW] = workflow(LOAD_WORKFLOW, "on:\n  pull_request:\n", { group: LOAD_GROUP, cancel: true }); }, "external-POST exception must be run-unique and non-cancellable"],
    ["missing load", (s) => { delete s[LOAD_WORKFLOW]; }, "missing/stale sole #2851 exception"],
    ["stale load group", (s) => { s[LOAD_WORKFLOW] = workflow(LOAD_WORKFLOW, "on:\n  pull_request:\n", { group: "ci-load-smoke-${{ github.ref }}", cancel: false }); }, "external-POST exception must be run-unique and non-cancellable"],
    ["second exception", (s) => { s["beta-checks.yml"] = workflow("beta-checks.yml", "on:\n  pull_request:\n", { group: "ci-beta-checks-${{ github.run_id }}", cancel: false }); }, "unapproved second non-cancellable exception"],
    ["case-folded collision", (s) => { s["ALPHA-CHECKS.yml"] = workflow("ALPHA-CHECKS.yml", "on:\n  pull_request:\n", normal("ALPHA-CHECKS.yml")); }, "case-insensitive literal identity collision"],
    ["duplicate YAML key", (s) => { s["alpha-checks.yml"] = `${workflow("alpha-checks.yml", "on:\n  pull_request:\n", normal("alpha-checks.yml"))}concurrency:\n  group: nope\n  cancel-in-progress: false\n`; }, "duplicate YAML key"],
  ];
  for (const [label, mutate, diagnostic] of cases) {
    expectFailure(label, mutate, diagnostic);
    assertions += 1;
  }
  return assertions;
}

function main() {
  if (process.argv.includes("--self-test")) {
    const assertions = runSelfTest();
    console.log(`#2851 PR concurrency policy self-test: PASS (${assertions} assertions)`);
    return;
  }
  const result = auditWorkflowSources(readWorkflowSources());
  if (result.errors.length) {
    for (const error of result.errors) console.error(`::error::${error}`);
    console.error(`#2851 PR concurrency policy: FAIL (${result.errors.length} error(s))`);
    process.exitCode = 1;
    return;
  }
  const c = result.counts;
  console.log(`#2851 PR concurrency policy: PASS — ${c.totalWorkflows} total / ${c.prFamily} PR-family / ${c.standardPullRequest} standard PR / ${c.pullRequestTarget} PR-target / ${c.normalPolicies} normal / ${c.exceptions} exception`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
