/**
 * Issue #2830, slice 1 — TESTER adversarial suite.
 *
 * The implementor's suite pins the shape of the job graph and walks the named
 * cases (sweep fails, five codes, absent classification, watchdog cron). This
 * file attacks two axes that suite does not:
 *
 *   1. THE WHOLE CROSS-PRODUCT. Every event x contracts result x backup result
 *      x classification output x retention job result x published sweep outcome
 *      x deactivation result is evaluated, and six properties are checked on
 *      every row: housekeeping never deactivates, a real recovery failure still
 *      does, the sweep only ever follows a verified backup, a failure is never
 *      silent, the two alerts never both fire, and the watchdog / pull-request /
 *      off-main routings start nothing. The evaluator here is written
 *      independently of the implementor's (recursive descent, GitHub's
 *      loose-equality and case-insensitive string rules), so an error common to
 *      both would have to be made twice.
 *
 *      The checker is then pointed at deliberately broken graphs and must report
 *      each one. A checker that cannot see a broken graph proves nothing about a
 *      working one.
 *
 *   2. INJECTION. Each inline script the two new jobs run is taken out of the
 *      YAML and executed the way the runner executes it (`bash -eo pipefail`),
 *      against hostile input: a classification file whose code carries a
 *      newline and a forged `retention_outcome=success`, a workflow command, a
 *      multi-megabyte string, the wrong types; a step outcome that is not one
 *      of the four GitHub defines; an alert code carrying shell metacharacters.
 *
 * This is a MODEL of GitHub's `needs:` / `if:` rules, not GitHub. What only a
 * real run can prove is listed in the tester's verdict on the issue.
 *
 * The workflow is read from disk by name, so this file is a declared reference
 * file of that workflow (validate-manifest-v2.mjs and MANIFEST.json).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const WORKFLOW_TEXT = readFileSync(
  join(REPO, ".github/workflows/sites-backup-restore.yml"),
  "utf8",
);
const RETENTION_CLI = join(REPO, "scripts/sites/run-sites-retention.mjs");
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/;

// ---------------------------------------------------------------------------
// Reading the workflow. Indentation is the grammar; block scalars are taken
// whole before anything else looks at their lines, so a `#` inside a script is
// never mistaken for a YAML comment.
// ---------------------------------------------------------------------------

const indentOf = (line) => line.length - line.trimStart().length;

/** Lines that belong to the node opened at `start` (deeper, or blank). */
function childLines(lines, start, parentIndent) {
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim() !== "" && indentOf(lines[i]) <= parentIndent) break;
    out.push(lines[i]);
  }
  return out;
}

function scalar(lines, index, indent) {
  const raw = lines[index].slice(lines[index].indexOf(":") + 1).trim();
  const body = childLines(lines, index + 1, indent);
  if (raw === "|") {
    const depth = Math.min(...body.filter((l) => l.trim()).map(indentOf));
    return { value: body.map((l) => l.slice(depth)).join("\n"), consumed: body.length };
  }
  if (raw === ">-" || raw === ">") {
    return { value: body.map((l) => l.trim()).filter(Boolean).join(" "), consumed: body.length };
  }
  return { value: raw.replace(/^"(.*)"$/, "$1"), consumed: 0 };
}

function readMapping(lines, indent) {
  const map = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (indentOf(line) !== indent) continue;
    const key = line.trim().match(/^([A-Za-z_][\w-]*):/)?.[1];
    if (!key) continue;
    const rest = line.slice(line.indexOf(":") + 1).trim();
    if (rest === "") {
      map[key] = { block: childLines(lines, i + 1, indent) };
      i += map[key].block.length;
    } else {
      const { value, consumed } = scalar(lines, i, indent);
      map[key] = value;
      i += consumed;
    }
  }
  return map;
}

function readSteps(block) {
  const steps = [];
  for (let i = 0; i < block.length; i += 1) {
    if (!/^ {6}- /.test(block[i])) continue;
    const body = [`        ${block[i].slice(8)}`, ...childLines(block, i + 1, 6)];
    const step = readMapping(body, 8);
    step.envKeys = step.env?.block
      ? Object.keys(readMapping(step.env.block, 10))
      : [];
    steps.push(step);
    i += body.length - 1;
  }
  return steps;
}

function readWorkflow(text) {
  const lines = text.split("\n");
  const start = lines.indexOf("jobs:");
  assert.ok(start > 0, "the workflow has a jobs: block");
  const jobs = {};
  const order = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const id = lines[i].match(/^ {2}([a-z_]+):\s*$/)?.[1];
    if (!id) continue;
    const body = childLines(lines, i + 1, 2);
    const map = readMapping(body, 4);
    const needs = typeof map.needs === "string"
      ? map.needs.replace(/[[\]]/g, "").split(",").map((n) => n.trim()).filter(Boolean)
      : [];
    jobs[id] = {
      id,
      needs,
      if: typeof map.if === "string" ? map.if : null,
      environment: typeof map.environment === "string" ? map.environment : null,
      permissions: map.permissions?.block
        ? readMapping(map.permissions.block, 6)
        : null,
      outputs: map.outputs?.block ? readMapping(map.outputs.block, 6) : {},
      steps: map.steps?.block ? readSteps(map.steps.block) : [],
      raw: body.join("\n"),
    };
    order.push(id);
    i += body.length;
  }
  return { jobs, order };
}

