/**
 * Issue #2830 — a housekeeping failure can no longer take a live site down.
 *
 * From 2026-10-07 the signed tenant retention sweep failed on every run: a
 * framework upgrade made the CMS read a column its database did not have. The
 * sweep was the LAST STEP of the job named `Private backup and isolated
 * restore`, after the readiness evidence had already been committed. So:
 *
 *   - the backup job failed although the backup and the restore were verified;
 *   - `run-sites-retention.mjs` exited 1 without writing a classification, and
 *     the gate reads "no classification" as "deactivate", so the live gogi
 *     pilot was signed off the air and stayed off for four days;
 *   - the run was red on `main`, and the freshness watchdog, which keys on that
 *     job's conclusion, reported that no backup had succeeded.
 *
 * What is pinned here:
 *   T-2.1  the shape of the job graph (retention is its own job, nothing follows
 *          the evidence commit, `deactivate` cannot see retention);
 *   T-2.2  the retention CLI, run for real, always classifies its own failure
 *          as non-deactivating;
 *   SC-2.4 the five readiness codes and an absent or unreadable classification
 *          STILL deactivate (the fix must not loosen the real gate);
 *   T-8.1  the runbook says how to re-activate.
 *
 * A GitHub Actions job graph cannot be executed locally. Two things are done
 * instead, and they are different kinds of evidence:
 *   - the workflow's own inline scripts (the classify step, the outcome step)
 *     are extracted from the YAML and RUN, against real files written by the
 *     real CLI;
 *   - the `needs:` / `if:` graph is evaluated by a small model of GitHub's
 *     expression rules below. That is a model, not GitHub. It reads the
 *     conditions from the file, so it moves when they move.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEACTIVATING_RECOVERY_CODES } from "../lib/sites-ops.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const WORKFLOW = readFileSync(
  join(REPO, ".github/workflows/sites-backup-restore.yml"),
  "utf8",
);
const RUNBOOK = readFileSync(
  join(REPO, "docs/runbooks/MINGLA_SITES_PILOT.md"),
  "utf8",
);
const RETENTION_CLI = join(REPO, "scripts/sites/run-sites-retention.mjs");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const WATCHDOG_CRON = "37 * * * *";
const BACKUP_CRON = "23 7 * * *";

const READINESS_VIOLATIONS = [
  "DATABASE_BACKUP_CURRENT_FAILED",
  "DATABASE_BACKUP_MISSING",
  "DATABASE_BACKUP_RETENTION_UNPROVEN",
  "DATABASE_BACKUP_STALE",
  "DATABASE_BACKUP_WALG_DISABLED",
];

// ---------------------------------------------------------------------------
// Workflow reading. No YAML dependency is available to `node --test`, and this
// file is regular enough that indentation is a sufficient grammar.
// ---------------------------------------------------------------------------

function parseJobs(source) {
  const jobsAt = source.indexOf("\njobs:\n");
  assert.ok(jobsAt >= 0, "workflow has a jobs: block");
  const lines = source.slice(jobsAt + "\njobs:\n".length).split("\n");
  const jobs = new Map();
  let name = null;
  let body = [];
  const flush = () => {
    if (name) jobs.set(name, parseJob(body));
  };
  for (const line of lines) {
    const header = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (header) {
      flush();
      name = header[1];
      body = [];
    } else if (name) body.push(line);
  }
  flush();
  return jobs;
}

function parseJob(lines) {
  const text = lines.join("\n");
  const head = text.split(/\n {4}steps:\n/)[0];
  const needsLine = /^ {4}needs: (.+)$/m.exec(head);
  let needs = [];
  if (needsLine) {
    const raw = needsLine[1].trim();
    needs = raw.startsWith("[")
      ? raw.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean)
      : [raw];
  }
  const folded = /^ {4}if: >-\n((?: {6}.*\n)+)/m.exec(`${head}\n`);
  const condition = folded
    ? folded[1].split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
    : null;
  const stepsAt = text.indexOf("\n    steps:\n");
  const steps = [];
  if (stepsAt >= 0) {
    let current = null;
    for (const line of text.slice(stepsAt + "\n    steps:\n".length).split("\n")) {
      if (/^ {6}- /.test(line)) {
        if (current) steps.push(current);
        current = [line];
      } else if (current && !/^ {6}#/.test(line)) current.push(line);
    }
    if (current) steps.push(current);
  }
  return {
    head,
    needs,
    needsLiteral: needsLine ? needsLine[1].trim() : null,
    condition,
    steps: steps.map((stepLines) => {
      const stepText = stepLines.join("\n");
      return {
        text: stepText,
        name: /^ {6}- name: (.+)$/m.exec(stepText)?.[1] ??
          /^ {6}- uses: (\S+)/m.exec(stepText)?.[1] ?? null,
        id: /^ {8}id: (\S+)$/m.exec(stepText)?.[1] ?? null,
        condition: /^ {8}if: (.+)$/m.exec(stepText)?.[1] ?? null,
        continueOnError: /^ {8}continue-on-error: true$/m.test(stepText),
      };
    }),
  };
}

/** The node script a step feeds to `node --input-type=module <<'NODE'`. */
function inlineNodeScript(step) {
  const match = /<<'NODE'\n([\s\S]*?)\n\s*NODE(?:\n|$)/.exec(step.text);
  assert.ok(match, `step ${step.name} carries an inline node script`);
  return match[1];
}

function runInlineStep(step, env) {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-step-"));
  const outputPath = join(dir, "github-output");
  writeFileSync(outputPath, "");
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: inlineNodeScript(step),
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputPath, ...env },
  });
  assert.equal(result.status, 0, `inline step exited ${result.status}: ${result.stderr}`);
  const outputs = {};
  for (const line of readFileSync(outputPath, "utf8").split("\n")) {
    if (!line) continue;
    const at = line.indexOf("=");
    outputs[line.slice(0, at)] = line.slice(at + 1);
  }
  return { outputs, stdout: result.stdout };
}

// ---------------------------------------------------------------------------
// A model of GitHub's `if:` evaluation, for exactly the grammar this workflow
// uses: `&&`, `||`, parentheses, `==`, `!=`, single-quoted strings, dotted
// context lookups and `always()`. A missing context value is the empty string,
// as on GitHub. A job whose condition names no status function is skipped
// unless every job it needs succeeded, as on GitHub.
// ---------------------------------------------------------------------------

function tokenize(expression) {
  const tokens = [];
  const pattern = /\s*(&&|\|\||==|!=|\(|\)|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.-]*)/y;
  let at = 0;
  while (at < expression.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(expression);
    assert.ok(match, `unsupported expression syntax at: ${expression.slice(at, at + 40)}`);
    tokens.push(match[1]);
    at = pattern.lastIndex;
    if (/^\s*$/.test(expression.slice(at))) break;
  }
  return tokens;
}

function lookup(context, path) {
  let value = context;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object" || !(part in value)) return "";
    value = value[part];
  }
  return value === null || value === undefined ? "" : value;
}

