#!/usr/bin/env node
// #2591 — the ORIGIN side of the same-SHA parity ledger, read back from the
// Actions job log of a lane that was NOT modified.
//
// WHY THIS EXISTS
//
// The origin lanes are byte-identical to `origin/main` on this branch. They are
// not instrumented, because instrumenting them would put a change into the very
// run whose job is proving nothing changed. That is possible because psql emits
// the server's command tag — the bare line `DO` for a completed anonymous block
// — with or without `-e`; `-e` only adds the echoed query text. MEASURED on
// PostgreSQL 17.10. So an unmodified lane already prints the witness, and this
// reads it back:
//
//     gh api repos/<owner>/<repo>/actions/jobs/<job_id>/logs > lane.log
//     node .github/scripts/parity/parse-origin-log.mjs --lane <stem> --log lane.log
//
// WHAT REPLACES THE SHARED-EMITTER GUARANTEE
//
// When both sides emitted through one file, tooling divergence was impossible by
// construction. It no longer is: one side emits, the other is parsed. The
// replacement guarantee is that THIS PARSER MUST FAIL on a log that does not
// deserve to pass. A parser that cannot fail fabricates agreement, and
// fabricated agreement is worse than no ledger. Three failure classes are
// asserted here and each is demonstrated RED:
//
//   * a log TRUNCATED mid-suite       -> the last block's tags are short, RED
//   * a log MISSING a suite entirely  -> that step never appears, RED
//   * a suite emitting FEWER `DO` tags than its files statically declare -> RED
//
// A fourth, quieter class is covered too: a step that ran but whose group body
// names no known file at all is reported as UNATTRIBUTED and is RED, so a lane
// that silently starts running something else cannot pass as "nothing missing".
//
// HOW ATTRIBUTION WORKS, AND WHERE IT IS AN INFERENCE
//
// Expectations are derived from the ORIGIN WORKFLOW YAML ITSELF, never from a
// hand-maintained list: the step -> executed-files map is read out of the lane's
// own `run:` bodies, so it follows the file if the file changes.
//
// Raw Actions logs delimit each step as
//     ##[group]Run <the step's script, echoed>
//     ...
//     ##[endgroup]
//     <the step's output>
// so a block is matched to a step by the file paths its echoed script contains.
// That is a MEASUREMENT.
//
// Several origin steps execute more than one .sql file back to back in one
// shell (#1172 runs three, #1173 runs seven). Without `-e` there is no marker
// between them, so the per-file split of a multi-file step is an ORDERED
// PARTITION of the tag sequence, not a measurement. Every such row is stamped
// `attribution: "ordered-partition"`; single-file steps are stamped
// `attribution: "measured"`. The step-level total is always measured, and the
// reconciliation leg that matters compares step totals, never the inferred
// split. Stated here so nobody reads more into a row than it carries.
//
// THIS LEDGER IS REPRODUCIBLE ONLY AT THE SHADOW SHA. READ THIS BEFORE RE-RUNNING.
//
// Expectations are derived from the ORIGIN WORKFLOW YAML. At the #2591 cutover
// those nine files are deleted, so this parser loses its subject BY
// CONSTRUCTION and must be retired with them. After the cutover it will report
// "no such workflow" for every lane. That is correct behaviour and it is NOT a
// regression — do not re-run it against a post-cutover tree and read the failure
// as one, and do not "fix" it by pointing it at the consolidated workflow: the
// whole point of the origin side is that it observes lanes this change did not
// touch. The same-SHA ledger exists at exactly one commit, and that commit is
// the shadow PR's head.
//
// LOG FRAMING — CONFIRMED ON REAL LOGS, 2026-08-25, AND IT DID DIFFER.
//
// The block splitter was originally written against the documented raw-job-log
// shape and proven only on self-authored fixtures. All ten real job logs at
// shadow head ff6e19fb1 were then fetched and the framing checked. Three things
// the fixtures did not carry, each of which made this parser FAIL a log that
// deserved to pass — i.e. it was not fabricating agreement, but it was also not
// usable as written:
//
//   (F-a) REAL LOGS CARRY ANSI SGR ESCAPES. `deno test` colours its case lines,
//         so `<name> ... ok (0ms)` is really
//         `<name> ... \x1b[0m\x1b[32mok\x1b[0m \x1b[0m\x1b[38;5;245m(0ms)\x1b[0m`.
//         The un-stripped matcher found ZERO cases in all nine lanes. Since the
//         consolidated emitter carries the identical matcher, BOTH sides
//         reported `denoCases: []` and the Deno leg reconciled vacuously —
//         empty set equals empty set. ANSI is now stripped before any match.
//   (F-b) FOUR ORIGIN LANES RUN THE 526-FILE MIGRATION REPLAY AND THEIR SUITE
//         SQL IN ONE STEP (#1172, #1173, #1217 alert-drain, #1217 tester
//         adversarial). One step block therefore carries the replay's command
//         tags as well as the suite's. The replay's own tag count is DERIVED
//         from the tree, not hardcoded: `supabase/migrations/*.sql` declares 367
//         anonymous blocks case-insensitively, and #1177 — the one lane that
//         replays and executes no suite SQL — emitted exactly 367. MEASURED.
//         Note the case-insensitivity: four migrations spell it `do $$`, and
//         PostgreSQL does not care. A case-sensitive count says 362 and is
//         wrong by five.
//   (F-c) A COMPOSITE ACTION'S OWN STEPS APPEAR AS `##[group]Run <script>`
//         BLOCKS TOO. `./.github/actions/migrated-postgres` (used by #1171)
//         emits a block whose script names the glob `supabase/migrations/*.sql`,
//         which the unattributed sweep read as a contract command that ran
//         without being declared.
//
// Everything else held exactly as documented: one ISO timestamp per line, a
// UTF-8 BOM on the first line only, LF endings, `##[group]Run <script>` …
// `##[endgroup]`, then the step's output, and psql's bare `DO` command tag
// present WITHOUT `-e` exactly as the design assumed.
//
// Re-confirm on any future format change:
//
//     gh api repos/<owner>/<repo>/actions/jobs/<job_id>/logs | head -40
//
// [TRANSITIONAL] #2591 shadow scaffolding. Exit condition: the #2591 cutover.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const lane = args.get("lane");
const logPath = args.get("log");
const repoRoot = args.get("root") || process.cwd();
const outPath = args.get("out")
  || path.join(process.env.PARITY_DIR || ".", "parity-origin.json");

