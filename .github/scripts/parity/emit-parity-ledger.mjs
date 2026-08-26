#!/usr/bin/env node
// #2591 — the parity ledger emitter for the CONSOLIDATED Postgres contract lane.
//
// [TEST-MOD-APPROVED #2591] WHAT THIS FILE IS FOR, NOW. Every run of the
// consolidated postgres-contract-suites workflow invokes it once, with
// PARITY_SIDE=consolidated. It is what turns "the job exited 0" into per-command
// evidence: G-5 compares the committed command inventory against what actually
// executed, as SETS; G-2, G-2b and G-2c then require each executed row to have
// left a witness behind. That live inventory check is why this file was KEPT at
// the cutover while its origin-side counterpart, parse-origin-log.mjs, was
// retired.
//
// Note for whoever edits this header next: the workflow is named above WITHOUT
// its file extension, deliberately. discoverWorkflowProviders() in
// validate-manifest-v2.mjs treats any workflow-filename literal in a tracked
// source as a provider reference, and one here — even inside a comment — makes
// this file a fourth discovered referenceFile and fails the #2591 seal
// subtraction by exact content. MEASURED: it did exactly that on the first draft
// of this comment. Keep the extension out.
//
// [#2591 cutover] THE NEXT TWO PARAGRAPHS ARE HISTORY. They describe the shadow
// arrangement, which ENDED when the cutover deleted the nine origin lanes. They
// are moved to the past tense rather than removed, because they record how the
// parity that justified that deletion was obtained — and therefore why this file
// witnesses what it witnesses. Do not read them as a description of anything that
// runs today.
//
//   The origin side was NOT instrumented. The nine origin lanes were
//   byte-identical to `origin/main` on the shadow branch, and their half of the
//   ledger was READ back from the Actions job logs afterwards by
//   parse-origin-log.mjs. That was possible because psql emits the bare `DO`
//   command tag this ledger witnesses with or without `-e` (MEASURED on
//   PostgreSQL 17.10), so an unmodified lane already printed the evidence.
//   Instrumenting the origins would have put a change into the very run whose
//   job was proving nothing changed. Both files wrote the same row schema, so
//   the two sides joined on it.
//
//   That two-sided ledger was reproducible ONLY at the shadow SHA. The origin
//   side's expectations were derived from the nine origin workflows' YAML; the
//   cutover commit deleted those files, so the origin half lost its subject by
//   construction and parse-origin-log.mjs was retired alongside them in that same
//   commit. There is no origin half any more, and a re-run of one would fail
//   correctly rather than regress.
//
// INPUTS, from $PARITY_DIR (default "$RUNNER_TEMP/parity"):
//   inventory.tsv   id \t kind \t database        — the committed command inventory
//   index.tsv       id \t kind \t database \t file \t exit — what actually executed
//   <id>.log        the tee'd stdout+stderr of that command
//
// OUTPUT: $PARITY_DIR/parity-<side>.json, plus a $GITHUB_STEP_SUMMARY table.
//
// WHAT IS AND IS NOT EVIDENCE
//
// A `RAISE EXCEPTION` site is the FAILURE path. It emits nothing when the
// assertion holds, so a guarded block that never executed is byte-identical, on
// stdout, to one that executed and passed. Counting them is therefore NOT
// evidence, and this ledger records that it did not use them. That is the #2438
// shape: a payment guard whose retry silently never ran while every count
// reconciled perfectly.
//
// The witness that IS evidence is psql's own command tag: one bare `DO` line
// per anonymous block that ran to completion. An empty or unread file exits 0
// with no output; exit-status checking calls that green, and G-2 does not.
//
// Per-assertion positive evidence at RAISE-site granularity is NOT obtainable
// without editing the proof files. This buys per-DO-block liveness plus per-file
// end-to-end liveness. It neither widened nor closed the gap the nine origin
// lanes carried before the cutover; that same gap is now this lane's, unchanged.

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const dir = process.env.PARITY_DIR
  || path.join(process.env.RUNNER_TEMP || process.cwd(), "parity");
const side = process.env.PARITY_SIDE;
// [#2591 cutover] `origin` is now a VESTIGIAL accepted value — no workflow passes
// it any more, because there is no origin side left to pass it. The check is left
// exactly as it is: it is executable, it fails closed on anything unrecognised,
// and narrowing it would be a behaviour change made for tidiness alone.
if (side !== "origin" && side !== "consolidated") {
  console.log("::error::PARITY_SIDE must be exactly 'origin' or 'consolidated'");
  process.exit(1);
}
const lane = process.env.PARITY_LANE || null;

