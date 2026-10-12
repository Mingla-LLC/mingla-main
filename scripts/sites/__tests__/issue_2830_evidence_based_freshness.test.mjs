/**
 * Issue #2830 slice 2 — the watchdog judges the backup by its evidence
 * (T-3.1, T-3.2, T-3.3).
 *
 * From 2026-10-07 a clean-up step failed at the end of the backup job on every
 * run. The job was red, the hourly watchdog reported
 * `NO_SUCCESSFUL_BACKUP_IN_SCANNED_WINDOW`, and it kept saying so for four days
 * while Core held fresh, verified evidence from every one of those runs. In the
 * same four days the pilot was off the air, and the watchdog never looked.
 *
 * What is pinned here:
 *   SC-3.1  a fresh ledger with no green backup job in the window is OK;
 *   SC-3.2  with no ledger the verdict is the job-conclusion verdict, marked;
 *   SC-3.3  an unreadable or future-dated ledger is UNPROVEN and pages; a
 *           ledger from any author but the workflow can never read as fresh;
 *   SC-3.4  fresh evidence behind a site that is not serving is its own
 *           alerting verdict, emailed once per UTC day;
 *   SC-3.5  the ledger is published on the evidence output, not on the backup
 *           job's result.
 *
 * No network: GitHub, the mail provider and the public site are one injected
 * `fetch`.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { recordBackupEvidence } from "../backup-sites-cms.mjs";
import {
  BACKUP_JOB_NAME,
  HOST_PROBE_GAP_MS,
  LEDGER_AUTHOR,
  LEDGER_MARKER,
  PILOT_PUBLIC_URL,
  RECOVERY_BUDGET_HOURS,
  VERDICT_EXPIRED,
  VERDICT_HOST_DOWN,
  VERDICT_LATE,
  VERDICT_NO_SUCCESS,
  VERDICT_OK,
  VERDICT_UNPROVEN,
  checkRecoveryFreshness,
  evaluateLedgerFreshness,
  formatLedger,
  formatVerdictLine,
  isAlertingVerdict,
  pageForVerdict,
  parseLedger,
  probePublicHost,
  runRecoveryFreshnessWatchdog,
  runWatchdogAndPage,
  selectLedger,
} from "../check-recovery-freshness.mjs";
import { appendEvidenceOutputs, stableJson } from "../lib/sites-ops.mjs";
import { ledgerFieldsFromEnv, publishRecoveryEvidence } from "../publish-recovery-evidence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const WORKFLOW = readFileSync(
  join(REPO, ".github/workflows/sites-backup-restore.yml"),
  "utf8",
);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// 2026-10-11, the fourth day: the 07:23Z backup has just refreshed the evidence.
const NOW = new Date("2026-10-11T13:37:00Z");
const iso = (ms) => new Date(ms).toISOString();
const ago = (hours) => iso(NOW.getTime() - hours * HOUR);
const SHA = "cb31af74b6c221eee63518f52cf954369906d30d";

function ledgerFields(over = {}) {
  return {
    evidence_object_manifest_at: ago(3.2),
    evidence_entitlement_at: ago(3),
    evidence_database_backup_at: ago(9),
    evidence_accepted_at: ago(3),
    evidence_restore_drill_at: ago(3.05),
    run_id: "18400000001",
    head_sha: SHA,
    ...over,
  };
}

function ledgerComment(over = {}, { login = LEDGER_AUTHOR, id = 7001, updatedAt = ago(3), body } = {}) {
  return {
    id,
    body: body ?? formatLedger(ledgerFields(over)),
    updated_at: updatedAt,
    user: { login },
  };
}

/** Eleven backup runs whose backup job failed, between hourly watchdog runs. */
function fourDaysOfRedBackups() {
  const runs = [];
  const jobs = {};
  for (let index = 0; index < 20; index += 1) {
    const id = 5000 + index;
    runs.push({ id, head_branch: "main" });
    jobs[id] = index % 2 === 0 && index < 22
      ? [{ name: BACKUP_JOB_NAME, conclusion: "failure", completed_at: ago(index + 3) }]
      : [{ name: "Recovery freshness watchdog", conclusion: "failure", completed_at: ago(index + 3) }];
  }
  return { runs, jobs };
}

const ENV = Object.freeze({
  GITHUB_REPOSITORY: "owner/repo",
  GH_TOKEN: "ghs_testtoken_0123456789",
  GITHUB_RUN_ID: "42",
  GITHUB_SHA: SHA,
  GITHUB_SERVER_URL: "https://github.example",
  RESEND_API_KEY: "re_test_0123456789abcdef",
  MINGLA_SITES_OPS_ALERT_TO: "ops@example.invalid",
});