if (!lane || !logPath) {
  console.log("::error::usage: parse-origin-log.mjs --lane <workflow-stem> --log <job-log> [--root <repo>] [--out <file>]");
  process.exit(1);
}

const workflowPath = path.join(repoRoot, ".github/workflows", `${lane}.yml`);
if (!fs.existsSync(workflowPath)) {
  console.log(`::error::${lane}: no such workflow at ${workflowPath}. The origin lane this log claims to come from does not exist.`);
  process.exit(1);
}

// ── 1. Expectations, derived from the lane's own YAML ──────────────────────
//
// Deliberately a line-oriented read of the `run:` bodies rather than a YAML
// object walk: the repo has no `yaml` dependency installed, and the shapes here
// are the house patterns, not arbitrary YAML.
function stepsFromWorkflow(source) {
  const lines = source.split("\n");
  const steps = [];
  let current = null;
  for (const raw of lines) {
    const nameMatch = raw.match(/^      - name: (.*)$/);
    if (nameMatch) {
      if (current) steps.push(current);
      current = { name: nameMatch[1].replace(/^"|"$/g, ""), script: [] };
      continue;
    }
    if (/^      - uses: /.test(raw)) {
      if (current) steps.push(current);
      current = null;
      continue;
    }
    if (current && /^ {8,}/.test(raw)) current.script.push(raw);
  }
  if (current) steps.push(current);
  return steps.map((step) => ({ name: step.name, script: step.script.join("\n") }));
}

