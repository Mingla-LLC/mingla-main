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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("#2830 a failed contract run still deactivates (unchanged; decision D2 is not taken here)", () => {
  const { results } = simulate(jobs, scheduledBackup, (name) =>
    name === "contracts" ? { result: "failure" } : {});
  assert.equal(results.backup_restore.result, "skipped");
  assert.equal(results.deactivate.result, "success");
  assert.equal(results.retention.result, "skipped");
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
