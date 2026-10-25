// MINGLA-INVARIANT: I-MERGE-CERTIFIER-STATE-TOTALITY | issue #1865 | Missing, pending, cancelled, stale, timed-out, failed, or malformed lane evidence cannot produce certification; only every applicable lane's exact terminal success can.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CertifierError,
  certificationEvidence,
  changedPaths,
  DEFAULT_REPOSITORY,
  discoverExpectedLanes,
  evaluateCertification,
  GITHUB_ACTIONS_APP_ID,
  globToRegExp,
  HOST_WORKFLOW_PATH,
  matchesOrderedPatterns,
  parseWorkflowSources,
  proveExecutedJobs,
  validateCandidate,
} from "../merge-certifier.mjs";
import {
  ALWAYS_ON as DRAFT_POLICY_ALWAYS_ON,
  REQUIRED_TYPES as DRAFT_POLICY_REQUIRED_TYPES,
  auditWorkflowSources as auditDraftPolicy,
} from "../../../.github/scripts/strict-grep/issue-2881-pr-draft-gate-policy.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const CANDIDATE = "c".repeat(40);
const API = `https://api.github.com/repos/${DEFAULT_REPOSITORY}`;
const workflowPath = (...parts) => `.github/workflows/${parts.join("-")}.${["y", "ml"].join("")}`;
const LANE_A = workflowPath("alpha", "checks");
const LANE_B = workflowPath("beta", "checks");

function source({ name, event = "pull_request", filters = "" }) {
  return `name: ${name}\non:\n  ${event}:\n${filters}jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`;
}

function run(overrides = {}) {
  return {
    id: 10,
    workflow_id: 20,
    check_suite_id: 30,
    name: "Alpha",
    path: LANE_A,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: HEAD,
    run_attempt: 1,
    run_started_at: "2026-10-23T12:00:00Z",
    repository: { full_name: DEFAULT_REPOSITORY },
    head_repository: { full_name: DEFAULT_REPOSITORY },
    pull_requests: [{
      number: 1865,
      head: { sha: HEAD, repo: { url: API } },
      base: { sha: BASE, repo: { url: API } },
    }],
    ...overrides,
  };
}

function jobCheck(overrides = {}) {
  return {
    id: 40,
    head_sha: HEAD,
    status: "completed",
    conclusion: "success",
    started_at: "2026-10-23T12:00:01Z",
    completed_at: "2026-10-23T12:00:02Z",
    details_url: `https://github.com/${DEFAULT_REPOSITORY}/actions/runs/10/job/40`,
    app: { id: GITHUB_ACTIONS_APP_ID },
    check_suite: { id: 30 },
    ...overrides,
  };
}

function evaluate(runs, expectedLanes = [{ path: LANE_A, event: "pull_request", name: "Alpha" }]) {
  return evaluateCertification({
    expectedLanes,
    runs,
    repository: DEFAULT_REPOSITORY,
    prNumber: 1865,
    headSha: HEAD,
    baseSha: BASE,
  });
}

test("path matching preserves double-star, character-class, and ordered-negative semantics", () => {
  assert.match("supabase/functions/a/b/index.ts", globToRegExp("supabase/functions/**"));
  assert.match("root.test.mjs", globToRegExp("**/*.test.mjs"));
  assert.doesNotMatch("app/[id].tsx", globToRegExp("app/[id].tsx"));
  assert.match("app/i.tsx", globToRegExp("app/[id].tsx"));
  assert.equal(matchesOrderedPatterns(["docs/**", "!docs/frozen.md"], "docs/current.md"), true);
  assert.equal(matchesOrderedPatterns(["docs/**", "!docs/frozen.md"], "docs/frozen.md"), false);
});

test("changed paths mirror the three-dot diff's current name while retaining rename provenance", () => {
  assert.deepEqual(changedPaths([
    { filename: "new/name.ts", previous_filename: "old/name.ts", status: "renamed" },
    { filename: "kept.ts", status: "modified" },
  ], 2), ["kept.ts", "new/name.ts"]);
  assert.throws(
    () => changedPaths([{ filename: "new/name.ts", status: "renamed" }], 1),
    /rename has no previous_filename/,
  );
  assert.throws(
    () => changedPaths([{ filename: "file.ts", status: "invented" }], 1),
    /changed-file status is invalid/,
  );
});