function readTsv(name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.split("\t"));
}

const inventory = readTsv("inventory.tsv");
const executed = readTsv("index.tsv");
const failures = [];

// ── G-5 — command-inventory totality, compared as SETS ────────────────────
// Equal counts over unequal sets is exactly the reconciliation that ships a
// defect, so the comparison is never on counts.
const inventoryIds = new Set(inventory.map((row) => row[0]));
const executedIds = new Set(executed.map((row) => row[0]));
for (const id of inventoryIds) {
  if (!executedIds.has(id)) {
    failures.push(
      `G-5: inventory row ${id} never executed — it was dropped, renamed or silently relocated`,
    );
  }
}
for (const id of executedIds) {
  if (!inventoryIds.has(id)) {
    failures.push(`G-5: ${id} executed but is not in the committed command inventory`);
  }
}

// The house pattern is an anonymous `DO $tag$ ... $tag$;` block, one per
// assertion group. Anchored at line start because a `$tag$` terminator and a
// quoted mention inside a string must not be counted.
function staticDoBlocks(file) {
  const text = fs.readFileSync(file, "utf8");
  return (text.match(/^[ \t]*DO[ \t]*\$/gm) || []).length;
}

function normalise(text) {
  let out = text;
  const workspace = process.env.GITHUB_WORKSPACE;
  if (workspace) out = out.split(workspace).join("<workspace>");
  const runnerTemp = process.env.RUNNER_TEMP;
  if (runnerTemp) out = out.split(runnerTemp).join("<runner-temp>");
  return out
    .replace(/\((\d+(?:\.\d+)?)\s?m?s\)/g, "(<t>)")
    .replace(/\b\d{4}-\d{2}-\d{2}[ T][\d:.]+/g, "<ts>");
}

const rows = [];
let witnessedTotal = 0;
let expectedTotal = 0;