/** GitHub, the mail provider and the public site behind one fetch. */
function world({
  comments = [],
  runs = [],
  jobs = {},
  host = [200],
  failUrl = null,
} = {}) {
  const state = { comments: [...comments], posts: [], patches: [], emails: [], hostCalls: [], hostInit: null };
  const answers = [...host];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (failUrl && target.includes(failUrl)) throw new Error("network down");
    if (target === PILOT_PUBLIC_URL) {
      state.hostCalls.push(target);
      state.hostInit = init;
      const next = answers.length > 1 ? answers.shift() : answers[0];
      if (next === "throw") throw new Error("connect failed");
      return { ok: next === 200, status: next };
    }
    if (target === "https://api.resend.com/emails") {
      state.emails.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => '{"id":"re_1"}' };
    }
    const patch = /\/issues\/comments\/(\d+)$/.exec(target);
    if (patch && init.method === "PATCH") {
      const body = JSON.parse(init.body).body;
      state.patches.push({ id: Number(patch[1]), body });
      const existing = state.comments.find((comment) => comment.id === Number(patch[1]));
      if (existing) Object.assign(existing, { body, updated_at: iso(NOW.getTime()) });
      return { ok: true, status: 200, json: async () => ({ id: Number(patch[1]) }) };
    }
    if (target.includes("/issues/2830/comments")) {
      if (init.method === "POST") {
        const body = JSON.parse(init.body).body;
        state.posts.push(body);
        state.comments.push({
          id: 9000 + state.comments.length,
          body,
          updated_at: iso(NOW.getTime()),
          user: { login: LEDGER_AUTHOR },
        });
        return { ok: true, status: 201, json: async () => ({ id: 1 }) };
      }
      return { ok: true, status: 200, json: async () => state.comments };
    }
    const jobsMatch = /\/actions\/runs\/(\d+)\/jobs/.exec(target);
    if (jobsMatch) return { ok: true, json: async () => ({ jobs: jobs[Number(jobsMatch[1])] ?? [] }) };
    if (target.includes("/actions/workflows/")) {
      return { ok: true, json: async () => ({ workflow_runs: runs }) };
    }
    throw new Error(`unexpected url ${target}`);
  };
  return { state, fetchImpl };
}

function sink() {
  const lines = [];
  return { lines, write: (value) => lines.push(...value.trimEnd().split("\n")), text: () => lines.join("\n") };
}

const noDelay = async () => {};
const instantProbe = ({ fetchImpl }) => probePublicHost({ fetchImpl, delay: noDelay });

// ---------------------------------------------------------------------------
// T-3.1 — the ledger decides
// ---------------------------------------------------------------------------

test("#2830 T-3.1 replay of 2026-10-11: fresh evidence, no green backup job, verdict OK", async () => {
  const { state, fetchImpl } = world({ comments: [ledgerComment()], ...fourDaysOfRedBackups() });
  const stdout = sink();
  const result = await runWatchdogAndPage({ env: ENV, fetchImpl, now: NOW, stdout, probe: instantProbe });
  assert.equal(result.verdict.code, VERDICT_OK);
  assert.equal(result.exitCode, 0, "the run is green");
  assert.equal(result.verdict.source, "ledger");
  assert.equal(result.verdict.secondary_job_success_at, null);
  // evidence_at is the EARLIER of the manifest and entitlement instants.
  assert.equal(result.verdict.last_success_at, ago(3.2));
  assert.equal(result.verdict.headroom_hours, RECOVERY_BUDGET_HOURS - 3.2);
  assert.match(
    stdout.lines[0],
    /^SITES_RECOVERY_FRESHNESS code=SITES_RECOVERY_FRESHNESS_OK .* reason=WITHIN_BUDGET source=ledger secondary_job_success_at=none public_host_status=200$/,
  );
  assert.equal(state.posts.length, 0, "nobody is paged");
  assert.equal(state.emails.length, 0);
});

test("#2830 T-3.1 the same history without the ledger is the four-day false alarm", async () => {
  // What actually happened: this is the verdict the watchdog gave for four days.
  const { fetchImpl } = world(fourDaysOfRedBackups());
  const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl, now: NOW });
  assert.equal(verdict.code, VERDICT_NO_SUCCESS);
  assert.equal(verdict.source, "job_conclusion");
});

test("#2830 T-3.1 with no ledger the verdict is exactly the job-conclusion verdict", async () => {
  const runs = [{ id: 1, head_branch: "main" }];
  const jobs = { 1: [{ name: BACKUP_JOB_NAME, conclusion: "success", completed_at: ago(5) }] };
  const { fetchImpl } = world({ runs, jobs });
  const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl, now: NOW });
  assert.equal(verdict.code, VERDICT_OK);
  assert.equal(verdict.source, "job_conclusion");
  assert.equal(verdict.last_success_at, ago(5));
  assert.equal(verdict.secondary_job_success_at, ago(5));
  assert.match(formatVerdictLine(verdict), / source=job_conclusion secondary_job_success_at=2026-10-11T08:37:00\.000Z$/);
});

