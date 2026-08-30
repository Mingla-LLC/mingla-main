// #2439 independent tester-owned reconstruction of the Phase 3C Deno wave.
// CI-only; no runtime surface.
//
// DIFFERENT ANGLE (SC-19.2). The implementor gate proves the representation
// MATCHES the origin. This one attacks the representation's ability to HIDE A
// LOSS: every clause below exists because some specific deletion, reordering,
// widening or silent skip would otherwise leave a green check carrying no
// information. Nothing here greps final text — it validates the registry that
// production actually executes, and every clause ships with a mutant.
//
// COST (SC-16.6). ONE validateRegistry of the base, ONE discoverWorkflowProviders
// and ONE discoverLiveOrigins, all inside ONE trackedFiles scope entered from the
// start. Every mutant is evaluated inside that SAME scope against those SAME
// precomputed results. A gate that re-entered a scope per mutant would spawn one
// `git ls-files` per attack — measured at 43 here before this restructure — which
// is exactly the cost class SC-16.6 exists to prevent. No repository clone, no
// ambient memoisation, and no wall-clock threshold anywhere.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PHASE3C_SHADOW_MARKER, PHASE3C_WRAPPER_NAMES,
  discoverLiveOrigins, discoverWorkflowProviders, isNonAuthoritativeProviderEvidence,
  trackedFilesProcessInvocations, validateRegistry, withTrackedFilesScope,
} from "../ci-batch/validate-manifest-v2.mjs";
import { executesLeaves, absentFileIsFailure, evaluateTypedPredicate, commandFingerprint } from "../ci-batch/run-suite-batch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const sha = (value) => crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const WAVE = "phase3c-deno-wave";

const processInvocationsAtStart = trackedFilesProcessInvocations();
const BASE = JSON.parse(read(".github/ci-batch/MANIFEST.json"));
const waveSuites = (value) => value.suites.filter((suite) => suite.migrationWave === WAVE);
const waveLeaves = (value) => waveSuites(value).flatMap((suite) => suite.steps.flatMap((step) => (step.children || []).map((child) => ({ suite, step, child }))));
const byIdIn = (value) => (id) => value.suites.find((suite) => suite.id === id);
const leafIn = (value, id, step, index = 0) => byIdIn(value)(id).steps[step].children[index];