test("workflow discovery applies candidate pull filters, trusted target filters, and excludes its host", () => {
  const target = workflowPath("target", "metadata");
  const closeOnly = workflowPath("close", "metadata");
  const pullSources = {
    [LANE_A]: `name: Same display name\non:\n  push:\n    paths: &paths [src/**]\n  pull_request:\n    types: [opened, synchronize, reopened]\n    paths: *paths\njobs: {}\n`,
    [LANE_B]: source({ name: "Same display name", filters: "    paths-ignore: [docs/**]\n" }),
    [HOST_WORKFLOW_PATH]: source({ name: "Host", event: "pull_request_target" }),
  };
  const targetSources = {
    [target]: source({ name: "Target metadata", event: "pull_request_target", filters: "    branches: [main]\n" }),
    [closeOnly]: `name: Close metadata\non:\n  pull_request_target:\n    types: [closed]\njobs: {}\n`,
    [HOST_WORKFLOW_PATH]: source({ name: "Host", event: "pull_request_target" }),
  };
  const lanes = discoverExpectedLanes({ pullSources, targetSources, changedFiles: ["src/index.ts"], baseBranch: "main" });
  assert.deepEqual(lanes.map(({ path, event }) => ({ path, event })), [
    { path: LANE_A, event: "pull_request" },
    { path: LANE_B, event: "pull_request" },
    { path: target, event: "pull_request_target" },
  ]);
});

test("workflow parsing resolves bounded aliases and rejects incomplete YAML evidence", () => {
  const valid = `name: Alias proof\non:\n  push:\n    paths: &paths [src/**]\n  pull_request:\n    paths: *paths\njobs: {}\n`;
  assert.deepEqual(parseWorkflowSources({ [LANE_A]: valid })[LANE_A], {
    name: "Alias proof",
    on: { push: null, pull_request: { paths: ["src/**"] } },
  });
  assert.throws(
    () => parseWorkflowSources({ [LANE_A]: `name: Broken\non:\n  pull_request:\n    paths: *missing\n` }),
    /unknown YAML alias/,
  );
  assert.throws(
    () => parseWorkflowSources({ [LANE_A]: `name: One\nname: Two\non: pull_request\n` }),
    /duplicate YAML key/,
  );
  assert.throws(
    () => parseWorkflowSources({ [LANE_A]: `name: Cycle\non:\n  pull_request:\n    paths: &loop [*loop]\n` }),
    /cyclic YAML alias/,
  );
});

test("the required host re-fires on ready-for-review and cannot drop synchronize", () => {
  const entry = DRAFT_POLICY_ALWAYS_ON.find((candidate) => candidate.context === "Merge Certifier");
  assert.ok(entry);
  const workflow = (types) => `name: Host\non:\n  pull_request_target:\n    types: [${types.join(", ")}]\njobs:\n  certifier:\n    name: Merge Certifier\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`;
  const options = { alwaysOn: [entry], requireBotSource: false };
  assert.deepEqual(auditDraftPolicy({ [entry.path]: workflow(DRAFT_POLICY_REQUIRED_TYPES) }, options).errors, []);
  assert.match(
    auditDraftPolicy({ [entry.path]: workflow(["opened", "reopened", "ready_for_review"]) }, options).errors.join("\n"),
    /use exactly.*synchronize/,
  );
});

test("only exact terminal success certifies", () => {
  const verdict = evaluate([run()]);
  assert.equal(verdict.certified, true);
  assert.equal(verdict.succeeded, 1);
});

test("a successful workflow must expose at least one actually successful job", () => {
  const workflowVerdict = evaluate([run()]);
  assert.equal(proveExecutedJobs(workflowVerdict, [jobCheck()], { headSha: HEAD }).certified, true);
  const allSkipped = proveExecutedJobs(workflowVerdict, [jobCheck({ conclusion: "skipped" })], { headSha: HEAD });
  assert.equal(allSkipped.certified, false);
  assert.equal(allSkipped.entries[0].detail, "no-successful-job");
  const missing = proveExecutedJobs(workflowVerdict, [], { headSha: HEAD });
  assert.equal(missing.entries[0].detail, "job-evidence-missing");
  assert.throws(
    () => proveExecutedJobs(workflowVerdict, [jobCheck({ id: null })], { headSha: HEAD }),
    /invalid check-run id/,
  );
});