// ---------------------------------------------------------------------------
// GitHub expression evaluation, written from the documented rules:
//   - a missing property is null; null, false, 0 and '' are falsy;
//   - `==` / `!=` are loose: differing types are coerced to numbers (null -> 0,
//     '' -> 0, any other non-numeric string -> NaN) and NaN equals nothing;
//   - string comparison ignores case;
//   - `&&` / `||` return an operand, as in JavaScript.
// ---------------------------------------------------------------------------

function lex(source) {
  const tokens = [];
  const re = /\s*(?:(&&|\|\||==|!=|!|\(|\))|'((?:[^']|'')*)'|([A-Za-z_][\w.-]*))/y;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    re.lastIndex = index;
    const m = re.exec(source);
    assert.ok(m, `unreadable expression at ${index}: ${source.slice(index, index + 30)}`);
    if (m[1]) tokens.push({ t: "op", v: m[1] });
    else if (m[2] !== undefined) tokens.push({ t: "str", v: m[2].replaceAll("''", "'") });
    else tokens.push({ t: "id", v: m[3] });
    index = re.lastIndex;
  }
  return tokens;
}

const truthy = (v) => !(v === null || v === false || v === 0 || v === "" || Number.isNaN(v));
function toNumber(v) {
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return v.trim() === "" ? 0 : Number(v);
  return v;
}
function looseEqual(a, b) {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (typeof a === typeof b && a !== null && b !== null) return a === b;
  if (a === null && b === null) return true;
  const x = toNumber(a);
  const y = toNumber(b);
  return !Number.isNaN(x) && !Number.isNaN(y) && x === y;
}

const STATUS_FUNCTIONS = ["always", "success", "failure", "cancelled"];

function evaluate(source, context, status) {
  const tokens = lex(source);
  let p = 0;
  const peek = (v) => tokens[p]?.t === "op" && tokens[p].v === v;
  function primary() {
    const token = tokens[p];
    assert.ok(token, `expression ended early: ${source}`);
    p += 1;
    if (token.t === "str") return token.v;
    if (token.t === "op" && token.v === "(") {
      const v = or();
      assert.ok(peek(")"), `missing ) in ${source}`);
      p += 1;
      return v;
    }
    assert.equal(token.t, "id", `unexpected ${token.v} in ${source}`);
    if (peek("(")) {
      assert.ok(STATUS_FUNCTIONS.includes(token.v), `unmodelled function ${token.v}()`);
      p += 1;
      assert.ok(peek(")"), `${token.v}() takes no argument here`);
      p += 1;
      return status[token.v];
    }
    if (token.v === "true") return true;
    if (token.v === "false") return false;
    if (token.v === "null") return null;
    let value = context;
    for (const part of token.v.split(".")) {
      value = value !== null && typeof value === "object" && Object.hasOwn(value, part)
        ? value[part]
        : null;
    }
    return value === undefined ? null : value;
  }
  function unary() {
    if (peek("!")) {
      p += 1;
      return !truthy(unary());
    }
    return primary();
  }
  function equality() {
    const left = unary();
    if (peek("==")) { p += 1; return looseEqual(left, unary()); }
    if (peek("!=")) { p += 1; return !looseEqual(left, unary()); }
    return left;
  }
  function and() {
    let left = equality();
    while (peek("&&")) { p += 1; const right = equality(); left = truthy(left) ? right : left; }
    return left;
  }
  function or() {
    let left = and();
    while (peek("||")) { p += 1; const right = and(); left = truthy(left) ? left : right; }
    return left;
  }
  const value = or();
  assert.equal(p, tokens.length, `trailing tokens in ${source}`);
  return truthy(value);
}

/**
 * One run of the graph. `own[job]` is how a job ends IF it runs; `outputs[job]`
 * is what it publishes IF it runs. A job that does not run is `skipped` and
 * publishes nothing. A job whose `if:` names no status function gets GitHub's
 * implicit `success() &&`.
 */
function simulate(workflow, github, own, outputs = {}) {
  const needsContext = {};
  const result = {};
  for (const id of workflow.order) {
    const job = workflow.jobs[id];
    for (const need of job.needs) {
      assert.ok(need in result, `${id} needs ${need}, which must be declared earlier`);
    }
    const needed = job.needs.map((need) => result[need]);
    const status = {
      always: true,
      success: needed.every((r) => r === "success"),
      failure: needed.some((r) => r === "failure"),
      cancelled: false,
    };
    const context = {
      github,
      needs: Object.fromEntries(job.needs.map((need) => [need, needsContext[need]])),
    };
    const expression = job.if ?? "success()";
    const guarded = STATUS_FUNCTIONS.some((fn) => expression.includes(`${fn}(`))
      ? expression
      : `success() && (${expression})`;
    const runs = evaluate(guarded, context, status);
    result[id] = runs ? (own[id] ?? "success") : "skipped";
    needsContext[id] = { result: result[id], outputs: runs ? (outputs[id] ?? {}) : {} };
  }
  return result;
}

function runConclusion(result) {
  const values = Object.values(result);
  if (values.includes("failure")) return "failure";
  if (values.includes("cancelled")) return "cancelled";
  return "success";
}