// ---------------------------------------------------------------------------
// Every attack, as data. Each entry is the exact loss this gate exists to catch.
// ---------------------------------------------------------------------------
const MUTANTS = [
  // --- a deleted, reordered or renamed outer or leaf ---
  ["outer deleted", (value, byId) => { byId("issue-1427-admin-stay-support-tests").steps.pop(); }],
  ["outer reordered", (value, byId) => {
    const steps = byId("issue-1437-secret-bundle-compatibility-tests").steps;
    [steps[0], steps[1]] = [steps[1], steps[0]];
  }],
  ["leaf deleted from a suite", (value, byId) => { byId("issue-1437-secret-bundle-compatibility-tests").steps[1].children.pop(); }],
  ["leaf deleted from the capability registry", (value) => { value.phase3cLeafCapabilities.leaves.pop(); }],
  ["leaf reordered", (value, byId) => {
    const children = byId("issue-1427-admin-stay-support-tests").steps[0].children;
    [children[0], children[1]] = [children[1], children[0]];
  }],
  ["leaf renamed", (value, byId) => { byId("issue-1170-stripe-money-path-tests").steps[0].children[0].id = "leaf:forged:01:1"; }],
  ["whole suite omitted", (value) => { value.suites = value.suites.filter((suite) => suite.id !== "orch-1371-1372-tester-adversarial"); }],
  ["suite duplicated", (value, byId) => { value.suites.push(structuredClone(byId("issue-1170-stripe-money-path-tests"))); }],
  ["wave header retyped to match a shrunken wave", (value) => { value.migrationWaves[WAVE].outerCommandCount = 45; }],

  // --- permissions: eight ordered sets, none of which may move or widen ---
  ["a permission stripped", (value) => {
    const child = leafIn(value, "issue-1950-app-readiness-tests", 0);
    child.invocation.argv[1] = child.invocation.argv[1].replace("--allow-read ", "");
  }],
  ["a permission widened", (value) => {
    const child = leafIn(value, "issue-1465-permitted-staff-authoring-pipeline-tests", 0);
    child.invocation.argv[1] = child.invocation.argv[1].replace("--allow-net", "--allow-net --allow-read");
  }],
  ["an allowlisted host scope rewritten as bare --allow-net", (value) => {
    const child = leafIn(value, "issue-1430-refund-replay-tests", 0);
    child.invocation.argv[1] = child.invocation.argv[1].replace("--allow-net=deno.land,esm.sh", "--allow-net");
  }],
  ["a one-flag position moved across the operands", (value) => {
    const child = leafIn(value, "issue-1176-paystack-recipient-tests", 0);
    child.invocation.argv[1] = child.invocation.argv[1].replace(" --allow-read", "").replace("deno test ", "deno test --allow-read ");
  }],
  ["two flags reordered", (value) => {
    const child = leafIn(value, "issue-1326-ng-reservation-finalize-tests", 1);
    child.invocation.argv[1] = child.invocation.argv[1].replace("--allow-read --allow-env", "--allow-env --allow-read");
  }],
  ["--import-map lost", (value) => {
    const child = leafIn(value, "issue-1326-ng-reservation-finalize-tests", 1);
    child.invocation.argv[1] = child.invocation.argv[1].replace("--import-map=supabase/functions/_shared/__tests__/_importmap.test.json ", "");
  }],

  // --- tool families: a leaf may be REPLACED rather than removed ---
  ["the npm run build leaf replaced", (value, byId) => {
    const suite = byId("issue-1950-app-readiness-tests");
    const step = suite.steps.find((item) => (item.children || []).some((child) => /npm run build/.test(child.invocation?.argv?.[1] || "")));
    step.children[0].invocation.argv[1] = "true";
  }],
  ["the external gate-dir leaf replaced", (value, byId) => {
    byId("issue-2321-account-deletion-tests").steps.at(-1).children[0].invocation.argv[1] = "echo skipped";
  }],

  // --- typed predicates: the danger is a MISSING verdict, not a wrong one ---
  ["a required-file predicate deleted from the manifest", (value) => {
    leafIn(value, "issue-1637-discover-single-fetch-tests", 0).predicate.paths.pop();
  }],
  ["a required-file predicate downgraded to always", (value, byId) => {
    byId("issue-1950-app-readiness-tests").steps.at(-1).children[0].predicate = { kind: "always" };
  }],
  ["a source-contract sense inverted", (value) => {
    value.phase3cLeafCapabilities.leaves.find((item) => item.predicate?.needle === "brand.account_id !== userId").predicate.sense = "must-contain";
  }],
  ["a source-contract needle weakened", (value) => {
    value.phase3cLeafCapabilities.leaves.find((item) => item.predicate?.needle === "RANK_EVENT_MANAGER = 40").predicate.needle = "RANK";
  }],

  // --- environment, retry, runtime, setup: nothing may widen ---
  ["env widened with a new key", (value, byId) => { byId("issue-1326-ng-reservation-finalize-tests").steps[0].env.GITHUB_TOKEN = "x"; }],
  ["env value made interpolated", (value, byId) => { byId("issue-1326-ng-reservation-finalize-tests").steps[0].env.SUPABASE_URL = "${{ secrets.SUPABASE_URL }}"; }],
  ["env granted to a suite that never had it", (value, byId) => {
    const suite = byId("issue-1170-stripe-money-path-tests");
    suite.steps[0].env = { SUPABASE_URL: "https://example-test.supabase.co" };
    suite.envNames = ["SUPABASE_URL"];
  }],
  ["retry collapsed to a single attempt", (value, byId) => { byId("issue-1326-ng-reservation-finalize-tests").steps[0].retry.attempts = 1; }],
  ["retry back-off made non-integer", (value, byId) => { byId("issue-1326-ng-reservation-finalize-tests").steps[0].retry.backoffSeconds = 0.5; }],
  ["retry invented on a step that never had one", (value, byId) => { byId("issue-1170-stripe-money-path-tests").steps[0].retry = { attempts: 3, backoffSeconds: 10 }; }],
  ["Deno action tag floated", (value) => { value.setupProfiles["phase3c-deno146-node20"].runtime.deno.action = "denoland/setup-deno@v1"; }],
  ["exact Deno selector folded into the floating one", (value) => { value.setupProfiles["phase3c-deno2714-node20"].runtime.deno.version = "v2.x"; }],
  ["an install invented", (value) => {
    value.setupProfiles["phase3c-deno146-node20"].installs.push({
      id: "setup:phase3c-deno146-node20:01", cwd: "mingla-admin", invocation: { kind: "argv", command: "npm", argv: ["ci"] },
    });
  }],
  ["an install removed", (value) => { value.setupProfiles["phase3c-deno2x-app-node22"].installs.pop(); }],

  // --- lifecycle, provider and reference transitions: never partial ---
  ["mixed lifecycle: 16 terminal + 1 shadow", (value) => {
    for (const suite of waveSuites(value)) suite.lifecycle = "batched-historical";
    waveSuites(value)[0].lifecycle = "shadow-active";
  }],
  // [#2439 SC-21] At shadow this declared terminal while the seventeen were still on
  // disk. Post-cutover "batched-historical" is what every suite and origin already
  // carries, so the mutation mutated NOTHING and the clause could not fail. Inverted to
  // the terminal mirror of the same lie: declare SHADOW while the wrappers are absent.
  ["declared shadow while the wrappers are absent", (value) => {
    for (const suite of waveSuites(value)) suite.lifecycle = "shadow-active";
    for (const origin of value.legacyOrigins.filter((item) => item.migrationWave === WAVE)) origin.disposition = "shadow-active";
  }],
  // [#2439 SC-21] Same shape: at shadow this flipped a record forward before its time,
  // but post-cutover "batched-provider" is what the record already holds. Inverted to a
  // transition that REGRESSED — a carried record dragged back to retained-live-provider,
  // which is what would silently break the frozen-seal reconstruction.
  ["provider transition regressed to retained-live-provider", (value) => {
    value.workflowProviders.find((item) => item.workflow === "issue-1430-refund-replay-tests.yml").transition = "retained-live-provider";
  }],
  ["an eleventh provider record invented for one of the other ten", (value) => {
    value.workflowProviders.push({
      workflow: "issue-1170-stripe-money-path-tests.yml", ownerIssue: "#1170", transition: "retained-live-provider",
      providerWorkflow: ".github/workflows/issue-1170-stripe-money-path-tests.yml", referenceFiles: [], rationale: "forged",
    });
  }],
  ["a wave-scoped host reassigned to an unreviewed host", (value, byId) => { byId("issue-2230-consumer-multiday-tests").hostClass = "node20-noinstall"; }],
  ["the host map disagrees with the suite", (value) => { value.phase3cHostMap["issue-2230-consumer-multiday-tests"] = "node20-noinstall"; }],
  ["a candidate quietly dropped out of the wave", (value) => {
    delete value.legacyOrigins.find((item) => item.stem === "issue-2019-ari-delegated-auth").migrationWave;
  }],
  ["a non-candidate claimed for the wave", (value) => {
    value.legacyOrigins.find((item) => item.stem === "issue-679-brand-follows-rls-proof").migrationWave = WAVE;
  }],
  ["a wrapper outside the seventeen pulled into the wave", (value, byId) => {
    byId("issue-1170-stripe-money-path-tests").origin = ".github/workflows/issue-1931-private-event-access.yml";
  }],
];

