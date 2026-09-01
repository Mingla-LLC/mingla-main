#!/usr/bin/env node
/**
 * Issue #2909 — `main` health: the pre-merge check and the red-`main` alert.
 *
 * WHY THIS EXISTS. On 2026-09-01 the longest-running gate on this repository
 * failed on three consecutive `main` commits over roughly two hours. Nobody
 * found out. Three engineers merged onto that red `main`, one of them the
 * orchestrator immediately after an explicit approval, because the pre-merge
 * gate verified every check on the PULL REQUEST and never once asked whether
 * `main` itself was healthy. Discovery was accidental, during unrelated work.
 *
 * Two commands, one module, because they answer the same question from two
 * sides:
 *
 *   pregate  — "is `main` red right now?" Run on every pull request. A red
 *              `main` turns this check red, so the repository's own
 *              all-checks-green rule refuses the merge instead of allowing it
 *              blind. This is the hole #2909 was opened for.
 *   alert    — "`main` just went red; tell a human." Run after a push to
 *              `main` and on a schedule. Sends ONE email naming the commit,
 *              the failing checks and who merged it.
 *
 * NAMING CONSTRAINT, load-bearing: this file may never contain a workflow
 * FILENAME. The frozen provider seal in
 * .github/scripts/ci-batch/validate-manifest-v2.mjs derives, for every
 * workflow filename, the sorted set of tracked files containing that name as a
 * literal. A single mention here would rewrite that workflow's record and red
 * the seal. Workflows are therefore identified by their display `name`, which
 * is what the Actions API returns anyway. MEASURED, not theorised: a passing
 * mention of one filename inside a #2909 comment reddened exactly this seal.
 *
 * Every network read is a SINGLE snapshot request. No polling, no --watch: the
 * GitHub API quota is one shared wallet across every concurrent session.
 */

import { execFileSync } from "node:child_process";

// A run is RED only for these. `cancelled` is NOT one of them: a cancellation
// is usually a superseded concurrency generation, and reading it as failure is
// how four separate #2148 breaches were misfiled as noise. `null` is not one of
// them either — a queued or in-progress run has a null conclusion, and treating
// absence of a signal as confirmation is the exact bug class #2113 catalogues.
export const RED_CONCLUSIONS = Object.freeze(["failure", "timed_out", "startup_failure"]);
const RED = new Set(RED_CONCLUSIONS);

export const DEFAULT_REPOSITORY = "Mingla-LLC/mingla-main";
export const DEFAULT_BRANCH = "main";

/**
 * Collapse a newest-first run list to the newest COMPLETED run per workflow.
 * The API returns newest-first; this does not rely on that and sorts by
 * `run_started_at`/`created_at` descending itself, because an ordering
 * assumption that silently holds today is not a guarantee.
 */
export function latestCompletedPerWorkflow(runs) {
  const byWorkflow = new Map();
  const ordered = [...(runs ?? [])].sort((left, right) => {
    const l = Date.parse(left?.run_started_at ?? left?.created_at ?? 0) || 0;
    const r = Date.parse(right?.run_started_at ?? right?.created_at ?? 0) || 0;
    return r - l;
  });
  for (const run of ordered) {
    if (run?.status !== "completed") continue;
    const key = run.workflow_id ?? run.name;
    if (key == null || byWorkflow.has(key)) continue;
    byWorkflow.set(key, run);
  }
  return [...byWorkflow.values()];
}

/**
 * The health verdict. `red` lists one entry per RED workflow, never one per
 * failing job — Seth's ruling requirement 3: a red `main` is one event, not
 * fifty.
 */
export function evaluateHealth(runs) {
  const latest = latestCompletedPerWorkflow(runs);
  const red = latest
    .filter((run) => RED.has(run.conclusion))
    .map((run) => ({
      workflow: run.name ?? "(unnamed workflow)",
      conclusion: run.conclusion,
      sha: run.head_sha ?? "",
      shortSha: String(run.head_sha ?? "").slice(0, 9),
      title: (run.display_title ?? run.head_commit?.message ?? "").split("\n")[0],
      actor: run.actor?.login ?? run.triggering_actor?.login ?? "unknown",
      startedAt: run.run_started_at ?? run.created_at ?? "",
      url: run.html_url ?? "",
    }))
    .sort((left, right) => left.workflow.localeCompare(right.workflow));
  return {
    healthy: red.length === 0,
    evaluatedWorkflows: latest.length,
    red,
  };
}