// ---------------------------------------------------------------------------
// The cross-product and the six properties.
// ---------------------------------------------------------------------------

const MAIN = "refs/heads/main";
const EVENTS = [
  { label: "backup cron 07:23", production: true, github: { event_name: "schedule", ref: MAIN, event: { schedule: "23 7 * * *" } } },
  { label: "backup cron 19:23", production: true, github: { event_name: "schedule", ref: MAIN, event: { schedule: "23 19 * * *" } } },
  { label: "dispatch mode=backup on main", production: true, github: { event_name: "workflow_dispatch", ref: MAIN, event: { inputs: { mode: "backup" } } } },
  { label: "watchdog cron", watchdog: true, github: { event_name: "schedule", ref: MAIN, event: { schedule: "37 * * * *" } } },
  { label: "dispatch mode=freshness-check", watchdog: true, github: { event_name: "workflow_dispatch", ref: MAIN, event: { inputs: { mode: "freshness-check" } } } },
  { label: "dispatch mode=backup off main", github: { event_name: "workflow_dispatch", ref: "refs/heads/some-branch", event: { inputs: { mode: "backup" } } } },
  { label: "pull request", github: { event_name: "pull_request", ref: "refs/pull/1/merge", event: {} } },
];
const JOB_ENDS = ["success", "failure", "cancelled"];
const CLASSIFY_OUTPUTS = [undefined, "true", "false"];
const SWEEP_OUTPUTS = [undefined, "success", "failure", "cancelled", "skipped"];
const PRODUCTION_SIDE = ["backup_restore", "deactivate", "alert", "retention", "housekeeping_alert"];

/** Every violated property across the whole cross-product, as readable lines. */
function violations(workflow) {
  const found = [];
  let rows = 0;
  for (const event of EVENTS) {
    for (const contracts of JOB_ENDS) {
      for (const backup of JOB_ENDS) {
        for (const classify of CLASSIFY_OUTPUTS) {
          for (const retention of JOB_ENDS) {
            for (const sweep of SWEEP_OUTPUTS) {
              for (const deactivate of JOB_ENDS) {
                rows += 1;
                const r = simulate(
                  workflow,
                  event.github,
                  { contracts, backup_restore: backup, retention, deactivate },
                  {
                    backup_restore: classify === undefined ? {} : { recovery_deactivate: classify },
                    retention: sweep === undefined ? {} : { retention_outcome: sweep },
                  },
                );
                const where = `[${event.label} | contracts=${contracts} backup=${backup} classify=${classify} retention=${retention} sweep=${sweep} deactivate=${deactivate}]`;
                const say = (property) => found.push(`${property} ${where} -> ${JSON.stringify(r)}`);

                if (!event.production) {
                  // P6 — the watchdog, a pull request and an off-main dispatch
                  // start nothing with a production side effect.
                  if (PRODUCTION_SIDE.some((id) => r[id] !== "skipped")) say("P6 non-production routing started a production job");
                  const wantWatchdog = event.watchdog ? "success" : "skipped";
                  if (r.recovery_freshness !== wantWatchdog) say("P6 watchdog routing");
                  continue;
                }
                if (r.recovery_freshness !== "skipped") say("P6 a backup run also ran the watchdog");

                const backupResult = r.backup_restore;
                // P1 — HOUSEKEEPING NEVER DEACTIVATES. With the backup job
                // green, nothing retention does or fails to do reaches it.
                if (backupResult === "success" && r.deactivate !== "skipped") say("P1 pilot deactivated although the backup job succeeded");
                // P2 — A REAL RECOVERY FAILURE STILL DEACTIVATES. Only the
                // literal 'false' holds the site up.
                if (backupResult !== "success" && classify !== "false" && r.deactivate === "skipped") say("P2 unproven-safe backup failure did not deactivate");
                if (backupResult !== "success" && r.backup_restore !== "skipped" && classify === "false" && r.deactivate !== "skipped") say("P2 a positively classified non-readiness failure deactivated (#3628)");
                // P3 — the sweep only ever follows a verified backup.
                if ((r.retention !== "skipped") !== (backupResult === "success")) say("P3 sweep did not track a verified backup");
                // P4 — A HOUSEKEEPING FAILURE IS NEVER SILENT. Whether it was
                // reported (outcome=failure) or the job died first.
                const sweepRan = r.retention !== "skipped";
                const housekeepingFailed = sweepRan && (r.retention !== "success" || sweep === "failure");
                if (housekeepingFailed && r.housekeeping_alert === "skipped") say("P4 housekeeping failed and nothing was said");
                if (sweepRan && r.retention === "success" && sweep === "success" && r.housekeeping_alert !== "skipped") say("P4 a clean sweep raised an alert");
                if (!sweepRan && r.housekeeping_alert !== "skipped") say("P4 housekeeping alert with no sweep");
                // P5 — a recovery failure is never silent, and the two alerts
                // never both fire for one run.
                if ((backupResult !== "success" || r.deactivate === "failure") && r.alert === "skipped") say("P5 recovery failure and no alert");
                if (r.alert !== "skipped" && r.housekeeping_alert !== "skipped") say("P5 both alerts fired");
              }
            }
          }
        }
      }
    }
  }
  return { found, rows };
}

