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
// Assertions (SPEC_ORCH-1383 §5.3): P1..P8 + P-vacuous. ORCH-1400 Phase 1 adds P10..P12
// (SPEC_ORCH-1400 §4.1.b) — they close the three recurrence holes H1–H3 that let the
// orch-1369 and orch-1385 adversarial suites ship dark at their own ORCHs' CLOSE:
// uncapped `fixture` laundering (H1), unswept external gate dirs (H2), and permanently
// legal `capable-unwired` self-tests (H3).
//   P1 every on-disk strict-grep .mjs appears exactly once in gates[]
//   P2 every file-kind gates[] entry exists on disk
//   P3 strict-grep .mjs entry count === expectedStrictGrepMjsFiles === actual on disk
//   P4 every external:<wf> gate is actually invoked in <wf>   (YAML-parsed, never grep)
//   P5 every batch:X gate is in run-batch.mjs's expected set for class X
//   P6 selfTest field matches source reality (source has --self-test => never "none")
//   P7 exact truth: count(selfTest === "wired") === selfTestWiredFloor
//   P8 ratchet: count(enforcement === "unenforced") <= unenforcedCap
//   P10 ratchet: count(enforcement === "fixture") <= fixtureCap, AND every
//       fixture/unenforced reason cites an ORCH (/ORCH-\d{3,4}/). No bypass token
//       exists (ORCH-1400 OQ-2): raising a cap is a committed MANIFEST diff, visible
//       and guarded — a dark file can no longer be laundered in as a "fixture".
//   P11 totality beyond the strict-grep dir: every on-disk .mjs under each
//       manifest.externalGateDirs entry appears exactly once in gates[] (mirrors P1).
//   P12 ratchet: count(selfTest === "capable-unwired") <= capableUnwiredCap — an
//       unwired self-test is a visible, shrinking debt, never a permanent legal state.
//   P-vacuous: discovering ZERO files is a FAILURE, never a pass. This is the
//              "matched nothing -> green" mode (the rel="noopener" class).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expectedForClass, CLASSES } from "./run-batch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const SG_REL = ".github/scripts/strict-grep";
// enforcement states (SPEC §5.1 three-state model, plus "infrastructure" and "job:"):
//   batch:A..E          run by run-batch.mjs in that dependency class
//   job:<jobKey>        run by its OWN preserved job in strict-grep-mingla-business.yml.
//                       ORCH-1383 AMENDMENT (Seth, at REVIEW — Option 2): 4 gates assert
//                       their own job key exists in that workflow; batching would delete the
//                       key and fail them, and SC-16 forbids editing them. Their jobs are
//                       preserved verbatim so the assertions stay TRUE. P9 keeps them honest.
//   external:<workflow> run by a workflow other than strict-grep-mingla-business.yml
//   fixture             a .test.mjs on disk that no CI workflow invokes
//   unenforced          a REAL gate with an exit contract that no CI workflow runs (the 21)
//   infrastructure      not a gate — the batching machinery itself (run-batch.mjs)
const VALID_ENFORCEMENT = /^(batch:[A-E]|job:[A-Za-z0-9._-]+|external:.+|ci-batch:[A-Za-z0-9._-]+|fixture|unenforced|infrastructure)$/;
const SG_WORKFLOW = "strict-grep-mingla-business.yml";

