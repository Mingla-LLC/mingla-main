#!/usr/bin/env node
// META-ORCH-1383 — MANIFEST.json parity gate.
//
// Enforces I-PROPOSED-1383-GATE-MANIFEST-TOTALITY: every .mjs under
// .github/scripts/strict-grep/ (recursive, incl. __tests__/) has EXACTLY ONE
// manifest entry with an explicit enforcement state. A gate file may never exist
// unaccounted-for — that is how 21 gates in this repo went dark, one of them a day
// after its own ORCH closed.
//
// This gate is itself a manifest entry (enforcement batch:B), so run-batch.mjs's
// R4 (executed === expected) proves IT ran. The circularity — removing it from BOTH
// the manifest and the runner would satisfy R4 — is closed OUTSIDE this file by
// tests-append-only.yml, which ratchets MANIFEST.json and requires a GATE-REMOVAL:
// commit token to shrink gates[] or lower a floor. A different workflow guards this
// one, so disabling this gate does not disable its guard.
//
// Assertions (SPEC_ORCH-1383 §5.3): P1..P8 + P-vacuous.
//   P1 every on-disk strict-grep .mjs appears exactly once in gates[]
//   P2 every file-kind gates[] entry exists on disk
//   P3 strict-grep .mjs entry count === expectedStrictGrepMjsFiles === actual on disk
//   P4 every external:<wf> gate is actually invoked in <wf>   (YAML-parsed, never grep)
//   P5 every batch:X gate is in run-batch.mjs's expected set for class X
//   P6 selfTest field matches source reality (source has --self-test => never "none")
//   P7 ratchet: count(selfTest === "wired") >= selfTestWiredFloor
//   P8 ratchet: count(enforcement === "unenforced") <= unenforcedCap
//   P-vacuous: discovering ZERO files is a FAILURE, never a pass. This is the
//              "matched nothing -> green" mode (the rel="noopener" class).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedForClass, CLASSES } from "./run-batch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const SG_REL = ".github/scripts/strict-grep";
// enforcement states (SPEC §5.1 three-state model, plus "infrastructure"):
//   batch:A..E          run by run-batch.mjs in that dependency class
//   external:<workflow> run by a workflow other than strict-grep-mingla-business.yml
//   fixture             a .test.mjs on disk that no CI workflow invokes
//   unenforced          a REAL gate with an exit contract that no CI workflow runs (the 21)
//   infrastructure      not a gate — the batching machinery itself (run-batch.mjs)
const VALID_ENFORCEMENT = /^(batch:[A-E]|external:.+|fixture|unenforced|infrastructure)$/;