const WORKFLOW = readWorkflow(WORKFLOW_TEXT);

function brokenCopy(change) {
  const copy = readWorkflow(WORKFLOW_TEXT);
  change(copy.jobs);
  return copy;
}

const EXCLUSIONS = "github.event_name != 'pull_request' && github.ref == 'refs/heads/main' && " +
  "github.event.schedule != '37 * * * *' && github.event.inputs.mode != 'freshness-check'";

test("#2830 tester: the reader sees the six jobs and their real conditions", () => {
  assert.deepEqual(WORKFLOW.order, [
    "contracts", "backup_restore", "deactivate", "alert",
    "retention", "housekeeping_alert", "recovery_freshness",
    // #2830 slice 2 (additions only): the paging job, appended after every job
    // this suite reasons about, so the order above is unchanged.
    "ops_page",
  ]);
  assert.deepEqual(WORKFLOW.jobs.deactivate.needs, ["contracts", "backup_restore"]);
  assert.deepEqual(WORKFLOW.jobs.alert.needs, ["contracts", "backup_restore", "deactivate"]);
  assert.deepEqual(WORKFLOW.jobs.retention.needs, ["backup_restore"]);
  assert.deepEqual(WORKFLOW.jobs.housekeeping_alert.needs, ["backup_restore", "retention"]);
  for (const id of ["deactivate", "alert", "retention", "housekeeping_alert"]) {
    assert.match(WORKFLOW.jobs[id].if, /^always\(\) &&/, `${id} is read with its real condition`);
  }
  assert.equal(WORKFLOW.jobs.contracts.if, null);
});

test("#2830 tester: the evaluator follows GitHub's comparison rules, not JavaScript's", () => {
  const status = { always: true, success: true, failure: false, cancelled: false };
  const ctx = { needs: { a: { result: "success", outputs: { flag: "FALSE", empty: "" } } }, github: { event: {} } };
  const on = (expression) => evaluate(expression, ctx, status);
  assert.equal(on("needs.a.outputs.missing != 'false'"), true, "an unset output is not 'false'");
  assert.equal(on("needs.a.outputs.missing == ''"), true, "null and '' both coerce to 0");
  assert.equal(on("needs.a.outputs.flag == 'false'"), true, "string comparison ignores case");
  assert.equal(on("github.event.schedule != '37 * * * *'"), true, "a missing schedule is not the watchdog cron");
  assert.equal(on("github.event.inputs.mode == 'freshness-check'"), false);
  assert.equal(on("needs.a.result == 'success' && (needs.a.outputs.empty == 'x' || always())"), true);
  assert.equal(on("!(needs.a.result == 'success')"), false);
  assert.throws(() => on("hashFiles() == 'x'"), /unmodelled function/, "an unknown function is refused, not guessed");
});

test("#2830 tester: over the whole cross-product no housekeeping state deactivates, no failure is silent", () => {
  const { found, rows } = violations(WORKFLOW);
  assert.equal(rows, 7 * 3 * 3 * 3 * 3 * 5 * 3, "the cross-product is the size it claims to be");
  assert.deepEqual(found.slice(0, 10), [], `${found.length} violated rows`);
});

test("#2830 tester: the checker reports a graph where a failed sweep can deactivate the pilot", () => {
  const broken = brokenCopy((jobs) => {
    jobs.deactivate.needs = ["contracts", "backup_restore", "retention"];
    jobs.deactivate.if = `always() && ${EXCLUSIONS} && ` +
      "(needs.backup_restore.result != 'success' || needs.retention.result != 'success') && " +
      "needs.backup_restore.outputs.recovery_deactivate != 'false'";
    // `deactivate` must come after what it needs.
  });
  broken.order = ["contracts", "backup_restore", "retention", "deactivate", "alert", "housekeeping_alert", "recovery_freshness"];
  const { found } = violations(broken);
  assert.ok(found.some((line) => line.startsWith("P1 ")), "P1 must fire");
});

test("#2830 tester: the checker reports a graph where a dead retention job says nothing", () => {
  // The slice as first written (5c3379076): only the reported outcome alerts.
  const broken = brokenCopy((jobs) => {
    jobs.housekeeping_alert.if = `always() && ${EXCLUSIONS} && ` +
      "needs.retention.outputs.retention_outcome == 'failure'";
  });
  const { found } = violations(broken);
  assert.ok(found.length > 0 && found.every((line) => line.startsWith("P4 ")), "only P4 fires");
  assert.ok(found.some((line) => line.includes("retention=cancelled")), "a cancelled or timed-out job is among them");
  assert.ok(found.some((line) => line.includes("retention=failure")), "a failed job is among them");
});

test("#2830 tester: the checker reports a graph that loosens the real deactivation gate", () => {
  const holdsEverything = brokenCopy((jobs) => {
    jobs.deactivate.if = `always() && ${EXCLUSIONS} && ` +
      "needs.backup_restore.result != 'success' && " +
      "needs.backup_restore.outputs.recovery_deactivate == 'true'";
  });
  assert.ok(violations(holdsEverything).found.some((line) => line.startsWith("P2 unproven-safe")));
  const deactivatesEverything = brokenCopy((jobs) => {
    jobs.deactivate.if = `always() && ${EXCLUSIONS} && needs.backup_restore.result != 'success'`;
  });
  assert.ok(violations(deactivatesEverything).found.some((line) => line.includes("(#3628)")));
});