const PRECOMPUTED = withTrackedFilesScope(ROOT, () => {
  const baseErrors = validateRegistry(structuredClone(BASE), { root: ROOT });
  const providers = discoverWorkflowProviders(ROOT);
  const liveOrigins = discoverLiveOrigins(ROOT);
  const mutantErrors = new Map(MUTANTS.map(([label, mutate]) => {
    const value = structuredClone(BASE);
    mutate(value, byIdIn(value));
    return [label, validateRegistry(value, { root: ROOT, workflowProviders: providers, liveOrigins }).length];
  }));
  // Restoration: the untouched registry is still green under the same
  // precomputed inputs, so a red above is the mutation and nothing else.
  const restoredErrors = validateRegistry(structuredClone(BASE), { root: ROOT, workflowProviders: providers, liveOrigins });
  return { baseErrors, providers, liveOrigins, mutantErrors, restoredErrors };
});
const { baseErrors, providers, liveOrigins, mutantErrors, restoredErrors } = PRECOMPUTED;

const assertRed = (label) => {
  assert.ok(mutantErrors.has(label), `${label}: mutant is not registered`);
  assert.ok(mutantErrors.get(label) > 0, `${label}: mutant went GREEN — this clause cannot fail`);
};

test("the base registry is green and the wave is exactly seventeen sealed Deno origins", () => {
  assert.deepEqual(baseErrors, [], baseErrors.join("\n"));
  assert.deepEqual(restoredErrors, [], "restoration must return GREEN");
  const suites = waveSuites(BASE);
  assert.equal(suites.length, 17);
  assert.deepEqual(suites.map((suite) => path.basename(suite.origin)).sort(), [...PHASE3C_WRAPPER_NAMES].sort());
  assert.equal(new Set(suites.map((suite) => suite.lifecycle)).size, 1, "a partial lifecycle must be impossible");
  if (suites[0].lifecycle === "shadow-active") {
    for (const name of PHASE3C_WRAPPER_NAMES) {
      const source = read(`.github/workflows/${name}`);
      assert.equal(source.split("\n").filter((line) => line === PHASE3C_SHADOW_MARKER).length, 1, `${name}: marker cardinality`);
      assert.ok(liveOrigins.includes(name), `${name}: must be a live origin at shadow`);
    }
  }
});

