#!/usr/bin/env node
// MINGLA-INVARIANT: I-MERGE-CERTIFIER-EXACT-CANDIDATE | issue #1865 | Certification is success only when every workflow lane GitHub actually ran for the open pull request's exact head has reached a passing terminal conclusion, and that verdict held across two consecutive reads.
//
// How it decides (rebuilt on #1865, 2026-10-26):
//   1. It does NOT predict which workflows should run. It reads the runs GitHub
//      actually made for this pull request's head commit. The first version
//      re-implemented GitHub's path-filter rules, and every place the copy
//      disagreed with GitHub (for example `+` in a path pattern) left a PR
//      waiting forever for a lane that GitHub had correctly skipped.
//   2. Only runs that come from a file in `.github/workflows/` count. Bot runs
//      such as Copilot code review (`dynamic/...`) are ignored, never fatal.
//   3. It waits. It polls until every lane has finished, so nobody has to rerun
//      it by hand once the slower lanes settle.
//   4. A verdict is final only when two consecutive reads agree. A read that
//      differs from the last one (a lane just started, a rerun landed) means
//      "keep watching", not "fail".
//   5. Transient GitHub API errors are retried until the deadline.
// Keeping the branch current with main is enforced by the ruleset's strict
// "up to date" policy; updating the branch changes the head, which re-runs
// every lane and this certifier.

export const DEFAULT_REPOSITORY = "Mingla-LLC/mingla-main";
export const DEFAULT_BRANCH = "main";
export const HOST_WORKFLOW_PATH = `.github/workflows/${["bundle", "baseline", "provenance", "guard"].join("-")}.${["y", "ml"].join("")}`;
export const PR_EVENTS = new Set(["pull_request", "pull_request_target"]);
export const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);
export const POLL_INTERVAL_MS = 60_000;
export const DEFAULT_DEADLINE_MS = 55 * 60_000;
const SHA = /^[0-9a-f]{40}$/;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/;

export class CertifierError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CertifierError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CertifierError(code, message);
}

export function runPath(run) {
  return String(run?.path ?? "").split("@")[0];
}

function runTime(run) {
  return Date.parse(run?.run_started_at ?? run?.created_at ?? "") || 0;
}

// The pull request this certifier may judge. Anything else is a refusal the
// author has to act on, so it fails at once instead of waiting.
export function validatePull(pull, { repository = DEFAULT_REPOSITORY, branch = DEFAULT_BRANCH } = {}) {
  if (!pull || typeof pull !== "object") fail("MALFORMED_API", "pull request is not an object");
  if (pull.state !== "open") fail("NOT_CERTIFIABLE", "pull request is not open");
  if (pull.draft !== false) fail("NOT_CERTIFIABLE", "pull request is still a draft; mark it ready for review");
  if (pull.base?.ref !== branch) fail("NOT_CERTIFIABLE", `pull request does not target ${branch}`);
  if (pull.base?.repo?.full_name !== repository || pull.head?.repo?.full_name !== repository) {
    fail("NOT_CERTIFIABLE", "pull request does not come from a branch of this repository");
  }
  const headSha = String(pull.head?.sha ?? "");
  if (!SHA.test(headSha)) fail("MALFORMED_API", "pull request head is not a full commit SHA");
  return { headSha };
}

// Keeps only the runs that are lanes of this pull request: a real workflow file,
// a pull-request event, this exact head, associated with this PR number, and
// not this certifier's own workflow. Everything else is ignored, never fatal.
export function selectLaneRuns(runs, { prNumber, headSha, repository = DEFAULT_REPOSITORY }) {
  if (!Array.isArray(runs)) fail("MALFORMED_API", "workflow run list is absent");
  return runs.filter((run) =>
    run && typeof run === "object" &&
    WORKFLOW_PATH.test(runPath(run)) &&
    runPath(run) !== HOST_WORKFLOW_PATH &&
    PR_EVENTS.has(run.event) &&
    run.head_sha === headSha &&
    run.repository?.full_name === repository &&
    Array.isArray(run.pull_requests) &&
    run.pull_requests.some((pull) => pull?.number === prNumber)
  );
}