function evaluate(expression, context) {
  const tokens = tokenize(expression);
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const operand = () => {
    const token = take();
    if (token === "(") {
      if (peek() === ")") assert.fail("empty parentheses");
      const value = or();
      assert.equal(take(), ")", "closing parenthesis");
      return value;
    }
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token === "always" && peek() === "(") {
      take();
      assert.equal(take(), ")");
      return true;
    }
    return lookup(context, token);
  };
  const comparison = () => {
    const left = operand();
    if (peek() === "==" || peek() === "!=") {
      const operator = take();
      const right = operand();
      const equal = String(left) === String(right);
      return operator === "==" ? equal : !equal;
    }
    return left;
  };
  const and = () => {
    let value = comparison();
    while (peek() === "&&") {
      take();
      const right = comparison();
      value = Boolean(value) && Boolean(right);
    }
    return value;
  };
  function or() {
    let value = and();
    while (peek() === "||") {
      take();
      const right = and();
      value = Boolean(value) || Boolean(right);
    }
    return value;
  }
  const value = or();
  assert.equal(at, tokens.length, `trailing tokens in: ${expression}`);
  return Boolean(value);
}

/**
 * Walks the job graph in file order (every `needs` in this workflow points
 * backwards). `run(job, needs)` says what a job that RUNS produces.
 */
function simulate(jobs, github, run) {
  const results = {};
  for (const [name, job] of jobs) {
    const needs = {};
    for (const needed of job.needs) {
      assert.ok(needed in results, `${name} needs ${needed}, which is declared earlier`);
      needs[needed] = results[needed];
    }
    const hasStatusFunction = job.condition !== null && /\balways\(\)/.test(job.condition);
    const needsOk = Object.values(needs).every((need) => need.result === "success");
    let runs = hasStatusFunction || needsOk;
    if (runs && job.condition !== null) runs = evaluate(job.condition, { github, needs });
    results[name] = runs
      ? { result: "success", outputs: {}, ...run(name, needs) }
      : { result: "skipped", outputs: {} };
  }
  const conclusion = Object.values(results).some((job) => job.result === "failure")
    ? "failure"
    : "success";
  return { results, conclusion };
}

const scheduledBackup = Object.freeze({
  event_name: "schedule",
  ref: "refs/heads/main",
  event: { schedule: BACKUP_CRON },
});

// ---------------------------------------------------------------------------
// The retention CLI, run for real. A preload module replaces `fetch` so the
// process never touches the network; everything else is the shipped script.
// ---------------------------------------------------------------------------

function runRetentionCli({ origin, fetchMode = "none", status = 200, body = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-cli-"));
  const classificationPath = join(dir, "classification.json");
  const preload = join(dir, "preload.mjs");
  writeFileSync(preload, [
    "globalThis.fetch = async () => {",
    "  const mode = process.env.FIXTURE_FETCH_MODE;",
    "  if (mode === 'none') {",
    "    process.stderr.write('FIXTURE_NETWORK_REACHED\\n');",
    "    throw new Error('the fixture reached the network');",
    "  }",
    "  if (mode === 'throw') throw new TypeError(process.env.FIXTURE_BODY);",
    "  return new Response(process.env.FIXTURE_BODY, {",
    "    status: Number(process.env.FIXTURE_STATUS),",
    "    headers: { 'content-type': 'application/json' },",
    "  });",
    "};",
    "",
  ].join("\n"));
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(preload).href, RETENTION_CLI],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SITES_PILOT_SITE_ID: SITE_ID,
        SITES_CMS_ORIGIN: origin ?? "https://studio.sites.usemingla.com",
        MINGLA_CORE_TO_CMS_CURRENT_KID: "core-key-v1",
        MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: Buffer.alloc(32, 4).toString("base64"),
        SITES_RECOVERY_CLASSIFICATION_PATH: classificationPath,
        FIXTURE_FETCH_MODE: fetchMode,
        FIXTURE_STATUS: String(status),
        FIXTURE_BODY: body,
      },
    },
  );
  return {
    ...result,
    classificationPath,
    classification: existsSync(classificationPath)
      ? JSON.parse(readFileSync(classificationPath, "utf8"))
      : null,
  };
}

const jobs = parseJobs(WORKFLOW);
const backup = jobs.get("backup_restore");
const classifyStep = backup.steps.find((step) => step.id === "classify");

// ---------------------------------------------------------------------------
// T-2.1 — the shape of the graph
// ---------------------------------------------------------------------------

test("#2830 T-2.1 the sweep is no longer a step of the backup job", () => {
  assert.ok(backup, "backup_restore job exists");
  for (const step of backup.steps) {
    assert.equal(
      /run-sites-retention/.test(step.text),
      false,
      `backup_restore step "${step.name}" runs the retention sweep`,
    );
    assert.equal(/retention-sweep/.test(step.text), false);
  }
  const owners = [...jobs].filter(([, job]) =>
    job.steps.some((step) => /run-sites-retention\.mjs/.test(step.text)));
  assert.deepEqual(owners.map(([name]) => name), ["retention"]);
});

test("#2830 T-2.1 nothing follows the evidence commit except the classify step", () => {
  const last = backup.steps.at(-1);
  const beforeLast = backup.steps.at(-2);
  assert.equal(last.id, "classify", "the last step of backup_restore is the classify step");
  assert.equal(last.condition, "failure()", "the classify step runs only on failure");
  assert.match(
    beforeLast.text,
    /^ {8}run: node scripts\/sites\/backup-sites-cms\.mjs record-evidence$/m,
    `the last working step of backup_restore must be the evidence commit, found "${beforeLast.name}"`,
  );
  const evidenceSteps = backup.steps.filter((step) => /record-evidence/.test(step.text));
  assert.equal(evidenceSteps.length, 1);
});

test("#2830 T-2.1 retention runs only after a verified backup, in its own job", () => {
  const retention = jobs.get("retention");
  assert.ok(retention, "retention job exists");
  assert.deepEqual(retention.needs, ["backup_restore"]);
  const condition = retention.condition;
  assert.ok(condition, "retention has an if: condition");
  for (const clause of [
    "always()",
    "github.event_name != 'pull_request'",
    "github.ref == 'refs/heads/main'",
    `github.event.schedule != '${WATCHDOG_CRON}'`,
    "github.event.inputs.mode != 'freshness-check'",
    "needs.backup_restore.result == 'success'",
  ]) assert.ok(condition.includes(clause), `retention if: carries ${clause}`);
  assert.match(retention.head, /^ {4}environment: mingla-sites-production$/m);
  assert.match(retention.head, /^ {4}timeout-minutes: 10$/m);
  assert.equal(/issues: write/.test(retention.head), false, "retention holds no issues permission");
});

test("#2830 T-2.1 a failed sweep cannot fail its job, and its outcome is published", () => {
  const retention = jobs.get("retention");
  const sweep = retention.steps.find((step) => /run-sites-retention\.mjs/.test(step.text));
  assert.equal(sweep.id, "sweep");
  assert.equal(sweep.continueOnError, true, "the sweep step needs step-level continue-on-error: true");
  // Job-level continue-on-error is deliberately not relied on: what it does to
  // `needs.<job>.result` is not something this workflow should depend on.
  assert.equal(/^ {4}continue-on-error:/m.test(retention.head), false);
  const after = retention.steps.slice(retention.steps.indexOf(sweep) + 1);
  assert.equal(after.length, 1, "exactly one step follows the sweep");
  assert.equal(after[0].condition, null, "the outcome step is unconditional");
  assert.match(after[0].text, /SWEEP_OUTCOME: \$\{\{ steps\.sweep\.outcome \}\}/);
  assert.equal(/steps\.sweep\.conclusion/.test(WORKFLOW), false,
    "`conclusion` is always success under continue-on-error; only `outcome` is the real result");
  assert.match(retention.head,
    /retention_outcome: \$\{\{ steps\.report\.outputs\.retention_outcome \}\}/);
  assert.match(retention.head,
    /retention_code: \$\{\{ steps\.report\.outputs\.retention_code \}\}/);
  assert.equal(after[0].id, "report");
});