test("a deleted, reordered or renamed outer or leaf cannot hide behind a total", () => {
  assert.equal(waveSuites(BASE).reduce((sum, suite) => sum + suite.steps.length, 0), 46);
  assert.equal(waveLeaves(BASE).length, 54);
  for (const label of ["outer deleted", "outer reordered", "leaf deleted from a suite",
    "leaf deleted from the capability registry", "leaf reordered", "leaf renamed",
    "whole suite omitted", "suite duplicated", "wave header retyped to match a shrunken wave"]) assertRed(label);
});

test("no permission set in any of the eight ordered sets can move, widen or reorder", () => {
  const commands = waveLeaves(BASE).map(({ child }) => child.invocation?.argv?.[1] || "")
    .filter((command) => /\bdeno (?:test|check)\b/.test(command));
  assert.ok(commands.length >= 20, "the wave must carry a real Deno surface");
  const flags = (command) => (command.match(/--[A-Za-z0-9=.,\-]+/g) || []).filter((flag) => !flag.startsWith("--import-map"));
  assert.deepEqual([...new Set(commands.map((command) => flags(command).join(" ")).filter(Boolean))].sort(), [
    "--allow-env --allow-net", "--allow-env --allow-net --allow-read --no-check",
    "--allow-env --allow-read --allow-net=deno.land,esm.sh", "--allow-read", "--allow-read --allow-env",
    "--allow-read --allow-env --allow-net --no-check", "--allow-read --no-check", "--no-check --allow-read",
  ].sort());
  for (const label of ["a permission stripped", "a permission widened",
    "an allowlisted host scope rewritten as bare --allow-net", "a one-flag position moved across the operands",
    "two flags reordered", "--import-map lost"]) assertRed(label);
});

test("every tool family the wave executes is still executed by a leaf", () => {
  const commands = waveLeaves(BASE).map(({ child }) => child.invocation?.argv?.[1] || "");
  const families = {
    "deno test": /\bdeno test\b/, "deno check": /\bdeno check\b/, "node --test": /\bnode --test\b/,
    "npx eslint": /\bnpx eslint\b/, "npm run build": /\bnpm run build\b/, "npx jest --runInBand": /\bnpx jest --runInBand\b/,
    "strict-grep .mjs": /\bnode \.github\/scripts\/strict-grep\/[a-z0-9-]+\.mjs\b/,
    "external gate dir": /\bnode app-mobile\/scripts\/ci\/orch-1240-dual-account-deletion-check\.mjs\b/,
  };
  for (const [label, pattern] of Object.entries(families)) {
    assert.ok(commands.some((command) => pattern.test(command)), `${label}: no leaf executes this family any more`);
  }
  assertRed("the npm run build leaf replaced");
  assertRed("the external gate-dir leaf replaced");
});