for (const [label, runs, state, detail] of [
  ["missing", [], "missing", undefined],
  ["pending", [run({ status: "in_progress", conclusion: null })], "pending", "in_progress"],
  ["cancelled", [run({ conclusion: "cancelled" })], "failed", "cancelled"],
  ["stale conclusion", [run({ conclusion: "stale" })], "failed", "stale"],
  ["timed out", [run({ conclusion: "timed_out" })], "failed", "timed_out"],
  ["assertion failure", [run({ conclusion: "failure" })], "failed", "failure"],
  ["stale base", [run({ pull_requests: [{
    number: 1865,
    head: { sha: HEAD, repo: { url: API } },
    base: { sha: "d".repeat(40), repo: { url: API } },
  }] })], "stale", undefined],
]) {
  test(`${label} lane refuses certification`, () => {
    const verdict = evaluate(runs);
    assert.equal(verdict.certified, false);
    assert.equal(verdict.entries[0].state, state);
    assert.equal(verdict.entries[0].detail, detail);
  });
}

test("the newest exact run controls the verdict and cannot hide behind an older success", () => {
  const verdict = evaluate([
    run(),
    run({ id: 11, status: "queued", conclusion: null, run_started_at: "2026-10-23T12:01:00Z" }),
  ]);
  assert.equal(verdict.certified, false);
  assert.equal(verdict.entries[0].state, "pending");
});

test("a second snapshot can prove that lane evidence stayed byte-for-byte stable", () => {
  const stable = evaluate([run({ updated_at: "2026-10-23T12:01:00Z" })]);
  const changed = evaluate([run({
    status: "in_progress",
    conclusion: null,
    run_attempt: 2,
    updated_at: "2026-10-23T12:02:00Z",
  })]);
  assert.equal(certificationEvidence(stable), certificationEvidence(structuredClone(stable)));
  assert.notEqual(certificationEvidence(stable), certificationEvidence(changed));
});

test("malformed and incomplete API data fail closed", () => {
  for (const mutation of [
    { status: "completed", conclusion: null },
    { status: "in_progress", conclusion: "success" },
    { repository: {} },
    { pull_requests: null },
    { run_attempt: 0 },
  ]) {
    assert.throws(() => evaluate([run(mutation)]), CertifierError);
  }
});

test("candidate provenance requires exact current-main then head parents", () => {
  const input = {
    repository: DEFAULT_REPOSITORY,
    branch: "main",
    pull: {
      state: "open",
      draft: false,
      merge_commit_sha: CANDIDATE,
      base: { ref: "main", sha: BASE, repo: { full_name: DEFAULT_REPOSITORY } },
      head: { sha: HEAD, repo: { full_name: DEFAULT_REPOSITORY } },
    },
    mainRef: { ref: "refs/heads/main", object: { type: "commit", sha: BASE } },
    mergeCommit: { sha: CANDIDATE, parents: [{ sha: BASE }, { sha: HEAD }] },
  };
  assert.deepEqual(validateCandidate(input), { baseSha: BASE, headSha: HEAD, candidateSha: CANDIDATE, mainSha: BASE });
  assert.throws(
    () => validateCandidate({ ...input, mergeCommit: { ...input.mergeCommit, parents: [{ sha: HEAD }, { sha: BASE }] } }),
    /parents are not exact current main then PR head/,
  );
});

test("two applicable lanes require two successes", () => {
  const expected = [
    { path: LANE_A, event: "pull_request", name: "Alpha" },
    { path: LANE_B, event: "pull_request", name: "Beta" },
  ];
  const verdict = evaluate([run()], expected);
  assert.equal(verdict.certified, false);
  assert.deepEqual(verdict.entries.map((entry) => entry.state), ["success", "missing"]);
});