for (const [id, kind, database, file, exitCode] of executed) {
  const logPath = path.join(dir, `${id}.log`);
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const row = {
    id,
    kind,
    file: file && file !== "-" ? file : null,
    database: database && database !== "-" ? database : null,
    exit: Number(exitCode),
    doBlocksWitnessed: null,
    doBlocksExpected: null,
    denoCases: null,
    // stdout and stderr are merged before the tee, because one stream is what a
    // tee can carry. The field NAME dates from the shadow arrangement, when both
    // sides had to join on one row schema; it is kept unchanged so ledgers
    // emitted before and after the cutover stay comparable.
    streams: "merged",
    stderrSha256: crypto.createHash("sha256").update(normalise(log)).digest("hex"),
  };

  if (kind === "psql") {
    const witnessed = (log.match(/^DO$/gm) || []).length;
    const expected = row.file ? staticDoBlocks(row.file) : 0;
    row.doBlocksWitnessed = witnessed;
    row.doBlocksExpected = expected;
    witnessedTotal += witnessed;
    expectedTotal += expected;
    // ── G-2 — per-block execution witness ───────────────────────────────
    if (expected > 0 && witnessed !== expected) {
      failures.push(
        `G-2: ${id} (${row.file}) witnessed ${witnessed} completed DO blocks but the file statically declares ${expected}. A file that was skipped, truncated, fed to the wrong database or aborted early looks exactly like this.`,
      );
    }
    if (expected === 0 && log.trim() === "") {
      failures.push(
        `G-2: ${id} (${row.file}) produced no output at all. psql over an empty or unread file exits 0 with nothing on stdout; the exit status does not say so and this does.`,
      );
    }
  }

  if (kind === "deno") {
    // [#2591 tester, shadow run 2] `deno test` COLOURS its per-case verdict, and
    // an Actions log keeps the escapes: ` ... ok (0ms)` is really
    // ` ... <ESC>[0m<ESC>[32mok<ESC>[0m <ESC>[0m<ESC>[38;5;245m(0ms)<ESC>[0m`.
    // Without stripping them this matcher found ZERO cases in all nine rows on
    // BOTH sides, and the Deno leg of the ledger reconciled as empty-set equals
    // empty-set. MEASURED: 220 cases are really there.
    // eslint-disable-next-line no-control-regex
    const plain = log.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
    row.denoCases = [...plain.matchAll(/^(.*?) \.\.\. (ok|FAILED)(?: \(|$)/gm)]
      .map((match) => `${match[1]}:${match[2]}`);
    // ── G-2c — a Deno row that registered no cases is RED ─────────────────
    // A suite that ran zero cases exits 0 and reports success exactly like one
    // that passed every case, and a set-equality leg comparing two empty sets
    // passes. The origin side refused this, so the consolidated side had to as
    // well, or the two halves would have disagreed about what counts as evidence.
    // Post-cutover there is no second half and the guard stands alone, unchanged:
    // a deno row whose log carries no case lines is RED here, on its own account.
    if (row.denoCases.length === 0) {
      failures.push(
        `G-2c: ${id} is a deno row whose log carries no test-case lines at all. A suite that registered zero cases reports success exactly like one that passed, and an empty case set reconciles against another empty case set.`,
      );
    }
    if (row.denoCases.some((c) => c.endsWith(":FAILED"))) {
      failures.push(`G-2c: ${id} reported at least one FAILED Deno case.`);
    }
  }

  rows.push(row);
}

// ── G-2b — #1177's zero-SQL status, asserted positively ───────────────────
// The database half of G-2b (no suite_1177 exists) is asserted in the workflow,
// against the cluster. This half asserts the command shape.
const hosts1177 = inventoryIds.has("M-1177-03");
if (hosts1177) {
  const psql1177 = rows.filter((row) => row.kind === "psql" && row.id.startsWith("M-1177-"));
  const deno1177 = rows.filter((row) => row.kind === "deno" && row.id === "M-1177-03");
  if (psql1177.length !== 0) {
    failures.push(`G-2b: #1177 executed ${psql1177.length} psql row(s). It executes zero SQL.`);
  }
  if (deno1177.length !== 1) {
    failures.push("G-2b: #1177's Deno row M-1177-03 did not execute");
  }
}

const ledger = {
  side,
  lane,
  sha: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  doBlocksWitnessedTotal: witnessedTotal,
  doBlocksExpectedTotal: expectedTotal,
  raiseExceptionCountsUsedAsEvidence: false,
  // [#2591 cutover] The note below is EMITTED DATA, not a comment: it is written
  // into parity-<side>.json and every ledger banked at and before the cutover
  // carries it byte-for-byte. Its closing clause — "the gap the origin lanes
  // already have" — is therefore frozen in the tense it was written in. Read it
  // historically: those lanes are gone, and the gap it names is now this lane's.
  // Rewording it would change the emitter's output and break that comparability.
  raiseExceptionEvidenceNote:
    "A RAISE EXCEPTION site is the failure path: it emits nothing when the assertion holds, so a matching count proves nothing. Per-assertion positive evidence at RAISE-site granularity is NOT obtainable without editing the proof files. This ledger buys per-DO-block liveness plus per-file end-to-end liveness, and it neither widens nor closes the gap the origin lanes already have.",
  rows,
};

fs.writeFileSync(
  path.join(dir, `parity-${side}.json`),
  `${JSON.stringify(ledger, null, 2)}\n`,
);

const title = lane ? `${side} / ${lane}` : side;
const summary = [
  `## Postgres contract suites — ${title} parity ledger`,
  "",
  `DO blocks witnessed: **${witnessedTotal}** of **${expectedTotal}** statically declared.`,
  "",
  "| id | kind | database | executed | exit | DO blocks witnessed/expected | Deno cases |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];
for (const [id, kind, database] of inventory) {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) {
    // FR-5: a suite that did not execute appears as a row saying so, never as
    // an absent row.
    summary.push(`| ${id} | ${kind} | ${database} | **NOT EXECUTED** | — | — | — |`);
    continue;
  }
  const blocks = row.kind === "psql" ? `${row.doBlocksWitnessed}/${row.doBlocksExpected}` : "—";
  const cases = row.denoCases ? String(row.denoCases.length) : "—";
  summary.push(
    `| ${row.id} | ${row.kind} | ${row.database ?? "—"} | yes | ${row.exit} | ${blocks} | ${cases} |`,
  );
}
const summaryText = `${summary.join("\n")}\n`;
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText);
}
console.log(summaryText);

if (failures.length > 0) {
  for (const failure of failures) console.log(`::error::${failure}`);
  process.exit(1);
}
console.log(
  `LEDGER PASS: ${rows.length} of ${inventory.length} inventory rows executed; ${witnessedTotal}/${expectedTotal} DO blocks witnessed.`,
);
