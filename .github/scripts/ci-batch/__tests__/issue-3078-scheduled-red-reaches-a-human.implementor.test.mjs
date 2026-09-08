/**
 * Issue #3078 — a red NIGHTLY has to reach a human.
 *
 * #3078 gave the full corpus a nightly trigger. That is half a feature. A tier
 * that runs every night and tells nobody when it fails is not monitoring, it is
 * a cron job burning runner minutes, and it is worse than nothing because the
 * absence of an email reads as health -- the precise defect #2909 was opened
 * for, arriving on a different trigger.
 *
 * THE BLOCKER, and it was one line. The red-`main` adjudicator asks the runs
 * API for `event=push` and nothing else. Nine cron lanes run on this branch,
 * the nightly corpus among them, and NONE of their runs could appear in that
 * snapshot -- not on the night, and not on any push afterwards either. A red
 * nightly was invisible forever.
 *
 * WHY THE FILTER WAS WIDENED RATHER THAN DROPPED, which is the decision this
 * file exists to freeze. The runs API accepts exactly ONE `event=` value per
 * request, so admitting `schedule` means either merging explicit queries or
 * dropping the filter. Dropping it also admits `workflow_dispatch`, and the
 * batch lane's suite job carries `if: github.event_name != 'workflow_dispatch'`
 * -- a dispatched run SKIPS all 85 suites and still completes GREEN. Because
 * only the newest completed run per workflow decides that workflow's colour,
 * that vacuous green would supersede a red nightly and erase it: an operator
 * running one bounded operational suite would silently clear a real failure.
 * The test below executes that scenario rather than asserting the intention.
 *
 * NAMING CONSTRAINT, load-bearing and the reason every workflow path below is
 * assembled from fragments: the frozen #2148 provider seal derives, for every
 * workflow filename, the sorted set of tracked files containing that name as a
 * literal. One mention of a host filename in a file such as this one rewrites
 * that workflow's record and reds `external reference file inventory drifted`
 * with no escape. Lanes are named by issue or by display name, never by path.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { DEFAULT_ROOT } from "../validate-manifest-v2.mjs";
import {
  ADMITTED_RUN_EVENTS,
  branchRunsQueries,
  evaluateHealth,
  latestCompletedPerWorkflow,
  renderReport,
} from "../../../../scripts/ci/main-health.mjs";

// Assembled from fragments, never written whole — see the header.
const workflow = (fragments) =>
  fs.readFileSync(path.join(DEFAULT_ROOT, ".github/workflows", fragments.join("-")), "utf8");
const batchLane = () => workflow(["ci", "batch.yml"]);
const alertLane = () => workflow(["strict", "grep", "mingla", "business.yml"]);

const RUBY_YAML = String.raw`
require "yaml"; require "json"
STDOUT.write(JSON.generate(YAML.safe_load(STDIN.read, aliases: true) || {}))`;

const parse = (source) =>
  JSON.parse(execFileSync("ruby", ["-e", RUBY_YAML], { input: source, encoding: "utf8" }));

const triggersOf = (document) => {
  const raw = Object.prototype.hasOwnProperty.call(document, "on") ? document.on : document["true"];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
};

const runFixture = (over) => ({
  id: Math.floor(Math.random() * 1e9),
  workflow_id: 900,
  name: "CI batch",
  status: "completed",
  conclusion: "success",
  event: "push",
  head_sha: "cafebabe0000",
  display_title: "a commit",
  actor: { login: "someone" },
  run_started_at: "2026-09-03T05:00:00Z",
  html_url: "https://example.invalid/1",
  ...over,
});

/**
 * [#3078] The snapshot must ASK for scheduled runs.
 *
 * This is the whole fix. Remove `schedule` from the admitted set and a red
 * nightly becomes invisible again, with every other gate in this repository
 * still green — which is why it is asserted here and not left to a comment.
 */
test("#3078 the main-health snapshot admits scheduled runs", () => {
  const queries = branchRunsQueries({ branch: "main", perPage: 100 });

  assert.ok(
    ADMITTED_RUN_EVENTS.includes("schedule"),
    "`schedule` must be an admitted run event — without it a red nightly reaches nobody, on the night or ever after",
  );
  assert.ok(
    queries.some((query) => query.includes("event=schedule")),
    "some issued query must actually carry event=schedule; an admitted event that is never requested is not admitted",
  );
  assert.ok(
    ADMITTED_RUN_EVENTS.includes("push") && queries.some((query) => query.includes("event=push")),
    "#2909's push-side guarantee must survive #3078 untouched",
  );
  assert.equal(
    queries.length,
    ADMITTED_RUN_EVENTS.length,
    "exactly one request per admitted event — the API takes a single event= per call",
  );
  for (const query of queries) {
    assert.match(query, /(^|&)branch=main(&|$)/, `every query must stay branch-scoped, got: ${query}`);
    assert.match(query, /(^|&)exclude_pull_requests=true(&|$)/, `pull-request runs must stay excluded, got: ${query}`);
  }
});