test("#2830 tester: the checker reports a sweep that runs without a verified backup", () => {
  const broken = brokenCopy((jobs) => {
    jobs.retention.if = `always() && ${EXCLUSIONS}`;
  });
  assert.ok(violations(broken).found.some((line) => line.startsWith("P3 ")));
});

test("#2830 tester: the checker reports a housekeeping job that fires on the hourly watchdog", () => {
  const broken = brokenCopy((jobs) => {
    jobs.retention.if = "always()";
    jobs.housekeeping_alert.if = "always() && needs.retention.result != 'success'";
  });
  assert.ok(violations(broken).found.some((line) => line.startsWith("P6 ")));
});

// ---------------------------------------------------------------------------
// The inline scripts, executed as the runner executes them.
// ---------------------------------------------------------------------------

const NODE_DIR = dirname(process.execPath);

function stepOf(jobId, predicate) {
  const step = WORKFLOW.jobs[jobId].steps.find(predicate);
  assert.ok(step, `step not found in ${jobId}`);
  assert.equal(typeof step.run, "string", "the step has a run: block");
  return step;
}

function runStep(step, env, { stubGh = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-tester-"));
  const script = join(dir, "step.sh");
  writeFileSync(script, step.run);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const ghArgs = join(dir, "gh-args");
  if (stubGh) {
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env bash\nprintf '%s\\0' "$@" > '${ghArgs}'\n`,
    );
    chmodSync(join(bin, "gh"), 0o755);
  }
  const outputFile = join(dir, "github-output");
  writeFileSync(outputFile, "");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      PATH: [bin, NODE_DIR, "/usr/bin", "/bin"].join(delimiter),
      HOME: dir,
      GITHUB_OUTPUT: outputFile,
      ...env,
    },
  });
  return {
    dir,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: readFileSync(outputFile, "utf8"),
    gh: existsSync(ghArgs) ? readFileSync(ghArgs, "utf8").split("\0").slice(0, -1) : null,
  };
}

const REPORT_STEP = stepOf("retention", (step) => step.id === "report");
const ALERT_STEP = stepOf("housekeeping_alert", (step) => /gh api/.test(step.run ?? ""));
const CLASSIFY_STEP = stepOf("backup_restore", (step) => step.id === "classify");

function classificationFile(content) {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-class-"));
  const path = join(dir, "classification.json");
  if (content !== null) writeFileSync(path, content);
  return path;
}

const HOSTILE_CLASSIFICATIONS = [
  ["a forged second output line", JSON.stringify({ code: "OK\nretention_outcome=success", deactivating: false })],
  ["a forged line with CRLF", JSON.stringify({ code: "OK\r\nretention_outcome=success\r\n", deactivating: false })],
  ["a workflow command", JSON.stringify({ code: "::set-output name=retention_outcome::success", deactivating: false })],
  ["a GITHUB_OUTPUT heredoc opener", JSON.stringify({ code: "X<<EOF", deactivating: false })],
  ["a URL", JSON.stringify({ code: "https://studio.sites.usemingla.com/api/internal/retention-sweep", deactivating: false })],
  ["an object key", JSON.stringify({ code: "tenants/733bc470/media/secret.jpg", deactivating: false })],
  ["lower case", JSON.stringify({ code: "retention_sweep_failed", deactivating: false })],
  ["a trailing newline", JSON.stringify({ code: "RETENTION_SWEEP_FAILED\n", deactivating: false })],
  ["97 characters", JSON.stringify({ code: `A${"B".repeat(96)}`, deactivating: false })],
  ["four megabytes", JSON.stringify({ code: "A".repeat(4 * 1024 * 1024), deactivating: false })],
  ["a number", JSON.stringify({ code: 7, deactivating: false })],
  ["an array", JSON.stringify({ code: ["RETENTION_SWEEP_FAILED"], deactivating: false })],
  ["JSON null", "null"],
  ["a JSON string", JSON.stringify("RETENTION_SWEEP_FAILED")],
  ["truncated JSON", "{\"code\":\"RETENTION_SWEEP_FAILED\""],
  ["an empty file", ""],
  ["binary", "\u0000\u0001\u0002"],
  ["no file", null],
];

test("#2830 tester: no classification content can forge or break the retention job outputs", () => {
  for (const [label, content] of HOSTILE_CLASSIFICATIONS) {
    const run = runStep(REPORT_STEP, {
      SWEEP_OUTCOME: "failure",
      SITES_RECOVERY_CLASSIFICATION_PATH: classificationFile(content),
    });
    assert.equal(run.status, 0, `${label}: the step must still report (${run.stderr})`);
    assert.equal(
      run.output,
      "retention_outcome=failure\nretention_code=RETENTION_UNCLASSIFIED\n",
      `${label}: exactly two output lines, and the hostile code is not one of them`,
    );
    assert.equal(run.stdout, "SITES_RETENTION_OUTCOME outcome=failure code=RETENTION_UNCLASSIFIED\n", label);
    assert.ok(!/^::/m.test(run.stdout + run.stderr), `${label}: no workflow command reaches the log`);
  }
});

test("#2830 tester: a classification path that is a directory still reports the failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-dir-"));
  const run = runStep(REPORT_STEP, { SWEEP_OUTCOME: "failure", SITES_RECOVERY_CLASSIFICATION_PATH: dir });
  assert.equal(run.status, 0);
  assert.equal(run.output, "retention_outcome=failure\nretention_code=RETENTION_UNCLASSIFIED\n");
});

test("#2830 tester: a step outcome GitHub does not define is reported as a failure, never as success", () => {
  const hostile = [
    "", "SUCCESS", "success\nretention_code=PWNED", "success ", "true", "0", "neutral", "timed_out",
  ];
  for (const outcome of hostile) {
    const run = runStep(REPORT_STEP, {
      SWEEP_OUTCOME: outcome,
      SITES_RECOVERY_CLASSIFICATION_PATH: classificationFile(null),
    });
    assert.equal(run.status, 0, JSON.stringify(outcome));
    assert.equal(
      run.output,
      "retention_outcome=failure\nretention_code=RETENTION_UNCLASSIFIED\n",
      `outcome ${JSON.stringify(outcome)} must fall to failure`,
    );
  }
  const clean = runStep(REPORT_STEP, {
    SWEEP_OUTCOME: "success",
    SITES_RECOVERY_CLASSIFICATION_PATH: classificationFile(null),
  });
  assert.equal(clean.output, "retention_outcome=success\nretention_code=RETENTION_UNCLASSIFIED\n");
});

test("#2830 tester: with no GITHUB_OUTPUT the outcome step fails loudly instead of reporting nothing", () => {
  const run = runStep(REPORT_STEP, {
    SWEEP_OUTCOME: "failure",
    SITES_RECOVERY_CLASSIFICATION_PATH: classificationFile(null),
    GITHUB_OUTPUT: "",
  });
  assert.notEqual(run.status, 0, "a step that cannot publish must fail its job");
  // ...and a failed retention job is exactly what the alert's second clause is for.
  const result = simulate(WORKFLOW, EVENTS[0].github, { retention: "failure" });
  assert.equal(result.housekeeping_alert, "success");
  assert.equal(result.deactivate, "skipped");
});

test("#2830 tester: the backup job's classify step still fails closed on every hostile file", () => {
  // Unchanged by this slice; run here so the housekeeping work is proven not
  // to have loosened it. Only an exact {code:string, deactivating:false} holds.
  for (const [label, content] of HOSTILE_CLASSIFICATIONS) {
    const run = runStep(CLASSIFY_STEP, { SITES_RECOVERY_CLASSIFICATION_PATH: classificationFile(content) });
    assert.equal(run.status, 0, label);
    const deactivate = run.output.split("\n").filter((line) => line.startsWith("deactivate="));
    let parsed = null;
    try { parsed = JSON.parse(content ?? "x"); } catch { /* unreadable */ }
    const positivelySafe = typeof parsed?.code === "string" && parsed?.deactivating === false;
    if (!positivelySafe) {
      assert.deepEqual(deactivate, ["deactivate=true"], `${label}: unreadable must deactivate`);
    }
  }
  for (const deactivating of ["false", 0, null, "no", []]) {
    const run = runStep(CLASSIFY_STEP, {
      SITES_RECOVERY_CLASSIFICATION_PATH: classificationFile(JSON.stringify({ code: "RETENTION_SWEEP_FAILED", deactivating })),
    });
    assert.match(run.output, /^deactivate=true$/m, `deactivating=${JSON.stringify(deactivating)} is not the boolean false`);
  }
});

const ALERT_ENV = {
  GH_TOKEN: "not-a-token",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "Mingla-LLC/mingla-main",
  GITHUB_RUN_ID: "424242",
};
const RUN_URL = "https://github.com/Mingla-LLC/mingla-main/actions/runs/424242";

test("#2830 tester: an alert code carrying shell metacharacters is data, never a command", () => {
  const hostile = [
    "$(touch pwned)", "`touch pwned`", "X; touch pwned", "X && touch pwned", "X | touch pwned",
    "X\ntouch pwned", "@/etc/passwd", "-f extra=1", "X' -f body='forged", "X\" -f body=\"forged",
    "${IFS}touch${IFS}pwned",
  ];
  for (const code of hostile) {
    const run = runStep(ALERT_STEP, { ...ALERT_ENV, RETENTION_OUTCOME: "failure", RETENTION_CODE: code }, { stubGh: true });
    assert.equal(run.status, 0, `${JSON.stringify(code)}: ${run.stderr}`);
    assert.ok(!existsSync(join(run.dir, "pwned")), `${JSON.stringify(code)} was executed`);
    assert.deepEqual(run.gh.slice(0, 5), [
      "api", "--method", "POST", "repos/Mingla-LLC/mingla-main/issues/2830/comments", "-f",
    ], "the call shape does not move");
    assert.equal(run.gh.length, 6, `${JSON.stringify(code)} added an argument`);
    assert.equal(
      run.gh[5],
      `body=SITES_HOUSEKEEPING_ALERT kind=RETENTION_FAILED code=${code} outcome=PILOT_UNAFFECTED recovery_evidence_fresh run_url=${RUN_URL}`,
    );
  }
});

test("#2830 tester: a retention job that did not report cannot put its own words in the alert", () => {
  for (const outcome of ["", "success", "cancelled", "skipped", "FAILURE", "failure "]) {
    const run = runStep(
      ALERT_STEP,
      { ...ALERT_ENV, RETENTION_OUTCOME: outcome, RETENTION_CODE: "https://attacker.example/?k=secret" },
      { stubGh: true },
    );
    assert.equal(run.status, 0);
    assert.equal(
      run.gh[5],
      `body=SITES_HOUSEKEEPING_ALERT kind=RETENTION_FAILED code=RETENTION_JOB_DID_NOT_REPORT outcome=PILOT_UNAFFECTED recovery_evidence_fresh run_url=${RUN_URL}`,
      `outcome ${JSON.stringify(outcome)}`,
    );
  }
});

test("#2830 tester: the alert job holds no environment, no secret and no more than it needs", () => {
  const job = WORKFLOW.jobs.housekeeping_alert;
  assert.equal(job.environment, null, "no deployment environment, so no environment secret");
  assert.deepEqual(job.permissions, { contents: "read", issues: "write" });
  assert.ok(!/\bsecrets\./.test(job.raw), "no repository or environment secret is referenced");
  assert.ok(!/uses:\s*actions\/checkout/.test(job.raw), "it runs no repository code");
  assert.deepEqual(job.steps.map((step) => step.envKeys), [["GH_TOKEN", "RETENTION_OUTCOME", "RETENTION_CODE"]]);

  const retention = WORKFLOW.jobs.retention;
  assert.equal(retention.permissions, null, "retention inherits the workflow default");
  assert.match(WORKFLOW_TEXT, /^permissions:\n {2}contents: read\n\n/m, "and that default is read-only contents");
  assert.ok(!/issues:\s*write/.test(retention.raw), "the job holding the signing key cannot write to the issue");
  const secrets = [...retention.raw.matchAll(/\bsecrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual(secrets, ["MINGLA_CORE_TO_CMS_CURRENT_KEY_B64"], "one secret, the signing key");
  assert.deepEqual(Object.keys(retention.outputs).sort(), ["retention_code", "retention_outcome"]);
});

test("#2830 tester: no expression is interpolated into a script in either new job", () => {
  // `${{ … }}` inside `run:` is pasted into the script before the shell sees
  // it; that is the script-injection path. Values must arrive through `env:`.
  for (const id of ["retention", "housekeeping_alert"]) {
    for (const step of WORKFLOW.jobs[id].steps) {
      if (typeof step.run !== "string") continue;
      assert.ok(!step.run.includes("${{"), `${id}: an expression is interpolated into a run: block`);
    }
  }
});

// ---------------------------------------------------------------------------
// The real CLI, with only `fetch` replaced.
// ---------------------------------------------------------------------------

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const KID = "kid-tester-0001";
const BODY_MARKER = "RESPONSE_BODY_MARKER_9f3c";

function fetchStub(mode, status, body) {
  const source = `
    const mode = ${JSON.stringify(mode)};
    globalThis.fetch = async (url, init) => {
      if (mode === "throw") {
        const error = new TypeError("fetch failed");
        error.cause = Object.assign(
          new Error("connect ECONNREFUSED " + init.headers["x-mingla-sites-envelope"]),
          { code: "ECONNREFUSED" },
        );
        throw error;
      }
      if (mode === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return new Response(${JSON.stringify(body)}, { status: ${status} });
    };`;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function runCli({ mode = "respond", status = 200, body = "" }) {
  const path = classificationFile(null);
  const result = spawnSync(process.execPath, ["--import", fetchStub(mode, status, body), RETENTION_CLI], {
    encoding: "utf8",
    timeout: 20_000,
    env: {
      PATH: [NODE_DIR, "/usr/bin", "/bin"].join(delimiter),
      SITES_PILOT_SITE_ID: "22222222-2222-4222-8222-222222222222",
      SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
      MINGLA_CORE_TO_CMS_CURRENT_KID: KID,
      MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: KEY_B64,
      SITES_RECOVERY_CLASSIFICATION_PATH: path,
    },
  });
  return {
    status: result.status,
    text: `${result.stdout}${result.stderr}`,
    path,
    classification: existsSync(path) ? readFileSync(path, "utf8") : null,
  };
}

const CLI_FAILURES = [
  ["the 2026-10-07 answer, 503", { status: 503, body: JSON.stringify({ ok: false, error: { code: "SERVICE_TEMPORARILY_UNAVAILABLE", detail: BODY_MARKER } }) }],
  ["503 carrying a well-formed success body", { status: 503, body: JSON.stringify({ ok: true, data: { protected_artifacts: 0, protected_media: 0, purged_artifacts: 0, purged_media: 0 } }) }],
  ["401", { status: 401, body: JSON.stringify({ ok: false, error: BODY_MARKER }) }],
  ["200 with an HTML error page", { status: 200, body: `<html><body>${BODY_MARKER}</body></html>` }],
  ["200 with invalid JSON", { status: 200, body: `{"ok":true,"data":${BODY_MARKER}` }],
  ["200 with a readiness code where the data should be", { status: 200, body: JSON.stringify({ ok: true, data: "DATABASE_BACKUP_STALE" }) }],
  ["200 with a readiness code as an extra key", { status: 200, body: JSON.stringify({ ok: true, data: { protected_artifacts: 0, protected_media: 0, purged_artifacts: 0, purged_media: 0, DATABASE_BACKUP_MISSING: 1 } }) }],
  ["a network failure whose cause carries the signed envelope", { mode: "throw" }],
  ["a timeout", { mode: "timeout" }],
];

test("#2830 tester: however the CMS answers, the CLI fails as housekeeping and prints nothing it was sent", () => {
  for (const [label, options] of CLI_FAILURES) {
    const run = runCli(options);
    assert.equal(run.status, 1, `${label}: exit code`);
    const verdict = JSON.parse(run.classification);
    assert.equal(verdict.deactivating, false, `${label}: never a readiness violation`);
    assert.match(verdict.code, /^RETENTION_SWEEP_(FAILED|READBACK_INVALID)$/, label);
    assert.ok(!run.text.includes(BODY_MARKER), `${label}: the response body reached the log`);
    assert.ok(!run.text.includes(KEY_B64), `${label}: the signing key reached the log`);
    assert.ok(!run.text.includes(KID), `${label}: the key id reached the log`);
    assert.ok(!/eyJ[A-Za-z0-9+/=]{40,}/.test(run.text), `${label}: the signed envelope reached the log`);
    assert.ok(!/^::/m.test(run.text), `${label}: a workflow command reached the log`);
    assert.match(run.text, new RegExp(`^SITES_RETENTION_FAILED code=${verdict.code}$`, "m"), label);
  }
});

test("#2830 tester: end to end — real CLI failure, real outcome step, real graph, real alert step", () => {
  const cli = runCli({ status: 503, body: "{}" });
  assert.equal(cli.status, 1);

  // What the retention JOB does with a failed sweep depends on one YAML key.
  const sweep = stepOf("retention", (step) => step.id === "sweep");
  assert.equal(sweep["continue-on-error"], "true");
  assert.equal(sweep.if, undefined, "the sweep step is unconditional");
  assert.equal(REPORT_STEP.if, undefined, "the outcome step is unconditional");
  const steps = WORKFLOW.jobs.retention.steps;
  assert.equal(steps.indexOf(REPORT_STEP), steps.length - 1, "nothing runs after the outcome step");
  assert.equal(steps.indexOf(sweep), steps.length - 2, "nothing runs between the sweep and its report");
  assert.equal(WORKFLOW.jobs.retention.outputs.retention_outcome, "${{ steps.report.outputs.retention_outcome }}");
  assert.equal(WORKFLOW.jobs.retention.outputs.retention_code, "${{ steps.report.outputs.retention_code }}");
  assert.deepEqual(REPORT_STEP.envKeys, ["SWEEP_OUTCOME"]);

  const report = runStep(REPORT_STEP, { SWEEP_OUTCOME: "failure", SITES_RECOVERY_CLASSIFICATION_PATH: cli.path });
  assert.equal(report.output, "retention_outcome=failure\nretention_code=RETENTION_SWEEP_FAILED\n");
  const published = Object.fromEntries(report.output.trim().split("\n").map((line) => line.split("=")));

  for (const event of EVENTS.filter((candidate) => candidate.production)) {
    const result = simulate(WORKFLOW, event.github, {}, { retention: published });
    assert.deepEqual(result, {
      contracts: "success",
      backup_restore: "success",
      deactivate: "skipped",
      alert: "skipped",
      retention: "success",
      housekeeping_alert: "success",
      recovery_freshness: "skipped",
      // #2830 slice 2 (additions only): a failed sweep is also emailed.
      ops_page: "success",
    }, event.label);
    assert.equal(runConclusion(result), "success", `${event.label}: the run is green`);
  }

  const alert = runStep(
    ALERT_STEP,
    { ...ALERT_ENV, RETENTION_OUTCOME: published.retention_outcome, RETENTION_CODE: published.retention_code },
    { stubGh: true },
  );
  const body = alert.gh[5].slice("body=".length);
  assert.equal(
    body,
    `SITES_HOUSEKEEPING_ALERT kind=RETENTION_FAILED code=RETENTION_SWEEP_FAILED outcome=PILOT_UNAFFECTED recovery_evidence_fresh run_url=${RUN_URL}`,
  );
  assert.match(body.split(" ")[2].slice("code=".length), SAFE_CODE);
  assert.deepEqual(body.match(/https?:\/\/\S+/g), [RUN_URL], "the run URL is the only URL in the comment");
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(body), "no site, operation or publication id");
});

test("#2830 tester: without step-level continue-on-error the same failure would red the run", () => {
  // The counterfactual, so the green run above is known to rest on that key.
  // A failed step with no continue-on-error fails the job; the unconditional
  // outcome step then never runs, so nothing is published.
  const result = simulate(WORKFLOW, EVENTS[0].github, { retention: "failure" }, { retention: {} });
  assert.equal(runConclusion(result), "failure");
  assert.equal(result.deactivate, "skipped", "even then the pilot is not deactivated");
  assert.equal(result.housekeeping_alert, "success", "and it is still reported");
});