test("#2830 T-3.1 a ledger from anyone but the workflow can never read as fresh evidence", async () => {
  // The repository is public: anyone can paste a perfect ledger into the issue.
  for (const login of ["someone-else", "github-actions", "dependabot[bot]"]) {
    const forged = ledgerComment({}, { login });
    const { fetchImpl } = world({ comments: [forged], ...fourDaysOfRedBackups() });
    const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl, now: NOW });
    assert.equal(verdict.code, VERDICT_NO_SUCCESS, `author ${login}`);
    assert.equal(verdict.ok, false);
    assert.ok(isAlertingVerdict(verdict.code));
    assert.equal(verdict.source, "job_conclusion");
    assert.equal(verdict.ledger_ignored, 1);
    assert.match(formatVerdictLine(verdict), / ledger_ignored=1$/);
  }
  // Beside the real ledger a forgery changes nothing, in either direction.
  const real = ledgerComment({ evidence_object_manifest_at: ago(30), evidence_entitlement_at: ago(30) }, { updatedAt: ago(30) });
  const fresher = ledgerComment({}, { login: "someone-else", id: 7002, updatedAt: ago(0.1) });
  const expired = await checkRecoveryFreshness({
    env: ENV,
    fetchImpl: world({ comments: [real, fresher] }).fetchImpl,
    now: NOW,
  });
  assert.equal(expired.code, VERDICT_EXPIRED, "a forged fresh ledger cannot hide expired evidence");
  const stale = ledgerComment({ evidence_entitlement_at: ago(99) }, { login: "someone-else", id: 7003 });
  const ok = await checkRecoveryFreshness({
    env: ENV,
    fetchImpl: world({ comments: [ledgerComment(), stale] }).fetchImpl,
    now: NOW,
  });
  assert.equal(ok.code, VERDICT_OK, "and a forged stale one cannot set the alarm off");
});

test("#2830 T-3.1 a ledger that cannot be read is UNPROVEN, never OK and never the job's colour", async () => {
  const green = {
    runs: [{ id: 1, head_branch: "main" }],
    jobs: { 1: [{ name: BACKUP_JOB_NAME, conclusion: "success", completed_at: ago(1) }] },
  };
  const good = formatLedger(ledgerFields());
  const broken = {
    "a field is not a timestamp": good.replace(ago(3.2), "yesterday"),
    "a field is empty": good.replace(`evidence_accepted_at=${ago(3)}`, "evidence_accepted_at="),
    "a field is missing": good.split("\n").filter((line) => !line.startsWith("evidence_restore_drill_at=")).join("\n"),
    "a field is repeated": `${good}\nevidence_entitlement_at=${ago(1)}`,
    "an unknown field": `${good}\nevidence_bonus_at=${ago(1)}`,
    "the run id is not a number": good.replace("run_id=18400000001", "run_id=latest"),
    "the commit is not a sha": good.replace(SHA, "main"),
    "a timezone other than Z": good.replace(ago(3.2), "2026-10-11T10:25:00+00:00"),
    "a marker with nothing after it": LEDGER_MARKER,
  };
  for (const [label, body] of Object.entries(broken)) {
    const { fetchImpl } = world({ comments: [ledgerComment({}, { body })], ...green });
    const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl, now: NOW });
    assert.equal(verdict.code, VERDICT_UNPROVEN, label);
    assert.equal(verdict.source, "ledger", label);
    assert.ok(isAlertingVerdict(verdict.code), label);
  }
  const noStamp = ledgerComment({}, { updatedAt: "recently" });
  const unstamped = await checkRecoveryFreshness({
    env: ENV,
    fetchImpl: world({ comments: [noStamp], ...green }).fetchImpl,
    now: NOW,
  });
  assert.equal(unstamped.code, VERDICT_UNPROVEN);
  assert.equal(unstamped.reason, "LEDGER_UPDATED_AT_UNREADABLE");
});

test("#2830 T-3.1 a ledger stamped in the future is a clock fault, not maximum headroom", async () => {
  for (const name of [
    "evidence_object_manifest_at",
    "evidence_entitlement_at",
    "evidence_database_backup_at",
    "evidence_accepted_at",
    "evidence_restore_drill_at",
  ]) {
    const { fetchImpl } = world({ comments: [ledgerComment({ [name]: ago(-2) })] });
    const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl, now: NOW });
    assert.equal(verdict.code, VERDICT_UNPROVEN, name);
    assert.equal(verdict.reason, "LEDGER_TIMESTAMP_IN_THE_FUTURE", name);
  }
});