// Anchored at line start because the terminator `$tag$;` and any quoted mention
// inside a string must not be counted.
function staticDoBlocks(file) {
  const absolute = path.join(repoRoot, file);
  if (!fs.existsSync(absolute)) return null;
  return (fs.readFileSync(absolute, "utf8").match(/^[ \t]*DO[ \t]*\$/gm) || []).length;
}

// F-b. Four origin lanes run the full migration replay and their suite SQL in
// ONE step, so that step's output carries the replay's command tags too. The
// replay's contribution is DERIVED from the tree here, never hardcoded, so it
// tracks the migration set. Case-insensitive: four migrations spell it `do $$`
// and PostgreSQL does not care — a case-sensitive count is wrong by five.
// The derivation is corroborated by #1177, the one lane that replays and
// executes no suite SQL: it emitted exactly this number and nothing else.
const MIGRATION_GLOB_RE = /for\s+\w+\s+in\s+supabase\/migrations\/\*\.sql/;
let replayDoBlocksCache = null;
function replayDoBlocks() {
  if (replayDoBlocksCache !== null) return replayDoBlocksCache;
  const dir = path.join(repoRoot, "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  replayDoBlocksCache = files.reduce(
    (total, f) => total
      + (fs.readFileSync(path.join(dir, f), "utf8").match(/^[ \t]*DO[ \t]*\$/gim) || []).length,
    0,
  );
  return replayDoBlocksCache;
}

const workflowSource = fs.readFileSync(workflowPath, "utf8");

// [U-5] THE JOIN KEY. The origin half used to emit `id: null` on every row, so
// L-1 — "compare the id sets" — was not evaluable from the two ledger JSONs at
// all: it reconciled only because a reader went and read the join key out of the
// consolidated workflow by hand. A leg that needs a third artifact and a human is
// not a leg. The ids are now read from the consolidated workflow's own call sites
// and attached here, so the two files reconcile on their own.
const CONSOLIDATED = path.join(repoRoot, ".github/workflows/postgres-contract-suites.yml");
const idByFile = new Map();
const idByFileSet = new Map();
if (fs.existsSync(CONSOLIDATED)) {
  const text = fs.readFileSync(CONSOLIDATED, "utf8");
  for (const m of text.matchAll(/^\s*run_psql(?:_background)? (\S+) (\S+) (\S+)\s*$/gm)) {
    idByFile.set(m[3], m[1]);
  }
  // Non-psql rows are identified by the SET of files their command names, which
  // is what makes #1840's re-run of #1177's suites its own row rather than a
  // duplicate of it.
  const flattened = text.replace(/[ \t]*\\\n\s*/g, " ");
  for (const m of flattened.matchAll(/run_logged (\S+) (\S+) (\S+) -- (.+)/g)) {
    const files = [...m[4].matchAll(/(supabase\/\S+\.(?:ts|sh)|supabase\/\S+\/index\.ts)/g)].map((x) => x[1]);
    if (files.length > 0) idByFileSet.set([...new Set(files)].sort().join("|"), m[1]);
  }
}
const idForPsql = (file) => idByFile.get(file) ?? null;
const idForCommand = (files) => idByFileSet.get([...new Set(files)].sort().join("|")) ?? null;
const expectations = [];
for (const step of stepsFromWorkflow(workflowSource)) {
  // The migration replay loop is not a contract command; exclude it explicitly
  // so its own psql traffic is never mistaken for a suite.
  const script = step.script;
  const sqlFiles = [...script.matchAll(/<\s*\\?\s*\n?\s*(supabase\/\S+\.sql)/g)].map((m) => m[1])
    .concat([...script.matchAll(/<\s+(supabase\/\S+\.sql)/g)].map((m) => m[1]));
  const uniqueOrdered = [];
  for (const f of sqlFiles) if (!uniqueOrdered.includes(f)) uniqueOrdered.push(f);
  const denoFiles = script.includes("deno test")
    ? [...script.matchAll(/(supabase\/\S+\.ts)/g)].map((m) => m[1])
    : [];
  const bashDriver = [...script.matchAll(/(supabase\/\S+\.sh)/g)].map((m) => m[1]);
  const grepTarget = script.includes("grep -q")
    ? [...script.matchAll(/(supabase\/\S+\/index\.ts)/g)].map((m) => m[1])
    : [];
  if (uniqueOrdered.length === 0 && denoFiles.length === 0 && bashDriver.length === 0 && grepTarget.length === 0) continue;
  expectations.push({
    name: step.name,
    sqlFiles: uniqueOrdered,
    denoFiles: grepTarget.length > 0 ? [] : denoFiles,
    bashDriver,
    grepTarget,
    // F-b: this step also drives the full-chain replay, so its command tags are
    // in the same block as the suite's.
    carriesReplay: MIGRATION_GLOB_RE.test(script),
  });
}

