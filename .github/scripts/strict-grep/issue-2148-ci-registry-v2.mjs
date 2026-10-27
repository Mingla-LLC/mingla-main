#!/usr/bin/env node
// #2435 / #2148 Phase 1 governance gate. Plain mode proves the committed
// registry; --self-test proves each named omission/bypass turns it red.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MANIFEST,
  DEFAULT_ROOT,
  SHADOW_PARITY_MARKER,
  SHADOW_PARITY_WRAPPER_NAMES,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  loadAndValidate,
  validateRegistry,
  withTrackedFilesScope,
  validateShadowParityMarkers,
} from "../ci-batch/validate-manifest-v2.mjs";
import { loadEffectiveManifest } from "../ci-batch/load-manifest.mjs";

const clone = (value) => structuredClone(value);

// [TEST-MOD-APPROVED #3643] Each mutation starts from the production effective
// loader so its non-enumerable trusted bootstrap/local provenance survives.
function assertRed(name, loadBase, mutate, pattern, discovery) {
  const candidate = loadBase();
  mutate(candidate);
  const errors = validateRegistry(candidate, discovery);
  if (!errors.some((error) => pattern.test(error))) {
    console.error(`SELF-TEST FAIL: ${name} did not produce ${pattern}`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASS: ${name}`);
}

function selfTest(loadBase) {
  const base = loadBase();
  const discovery = {
    root: DEFAULT_ROOT,
    liveOrigins: discoverLiveOrigins(DEFAULT_ROOT),
    workflowProviders: discoverWorkflowProviders(DEFAULT_ROOT),
    matrixSource: fs.readFileSync(path.join(DEFAULT_ROOT, ".github/workflows/ci-batch.yml"), "utf8"),
  };
  const workflowSources = Object.fromEntries(fs
    .readdirSync(path.join(DEFAULT_ROOT, ".github/workflows"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => [entry.name, fs.readFileSync(path.join(DEFAULT_ROOT, ".github/workflows", entry.name), "utf8")]));
  const assertMarkerRed = (name, mutate, pattern = /shadow parity marker/) => {
    const sources = { ...workflowSources };
    mutate(sources);
    const errors = validateShadowParityMarkers(base, sources);
    if (!errors.some((error) => pattern.test(error))) {
      console.error(`SELF-TEST FAIL: ${name} did not produce ${pattern}`);
      process.exit(1);
    }
    console.log(`SELF-TEST PASS: ${name}`);
  };
  const markerTarget = SHADOW_PARITY_WRAPPER_NAMES[0];
  assertMarkerRed("restored terminal wrapper", (sources) => { sources[markerTarget] = "restored terminal wrapper\n"; }, /terminal wrapper must be absent/);
  assertMarkerRed("wrong-path shadow marker", (sources) => { sources["unapproved-workflow.yml"] = `${SHADOW_PARITY_MARKER}\nname: forbidden\n`; }, /stray.*unapproved workflow/);
  assertRed("origin omission", loadBase, (m) => m.legacyOrigins.pop(), /200 origins|origin omitted/, discovery);
  assertRed("split-text representation omission", loadBase, (m) => {
    const suite = m.suites.find((item) => item.id === "issue-994-ota-env-resolution-app-mobile");
    const index = suite.originPaths.findIndex((item) => item?.encoding === "concat-v1");
    suite.originPaths[index] = `${suite.originPaths[index].parts[0]}${suite.originPaths[index].parts[1]}`;
  }, /exactly six reviewed split-text path representations/, discovery);
  assertRed("split-text representation forgery", loadBase, (m) => {
    const suite = m.suites.find((item) => item.id === "issue-994-ota-env-resolution-mingla-business");
    suite.originPaths.find((item) => item?.encoding === "concat-v1").parts[1] = ".tsx";
  }, /malformed or unreviewed split-text representation|lost reviewed provenance/, discovery);
  assertRed("split-text representation relocation", loadBase, (m) => {
    const owner = m.suites.find((item) => item.id === "issue-994-ota-env-resolution-app-mobile");
    const index = owner.originPaths.findIndex((item) => item?.encoding === "concat-v1");
    m.suites[0].originPaths.push(owner.originPaths[index]);
    owner.originPaths[index] = "removed-reviewed-provenance";
  }, /outside the exact #994 provenance fields|lost reviewed provenance/, discovery);
  assertRed("origin duplication", loadBase, (m) => m.legacyOrigins.push(clone(m.legacyOrigins[0])), /duplicate legacy origin/, discovery);
  assertRed("legacy to suite attribution swap", loadBase, (m) => {
    const migrated = m.legacyOrigins.filter((item) => item.disposition === "batched-active");
    [migrated[0].replacementSuite, migrated[1].replacementSuite] = [migrated[1].replacementSuite, migrated[0].replacementSuite];
  }, /owns .* not this origin/, discovery);
  assertRed("suite origin attribution swap", loadBase, (m) => {
    [m.suites[0].origin, m.suites[1].origin] = [m.suites[1].origin, m.suites[0].origin];
  }, /owns .* not this origin/, discovery);
  assertRed("duplicate suite claim", loadBase, (m) => {
    const migrated = m.legacyOrigins.filter((item) => item.disposition === "batched-active");
    migrated[1].replacementSuite = migrated[0].replacementSuite;
  }, /claimed by exactly one|owns .* not this origin/, discovery);
  assertRed("legacy and suite owner mismatch", loadBase, (m) => {
    m.legacyOrigins.find((item) => item.disposition === "batched-active").ownerIssue = "#2148";
  }, /ownerIssue does not match/, discovery);
  assertRed("unknown class", loadBase, (m) => { m.suites[0].class = "unknown-class"; }, /unknown class/, discovery);
  assertRed("unknown setup profile", loadBase, (m) => { m.suites[0].setupProfile = "unknown-profile"; }, /unknown setupProfile/, discovery);
  assertRed("missing expected file", loadBase, (m) => { m.suites[0].expectedFiles.push("definitely/missing.test.mjs"); }, /expected file is missing/, discovery);
  assertRed("expected file omission", loadBase, (m) => { m.suites[0].expectedFiles.pop(); }, /must exactly equal files selected/, discovery);
  assertRed("expected file substitution", loadBase, (m) => { m.suites[0].expectedFiles[0] = m.suites[1].expectedFiles[0]; }, /must exactly equal files selected/, discovery);
  assertRed("config-selected issue-1036 expected file omission", loadBase, (m) => {
    const suite = m.suites.find((item) => item.id === "issue-1036-contrast-chip-removal-tests");
    suite.expectedFiles = suite.expectedFiles.filter((file) => !file.endsWith("issue1036NoContrastNode.web.render.test.tsx"));
  }, /must exactly equal files selected/, discovery);
  assertRed("config-selected issue-1532 expected file substitution", loadBase, (m) => {
    const suite = m.suites.find((item) => item.id === "issue-1532-tester-adversarial");
    const index = suite.expectedFiles.findIndex((file) => file.endsWith("stayGuardReachability.issue1532.tester.render.test.tsx"));
    suite.expectedFiles[index] = "mingla-business/src/components/stay/__tests__/stayManagerUx.issue1532.render.test.tsx";
  }, /must exactly equal files selected/, discovery);
  assertRed("empty command", loadBase, (m) => { m.suites[0].steps[0].run = ""; }, /empty compatibility command/, discovery);
  assertRed("missing class route", loadBase, (m) => { m.classes.push("unrouted-class"); }, /no ci-batch matrix route/, discovery);
  assertRed("unsupported setup runtime", loadBase, (m) => { m.setupProfiles["business-node20"].runtime.version = "99"; }, /approved exact Node runtime|setupProfiles differ/, discovery);
  assertRed("missing setup install", loadBase, (m) => { m.setupProfiles["business-node20"].install = null; }, /matrix cache route|setupProfiles differ/, discovery);
  assertRed("forged setup install", loadBase, (m) => { m.setupProfiles["business-node20"].install.invocation = { kind: "argv", command: "echo", argv: ["not npm ci"] }; }, /approved typed npm|setupProfiles differ/, discovery);
  assertRed("missing setup cwd", loadBase, (m) => { m.setupProfiles["business-node20"].install.cwd = "definitely/missing"; }, /install cwd does not exist/, discovery);
  assertRed("duplicate setup class ownership", loadBase, (m) => { m.setupProfiles["node20-noinstall"].classes.push("business-node20-1"); }, /exactly one setup profile owner/, discovery);
  assertRed("stale unused setup profile", loadBase, (m) => { m.setupProfiles.stale = { runtime: { name: "node", version: "20" }, install: null, classes: ["stale-class"] }; }, /stale or unknown class|not selected by any suite/, discovery);
  assertRed("malformed setup profile", loadBase, (m) => { m.setupProfiles["node20-noinstall"].unexpected = true; }, /malformed or unknown field/, discovery);
  assertRed("suite profile matrix runtime disagreement", loadBase, (m) => { m.suites[0].runtime.version = "18"; }, /suite, setup profile, and matrix runtime must agree/, discovery);
  assertRed("matrix profile runtime disagreement", loadBase, () => {}, /matrix runtime 18 disagrees with setup profile runtime 20/, {
    ...discovery,
    matrixSource: discovery.matrixSource.replace('node: "20"', 'node: "18"'),
  });
  assertRed("workflow install semantic drift", loadBase, () => {}, /no free-form install route/, {
    ...discovery,
    matrixSource: discovery.matrixSource.replace('run: node .github/scripts/ci-batch/run-suite-batch.mjs --setup "${{ matrix.class }}"', "run: npm ci"),
  });
  assertRed("terminal variant omission", loadBase, (m) => {
    m.suites.splice(m.suites.findIndex((suite) => suite.lifecycle === "batched-historical"), 1);
  }, /55 executable suites|55 entries|32 .*variants/, discovery);
  assertRed("terminal command capability drift", loadBase, (m) => {
    const suite = m.suites.find((item) => item.lifecycle === "batched-historical");
    m.commandCapabilities.commands.find((item) => item.suiteId === suite.id).argv[1] += " # forged";
  }, /158 assertion command capabilities|immutable executable/, discovery);
  assertRed("terminal contract drift", loadBase, (m) => {
    m.suites.find((item) => item.lifecycle === "batched-historical").shadowContract.triggerSha256 = "0".repeat(64);
  }, /32-variant shadow.*drifted/, discovery);
  assertRed("994 second variant omission", loadBase, (m) => {
    m.legacyOrigins.find((item) => item.ownerIssue === "#994" && item.disposition === "batched-historical").replacementSuites.pop();
  }, /expected exactly 2 unique replacement/, discovery);
  assertRed("terminal wrapper restoration metadata", loadBase, (m) => {
    const origin = m.legacyOrigins.find((item) => item.disposition === "batched-historical");
    origin.providerWorkflow = `.github/workflows/${origin.stem}.${origin.extension}`;
  }, /historical wrapper absent/, discovery);
  assertRed("shared action pin drift", loadBase, () => {}, /exact pinned checkout\/setup-node/, {
    ...discovery,
    matrixSource: discovery.matrixSource.replace("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", "actions/checkout@v4"),
  });
  assertRed("manual dispatch fanout", loadBase, () => {}, /exact isolated #2300-only route/, {
    ...discovery,
    matrixSource: discovery.matrixSource.replace("inputs.suite == 'issue-2300-orch-artifact-reap'", "true"),
  });
  assertRed("unavailable pre-matrix job context", loadBase, () => {}, /supported pre-matrix event contexts/, {
    ...discovery,
    matrixSource: discovery.matrixSource.replace("if: github.event_name != 'workflow_dispatch'", "if: github.event_name != 'workflow_dispatch' || matrix.class == 'node20-19-noinstall'"),
  });
  assertRed("provider omission", loadBase, (m) => m.workflowProviders.pop(), /91 providers|externally referenced workflow provider omitted/, discovery);
  assertRed("provider duplication", loadBase, (m) => m.workflowProviders.push(clone(m.workflowProviders[0])), /duplicate or empty workflow provider/, discovery);
  assertRed("stale reference", loadBase, (m) => { m.workflowProviders[0].referenceFiles[0] = "definitely/missing-reference.mjs"; }, /stale reference file|inventory drifted/, discovery);
  assertRed("live plus batched duplicate provider", loadBase, (m) => { m.suites[0].origin = `.github/workflows/${discovery.liveOrigins[0]}`; }, /origin is live and batched/, discovery);
  assertRed("runtime setup trust and path inventory drift", loadBase, (m) => {
    // [#3643] The attack targets a LIVE origin's metadata. Phase 3D made the old
    // first match (a folded, now batched-historical row) terminal, so select by
    // the live dispositions explicitly rather than by position.
    const live = m.legacyOrigins.find((item) => !["batched-active", "batched-historical", "consolidated-provider"].includes(item.disposition));
    live.workflowMetadata.sourceSha256 = "0".repeat(64);
  }, /runtime\/setup\/trust\/trigger inventory drifted/, discovery);
  assertRed("nondeterministic commit stamp", loadBase, (m) => { m.generatedAtCommit = "deadbeef"; }, /generatedAtCommit is forbidden/, discovery);
}

export function governanceVerdict({ root = DEFAULT_ROOT, manifestPath = DEFAULT_MANIFEST } = {}) {
  return withTrackedFilesScope(root, () => loadAndValidate(manifestPath, { root, discover: true }));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  // [#2438 A7-SC3] Explicitly entered, explicitly exited tracked-file scope.
  // Every attack mutates a fresh loader-owned effective object in memory, so
  // trusted bootstrap and local provenance remain available to the validator.
  if (process.argv.includes("--self-test")) {
    const loadBase = () => loadEffectiveManifest({ root: DEFAULT_ROOT, manifestPath: DEFAULT_MANIFEST, discover: true });
    withTrackedFilesScope(DEFAULT_ROOT, () => selfTest(loadBase));
    console.log("#2435 registry v2 adversarial self-test: PASS");
  } else {
    const { errors } = governanceVerdict();
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log("#2435 registry v2 governance: PASS");
  }
}
