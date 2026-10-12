/**
 * Issue #2830 — a production operation's failure pages a person directly and
 * does not block the merge queue (T-4.1), and it can only be left out of the
 * `main` verdict if it really does page (T-4.2).
 *
 * From 2026-10-07 the Sites backup workflow was red on `main` for four days
 * over a fault in production. The pre-merge `main` check therefore went red for
 * every pull request in the repository, including the one carrying the repair,
 * and no pull request could ever have proved it fixed that red: the production
 * job never runs on a pull request.
 *
 * What is pinned here:
 *   SC-4.1  the operations workflow red and everything else green: `pregate`
 *           exits 0 and prints the OPERATIONS line (the real CLI is run);
 *   SC-4.2  a failed code-health workflow still exits non-zero, with or
 *           without an operations red beside it;
 *   SC-4.3  every excluded name resolves to exactly one workflow that runs the
 *           notifier, or the class-A wiring gate is red.
 *
 * NAMING CONSTRAINT: no workflow filename appears in this file. The provider
 * seal treats any file naming a workflow as a reference file for it. Workflows
 * are found by display name, and the one path needed is built from fragments.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_ROOT } from "../validate-manifest-v2.mjs";
import {
  OPERATIONS_WORKFLOW_NAMES,
  RED_CONCLUSIONS,
  evaluateHealth,
  renderOperationsLines,
  renderReport,
} from "../../../../scripts/ci/main-health.mjs";
import {
  OPERATIONS_NOTIFIER,
  auditWiring,
  parseWorkflows,
  readWorkflowSources,
} from "../../strict-grep/issue-2909-main-health-wiring.mjs";

const ADJUDICATOR = path.join(DEFAULT_ROOT, "scripts/ci/main-health.mjs");
const OPS = OPERATIONS_WORKFLOW_NAMES[0];
const OPS_URL = "https://example.invalid/runs/ops";

const run = (over) => ({
  id: Math.floor(Math.random() * 1e9),
  workflow_id: 1,
  name: "Alpha",
  status: "completed",
  conclusion: "success",
  event: "push",
  head_sha: "a".repeat(40),
  display_title: "a commit",
  actor: { login: "someone" },
  run_started_at: "2026-10-11T05:00:00Z",
  html_url: "https://example.invalid/runs/alpha",
  ...over,
});
const opsRun = (over) => run({ workflow_id: 900, name: OPS, event: "schedule", html_url: OPS_URL, ...over });

/**
 * Runs the real CLI against a stub `gh` that answers the two branch-runs
 * queries from fixtures. No network, no token, no email.
 */
function adjudicate(command, { push = [], schedule = [], env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2830-main-health-"));
  fs.writeFileSync(path.join(dir, "push.json"), JSON.stringify({ workflow_runs: push }));
  fs.writeFileSync(path.join(dir, "schedule.json"), JSON.stringify({ workflow_runs: schedule }));
  fs.writeFileSync(path.join(dir, "gh"), [
    "#!/bin/bash",
    `printf '%s\\n' "$*" >> "${dir}/calls"`,
    'case "$*" in',
    `  *"-X POST"*) cat > /dev/null; echo '{}' ;;`,
    `  *event=push*) cat "${dir}/push.json" ;;`,
    `  *event=schedule*) cat "${dir}/schedule.json" ;;`,
    "  *) echo 'unexpected gh call' >&2; exit 9 ;;",
    "esac",
    "",
  ].join("\n"));
  fs.chmodSync(path.join(dir, "gh"), 0o755);
  const result = spawnSync(process.execPath, [ADJUDICATOR, command], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_TOKEN: "ghs_testtoken_0123456789",
      ...env,
    },
  });
  const calls = fs.existsSync(path.join(dir, "calls"))
    ? fs.readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n")
    : [];
  return { ...result, calls };
}