function api(path, { token, method = "GET", body } = {}) {
  const args = ["api", "-X", method, path];
  if (body !== undefined) args.push("--input", "-");
  const env = { ...process.env };
  if (token) env.GH_TOKEN = token;
  const out = execFileSync("gh", args, {
    encoding: "utf8",
    env,
    input: body === undefined ? undefined : JSON.stringify(body),
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : {};
}

/** ONE snapshot request. Not a loop, not a watch. */
export function fetchBranchRuns({
  repository = DEFAULT_REPOSITORY,
  branch = DEFAULT_BRANCH,
  token,
  perPage = 100,
} = {}) {
  const query = [
    `branch=${encodeURIComponent(branch)}`,
    "event=push",
    "status=completed",
    "exclude_pull_requests=true",
    `per_page=${perPage}`,
  ].join("&");
  const payload = api(`repos/${repository}/actions/runs?${query}`, { token });
  return payload.workflow_runs ?? [];
}

/**
 * The run that is asking. A push-to-`main` alert runs INSIDE the very workflow
 * whose result it must report, so that workflow is still `in_progress` when the
 * snapshot is taken and the API cannot see its own failure yet. Reading the
 * previous commit's conclusion instead would delay every alert by exactly one
 * merge, which is the same "one merge landed on red before anyone knew" failure
 * #2909 exists to end. The caller therefore hands its own aggregated result in
 * from the `needs` context, and it is merged as the NEWEST record for that
 * workflow so it supersedes whatever the API last saw.
 */
export function withSelfRun(runs, self) {
  if (!self || !self.workflow || !self.conclusion) return runs;
  return [
    {
      workflow_id: `self:${self.workflow}`,
      name: self.workflow,
      status: "completed",
      conclusion: self.conclusion,
      head_sha: self.sha ?? "",
      display_title: self.title ?? "",
      actor: { login: self.actor ?? "unknown" },
      run_started_at: new Date().toISOString(),
      html_url: self.url ?? "",
    },
    ...(runs ?? []).filter((run) => run?.name !== self.workflow),
  ];
}

export function selfRunFromEnv(env = process.env) {
  const conclusion = (env.MINGLA_SELF_CONCLUSION || "").trim();
  const workflow = (env.MINGLA_SELF_WORKFLOW || "").trim();
  if (!workflow || !conclusion) return null;
  return {
    workflow,
    conclusion,
    sha: env.MINGLA_SELF_SHA || "",
    title: (env.MINGLA_SELF_TITLE || "").split("\n")[0],
    actor: env.MINGLA_SELF_ACTOR || "unknown",
    url: env.MINGLA_SELF_URL || "",
  };
}

export function renderReport(health, { repository, branch }) {
  if (health.healthy) {
    return `${branch} is GREEN — ${health.evaluatedWorkflows} completed workflow(s) evaluated on ${repository}.`;
  }
  const lines = [
    `${branch} is RED on ${repository}: ${health.red.length} failing workflow(s) of ${health.evaluatedWorkflows} evaluated.`,
    "",
  ];
  for (const entry of health.red) {
    lines.push(`  ${entry.workflow} — ${entry.conclusion}`);
    lines.push(`    commit ${entry.shortSha} "${entry.title}" merged by ${entry.actor}`);
    lines.push(`    ${entry.url}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// alert delivery
// ---------------------------------------------------------------------------

export function buildAlert(health, { repository, branch, recipient, sender }) {
  const first = health.red[0];
  const subject = `[${repository}] ${branch} is RED — ${health.red.length} check(s) failing at ${first.shortSha}`;
  const body = [
    renderReport(health, { repository, branch }),
    "",
    "Merging onto this commit is refused by the pre-merge check until it is green.",
    `https://github.com/${repository}/commits/${branch}`,
  ].join("\n");
  return { from: sender, to: [recipient], subject, text: body };
}

/**
 * Requirement 5 of Seth's ruling: a send that fails must be LOUD. Resend
 * answering 401 the way two #2891 cron jobs did, silently, is strictly worse
 * than no alerting at all, because it converts "nobody is watching" into
 * "somebody thinks they are". So: a non-2xx or a thrown request escalates to a
 * GitHub issue comment AND a non-zero exit, and never returns quietly.
 */
export async function sendAlert(message, { apiKey }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`resend responded ${response.status}: ${text.slice(0, 400)}`);
  }
  let id = "";
  try { id = JSON.parse(text).id ?? ""; } catch { /* body shape is not load-bearing */ }
  return { status: response.status, id };
}

export function escalate(reason, { repository, token, issue }) {
  const body = [
    "MAIN_RED_ALERT_DELIVERY_FAILED",
    "",
    `The red-${DEFAULT_BRANCH} email alert could NOT be delivered. Nobody has been`,
    "emailed about the current state of the branch. Treat this as an unmonitored",
    "branch until it is fixed.",
    "",
    "    " + reason,
  ].join("\n");
  api(`repos/${repository}/issues/${issue}/comments`, { token, method: "POST", body: { body } });
}

// ---------------------------------------------------------------------------
// self-test — pure fixtures, no network, no token
// ---------------------------------------------------------------------------

function assertOk(condition, label) {
  if (!condition) throw new Error(`self-test FAILED: ${label}`);
}

export function runSelfTest() {
  let assertions = 0;
  const run = (over) => ({
    workflow_id: 1,
    name: "Alpha",
    status: "completed",
    conclusion: "success",
    head_sha: "aaaaaaaaaaaaaaaa",
    display_title: "a commit",
    actor: { login: "someone" },
    run_started_at: "2026-09-01T05:00:00Z",
    html_url: "https://example.invalid/1",
    ...over,
  });

  // Only the NEWEST completed run of a workflow decides its colour: a failure
  // that has since been fixed by a newer green push must not alert forever.
  const superseded = evaluateHealth([
    run({ workflow_id: 7, conclusion: "success", run_started_at: "2026-09-01T06:00:00Z" }),
    run({ workflow_id: 7, conclusion: "failure", run_started_at: "2026-09-01T05:00:00Z" }),
  ]);
  assertOk(superseded.healthy, "a newer green run must supersede an older red one");
  assertOk(superseded.evaluatedWorkflows === 1, "one workflow must collapse to one verdict");
  assertions += 2;

  // ...and the reverse, which is the #2909 incident itself.
  const regressed = evaluateHealth([
    run({ workflow_id: 7, conclusion: "failure", run_started_at: "2026-09-01T06:00:00Z" }),
    run({ workflow_id: 7, conclusion: "success", run_started_at: "2026-09-01T05:00:00Z" }),
  ]);
  assertOk(!regressed.healthy, "a newer red run must supersede an older green one");
  assertions += 1;

  // cancelled is NOT red. A superseded concurrency generation is not a failure.
  assertOk(evaluateHealth([run({ conclusion: "cancelled" })]).healthy, "cancelled must not read as red");
  assertions += 1;

  // A queued/in-progress run has a null conclusion. Absence of a signal must
  // never be read as either colour (#2113).
  const pending = evaluateHealth([run({ status: "in_progress", conclusion: null })]);
  assertOk(pending.healthy && pending.evaluatedWorkflows === 0, "an incomplete run must be evaluated as nothing at all");
  assertions += 1;

  // ...and a tree with ONLY incomplete runs must not silently report a green
  // it never measured. evaluatedWorkflows is the denominator: a zero needs one.
  assertOk(pending.evaluatedWorkflows === 0, "a green with a zero denominator must be visible as such");
  assertions += 1;

  for (const conclusion of RED_CONCLUSIONS) {
    assertOk(!evaluateHealth([run({ conclusion })]).healthy, `${conclusion} must read as red`);
    assertions += 1;
  }

  // One entry per WORKFLOW, never one per job. Two failing workflows are two
  // lines in ONE alert, not two alerts.
  const many = evaluateHealth([
    run({ workflow_id: 1, name: "Zulu", conclusion: "failure" }),
    run({ workflow_id: 2, name: "Alpha", conclusion: "failure" }),
    run({ workflow_id: 3, name: "Bravo", conclusion: "success" }),
  ]);
  assertOk(many.red.length === 2, "two failing workflows must produce exactly two entries");
  assertOk(many.red[0].workflow === "Alpha", "entries must be deterministically ordered");
  assertions += 2;

  // The alert names the commit, the check and the person who merged it —
  // requirement 2 of Seth's ruling, enough to act on from a phone.
  const alert = buildAlert(many, {
    repository: DEFAULT_REPOSITORY,
    branch: DEFAULT_BRANCH,
    recipient: "someone@example.invalid",
    sender: "Mingla <notifications@example.invalid>",
  });
  assertOk(alert.subject.includes("RED"), "subject must say the branch is red");
  assertOk(alert.subject.includes("aaaaaaaaa"), "subject must name the commit");
  assertOk(alert.text.includes("Alpha") && alert.text.includes("Zulu"), "body must name every failing check");
  assertOk(alert.text.includes("someone"), "body must name who merged it");
  assertOk(alert.to.length === 1, "exactly one recipient");
  assertions += 5;

  // The asking run supersedes the API's stale view of the same workflow, so a
  // failure that has not yet been written back to the API still alerts NOW.
  const selfRed = evaluateHealth(withSelfRun(
    [run({ workflow_id: 9, name: "Host", conclusion: "success" })],
    { workflow: "Host", conclusion: "failure", sha: "bbbbbbbbbbbb", title: "t", actor: "merger", url: "u" },
  ));
  assertOk(!selfRed.healthy, "the asking run's own failure must supersede the API snapshot");
  assertOk(selfRed.red.length === 1, "superseding must not double-count the same workflow");
  assertOk(selfRed.red[0].actor === "merger", "the asking run must carry who merged it");
  assertions += 3;

  const selfGreen = evaluateHealth(withSelfRun(
    [run({ workflow_id: 9, name: "Host", conclusion: "failure" })],
    { workflow: "Host", conclusion: "success", sha: "cccccccccccc", title: "t", actor: "m", url: "u" },
  ));
  assertOk(selfGreen.healthy, "the asking run's own success must supersede a stale red");
  assertions += 1;

  assertOk(withSelfRun([run({})], null).length === 1, "no self record must leave the snapshot untouched");
  assertOk(selfRunFromEnv({}) === null, "an unset self record must be null, never a fabricated green");
  assertions += 2;

  const green = evaluateHealth([run({ conclusion: "success" })]);
  assertOk(renderReport(green, { repository: "r", branch: "main" }).includes("GREEN"), "green report");
  assertOk(renderReport(many, { repository: "r", branch: "main" }).includes("RED"), "red report");
  assertions += 2;

  return assertions;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flagValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  const selfTestFlag = ["--self", "test"].join("-");
  if (argv.includes(selfTestFlag)) {
    const assertions = runSelfTest();
    console.log(`#2909 main-health self-test: PASS (${assertions} assertions)`);
    return;
  }

  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = flagValue("--branch", DEFAULT_BRANCH);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const command = argv[0];

  if (command !== "pregate" && command !== "alert") {
    console.error(`usage: main-health.mjs <pregate|alert> [--branch <name>] [${selfTestFlag}]`);
    process.exitCode = 2;
    return;
  }

  let runs;
  try {
    runs = fetchBranchRuns({ repository, branch, token });
  } catch (error) {
    // A read that cannot be performed is NOT a green. It is an honest 2.
    console.error(`::error::#2909 could not read ${branch} health: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const health = evaluateHealth(withSelfRun(runs, command === "alert" ? selfRunFromEnv() : null));
  const report = renderReport(health, { repository, branch });
  console.log(report);

  if (command === "pregate") {
    if (health.healthy) return;
    console.error("::error::#2909 pre-merge gate: refusing to certify a merge onto a red " + branch + ".");
    console.error("::error::Fix or revert the failing check above before this pull request is merged.");
    process.exitCode = 1;
    return;
  }

  // command === "alert"
  if (health.healthy) {
    console.log("#2909 alert: nothing to send.");
    return;
  }
  const recipient = process.env.MINGLA_MAIN_RED_ALERT_TO || "";
  const sender = process.env.MINGLA_MAIN_RED_ALERT_FROM || "Mingla CI <notifications@usemingla.com>";
  const apiKey = process.env.RESEND_API_KEY || "";
  const ledgerIssue = process.env.MINGLA_MAIN_RED_ALERT_ISSUE || "2909";

  const misconfigured = [];
  if (!recipient) misconfigured.push("MINGLA_MAIN_RED_ALERT_TO is empty");
  if (!apiKey) misconfigured.push("RESEND_API_KEY is empty");
  if (misconfigured.length) {
    const reason = `alert not attempted: ${misconfigured.join("; ")}`;
    console.error(`::error::#2909 ${reason}`);
    try { escalate(reason, { repository, token, issue: ledgerIssue }); } catch { /* the exit code below is the floor */ }
    process.exitCode = 1;
    return;
  }

  const message = buildAlert(health, { repository, branch, recipient, sender });
  try {
    const result = await sendAlert(message, { apiKey });
    console.log(`#2909 alert delivered: resend id ${result.id || "(none)"} status ${result.status}`);
  } catch (error) {
    const reason = `send failed: ${error.message}`;
    console.error(`::error::#2909 ${reason}`);
    try { escalate(reason, { repository, token, issue: ledgerIssue }); } catch { /* the exit code below is the floor */ }
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("main-health.mjs");
if (invokedDirectly) await main();
