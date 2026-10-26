// MINGLA-INVARIANT: I-MERGE-CERTIFIER-STATE-TOTALITY | issue #1865 | Running, failed, cancelled, timed-out, or absent lane evidence cannot produce certification; only every lane GitHub ran for the exact head reaching a passing conclusion, confirmed by two agreeing reads, can.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CertifierError,
  certify,
  DEFAULT_REPOSITORY,
  evaluate,
  fingerprint,
  GitHubApi,
  HOST_WORKFLOW_PATH,
  renderVerdict,
  selectLaneRuns,
  validatePull,
} from "../merge-certifier.mjs";
import {
  ALWAYS_ON as DRAFT_POLICY_ALWAYS_ON,
  REQUIRED_TYPES as DRAFT_POLICY_REQUIRED_TYPES,
  auditWorkflowSources as auditDraftPolicy,
} from "../../../.github/scripts/strict-grep/issue-2881-pr-draft-gate-policy.mjs";

const PR = 1865;
const HEAD = "a".repeat(40);
const OTHER_HEAD = "d".repeat(40);
const workflowPath = (...parts) => `.github/workflows/${parts.join("-")}.${["y", "ml"].join("")}`;
const LANE_A = workflowPath("alpha", "checks");
const LANE_B = workflowPath("beta", "checks");

let nextId = 100;
function run(overrides = {}) {
  nextId += 1;
  return {
    id: nextId,
    name: "Alpha",
    path: LANE_A,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: HEAD,
    run_attempt: 1,
    run_started_at: "2026-10-26T12:00:00Z",
    repository: { full_name: DEFAULT_REPOSITORY },
    pull_requests: [{ number: PR }],
    ...overrides,
  };
}

function pull(overrides = {}) {
  return {
    number: PR,
    state: "open",
    draft: false,
    base: { ref: "main", repo: { full_name: DEFAULT_REPOSITORY } },
    head: { sha: HEAD, repo: { full_name: DEFAULT_REPOSITORY } },
    ...overrides,
  };
}

const lanes = (runs) => selectLaneRuns(runs, { prNumber: PR, headSha: HEAD });