function newestRun(runs) {
  return [...runs].sort((left, right) =>
    runTime(right) - runTime(left) ||
    (right.run_attempt ?? 0) - (left.run_attempt ?? 0) ||
    (right.id ?? 0) - (left.id ?? 0)
  )[0];
}

// One lane per workflow file and event; the newest run (or rerun attempt)
// decides it. An older success cannot hide a newer failure, and an older
// failure stops counting once a newer run of that lane passes.
export function evaluate(laneRuns) {
  const groups = new Map();
  for (const run of laneRuns) {
    const key = `${runPath(run)}\0${run.event}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const lanes = [...groups.values()].map((group) => {
    const run = newestRun(group);
    const lane = { path: runPath(run), event: run.event, name: run.name ?? runPath(run), run };
    if (run.status !== "completed") return { ...lane, state: "pending", detail: String(run.status ?? "unknown") };
    if (PASSING_CONCLUSIONS.has(run.conclusion)) return { ...lane, state: "passed", detail: run.conclusion };
    return { ...lane, state: "failed", detail: String(run.conclusion ?? "no-conclusion") };
  }).sort((left, right) => `${left.path}:${left.event}`.localeCompare(`${right.path}:${right.event}`));

  const count = (state) => lanes.filter((lane) => lane.state === state).length;
  let verdict = "pending";
  if (count("failed")) verdict = "refused";
  else if (lanes.length && !count("pending")) verdict = "certified";
  return { verdict, lanes, passed: count("passed"), pending: count("pending"), failed: count("failed") };
}

// What two consecutive reads must agree on before a verdict is final.
export function fingerprint(result) {
  return JSON.stringify([
    result.verdict,
    result.lanes.map((lane) => [lane.path, lane.event, lane.state, lane.run.id, lane.run.run_attempt ?? null, lane.run.conclusion ?? null]),
  ]);
}

export function renderVerdict(result, { prNumber, headSha }) {
  const title = { certified: "CERTIFIED", refused: "REFUSED", pending: "TIMED OUT" }[result.verdict];
  const lines = [
    `Merge Certifier: ${title}`,
    `PR #${prNumber} head ${headSha.slice(0, 12)}`,
    `Lanes GitHub ran: ${result.lanes.length} (${result.passed} passed, ${result.pending} still running, ${result.failed} failed)`,
  ];
  const open = result.lanes.filter((lane) => lane.state !== "passed");
  for (const lane of open.slice(0, 30)) {
    lines.push(`- ${lane.state}/${lane.detail}: ${lane.name} (${lane.path}, ${lane.event}) run ${lane.run.id}`);
  }
  if (open.length > 30) lines.push(`- …and ${open.length - 30} more`);
  if (result.verdict === "refused") {
    lines.push("Fix or rerun the failed lane(s). When they pass, rerun this Merge Certifier job.");
  } else if (result.verdict === "pending") {
    lines.push(result.lanes.length
      ? "Lanes were still running at the deadline. Rerun this Merge Certifier job once they finish."
      : "GitHub has not started any lane for this head. Push again or rerun this job.");
  }
  return lines.join("\n");
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// A 403 is a rate limit only when GitHub says so; otherwise it is a real refusal.
function isRateLimited(response) {
  return response.status === 403 &&
    (response.headers?.get?.("x-ratelimit-remaining") === "0" || Boolean(response.headers?.get?.("retry-after")));
}

export class GitHubApi {
  constructor({ repository, token, fetchImpl = fetch }) {
    if (!token) fail("AUTH", "GITHUB_TOKEN is required");
    this.base = `https://api.github.com/repos/${repository}`;
    this.fetch = fetchImpl;
    this.headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mingla-merge-certifier",
    };
  }

  async get(suffix) {
    let response;
    try {
      response = await this.fetch(`${this.base}${suffix}`, { headers: this.headers, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      fail("TRANSIENT", `GET ${suffix} did not complete: ${error.message}`);
    }
    if (!response.ok) {
      fail(RETRYABLE_STATUSES.has(response.status) || isRateLimited(response) ? "TRANSIENT" : "GITHUB_API", `GET ${suffix} returned ${response.status}`);
    }
    try {
      return await response.json();
    } catch (error) {
      fail("TRANSIENT", `GET ${suffix} returned invalid JSON: ${error.message}`);
    }
  }

  async runsForHead(headSha, maxPages = 10) {
    const runs = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await this.get(`/actions/runs?head_sha=${headSha}&per_page=100&page=${page}`);
      if (!Array.isArray(payload?.workflow_runs)) fail("TRANSIENT", "workflow run page has no workflow_runs");
      runs.push(...payload.workflow_runs);
      if (payload.workflow_runs.length < 100) return runs;
    }
    fail("GITHUB_API", `more than ${maxPages * 100} workflow runs for one head`);
  }
}

// Polls until two consecutive reads give the same final verdict, or the
// deadline passes. `api`, `sleep`, `now` and `log` are injectable for tests.
export async function certify({
  api,
  prNumber,
  repository = DEFAULT_REPOSITORY,
  branch = DEFAULT_BRANCH,
  deadlineMs = DEFAULT_DEADLINE_MS,
  intervalMs = POLL_INTERVAL_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  log = () => {},
}) {
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) fail("USAGE", "pull request number is invalid");
  const deadline = now() + deadlineMs;
  let headSha = null;
  let previous = null;
  let last = null;

  while (true) {
    try {
      if (!headSha) ({ headSha } = validatePull(await api.get(`/pulls/${prNumber}`), { repository, branch }));
      const result = evaluate(selectLaneRuns(await api.runsForHead(headSha), { prNumber, headSha, repository }));
      last = result;
      const print = fingerprint(result);
      log(`${result.verdict}: ${result.passed} passed, ${result.pending} running, ${result.failed} failed of ${result.lanes.length} lanes`);
      if (result.verdict !== "pending" && print === previous) {
        // Final check that the pull request did not move under us.
        const after = validatePull(await api.get(`/pulls/${prNumber}`), { repository, branch });
        if (after.headSha !== headSha) fail("SUPERSEDED", "the pull request head changed; the newer push runs its own certifier");
        return { prNumber, headSha, result };
      }
      previous = print;
    } catch (error) {
      if (error?.code !== "TRANSIENT") throw error;
      log(`retrying after a transient GitHub error: ${error.message}`);
    }
    if (now() + intervalMs > deadline) {
      if (!headSha) fail("TRANSIENT", "GitHub API stayed unavailable until the deadline");
      return { prNumber, headSha, result: { ...(last ?? evaluate([])), verdict: "pending" } };
    }
    // The first confirmation read comes quickly; waiting reads use the full interval.
    await sleep(previous !== null && last?.verdict !== "pending" ? Math.min(intervalMs, 15_000) : intervalMs);
  }
}

function flagValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] !== "certify") {
    console.error("usage: merge-certifier.mjs certify --pr <number> [--repository <owner/repo>] [--branch <branch>] [--deadline-minutes <n>]");
    process.exitCode = 2;
    return;
  }
  const prNumber = Number(flagValue(argv, "--pr", process.env.PULL_REQUEST_NUMBER));
  const repository = flagValue(argv, "--repository", process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY);
  const branch = flagValue(argv, "--branch", DEFAULT_BRANCH);
  const deadlineMinutes = Number(flagValue(argv, "--deadline-minutes", String(DEFAULT_DEADLINE_MS / 60_000)));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  try {
    const api = new GitHubApi({ repository, token });
    const outcome = await certify({
      api,
      prNumber,
      repository,
      branch,
      deadlineMs: deadlineMinutes * 60_000,
      log: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
    });
    const report = renderVerdict(outcome.result, outcome);
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        const { appendFileSync } = await import("node:fs");
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${report}\n\`\`\`\n`);
      } catch {
        // The summary is a convenience; the log above is the record.
      }
    }
    if (outcome.result.verdict !== "certified") {
      console.error(`::error::${report.replace(/\n/g, "%0A")}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`::error::Merge Certifier stopped: ${error.message}`);
    process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("merge-certifier.mjs");
if (invokedDirectly) await main();