if (expectations.length === 0) {
  console.log(`::error::${lane}: the workflow declares no contract commands at all. Either the lane was gutted or this parser stopped understanding it; both are RED.`);
  process.exit(1);
}

// ── 2. The Actions job log, split into step blocks ─────────────────────────
const rawLog = fs.readFileSync(logPath, "utf8");
// F-a. Real Actions logs preserve the tool's ANSI SGR escapes; `deno test`
// colours its per-case verdict, so ` ... ok` is really ` ... <ESC>[32mok<ESC>[0m`.
// Stripped before anything else, so every matcher downstream sees plain text.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const stripAnsi = (line) => line.replace(ANSI, "");
// The BOM is on the first line only, ahead of its timestamp.
const stripBom = (line) => line.replace(/^\uFEFF/, "");
const stripTimestamp = (line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "");
const logLines = rawLog
  .split("\n")
  .map((line) => stripTimestamp(stripAnsi(stripBom(line))));

const blocks = [];
let block = null;
let inGroup = false;
for (const line of logLines) {
  if (line.startsWith("##[group]Run ")) {
    if (block) blocks.push(block);
    block = { script: [line.slice("##[group]Run ".length)], output: [], failed: false };
    inGroup = true;
    continue;
  }
  if (!block) continue;
  if (line === "##[endgroup]") { inGroup = false; continue; }
  if (inGroup) { block.script.push(line); continue; }
  if (line.startsWith("##[error]")) { block.failed = true; block.output.push(line); continue; }
  block.output.push(line);
}
if (block) blocks.push(block);

const truncated = /##\[group\]/.test(logLines[logLines.length - 1] || "")
  || !rawLog.trimEnd().length;

// ── 3. Match blocks to steps and build rows ────────────────────────────────
const rows = [];
const failures = [];
const matchedBlocks = new Set();

function findBlock(exp) {
  const needles = [...exp.sqlFiles, ...exp.denoFiles, ...exp.bashDriver, ...exp.grepTarget];
  for (let i = 0; i < blocks.length; i += 1) {
    if (matchedBlocks.has(i)) continue;
    const script = blocks[i].script.join("\n");
    if (needles.every((n) => script.includes(n))) { matchedBlocks.add(i); return blocks[i]; }
  }
  return null;
}