test("#2830 T-2.1 the deactivation gate cannot see retention at all", () => {
  for (const name of ["deactivate", "alert"]) {
    const job = jobs.get(name);
    assert.equal(job.needs.includes("retention"), false, `${name} must not need retention`);
    assert.equal(job.needs.includes("housekeeping_alert"), false);
    assert.equal(/retention/.test(job.condition), false,
      `${name} if: must not reference retention: ${job.condition}`);
  }
  assert.equal(jobs.get("deactivate").needsLiteral, "[contracts, backup_restore]");
  assert.equal(jobs.get("alert").needsLiteral, "[contracts, backup_restore, deactivate]");
  // The only job allowed to deactivate is still the only one that can.
  const deactivators = [...jobs].filter(([, job]) =>
    job.steps.some((step) => /backup-sites-cms\.mjs deactivate/.test(step.text)));
  assert.deepEqual(deactivators.map(([name]) => name), ["deactivate"]);
});

test("#2830 T-2.1 a failed sweep is still reported, by a job with no production access", () => {
  const alert = jobs.get("housekeeping_alert");
  assert.ok(alert, "housekeeping_alert job exists");
  assert.deepEqual(alert.needs, ["backup_restore", "retention"]);
  for (const clause of [
    "always()",
    "github.event_name != 'pull_request'",
    "github.ref == 'refs/heads/main'",
    `github.event.schedule != '${WATCHDOG_CRON}'`,
    "github.event.inputs.mode != 'freshness-check'",
    "needs.retention.outputs.retention_outcome == 'failure'",
  ]) assert.ok(alert.condition.includes(clause), `housekeeping_alert if: carries ${clause}`);
  assert.equal(/^ {4}environment:/m.test(alert.head), false, "the alert job holds no environment");
  assert.match(alert.head, /issues: write/);
  const text = alert.steps.map((step) => step.text).join("\n");
  assert.equal(/secrets\./.test(text), false, "the alert job reads no secret");
  assert.match(text, /issues\/2830\/comments/);
  assert.match(
    text,
    /SITES_HOUSEKEEPING_ALERT kind=RETENTION_FAILED code=\$\{code\} outcome=PILOT_UNAFFECTED recovery_evidence_fresh run_url=\$\{run_url\}/,
  );
});

// ---------------------------------------------------------------------------
// T-2.2 — the CLI classifies its own failure, for real
// ---------------------------------------------------------------------------

test("#2830 T-2.2 a failing retention CLI writes deactivating:false before any network call", () => {
  const result = runRetentionCli({ origin: "https://evil.invalid" });
  assert.equal(result.status, 1);
  assert.equal(/FIXTURE_NETWORK_REACHED/.test(result.stderr), false);
  assert.deepEqual(result.classification, {
    code: "CMS_ORIGIN_MISMATCH",
    deactivating: false,
  });
  // The pre-existing JSON line is kept; the new line names the code.
  assert.match(result.stderr, /^\{"ok":false,"error":"CMS_ORIGIN_MISMATCH"\}$/m);
  assert.match(result.stderr, /^SITES_RETENTION_FAILED code=CMS_ORIGIN_MISMATCH$/m);
});

test("#2830 T-2.2 the 2026-10-07 failure (CMS answers 503) classifies as non-deactivating", () => {
  // What the CMS actually returned for four days.
  const result = runRetentionCli({
    fetchMode: "respond",
    status: 503,
    body: JSON.stringify({ ok: false, error: { code: "SERVICE_TEMPORARILY_UNAVAILABLE" } }),
  });
  assert.equal(result.status, 1);
  assert.deepEqual(result.classification, {
    code: "RETENTION_SWEEP_FAILED",
    deactivating: false,
  });
  assert.match(result.stderr, /^SITES_RETENTION_FAILED code=RETENTION_SWEEP_FAILED$/m);
});

test("#2830 T-2.2 every way the sweep can fail classifies as non-deactivating", () => {
  const cases = [
    { label: "unexpected shape", fetchMode: "respond", body: JSON.stringify({ ok: true, data: { purged_media: 1 } }), code: "RETENTION_SWEEP_READBACK_INVALID" },
    { label: "not json", fetchMode: "respond", body: "<html>", code: "RETENTION_SWEEP_FAILED" },
    // A transport error is not a SitesOpsError; its text must never become a code.
    { label: "transport", fetchMode: "throw", body: "fetch failed planted-sentinel-0f3a", code: "RETENTION_SWEEP_FAILED" },
  ];
  for (const item of cases) {
    const result = runRetentionCli(item);
    assert.equal(result.status, 1, item.label);
    assert.deepEqual(result.classification, { code: item.code, deactivating: false }, item.label);
    assert.equal(
      /planted-sentinel/.test(readFileSync(result.classificationPath, "utf8")),
      false,
      "free text reached the classification file",
    );
    assert.match(result.stderr, new RegExp(`^SITES_RETENTION_FAILED code=${item.code}$`, "m"));
  }
});