test("#2830 T-3.1 an unreadable ledger pages a person, and an unreadable issue is not health", async () => {
  const body = formatLedger(ledgerFields()).replace(ago(3), "soon");
  const { state, fetchImpl } = world({ comments: [ledgerComment({}, { body })] });
  const result = await runWatchdogAndPage({ env: ENV, fetchImpl, now: NOW, stdout: sink(), probe: instantProbe });
  assert.equal(result.verdict.code, VERDICT_UNPROVEN);
  assert.equal(result.exitCode, 1);
  assert.equal(state.emails.length, 1);
  assert.match(state.emails[0].subject, /Backup freshness could not be proven \(LEDGER_FIELD_UNREADABLE\)/);
  assert.equal(state.hostCalls.length, 0, "the site is not probed when the evidence itself is unproven");

  const down = world({ failUrl: "/issues/2830/comments" });
  const stdout = sink();
  const unreadable = await runWatchdogAndPage({ env: ENV, fetchImpl: down.fetchImpl, now: NOW, stdout, probe: instantProbe });
  assert.equal(unreadable.verdict.code, VERDICT_UNPROVEN);
  assert.equal(unreadable.verdict.reason, "LEDGER_COMMENTS_READ_FAILED");
  assert.equal(unreadable.exitCode, 1);
  // The comment could not be posted; the email is still sent.
  assert.match(stdout.text(), /^SITES_RECOVERY_ALERT_DELIVERY posted=false reason=ALERT_COMMENTS_READ_FAILED$/m);
  assert.equal(down.state.emails.length, 1, "a failed comment must not cost the email");
});

test("#2830 T-3.1 the ledger ages into LATE and EXPIRED on the resolver's own budget", async () => {
  const at = (hours) => ledgerComment({ evidence_object_manifest_at: ago(hours), evidence_entitlement_at: ago(hours - 0.5) });
  const verdictAt = async (hours) =>
    checkRecoveryFreshness({ env: ENV, fetchImpl: world({ comments: [at(hours)] }).fetchImpl, now: NOW });
  assert.equal((await verdictAt(17.9)).code, VERDICT_OK);
  assert.equal((await verdictAt(18.1)).code, VERDICT_LATE);
  assert.equal((await verdictAt(26)).code, VERDICT_EXPIRED);
  // Either of the two budgeted instants ageing out is enough.
  const entitlementOld = ledgerComment({ evidence_object_manifest_at: ago(1), evidence_entitlement_at: ago(27) });
  const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl: world({ comments: [entitlementOld] }).fetchImpl, now: NOW });
  assert.equal(verdict.code, VERDICT_EXPIRED);
});

test("#2830 T-3.1 the restore drill has its own budget: late past 93 days, expired at 100", () => {
  const drill = (days) => evaluateLedgerFreshness(
    ledgerFields({ evidence_restore_drill_at: iso(NOW.getTime() - days * DAY) }),
    { now: NOW },
  );
  assert.equal(drill(93).code, VERDICT_OK);
  assert.equal(drill(93.1).code, VERDICT_LATE);
  assert.equal(drill(93.1).reason, "RESTORE_DRILL_NEARLY_EXPIRED");
  assert.equal(drill(100).code, VERDICT_EXPIRED);
  assert.equal(drill(100).reason, "RESTORE_DRILL_EXPIRED");
  assert.deepEqual(pageForVerdict(drill(93.1)).kind, "EVIDENCE_AGEING");
});

test("#2830 T-3.1 an unreadable secondary indicator cannot change what the receipt decided", async () => {
  for (const scenario of [
    { failUrl: "/actions/workflows/" },
    { runs: [{ id: 1.5, head_branch: "main" }] },
  ]) {
    const { fetchImpl } = world({ comments: [ledgerComment()], ...scenario });
    const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl, now: NOW });
    assert.equal(verdict.code, VERDICT_OK, JSON.stringify(scenario));
    assert.equal(verdict.secondary_job_success_at, "unreadable");
  }
});

test("#2830 T-3.1 the newest of the workflow's own ledgers is the one read", () => {
  const older = ledgerComment({ evidence_entitlement_at: ago(40), evidence_object_manifest_at: ago(40) }, { id: 1, updatedAt: ago(40) });
  const newer = ledgerComment({}, { id: 2, updatedAt: ago(3) });
  assert.equal(selectLedger([older, newer]).ledger.comment_id, 2);
  assert.equal(selectLedger([newer, older]).ledger.comment_id, 2);
  assert.deepEqual(selectLedger([]), { ledger: null, ignored: 0 });
  assert.deepEqual(selectLedger("nope"), { unproven: "LEDGER_COMMENTS_NOT_A_LIST" });
  // A comment that merely mentions the marker is not a ledger.
  assert.deepEqual(
    selectLedger([{ body: `see ${LEDGER_MARKER}`, user: { login: LEDGER_AUTHOR }, updated_at: ago(1) }]),
    { ledger: null, ignored: 0 },
  );
  assert.deepEqual(parseLedger(formatLedger(ledgerFields())).fields, ledgerFields());
});

// ---------------------------------------------------------------------------
// T-3.2 — the public site, asked directly
// ---------------------------------------------------------------------------