/**
 * [#3078] ...and must NOT admit `workflow_dispatch`, executed rather than
 * asserted as intent.
 *
 * The premise is read off the batch lane itself, so if that job ever stops
 * skipping on dispatch this test stops claiming something false.
 */
test("#3078 a dispatched run cannot supersede a red nightly", () => {
  const batchJob = parse(batchLane()).jobs?.batch;
  assert.ok(batchJob, "the batch lane must declare its suite job");
  assert.equal(
    String(batchJob.if ?? "").trim(),
    "github.event_name != 'workflow_dispatch'",
    "the premise of this test: a dispatched run skips the suite job entirely and so proves nothing",
  );

  assert.equal(
    ADMITTED_RUN_EVENTS.includes("workflow_dispatch"),
    false,
    "workflow_dispatch must never be admitted — its runs skip every suite and still complete green",
  );

  // EXECUTED: a green dispatch landing after a red nightly, same workflow.
  const withDispatch = [
    runFixture({ conclusion: "success", event: "workflow_dispatch", run_started_at: "2026-09-03T09:00:00Z" }),
    runFixture({ conclusion: "failure", event: "schedule", run_started_at: "2026-09-03T03:17:00Z" }),
  ];
  assert.equal(
    latestCompletedPerWorkflow(withDispatch)[0].conclusion,
    "success",
    "sanity: were a dispatched run admitted, it WOULD win the newest-per-workflow collapse and hide the nightly",
  );

  // Which is why it never enters the snapshot: the admitted queries cannot
  // return it, so the nightly's red survives to be reported.
  const admitted = withDispatch.filter((run) => ADMITTED_RUN_EVENTS.includes(run.event));
  const health = evaluateHealth(admitted);
  assert.equal(health.healthy, false, "the red nightly must survive a later green dispatch and still colour main red");
});

/**
 * [#3078] A scheduled red must be reported, and reported AS scheduled.
 *
 * Nothing merged a nightly failure. Printing "merged by <actor>" would send the
 * reader to revert an innocent commit for a failure no diff caused — fabricated
 * attribution (Constitution #9), and actively harmful advice.
 */
test("#3078 a scheduled red is reported without inventing a merger", () => {
  const health = evaluateHealth([
    runFixture({ name: "CI batch", conclusion: "failure", event: "schedule", actor: { login: "github-actions" } }),
  ]);
  assert.equal(health.healthy, false, "a failed scheduled run must colour main red");

  const report = renderReport(health, { repository: "Mingla-LLC/mingla-main", branch: "main" });
  assert.match(report, /scheduled run/, "the report must say a schedule produced this verdict");
  assert.doesNotMatch(report, /merged by/, "nothing merged a nightly failure; claiming otherwise blames an innocent commit");
  assert.match(report, /CI batch/, "the report must still name the failing workflow");

  // The distinction must survive in the other direction too: making BOTH lines
  // vague would satisfy the assertion above and destroy the information.
  const pushed = renderReport(
    evaluateHealth([runFixture({ conclusion: "failure", event: "push", actor: { login: "seth" } })]),
    { repository: "Mingla-LLC/mingla-main", branch: "main" },
  );
  assert.match(pushed, /merged by seth/, "a pushed red must still name who merged it");
  assert.doesNotMatch(pushed, /scheduled run/, "a pushed red must not be labelled as scheduled");
});

/**
 * [#3078] The DELIVERY CHAIN, which is what makes the widened query reach a
 * person rather than sit in a log.
 *
 * The alert job runs on push to `main`. The nightly's red is therefore read by
 * the next push — and only because the alert host's push filter carries a `**`
 * catch-all is that next push GUARANTEED to start it. Remove the catch-all and
 * the nightly's red waits for a push that happens to match a glob, which is a
 * sampling scheme wearing a monitor's clothes.
 */
test("#3078 the next push to main is guaranteed to read the nightly's verdict", () => {
  const alert = parse(alertLane());
  const pushPaths = triggersOf(alert).push?.paths;

  assert.ok(Array.isArray(pushPaths) && pushPaths.length > 0, "the alert host must declare push paths");
  assert.ok(
    pushPaths.includes("**"),
    "the alert host's push filter must keep its `**` catch-all, or the push that would report the nightly can silently skip",
  );

  const alertJob = alert.jobs?.["main-red-alert"];
  assert.ok(alertJob, "the red-main alert job must exist, or nothing delivers any verdict at all");
  assert.match(
    String(alertJob.if ?? ""),
    /github\.event_name == 'push'/,
    "#3078 must not weaken #2909's push-side gate — the alert still runs on push to main",
  );
  assert.match(String(alertJob.if ?? ""), /refs\/heads\/main/, "the alert stays scoped to main");

  const sending = (alertJob.steps ?? []).at(-1);
  assert.match(
    String(sending?.run ?? ""),
    /main-health\.mjs alert/,
    "the alert job's final step must still invoke the adjudicator that now reads scheduled runs",
  );
});