// A fake API that serves one run list per poll (the last one repeats).
function fakeApi({ polls, pulls = [pull()] }) {
  let poll = 0;
  let pullRead = 0;
  return {
    calls: { runs: 0 },
    async get(suffix) {
      assert.equal(suffix, `/pulls/${PR}`);
      const value = pulls[Math.min(pullRead, pulls.length - 1)];
      pullRead += 1;
      if (value instanceof Error) throw value;
      return value;
    },
    async runsForHead(headSha) {
      assert.equal(headSha, HEAD);
      this.calls.runs += 1;
      const value = polls[Math.min(poll, polls.length - 1)];
      poll += 1;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

function clock() {
  let time = 0;
  return { now: () => time, sleep: async (ms) => { time += ms; } };
}

const run2 = (overrides) => run({ name: "Beta", path: LANE_B, ...overrides });

test("bot runs outside .github/workflows are ignored, never fatal (the Copilot review regression)", () => {
  const copilot = run({ name: "Running Copilot Code Review", path: "dynamic/agents/copilot-pull-request-reviewer", event: "dynamic" });
  const copilotOnPrEvent = run({ path: "dynamic/agents/copilot-pull-request-reviewer", conclusion: "failure" });
  const selected = lanes([run(), copilot, copilotOnPrEvent]);
  assert.equal(selected.length, 1);
  assert.equal(evaluate(selected).verdict, "certified");
});

test("only lanes GitHub actually ran are judged; a path-skipped workflow is not waited for", () => {
  // The first certifier predicted lanes from path filters and waited forever for
  // ones GitHub skipped (it read `+` in `app/+native-intent.tsx` literally).
  const result = evaluate(lanes([run(), run2()]));
  assert.equal(result.verdict, "certified");
  assert.equal(result.lanes.length, 2);
});

test("runs for another head, another PR, another repository, a non-PR event, or the certifier itself do not count", () => {
  const ignored = [
    run({ head_sha: OTHER_HEAD, conclusion: "failure" }),
    run({ pull_requests: [{ number: PR + 1 }], conclusion: "failure" }),
    run({ pull_requests: [], conclusion: "failure" }),
    run({ repository: { full_name: "someone/fork" }, conclusion: "failure" }),
    run({ event: "push", conclusion: "failure" }),
    run({ path: HOST_WORKFLOW_PATH, event: "pull_request_target", status: "in_progress", conclusion: null }),
    null,
  ];
  assert.deepEqual(lanes(ignored), []);
  assert.equal(evaluate(lanes([run(), ...ignored])).verdict, "certified");
});

test("every non-passing state refuses or waits; only success, skipped, and neutral pass", () => {
  for (const conclusion of ["success", "skipped", "neutral"]) {
    assert.equal(evaluate([run({ conclusion })]).verdict, "certified", conclusion);
  }
  for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale", null, "made-up"]) {
    const result = evaluate([run(), run2({ conclusion })]);
    assert.equal(result.verdict, "refused", String(conclusion));
    assert.equal(result.failed, 1);
  }
  for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
    assert.equal(evaluate([run(), run2({ status, conclusion: null })]).verdict, "pending", status);
  }
});

test("no lanes at all is never certification", () => {
  assert.equal(evaluate([]).verdict, "pending");
});

test("a failure anywhere refuses even while other lanes are still running", () => {
  const result = evaluate([run({ conclusion: "failure" }), run2({ status: "in_progress", conclusion: null })]);
  assert.equal(result.verdict, "refused");
});

test("the newest run or rerun attempt of a lane decides it, in both directions", () => {
  const olderSuccess = run({ run_started_at: "2026-10-26T12:00:00Z" });
  const newerFailure = run({ run_started_at: "2026-10-26T12:05:00Z", conclusion: "failure" });
  assert.equal(evaluate([olderSuccess, newerFailure]).verdict, "refused");

  const olderFailure = run({ run_started_at: "2026-10-26T12:00:00Z", conclusion: "cancelled" });
  const newerSuccess = run({ run_started_at: "2026-10-26T12:05:00Z" });
  assert.equal(evaluate([olderFailure, newerSuccess]).verdict, "certified");

  const sameStart = "2026-10-26T12:00:00Z";
  assert.equal(evaluate([run({ run_started_at: sameStart, run_attempt: 1 }), run({ run_started_at: sameStart, run_attempt: 2, conclusion: "failure" })]).verdict, "refused");
});

test("pull_request and pull_request_target runs of one file are separate lanes", () => {
  const result = evaluate([run(), run({ event: "pull_request_target", conclusion: "failure" })]);
  assert.equal(result.lanes.length, 2);
  assert.equal(result.verdict, "refused");
});

test("the certifier waits for running lanes, then certifies once two reads agree", async () => {
  const time = clock();
  const running = [run(), run2({ status: "in_progress", conclusion: null })];
  const done = [run(), run2()];
  const api = fakeApi({ polls: [running, running, done, done] });
  const outcome = await certify({ api, prNumber: PR, ...time, intervalMs: 60_000, deadlineMs: 3_600_000 });
  assert.equal(outcome.result.verdict, "certified");
  assert.equal(api.calls.runs, 4);
});

test("evidence that changes between reads means keep watching, not fail", async () => {
  const time = clock();
  const firstGreen = [run({ id: 1 })];
  const laneRerun = [run({ id: 1, run_attempt: 2, status: "in_progress", conclusion: null })];
  const settled = [run({ id: 1, run_attempt: 2 })];
  const api = fakeApi({ polls: [firstGreen, laneRerun, settled, settled] });
  const outcome = await certify({ api, prNumber: PR, ...time });
  assert.equal(outcome.result.verdict, "certified");
  assert.equal(outcome.result.lanes[0].run.run_attempt, 2);
});

test("a refusal superseded before confirmation does not stick", async () => {
  const time = clock();
  const cancelled = [run({ id: 1, conclusion: "cancelled", run_started_at: "2026-10-26T12:00:00Z" })];
  const replaced = [...cancelled, run({ id: 2, run_started_at: "2026-10-26T12:01:00Z" })];
  const api = fakeApi({ polls: [cancelled, replaced, replaced] });
  assert.equal((await certify({ api, prNumber: PR, ...time })).result.verdict, "certified");
});

test("a confirmed failure refuses", async () => {
  const time = clock();
  const failed = [run(), run2({ conclusion: "failure" })];
  const outcome = await certify({ api: fakeApi({ polls: [failed] }), prNumber: PR, ...time });
  assert.equal(outcome.result.verdict, "refused");
  assert.match(renderVerdict(outcome.result, outcome), /REFUSED[\s\S]*failed\/failure: Beta/);
});

test("lanes still running at the deadline time out instead of certifying", async () => {
  const time = clock();
  const running = [run({ status: "in_progress", conclusion: null })];
  const outcome = await certify({ api: fakeApi({ polls: [running] }), prNumber: PR, ...time, intervalMs: 60_000, deadlineMs: 300_000 });
  assert.equal(outcome.result.verdict, "pending");
  assert.match(renderVerdict(outcome.result, outcome), /TIMED OUT/);
});

test("transient GitHub errors are retried, real ones stop at once", async () => {
  const time = clock();
  const transient = new CertifierError("TRANSIENT", "GET returned 502");
  const api = fakeApi({ polls: [transient, [run()], [run()]] });
  assert.equal((await certify({ api, prNumber: PR, ...time })).result.verdict, "certified");

  const real = new CertifierError("GITHUB_API", "GET returned 404");
  await assert.rejects(certify({ api: fakeApi({ polls: [real] }), prNumber: PR, ...time }), /GITHUB_API/);
});

test("a head that moves during certification is never certified", async () => {
  const time = clock();
  const moved = pull({ head: { sha: OTHER_HEAD, repo: { full_name: DEFAULT_REPOSITORY } } });
  const api = fakeApi({ polls: [[run()]], pulls: [pull(), moved] });
  await assert.rejects(certify({ api, prNumber: PR, ...time }), /SUPERSEDED/);
});

test("drafts, closed PRs, other base branches and fork heads are refused at once", () => {
  assert.equal(validatePull(pull()).headSha, HEAD);
  assert.throws(() => validatePull(pull({ draft: true })), /draft/);
  assert.throws(() => validatePull(pull({ state: "closed" })), /not open/);
  assert.throws(() => validatePull(pull({ base: { ref: "release", repo: { full_name: DEFAULT_REPOSITORY } } })), /does not target main/);
  assert.throws(() => validatePull(pull({ head: { sha: HEAD, repo: { full_name: "someone/fork" } } })), /branch of this repository/);
  assert.throws(() => validatePull(pull({ head: { sha: "abc", repo: { full_name: DEFAULT_REPOSITORY } } })), /full commit SHA/);
});

test("fingerprints differ whenever a lane's run, attempt, or state differs", () => {
  const base = evaluate([run({ id: 7 })]);
  assert.equal(fingerprint(base), fingerprint(evaluate([run({ id: 7 })])));
  assert.notEqual(fingerprint(base), fingerprint(evaluate([run({ id: 7, run_attempt: 2 })])));
  assert.notEqual(fingerprint(base), fingerprint(evaluate([run({ id: 8 })])));
  assert.notEqual(fingerprint(base), fingerprint(evaluate([run({ id: 7, conclusion: "failure" })])));
});

test("the API client treats only throttling and server errors as transient", async () => {
  const respond = (status, headers = {}) => async () => ({
    ok: status < 400,
    status,
    headers: new Headers(headers),
    json: async () => ({ workflow_runs: [] }),
  });
  const code = async (fetchImpl) => {
    try {
      await new GitHubApi({ repository: DEFAULT_REPOSITORY, token: "t", fetchImpl }).get("/pulls/1");
      return "ok";
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(await code(respond(200)), "ok");
  for (const status of [429, 500, 502, 503, 504]) assert.equal(await code(respond(status)), "TRANSIENT", String(status));
  assert.equal(await code(respond(403, { "x-ratelimit-remaining": "0" })), "TRANSIENT");
  assert.equal(await code(respond(403)), "GITHUB_API");
  assert.equal(await code(respond(404)), "GITHUB_API");
  assert.equal(await code(async () => { throw new Error("socket hang up"); }), "TRANSIENT");
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
