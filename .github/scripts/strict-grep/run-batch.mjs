#!/usr/bin/env node
// ORCH-1383. This runner replaced 340 one-gate CI jobs with 5 batched jobs.
// The ONLY thing that makes that safe is: executed === manifest-expected.
//
// DO NOT add `break` on failure. DO NOT run under bare `set -e`. DO NOT treat a
// missing gate file as a skip. DO NOT replace the manifest with a glob.
// Each of those silently converts a gate into a no-op, and a green run into a lie.
//
// This repo has produced SIX classes of dark gate, incl. 21 gates on disk that CI
// never ran (one of them dark one day after its ORCH closed). Assume this WILL
// happen again and that this assertion is the only thing standing in the way.
//
// This proves EXECUTION, not EFFICACY. 168+ of the gates have no --self-test and
// cannot be shown to fail on their own defect. Green here != the suite is healthy.
//
// Contract: SPEC_ORCH-1383 §5.2 R1–R9.
//   R1 iterates MANIFEST.json, never a glob.
//   R2 never breaks early; every gate in the class runs.
//   R3 a missing script file is a FAIL (exit 2, status MISSING), never a skip.
//   R4 asserts executed === expected — a shortfall fails the run on its own.
//   R5 uses each entry's recorded invocation + modes verbatim.
//   R6 prints one line per gate naming the exact script.
//   R7 writes gate-results-<class>.json.
//   R8 exit 0 IFF all gates exit 0 AND executed === expected AND zero MISSING.
//   R9 exit-code passthrough — a gate's 2 is never collapsed to 1 or 0.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(HERE, "MANIFEST.json");

export const CLASSES = ["A", "B", "C", "D", "E"];