test("a typed predicate cannot become a silent skip, and its sense cannot invert", () => {
  const suites = waveSuites(BASE);
  assert.ok(suites.every((suite) => executesLeaves(suite)), "the wave must route through the runner's leaf branch");
  for (const suite of suites) {
    for (const child of suite.steps.flatMap((step) => step.children || [])) {
      for (const target of child.predicate?.kind === "file-exists" ? child.predicate.paths : []) {
        assert.ok(absentFileIsFailure(suite, target), `${target}: an absent required file must fail, never skip`);
      }
    }
  }
  const required = waveLeaves(BASE).filter(({ child }) => child.predicate?.kind === "file-exists");
  const contracts = waveLeaves(BASE).filter(({ child }) => child.predicate?.kind === "source-contract");
  assert.equal(required.reduce((sum, { child }) => sum + child.predicate.paths.length, 0), 11);
  assert.equal(contracts.length, 3);
  for (const { child } of [...required, ...contracts]) {
    assert.deepEqual(evaluateTypedPredicate(child, ROOT, ROOT), { ok: true, reason: null }, `${child.id} must hold on this tree`);
    assert.equal(child.invocation, null, `${child.id}: a typed predicate must carry no shell the runner cannot see`);
  }
  const absent = structuredClone(required[0].child);
  absent.predicate.paths = ["app-mobile/src/utils/__tests__/tester-deleted-this.test.ts"];
  const verdict = evaluateTypedPredicate(absent, ROOT, ROOT);
  assert.equal(verdict.ok, false, "an absent required file must FAIL");
  assert.match(verdict.reason, /^MISSING: app-mobile\/src\/utils\/__tests__\/tester-deleted-this\.test\.ts/, "the reason must name the target");
  for (const { child } of contracts) {
    const inverted = structuredClone(child);
    inverted.predicate.sense = child.predicate.sense === "must-contain" ? "must-not-contain" : "must-contain";
    assert.equal(evaluateTypedPredicate(inverted, ROOT, ROOT).ok, false, `${child.id}: inverted sense must go RED`);
  }
  for (const label of ["a required-file predicate deleted from the manifest",
    "a required-file predicate downgraded to always", "a source-contract sense inverted",
    "a source-contract needle weakened"]) assertRed(label);
});

test("environment, retry, runtime and setup cannot widen", () => {
  for (const label of ["env widened with a new key", "env value made interpolated",
    "env granted to a suite that never had it", "retry collapsed to a single attempt",
    "retry back-off made non-integer", "retry invented on a step that never had one",
    "Deno action tag floated", "exact Deno selector folded into the floating one",
    "an install invented", "an install removed"]) assertRed(label);
});

test("lifecycle, provider and reference transitions cannot go partial", () => {
  for (const label of ["mixed lifecycle: 16 terminal + 1 shadow",
    "declared shadow while the wrappers are absent", "provider transition regressed to retained-live-provider",
    "an eleventh provider record invented for one of the other ten",
    "a wave-scoped host reassigned to an unreviewed host", "the host map disagrees with the suite",
    "a candidate quietly dropped out of the wave", "a non-candidate claimed for the wave"]) assertRed(label);
  // SC-15.4: evidence is excluded BY ROLE via the production classifier, never
  // by naming a tester-owned path. This file is the role it classifies.
  assert.equal(isNonAuthoritativeProviderEvidence(".github/scripts/strict-grep/issue-2148-ci-deno-wave-shadow.tester.test.mjs"), true);
  assert.equal(isNonAuthoritativeProviderEvidence(".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs"), false);
  assert.equal(isNonAuthoritativeProviderEvidence("app-mobile/src/x.tester.test.ts"), false);
  // [#2439 SC-21] At shadow, discovery held exactly the seven that carry a record. The
  // seventeen are now deleted, so discovery holds NONE of them. That is the terminal
  // invariant and it is falsifiable — restore one and name it from a tracked source and
  // this reds. But asserting only `[]` would throw away the seven-versus-ten distinction
  // this clause existed for, so it is kept on the side that survives the cutover: the
  // REGISTRY still carries exactly those seven, which is what lets the frozen-seal
  // reconstruction reach 73. Losing one, or gaining an eighth, reds here.
  const held = providers.filter((item) => [...PHASE3C_WRAPPER_NAMES].includes(item.workflow)).map((item) => item.workflow).sort();
  assert.deepEqual(held, []);
  const registryHeld = BASE.workflowProviders
    .filter((item) => [...PHASE3C_WRAPPER_NAMES].includes(item.workflow))
    .map((item) => item.workflow).sort();
  assert.deepEqual(registryHeld, ["issue-1430-refund-replay-tests.yml", "issue-1437-secret-bundle-compatibility-tests.yml",
    "issue-1950-app-readiness-tests.yml", "issue-1999-ari-provider-schema-tests.yml", "issue-2019-ari-delegated-auth.yml",
    "issue-2230-consumer-multiday-tests.yml", "issue-2321-account-deletion-tests.yml"].sort());
});