for (const exp of expectations) {
  const found = findBlock(exp);
  if (!found) {
    failures.push(`${lane}: the step "${exp.name}" does not appear in this job log at all. A suite that never ran is not a suite that passed.`);
    continue;
  }
  const output = found.output.join("\n");
  const witnessed = (output.match(/^DO$/gm) || []).length;
  const exit = found.failed ? 1 : 0;
  const sha = crypto.createHash("sha256").update(
    output.replace(/\((\d+(?:\.\d+)?)\s?m?s\)/g, "(<t>)")
      .replace(/\b\d{4}-\d{2}-\d{2}[ T][\d:.]+/g, "<ts>"),
  ).digest("hex");

  if (exp.sqlFiles.length > 0) {
    const perFile = exp.sqlFiles.map((f) => ({ file: f, expected: staticDoBlocks(f) }));
    const missing = perFile.filter((f) => f.expected === null);
    if (missing.length > 0) {
      failures.push(`${lane}: "${exp.name}" names ${missing.map((f) => f.file).join(", ")}, which is not in the tree. The expectation cannot be derived, so this cannot pass.`);
      continue;
    }
    const suiteExpected = perFile.reduce((a, f) => a + f.expected, 0);
    // F-b. A replay-bearing step's block carries the migration chain's tags as
    // well as the suite's. Both halves are derived from the tree, so the
    // comparison stays a measurement against a static expectation.
    const replayExpected = exp.carriesReplay ? replayDoBlocks() : 0;
    const expectedTotal = suiteExpected + replayExpected;
    if (witnessed !== expectedTotal) {
      const breakdown = exp.carriesReplay
        ? ` (${replayExpected} from the full-chain replay in the same step + ${suiteExpected} from its ${exp.sqlFiles.length} suite file(s))`
        : "";
      failures.push(`${lane}: "${exp.name}" witnessed ${witnessed} completed DO blocks; the tree statically declares ${expectedTotal}${breakdown}. Truncated, aborted early, skipped, or run against the wrong database — all four look exactly like this.`);
    }
    if (expectedTotal === 0 && output.trim() === "") {
      failures.push(`${lane}: "${exp.name}" produced no output at all. psql over an empty or unread file exits 0 with nothing on stdout; the exit status does not say so and this does.`);
    }
    // The suite's tags are the TAIL of the block: the replay runs first and its
    // contribution is known, so the suite-attributable remainder is measured,
    // not guessed.
    const suiteWitnessed = witnessed - replayExpected;
    // Ordered partition WITHIN the suite remainder. An INFERENCE, stamped as one.
    let cursor = 0;
    for (const f of perFile) {
      rows.push({
        id: idForPsql(f.file),
        lane,
        step: exp.name,
        kind: "psql",
        file: f.file,
        database: "postgres",
        exit,
        doBlocksWitnessed: exp.sqlFiles.length === 1
          ? suiteWitnessed
          : Math.min(f.expected, Math.max(0, suiteWitnessed - cursor)),
        doBlocksExpected: f.expected,
        stepDoBlocksWitnessed: witnessed,
        stepDoBlocksExpected: expectedTotal,
        stepReplayDoBlocksExpected: replayExpected,
        stepSuiteDoBlocksWitnessed: suiteWitnessed,
        attribution: exp.sqlFiles.length === 1 ? "measured" : "ordered-partition",
        denoCases: null,
        streams: "actions-job-log",
        stderrSha256: sha,
      });
      cursor += f.expected;
    }
    continue;
  }

  const kind = exp.bashDriver.length > 0 ? "bash" : exp.grepTarget.length > 0 ? "grep" : "deno";
  rows.push({
    id: idForCommand([...exp.denoFiles, ...exp.bashDriver, ...exp.grepTarget]),
    lane,
    step: exp.name,
    kind,
    file: kind === "deno" ? null : (exp.bashDriver[0] || exp.grepTarget[0]),
    database: kind === "bash" ? "postgres" : null,
    exit,
    doBlocksWitnessed: null,
    doBlocksExpected: null,
    stepDoBlocksWitnessed: null,
    stepDoBlocksExpected: null,
    attribution: "measured",
    denoCases: kind === "deno"
      ? [...output.matchAll(/^(.*?) \.\.\. (ok|FAILED)(?: \(|$)/gm)].map((m) => `${m[1]}:${m[2]}`)
      : null,
    streams: "actions-job-log",
    stderrSha256: sha,
  });
  if (kind === "deno" && (output.match(/^(.*?) \.\.\. (ok|FAILED)/gm) || []).length === 0) {
    failures.push(`${lane}: "${exp.name}" is a deno step whose log carries no test-case lines at all. A suite that registered zero cases reports success exactly like one that passed.`);
  }
}

for (let i = 0; i < blocks.length; i += 1) {
  if (matchedBlocks.has(i)) continue;
  const script = blocks[i].script.join("\n");
  // F-c. Bring-up steps — the inline replay loop AND the steps inside the
  // `migrated-postgres` composite action, which appear as their own
  // `##[group]Run` blocks — name the glob `supabase/migrations/*.sql` and never
  // a concrete file. A block that names no path that exists in the tree is
  // infrastructure, not a contract command. A block that names a real suite
  // file and matches nothing declared is still RED, which is the case this
  // sweep exists for.
  const named = [...script.matchAll(/supabase\/\S+\.(?:sql|ts|sh)/g)].map((m) => m[0]);
  const real = named.filter((f) => !f.includes("*") && fs.existsSync(path.join(repoRoot, f)));
  if (real.length === 0) {
    // [#2591 tester] A STANDALONE replay step declares no suite file, so it is
    // not an expectation and its command tags were checked by nothing. MEASURED
    // on the real #1840 log: removing three `DO` tags from the replay left the
    // ledger GREEN. Five lanes replay in a step of their own (#1174, #1612,
    // #1840, #1177) and the template every suite then runs against is built
    // there, so its liveness is checked here on the same derived expectation.
    if (MIGRATION_GLOB_RE.test(script)) {
      const seen = (blocks[i].output.join("\n").match(/^DO$/gm) || []).length;
      if (seen !== replayDoBlocks()) {
        failures.push(`${lane}: the standalone from-zero replay witnessed ${seen} completed DO blocks; supabase/migrations/*.sql statically declares ${replayDoBlocks()}. The template every suite copies is built here, so a short replay is a short template.`);
      }
    }
    continue;
  }
  failures.push(`${lane}: a step naming ${real[0]} ran but matches no command this workflow declares. UNATTRIBUTED output cannot be reconciled.`);
}

for (const row of rows) {
  if (row.id === null) {
    failures.push(`${lane}: a row for ${row.file || row.step} carries no id. L-1 compares id SETS, and a null id cannot be compared — this is the U-5 defect, and it fails closed rather than reconciling 30 ids against nulls.`);
  }
}

if (truncated) {
  failures.push(`${lane}: the job log ends inside a step group. A truncated log cannot witness what it did not record.`);
}

const ledger = {
  side: "origin",
  lane,
  sha: process.env.GITHUB_SHA || null,
  doBlocksWitnessedTotal: rows.reduce((a, r) => a + (r.stepDoBlocksWitnessed && r.attribution !== "ordered-partition" ? r.doBlocksWitnessed : 0), 0),
  raiseExceptionCountsUsedAsEvidence: false,
  raiseExceptionEvidenceNote:
    "A RAISE EXCEPTION site is the failure path: it emits nothing when the assertion holds, so a matching count proves nothing. This side witnesses per-DO-block liveness from an UNMODIFIED lane's own psql command tags. Multi-file steps carry an inferred per-file split, stamped ordered-partition; only step totals are measured.",
  rows,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(ledger, null, 2)}\n`);

console.log(`${lane}: ${rows.length} row(s) across ${expectations.length} declared step(s); ${blocks.length} step block(s) in the log`);
for (const r of rows) {
  const blocksSeen = r.kind === "psql" ? `${r.doBlocksWitnessed}/${r.doBlocksExpected} (${r.attribution})` : "—";
  console.log(`  ${r.kind.padEnd(5)} ${blocksSeen.padEnd(26)} ${r.file || r.step}`);
}
if (failures.length > 0) {
  for (const f of failures) console.log(`::error::${f}`);
  console.log(`ORIGIN LEDGER FAIL: ${failures.length} error(s). This log does not deserve to pass.`);
  process.exit(1);
}
console.log(`ORIGIN LEDGER PASS: ${lane} reconciled from its unmodified job log.`);