export function loadManifest(p = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * The runner's expected set for a class, derived ONLY from the manifest (R1).
 * Exported so meta-1383-manifest-parity.mjs (P5) can cross-check that the
 * runner's view and the manifest's view are identical — a runner that silently
 * filtered entries would diverge here.
 */
export function expectedForClass(manifest, cls) {
  return manifest.gates.filter((g) => g.enforcement === `batch:${cls}`);
}

/** Flatten gates to one execution per (script, mode) — the unit R4 counts. */
export function expectedExecutions(manifest, cls) {
  const out = [];
  for (const g of expectedForClass(manifest, cls)) {
    for (const mode of g.modes) out.push({ gate: g, mode });
  }
  return out;
}

/** Build the exact argv for a (gate, mode). Preserves today's invocation form (R5). */
export function buildCommand(gate, mode) {
  const selfTest = mode === "self-test";
  switch (gate.invocation) {
    case "node":
      return { cmd: "node", args: [gate.script, ...(gate.extraArgs ?? []), ...(selfTest ? ["--self-test"] : [])] };
    case "node --test":
      return { cmd: "node", args: ["--test", gate.script, ...(selfTest ? ["--self-test"] : [])] };
    case "bash":
      return { cmd: "bash", args: [gate.script, ...(gate.extraArgs ?? [])] };
    case "npm run":
      return { cmd: "npm", args: ["run", gate.script, ...(gate.extraArgs ?? [])] };
    default:
      throw new Error(`ORCH-1383 run-batch: unknown invocation "${gate.invocation}" for ${gate.script}`);
  }
}

function main() {
  const idx = process.argv.indexOf("--class");
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error("usage: node run-batch.mjs --class <A|B|C|D|E>");
    process.exit(2);
  }
  const cls = process.argv[idx + 1].toUpperCase();
  if (!CLASSES.includes(cls)) {
    console.error(`ORCH-1383 run-batch: unknown class "${cls}" (expected one of ${CLASSES.join(", ")})`);
    process.exit(2);
  }

  const manifest = loadManifest();
  const expected = expectedExecutions(manifest, cls);

  console.log(`ORCH-1383 run-batch — class ${cls}`);
  console.log(`  manifest: ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
  console.log(`  expected executions: ${expected.length} (from ${expectedForClass(manifest, cls).length} gates)`);
  console.log("");

  const results = [];
  let failures = 0;
  let missing = 0;

  // R2: iterate the FULL expected set. No break, no early return, no short-circuit.
  for (const { gate, mode } of expected) {
    const started = Date.now();

    // R3: a missing script file is a FAIL, never a skip.
    if (gate.kind === "file" && !fs.existsSync(path.join(REPO_ROOT, gate.script))) {
      const durationMs = Date.now() - started;
      console.log(`FAIL  ${gate.script} [${mode}] -> exit 2  (MISSING: gate file not found on disk)`);
      console.log(`      ORCH-1383: a gate file named by MANIFEST.json does not exist. This is a hard`);
      console.log(`      failure, not a skip. Either restore the file or remove its manifest entry`);
      console.log(`      with a GATE-REMOVAL: commit token.`);
      results.push({ script: gate.script, jobKeys: gate.jobKeys, mode, exit: 2, durationMs, status: "MISSING" });
      missing++;
      failures++;
      continue;
    }

    const { cmd, args } = buildCommand(gate, mode);
    const proc = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: "utf8", env: process.env });
    const durationMs = Date.now() - started;

    // R9: passthrough. A signal-killed gate has status null -> treat as 2 (not 0/1).
    const exit = proc.status === null ? 2 : proc.status;
    const status = exit === 0 ? "PASS" : "FAIL";
    if (exit !== 0) failures++;

    // R6: one line per gate, always naming the exact script.
    console.log(`${status === "PASS" ? "ok  " : "FAIL"}  ${gate.script} [${mode}] -> exit ${exit}`);

    if (exit !== 0) {
      const label = `      [${gate.script}]`;
      const dump = (s, streamName) => {
        if (!s || !s.trim()) return;
        console.log(`${label} --- ${streamName} ---`);
        for (const line of s.trimEnd().split("\n")) console.log(`${label} ${line}`);
      };
      dump(proc.stdout, "stdout");
      dump(proc.stderr, "stderr");
      if (proc.error) console.log(`${label} spawn error: ${proc.error.message}`);
    }

    results.push({ script: gate.script, jobKeys: gate.jobKeys, mode, exit, durationMs, status });
  }

  // R7: durable, auditable results.
  const outPath = path.join(REPO_ROOT, `gate-results-${cls}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");

  // R4: the core dark-gate assertion. Green-but-incomplete must be impossible.
  const executed = results.length;
  const coverageOk = executed === expected.length;

  console.log("");
  console.log(`ORCH-1383 run-batch — class ${cls} summary`);
  console.log(`  expected : ${expected.length}`);
  console.log(`  executed : ${executed}`);
  console.log(`  passed   : ${results.filter((r) => r.status === "PASS").length}`);
  console.log(`  failed   : ${failures}`);
  console.log(`  missing  : ${missing}`);
  console.log(`  results  : ${path.relative(REPO_ROOT, outPath)}`);

  if (!coverageOk) {
    console.error("");
    console.error(`ORCH-1383 COVERAGE SHORTFALL — executed ${executed} !== expected ${expected.length}.`);
    console.error("This fails the run REGARDLESS of every gate's verdict. A green run that skipped a");
    console.error("gate is exactly the dark-gate failure this runner exists to make impossible.");
  }
  if (failures) {
    console.error("");
    console.error(`ORCH-1383 — ${failures} gate execution(s) failed in class ${cls}:`);
    for (const r of results.filter((x) => x.status !== "PASS")) {
      console.error(`  ${r.status}  ${r.script} [${r.mode}] -> exit ${r.exit}`);
    }
  }

  // R8
  process.exit(coverageOk && failures === 0 ? 0 : 1);
}

// Entry-point guard. MUST use pathToFileURL: a naive `file://${process.argv[1]}`
// comparison silently fails whenever the checkout path contains characters the URL
// spec percent-encodes (e.g. the `[` `]` in the per-ORCH worktree
// `ORCH-1383-[ci-strict-grep-consolidation]`) — main() never runs, the runner
// prints nothing, and it EXITS 0. That is a green run that executed zero gates:
// the exact dark-gate lie this file exists to prevent. Observed for real during
// ORCH-1383 implementation. Do not "simplify" this back.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