export function walkMjsUnder(dir, relPrefix, base = "") {
  const out = [];
  for (const en of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${en.name}` : en.name;
    if (en.isDirectory()) out.push(...walkMjsUnder(path.join(dir, en.name), relPrefix, rel));
    else if (en.name.endsWith(".mjs")) out.push(`${relPrefix}/${rel}`);
  }
  return out;
}

export function walkMjs(dir, base = "") {
  return walkMjsUnder(dir, SG_REL, base);
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
 * @param {Record<string,Record<string,{script:string,mode:string}[]>>} [a.jobInvocations]
 *        wf name -> jobKey -> invocations (for P9, the carve-out check)
 * @param {Record<string,string[]|null>} [a.externalDiskFiles]
 *        externalGateDirs dir -> repo-relative on-disk .mjs paths under it, or null
 *        if the dir does not exist on disk (for P11, the external-totality check)
 * @returns {string[]} failures
 */
export function runChecks({ manifest, diskFiles, readSource, fileExists, workflowInvocations, jobInvocations, ciBatchManifest = null, externalDiskFiles = {} }) {
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

  // P4b — terminal Phase 3 providers are typed suites, not deleted wrapper files.
  // A gate may claim ci-batch:<suite-id> only when that exact terminal suite and
  // its immutable command capability execute every declared mode.
  const batchSuites = ciBatchManifest?.suites ?? [];
  const batchCapabilities = ciBatchManifest?.commandCapabilities?.commands ?? [];
  for (const g of gates) {
    if (!g.enforcement?.startsWith("ci-batch:")) continue;
    const suiteId = g.enforcement.slice("ci-batch:".length);
    const matches = batchSuites.filter((suite) => suite.id === suiteId);
    if (matches.length !== 1) {
      failures.push(`P4b: "${g.script}" names ci-batch:${suiteId}, but that suite exists ${matches.length} times.`);
      continue;
    }
    const suite = matches[0];
    if (suite.lifecycle !== "batched-historical") {
      failures.push(`P4b: "${g.script}" names ${suiteId}, but its lifecycle is not terminal batched-historical.`);
      continue;
    }
    const observedModes = new Set();
    for (const [index, step] of (suite.steps ?? []).entries()) {
      const capability = batchCapabilities.filter((item) => item.id === step.commandId);
      const invocation = step.invocation;
      const capabilityExact = capability.length === 1 && capability[0].suiteId === suite.id
        && capability[0].stepIndex === index && capability[0].cwd === (step.cwd || ".")
        && capability[0].executable === invocation?.command
        && JSON.stringify(capability[0].argv) === JSON.stringify(invocation?.argv);
      if (!capabilityExact) {
        failures.push(`P4b: ${suiteId} step ${index} lacks its exact registered command capability.`);
        continue;
      }
      const source = stripComments(invocation?.argv?.[1] ?? step.run ?? "").replace(/\\\s*\n/g, " ");
      for (const command of source.split(/\n|&&|\|\||;/)) {
        const tokens = command.trim().split(/\s+/).filter(Boolean);
        const position = tokens.indexOf(g.script);
        if (position === -1) continue;
        observedModes.add(tokens.includes("--self-test") ? "self-test" : "plain");
      }
    }
    for (const mode of g.modes ?? []) {
      if (!observedModes.has(mode)) failures.push(`P4b: ${suiteId} does not execute "${g.script}" in declared ${mode} mode.`);
    }
  }

  // P9 — a carve-out gate must ACTUALLY be invoked by the job it names, in that job, with
  // every mode the manifest records. This is the carve-outs' R4: without it, deleting a
  // carve-out job (or one of its steps) would silently un-run the gate, and no batch-class
  // assertion would notice because the gate is not in any class.
  for (const g of gates) {
    if (!g.enforcement?.startsWith("job:")) continue;
    const jobKey = g.enforcement.slice(4);
    const byJob = jobInvocations?.[SG_WORKFLOW]?.[jobKey];
    if (!byJob) {
      failures.push(
        `P9: "${g.script}" is declared ${g.enforcement} but ${SG_WORKFLOW} has no job "${jobKey}". ` +
        `The carve-out job is gone — the gate is now enforced by nothing.`
      );
      continue;
    }
    for (const mode of g.modes ?? []) {
      const want = mode === "self-test" ? `${g.script} --self-test` : g.script;
      if (!byJob.some((inv) => inv.script === g.script && inv.mode === mode)) {
        failures.push(
          `P9: job "${jobKey}" does not run "${want}" [${mode}], but the manifest says it does. ` +
          `Restore the step or move the gate into a batch class.`
        );
      }
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

  // P7 — self-test coverage is an exact measured truth. A floor that trails the
  // wired count is a false green: the ratchet test rejects it later, while this
  // designated authority used to say PASS. Equality makes one gate registration
  // and one counter advance the same atomic review unit (issue #2207).
  const wired = gates.filter((g) => g.selfTest === "wired").length;
  if (wired !== manifest.selfTestWiredFloor) {
    failures.push(
      `P7: selfTest:"wired" count ${wired} does not EQUAL selfTestWiredFloor ` +
      `${manifest.selfTestWiredFloor}. The floor is measured truth, not a lower bound: wiring a ` +
      `self-test and advancing the floor must land together. Lowering it still needs a ` +
      `GATE-REMOVAL: commit token.`
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

  // P10 (ORCH-1400, closes H1) — "fixture" is capped and every dark state is ORCH-cited.
  // The legal way to land a dark file used to be registering it as `fixture` with any
  // reason string (that is how the orch-1385 adversarial suite sat dark for weeks).
  // There is deliberately NO bypass token (OQ-2): moving a cap is a committed MANIFEST
  // change, visible in the diff and monotonic by review — never a laundering path.
  if (typeof manifest.fixtureCap !== "number") {
    failures.push(`P10: MANIFEST.json is missing the numeric "fixtureCap" ratchet field.`);
  } else {
    const fixtures = gates.filter((g) => g.enforcement === "fixture").length;
    if (fixtures > manifest.fixtureCap) {
      failures.push(
        `P10: ${fixtures} gates are "fixture", above the cap ${manifest.fixtureCap}. ` +
        `The dark-fixture count may only shrink. Wire the file (or raise the cap in a ` +
        `reviewed MANIFEST change — there is no token that does this silently).`
      );
    }
  }
  const ORCH_CITE = /ORCH-\d{3,4}/;
  for (const g of gates) {
    if (g.enforcement !== "fixture" && g.enforcement !== "unenforced") continue;
    if (!ORCH_CITE.test(g.reason ?? "")) {
      failures.push(
        `P10: "${g.script}" is ${g.enforcement} but its reason lacks an ORCH citation ` +
        `(/ORCH-\\d{3,4}/). Every dark state must name the ORCH that owns its disposition.`
      );
    }
  }

  // P11 (ORCH-1400, closes H2) — totality beyond the strict-grep dir. A dir listed in
  // externalGateDirs is swept like P1: every on-disk .mjs must be registered exactly once.
  if (!Array.isArray(manifest.externalGateDirs)) {
    failures.push(`P11: MANIFEST.json is missing the "externalGateDirs" array field.`);
  } else {
    const gateCounts = new Map();
    for (const g of gates) gateCounts.set(g.script, (gateCounts.get(g.script) ?? 0) + 1);
    for (const dir of manifest.externalGateDirs) {
      const files = externalDiskFiles[dir];
      if (files == null) {
        failures.push(`P11: externalGateDirs lists "${dir}" but that directory was not found on disk.`);
        continue;
      }
      if (!files.length) {
        failures.push(
          `P11: externalGateDirs lists "${dir}" but it contains ZERO .mjs files. ` +
          `A swept dir that matches nothing is the vacuous-green mode — fix the path or remove it.`
        );
        continue;
      }
      for (const f of files) {
        const n = gateCounts.get(f) ?? 0;
        if (n === 0) {
          failures.push(
            `P11: "${f}" is on disk under externalGateDirs entry "${dir}" but ABSENT from ` +
            `MANIFEST.json. Add a gates[] entry with an explicit enforcement state.`
          );
        } else if (n > 1) {
          failures.push(`P11: "${f}" appears ${n} times in gates[]; it must appear exactly once.`);
        }
      }
    }
  }

  // P12 (ORCH-1400, closes H3) — an existing-but-never-run self-test is capped debt.
  if (typeof manifest.capableUnwiredCap !== "number") {
    failures.push(`P12: MANIFEST.json is missing the numeric "capableUnwiredCap" ratchet field.`);
  } else {
    const capableUnwired = gates.filter((g) => g.selfTest === "capable-unwired").length;
    if (capableUnwired > manifest.capableUnwiredCap) {
      failures.push(
        `P12: ${capableUnwired} gates are selfTest:"capable-unwired", above the cap ` +
        `${manifest.capableUnwiredCap}. A self-test that exists but never runs is debt, ` +
        `not coverage — wire it (modes += "self-test", selfTest: "wired") instead.`
      );
    }
  }

  return failures;
}

// ---------------------------------------------------------------- real run

async function collectWorkflowInvocations() {
  const YAML = (await import("yaml")).default;
  const wfDir = path.join(REPO_ROOT, ".github/workflows");
  const out = {};
  const perJob = {};
  for (const f of fs.readdirSync(wfDir)) {
    if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
    const doc = YAML.parse(fs.readFileSync(path.join(wfDir, f), "utf8"));
    const set = new Set();
    perJob[f] = {};
    for (const [jobKey, job] of Object.entries(doc?.jobs ?? {})) {
      perJob[f][jobKey] = [];
      for (const step of job?.steps ?? []) {
        if (typeof step?.run !== "string") continue;
        const clean = stripComments(step.run);
        for (const tok of clean.split(/\s+/)) {
          if (/\.(mjs|js|cjs|sh)$/.test(tok)) set.add(tok);
        }
        // per-command, so P9 can tell `X --self-test` from a plain `X`
        for (const cmd of clean.replace(/\\\s*\n/g, " ").split(/\n|&&|\|\||;/)) {
          const t = cmd.trim();
          if (!t) continue;
          const target = t.split(/\s+/).find((x) => /\.(mjs|js|cjs|sh)$/.test(x));
          if (!target) continue;
          perJob[f][jobKey].push({ script: target, mode: /(^|\s)--self-test(\s|$)/.test(t) ? "self-test" : "plain" });
        }
      }
    }
    out[f] = set;
  }
  return { workflowInvocations: out, jobInvocations: perJob };
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

const MANIFEST_REL = `${SG_REL}/MANIFEST.json`;

function gitOutput(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function manifestTruthAtRef(repoRoot, ref) {
  try {
    const manifest = JSON.parse(gitOutput(repoRoot, ["show", `${ref}:${MANIFEST_REL}`]));
    return {
      expectedFiles: manifest.expectedStrictGrepMjsFiles,
      wiredFloor: manifest.selfTestWiredFloor,
      wiredCount: (manifest.gates ?? []).filter((gate) => gate.selfTest === "wired").length,
    };
  } catch {
    return null;
  }
}

/**
 * Return recent first-parent commits that added strict-grep .mjs files. The
 * output is evidence only: it never changes a ref and remains useful in a
 * shallow checkout by returning the candidates whose parent is available.
 */
export function collectRecentGateRegistrationCommits({ repoRoot = REPO_ROOT, limit = 12 } = {}) {
  let rows;
  try {
    rows = gitOutput(repoRoot, [
      "log",
      "--first-parent",
      `-${limit}`,
      "--format=%H%x1f%s",
      "HEAD",
    ]);
  } catch {
    return [];
  }
  if (!rows) return [];

  const candidates = [];
  for (const row of rows.split("\n")) {
    const [sha, subject = ""] = row.split("\x1f");
    if (!sha) continue;
    const parent = `${sha}^`;
    let addedGates;
    try {
      addedGates = gitOutput(repoRoot, [
        "diff",
        "--diff-filter=A",
        "--name-only",
        parent,
        sha,
        "--",
        SG_REL,
      ]).split("\n").filter((file) => file.endsWith(".mjs"));
    } catch {
      continue;
    }
    if (!addedGates.length) continue;
    candidates.push({
      sha,
      subject,
      addedGates,
      before: manifestTruthAtRef(repoRoot, parent),
      after: manifestTruthAtRef(repoRoot, sha),
    });
  }
  return candidates;
}

function truthDelta(before, after, field) {
  const left = before?.[field] ?? "?";
  const right = after?.[field] ?? "?";
  return `${left} -> ${right}`;
}

/**
 * Rich #2207 diagnostic for the one state that cannot be known on either
 * stale PR branch: the combined first-parent tree after both merges land.
 */
export function formatMergeCounterCollision({
  declaredFiles,
  diskFileCount,
  wiredFloor,
  wiredCount,
  candidates,
}) {
  if (declaredFiles === diskFileCount && wiredFloor === wiredCount) return "";

  const lines = [
    "ISSUE #2207 MERGED-MAIN GATE-REGISTRATION COLLISION",
    `Combined tree truth: files expected=${declaredFiles}, on-disk=${diskFileCount}; ` +
      `wired floor=${wiredFloor}, wired entries=${wiredCount}.`,
  ];
  if (!candidates.length) {
    lines.push(
      "No recent first-parent gate-registration commit was readable. Re-run this job with " +
        "actions/checkout fetch-depth >= 4 so the responsible merges can be named.",
    );
    return lines.join("\n");
  }

  lines.push("Recent first-parent gate-registration commits involved in the mismatch:");
  for (const candidate of candidates) {
    lines.push(
      `  - ${candidate.sha.slice(0, 10)} ${candidate.subject}`,
      `    added: ${candidate.addedGates.join(", ")}`,
      `    expected files ${truthDelta(candidate.before, candidate.after, "expectedFiles")}; ` +
        `wired floor ${truthDelta(candidate.before, candidate.after, "wiredFloor")}; ` +
        `wired entries ${truthDelta(candidate.before, candidate.after, "wiredCount")}`,
    );
  }
  lines.push(
    "The individual branch checks could be correct while this combined merge result is not. " +
      "Reconcile the measured values on current main; do not guess or blame the next PR.",
  );
  return lines.join("\n");
}

async function realRun() {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "MANIFEST.json"), "utf8"));
  const ciBatchManifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
  const diskFiles = walkMjs(path.join(REPO_ROOT, SG_REL));
  const { workflowInvocations, jobInvocations } = await collectWorkflowInvocations();
  // P11 — enumerate each externalGateDirs dir from disk (null = dir missing).
  const externalDiskFiles = {};
  for (const dir of Array.isArray(manifest.externalGateDirs) ? manifest.externalGateDirs : []) {
    const abs = path.join(REPO_ROOT, dir);
    externalDiskFiles[dir] = fs.existsSync(abs) ? walkMjsUnder(abs, dir) : null;
  }
  const failures = runChecks({
    manifest,
    diskFiles,
    readSource: (p) => {
      try { return fs.readFileSync(path.join(REPO_ROOT, p), "utf8"); } catch { return null; }
    },
    fileExists: (p) => fs.existsSync(path.join(REPO_ROOT, p)),
    workflowInvocations,
    jobInvocations,
    ciBatchManifest,
    externalDiskFiles,
  });

  console.log(`META-1383 manifest parity: ${diskFiles.length} on-disk .mjs, ${manifest.gates.length} manifest entries.`);
  if (failures.length) {
    console.error(`\nMETA-1383 manifest parity FAILED — ${failures.length} violation(s):\n`);
    for (const f of failures) console.error("  - " + f);
    const collision = formatMergeCounterCollision({
      declaredFiles: manifest.expectedStrictGrepMjsFiles,
      diskFileCount: diskFiles.length,
      wiredFloor: manifest.selfTestWiredFloor,
      wiredCount: (manifest.gates ?? []).filter((gate) => gate.selfTest === "wired").length,
      candidates: collectRecentGateRegistrationCommits(),
    });
    if (collision) console.error(`\n${collision}`);
    process.exit(1);
  }
  console.log("META-1383 manifest parity: PASS (P1–P12 + P-vacuous).");
}

// ---------------------------------------------------------------- self-test

function baseFixture() {
  return {
    manifest: {
      expectedStrictGrepMjsFiles: 2,
      selfTestWiredFloor: 1,
      unenforcedCap: 1,
      fixtureCap: 1,
      capableUnwiredCap: 0,
      externalGateDirs: [],
      gates: [
        { script: `${SG_REL}/alpha.mjs`, kind: "file", enforcement: "batch:A", invocation: "node", modes: ["self-test", "plain"], selfTest: "wired", jobKeys: ["alpha"] },
        { script: `${SG_REL}/beta.mjs`, kind: "file", enforcement: "unenforced", invocation: null, modes: [], selfTest: "none", jobKeys: [], reason: "Frozen by ORCH-1383; disposition owned by ORCH-1400." },
      ],
    },
    diskFiles: [`${SG_REL}/alpha.mjs`, `${SG_REL}/beta.mjs`],
    readSource: (p) => (p.endsWith("alpha.mjs") ? "if (process.argv.includes('--self-test')) {}" : "no capability here"),
    fileExists: () => true,
    workflowInvocations: {},
    jobInvocations: {},
    ciBatchManifest: { suites: [], commandCapabilities: { commands: [] } },
    externalDiskFiles: {},
  };
}

function terminalBatchFixture() {
  const f = baseFixture();
  const script = `${SG_REL}/beta.mjs`;
  const run = `node ${script} --self-test && node ${script}`;
  f.manifest.gates[1] = {
    script, kind: "file", enforcement: "ci-batch:suite-beta", invocation: "node",
    modes: ["self-test", "plain"], selfTest: "wired", jobKeys: [],
  };
  f.manifest.selfTestWiredFloor = 2;
  f.manifest.unenforcedCap = 0;
  f.readSource = () => "if (process.argv.includes('--self-test')) {}";
  f.ciBatchManifest = {
    suites: [{
      id: "suite-beta", lifecycle: "batched-historical",
      steps: [{ commandId: "assert:suite-beta:01", cwd: ".", run,
        invocation: { kind: "raw-shell", command: "bash", argv: ["-c", run] } }],
    }],
    commandCapabilities: { commands: [{
      id: "assert:suite-beta:01", suiteId: "suite-beta", stepIndex: 0, cwd: ".",
      executable: "bash", argv: ["-c", run],
    }] },
  };
  return f;
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
  // P4b — terminal typed batch providers are exact and fail closed.
  check("P4b: exact terminal typed provider passes", terminalBatchFixture(), false);
  {
    const f = terminalBatchFixture();
    f.ciBatchManifest.suites = [];
    check("P4b: missing typed suite fails", f, true, "exists 0 times");
  }
  {
    const f = terminalBatchFixture();
    f.ciBatchManifest.suites.push(structuredClone(f.ciBatchManifest.suites[0]));
    check("P4b: duplicate typed suite fails", f, true, "exists 2 times");
  }
  {
    const f = terminalBatchFixture();
    f.ciBatchManifest.suites[0].lifecycle = "shadow-active";
    check("P4b: non-terminal typed suite fails", f, true, "lifecycle is not terminal");
  }
  {
    const f = terminalBatchFixture();
    f.manifest.gates[1].modes.push("unsupported-mode");
    check("P4b: missing declared mode fails", f, true, "declared unsupported-mode mode");
  }
  {
    const f = terminalBatchFixture();
    f.ciBatchManifest.commandCapabilities.commands[0].argv = ["-c", "true"];
    check("P4b: mismatched command capability fails", f, true, "exact registered command capability");
  }
  {
    const f = terminalBatchFixture();
    f.manifest.gates[1].enforcement = "ci-batch:";
    check("P4b: malformed typed-provider prefix fails", f, true, "invalid enforcement");
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
  // P9 — carve-out job deleted entirely
  {
    const f = baseFixture();
    f.manifest.gates[0].enforcement = "job:my-carve-out";
    f.jobInvocations = { [SG_WORKFLOW]: {} };
    check("P9: carve-out job deleted from the workflow fails", f, true, "has no job");
  }
  // P9 — carve-out job exists but no longer runs the gate
  {
    const f = baseFixture();
    f.manifest.gates[0].enforcement = "job:my-carve-out";
    f.jobInvocations = { [SG_WORKFLOW]: { "my-carve-out": [] } };
    check("P9: carve-out job no longer runs its gate fails", f, true, "does not run");
  }
  // P9 — carve-out job runs the gate but DROPPED its --self-test mode
  {
    const f = baseFixture();
    f.manifest.gates[0].enforcement = "job:my-carve-out";
    f.jobInvocations = { [SG_WORKFLOW]: { "my-carve-out": [{ script: `${SG_REL}/alpha.mjs`, mode: "plain" }] } };
    check("P9: carve-out job dropped a mode (--self-test) fails", f, true, "[self-test]");
  }
  // P9 — happy path: carve-out fully covered
  {
    const f = baseFixture();
    f.manifest.gates[0].enforcement = "job:my-carve-out";
    f.jobInvocations = { [SG_WORKFLOW]: { "my-carve-out": [
      { script: `${SG_REL}/alpha.mjs`, mode: "self-test" },
      { script: `${SG_REL}/alpha.mjs`, mode: "plain" },
    ] } };
    check("P9: fully-covered carve-out passes", f, false);
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

  // ── ORCH-1400 P10/P11/P12 — each rule proven BOTH directions (SPEC_ORCH-1400 §9).
  // Reverting any of these rules makes its bad-direction case below fail this
  // self-test, which runs wired in batch:B — the revert cannot land green.
  const fixtureRow = (reason) => ({
    script: `${SG_REL}/gamma.test.mjs`, kind: "file", enforcement: "fixture",
    invocation: null, modes: [], selfTest: "none", jobKeys: [], reason,
  });
  // P10 good — an ORCH-cited fixture within fixtureCap passes.
  {
    const f = baseFixture();
    f.manifest.gates.push(fixtureRow("Recorded by ORCH-1383; audited by ORCH-1400."));
    f.diskFiles.push(`${SG_REL}/gamma.test.mjs`);
    f.manifest.expectedStrictGrepMjsFiles = 3;
    check("P10: ORCH-cited fixture within fixtureCap passes", f, false);
  }
  // P10 bad — fixture count above the cap (the H1 laundering path).
  {
    const f = baseFixture();
    f.manifest.fixtureCap = 0;
    f.manifest.gates.push(fixtureRow("Recorded by ORCH-1383; audited by ORCH-1400."));
    f.diskFiles.push(`${SG_REL}/gamma.test.mjs`);
    f.manifest.expectedStrictGrepMjsFiles = 3;
    check("P10: fixture count above fixtureCap fails", f, true, "P10:");
  }
  // P10 bad — fixture reason with no ORCH citation.
  {
    const f = baseFixture();
    f.manifest.gates.push(fixtureRow("test fixture on disk"));
    f.diskFiles.push(`${SG_REL}/gamma.test.mjs`);
    f.manifest.expectedStrictGrepMjsFiles = 3;
    check("P10: citation-less fixture reason fails", f, true, "lacks an ORCH citation");
  }
  // P10 bad — unenforced reason with no ORCH citation.
  {
    const f = baseFixture();
    f.manifest.gates[1].reason = "parked for later";
    check("P10: citation-less unenforced reason fails", f, true, "lacks an ORCH citation");
  }
  // P10 bad — the ratchet field itself deleted.
  {
    const f = baseFixture();
    delete f.manifest.fixtureCap;
    check("P10: missing fixtureCap field fails", f, true, '"fixtureCap"');
  }
  // P11 good — external-dir gate registered exactly once passes.
  const EXT_DIR = "app-x/scripts/ci";
  const EXT_FILE = `${EXT_DIR}/gate.mjs`;
  const extRow = () => ({
    script: EXT_FILE, kind: "file", enforcement: "batch:A",
    invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [],
  });
  {
    const f = baseFixture();
    f.manifest.externalGateDirs = [EXT_DIR];
    f.externalDiskFiles = { [EXT_DIR]: [EXT_FILE] };
    f.manifest.gates.push(extRow());
    check("P11: registered external-dir gate passes", f, false);
  }
  // P11 bad — unregistered external-dir file fails BY NAME (the H2 dark path).
  {
    const f = baseFixture();
    f.manifest.externalGateDirs = [EXT_DIR];
    f.externalDiskFiles = { [EXT_DIR]: [EXT_FILE] };
    check("P11: unregistered external-dir file fails by name", f, true, EXT_FILE);
  }
  // P11 bad — duplicate registration.
  {
    const f = baseFixture();
    f.manifest.externalGateDirs = [EXT_DIR];
    f.externalDiskFiles = { [EXT_DIR]: [EXT_FILE] };
    f.manifest.gates.push(extRow(), extRow());
    check("P11: duplicate external-dir registration fails", f, true, "exactly once");
  }
  // P11 bad — listed dir does not exist on disk.
  {
    const f = baseFixture();
    f.manifest.externalGateDirs = [EXT_DIR];
    f.externalDiskFiles = { [EXT_DIR]: null };
    check("P11: listed dir missing on disk fails", f, true, "not found on disk");
  }
  // P11 bad — listed dir matches zero files (vacuous sweep).
  {
    const f = baseFixture();
    f.manifest.externalGateDirs = [EXT_DIR];
    f.externalDiskFiles = { [EXT_DIR]: [] };
    check("P11: listed dir with zero .mjs fails (never a vacuous green)", f, true, "ZERO .mjs");
  }
  // P11 bad — the field itself deleted.
  {
    const f = baseFixture();
    delete f.manifest.externalGateDirs;
    check("P11: missing externalGateDirs field fails", f, true, '"externalGateDirs"');
  }
  // P12 good — capable-unwired within cap passes.
  {
    const f = baseFixture();
    f.manifest.gates[0].selfTest = "capable-unwired";
    f.manifest.gates[0].modes = ["plain"];
    f.manifest.selfTestWiredFloor = 0;
    f.manifest.capableUnwiredCap = 1;
    check("P12: capable-unwired within cap passes", f, false);
  }
  // P12 bad — capable-unwired above the cap (the H3 permanent-legal state).
  {
    const f = baseFixture();
    f.manifest.gates[0].selfTest = "capable-unwired";
    f.manifest.gates[0].modes = ["plain"];
    f.manifest.selfTestWiredFloor = 0;
    check("P12: capable-unwired above cap fails", f, true, "P12:");
  }
  // P12 bad — the ratchet field itself deleted.
  {
    const f = baseFixture();
    delete f.manifest.capableUnwiredCap;
    check("P12: missing capableUnwiredCap field fails", f, true, '"capableUnwiredCap"');
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else await realRun();
}
