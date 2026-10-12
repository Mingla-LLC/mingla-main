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
 *   alert    — "`main` just went red; tell a human." Runs after EVERY push to
 *              `main`, and only after a push. Sends ONE email naming the
 *              commit, the failing checks and who merged it.
 *
 * COVERAGE, and the limit of it. An earlier draft of this comment promised
 * "and on a schedule" while no schedule existed, and a comment describing a
 * trigger the workflow does not have is exactly how the next person concludes
 * coverage exists when it does not -- the same defect class as the alert
 * itself. #3078 built the missing tier, so the claim is now earned. Precisely:
 *
 *   WHAT IS COVERED. Every commit that lands on `main`. The host workflow's
 *   push trigger carries a `**` catch-all, so no `main` commit can miss it.
 *   That was NOT true when this was written: seven of forty consecutive `main`
 *   commits (17.5%) matched none of the host's globs -- root `REPORTS.md` and
 *   `COMMS.md`, which every CLOSE touched then (the COMMS.md table was retired
 *   by #3476), and the whole `mingla-site-cms` tree -- and an eighth was
 *   skipped by a baseline exclusion. On those eight,
 *   a red `main` reached nobody, which is indistinguishable from a green one.
 *   RE-MEASURED at #3078 over the forty `main` commits ending 31b8b50e1:
 *   39 of 40. The one miss is a baseline-ONLY commit, which the trailing
 *   negative excludes deliberately. The catch-all is doing its job.
 *
 *   ...AND, since #3078, every SCHEDULED run on `main`. Nine cron lanes run on
 *   this branch, the nightly full corpus among them, and not one of their
 *   failures could be seen from here before: the snapshot asked the API for
 *   `event=push` and nothing else, so a red nightly reached nobody on the night
 *   AND was still invisible on every push that followed it, forever. See
 *   ADMITTED_RUN_EVENTS below for why that set is enumerated rather than
 *   simply unfiltered.
 *
 *   WHAT IS NOT, and this is the honest half. A scheduled failure is not
 *   alerted ON the night. The alert job lives in a workflow triggered by
 *   `pull_request` and `push` only, so nothing runs it at 03:17; the nightly's
 *   red is picked up by the NEXT push to `main`, which the `**` catch-all
 *   guarantees will start it. The latency is therefore "until the next merge"
 *   rather than "never" -- a real improvement on a failure nobody could ever
 *   see, and a real remaining gap, stated as one. Closing it needs a scheduled
 *   trigger on the alert host, which is a far larger change than it looks:
 *   that host runs a dozen heavy jobs, the org is capped at 20 concurrent
 *   jobs, and a nightly copy of it would contend for that cap with the very
 *   corpus run it exists to report on.
 *
 *   WHAT IS ALSO NOT. This reads a SNAPSHOT at the moment the host finishes. A
 *   workflow SLOWER than the host has not reported yet, so its failure on this
 *   commit is invisible here and is caught only on the next push. That is a
 *   real residual gap and it is the 2026-09-01 incident's own shape -- the
 *   longest-running gate was the one that failed. Tracked, not forgotten, and
 *   deliberately NOT papered over with a comment.
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
 * Issue #2830 — OPERATIONS WORKFLOWS ARE NOT CODE HEALTH.
 *
 * The pre-merge check answers one question: is it safe to merge code onto this
 * branch? A production operation's result is not a property of any commit. From
 * 2026-10-07 the Sites backup workflow was red on `main` for four days over a
 * fault in production, so this check went red for every pull request in the
 * repository, including the one carrying the repair. And no pull request can
 * ever prove it fixes such a red, because the production job never runs on a
 * pull request: #3458's "this PR's own run of that workflow is green" route
 * cannot apply to this class at all.
 *
 * So a workflow named here is left out of the `main` verdict. That is only
 * safe under one condition, and it is enforced, not hoped for:
 *
 *   AN EXCLUDED WORKFLOW MUST PAGE BY ITSELF.
 *
 * The class-A wiring gate (issue-2909) fails unless every name below resolves
 * to exactly one workflow and that workflow runs the Sites operations notifier,
 * which emails a person directly. Exclusion without that would be the #2909
 * defect again: a failure that reaches nobody.
 *
 * Exclusion is never silent here either: every excluded red is printed, by
 * both commands, on a line starting `OPERATIONS (not blocking, paged
 * separately)`.
 *
 * DISPLAY NAMES ONLY. See the naming constraint in the header: this file may
 * never contain a workflow filename.
 */
export const OPERATIONS_WORKFLOW_NAMES = Object.freeze([
  "Mingla Sites · Backup and restore",
]);
const OPERATIONS = new Set(OPERATIONS_WORKFLOW_NAMES);

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
/**
 * The newest run per workflow that has NOT finished. A red verdict whose
 * workflow already has a newer run in flight is still red — nothing has
 * superseded it yet — but saying so out loud is what stops the reader
 * dismissing an old SHA as stale noise.
 */
export function newestPendingPerWorkflow(runs) {
  const byWorkflow = new Map();
  const ordered = [...(runs ?? [])].sort((left, right) => {
    const l = Date.parse(left?.run_started_at ?? left?.created_at ?? 0) || 0;
    const r = Date.parse(right?.run_started_at ?? right?.created_at ?? 0) || 0;
    return r - l;
  });
  for (const run of ordered) {
    if (run?.status === "completed") continue;
    const key = run?.workflow_id ?? run?.name;
    if (key == null || byWorkflow.has(key)) continue;
    byWorkflow.set(key, run);
  }
  return byWorkflow;
}

export function evaluateHealth(runs) {
  const latest = latestCompletedPerWorkflow(runs);
  const pending = newestPendingPerWorkflow(runs);
  // #2830 — the SAME collapse for both lists: newest completed run per
  // workflow, red by the same conclusions. Only which list an entry lands in
  // differs, and `healthy` reads the code-health list alone.
  const describe = (run) => ({
      workflow: run.name ?? "(unnamed workflow)",
      conclusion: run.conclusion,
      // #3078 — WHICH TRIGGER produced this verdict. Load-bearing for the
      // report below: a scheduled failure has no merger, and saying one merged
      // it would be fabricated attribution.
      event: run.event ?? "",
      sha: run.head_sha ?? "",
      shortSha: String(run.head_sha ?? "").slice(0, 9),
      title: (run.display_title ?? run.head_commit?.message ?? "").split("\n")[0],
      actor: run.actor?.login ?? run.triggering_actor?.login ?? "unknown",
      startedAt: run.run_started_at ?? run.created_at ?? "",
      url: run.html_url ?? "",
      pendingSha: String(pending.get(run.workflow_id ?? run.name)?.head_sha ?? "").slice(0, 9),
  });
  const byWorkflow = (left, right) => left.workflow.localeCompare(right.workflow);
  const failing = latest.filter((run) => RED.has(run.conclusion));
  const red = failing.filter((run) => !OPERATIONS.has(run.name)).map(describe).sort(byWorkflow);
  const operationsRed = failing.filter((run) => OPERATIONS.has(run.name)).map(describe).sort(byWorkflow);
  return {
    healthy: red.length === 0,
    evaluatedWorkflows: latest.length,
    red,
    operationsRed,
  };
}

/**
 * One line per excluded red, for both commands. Exclusion is never silent: a
 * reader of the pre-merge check or of the red-`main` email always sees that an
 * operations workflow is failing and that it is being paged elsewhere.
 */
export function renderOperationsLines(health) {
  return (health.operationsRed ?? []).map((entry) =>
    `OPERATIONS (not blocking, paged separately): ${entry.workflow} — ${entry.conclusion} ${entry.url}`);
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

/**
 * The run types admitted into the `main` verdict, ENUMERATED on purpose.
 *
 * The runs API accepts exactly ONE `event=` value per request, so admitting a
 * second run type is a real design decision with exactly two shapes: merge N
 * explicit queries, or drop the filter and take whatever the API returns.
 *
 * DROPPING IT WAS REJECTED, and not on taste. `workflow_dispatch` is the run
 * type dropping the filter would also admit, and the batch lane's suite job
 * carries `if: github.event_name != 'workflow_dispatch'` -- so a dispatched run
 * SKIPS all 85 suites and still completes GREEN, having executed nothing.
 * `latestCompletedPerWorkflow` keeps the newest completed run per workflow, so
 * that vacuous green would supersede a genuine red nightly and erase it: an
 * operator running one bounded operational suite would silently clear a real
 * failure, and the branch would read green because nothing had been measured.
 * Enumerating the admitted events keeps the set of run types that can colour
 * `main` a decision this repository made, not a default the API chose.
 *
 *   `push`     -- every commit that lands on `main`.
 *   `schedule` -- the nightly full corpus and the eight other cron lanes on
 *                this branch. Their failures were invisible here until #3078:
 *                the snapshot asked for `event=push` and nothing else, so a red
 *                nightly reached nobody on the night AND stayed unseen on every
 *                push after it. That is the #2909 defect exactly, wearing a
 *                different trigger.
 */
export const ADMITTED_RUN_EVENTS = Object.freeze(["push", "schedule"]);

/**
 * The query string for each admitted event. Exported so the fixture suite can
 * assert the SET with no network call: a filter that silently drops an event
 * produces an empty inbox, and an empty inbox is what health looks like (#2113).
 */
export function branchRunsQueries({ branch = DEFAULT_BRANCH, perPage = 100 } = {}) {
  return ADMITTED_RUN_EVENTS.map((event) =>
    [
      `branch=${encodeURIComponent(branch)}`,
      `event=${event}`,
      "exclude_pull_requests=true",
      `per_page=${perPage}`,
    ].join("&"),
  );
}

/**
 * ONE snapshot request PER ADMITTED EVENT -- two today. Still not a loop and
 * still not a watch: the request count is the length of a frozen list, not a
 * function of how much history exists, so this cannot grow into a polling loop
 * against the shared API wallet.
 *
 * WINDOW, stated rather than assumed. Each request returns at most one page.
 * The scheduled page is the narrow one: a 15-minute cron lane on this branch
 * emits ~96 runs a day by itself, so the scheduled window is on the order of a
 * day where the push window is weeks. That is comfortably wider than the gap
 * between a nightly and the next push to `main`, which is when this is read --
 * but it IS a bound, and a bound nobody wrote down is how the next person
 * assumes there is none.
 */
export function fetchBranchRuns({
  repository = DEFAULT_REPOSITORY,
  branch = DEFAULT_BRANCH,
  token,
  perPage = 100,
} = {}) {
  // NOT filtered to `status=completed`. The completed runs decide the colour;
  // the in-flight ones are what let the report say "a newer verdict is on its
  // way", which is the difference between an engineer acting on this and
  // dismissing it as stale.
  const merged = [];
  const seen = new Set();
  for (const query of branchRunsQueries({ branch, perPage })) {
    const payload = api(`repos/${repository}/actions/runs?${query}`, { token });
    for (const run of payload.workflow_runs ?? []) {
      // De-duplicated by run id. The two pages are disjoint by construction
      // today -- a run has one event -- but a merge that DOUBLE-COUNTS would
      // silently corrupt the newest-per-workflow collapse, so it is closed here
      // rather than left resting on a property of the API.
      const id = run?.id ?? `${run?.name}:${run?.run_started_at}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(run);
    }
  }
  return merged;
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
  const operations = renderOperationsLines(health);
  if (health.healthy) {
    return [
      `${branch} is GREEN — ${health.evaluatedWorkflows} completed workflow(s) evaluated on ${repository}.`,
      ...operations,
    ].join("\n");
  }
  const lines = [
    `${branch} is RED on ${repository}: ${health.red.length} failing workflow(s) of ${health.evaluatedWorkflows} evaluated.`,
    "",
  ];
  for (const entry of health.red) {
    lines.push(`  ${entry.workflow} — ${entry.conclusion}`);
    if (entry.event === "schedule") {
      // #3078 — a scheduled run has no merger. Printing "merged by <actor>"
      // here would blame whoever GitHub happens to attribute the cron to for a
      // failure that arrived with NO COMMIT AT ALL, and the reader would go
      // revert an innocent change. Catching what no diff caused is the entire
      // point of the nightly tier, so the line has to say that out loud.
      lines.push(`    scheduled run at commit ${entry.shortSha} "${entry.title}" — no commit caused this`);
    } else {
      lines.push(`    commit ${entry.shortSha} "${entry.title}" merged by ${entry.actor}`);
    }
    lines.push(`    ${entry.url}`);
    if (entry.pendingSha && entry.pendingSha !== entry.shortSha) {
      lines.push(`    (a newer run of this workflow, at ${entry.pendingSha}, has not finished yet)`);
    }
  }
  if (operations.length) lines.push("", ...operations);
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
export async function sendAlert(message, { apiKey, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.resend.com/emails", {
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

/**
 * ALERT OUTCOMES — the distinction requirement 5 turns on.
 *
 * `nothing-to-send` and `not-attempted` BOTH deliver zero emails, and from the
 * outside they are identical: an inbox with nothing in it. One means `main` is
 * GREEN. The other means nobody is watching `main` at all. Collapsing them is
 * precisely the defect this module exists to prevent -- a silent non-send that
 * reads as health -- so they are distinct outcomes with distinct exit codes,
 * and the fixture suite asserts they can never be confused.
 */
export const ALERT_OUTCOMES = Object.freeze({
  NOTHING_TO_SEND: "nothing-to-send",
  DELIVERED: "delivered",
  NOT_ATTEMPTED: "not-attempted",
  SEND_FAILED: "send-failed",
});

/**
 * Decide and perform delivery. Extracted from `main()` deliberately: while this
 * lived inside the CLI entrypoint NOTHING could reach it, so the one path whose
 * silent failure is indistinguishable from health had zero test coverage. Every
 * dependency is injectable so the fixture suite exercises it with no network,
 * no token, and no email sent to anybody.
 */
export async function deliverAlert(health, {
  repository = DEFAULT_REPOSITORY,
  branch = DEFAULT_BRANCH,
  token,
  env = process.env,
  send = sendAlert,
  escalateWith = escalate,
  logger = console,
} = {}) {
  if (health.healthy) {
    logger.log("#2909 alert: nothing to send.");
    return { outcome: ALERT_OUTCOMES.NOTHING_TO_SEND, exitCode: 0, escalated: false, sent: false, reason: "" };
  }

  const recipient = env.MINGLA_MAIN_RED_ALERT_TO || "";
  const sender = env.MINGLA_MAIN_RED_ALERT_FROM || "Mingla CI <notifications@usemingla.com>";
  const apiKey = env.RESEND_API_KEY || "";
  const issue = env.MINGLA_MAIN_RED_ALERT_ISSUE || "2909";

  // An escalation that itself fails must SAY SO. The previous form swallowed it
  // with an empty catch, which is the same silent-failure shape one layer up.
  const escalateNow = (reason) => {
    logger.error(`::error::#2909 ${reason}`);
    try {
      escalateWith(reason, { repository, token, issue });
      return true;
    } catch (error) {
      logger.error(`::error::#2909 escalation ALSO failed, nobody has been told: ${error.message}`);
      return false;
    }
  };

  const misconfigured = [];
  if (!recipient) misconfigured.push("MINGLA_MAIN_RED_ALERT_TO is empty");
  if (!apiKey) misconfigured.push("RESEND_API_KEY is empty");
  if (misconfigured.length) {
    const reason = `alert not attempted: ${misconfigured.join("; ")}`;
    return { outcome: ALERT_OUTCOMES.NOT_ATTEMPTED, exitCode: 1, escalated: escalateNow(reason), sent: false, reason };
  }

  const message = buildAlert(health, { repository, branch, recipient, sender });
  try {
    const result = await send(message, { apiKey });
    logger.log(`#2909 alert delivered: resend id ${result.id || "(none)"} status ${result.status}`);
    return { outcome: ALERT_OUTCOMES.DELIVERED, exitCode: 0, escalated: false, sent: true, reason: "" };
  } catch (error) {
    const reason = `send failed: ${error.message}`;
    return { outcome: ALERT_OUTCOMES.SEND_FAILED, exitCode: 1, escalated: escalateNow(reason), sent: false, reason };
  }
}

// ---------------------------------------------------------------------------
// self-test — pure fixtures, no network, no token
// ---------------------------------------------------------------------------

function assertOk(condition, label) {
  if (!condition) throw new Error(`self-test FAILED: ${label}`);
}

export async function runSelfTest() {
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

  // #3078 — THE ADMITTED EVENT SET. The runs API takes exactly one `event=`
  // per request, so the query SET is the design decision, and a set that
  // silently loses an event produces an empty inbox that looks like health.
  const queries = branchRunsQueries({ branch: "main", perPage: 100 });
  assertOk(queries.length === ADMITTED_RUN_EVENTS.length, "one query per admitted run event, or a run type is read twice or not at all");
  assertOk(queries.some((q) => q.includes("event=push")), "push runs must stay admitted — this is #2909's own guarantee");
  assertOk(queries.some((q) => q.includes("event=schedule")), "scheduled runs must be admitted, or a red nightly reaches nobody, ever");
  assertOk(
    !queries.some((q) => q.includes("event=workflow_dispatch")),
    "workflow_dispatch must NOT be admitted: a dispatched batch run skips every suite and still completes green, and would supersede a red nightly",
  );
  assertOk(
    queries.every((q) => q.includes("exclude_pull_requests=true") && q.includes("branch=main")),
    "every admitted query stays branch-scoped and pull-request-free",
  );
  assertions += 5;

  // #3078 — a scheduled red must colour the branch AND be reported as
  // scheduled. Attributing it to whoever GitHub names on the cron would send
  // the reader to revert an innocent commit for a failure no diff caused.
  const nightly = evaluateHealth([
    run({ workflow_id: 42, name: "Nightly corpus", conclusion: "failure", event: "schedule", actor: { login: "github-actions" } }),
  ]);
  assertOk(!nightly.healthy, "a failed scheduled run must colour the branch red");
  const nightlyReport = renderReport(nightly, { repository: "r", branch: "main" });
  assertOk(!nightlyReport.includes("merged by"), "a scheduled red must not claim anybody merged it");
  assertOk(nightlyReport.includes("scheduled run"), "a scheduled red must say on its face that a schedule produced it");
  assertions += 3;

  // ...and a pushed red KEEPS its attribution. Making both vague would satisfy
  // the assertion above while destroying the thing that makes them different.
  const pushedRed = evaluateHealth([
    run({ workflow_id: 43, conclusion: "failure", event: "push", actor: { login: "seth" } }),
  ]);
  assertOk(
    renderReport(pushedRed, { repository: "r", branch: "main" }).includes("merged by seth"),
    "a pushed red must still name who merged it",
  );
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

  // An in-flight newer run does not clear a red verdict, but it IS reported, so
  // an old SHA in the alert cannot be mistaken for stale noise.
  const withPending = evaluateHealth([
    run({ workflow_id: 5, name: "Slow", status: "queued", conclusion: null, head_sha: "dddddddddddd", run_started_at: "2026-09-01T07:00:00Z" }),
    run({ workflow_id: 5, name: "Slow", conclusion: "failure", head_sha: "eeeeeeeeeeee", run_started_at: "2026-09-01T05:00:00Z" }),
  ]);
  assertOk(!withPending.healthy, "a queued newer run must not clear a red verdict");
  assertOk(withPending.red[0].pendingSha === "ddddddddd", "the in-flight run must be reported");
  assertOk(renderReport(withPending, { repository: "r", branch: "main" }).includes("has not finished yet"), "the report must say a newer verdict is pending");
  assertOk(evaluateHealth([run({ workflow_id: 6, name: "Q", conclusion: "failure" })]).red[0].pendingSha === "", "no in-flight run must annotate nothing");
  assertions += 4;

  const green = evaluateHealth([run({ conclusion: "success" })]);
  assertOk(renderReport(green, { repository: "r", branch: "main" }).includes("GREEN"), "green report");
  assertOk(renderReport(many, { repository: "r", branch: "main" }).includes("RED"), "red report");
  assertions += 2;

  // ---- DELIVERY: the path whose silent failure looks exactly like health ----
  // Every dependency is injected. No network, no token, and no email reaches a
  // human. Until this block existed, sendAlert and escalate had ZERO coverage.
  const recorder = (result) => {
    const calls = [];
    return { calls, fn: (...args) => { calls.push(args); return result; } };
  };
  const quiet = { log() {}, error() {} };
  const CONFIGURED = { MINGLA_MAIN_RED_ALERT_TO: "someone@example.invalid", RESEND_API_KEY: "re_test_key" };
  const redHealth = evaluateHealth([run({ workflow_id: 3, name: "Slow", conclusion: "failure" })]);

  // A green branch sends nothing and escalates nothing.
  const okSend = recorder({ status: 200, id: "re_1" });
  const okEsc = recorder(undefined);
  const healthy = await deliverAlert(green, { env: CONFIGURED, send: okSend.fn, escalateWith: okEsc.fn, logger: quiet });
  assertOk(healthy.outcome === ALERT_OUTCOMES.NOTHING_TO_SEND, "a green branch must report nothing-to-send");
  assertOk(healthy.exitCode === 0 && !healthy.sent && !healthy.escalated, "a green branch must not send, escalate or fail");
  assertOk(okSend.calls.length === 0, "a green branch must not touch the transport at all");
  assertions += 3;

  // A red branch, fully configured, sends exactly one email and does not escalate.
  const send1 = recorder({ status: 200, id: "re_abc" });
  const esc1 = recorder(undefined);
  const delivered = await deliverAlert(redHealth, { env: CONFIGURED, send: send1.fn, escalateWith: esc1.fn, logger: quiet });
  assertOk(delivered.outcome === ALERT_OUTCOMES.DELIVERED && delivered.sent, "a configured red branch must deliver");
  assertOk(delivered.exitCode === 0, "a delivered alert must not fail the job");
  assertOk(send1.calls.length === 1, "ONE alert per event, never one per failing job");
  assertOk(esc1.calls.length === 0, "a successful send must not escalate");
  assertions += 4;

  // THE ASSERTION WHOSE ABSENCE CREATED THE GAP: a run that SENDS NOTHING must
  // be distinguishable from a run that had NOTHING TO SEND. Both deliver zero
  // emails; only one of them means the branch is healthy.
  const send2 = recorder({ status: 200, id: "re_2" });
  const esc2 = recorder(undefined);
  const unsent = await deliverAlert(redHealth, { env: {}, send: send2.fn, escalateWith: esc2.fn, logger: quiet });
  assertOk(unsent.outcome === ALERT_OUTCOMES.NOT_ATTEMPTED, "an unconfigured red branch must report not-attempted");
  assertOk(send2.calls.length === 0, "an unconfigured alert must not pretend to have sent");
  assertOk(esc2.calls.length === 1 && unsent.escalated, "an unsent alert must escalate to a human-visible record");
  assertOk(unsent.exitCode === 1, "an unsent alert must fail its job");
  assertOk(healthy.sent === false && unsent.sent === false, "both of these send exactly zero emails");
  assertOk(healthy.outcome !== unsent.outcome, "zero-sent-because-green must NEVER equal zero-sent-because-broken");
  assertOk(healthy.exitCode !== unsent.exitCode, "...and the two must differ in exit code, which is what CI reads");
  assertions += 7;

  // A provider rejection escalates, carries the status, and fails the job.
  const esc3 = recorder(undefined);
  const rejecting = async () => { throw new Error("resend responded 401: unauthorized"); };
  const failed = await deliverAlert(redHealth, { env: CONFIGURED, send: rejecting, escalateWith: esc3.fn, logger: quiet });
  assertOk(failed.outcome === ALERT_OUTCOMES.SEND_FAILED && !failed.sent, "a rejected send must report send-failed");
  assertOk(failed.exitCode === 1 && failed.escalated && esc3.calls.length === 1, "a rejected send must escalate and fail");
  assertOk(failed.reason.includes("401"), "the escalation must carry the provider's status, not a generic message");
  assertions += 3;

  // An escalation that ALSO fails must admit it rather than report success.
  const exploding = () => { throw new Error("gh unavailable"); };
  const doubleFault = await deliverAlert(redHealth, { env: {}, send: send2.fn, escalateWith: exploding, logger: quiet });
  assertOk(doubleFault.exitCode === 1, "a failed escalation must still fail the job");
  assertOk(doubleFault.escalated === false, "a failed escalation must NOT be reported as escalated");
  assertions += 2;

  // sendAlert itself, against a fake transport: non-2xx throws with the
  // provider's status and body; 2xx surfaces the id.
  let thrown = "";
  try {
    await sendAlert({}, { apiKey: "k", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "unauthorized" }) });
  } catch (error) { thrown = error.message; }
  assertOk(thrown.includes("401") && thrown.includes("unauthorized"), "a non-2xx must throw carrying the status and body");
  const accepted = await sendAlert({}, { apiKey: "k", fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: "re_xyz" }) }) });
  assertOk(accepted.status === 200 && accepted.id === "re_xyz", "a 2xx must surface the provider's message id");
  assertions += 2;

  // ---- #2830: operations workflows are reported, never blocking, never hidden
  const OPS = OPERATIONS_WORKFLOW_NAMES[0];
  assertOk(OPERATIONS_WORKFLOW_NAMES.length >= 1 && typeof OPS === "string" && OPS.length > 0, "at least one operations workflow is named");
  assertOk(
    OPERATIONS_WORKFLOW_NAMES.every((name) => !/\.ya?ml\b/.test(name)),
    "operations workflows are named by display name, never by filename",
  );
  const opsRun = (over) => run({ workflow_id: 900, name: OPS, event: "schedule", html_url: "https://example.invalid/ops", ...over });

  // The 2026-10-07 shape: the operations workflow red, every code check green.
  const opsOnly = evaluateHealth([
    opsRun({ conclusion: "failure" }),
    run({ workflow_id: 901, name: "Alpha", conclusion: "success" }),
  ]);
  assertOk(opsOnly.healthy, "an operations-only red must not block a merge");
  assertOk(opsOnly.red.length === 0 && opsOnly.operationsRed.length === 1, "it is counted as an operations red, not a code red");
  assertOk(opsOnly.evaluatedWorkflows === 2, "an excluded workflow is still evaluated, so the denominator stays honest");
  const opsOnlyReport = renderReport(opsOnly, { repository: "r", branch: "main" });
  assertOk(opsOnlyReport.includes("GREEN"), "the branch reads green");
  assertOk(
    opsOnlyReport.includes(`OPERATIONS (not blocking, paged separately): ${OPS} — failure https://example.invalid/ops`),
    "an excluded red must be PRINTED: exclusion is never silent",
  );
  assertions += 5;

  // An operations red can never hide a code red, nor be dropped beside one.
  const both = evaluateHealth([
    opsRun({ conclusion: "failure" }),
    run({ workflow_id: 902, name: "Bravo", conclusion: "failure" }),
  ]);
  assertOk(!both.healthy && both.red.length === 1 && both.red[0].workflow === "Bravo", "a code red beside an operations red is still red");
  const bothReport = renderReport(both, { repository: "r", branch: "main" });
  assertOk(bothReport.includes("RED") && bothReport.includes("Bravo"), "the code red is reported");
  assertOk(bothReport.includes("OPERATIONS (not blocking, paged separately)"), "and so is the operations red beside it");
  assertOk(!bothReport.includes("2 failing workflow(s)"), "the operations red is not counted as a failing code check");
  assertions += 4;

  // Every red conclusion is excluded the same way, and a green one prints nothing.
  for (const conclusion of RED_CONCLUSIONS) {
    const verdict = evaluateHealth([opsRun({ conclusion })]);
    assertOk(verdict.healthy && verdict.operationsRed.length === 1, `an operations ${conclusion} is reported and not blocking`);
    assertions += 1;
  }
  const opsGreen = evaluateHealth([opsRun({ conclusion: "success" })]);
  assertOk(opsGreen.operationsRed.length === 0 && renderOperationsLines(opsGreen).length === 0, "a green operations workflow prints nothing");
  assertions += 1;

  // Only an EXACT display name is excluded. A workflow that merely resembles
  // one stays a code check: a typo must fail towards blocking, not towards silence.
  for (const name of [`${OPS} `, OPS.toLowerCase(), `${OPS} (copy)`, "Backup and restore"]) {
    assertOk(!evaluateHealth([run({ workflow_id: 903, name, conclusion: "failure" })]).healthy, `"${name}" is not excluded`);
    assertions += 1;
  }

  // The red-main email is not sent for an operations-only red (that page
  // belongs to the Sites notifier), and IS sent, naming both, for a code red.
  const sendOps = recorder({ status: 200, id: "re_ops" });
  const escOps = recorder(undefined);
  const opsDelivery = await deliverAlert(opsOnly, { env: CONFIGURED, send: sendOps.fn, escalateWith: escOps.fn, logger: quiet });
  assertOk(opsDelivery.outcome === ALERT_OUTCOMES.NOTHING_TO_SEND && sendOps.calls.length === 0, "an operations-only red sends no red-main email");
  assertOk(opsDelivery.exitCode === 0 && escOps.calls.length === 0, "and is not an alert failure");
  const sendBoth = recorder({ status: 200, id: "re_both" });
  await deliverAlert(both, { env: CONFIGURED, send: sendBoth.fn, escalateWith: escOps.fn, logger: quiet });
  assertOk(sendBoth.calls.length === 1, "a code red beside it still sends");
  assertOk(sendBoth.calls[0][0].text.includes("OPERATIONS (not blocking, paged separately)"), "and the email mentions the operations red");
  assertOk(sendBoth.calls[0][0].subject.includes("1 check(s) failing"), "the subject counts code checks only");
  assertions += 5;

  // The asking run's own failure still supersedes, for an ordinary host.
  const selfBesideOps = evaluateHealth(withSelfRun(
    [opsRun({ conclusion: "failure" }), run({ workflow_id: 9, name: "Host", conclusion: "success" })],
    { workflow: "Host", conclusion: "failure", sha: "ffffffffffff", title: "t", actor: "merger", url: "u" },
  ));
  assertOk(!selfBesideOps.healthy && selfBesideOps.operationsRed.length === 1, "self-run supersession is unaffected by an operations red");
  assertions += 1;

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
    const assertions = await runSelfTest();
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
  const result = await deliverAlert(health, { repository, branch, token });
  process.exitCode = result.exitCode;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("main-health.mjs");
if (invokedDirectly) await main();