test("#2830 T-2.2 a successful sweep writes no classification", () => {
  const result = runRetentionCli({
    fetchMode: "respond",
    body: JSON.stringify({
      ok: true,
      data: { protected_artifacts: 1, protected_media: 1, purged_artifacts: 0, purged_media: 0 },
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.classification, null);
  assert.match(result.stdout, /^SITES_RETENTION_OK purged_media=0 purged_artifacts=0$/m);
});

test("#2830 T-2.2 moved back beside the backup, a retention failure still could not deactivate", () => {
  // Belt and braces. Feed the file the real CLI wrote to the backup job's own
  // classify step, as if someone had put the sweep back where it was.
  const failed = runRetentionCli({ fetchMode: "respond", status: 503, body: "{}" });
  const { outputs } = runInlineStep(classifyStep, {
    SITES_RECOVERY_CLASSIFICATION_PATH: failed.classificationPath,
  });
  assert.deepEqual(outputs, { deactivate: "false", code: "RETENTION_SWEEP_FAILED" });
});

test("#2830 T-2.2 the outcome step turns the CLI's file into the job outputs", () => {
  const report = jobs.get("retention").steps.find((step) => step.id === "report");
  const failed = runRetentionCli({ fetchMode: "respond", status: 503, body: "{}" });
  assert.deepEqual(
    runInlineStep(report, {
      SWEEP_OUTCOME: "failure",
      SITES_RECOVERY_CLASSIFICATION_PATH: failed.classificationPath,
    }).outputs,
    { retention_outcome: "failure", retention_code: "RETENTION_SWEEP_FAILED" },
  );
  // No file (the sweep died before it could say why): still reported, by name.
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-absent-"));
  assert.deepEqual(
    runInlineStep(report, {
      SWEEP_OUTCOME: "failure",
      SITES_RECOVERY_CLASSIFICATION_PATH: join(dir, "absent.json"),
    }).outputs,
    { retention_outcome: "failure", retention_code: "RETENTION_UNCLASSIFIED" },
  );
  // A hostile or malformed code can never be written into a workflow output.
  const hostile = join(dir, "hostile.json");
  writeFileSync(hostile, JSON.stringify({ code: "X\nretention_outcome=success", deactivating: false }));
  assert.deepEqual(
    runInlineStep(report, {
      SWEEP_OUTCOME: "failure",
      SITES_RECOVERY_CLASSIFICATION_PATH: hostile,
    }).outputs,
    { retention_outcome: "failure", retention_code: "RETENTION_UNCLASSIFIED" },
  );
  assert.equal(
    runInlineStep(report, {
      SWEEP_OUTCOME: "success",
      SITES_RECOVERY_CLASSIFICATION_PATH: join(dir, "absent.json"),
    }).outputs.retention_outcome,
    "success",
  );
});

// ---------------------------------------------------------------------------
// The graph, evaluated: what runs when the sweep fails, and what still
// deactivates. (A model of GitHub's rules; see the header.)
// ---------------------------------------------------------------------------

test("#2830 SC-2.1 backup and restore succeed, the sweep fails: pilot stays up, run is green, alert fires", () => {
  const failed = runRetentionCli({ fetchMode: "respond", status: 503, body: "{}" });
  const report = jobs.get("retention").steps.find((step) => step.id === "report");
  const { results, conclusion } = simulate(jobs, scheduledBackup, (name) => {
    if (name !== "retention") return {};
    // The sweep step failed under continue-on-error, so the job is a success
    // whose outputs come from the real outcome step reading the real file.
    return {
      outputs: runInlineStep(report, {
        SWEEP_OUTCOME: "failure",
        SITES_RECOVERY_CLASSIFICATION_PATH: failed.classificationPath,
      }).outputs,
    };
  });
  assert.equal(results.backup_restore.result, "success");
  assert.equal(results.deactivate.result, "skipped", "the pilot must not be deactivated");
  assert.equal(results.alert.result, "skipped", "this is not a backup failure");
  assert.equal(results.retention.result, "success");
  assert.equal(results.housekeeping_alert.result, "success", "the failure must still be reported");
  assert.equal(results.recovery_freshness.result, "skipped");
  assert.equal(conclusion, "success", "a housekeeping failure must not red the run");
});

test("#2830 SC-2.1 a clean sweep raises no alert", () => {
  const { results, conclusion } = simulate(jobs, scheduledBackup, (name) =>
    name === "retention"
      ? { outputs: { retention_outcome: "success", retention_code: "RETENTION_UNCLASSIFIED" } }
      : {});
  assert.equal(results.retention.result, "success");
  assert.equal(results.housekeeping_alert.result, "skipped");
  assert.equal(results.deactivate.result, "skipped");
  assert.equal(conclusion, "success");
});

/** A backup job that fails, having left `classification` (or nothing) behind. */
function backupFails(writeClassification) {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-backup-"));
  const path = join(dir, "classification.json");
  writeClassification?.(path);
  const { outputs } = runInlineStep(classifyStep, { SITES_RECOVERY_CLASSIFICATION_PATH: path });
  return simulate(jobs, scheduledBackup, (name) =>
    name === "backup_restore"
      ? {
        result: "failure",
        outputs: {
          recovery_deactivate: outputs.deactivate,
          recovery_failure_code: outputs.code,
        },
      }
      : {});
}

test("#2830 SC-2.4 each of the five readiness codes still deactivates", () => {
  assert.deepEqual([...DEACTIVATING_RECOVERY_CODES].sort(), [...READINESS_VIOLATIONS].sort());
  for (const code of READINESS_VIOLATIONS) {
    const { results, conclusion } = backupFails((path) =>
      writeFileSync(path, JSON.stringify({ code, deactivating: true })));
    assert.equal(results.backup_restore.outputs.recovery_deactivate, "true", code);
    assert.equal(results.deactivate.result, "success", `${code} must still deactivate`);
    assert.equal(results.alert.result, "success", `${code} must still alert`);
    assert.equal(results.retention.result, "skipped", "no sweep without a verified snapshot");
    assert.equal(results.housekeeping_alert.result, "skipped");
    assert.equal(conclusion, "failure");
  }
});

test("#2830 SC-2.4 an absent, unreadable or malformed classification still deactivates", () => {
  const cases = [
    ["absent", null],
    ["not json", (path) => writeFileSync(path, "{")],
    ["empty", (path) => writeFileSync(path, "")],
    ["wrong types", (path) => writeFileSync(path, JSON.stringify({ code: "X", deactivating: "false" }))],
    ["missing field", (path) => writeFileSync(path, JSON.stringify({ deactivating: false }))],
  ];
  for (const [label, write] of cases) {
    const { results } = backupFails(write);
    assert.equal(results.backup_restore.outputs.recovery_failure_code, "UNCLASSIFIED", label);
    assert.equal(results.backup_restore.outputs.recovery_deactivate, "true", label);
    assert.equal(results.deactivate.result, "success", `${label} must still deactivate`);
  }
});

test("#2830 SC-2.4 a runner that died before classifying still deactivates", () => {
  // No outputs at all: the classify step never ran.
  for (const result of ["failure", "cancelled"]) {
    const { results } = simulate(jobs, scheduledBackup, (name) =>
      name === "backup_restore" ? { result, outputs: {} } : {});
    assert.equal(results.deactivate.result, "success", `backup ${result} with no output`);
    assert.equal(results.retention.result, "skipped");
  }
});

test("#2830 decision D2: a failed contract run holds the pilot up and pages (was: deactivates)", () => {
  // Slice 1 pinned the opposite here and said so in its name. Seth took
  // decision D2 on 2026-10-12: a red unit test is not a recovery fact.
  const { results } = simulate(jobs, scheduledBackup, (name) =>
    name === "contracts" ? { result: "failure" } : {});
  assert.equal(results.backup_restore.result, "skipped");
  assert.equal(results.deactivate.result, "skipped", "a red contract test must not take the site down");
  assert.equal(results.alert.result, "success", "and it is still reported on the issue");
  assert.equal(results.ops_page.result, "success", "and emailed");
  assert.equal(results.retention.result, "skipped");
  // Exclusion polarity: only the literal 'failure' holds. A cancelled
  // contracts job still deactivates, exactly as before.
  const cancelled = simulate(jobs, scheduledBackup, (name) =>
    name === "contracts" ? { result: "cancelled" } : {});
  assert.equal(cancelled.results.backup_restore.result, "skipped");
  assert.equal(cancelled.results.deactivate.result, "success");
  assert.ok(jobs.get("deactivate").condition.includes("needs.contracts.result != 'failure'"));
});

test("#2830 a classified non-readiness backup failure still holds the pilot up (#3628 unchanged)", () => {
  const { results } = backupFails((path) =>
    writeFileSync(path, JSON.stringify({ code: "S3_OBJECT_READ_FAILED", deactivating: false })));
  assert.equal(results.deactivate.result, "skipped");
  assert.equal(results.alert.result, "success");
  assert.equal(results.retention.result, "skipped");
});

test("#2830 the watchdog cron, a freshness dispatch and a pull request start no sweep and no alert", () => {
  const events = [
    { event_name: "schedule", ref: "refs/heads/main", event: { schedule: WATCHDOG_CRON } },
    { event_name: "workflow_dispatch", ref: "refs/heads/main", event: { inputs: { mode: "freshness-check" } } },
    { event_name: "pull_request", ref: "refs/pull/1/merge", event: {} },
    { event_name: "workflow_dispatch", ref: "refs/heads/some-branch", event: { inputs: { mode: "backup" } } },
  ];
  for (const github of events) {
    const { results } = simulate(jobs, github, (name) =>
      name === "retention"
        ? { outputs: { retention_outcome: "failure", retention_code: "RETENTION_SWEEP_FAILED" } }
        : {});
    for (const name of ["backup_restore", "deactivate", "alert", "retention", "housekeeping_alert"]) {
      assert.equal(results[name].result, "skipped", `${name} on ${JSON.stringify(github)}`);
    }
  }
  // A manual backup dispatch on main does run the sweep.
  const manual = simulate(
    jobs,
    { event_name: "workflow_dispatch", ref: "refs/heads/main", event: { inputs: { mode: "backup" } } },
    () => ({}),
  );
  assert.equal(manual.results.retention.result, "success");
});

// ---------------------------------------------------------------------------
// The retention job that never reports. If checkout or Node set-up fails, or
// the job hits its time limit, there is no `retention_outcome` at all. Keyed on
// the output alone, the alert would stay silent: the pilot safe, the clean-up
// not running, and nobody told.
// ---------------------------------------------------------------------------

/** The bash a step runs under `run: |`, dedented. */
function inlineBashScript(step) {
  const lines = step.text.split("\n");
  const at = lines.findIndex((line) => /^ {8}run: \|$/.test(line));
  assert.ok(at >= 0, `step ${step.name} carries a block run script`);
  return lines.slice(at + 1).map((line) => line.replace(/^ {10}/, "")).join("\n");
}

/** Runs the alert step's own bash with a stub `gh` that records its arguments. */
function runAlertStep(env) {
  const alert = jobs.get("housekeeping_alert");
  assert.equal(alert.steps.length, 1);
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-alert-"));
  const recorded = join(dir, "gh-args");
  const stub = join(dir, "gh");
  writeFileSync(stub, `#!/bin/bash\nprintf '%s\\n' "$@" > "${recorded}"\n`);
  chmodSync(stub, 0o755);
  const result = spawnSync("bash", ["-c", inlineBashScript(alert.steps[0])], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_SERVER_URL: "https://github.example",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "42",
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(recorded, "utf8").trimEnd().split("\n");
  return { args, body: args.find((arg) => arg.startsWith("body="))?.slice("body=".length) };
}

test("#2830 a retention job that fails before reporting still raises the alert, and never deactivates", () => {
  // Checkout or Node set-up failed, or the job was killed at its time limit:
  // the job result is `failure` and it published nothing.
  const { results, conclusion } = simulate(jobs, scheduledBackup, (name) =>
    name === "retention" ? { result: "failure", outputs: {} } : {});
  assert.equal(results.backup_restore.result, "success");
  assert.equal(results.retention.result, "failure");
  assert.deepEqual(results.retention.outputs, {});
  assert.equal(results.housekeeping_alert.result, "success",
    "a retention job that died without reporting must still be announced");
  assert.equal(results.deactivate.result, "skipped", "the pilot must not be deactivated");
  assert.equal(results.alert.result, "skipped", "this is not a backup failure");
  // The run IS red here, honestly: a job failed. What matters is that the
  // backup job is green (the watchdog reads that) and the site stays up.
  assert.equal(conclusion, "failure");
});

test("#2830 a cancelled or timed-out retention job raises the alert too", () => {
  // `needs.<job>.result` has four values: success, failure, cancelled,
  // skipped. There is no `timed_out`; a job stopped by `timeout-minutes`
  // surfaces as failure or cancelled, so both are covered.
  const { results } = simulate(jobs, scheduledBackup, (name) =>
    name === "retention" ? { result: "cancelled", outputs: {} } : {});
  assert.equal(results.housekeeping_alert.result, "success");
  assert.equal(results.deactivate.result, "skipped");
  assert.equal(results.alert.result, "skipped");
  const condition = jobs.get("housekeeping_alert").condition;
  assert.equal(/timed_out/.test(condition), false,
    "`timed_out` is not a value of needs.<job>.result; naming it would be a clause that can never match");
});

test("#2830 a retention job that succeeds with a clean sweep raises nothing", () => {
  const { results, conclusion } = simulate(jobs, scheduledBackup, (name) =>
    name === "retention"
      ? { result: "success", outputs: { retention_outcome: "success", retention_code: "RETENTION_UNCLASSIFIED" } }
      : {});
  assert.equal(results.housekeeping_alert.result, "skipped");
  assert.equal(results.deactivate.result, "skipped");
  assert.equal(conclusion, "success");
});

test("#2830 a skipped retention job is not a housekeeping failure", () => {
  // Retention is skipped whenever the backup did not succeed. That is the
  // backup `alert` job's story, and a second comment would only blur it.
  const { results } = simulate(jobs, scheduledBackup, (name) =>
    name === "backup_restore"
      ? { result: "failure", outputs: { recovery_deactivate: "false", recovery_failure_code: "S3_OBJECT_READ_FAILED" } }
      : {});
  assert.equal(results.retention.result, "skipped");
  assert.equal(results.housekeeping_alert.result, "skipped");
  assert.equal(results.alert.result, "success");
});

test("#2830 the alert step names a fixed code when the retention job did not report", () => {
  const silent = runAlertStep({ RETENTION_OUTCOME: "", RETENTION_CODE: "" });
  assert.deepEqual(silent.args.slice(0, 4), [
    "api", "--method", "POST", "repos/owner/repo/issues/2830/comments",
  ]);
  assert.equal(
    silent.body,
    "SITES_HOUSEKEEPING_ALERT kind=RETENTION_FAILED code=RETENTION_JOB_DID_NOT_REPORT outcome=PILOT_UNAFFECTED recovery_evidence_fresh run_url=https://github.example/owner/repo/actions/runs/42",
  );
  assert.match("RETENTION_JOB_DID_NOT_REPORT", /^[A-Z][A-Z0-9_]{2,95}$/);
  // A code left behind by a job that did not report a failed sweep is not used.
  assert.match(
    runAlertStep({ RETENTION_OUTCOME: "", RETENTION_CODE: "RETENTION_SWEEP_FAILED" }).body,
    / code=RETENTION_JOB_DID_NOT_REPORT /,
  );
  // The ordinary path is unchanged: a reported failed sweep carries its code.
  assert.equal(
    runAlertStep({ RETENTION_OUTCOME: "failure", RETENTION_CODE: "RETENTION_SWEEP_FAILED" }).body,
    "SITES_HOUSEKEEPING_ALERT kind=RETENTION_FAILED code=RETENTION_SWEEP_FAILED outcome=PILOT_UNAFFECTED recovery_evidence_fresh run_url=https://github.example/owner/repo/actions/runs/42",
  );
  assert.match(
    runAlertStep({ RETENTION_OUTCOME: "failure", RETENTION_CODE: "" }).body,
    / code=RETENTION_UNCLASSIFIED /,
  );
});

test("#2830 the expression model agrees with the conditions it was written for", () => {
  // Guards the model itself: a wrong evaluator would make every graph test
  // above vacuous.
  assert.equal(evaluate("always() && a.b != 'x'", { a: { b: "y" } }), true);
  assert.equal(evaluate("always() && a.b != 'x'", { a: { b: "x" } }), false);
  assert.equal(evaluate("a.missing != 'false'", { a: {} }), true);
  assert.equal(evaluate("a.missing == 'failure'", { a: {} }), false);
  assert.equal(evaluate("a.b == 'x' && (a.c == 'y' || a.d == 'z')", { a: { b: "x", d: "z" } }), true);
  assert.equal(evaluate("a.b == 'x' && (a.c == 'y' || a.d == 'z')", { a: { b: "x" } }), false);
  assert.equal(evaluate("a.b == '37 * * * *'", { a: { b: WATCHDOG_CRON } }), true);
  assert.throws(() => evaluate("a.b > 1", { a: { b: 2 } }), /unsupported expression syntax/);
});

// ---------------------------------------------------------------------------
// T-8.1 — the runbook says how to get the site back
// ---------------------------------------------------------------------------

test("#2830 T-8.1 the runbook documents re-activation after a deactivation", () => {
  const at = RUNBOOK.indexOf("\n## Re-activating the pilot after a deactivation\n");
  assert.ok(at >= 0, "the runbook has the re-activation section");
  const rest = RUNBOOK.slice(at + 1);
  const end = rest.indexOf("\n## ", 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  // The exact command.
  assert.match(section, /^ {3}node scripts\/sites\/activate-gogi-pilot\.mjs$/m);
  assert.ok(existsSync(join(REPO, "scripts/sites/activate-gogi-pilot.mjs")));
  // The four variables the script requires.
  for (const name of [
    "SITES_PILOT_SITE_ID",
    "SITES_CORE_BASE_URL",
    "SITES_CORE_SERVICE_ROLE_KEY",
    "SITES_CANDIDATE_PROBE_SECRET",
  ]) assert.ok(section.includes(`\`${name}\``), `runbook names ${name}`);
  // The three preconditions.
  assert.match(section, /Backup evidence is under 26 hours old/);
  assert.match(section, /restore drill is under 100 days old/);
  assert.match(section, /host is `pending`/);
  // The expected success line, and that nothing does this automatically.
  assert.match(section, /SITES_GOGI_ACTIVATED site=<site id> publication=<publication id>/);
  assert.match(section, /Nothing\s+re-activates it automatically/);
  assert.match(section, /https:\/\/gogi\.sites\.usemingla\.com\/` returns HTTP 200/);
  assert.match(section, /SITES_BACKUP_EVIDENCE_OK/);
  // Which failures deactivate, and that retention is not one of them.
  assert.match(section, /SITES_HOUSEKEEPING_ALERT/);
});

test("#2830 T-8.1 the runbook says who runs it and what is checked before activating", () => {
  const at = RUNBOOK.indexOf("\n## Re-activating the pilot after a deactivation\n");
  const rest = RUNBOOK.slice(at + 1);
  const end = rest.indexOf("\n## ", 1);
  const section = (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, " ");
  assert.match(section, /Who: whoever holds the Core service-role key\./);
  for (const phrase of [
    "What the script checks before it activates",
    "reads back `configured` with the pilot still disabled",
    "active publication is also its last successful publication",
    "carries a valid artifact digest",
    "signed candidate probe of that exact publication",
    "reads back `verified`",
    "host probe no older than 15 minutes",
    "deactivates again by itself",
  ]) assert.ok(section.includes(phrase), `runbook states: ${phrase}`);
  // Names only. No value, and no assignment form that invites pasting one.
  assert.equal(/SITES_[A-Z_]+=|eyJ[A-Za-z0-9_-]{10,}/.test(section), false);
  // Each stated check corresponds to a guard in the script.
  const script = readFileSync(join(REPO, "scripts/sites/activate-gogi-pilot.mjs"), "utf8");
  for (const guard of [
    "PILOT_CONFIGURATION_READBACK_MISMATCH",
    "PILOT_SITE_NOT_PUBLISHED",
    "PILOT_PUBLICATION_INVALID",
    "HOST_READINESS_READBACK_MISMATCH",
    "PILOT_COMMITTED_READBACK_FAILED",
  ]) assert.ok(script.includes(guard), `${guard} is still a guard in the activation script`);
});

test("#2830 T-8.1 the runbook's variable names and success line match the activation script", () => {
  const script = readFileSync(join(REPO, "scripts/sites/activate-gogi-pilot.mjs"), "utf8");
  for (const name of [
    "SITES_PILOT_SITE_ID",
    "SITES_CORE_BASE_URL",
    "SITES_CORE_SERVICE_ROLE_KEY",
    "SITES_CANDIDATE_PROBE_SECRET",
  ]) assert.ok(script.includes(`"${name}"`), `${name} is read by the activation script`);
  assert.match(script, /SITES_GOGI_ACTIVATED site=\$\{config\.siteId\} publication=\$\{publication\.id\}/);
});

// ---------------------------------------------------------------------------
// T-2.3 (slice 2) — every other way the backup job can fail says what it was
//
// Retention was one instance of a class: a step that exits non-zero having
// written no classification, which the gate reads as "deactivate". Three more
// were found (SPEC S-1, S-2) and are closed here: the private-Blob transport,
// the inline read-back digest check and the inline bundle-coordinates step. A
// fault in any of them means NEW evidence was not recorded. It proves nothing
// about the evidence already held, so it must not take the live site down.
//
// Appended to this suite, additions only. The import below is hoisted like any
// other; it sits here so no existing line of this file changes.
// ---------------------------------------------------------------------------

import { classifyRecoveryFailure as classifyRecoveryFailure2830 } from "../lib/sites-ops.mjs";
import { classifyBlobHttpStatus as classifyBlobHttpStatus2830 } from "../vercel-blob-http-transport.mjs";

const BLOB_CLI = join(REPO, "scripts/sites/vercel-blob-http-transport.mjs");
const BUNDLE_NAME_2830 = `mingla-sites-${SITE_ID}-20261012T072300Z-${"a".repeat(64)}.msbk`;
const VALID_BLOB_TOKEN = `vercel_blob_rw_${"S".repeat(16)}_${"t".repeat(24)}`;

/** The classify step, then the job graph, for a backup job that failed leaving `path`. */
function gateFor(path) {
  const { outputs } = runInlineStep(classifyStep, { SITES_RECOVERY_CLASSIFICATION_PATH: path });
  const { results } = simulate(jobs, scheduledBackup, (name) =>
    name === "backup_restore"
      ? { result: "failure", outputs: { recovery_deactivate: outputs.deactivate, recovery_failure_code: outputs.code } }
      : {});
  return { outputs, results };
}

function assertHeldUp(path, code, label) {
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { code, deactivating: false }, label);
  const { outputs, results } = gateFor(path);
  assert.deepEqual(outputs, { deactivate: "false", code }, label);
  assert.equal(results.deactivate.result, "skipped", `${label}: the pilot must stay up`);
  assert.equal(results.alert.result, "success", `${label}: and it is still reported`);
  assert.equal(results.retention.result, "skipped", `${label}: no sweep without a verified snapshot`);
}

function runBlobCli(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-blob-"));
  const classificationPath = join(dir, "classification.json");
  const result = spawnSync(process.execPath, [BLOB_CLI, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SITES_RECOVERY_CLASSIFICATION_PATH: classificationPath, ...env },
  });
  return { ...result, dir, classificationPath };
}

test("#2830 T-2.3 the five readiness codes classify true, and nothing else does", () => {
  for (const code of READINESS_VIOLATIONS) {
    assert.deepEqual(classifyRecoveryFailure2830(code), { code, deactivating: true });
  }
  assert.equal(DEACTIVATING_RECOVERY_CODES.size, 5, "slice 2 adds no deactivating code");
  for (const code of [
    "PRIVATE_READBACK_DIGEST_MISMATCH", "BACKUP_RESULT_UNREADABLE", "BACKUP_BUNDLE_COORDINATES_INVALID",
    "PRIVATE_NETWORK_FAILED", "PRIVATE_UNEXPECTED_FAILURE",
  ]) assert.equal(classifyRecoveryFailure2830(code).deactivating, false, code);
});

test("#2830 T-2.3 (S-1) a failing private-Blob transport classifies itself as non-deactivating", () => {
  const pathname = `recovery/sites/${BUNDLE_NAME_2830}`;
  const cases = [
    // No credential: refused before any network call.
    ["PRIVATE_CREDENTIAL_MISSING", ["put", "/nonexistent/bundle", pathname, "/nonexistent/meta"], {}],
    // A path that is not an immutable bundle path.
    ["PRIVATE_PATH_REJECTED", ["get", "recovery/sites/../../etc/passwd", "/nonexistent/out", "/nonexistent/meta"], { BLOB_READ_WRITE_TOKEN: VALID_BLOB_TOKEN }],
    // The bundle to upload is not there.
    ["PRIVATE_INPUT_UNREADABLE", ["put", "/nonexistent/bundle", pathname, "/nonexistent/meta"], { BLOB_READ_WRITE_TOKEN: VALID_BLOB_TOKEN }],
    // Read-back with no upload record to read back against.
    ["PRIVATE_UPLOAD_METADATA_MISSING", ["get", pathname, "/nonexistent/out", "/nonexistent/meta"], { BLOB_READ_WRITE_TOKEN: VALID_BLOB_TOKEN }],
    ["PRIVATE_OPERATION_INVALID", ["delete", pathname], { BLOB_READ_WRITE_TOKEN: VALID_BLOB_TOKEN }],
  ];
  for (const [code, args, env] of cases) {
    const run = runBlobCli(args, env);
    assert.equal(run.status, 1, code);
    assert.equal(run.stderr.trim(), `SITES_BLOB_ERROR code=${code}`, "the log line is unchanged");
    assert.ok(!run.stderr.includes(VALID_BLOB_TOKEN) && !run.stdout.includes(VALID_BLOB_TOKEN));
    assertHeldUp(run.classificationPath, code, code);
  }
});

test("#2830 T-2.3 (S-1) no status the Blob provider can answer with is a readiness violation", () => {
  const codes = new Set();
  for (let status = 100; status <= 599; status += 1) codes.add(classifyBlobHttpStatus2830(status));
  assert.ok(codes.size >= 8, "the whole status table was walked");
  for (const code of codes) {
    assert.match(code, /^PRIVATE_[A-Z_]+$/);
    assert.equal(classifyRecoveryFailure2830(code).deactivating, false, code);
  }
  // Outside the backup job the transport stays a plain CLI: no file, no throw.
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-blob-noenv-"));
  const run = spawnSync(process.execPath, [BLOB_CLI, "put", "x", "y", "z"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
    cwd: dir,
  });
  assert.equal(run.status, 1);
  assert.equal(run.stderr.trim(), "SITES_BLOB_ERROR code=PRIVATE_CREDENTIAL_MISSING");
});

/** The read-back step's own bash, with `node` and `sha256sum` replaced by stubs. */
function runReadbackStep({ actual, expected }) {
  const step = backup.steps.find((candidate) => candidate.id === "readback");
  assert.ok(step, "the read-back step exists");
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-readback-"));
  const stubs = join(dir, "bin");
  spawnSync("mkdir", ["-p", stubs, join(dir, "sites-backup")]);
  // The transport itself "succeeds": this test is about what follows it.
  writeFileSync(join(stubs, "node"), "#!/bin/bash\nexit 0\n");
  writeFileSync(join(stubs, "sha256sum"), `#!/bin/bash\nprintf '%s  %s\\n' "${actual}" "$1"\n`);
  chmodSync(join(stubs, "node"), 0o755);
  chmodSync(join(stubs, "sha256sum"), 0o755);
  const classificationPath = join(dir, "classification.json");
  const outputPath = join(dir, "github-output");
  writeFileSync(outputPath, "");
  const result = spawnSync("bash", ["-c", inlineBashScript(step)], {
    encoding: "utf8",
    env: {
      PATH: `${stubs}:${process.env.PATH}`,
      RUNNER_TEMP: dir,
      BUNDLE_NAME: BUNDLE_NAME_2830,
      EXPECTED_SHA256: expected,
      GITHUB_OUTPUT: outputPath,
      SITES_RECOVERY_CLASSIFICATION_PATH: classificationPath,
    },
  });
  return { ...result, classificationPath, output: readFileSync(outputPath, "utf8") };
}

test("#2830 T-2.3 (S-2) a read-back digest mismatch is classified, and holds the pilot up", () => {
  const mismatch = runReadbackStep({ actual: "1".repeat(64), expected: "2".repeat(64) });
  assert.equal(mismatch.status, 1, "a mismatch still fails the step: no evidence is recorded");
  assert.match(mismatch.stderr, /^SITES_BLOB_ERROR code=PRIVATE_READBACK_DIGEST_MISMATCH$/m);
  assert.equal(mismatch.output, "", "no verified_at is published for a bundle that did not verify");
  assertHeldUp(mismatch.classificationPath, "PRIVATE_READBACK_DIGEST_MISMATCH", "digest mismatch");

  const match = runReadbackStep({ actual: "3".repeat(64), expected: "3".repeat(64) });
  assert.equal(match.status, 0, match.stderr);
  assert.equal(existsSync(match.classificationPath), false, "a verified read-back writes no classification");
  assert.match(match.output, /^verified_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n$/);
});

function runBundleStep(resultFile) {
  const step = backup.steps.find((candidate) => candidate.id === "bundle");
  assert.ok(step, "the bundle step exists");
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-bundle-"));
  const resultPath = join(dir, "result.json");
  if (resultFile !== undefined) writeFileSync(resultPath, resultFile);
  const classificationPath = join(dir, "classification.json");
  const outputPath = join(dir, "github-output");
  writeFileSync(outputPath, "");
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: inlineNodeScript(step),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SITES_BACKUP_RESULT_PATH: resultPath,
      GITHUB_OUTPUT: outputPath,
      SITES_RECOVERY_CLASSIFICATION_PATH: classificationPath,
    },
  });
  return { ...result, classificationPath, output: readFileSync(outputPath, "utf8") };
}

test("#2830 T-2.3 (S-2) a bundle result the step cannot use is classified, and holds the pilot up", () => {
  const sha = "b".repeat(64);
  const cases = [
    ["BACKUP_RESULT_UNREADABLE", undefined],
    ["BACKUP_RESULT_UNREADABLE", "{"],
    ["BACKUP_BUNDLE_COORDINATES_INVALID", "null"],
    ["BACKUP_BUNDLE_COORDINATES_INVALID", JSON.stringify({ bundle_name: "../../etc/passwd", bundle_sha256: sha })],
    ["BACKUP_BUNDLE_COORDINATES_INVALID", JSON.stringify({ bundle_name: `${BUNDLE_NAME_2830}\nname=evil`, bundle_sha256: sha })],
    ["BACKUP_BUNDLE_COORDINATES_INVALID", JSON.stringify({ bundle_name: BUNDLE_NAME_2830, bundle_sha256: "short" })],
    ["BACKUP_BUNDLE_COORDINATES_INVALID", JSON.stringify({ bundle_name: BUNDLE_NAME_2830 })],
  ];
  for (const [code, file] of cases) {
    const run = runBundleStep(file);
    const label = `${code} <- ${String(file).slice(0, 40)}`;
    assert.equal(run.status, 1, label);
    assert.equal(run.output, "", `${label}: no coordinates are published`);
    assert.equal(run.stderr.trim(), `SITES_OPS_ERROR code=${code}`, label);
    assertHeldUp(run.classificationPath, code, label);
  }
  const good = runBundleStep(JSON.stringify({ bundle_name: BUNDLE_NAME_2830, bundle_sha256: sha }));
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.output, `name=${BUNDLE_NAME_2830}\nsha256=${sha}\n`);
  assert.equal(existsSync(good.classificationPath), false);
});

test("#2830 T-2.3 every step of the backup job that can fail leaves a classification", () => {
  // The rule the invariant states. A step is either a pinned action, a shell
  // step that cannot fail on data (the client symlinks), an inline step that
  // writes the classification itself, or a node entrypoint that does.
  const selfClassifying = new Map([
    ["scripts/sites/backup-sites-cms.mjs", /\.catch\(safeCliFailure\)/],
    ["scripts/sites/restore-sites-cms.mjs", /\.catch\(safeCliFailure\)/],
    ["scripts/sites/vercel-blob-http-transport.mjs", /recordRecoveryFailureClassification\(code\)/],
  ]);
  const seen = new Set();
  for (const step of backup.steps) {
    if (step.id === "classify" || /^ {6}- uses: /m.test(step.text)) continue;
    const entrypoints = [...step.text.matchAll(/node (scripts\/sites\/[a-z0-9-]+\.mjs)/g)].map((match) => match[1]);
    for (const entrypoint of entrypoints) {
      assert.ok(selfClassifying.has(entrypoint), `${entrypoint} is a known self-classifying entrypoint`);
      assert.match(readFileSync(join(REPO, entrypoint), "utf8"), selfClassifying.get(entrypoint), entrypoint);
      seen.add(entrypoint);
    }
    const inlineExit = /exit 1|process\.exit\(1\)/.test(step.text);
    if (inlineExit) {
      assert.match(step.text, /SITES_RECOVERY_CLASSIFICATION_PATH/,
        `step "${step.name}" exits non-zero inline and must write its classification first`);
    }
    assert.ok(
      entrypoints.length > 0 || inlineExit || step.name === "Expose pinned PostgreSQL 17 clients",
      `step "${step.name}" is accounted for`,
    );
  }
  assert.deepEqual([...seen].sort(), [...selfClassifying.keys()].sort());
  assert.match(backup.head, /SITES_RECOVERY_CLASSIFICATION_PATH: \$\{\{ github\.workspace \}\}\/sites-recovery-classification\.json/);
});

test("#2830 F-8 only a code-shaped value leaves the classify step, and the verdict is untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-f8-"));
  const path = join(dir, "classification.json");
  for (const hostile of ["x", "lower_case", "A B", "OK\ndeactivate=false", "::set-output name=x::y", "$(id)", "A".repeat(200)]) {
    for (const deactivating of [true, false]) {
      writeFileSync(path, JSON.stringify({ code: hostile, deactivating }));
      const { outputs, stdout } = runInlineStep(classifyStep, { SITES_RECOVERY_CLASSIFICATION_PATH: path });
      assert.deepEqual(
        outputs,
        { deactivate: String(deactivating), code: "UNCLASSIFIED" },
        `${JSON.stringify(hostile)} deactivating=${deactivating}`,
      );
      assert.equal(stdout, `SITES_RECOVERY_CLASSIFICATION code=UNCLASSIFIED deactivate=${deactivating}\n`);
    }
  }
  // Every real code still passes through unchanged.
  for (const code of [...READINESS_VIOLATIONS, "S3_OBJECT_READ_FAILED", "PRIVATE_READBACK_DIGEST_MISMATCH", "UNEXPECTED_FAILURE"]) {
    const verdict = classifyRecoveryFailure2830(code);
    writeFileSync(path, JSON.stringify(verdict));
    assert.equal(runInlineStep(classifyStep, { SITES_RECOVERY_CLASSIFICATION_PATH: path }).outputs.code, code);
  }
});