export function walkMjs(dir, base = "") {
  const out = [];
  for (const en of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${en.name}` : en.name;
    if (en.isDirectory()) out.push(...walkMjs(path.join(dir, en.name), rel));
    else if (en.name.endsWith(".mjs")) out.push(`${SG_REL}/${rel}`);
  }
  return out;
}

/**
 * Pure checker. All I/O is injected so --self-test can drive every failure mode
 * with fixtures instead of mutating the real repo.
 *
 * @param {object}   a
 * @param {object}   a.manifest
 * @param {string[]} a.diskFiles              on-disk strict-grep .mjs paths
 * @param {(p:string)=>string|null} a.readSource   source text, or null if absent
 * @param {(p:string)=>boolean} a.fileExists
 * @param {Record<string,Set<string>>} a.workflowInvocations  wf name -> set of invoked script paths
 * @returns {string[]} failures
 */
export function runChecks({ manifest, diskFiles, readSource, fileExists, workflowInvocations }) {
  const failures = [];
  const gates = manifest.gates ?? [];

  // P-vacuous — a run that discovered nothing must FAIL, never pass.
  if (!diskFiles.length) {
    failures.push(
      "P-vacuous: discovered ZERO .mjs files under " + SG_REL + ". A gate that matches nothing " +
      "must fail, not pass — this is the 'green because it checked nothing' mode."
    );
    return failures; // everything downstream would be vacuously true
  }
  if (!gates.length) {
    failures.push("P-vacuous: MANIFEST.json gates[] is EMPTY. Refusing to pass vacuously.");
    return failures;
  }

  // enforcement-state validity (precondition for P1/P8 meaning anything)
  for (const g of gates) {
    if (!VALID_ENFORCEMENT.test(g.enforcement ?? "")) {
      failures.push(`enforcement: "${g.script}" has invalid enforcement "${g.enforcement}".`);
    }
  }

  const sgEntries = gates.filter((g) => g.script?.startsWith(SG_REL + "/") && g.script.endsWith(".mjs"));
  const counts = new Map();
  for (const g of sgEntries) counts.set(g.script, (counts.get(g.script) ?? 0) + 1);

  // P1 — every on-disk file accounted for, exactly once.
  for (const f of diskFiles) {
    const n = counts.get(f) ?? 0;
    if (n === 0) {
      failures.push(
        `P1: "${f}" is on disk but ABSENT from MANIFEST.json. Add a gates[] entry with an ` +
        `explicit enforcement state. A gate file may never exist unaccounted-for.`
      );
    } else if (n > 1) {
      failures.push(`P1: "${f}" appears ${n} times in gates[]; it must appear exactly once.`);
    }
  }

  // P2 — no stale rows.
  for (const g of gates) {
    if (g.kind !== "file") continue;
    if (!fileExists(g.script)) {
      failures.push(`P2: gates[] names "${g.script}" but no such file exists on disk (stale manifest row).`);
    }
  }

  // P3 — counts agree with disk AND with the declared expectation.
  const declared = manifest.expectedStrictGrepMjsFiles;
  if (sgEntries.length !== diskFiles.length) {
    failures.push(`P3: gates[] holds ${sgEntries.length} ${SG_REL}/*.mjs entries but ${diskFiles.length} are on disk.`);
  }
  if (declared !== diskFiles.length) {
    failures.push(
      `P3: expectedStrictGrepMjsFiles=${declared} but ${diskFiles.length} .mjs files are on disk. ` +
      `This count is asserted against disk — never hand-typed.`
    );
  }

  // P4 — external gates are still invoked where the manifest says they are.
  for (const g of gates) {
    if (!g.enforcement?.startsWith("external:")) continue;
    const wf = g.enforcement.slice("external:".length);
    const invoked = workflowInvocations[wf];
    if (!invoked) {
      failures.push(`P4: "${g.script}" claims external:${wf} but that workflow was not found/parsed.`);
    } else if (!invoked.has(g.script)) {
      failures.push(
        `P4: "${g.script}" is declared external:${wf} but ${wf} does not invoke it. ` +
        `It is now enforced by nothing — wire it or change its enforcement state.`
      );
    }
  }

  // P5 — the runner's view must equal the manifest's view.
  for (const cls of CLASSES) {
    const runnerSet = new Set(expectedForClass(manifest, cls).map((g) => g.script));
    const manifestSet = new Set(gates.filter((g) => g.enforcement === `batch:${cls}`).map((g) => g.script));
    for (const s of manifestSet) {
      if (!runnerSet.has(s)) failures.push(`P5: "${s}" is batch:${cls} but run-batch.mjs --class ${cls} would not run it.`);
    }
    for (const s of runnerSet) {
      if (!manifestSet.has(s)) failures.push(`P5: run-batch.mjs --class ${cls} would run "${s}", which is not batch:${cls} in the manifest.`);
    }
  }

  // P6 — selfTest must not lie about the source.
  for (const g of gates) {
    if (g.kind !== "file") continue;
    const src = readSource(g.script);
    if (src == null) continue; // P2 already reported it
    const capable = src.includes("--self-test");
    if (capable && g.selfTest === "none") {
      failures.push(
        `P6: "${g.script}" supports --self-test in source but the manifest says selfTest:"none". ` +
        `Use "wired" (CI runs it) or "capable-unwired" (it does not).`
      );
    }
    if (!capable && g.selfTest === "wired") {
      failures.push(`P6: "${g.script}" is selfTest:"wired" but its source contains no --self-test handling.`);
    }
    if (g.selfTest === "wired" && !(g.modes ?? []).includes("self-test")) {
      failures.push(`P6: "${g.script}" is selfTest:"wired" but its modes do not include "self-test".`);
    }
  }

  // P7 — self-test coverage may only ratchet up.
  const wired = gates.filter((g) => g.selfTest === "wired").length;
  if (wired < manifest.selfTestWiredFloor) {
    failures.push(
      `P7: selfTest:"wired" count ${wired} is BELOW the floor ${manifest.selfTestWiredFloor}. ` +
      `Self-test coverage may only increase. Lowering the floor needs a GATE-REMOVAL: commit token.`
    );
  }

  // P8 — the dark-gate count may only shrink.
  const unenforced = gates.filter((g) => g.enforcement === "unenforced").length;
  if (unenforced > manifest.unenforcedCap) {
    failures.push(
      `P8: ${unenforced} gates are "unenforced", above the cap ${manifest.unenforcedCap}. ` +
      `The dark-gate count may only shrink. Wire the new gate instead of parking it.`
    );
  }

  return failures;
}

// ---------------------------------------------------------------- real run

async function collectWorkflowInvocations() {
  const YAML = (await import("yaml")).default;
  const wfDir = path.join(REPO_ROOT, ".github/workflows");
  const out = {};
  for (const f of fs.readdirSync(wfDir)) {
    if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
    const doc = YAML.parse(fs.readFileSync(path.join(wfDir, f), "utf8"));
    const set = new Set();
    for (const job of Object.values(doc?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step?.run !== "string") continue;
        for (const tok of stripComments(step.run).split(/\s+/)) {
          if (/\.(mjs|js|cjs|sh)$/.test(tok)) set.add(tok);
        }
      }
    }
    out[f] = set;
  }
  return out;
}

export function stripComments(script) {
  return script
    .split("\n")
    .map((line) => {
      let inS = false, inD = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "'" && !inD) inS = !inS;
        else if (c === '"' && !inS) inD = !inD;
        else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

async function realRun() {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "MANIFEST.json"), "utf8"));
  const diskFiles = walkMjs(path.join(REPO_ROOT, SG_REL));
  const failures = runChecks({
    manifest,
    diskFiles,
    readSource: (p) => {
      try { return fs.readFileSync(path.join(REPO_ROOT, p), "utf8"); } catch { return null; }
    },
    fileExists: (p) => fs.existsSync(path.join(REPO_ROOT, p)),
    workflowInvocations: await collectWorkflowInvocations(),
  });

  console.log(`META-1383 manifest parity: ${diskFiles.length} on-disk .mjs, ${manifest.gates.length} manifest entries.`);
  if (failures.length) {
    console.error(`\nMETA-1383 manifest parity FAILED — ${failures.length} violation(s):\n`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("META-1383 manifest parity: PASS (P1–P8 + P-vacuous).");
}

// ---------------------------------------------------------------- self-test

function baseFixture() {
  return {
    manifest: {
      expectedStrictGrepMjsFiles: 2,
      selfTestWiredFloor: 1,
      unenforcedCap: 1,
      gates: [
        { script: `${SG_REL}/alpha.mjs`, kind: "file", enforcement: "batch:A", invocation: "node", modes: ["self-test", "plain"], selfTest: "wired", jobKeys: ["alpha"] },
        { script: `${SG_REL}/beta.mjs`, kind: "file", enforcement: "unenforced", invocation: null, modes: [], selfTest: "none", jobKeys: [] },
      ],
    },
    diskFiles: [`${SG_REL}/alpha.mjs`, `${SG_REL}/beta.mjs`],
    readSource: (p) => (p.endsWith("alpha.mjs") ? "if (process.argv.includes('--self-test')) {}" : "no capability here"),
    fileExists: () => true,
    workflowInvocations: {},
  };
}

function selfTest() {
  const cases = [];
  const check = (name, fixture, shouldFail, matcher) => {
    const failures = runChecks(fixture);
    const failed = failures.length > 0;
    const ok = failed === shouldFail && (!matcher || failures.some((f) => f.includes(matcher)));
    cases.push({ name, ok, failures });
  };

  // control — a clean fixture must PASS (otherwise every case below is meaningless)
  check("control: clean manifest passes", baseFixture(), false);

  // (a) manifest missing an on-disk file -> exit 1
  {
    const f = baseFixture();
    f.diskFiles.push(`${SG_REL}/gamma.mjs`);
    f.manifest.expectedStrictGrepMjsFiles = 3;
    check("P1: on-disk file absent from manifest fails", f, true, "P1:");
  }
  // P1 duplicate
  {
    const f = baseFixture();
    f.manifest.gates.push({ ...f.manifest.gates[0] });
    check("P1: duplicate manifest entry fails", f, true, "exactly once");
  }
  // (b) manifest row with no file -> exit 1
  {
    const f = baseFixture();
    f.manifest.gates.push({ script: `${SG_REL}/ghost.mjs`, kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] });
    f.fileExists = (p) => !p.endsWith("ghost.mjs");
    f.readSource = (p) => (p.endsWith("ghost.mjs") ? null : p.endsWith("alpha.mjs") ? "--self-test" : "x");
    check("P2: manifest row with no file fails", f, true, "P2:");
  }
  // P3 hand-typed count drift
  {
    const f = baseFixture();
    f.manifest.expectedStrictGrepMjsFiles = 99;
    check("P3: expected-count drift fails", f, true, "P3:");
  }
  // P4 external gate no longer invoked
  {
    const f = baseFixture();
    f.manifest.gates[1] = { script: `${SG_REL}/beta.mjs`, kind: "file", enforcement: "external:some-wf.yml", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] };
    f.manifest.unenforcedCap = 0;
    f.workflowInvocations = { "some-wf.yml": new Set() };
    check("P4: external gate dropped from its workflow fails", f, true, "P4:");
  }
  // P5 runner/manifest divergence — batch class the runner would not run
  {
    const f = baseFixture();
    f.manifest.gates[0].enforcement = "batch:Z";
    check("P5/enforcement: invalid class fails", f, true, "enforcement:");
  }
  // (c) floor violation -> exit 1
  {
    const f = baseFixture();
    f.manifest.gates[0].selfTest = "capable-unwired";
    f.manifest.gates[0].modes = ["plain"];
    check("P7: dropping below selfTestWiredFloor fails", f, true, "P7:");
  }
  // P6 un-wiring a self-test while claiming none
  {
    const f = baseFixture();
    f.manifest.gates[0].selfTest = "none";
    f.manifest.gates[0].modes = ["plain"];
    f.manifest.selfTestWiredFloor = 0;
    check("P6: source has --self-test but manifest says none fails", f, true, "P6:");
  }
  // P8 dark-gate count growing
  {
    const f = baseFixture();
    f.manifest.gates.push({ script: `${SG_REL}/delta.mjs`, kind: "file", enforcement: "unenforced", invocation: null, modes: [], selfTest: "none", jobKeys: [] });
    f.diskFiles.push(`${SG_REL}/delta.mjs`);
    f.manifest.expectedStrictGrepMjsFiles = 3;
    f.readSource = (p) => (p.endsWith("alpha.mjs") ? "--self-test" : "x");
    check("P8: 22nd unenforced gate exceeds cap fails", f, true, "P8:");
  }
  // (d) vacuous run -> exit 1, NEVER exit 0
  {
    const f = baseFixture();
    f.diskFiles = [];
    check("P-vacuous: zero files discovered FAILS (never green)", f, true, "P-vacuous:");
  }
  {
    const f = baseFixture();
    f.manifest.gates = [];
    check("P-vacuous: empty gates[] FAILS (never green)", f, true, "P-vacuous:");
  }

  let bad = 0;
  for (const c of cases) {
    console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`);
    if (!c.ok) {
      bad++;
      console.log(`        failures seen: ${JSON.stringify(c.failures, null, 2)}`);
    }
  }
  if (bad) {
    console.error(`\nMETA-1383 parity self-test FAILED: ${bad} of ${cases.length} cases.`);
    process.exit(1);
  }
  console.log(`\nMETA-1383 parity self-test: ${cases.length}/${cases.length} PASS.`);
}

if (process.argv.includes("--self-test")) selfTest();
else await realRun();
