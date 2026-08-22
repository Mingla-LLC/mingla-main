#!/usr/bin/env node
// #2435 / #2148 Phase 1 governance gate. Plain mode proves the committed
// registry; --self-test proves each named omission/bypass turns it red.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MANIFEST,
  DEFAULT_ROOT,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  validateRegistry,
} from "../ci-batch/validate-manifest-v2.mjs";

const clone = (value) => structuredClone(value);

function assertRed(name, base, mutate, pattern, discovery) {
  const candidate = clone(base);
  mutate(candidate);
  const errors = validateRegistry(candidate, discovery);
  if (!errors.some((error) => pattern.test(error))) {
    console.error(`SELF-TEST FAIL: ${name} did not produce ${pattern}`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASS: ${name}`);
}

function selfTest(base) {
  const discovery = {
    root: DEFAULT_ROOT,
    liveOrigins: discoverLiveOrigins(DEFAULT_ROOT),
    workflowProviders: discoverWorkflowProviders(DEFAULT_ROOT),
    matrixSource: fs.readFileSync(path.join(DEFAULT_ROOT, ".github/workflows/ci-batch.yml"), "utf8"),
  };
  assertRed("origin omission", base, (m) => m.legacyOrigins.pop(), /198 origins|origin omitted/, discovery);
  assertRed("origin duplication", base, (m) => m.legacyOrigins.push(clone(m.legacyOrigins[0])), /duplicate legacy origin/, discovery);
  assertRed("legacy to suite attribution swap", base, (m) => {
    const migrated = m.legacyOrigins.filter((item) => item.disposition === "batched-active");
    [migrated[0].replacementSuite, migrated[1].replacementSuite] = [migrated[1].replacementSuite, migrated[0].replacementSuite];
  }, /owns .* not this origin/, discovery);
  assertRed("suite origin attribution swap", base, (m) => {
    [m.suites[0].origin, m.suites[1].origin] = [m.suites[1].origin, m.suites[0].origin];
  }, /owns .* not this origin/, discovery);
  assertRed("duplicate suite claim", base, (m) => {
    const migrated = m.legacyOrigins.filter((item) => item.disposition === "batched-active");
    migrated[1].replacementSuite = migrated[0].replacementSuite;
  }, /claimed by exactly one|owns .* not this origin/, discovery);
  assertRed("legacy and suite owner mismatch", base, (m) => {
    m.legacyOrigins.find((item) => item.disposition === "batched-active").ownerIssue = "#2148";
  }, /ownerIssue does not match/, discovery);
  assertRed("unknown class", base, (m) => { m.suites[0].class = "unknown-class"; }, /unknown class/, discovery);
  assertRed("unknown setup profile", base, (m) => { m.suites[0].setupProfile = "unknown-profile"; }, /unknown setupProfile/, discovery);
  assertRed("missing expected file", base, (m) => { m.suites[0].expectedFiles.push("definitely/missing.test.mjs"); }, /expected file is missing/, discovery);
  assertRed("expected file omission", base, (m) => { m.suites[0].expectedFiles.pop(); }, /must exactly equal files selected/, discovery);
  assertRed("expected file substitution", base, (m) => { m.suites[0].expectedFiles[0] = m.suites[1].expectedFiles[0]; }, /must exactly equal files selected/, discovery);
  assertRed("empty command", base, (m) => { m.suites[0].steps[0].run = ""; }, /empty compatibility command/, discovery);
  assertRed("missing class route", base, (m) => { m.classes.push("unrouted-class"); }, /no ci-batch matrix route/, discovery);
  assertRed("unsupported setup runtime", base, (m) => { m.setupProfiles["business-node20"].runtime.version = "99"; }, /supported exact node 20 runtime schema/, discovery);
  assertRed("missing setup install", base, (m) => { m.setupProfiles["business-node20"].install = null; }, /does not match unchanged matrix install route/, discovery);
  assertRed("forged setup install", base, (m) => { m.setupProfiles["business-node20"].install.invocation = { kind: "argv", command: "echo", argv: ["not npm ci"] }; }, /exact typed npm \[ci\] invocation/, discovery);
  assertRed("missing setup cwd", base, (m) => { m.setupProfiles["business-node20"].install.cwd = "definitely/missing"; }, /install cwd does not exist/, discovery);
  assertRed("duplicate setup class ownership", base, (m) => { m.setupProfiles["node20-noinstall"].classes.push("business-node20-1"); }, /exactly one setup profile owner/, discovery);
  assertRed("stale unused setup profile", base, (m) => { m.setupProfiles.stale = { runtime: { name: "node", version: "20" }, install: null, classes: ["stale-class"] }; }, /stale or unknown class|not selected by any suite/, discovery);
  assertRed("malformed setup profile", base, (m) => { m.setupProfiles["node20-noinstall"].unexpected = true; }, /malformed or unknown field/, discovery);
  assertRed("suite profile matrix runtime disagreement", base, (m) => { m.suites[0].runtime.version = "18"; }, /suite, setup profile, and matrix runtime must agree/, discovery);
  assertRed("matrix profile runtime disagreement", base, () => {}, /matrix runtime 18 disagrees with setup profile runtime 20/, {
    ...discovery,
    matrixSource: discovery.matrixSource.replace('node: "20"', 'node: "18"'),
  });
  assertRed("workflow install semantic drift", base, () => {}, /exact conditional matrix.install npm ci contract/, {
    ...discovery,
    matrixSource: discovery.matrixSource.replace("run: npm ci", "run: echo forged-install"),
  });
  assertRed("provider omission", base, (m) => m.workflowProviders.pop(), /89 providers|externally referenced workflow provider omitted/, discovery);
  assertRed("provider duplication", base, (m) => m.workflowProviders.push(clone(m.workflowProviders[0])), /duplicate or empty workflow provider/, discovery);
  assertRed("stale reference", base, (m) => { m.workflowProviders[0].referenceFiles[0] = "definitely/missing-reference.mjs"; }, /stale reference file|inventory drifted/, discovery);
  assertRed("live plus batched duplicate provider", base, (m) => { m.suites[0].origin = `.github/workflows/${discovery.liveOrigins[0]}`; }, /origin is live and batched/, discovery);
  assertRed("runtime setup trust and path inventory drift", base, (m) => {
    const live = m.legacyOrigins.find((item) => item.disposition !== "batched-active");
    live.workflowMetadata.sourceSha256 = "0".repeat(64);
  }, /runtime\/setup\/trust\/trigger inventory drifted/, discovery);
  assertRed("nondeterministic commit stamp", base, (m) => { m.generatedAtCommit = "deadbeef"; }, /generatedAtCommit is forbidden/, discovery);
}

const manifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
if (process.argv.includes("--self-test")) {
  selfTest(manifest);
  console.log("#2435 registry v2 adversarial self-test: PASS");
} else {
  const errors = validateRegistry(manifest, { root: DEFAULT_ROOT });
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log("#2435 registry v2 governance: PASS");
}