// ---------------------------------------------------------------------------
// Tester findings F-5 and F-7 (slice 2) — the retention runner cannot hang
// past its job, and prints only a vetted code
// ---------------------------------------------------------------------------

import {
  RETENTION_REQUEST_TIMEOUT_MS as RETENTION_REQUEST_TIMEOUT_MS_2830,
  runSitesRetention as runSitesRetention2830,
} from "../run-sites-retention.mjs";

test("#2830 F-7 the retention runner prints one vetted code, never the error as given", () => {
  const freeText = "connect ECONNREFUSED 10.0.0.7:443 token=abc";
  const thrown = runRetentionCli({ fetchMode: "throw", body: freeText });
  assert.equal(thrown.status, 1);
  assert.equal(
    thrown.stderr,
    '{"ok":false,"error":"RETENTION_SWEEP_FAILED"}\nSITES_RETENTION_FAILED code=RETENTION_SWEEP_FAILED\n',
  );
  assert.equal(thrown.stderr.includes("ECONNREFUSED"), false);
  // A code the script raised itself still comes through on both lines.
  const own = runRetentionCli({ origin: "https://evil.invalid" });
  assert.equal(
    own.stderr,
    '{"ok":false,"error":"CMS_ORIGIN_MISMATCH"}\nSITES_RETENTION_FAILED code=CMS_ORIGIN_MISMATCH\n',
  );
});

test("#2830 F-5 the sweep request carries a time limit shorter than the job's", async () => {
  const retention = jobs.get("retention");
  const jobMinutes = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(retention.head)[1]);
  assert.ok(RETENTION_REQUEST_TIMEOUT_MS_2830 < jobMinutes * 60 * 1000,
    "a hung sweep must fail as a sweep before the job is killed");
  assert.ok(RETENTION_REQUEST_TIMEOUT_MS_2830 >= 5 * 60 * 1000, "and a slow, healthy sweep is not cut short");
  const env = {
    SITES_PILOT_SITE_ID: SITE_ID,
    SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
    MINGLA_CORE_TO_CMS_CURRENT_KID: "core-key-v1",
    MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: Buffer.alloc(32, 4).toString("base64"),
  };
  let seen;
  await assert.rejects(() => runSitesRetention2830({
    env,
    fetchImpl: async (_url, init) => {
      seen = init;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
  }), { name: "TimeoutError" });
  assert.ok(seen.signal instanceof AbortSignal, "the request is abortable");
  assert.equal(seen.signal.aborted, false);
});