test("#2830 T-3.2 fresh evidence behind a site that is not serving is paged, once a day", async () => {
  const { state, fetchImpl } = world({ comments: [ledgerComment()], host: [404, 404] });
  const stdout = sink();
  const options = { env: ENV, fetchImpl, stdout, probe: instantProbe };
  const first = await runWatchdogAndPage({ ...options, now: NOW });
  assert.equal(first.verdict.code, VERDICT_HOST_DOWN);
  assert.equal(first.verdict.ok, false);
  assert.equal(first.exitCode, 1);
  assert.equal(first.verdict.public_host_status, "404");
  assert.match(stdout.lines[0], /^SITES_RECOVERY_FRESHNESS code=SITES_PILOT_HOST_DOWN_EVIDENCE_FRESH .* reason=PUBLIC_HOST_NOT_SERVING source=ledger .* public_host_status=404$/);
  assert.equal(state.emails.length, 1);
  assert.equal(state.emails[0].subject, "[Mingla Sites] Site is DOWN although backup evidence is fresh");
  assert.match(state.emails[0].text, /Re-activating the pilot after a deactivation/);
  // The issue comment tells the reader a backup will not fix this.
  assert.match(state.posts[0], /Dispatching another backup does not help/);

  // An hour later, same day: still down, still red, nobody emailed twice.
  const second = await runWatchdogAndPage({ ...options, now: new Date(NOW.getTime() + HOUR) });
  assert.equal(second.verdict.code, VERDICT_HOST_DOWN);
  assert.equal(second.exitCode, 1);
  assert.equal(state.emails.length, 1, "one email per UTC day");
  // The next day it is announced again: a site that stays down is not old news.
  await runWatchdogAndPage({ ...options, now: new Date(NOW.getTime() + 11 * HOUR) });
  assert.equal(state.emails.length, 2);
});

test("#2830 T-3.2 one bad answer is not an outage: 404 then 200 is OK", async () => {
  const { state, fetchImpl } = world({ comments: [ledgerComment()], host: [404, 200] });
  const result = await runWatchdogAndPage({ env: ENV, fetchImpl, now: NOW, stdout: sink(), probe: instantProbe });
  assert.equal(result.verdict.code, VERDICT_OK);
  assert.equal(result.verdict.public_host_status, "200");
  assert.equal(result.exitCode, 0);
  assert.equal(state.hostCalls.length, 2);
  assert.equal(state.emails.length, 0);
});

test("#2830 T-3.2 a request that could not be made is reported, never paged", async () => {
  for (const host of [["throw"], [503, "throw"]]) {
    const { state, fetchImpl } = world({ comments: [ledgerComment()], host });
    const stdout = sink();
    const result = await runWatchdogAndPage({ env: ENV, fetchImpl, now: NOW, stdout, probe: instantProbe });
    assert.equal(result.verdict.code, VERDICT_OK, JSON.stringify(host));
    assert.equal(result.verdict.public_host_status, "unreadable");
    assert.match(stdout.lines[0], / public_host_status=unreadable$/);
    assert.equal(state.emails.length, 0);
  }
});

test("#2830 T-3.2 the probe is two plain requests ten seconds apart, and one when the site is up", async () => {
  const delays = [];
  const delay = async (ms) => delays.push(ms);
  const up = world({ host: [200] });
  assert.deepEqual(await probePublicHost({ fetchImpl: up.fetchImpl, delay }), { status: "200", down: false });
  assert.equal(up.state.hostCalls.length, 1);
  assert.deepEqual(delays, []);
  assert.equal(up.state.hostInit.redirect, "manual", "a redirect is not followed to some other page's 200");
  assert.equal(up.state.hostInit.headers, undefined, "no credential is sent");

  for (const status of [404, 500, 301, 403]) {
    const down = world({ host: [status, status] });
    assert.deepEqual(
      await probePublicHost({ fetchImpl: down.fetchImpl, delay }),
      { status: String(status), down: true },
    );
    assert.equal(down.state.hostCalls.length, 2);
  }
  assert.deepEqual([...new Set(delays)], [HOST_PROBE_GAP_MS]);
  assert.equal(HOST_PROBE_GAP_MS, 10_000);
  assert.equal(PILOT_PUBLIC_URL, "https://gogi.sites.usemingla.com/");
});

test("#2830 T-3.2 evidence that is ageing AND a site that is down reports the site", async () => {
  const late = ledgerComment({ evidence_object_manifest_at: ago(20), evidence_entitlement_at: ago(20) });
  const { fetchImpl } = world({ comments: [late], host: [404, 404] });
  const result = await runWatchdogAndPage({ env: ENV, fetchImpl, now: NOW, stdout: sink(), probe: instantProbe });
  assert.equal(result.verdict.code, VERDICT_HOST_DOWN);
  assert.equal(result.verdict.headroom_hours, 6);
});

test("#2830 T-3.2 expired evidence is not re-described as a host outage", async () => {
  const expired = ledgerComment({ evidence_object_manifest_at: ago(30), evidence_entitlement_at: ago(30) });
  const { state, fetchImpl } = world({ comments: [expired], host: [404, 404] });
  const result = await runWatchdogAndPage({ env: ENV, fetchImpl, now: NOW, stdout: sink(), probe: instantProbe });
  assert.equal(result.verdict.code, VERDICT_EXPIRED);
  assert.equal(state.hostCalls.length, 0);
  assert.match(state.emails[0].subject, /Backup evidence has EXPIRED/);
});