test("a filtered replay lane, the #679 sibling and the wrapper set itself cannot be touched", () => {
  // [TEST-MOD-APPROVED #2851] Re-bank the old a2d6… sibling lock solely for the
  // approved concurrency-only bytes; the assertion still hashes the complete file.
  assert.equal(sha(read(".github/workflows/issue-679-brand-follows-rls-proof.yml")),
    "7c2ef59a790f26a6ce953de6dd63fd623e57a1bfca3727892deaecf8fce85137", "#679 must be byte-identical");
  for (const lane of ["issue-1931-private-event-access.yml", "issue-2117-offering-visibility-gate-tests.yml",
    "issue-1644-storage-guardrail-collage-fill-tests.yml", "issue-1647-admin-mv-and-db-reclaim-tests.yml"]) {
    assert.ok(fs.existsSync(path.join(ROOT, ".github/workflows", lane)), `${lane}: filtered replay lane deleted`);
    assert.ok(!read(`.github/workflows/${lane}`).includes("SHADOW-PARITY-TRIGGER"), `${lane}: must carry no marker`);
    assert.ok(!waveSuites(BASE).some((suite) => path.basename(suite.origin) === lane), `${lane}: must not be migrated`);
  }
  assertRed("a wrapper outside the seventeen pulled into the wave");
});

test("executed must equal expected: the fingerprint and the totals move together", () => {
  // commandFingerprint is what the runner reports per suite. For a leaf-executing
  // wave it must include children, env and retry, or a leaf could be deleted
  // without the fingerprint noticing.
  const suite = waveSuites(BASE).find((item) => item.id === "issue-1326-ng-reservation-finalize-tests");
  const before = commandFingerprint(suite);
  const withoutRetry = structuredClone(suite);
  delete withoutRetry.steps[0].retry;
  assert.notEqual(commandFingerprint(withoutRetry), before, "the fingerprint must see the bounded retry");
  const withoutLeaf = structuredClone(suite);
  withoutLeaf.steps[0].children.pop();
  assert.notEqual(commandFingerprint(withoutLeaf), before, "the fingerprint must see a deleted leaf");
  const withoutEnv = structuredClone(suite);
  delete withoutEnv.steps[0].env;
  assert.notEqual(commandFingerprint(withoutEnv), before, "the fingerprint must see the environment map");
  assert.equal(waveSuites(BASE).reduce((sum, item) => sum + item.steps.length, 0), BASE.migrationWaves[WAVE].outerCommandCount);
  assert.equal(waveLeaves(BASE).length, BASE.migrationWaves[WAVE].maximumLeafCount);
  assert.equal(BASE.phase3cLeafCapabilities.expectedLeaves, waveLeaves(BASE).length);
  assert.equal(sha(BASE.phase3cLeafCapabilities.leaves), BASE.phase3cLeafCapabilities.registrySha256);
});

test("the tester gate itself obeys the Phase 3C cost construction rules", () => {
  const raw = read(".github/scripts/strict-grep/issue-2148-ci-deno-wave-shadow.tester.test.mjs");
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.equal((source.match(/discoverWorkflowProviders\(/g) || []).length, 1, "discovery must run exactly once");
  assert.equal((source.match(/discoverLiveOrigins\(/g) || []).length, 1, "live-origin discovery must run exactly once");
  assert.equal((source.match(/withTrackedFilesScope\(/g) || []).length, 1, "exactly one scope, entered from the start");
  assert.doesNotMatch(source, /Date\.now\(\)|performance\.now\(\)|process\.hrtime/, "a wall-clock threshold inside a gate is forbidden");
  assert.doesNotMatch(source, new RegExp(`execFileSync\\([^)]*${["cl", "one"].join("")}`), "no full-repository clone");
  assert.ok(MUTANTS.length >= 38, `every clause must ship with a mutant; registered ${MUTANTS.length}`);
  assert.equal(new Set(MUTANTS.map(([label]) => label)).size, MUTANTS.length, "mutant labels must be unique");
  const processInvocations = trackedFilesProcessInvocations() - processInvocationsAtStart;
  console.log(`#2439 tester accounting: mutants=${MUTANTS.length} git-ls-files process invocations=${processInvocations}`);
  assert.equal(processInvocations, 1, `the single scope must collapse ${MUTANTS.length} mutants to one git ls-files`);
});