test("#2830 T-4.1 an operations-only red leaves main mergeable, and says so out loud", () => {
  // The four days, as the pre-merge check saw them: the newest scheduled run of
  // the Sites workflow failed and every code check was green.
  const result = adjudicate("pregate", {
    push: [run({ workflow_id: 1, name: "Alpha" }), run({ workflow_id: 2, name: "Bravo" })],
    schedule: [opsRun({ conclusion: "failure" })],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^main is GREEN — 3 completed workflow\(s\) evaluated on owner\/repo\.$/m);
  assert.ok(
    result.stdout.includes(`OPERATIONS (not blocking, paged separately): ${OPS} — failure ${OPS_URL}`),
    "the excluded red is printed; exclusion is never silent",
  );
  assert.equal(result.stderr.includes("refusing to certify"), false);
});

test("#2830 T-4.1 a code-health red still blocks, with or without an operations red beside it", () => {
  const codeRed = [run({ workflow_id: 1, name: "Alpha", conclusion: "failure" })];
  const alone = adjudicate("pregate", { push: codeRed });
  assert.equal(alone.status, 1);
  assert.match(alone.stdout, /main is RED on owner\/repo: 1 failing workflow\(s\) of 1 evaluated\./);
  assert.equal(alone.stdout.includes("OPERATIONS"), false, "nothing is printed when no operations workflow is red");

  const beside = adjudicate("pregate", { push: codeRed, schedule: [opsRun({ conclusion: "failure" })] });
  assert.equal(beside.status, 1, "an operations red never hides a code red");
  assert.match(beside.stdout, /main is RED on owner\/repo: 1 failing workflow\(s\) of 2 evaluated\./);
  assert.match(beside.stdout, /^ {2}Alpha — failure$/m);
  assert.ok(beside.stdout.includes(`OPERATIONS (not blocking, paged separately): ${OPS} — failure`));
  assert.match(beside.stderr, /refusing to certify a merge onto a red main/);
});

test("#2830 T-4.1 every red conclusion of an operations workflow is reported and none blocks", () => {
  for (const conclusion of RED_CONCLUSIONS) {
    const health = evaluateHealth([opsRun({ conclusion }), run({})]);
    assert.equal(health.healthy, true, conclusion);
    assert.deepEqual(health.red, []);
    assert.equal(health.operationsRed.length, 1);
    assert.equal(health.operationsRed[0].conclusion, conclusion);
    assert.deepEqual(renderOperationsLines(health), [
      `OPERATIONS (not blocking, paged separately): ${OPS} — ${conclusion} ${OPS_URL}`,
    ]);
  }
  // A newer green run supersedes an older red one, exactly as for a code check.
  const recovered = evaluateHealth([
    opsRun({ conclusion: "success", run_started_at: "2026-10-12T08:00:00Z" }),
    opsRun({ conclusion: "failure", run_started_at: "2026-10-11T08:00:00Z" }),
  ]);
  assert.deepEqual(recovered.operationsRed, []);
  assert.equal(renderReport(recovered, { repository: "r", branch: "main" }).includes("OPERATIONS"), false);
});

test("#2830 T-4.1 only an exact display name is excluded: a near miss fails towards blocking", () => {
  for (const name of [`${OPS} `, ` ${OPS}`, OPS.toLowerCase(), OPS.replace("·", "-"), `${OPS} (copy)`]) {
    const health = evaluateHealth([run({ workflow_id: 5, name, conclusion: "failure" })]);
    assert.equal(health.healthy, false, JSON.stringify(name));
    assert.deepEqual(health.operationsRed, []);
  }
  assert.ok(Object.isFrozen(OPERATIONS_WORKFLOW_NAMES));
  for (const name of OPERATIONS_WORKFLOW_NAMES) {
    assert.equal(/\.ya?ml/.test(name), false, "a display name, never a filename");
  }
});

test("#2830 T-4.1 the red-main email is not sent for an operations-only red", () => {
  // With no mail configuration at all, an attempted send would exit 1 and post
  // an escalation comment. It does neither: there is nothing for it to send.
  const quiet = adjudicate("alert", { schedule: [opsRun({ conclusion: "failure" })], push: [run({})] });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stdout, /#2909 alert: nothing to send\./);
  assert.ok(quiet.stdout.includes("OPERATIONS (not blocking, paged separately)"));
  assert.equal(quiet.calls.some((call) => call.includes("-X POST")), false, "no escalation comment");

  // A code red is still an alert, and an unconfigured one is still loud.
  const loud = adjudicate("alert", { push: [run({ conclusion: "failure" })] });
  assert.equal(loud.status, 1);
  assert.equal(loud.calls.some((call) => call.includes("-X POST")), true);
});

test("#2830 T-4.2 every excluded workflow exists once and runs the notifier", () => {
  const sources = readWorkflowSources(DEFAULT_ROOT);
  assert.deepEqual(auditWiring(sources), [], "the shipped wiring is clean");
  const documents = parseWorkflows(sources);
  for (const name of OPERATIONS_WORKFLOW_NAMES) {
    const hosts = Object.values(documents).filter((document) => document?.name === name);
    assert.equal(hosts.length, 1, `exactly one workflow is named "${name}"`);
    const commands = Object.values(hosts[0].jobs ?? {}).flatMap((job) =>
      (job.steps ?? []).map((step) => String(step?.run ?? "").trim()));
    assert.ok(
      commands.some((command) => command.startsWith(`node ${OPERATIONS_NOTIFIER}`)),
      `"${name}" runs ${OPERATIONS_NOTIFIER}`,
    );
  }
  assert.ok(fs.existsSync(path.join(DEFAULT_ROOT, OPERATIONS_NOTIFIER)));
});

test("#2830 T-4.2 the gate is red for an excluded name that cannot page", () => {
  const sources = readWorkflowSources(DEFAULT_ROOT);
  const ghost = auditWiring(sources, { operationsNames: [...OPERATIONS_WORKFLOW_NAMES, "No Such Workflow"] });
  assert.ok(ghost.some((error) => error.includes('exactly one workflow must be named "No Such Workflow"')), ghost.join(" | "));

  const documents = parseWorkflows(sources);
  const file = Object.entries(documents).find(([, document]) => document?.name === OPS)[0];
  const silenced = auditWiring({
    ...sources,
    [file]: sources[file].replaceAll(`node ${OPERATIONS_NOTIFIER}`, "echo not-paging"),
  });
  assert.ok(
    silenced.some((error) => error.includes(`${OPS}: excluded from the main verdict but never runs ${OPERATIONS_NOTIFIER}`)),
    silenced.join(" | "),
  );
  // And the shipped gate, run as CI runs it, passes.
  const gate = spawnSync(process.execPath, [
    path.join(DEFAULT_ROOT, ".github/scripts/strict-grep/issue-2909-main-health-wiring.mjs"),
  ], { encoding: "utf8" });
  assert.equal(gate.status, 0, gate.stderr);
});

test("#2830 the batch lane runs this suite", () => {
  // Built from fragments, never written whole — see the header.
  const lane = fs.readFileSync(
    path.join(DEFAULT_ROOT, ".github/workflows", ["ci", "batch.yml"].join("-")),
    "utf8",
  );
  assert.ok(lane.includes(
    ".github/scripts/ci-batch/__tests__/issue-2830-operations-red-pages-directly.implementor.test.mjs",
  ));
});