test("#2830 T-3.2 the older entrypoint still comments and never emails", async () => {
  // `runRecoveryFreshnessWatchdog` is what the #3606 suites drive. It gains the
  // ledger and the host verdict, and keeps its contract: one issue comment.
  const { state, fetchImpl } = world({ comments: [ledgerComment()], host: [404, 404] });
  const { verdict, alert } = await runRecoveryFreshnessWatchdog({
    env: ENV, fetchImpl, now: NOW, stdout: sink(), probe: instantProbe,
  });
  assert.equal(verdict.code, VERDICT_HOST_DOWN);
  assert.equal(alert.posted, true);
  assert.equal(state.emails.length, 0);
});

// ---------------------------------------------------------------------------
// T-3.3 — the ledger is written from the evidence, by the run that took it
// ---------------------------------------------------------------------------

function jobBlock(name) {
  const at = WORKFLOW.indexOf(`\n  ${name}:\n`);
  assert.ok(at >= 0, `job ${name} exists`);
  const rest = WORKFLOW.slice(at + 1);
  const end = rest.search(/\n {2}[a-z_]+:\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

test("#2830 T-3.3 publish_evidence keys on the evidence output, not on the backup job's result", () => {
  const job = jobBlock("publish_evidence");
  const condition = /\n {4}if: >-\n((?: {6}.*\n)+)/.exec(job)[1]
    .split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  assert.ok(condition.startsWith("always() &&"), "it must be reachable after a failed backup job");
  assert.ok(condition.includes("needs.backup_restore.outputs.evidence_object_manifest_at != ''"));
  assert.equal(/needs\.backup_restore\.result/.test(condition), false,
    "evidence Core accepted is published even if a later step in that job failed");
  for (const clause of [
    "github.event_name != 'pull_request'",
    "github.ref == 'refs/heads/main'",
    "github.event.schedule != '37 * * * *'",
    "github.event.inputs.mode != 'freshness-check'",
  ]) assert.ok(condition.includes(clause), clause);
  assert.match(job, /^ {4}needs: \[backup_restore\]$/m);
  assert.equal(/^ {4}environment:/m.test(job), false, "no production environment");
  assert.equal(/secrets\./.test(job), false, "no secret at all: its inputs are timestamps");
  assert.match(job, /^ {6}issues: write$/m);
  assert.match(job, /^ {8}run: node scripts\/sites\/publish-recovery-evidence\.mjs$/m);
  assert.doesNotMatch(WORKFLOW, /actions\/upload-artifact|actions\/cache/);
});

test("#2830 T-3.3 the five instants travel from the steps that proved them to the publisher", () => {
  const backup = jobBlock("backup_restore");
  const publish = jobBlock("publish_evidence");
  const sources = {
    evidence_object_manifest_at: "evidence",
    evidence_entitlement_at: "evidence",
    evidence_database_backup_at: "evidence",
    evidence_accepted_at: "evidence",
    evidence_restore_drill_at: "restore",
  };
  for (const [name, step] of Object.entries(sources)) {
    assert.ok(
      backup.includes(`      ${name}: \${{ steps.${step}.outputs.${name} }}\n`),
      `backup_restore exposes ${name} from step ${step}`,
    );
    assert.ok(
      publish.includes(`          ${name.toUpperCase()}: \${{ needs.backup_restore.outputs.${name} }}\n`),
      `publish_evidence receives ${name}`,
    );
  }
  assert.match(backup, /\n {8}id: evidence\n[\s\S]*?run: node scripts\/sites\/backup-sites-cms\.mjs record-evidence\n/);
  assert.match(backup, /\n {8}id: restore\n[\s\S]*?run: node scripts\/sites\/restore-sites-cms\.mjs\n/);
  // The watchdog still holds no production credential.
  const watchdog = jobBlock("recovery_freshness");
  const secrets = [...watchdog.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]).sort();
  assert.deepEqual(secrets, ["MINGLA_SITES_OPS_ALERT_TO", "RESEND_API_KEY"]);
  assert.equal(/^ {4}environment:/m.test(watchdog), false);
});

test("#2830 T-3.3 recording evidence for real writes the four instants Core accepted", async () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2830-evidence-"));
  try {
    const siteId = "11111111-1111-4111-8111-111111111111";
    const manifestAt = ago(0.2);
    const databaseAt = ago(6);
    const acceptedAt = "2026-10-11 13:37:01.5+00";
    const result = {
      ok: true,
      code: "SITES_BACKUP_BUNDLE_READY",
      bundle_name: "immutable.msbk",
      bundle_path: join(root, "immutable.msbk"),
      bundle_sha256: "b".repeat(64),
      manifest_digest: "c".repeat(64),
      database_backup_verified_at: databaseAt,
      managed_backup_state: "current",
      object_manifest_verified_at: manifestAt,
      object_count: 1,
      object_bytes: 5,
    };
    writeFileSync(join(root, "result.json"), stableJson(result));
    writeFileSync(join(root, "restore.json"), stableJson({
      ok: true,
      code: "SITES_RESTORE_DRILL_COMPLETE",
      restore_drill_verified_at: NOW.toISOString(),
      restore_drill_evidence_digest: "e".repeat(64),
      tenant_count: 1,
      document_count: 6,
      object_count: 1,
      object_bytes: 5,
    }));
    const outputPath = join(root, "github-output");
    writeFileSync(outputPath, "");
    const env = {
      SITES_BACKUP_RESULT_PATH: join(root, "result.json"),
      SITES_BACKUP_BLOB_PATHNAME: "recovery/sites/immutable.msbk",
      SITES_BACKUP_INDEPENDENT_READBACK_SHA256: result.bundle_sha256,
      SITES_BACKUP_UPLOAD_VERIFIED_AT: NOW.toISOString(),
      SITES_BACKUP_RESTORE_RESULT_PATH: join(root, "restore.json"),
      SITES_PILOT_SITE_ID: siteId,
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "42",
      SITES_CORE_BASE_URL: "https://core.example.test",
      MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
      MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
      GITHUB_OUTPUT: outputPath,
    };
    const core = (accepted) => async () => Response.json({
      ok: true,
      data: {
        site_id: siteId,
        evidence_kind: "nightly_backup",
        accepted_at: accepted,
        readiness: {
          backup_retention_days: 7,
          database_backup_verified_at: databaseAt,
          object_manifest_verified_at: manifestAt,
          restore_drill_verified_at: null,
          restore_drill_evidence_digest: null,
        },
      },
    });
    await recordBackupEvidence({ env, fetchImpl: core(acceptedAt), now: NOW });
    assert.equal(
      readFileSync(outputPath, "utf8"),
      [
        `evidence_object_manifest_at=${manifestAt}`,
        `evidence_entitlement_at=${NOW.toISOString()}`,
        `evidence_database_backup_at=${databaseAt}`,
        "evidence_accepted_at=2026-10-11T13:37:01.500Z",
        "",
      ].join("\n"),
    );
    // A refused commit publishes nothing: the ledger only ever carries
    // evidence Core accepted and read back.
    writeFileSync(outputPath, "");
    await assert.rejects(() => recordBackupEvidence({
      env,
      fetchImpl: async () => Response.json({ ok: false }, { status: 503 }),
      now: NOW,
    }));
    assert.equal(readFileSync(outputPath, "utf8"), "");
    // Outside Actions there is no output file, and recording still succeeds.
    const { GITHUB_OUTPUT: _unused, ...local } = env;
    await recordBackupEvidence({ env: local, fetchImpl: core(acceptedAt), now: NOW });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2830 T-3.3 the output writer carries timestamps only, all or nothing, and never throws", () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2830-outputs-"));
  try {
    const path = join(root, "out");
    writeFileSync(path, "");
    assert.equal(appendEvidenceOutputs({ GITHUB_OUTPUT: path }, { evidence_restore_drill_at: "2026-10-11T13:00:00Z" }), true);
    assert.equal(readFileSync(path, "utf8"), "evidence_restore_drill_at=2026-10-11T13:00:00.000Z\n");
    writeFileSync(path, "");
    for (const values of [
      { evidence_ok_at: "2026-10-11T13:00:00Z", evidence_bad_at: "not a time" },
      { evidence_ok_at: "2026-10-11T13:00:00Z", site_id: "2026-10-11T13:00:00Z" },
      { "evidence_x_at\nrecovery_deactivate=false": "2026-10-11T13:00:00Z" },
      { evidence_ok_at: 5 },
      {},
    ]) {
      assert.equal(appendEvidenceOutputs({ GITHUB_OUTPUT: path }, values), false, JSON.stringify(values));
      assert.equal(readFileSync(path, "utf8"), "", "nothing partial is written");
    }
    assert.equal(appendEvidenceOutputs({}, { evidence_ok_at: "2026-10-11T13:00:00Z" }), false);
    assert.equal(appendEvidenceOutputs({ GITHUB_OUTPUT: join(root, "missing", "dir", "out") }, { evidence_ok_at: "2026-10-11T13:00:00Z" }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const PUBLISH_ENV = Object.freeze({
  ...ENV,
  EVIDENCE_OBJECT_MANIFEST_AT: ago(0.3),
  EVIDENCE_ENTITLEMENT_AT: ago(0.1),
  EVIDENCE_DATABASE_BACKUP_AT: ago(6),
  EVIDENCE_ACCEPTED_AT: ago(0.1),
  EVIDENCE_RESTORE_DRILL_AT: ago(0.15),
});

test("#2830 T-3.3 the publisher creates the ledger once, then edits it in place", async () => {
  const { state, fetchImpl } = world();
  const stdout = sink();
  const first = await publishRecoveryEvidence({ env: PUBLISH_ENV, fetchImpl, now: NOW, stdout });
  assert.equal(first.action, "created");
  assert.equal(state.posts.length, 1);
  assert.deepEqual(state.posts[0].split("\n"), [
    LEDGER_MARKER,
    `evidence_object_manifest_at=${ago(0.3)}`,
    `evidence_entitlement_at=${ago(0.1)}`,
    `evidence_database_backup_at=${ago(6)}`,
    `evidence_accepted_at=${ago(0.1)}`,
    `evidence_restore_drill_at=${ago(0.15)}`,
    "run_id=42",
    `head_sha=${SHA}`,
  ]);
  assert.match(stdout.lines[0], /^SITES_RECOVERY_EVIDENCE_LEDGER_OK action=created evidence_at=2026-10-11T13:19:00\.000Z$/);
  // What it wrote is what the watchdog reads, with no translation in between.
  const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl, now: NOW });
  assert.equal(verdict.code, VERDICT_OK);
  assert.equal(verdict.source, "ledger");
  assert.equal(verdict.last_success_at, ago(0.3));

  const later = new Date(NOW.getTime() + 12 * HOUR);
  const next = { ...PUBLISH_ENV, EVIDENCE_OBJECT_MANIFEST_AT: iso(later.getTime() - 60_000), EVIDENCE_ENTITLEMENT_AT: iso(later.getTime() - 30_000), GITHUB_RUN_ID: "43" };
  const second = await publishRecoveryEvidence({ env: next, fetchImpl, now: later, stdout: sink() });
  assert.equal(second.action, "updated");
  assert.equal(state.posts.length, 1, "no second comment");
  assert.equal(state.patches.length, 1);
  assert.match(state.patches[0].body, /^run_id=43$/m);
});

test("#2830 T-3.3 the publisher repairs its own broken ledger and never edits anyone else's", async () => {
  const broken = ledgerComment({}, { id: 7001, body: `${LEDGER_MARKER}\ngarbage` });
  const repaired = world({ comments: [broken] });
  const result = await publishRecoveryEvidence({ env: PUBLISH_ENV, fetchImpl: repaired.fetchImpl, now: NOW, stdout: sink() });
  assert.equal(result.action, "updated");
  assert.equal(repaired.state.patches[0].id, 7001);

  const forged = ledgerComment({}, { login: "someone-else", id: 8001 });
  const untouched = world({ comments: [forged] });
  const created = await publishRecoveryEvidence({ env: PUBLISH_ENV, fetchImpl: untouched.fetchImpl, now: NOW, stdout: sink() });
  assert.equal(created.action, "created");
  assert.equal(untouched.state.patches.length, 0);
});

test("#2830 T-3.3 the publisher refuses anything that is not five past instants and a run identity", async () => {
  const cases = {
    EVIDENCE_LEDGER_INPUT_INVALID: [
      { EVIDENCE_OBJECT_MANIFEST_AT: "" },
      { EVIDENCE_RESTORE_DRILL_AT: undefined },
      { EVIDENCE_ACCEPTED_AT: "yesterday" },
      { EVIDENCE_ENTITLEMENT_AT: "2026-10-11T13:00:00Z\nrun_id=1" },
    ],
    EVIDENCE_LEDGER_INPUT_IN_THE_FUTURE: [{ EVIDENCE_ENTITLEMENT_AT: ago(-1) }],
    EVIDENCE_LEDGER_RUN_IDENTITY_INVALID: [{ GITHUB_RUN_ID: "" }, { GITHUB_SHA: "main" }],
  };
  for (const [code, overrides] of Object.entries(cases)) {
    for (const override of overrides) {
      const { state, fetchImpl } = world();
      await assert.rejects(
        () => publishRecoveryEvidence({ env: { ...PUBLISH_ENV, ...override }, fetchImpl, now: NOW, stdout: sink() }),
        new RegExp(code),
        JSON.stringify(override),
      );
      assert.equal(state.posts.length + state.patches.length, 0, "nothing is written");
    }
  }
  assert.throws(() => ledgerFieldsFromEnv({}, { now: NOW }), /EVIDENCE_LEDGER_INPUT_INVALID/);
  // Whatever spelling arrives, exactly one canonical spelling is published.
  const fields = ledgerFieldsFromEnv({ ...PUBLISH_ENV, EVIDENCE_ACCEPTED_AT: "2026-10-11 13:30:00+00" }, { now: NOW });
  assert.equal(fields.evidence_accepted_at, "2026-10-11T13:30:00.000Z");
});

test("#2830 T-3.3 the contract lane runs this suite", () => {
  assert.match(jobBlock("contracts"), /issue_2830_evidence_based_freshness\.test\.mjs/);
});
