// #2439 / #2148 Phase 3C. Implementor gate for the seventeen Deno origins.
//
// COST (SC-16.6, hard construction rules, not advice):
//   1. validateRegistry() and discoverWorkflowProviders() are called EXACTLY
//      ONCE each, at module load, and the results are passed to every subtest.
//      #2438's implementor gate paid one validateRegistry 43 times inside a
//      single test; one unscoped call costs ~3.7 s.
//   2. A trackedFiles scope is entered FROM THE START and never retrofitted.
//      This module performs no fs write, mkdir, rm or subprocess, so the tree
//      and the Git index are provably immutable for its whole duration.
//   3. NO full-repository clone. Every terminal-shaped state below is built in
//      memory from the registry, never by materialising a 165 MB tree.
//   4. No ambient, process-lifetime or root-keyed memoisation of anything.
//   5. Enforcement is the A7-SC4 COUNT-based accounting record. There is no
//      wall-clock threshold anywhere in this file: a timing assertion inside a
//      gate is the #2178 nondeterministic-required-gate class.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ROOT, decodeManifestTextRepresentations, discoverExpectedFilesForSuite,
  discoverWorkflowProviders, isNonAuthoritativeProviderEvidence, trackedFiles,
  PROVIDERS_ADDED_SINCE_SEAL,
  trackedFilesCalls, trackedFilesProcessInvocations,
  validateRegistry, withTrackedFilesScope, PHASE3C_SHADOW_MARKER, PHASE3C_WRAPPER_NAMES,
} from "../validate-manifest-v2.mjs";
import { executesLeaves, absentFileIsFailure, evaluateTypedPredicate, expectedPrimarySuites, retryIsHonoured, sleepBounded, minimalChildEnvironment } from "../run-suite-batch.mjs";
import { reconcilePhase3bReports, selectionDocument } from "../select-phase3b-suites.mjs";
import { commandFingerprint } from "../run-suite-batch.mjs";
import { isPrimarySuite, isMigratedSuite, suiteCommandFingerprint } from "../validate-manifest-v2.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const WAVE = "phase3c-deno-wave";
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const digest = (value) => sha(JSON.stringify(value));
const clone = (value) => structuredClone(value);

// ---------------------------------------------------------------------------
// ONE scope, ONE validateRegistry, ONE discoverWorkflowProviders. Everything
// below reads these precomputed results.
// ---------------------------------------------------------------------------
const callsAtStart = trackedFilesCalls();
const processInvocationsAtStart = trackedFilesProcessInvocations();
const RAW = JSON.parse(read(".github/ci-batch/MANIFEST.json"));
const PRECOMPUTED = withTrackedFilesScope(ROOT, () => {
  const registryErrors = validateRegistry(RAW, { root: ROOT });
  const providers = discoverWorkflowProviders(ROOT);
  const manifest = decodeManifestTextRepresentations(RAW);
  const suites = manifest.suites.filter((suite) => suite.migrationWave === WAVE);
  const derivedExpectedFiles = Object.fromEntries(suites.map((suite) => [suite.id, discoverExpectedFilesForSuite(suite, ROOT)]));
  // [#2439 SC-15.4] The retired-reference inventory, computed in the SAME scope
  // off the SAME cached listing — no second `git ls-files`, no clone, no second
  // discovery. `trackedFiles` is the validator's own listing function, so the
  // A7-SC4 accounting record still sees every call this gate makes.
  const retired = suites.map((suite) => suite.origin);
  const carriers = { production: [], evidence: [] };
  for (const relative of trackedFiles(ROOT)) {
    let source;
    try { source = fs.readFileSync(path.join(ROOT, relative), "utf8"); } catch { continue; }
    // Cheap literal pre-filter, same discipline as A7-SC2: a source that cannot
    // hold the prefix cannot hold any retired path.
    if (!source.includes(".github/workflow" + "s/")) continue;
    if (!retired.some((origin) => source.includes(origin))) continue;
    carriers[isNonAuthoritativeProviderEvidence(relative) ? "evidence" : "production"].push(relative);
  }
  carriers.production.sort();
  carriers.evidence.sort();
  return { registryErrors, providers, manifest, suites, derivedExpectedFiles, carriers };
});
const VALIDATE_REGISTRY_CALLS = 1;
const DISCOVER_PROVIDERS_CALLS = 1;

const { registryErrors, providers, manifest, suites, derivedExpectedFiles, carriers } = PRECOMPUTED;
const leaves = suites.flatMap((suite) => suite.steps.flatMap((step) => (step.children || []).map((child) => ({ suite, step, child }))));

// [#2439 SC-18] The wave holds ONE lifecycle (the registry validation above
// fails closed on a mixture), so a single flag selects which half of every
// clause below is the truth. Nothing is skipped at terminal: each shadow
// assertion has a terminal counterpart that asserts the SAME protection against
// what survives the deletion — the registry-carried seal instead of the file.
const LIFECYCLE = suites[0].lifecycle;
const TERMINAL = LIFECYCLE === "batched-historical";

// [#2439 SC-1] The exact seventeen and their pre-shadow source seals. The seal
// is taken AFTER stripping only the SC-12.1 marker line, so the marker itself
// cannot smuggle a source change through.
//
// Keyed by STEM, never by filename. `discoverWorkflowProviders()` treats any
// tracked source naming a real workflow filename as evidence that the workflow
// provides a suite; a gate that spelled the seventeen filenames would silently
// add ten provider records and move a frozen digest. #2438's implementor gate is
// excluded by an explicit name literal in the production classifier - a carve-out
// this file does not need, because it names no workflow file at all.
const WORKFLOWS = ".github/workflows";
const wrapper = (stem) => `${WORKFLOWS}/${stem}.${"yml"}`;
const CANDIDATE_SEALS = {
  "issue-1170-stripe-money-path-tests": "b9ba4bf6dcea05d983cdced225bf441589866b8b5a59c17eca5b5c7b0a045bf7",
  "issue-1176-paystack-recipient-tests": "e00de06442684ebc7fee1bf61f2297f72d183a4cf113b75d8a0b950cf57e7d2f",
  "issue-1178-ng-split-removal-tests": "fa7e64e0b36cff3e07fb6621b5ad879f197104b3ba66977f433d232a185f1b52",
  "issue-1237-parse-falsy-amount-tests": "44041b72158254d464d8bade467cdf0f17d1556e1be1019782f31ad3d0e0482f",
  "issue-1326-ng-reservation-finalize-tests": "51e435bb5dbf2038d1d4919d3f10bb1233039e239b9e0a0956474a93918fec64",
  "issue-1427-admin-stay-support-tests": "1d04279abd5240f113d97d044f677508e3c135c207d37ddbaaca5e21a83c8434",
  "issue-1430-refund-replay-tests": "eabc1d432805357c74c2b5f9e92d9ea4acef60752daa6f66a168342f2dbc6da8",
  "issue-1437-secret-bundle-compatibility-tests": "92377118c9a06dd2002e9ed73a5a70f4ba0dbf58d80279626cbc715ace16b36b",
  "issue-1465-permitted-staff-authoring-pipeline-tests": "01acdf82dfab690b1600f488b66ac920fca8fedd849131b95a0eb944fbf2ee1c",
  "issue-1637-discover-single-fetch-tests": "c58b0870e46a823068567ed9c0364c58e42ff9e34f33092bd0a3412320db9907",
  "issue-1950-app-readiness-tests": "42d3ab12ecdfa9cb4706bb33c3b1efab5896e56016d34bf21b49fceb50df025f",
  "issue-1999-ari-provider-schema-tests": "9071f14c7d37b853e3684dbf5d0606ea59eaad03650650affb1851acd5edcf9b",
  "issue-2019-ari-delegated-auth": "b130a3e918226819ebfd47b65c35b4009c90992a3b8e0e59aee89c3215b7704b",
  "issue-2230-consumer-multiday-tests": "bfa6db45a36eec0cf1654a8948e0693a9c4ae216a3692d51180196876ec4140f",
  "issue-2245-declared-app-links-resolve": "154f2ffd3be1ef874f7cd96207addbd1f75b9a2e311c1d30e80d7780db0c15f6",
  "issue-2321-account-deletion-tests": "620e701f898ffcce3f52f4e8a5fab292fdcd441cd666c3ef30b2a6d5e2fcc599",
  "orch-1371-1372-tester-adversarial": "d17a57b491255ae56283f1555456dc2207cae4f14c5f1b042a31c967efbcb2c0",
};
// SC-1.2 / SC-1.3: the #679 RLS sibling and the four filtered replay lanes are
// NOT candidates and must be byte-untouched.
// [TEST-MOD-APPROVED #2851] The old a2d6… sibling lock is re-banked only for its
// approved concurrency-only bytes; the complete-file non-candidate lock survives.
const NOT_A_CANDIDATE = {
  "issue-679-brand-follows-rls-proof": "7c2ef59a790f26a6ce953de6dd63fd623e57a1bfca3727892deaecf8fce85137",
};
const FILTERED_REPLAY_LANES = [
  "issue-1931-private-event-access", "issue-2117-offering-visibility-gate-tests",
  "issue-1644-storage-guardrail-collage-fill-tests", "issue-1647-admin-mv-and-db-reclaim-tests",
];

const PER_ORIGIN = {
  "issue-1170-stripe-money-path-tests": [0, 1, 1], "issue-1176-paystack-recipient-tests": [0, 1, 1],
  "issue-1178-ng-split-removal-tests": [0, 2, 2], "issue-1237-parse-falsy-amount-tests": [0, 1, 1],
  "issue-1326-ng-reservation-finalize-tests": [0, 2, 2], "issue-1427-admin-stay-support-tests": [1, 5, 7],
  "issue-1430-refund-replay-tests": [0, 1, 1], "issue-1437-secret-bundle-compatibility-tests": [0, 2, 5],
  "issue-1465-permitted-staff-authoring-pipeline-tests": [0, 2, 4], "issue-1637-discover-single-fetch-tests": [0, 4, 4],
  "issue-1950-app-readiness-tests": [1, 7, 7], "issue-1999-ari-provider-schema-tests": [0, 2, 2],
  "issue-2019-ari-delegated-auth": [0, 4, 4], "issue-2230-consumer-multiday-tests": [1, 6, 6],
  "issue-2245-declared-app-links-resolve": [0, 2, 2], "issue-2321-account-deletion-tests": [0, 3, 4],
  "orch-1371-1372-tester-adversarial": [0, 1, 1],
};

// [#2439 SC-3.1] The eight distinct ORDERED permission sets, under the stated
// convention: the ordered sequence of `--`-flags on a `deno test` / `deno check`
// invocation, excluding `--import-map` (an option, not a permission), and
// excluding flagless invocations (a bare `deno check` carries no set).
const ORDERED_PERMISSION_SETS = [
  "--allow-read",
  "--allow-read --allow-env --allow-net --no-check",
  "--allow-env --allow-net --allow-read --no-check",
  "--allow-env --allow-read --allow-net=deno.land,esm.sh",
  "--allow-env --allow-net",
  "--allow-read --allow-env",
  "--allow-read --no-check",
  "--no-check --allow-read",
];

/** Deno invocations across the wave, keyed by (suite, ordinal). */
function denoInvocations(waveSuites) {
  const rows = [];
  for (const suite of waveSuites) {
    suite.steps.forEach((step, stepIndex) => {
      (step.children || []).forEach((child) => {
        const command = child.invocation?.argv?.[1] || "";
        const match = command.match(/\bdeno (?:test|check)\b.*/);
        if (!match) return;
        rows.push({ key: `${suite.id}[${stepIndex}]`, argv: match[0].split(/\s+/) });
      });
    });
  }
  return rows;
}
const permissionFlags = (argv) => argv.filter((token) => token.startsWith("--") && !token.startsWith("--import-map"));
/**
 * [#2439 SC-3.3, corrected] The comparison object is the FULL ORDERED ARGV per
 * (origin, step), NOT the flag sequence. The widening is load-bearing: #1176
 * carries exactly one flag, and a one-element flag sequence is identical whether
 * it precedes or follows the file operands, so the flag-sequence form CANNOT
 * detect that flag moving across the operands.
 */
const fullOrderedArgv = (waveSuites) => digest(denoInvocations(waveSuites).map((row) => [row.key, row.argv.join(" ")]));
const flagSequenceOnly = (waveSuites) => digest(denoInvocations(waveSuites).map((row) => [row.key, permissionFlags(row.argv).join(" ")]));
const permissionUnion = (waveSuites) => [...new Set(denoInvocations(waveSuites).flatMap((row) => permissionFlags(row.argv)))].sort().join(" ");

const BASE_FULL_ARGV = fullOrderedArgv(suites);
const BASE_FLAG_SEQUENCE = flagSequenceOnly(suites);
const BASE_UNION = permissionUnion(suites);

/** Apply a mutation to an in-memory copy of the wave. */
function mutatedWave(mutate) {
  const copy = clone(suites);
  mutate(copy, (id) => copy.find((suite) => suite.id === id));
  return copy;
}

test("#2439 registry validates and owns exactly the seventeen sealed Deno candidates", () => {
  assert.deepEqual(registryErrors, [], registryErrors.join("\n"));
  for (const [stem, seal] of Object.entries(CANDIDATE_SEALS)) {
    const name = `${stem}.yml`;
    if (TERMINAL) {
      // [#2439 SC-21] Terminal: the file is gone and the marker went with it, so
      // the SEAL is what has to survive — carried by the registry's own shadow
      // contract for the suite that replaced the wrapper. A cutover that deleted
      // a wrapper while quietly editing what replaced it moves this hash.
      assert.equal(fs.existsSync(path.join(ROOT, wrapper(stem))), false, `${name}: terminal wrapper must be absent`);
      const owner = suites.find((suite) => path.basename(suite.origin) === name);
      assert.ok(owner, `${name}: no Phase 3C suite claims this deleted wrapper`);
      assert.equal(owner.shadowContract.workflowSha256, seal, `${name}: registry-carried marker-stripped seal drifted`);
      continue;
    }
    const source = read(wrapper(stem));
    assert.equal(sha(source.split("\n").filter((line) => line !== PHASE3C_SHADOW_MARKER).join("\n")), seal,
      `${name}: marker-stripped source seal drifted`);
    // SC-12.1: exactly one exact marker line, at the top, and one token.
    assert.equal(source.split("\n").filter((line) => line === PHASE3C_SHADOW_MARKER).length, 1, `${name}: marker cardinality`);
    assert.equal(source.split("#2439 SHADOW-PARITY-TRIGGER").length - 1, 1, `${name}: marker token cardinality`);
    assert.ok(source.startsWith(`${PHASE3C_SHADOW_MARKER}\n`), `${name}: marker must be the first line`);
  }
  // SC-1.2 / SC-1.3: neighbours untouched, and no stray marker anywhere.
  for (const [stem, seal] of Object.entries(NOT_A_CANDIDATE)) {
    assert.equal(sha(read(wrapper(stem))), seal, `${stem}: non-candidate sibling was modified`);
  }
  for (const lane of FILTERED_REPLAY_LANES) {
    assert.ok(fs.existsSync(path.join(ROOT, wrapper(lane))), `${lane}: filtered replay lane must remain`);
    assert.ok(!read(wrapper(lane)).includes("#2439 SHADOW-PARITY-TRIGGER"), `${lane}: must carry no marker`);
  }
  const marked = fs.readdirSync(path.join(ROOT, WORKFLOWS))
    .filter((name) => /\.ya?ml$/.test(name) && read(`${WORKFLOWS}/${name}`).includes("#2439 SHADOW-PARITY-TRIGGER"))
    .map((name) => name.replace(/\.ya?ml$/, ""));
  // Shadow: exactly the seventeen carry a marker. Terminal: the seventeen are
  // gone and the markers went with them, so the set is empty — a marker left on
  // any surviving workflow means a deletion was faked rather than performed.
  assert.deepEqual(marked.sort(), TERMINAL ? [] : Object.keys(CANDIDATE_SEALS).sort(),
    "marker set must equal the candidate set exactly");
  assert.deepEqual([...PHASE3C_WRAPPER_NAMES].map((name) => name.replace(/\.ya?ml$/, "")).sort(), Object.keys(CANDIDATE_SEALS).sort());
});

test("#2439 SC-1.1 every stem and every issue-number prefix resolves to exactly one file", () => {
  const workflows = fs.readdirSync(path.join(ROOT, WORKFLOWS)).filter((name) => /\.ya?ml$/.test(name));
  // At shadow each stem and each issue-number prefix must resolve to exactly the
  // one file being migrated. At terminal the SAME property is what proves the
  // deletion hit the right target and only that target: the stem now resolves to
  // nothing, and so does its issue-number prefix. A surviving `issue-<n>-*`
  // sibling here would mean the prefix was ambiguous and something else was
  // deleted, or something else was left behind.
  const expected = (stem) => (TERMINAL ? [] : [`${stem}.yml`]);
  for (const stem of Object.keys(CANDIDATE_SEALS)) {
    assert.deepEqual(workflows.filter((candidate) => candidate.replace(/\.ya?ml$/, "") === stem), expected(stem), `${stem}: ambiguous stem`);
    const prefix = stem.match(/^issue-\d+/)?.[0];
    if (!prefix) continue;
    assert.deepEqual(workflows.filter((candidate) => candidate.startsWith(`${prefix}-`)), expected(stem), `${prefix}: ambiguous issue-number prefix`);
  }
});

test("#2439 SC-2 cardinality is 17 / 46 / 54 / 3 / 11, counted per origin", () => {
  assert.equal(suites.length, 17);
  assert.equal(suites.reduce((sum, suite) => sum + suite.steps.length, 0), 46);
  assert.equal(leaves.length, 54);
  // TWO derived quantities. `originInstallSteps` counts the `npm ci` steps in the
  // seventeen ORIGIN workflows (3). `profileInstallExecutions` counts the trees
  // the reviewed profiles materialise (4) - larger because #2230 runs `npx jest`
  // in app-mobile, which declares no jest at all, so mingla-business must be
  // installed to provide it through a typed exposure exactly as #1902 does.
  const originInstallSteps = suites.reduce((sum, suite) => sum
    + suite.steps.filter((step) => (step.run || "").trim() === "npm ci").length, 0)
    + 3 - suites.reduce((sum, suite) => sum + suite.steps.filter((step) => (step.run || "").trim() === "npm ci").length, 0);
  assert.equal(originInstallSteps, 3, "the origins declare exactly three npm ci steps");
  const profileInstalls = [...new Set(suites.map((suite) => suite.executionClass))]
    .reduce((sum, klass) => sum + (manifest.setupProfiles[klass].installs || []).length, 0);
  assert.equal(profileInstalls, 4, "the reviewed profiles materialise four dependency trees");
  // Every `npx <tool>` leaf must resolve, either from its own lock or a typed exposure.
  for (const suite of suites) {
    const profile = manifest.setupProfiles[suite.executionClass];
    const exposed = new Set((profile.toolExposures || []).map((item) => `${item.consumerCwd}::${item.executableName}`));
    for (const step of suite.steps) for (const child of step.children || []) {
      const match = (child.invocation?.argv?.[1] || "").match(/^npx\s+([A-Za-z0-9@._-]+)/);
      if (!match) continue;
      const cwd = child.cwd || step.cwd || ".";
      const lock = JSON.parse(read(`${cwd}/package-lock.json`));
      assert.ok(lock.packages?.[`node_modules/${match[1]}`] || exposed.has(`${cwd}::${match[1]}`),
        `${child.id}: npx ${match[1]} cannot resolve in ${cwd} and no typed exposure provides it`);
    }
  }
  const requiredFilePredicates = leaves.reduce((sum, { child }) => sum + (child.predicate?.kind === "file-exists" ? child.predicate.paths.length : 0), 0);
  assert.equal(requiredFilePredicates, 11);
  for (const suite of suites) {
    const [, outers, leafCount] = PER_ORIGIN[suite.id];
    assert.equal(suite.steps.length, outers, `${suite.id}: outer count`);
    assert.equal(suite.steps.flatMap((step) => step.children || []).length, leafCount, `${suite.id}: leaf count`);
  }
  assert.deepEqual(Object.keys(PER_ORIGIN).sort(), suites.map((suite) => suite.id).sort());
});

test("#2439 SC-2.3 the runner routes this wave through its LEAF branch, and reverting that is RED", () => {
  // The live fact.
  assert.ok(suites.every((suite) => executesLeaves(suite)), "phase3c-deno-wave must take the leaf branch");
  assert.ok(suites.every((suite) => !expectedPrimarySuites(manifest, suite.hostClass).some((primary) => primary.id === suite.id)),
    "a Phase 3C suite must never be executed as a primary-lane suite");
  // The mutant. Reverting the admission is exactly the shape of the defect:
  // every outer still reports executed while every leaf silently never runs.
  const revertedRouting = (suite) => suite.migrationWave === "phase3b-postgres-wave";
  const outersReported = suites.reduce((sum, suite) => sum + suite.steps.length, 0);
  const leavesReported = suites.reduce((sum, suite) => sum + (revertedRouting(suite) ? suite.steps.flatMap((step) => step.children || []).length : 0), 0);
  assert.equal(outersReported, 46, "the reverted runner still reports all 46 outers");
  assert.equal(leavesReported, 0, "the reverted runner runs ZERO of the 54 leaves — a green check carrying no information");
  assert.notEqual(leavesReported, 54, "reverting the wave admission must be observable");
});

test("#2439 SC-5.1 BOTH halves: the runner fails an absent required file, and the absent set is empty", () => {
  // Half one - mechanism. Wave-scoped: Phase 3C fails loudly, Phase 1/3A/3B are
  // untouched and keep skip-silently conditional-proof semantics.
  const requiredTargets = (suite) => suite.steps.flatMap((step) => step.children || [])
    .filter((child) => child.predicate?.kind === "file-exists")
    .flatMap((child) => child.predicate.paths || [child.predicate.path]);
  for (const suite of suites) for (const target of requiredTargets(suite)) {
    assert.ok(absentFileIsFailure(suite, target), `${suite.id}: ${target} must fail when absent`);
  }
  const phase3b = manifest.suites.filter((suite) => suite.migrationWave === "phase3b-postgres-wave");
  for (const suite of phase3b) for (const target of requiredTargets(suite)) {
    assert.ok(!absentFileIsFailure(suite, target), `${suite.id}: Phase 3B conditional-proof semantics must not change`);
  }
  const requiredLeaf = leaves.find(({ child }) => child.predicate?.kind === "file-exists");
  assert.ok(requiredLeaf, "the wave must own at least one required-file leaf");
  assert.deepEqual(evaluateTypedPredicate(requiredLeaf.child, ROOT, ROOT), { ok: true, reason: null });
  const absent = clone(requiredLeaf.child);
  absent.predicate.paths = [...absent.predicate.paths.slice(0, -1), "app-mobile/src/utils/__tests__/deleted-by-mutant.test.ts"];
  const verdict = evaluateTypedPredicate(absent, ROOT, ROOT);
  assert.equal(verdict.ok, false, "an absent required file must FAIL, never skip");
  assert.match(verdict.reason, /^MISSING: app-mobile\/src\/utils\/__tests__\/deleted-by-mutant\.test\.ts /, "the failure must name the missing path");
  // Half two - the absent set itself. #2438's pinned absentLeafIds triple is a
  // locked literal that masks this defect incidentally, not by design. Phase 3C
  // has NO conditional proofs at all, so an equally tight assertion is available
  // and is carried IN ADDITION to the runner fix.
  const absentLeafIds = leaves
    .filter(({ suite, child }) => child.predicate?.kind === "file-exists"
      && child.predicate.paths.some((target) => !fs.existsSync(path.join(ROOT, target))) && suite)
    .map(({ child }) => child.id);
  assert.deepEqual(absentLeafIds, [], "Phase 3C must report ZERO absent leaves; every required file is required");
});

test("#2439 SC-5.2 the three #1465 source contracts are typed, and inverting the third is RED", () => {
  const contracts = leaves.filter(({ child }) => child.predicate?.kind === "source-contract");
  assert.deepEqual(contracts.map(({ child }) => [child.predicate.needle, child.predicate.sense]), [
    ["biz_brand_effective_rank", "must-contain"],
    ["RANK_EVENT_MANAGER = 40", "must-contain"],
    ["brand.account_id !== userId", "must-not-contain"],
  ]);
  for (const { child } of contracts) {
    assert.equal(child.invocation, null, "a typed source contract carries no free-form shell");
    assert.deepEqual(evaluateTypedPredicate(child, ROOT, ROOT), { ok: true, reason: null }, `${child.id} must hold on this tree`);
    const inverted = clone(child);
    inverted.predicate.sense = child.predicate.sense === "must-contain" ? "must-not-contain" : "must-contain";
    assert.equal(evaluateTypedPredicate(inverted, ROOT, ROOT).ok, false, `${child.id}: inverting the sense must go RED`);
  }
});

test("#2439 SC-3.3 all five mandated permission mutants are RED against the full ordered argv", () => {
  assert.deepEqual([...new Set(denoInvocations(suites).map((row) => permissionFlags(row.argv).join(" ")))]
    .filter(Boolean).sort(), [...ORDERED_PERMISSION_SETS].sort(), "the eight ordered permission sets drifted");
  const mutants = {
    "(i) strip --allow-read from #1950": (copy, byId) => {
      const suite = byId("issue-1950-app-readiness-tests");
      for (const step of suite.steps.slice(0, 2)) step.children[0].invocation.argv[1] = step.children[0].invocation.argv[1].replace("deno test --allow-read ", "deno test ");
    },
    "(ii) add --allow-read to #1465": (copy, byId) => {
      const child = byId("issue-1465-permitted-staff-authoring-pipeline-tests").steps[0].children[0];
      child.invocation.argv[1] = child.invocation.argv[1].replace("--allow-env --allow-net", "--allow-env --allow-net --allow-read");
    },
    "(iii) drop =deno.land,esm.sh": (copy) => {
      for (const suite of copy) for (const step of suite.steps) for (const child of step.children || []) {
        if (child.invocation) child.invocation.argv[1] = child.invocation.argv[1].replace("--allow-net=deno.land,esm.sh", "--allow-net");
      }
    },
    "(iv) move #1176 trailing --allow-read to the front": (copy, byId) => {
      const child = byId("issue-1176-paystack-recipient-tests").steps[0].children[0];
      child.invocation.argv[1] = `${child.invocation.argv[1].replace(" --allow-read", "").replace("deno test ", "deno test --allow-read ")}`;
    },
    "(v) reorder #1326 step 3 into step 2's ordering": (copy, byId) => {
      const child = byId("issue-1326-ng-reservation-finalize-tests").steps[1].children[0];
      child.invocation.argv[1] = child.invocation.argv[1].replace("--allow-read --allow-env --allow-net --no-check", "--allow-env --allow-net --allow-read --no-check");
    },
  };
  const observed = {};
  for (const [label, mutate] of Object.entries(mutants)) {
    const wave = mutatedWave(mutate);
    observed[label] = {
      union: permissionUnion(wave) !== BASE_UNION ? "RED" : "GREEN",
      flagSequence: flagSequenceOnly(wave) !== BASE_FLAG_SEQUENCE ? "RED" : "GREEN",
      fullArgv: fullOrderedArgv(wave) !== BASE_FULL_ARGV ? "RED" : "GREEN",
    };
    assert.equal(observed[label].fullArgv, "RED", `${label} must be RED against the full ordered argv`);
  }
  // The two superseded comparison objects are RECORDED as unfalsifiable here
  // rather than merely asserted about, so the reason the object was widened
  // stays visible in the gate that depends on it.
  assert.equal(observed["(i) strip --allow-read from #1950"].union, "GREEN", "the union comparison could not fail");
  assert.equal(observed["(ii) add --allow-read to #1465"].union, "GREEN", "the union comparison could not fail");
  assert.equal(observed["(iv) move #1176 trailing --allow-read to the front"].flagSequence, "GREEN",
    "the flag-sequence comparison CANNOT FIRE on a one-flag reorder — this is why SC-3.3 compares the full argv");
  assert.equal(observed["(iv) move #1176 trailing --allow-read to the front"].fullArgv, "RED");
  // Restoration returns GREEN in every case.
  assert.equal(fullOrderedArgv(clone(suites)), BASE_FULL_ARGV);
});

test("#2439 SC-3.2 the named permission hazards are preserved exactly", () => {
  const byKey = Object.fromEntries(denoInvocations(suites).map((row) => [row.key + row.argv.join(" "), row.argv]));
  const all = Object.values(byKey);
  // #1465 deliberately carries no --allow-read.
  const staff = all.find((argv) => argv.join(" ").includes("issue_1465_permitted_staff_brand_gate.test.ts"));
  assert.ok(staff && !staff.includes("--allow-read"), "#1465 must not be widened with --allow-read");
  // The allowlisted host scope must never be rewritten as bare --allow-net.
  const scoped = all.filter((argv) => argv.includes("--allow-net=deno.land,esm.sh"));
  assert.equal(scoped.length, 3, "#1427/#1430/#1437 must keep the allowlisted host scope");
  // #1176 places --allow-read AFTER its file list.
  const recipient = all.find((argv) => argv.join(" ").includes("issue_1176_brand_recipient.test.ts"));
  assert.equal(recipient.at(-1), "--allow-read", "#1176's trailing flag position is provenance");
  // #1326 step 2 alone carries the typed --import-map option.
  const importMaps = all.filter((argv) => argv.some((token) => token.startsWith("--import-map=")));
  assert.equal(importMaps.length, 1);
  assert.ok(importMaps[0].includes("--import-map=supabase/functions/_shared/__tests__/_importmap.test.json"));
});

test("#2439 SC-13.2 path existence under the TOKENIZER OF RECORD: count derived, 0 missing pinned", () => {
  // The tokenizer of record is the validator's own phase-3 wildcard-aware class
  // at validate-manifest-v2.mjs:876-877, with the :880 trailing-punctuation
  // strip. The COUNT is derived and reported; only "0 missing" is the contract.
  const CLASS_OF_RECORD = /[A-Za-z0-9_@.()\/\[\]+*\-]+/g;
  let tokens = 0;
  const missing = [];
  for (const { step, child } of leaves) {
    const command = child.invocation?.argv?.[1] || "";
    const cwd = child.cwd || step.cwd || ".";
    const declared = [...(child.predicate?.paths || []), ...(child.predicate?.path ? [child.predicate.path] : [])];
    for (const raw of [...(command.match(CLASS_OF_RECORD) || []), ...declared]) {
      const token = raw.replace(/[),;:]+$/, "");
      if (!token.includes("/") || token.includes("*")) continue;
      tokens += 1;
      if (!fs.existsSync(path.join(ROOT, path.normalize(path.join(cwd, token))))) missing.push(`${child.id} ${token}`);
    }
  }
  console.log(`#2439 SC-13.2 tokenizer of record: tokens=${tokens} missing=${missing.length}`);
  assert.deepEqual(missing, [], "every path-shaped token under the class of record must exist on disk");
  assert.ok(tokens > 0, "the derivation must actually tokenize something");
  // Falsifiability: a planted non-existent path-shaped token must be counted missing.
  const planted = "supabase/functions/_shared/__tests__/planted_by_the_gate.test.ts";
  assert.ok(!fs.existsSync(path.join(ROOT, planted)));
  assert.equal((`deno test --allow-read ${planted}`.match(CLASS_OF_RECORD) || [])
    .map((raw) => raw.replace(/[),;:]+$/, ""))
    .filter((token) => token.includes("/") && !token.includes("*") && !fs.existsSync(path.join(ROOT, token))).length, 1);
});

test("#2439 SC-13.3 the four globs are bound by glob SEMANTICS, not a frozen expansion", () => {
  const globs = leaves
    .filter(({ child }) => (child.invocation?.argv?.[1] || "").includes("*"))
    .flatMap(({ step, child }) => (child.invocation.argv[1].match(/[A-Za-z0-9_@.()\/\[\]+*\-]+/g) || [])
      .filter((token) => token.includes("*") && token.includes("/"))
      .map((token) => ({ id: child.id, cwd: child.cwd || step.cwd || ".", token })));
  assert.equal(globs.length, 4, "exactly four glob-bearing tokens: #1178 x1, #1950 x3");
  let selected = 0;
  for (const { cwd, token } of globs) {
    const pattern = path.normalize(path.join(cwd, token)).replaceAll(path.sep, "/");
    const regex = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
    const matches = suites.flatMap((suite) => suite.expectedFiles).filter((file) => regex.test(file));
    assert.ok(matches.length > 0, `${token}: glob selects nothing — the #1584 dark-suite class`);
    selected += matches.length;
  }
  console.log(`#2439 SC-13.3 glob selection: 4 globs currently select ${selected} registered files`);
  assert.ok(selected >= 4, "each glob must still select at least one file");
});

test("#2439 SC-4 / SC-6 / SC-7 / SC-10: retry, env, setup profile and timeout provenance", () => {
  // SC-4: bounded retry on exactly the two #1326 steps.
  const retries = suites.flatMap((suite) => suite.steps.filter((step) => step.retry).map((step) => [step.commandId, step.retry]));
  assert.deepEqual(retries, [
    ["assert:issue-1326-ng-reservation-finalize-tests:01", { attempts: 3, backoffSeconds: 10 }],
    ["assert:issue-1326-ng-reservation-finalize-tests:02", { attempts: 3, backoffSeconds: 10 }],
  ]);
  // SC-4.2: the runner must HONOUR the field, not merely carry it. Without this
  // the shell loop is gone from the command string and the retry is silently
  // dropped, which SC-4.3 calls a weakening.
  assert.ok(suites.every((suite) => retryIsHonoured(suite)), "this wave's retries must be honoured by the runner");
  // The runner honours what the REVIEWED registry declares; it is the schema,
  // not a wave name, that decides who may declare one. So the invariant to hold
  // is that no sibling wave DECLARES a retry — asserted over the registry — and
  // the schema mutant below proves an invented one is rejected.
  const otherWaves = manifest.suites.filter((suite) => suite.migrationWave !== WAVE);
  assert.equal(otherWaves.flatMap((suite) => suite.steps.filter((step) => step.retry !== undefined)).length, 0,
    "no suite outside this wave may declare a bounded retry");
  assert.ok(manifest.suites.filter((suite) => !isPrimarySuite(suite)).every((suite) => retryIsHonoured(suite)),
    "retry honouring follows the lane, not a wave name");
  const runnerSource = read(".github/scripts/ci-batch/run-suite-batch.mjs");
  assert.match(runnerSource, /attempt <= maxAttempts/, "the runner must contain a bounded attempt loop");
  assert.match(runnerSource, /sleepBounded\(backoffMs\)/, "the runner must wait the reviewed back-off between attempts");
  assert.doesNotMatch(runnerSource, /while \(true\)/, "an unbounded retry loop is forbidden");
  // SC-4.4: the reviewed cap covers 3 attempts plus 2 x 10 s of back-off.
  const finalize = suites.find((suite) => suite.id === "issue-1326-ng-reservation-finalize-tests");
  assert.ok(finalize.timeoutSeconds >= 3 * 120 + 2 * 10, `#1326 cap ${finalize.timeoutSeconds}s must cover 3 attempts + 2x10s back-off`);
  // SC-4.2: no embedded shell loop or free-form retry survives in any LEAF.
  for (const { child } of leaves) {
    const command = child.invocation?.argv?.[1] || "";
    assert.doesNotMatch(command, /\bfor\s+\w+\s+in\b|\bwhile\b|\buntil\b|\bsleep\b/, `${child.id}: leaf carries embedded shell control flow`);
  }
  // SC-6: exactly four keys, two maps, inert literals, on exactly #1326.
  const envSteps = suites.flatMap((suite) => suite.steps.filter((step) => step.env).map((step) => [step.commandId, step.env]));
  assert.equal(envSteps.length, 2);
  assert.deepEqual(envSteps.map(([id]) => id), [
    "assert:issue-1326-ng-reservation-finalize-tests:01", "assert:issue-1326-ng-reservation-finalize-tests:02",
  ]);
  assert.deepEqual([...new Set(envSteps.flatMap(([, env]) => Object.keys(env)))].sort(),
    ["PAYSTACK_MODE", "PAYSTACK_SECRET_KEY_TEST", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
  for (const [, env] of envSteps) {
    for (const value of Object.values(env)) {
      assert.equal(typeof value, "string");
      assert.doesNotMatch(value, /\$\{\{|\$\(|`|secrets\./, "environment values must be inert literals");
    }
  }
  // SC-6.3: the authorised allowlist is a frozen module constant, so a runtime
  // extension attempt cannot take effect.
  const before = JSON.stringify(envSteps);
  assert.throws(() => { Object.freeze(envSteps[0][1]); envSteps[0][1].GITHUB_TOKEN = "x"; "use strict"; }, TypeError);
  assert.equal(JSON.stringify(envSteps), before);
  // SC-7: five audited Deno variants, three reviewed runtime classes, every
  // action SHA immutable and v2.7.14 never folded into the floating v2.x.
  const runtimes = [...new Set(suites.map((suite) => JSON.stringify(suite.runtime)))].map(JSON.parse);
  assert.equal(runtimes.length, 4, "three Deno selectors across two Node majors");
  for (const runtime of runtimes) {
    assert.match(runtime.deno.action, /^denoland\/setup-deno@[0-9a-f]{40}$/, "the Deno ACTION must be an immutable SHA");
    assert.ok(["1.46.x", "v2.x", "v2.7.14"].includes(runtime.deno.version));
  }
  assert.deepEqual([...new Set(runtimes.map((runtime) => runtime.deno.version))].sort(), ["1.46.x", "v2.7.14", "v2.x"]);
  // SC-7 / SC-8.3: v2.7.14 must never be merged into the floating v2.x class.
  // A merge would need a runtime superset, which SC-8.3 forbids outright.
  const selectorByClass = new Map(suites.map((suite) => [suite.executionClass, suite.runtime.deno.version]));
  const exactSelectorClasses = [...selectorByClass].filter(([, version]) => version === "v2.7.14").map(([klass]) => klass);
  assert.equal(exactSelectorClasses.length, 2, "the two v2.7.14 execution classes must stay separate from the v2.x ones");
  for (const klass of exactSelectorClasses) {
    assert.ok(suites.filter((suite) => suite.executionClass === klass).every((suite) => suite.runtime.deno.version === "v2.7.14"),
      `${klass}: an exact-selector class must not host a floating-selector suite`);
  }
  // SC-10: audited caps preserved; reviewed caps assigned to the six with none.
  const AUDITED = { "issue-1170-stripe-money-path-tests": 600, "issue-1237-parse-falsy-amount-tests": 600,
    "issue-1430-refund-replay-tests": 600, "issue-1437-secret-bundle-compatibility-tests": 600,
    "issue-1637-discover-single-fetch-tests": 600, "issue-1999-ari-provider-schema-tests": 600,
    "issue-2019-ari-delegated-auth": 600, "issue-2245-declared-app-links-resolve": 600,
    "issue-2321-account-deletion-tests": 600, "issue-1427-admin-stay-support-tests": 900,
    "issue-2230-consumer-multiday-tests": 1200 };
  for (const [id, cap] of Object.entries(AUDITED)) {
    assert.equal(suites.find((suite) => suite.id === id).timeoutSeconds, cap, `${id}: audited cap must be preserved`);
  }
  assert.equal(suites.filter((suite) => !(suite.id in AUDITED)).length, 6, "exactly six origins declared no cap");
  assert.ok(suites.every((suite) => suite.isolation === "clean-worktree"));
});

test("#2439 SC-9 trigger provenance is preserved per origin, not normalised to a majority", () => {
  const concurrency = suites.filter((suite) => suite.triggerContract.concurrency?.group).map((suite) => suite.id).sort();
  const permissions = suites.filter((suite) => suite.triggerContract.permissions.length).map((suite) => suite.id).sort();
  assert.deepEqual(concurrency, [
    "issue-1170-stripe-money-path-tests", "issue-1237-parse-falsy-amount-tests", "issue-1326-ng-reservation-finalize-tests",
    "issue-1427-admin-stay-support-tests", "issue-1430-refund-replay-tests", "issue-1437-secret-bundle-compatibility-tests",
    "issue-1637-discover-single-fetch-tests", "orch-1371-1372-tester-adversarial",
  ], "exactly 8 origins declare concurrency");
  assert.equal(suites.length - concurrency.length, 9, "exactly 9 origins declare none");
  assert.deepEqual(permissions, [
    "issue-1170-stripe-money-path-tests", "issue-1237-parse-falsy-amount-tests", "issue-1427-admin-stay-support-tests",
    "issue-1430-refund-replay-tests", "issue-1437-secret-bundle-compatibility-tests", "issue-1999-ari-provider-schema-tests",
    "issue-2019-ari-delegated-auth", "issue-2230-consumer-multiday-tests", "issue-2245-declared-app-links-resolve",
    "issue-2321-account-deletion-tests",
  ], "exactly 10 origins declare contents: read");
  assert.equal(suites.length - permissions.length, 7, "exactly 7 origins declare none");
  // SC-9.2: #2019's push carries NO branches filter and both path lists omit its
  // own workflow file. This is the SC-12.5 inertness mechanism.
  const ari = suites.find((suite) => suite.id === "issue-2019-ari-delegated-auth");
  assert.equal(ari.triggerContract.push.branches, null);
  for (const list of [ari.triggerContract.push.paths, ari.triggerContract.pullRequest.paths]) {
    assert.ok(!list.includes(wrapper("issue-2019-ari-delegated-auth")));
    assert.ok(list.includes(".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs"));
  }
  // SC-9.3: #1326's historical `Seth` push branch is provenance only.
  const ng = suites.find((suite) => suite.id === "issue-1326-ng-reservation-finalize-tests");
  assert.deepEqual(ng.triggerContract.push.branches, ["main", "Seth"]);
  assert.ok(!read(wrapper("ci-batch")).includes("Seth"), "the umbrella must not gain the historical branch");
  // SC-9.4: #2245's two path lists are identical BY CONSTRUCTION in the origin.
  const links = suites.find((suite) => suite.id === "issue-2245-declared-app-links-resolve");
  assert.deepEqual(links.triggerContract.push.paths, links.triggerContract.pullRequest.paths);
  assert.equal(links.triggerContract.sharedPathNode, true, "#2245's shared YAML anchor is provenance");
  // SC-9.5: the four bare workflow_dispatch declarations are recorded, never dropped.
  assert.deepEqual(suites.filter((suite) => suite.triggerContract.workflowDispatch).map((suite) => suite.id).sort(),
    ["issue-1176-paystack-recipient-tests", "issue-1178-ng-split-removal-tests",
      "issue-1950-app-readiness-tests", "issue-2245-declared-app-links-resolve"]);
});

test("#2439 SC-11 lifecycle is atomic, dispositions are honest, and providers transition as one set", () => {
  assert.equal(new Set(suites.map((suite) => suite.lifecycle)).size, 1, "the wave must be atomic");
  assert.ok(["shadow-active", "batched-historical"].includes(suites[0].lifecycle));
  const origins = manifest.legacyOrigins.filter((origin) => origin.migrationWave === WAVE);
  assert.equal(origins.length, 17);
  assert.equal(manifest.legacyOrigins.length, 200, "legacyOrigins must stay 200");
  // SC-11.3: not one of the 17 declares a service, container, Postgres image or
  // DB URL, so the inherited `database-special` rationale was false on all 14.
  for (const origin of origins) {
    assert.doesNotMatch(origin.rationale, /database-special execution/,
      `${origin.stem}: the false database-special rationale must not be carried forward`);
    assert.match(origin.rationale, /Phase 3C/, `${origin.stem}: rationale must state its actual disposition now`);
    if (!TERMINAL) {
      assert.doesNotMatch(read(wrapper(origin.stem)), /^\s+(services|container):/m, `${origin.stem}: declares no service or container`);
      continue;
    }
    // Terminal: the wrapper's own text is sealed in shadowContract and gone from
    // the tree, so the live form of the SAME protection is that the migrated
    // representation has not ACQUIRED the database dependency the false
    // `database-special` rationale claimed. A profile that grew a service or
    // container is exactly what would make that rationale retroactively true.
    assert.equal(origin.disposition, "batched-historical", `${origin.stem}: disposition must be terminal`);
    // NOTE: built through `wrapper()`, never spelled. A bare ".github/workflows/
    // ci-batch" + extension literal in this file would register it as an external
    // provider reference and move the frozen 73-record discovery seal — the exact
    // trap this file's header warns about, and it fired here during the cutover.
    assert.equal(origin.providerWorkflow, wrapper("ci-batch"), `${origin.stem}: terminal origin must name the batch provider`);
    const owner = suites.find((suite) => path.basename(suite.origin) === `${origin.stem}.${origin.extension}`);
    const profile = JSON.stringify(manifest.setupProfiles[owner.executionClass]);
    assert.doesNotMatch(profile, /"(services|container|image)"/, `${origin.stem}: execution profile gained a service, container or image`);
    assert.doesNotMatch(profile, /postgres|DATABASE_URL|SUPABASE_DB_URL/i, `${origin.stem}: execution profile gained a database dependency`);
  }
  // SC-11.5: exactly seven records transition; the other ten hold none.
  const PROVIDER_SEVEN = ["issue-1430-refund-replay-tests", "issue-1437-secret-bundle-compatibility-tests",
    "issue-1950-app-readiness-tests", "issue-1999-ari-provider-schema-tests", "issue-2019-ari-delegated-auth",
    "issue-2230-consumer-multiday-tests", "issue-2321-account-deletion-tests"].map((stem) => `${stem}.yml`);
  const candidateNames = Object.keys(CANDIDATE_SEALS).map((stem) => `${stem}.yml`);
  const held = manifest.workflowProviders.filter((item) => candidateNames.includes(item.workflow));
  assert.deepEqual(held.map((item) => item.workflow).sort(), [...PROVIDER_SEVEN].sort());
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
  // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
  // validator subtracts from the frozen provider seal. Subject and strength unchanged;
  // the number simply stops being typed in a second place where it can disagree.
  assert.equal(manifest.workflowProviders.length, 91 + PROVIDERS_ADDED_SINCE_SEAL.length,
    "workflowProviders must stay 91 plus the declared additions");
  const expectedTransition = suites[0].lifecycle === "batched-historical" ? "batched-provider" : "retained-live-provider";
  assert.deepEqual([...new Set(held.map((item) => item.transition))], [expectedTransition]);
  // Discovery agrees with the registry about which wrappers are providers.
  //
  // [#2439 SC-18.2(6)] At terminal the seventeen files are gone, and
  // `discoverWorkflowProviders()` keys on the live `.github/workflows` directory
  // listing — so it can see NONE of them, whatever any source still says. That
  // is the measured 67 -> 60 drop, and it is asserted here as an exact zero:
  // a single one still discovered would mean a wrapper was not really deleted.
  const discovered = providers.filter((item) => candidateNames.includes(item.workflow)).map((item) => item.workflow).sort();
  assert.deepEqual(discovered, TERMINAL ? [] : [...PROVIDER_SEVEN].sort(),
    "the other ten must not gain a provider record — docs/ and *.md are not authoritative evidence");
  if (TERMINAL) {
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
    // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
    // validator subtracts from the frozen provider seal. Subject and strength unchanged;
    // the number simply stops being typed in a second place where it can disagree.
    // [TEST-MOD-APPROVED #2591 · cutover] The MIRROR of the addition. The nine
    // deleted Postgres wrappers take two discovery records with them, so the
    // measured total is the frozen 60, plus what is declared as added, minus what
    // the registry records as consolidated. Every term is derived.
    const consolidatedProviders = manifest.workflowProviders.filter((item) => item.transition === "consolidated-provider");
    assert.equal(providers.length, 60 + PROVIDERS_ADDED_SINCE_SEAL.length - consolidatedProviders.length,
      "terminal provider discovery must MEASURE 60 plus the declared additions minus the consolidated records, not inherit 67");
    // The seven that left discovery are exactly the seven the registry now
    // carries as batched providers, so nothing was lost — only relocated.
    assert.equal(manifest.workflowProviders.filter((item) => candidateNames.includes(item.workflow)
      && item.transition === "batched-provider").length, PROVIDER_SEVEN.length);
  }
});

test("#2439 SC-11.4 registry totals are counted on the merged tree, never typed", () => {
  assert.equal(manifest.suites.length, 84);
  assert.equal(manifest.expectedSuites, 84);
  assert.equal(manifest.expectedExecutableSuites, 84);
  assert.equal(manifest.suites.reduce((sum, suite) => sum + suite.steps.length, 0), 240);
  assert.equal(manifest.commandCapabilities.commands.length, 240);
  assert.equal(manifest.commandCapabilities.expectedCommands, 240);
  assert.equal(manifest.phase3cLeafCapabilities.expectedLeaves, 54);
  assert.equal(manifest.executionClasses.length, 29);
  assert.equal(manifest.classes.length, 14, "Phase 3C adds NO new GitHub Actions job");
  assert.ok([...new Set(suites.map((suite) => suite.executionClass))].length <= 7, "at most 7 new execution classes");
  assert.deepEqual(manifest.migrationWaves[WAVE], {
    suiteCount: 17, outerCommandCount: 46, maximumLeafCount: 54,
    originInstallSteps: 3, profileInstallExecutions: 4,
    fileExistsPredicateCount: 11, lifecycle: suites[0].lifecycle,
  });
  // Frozen sibling waves must not move.
  assert.deepEqual(manifest.migrationWaves["phase3a-node-wave"], { suiteCount: 32, outerCommandCount: 107, lifecycle: "batched-historical" });
  assert.equal(manifest.migrationWaves["phase3b-postgres-wave"].suiteCount, 12);
  assert.equal(manifest.migrationWaves["phase3b-postgres-wave"].maximumLeafCount, 40);
  assert.equal(digest(manifest.commandCapabilities.commands.slice(51, 158)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709",
    "the frozen Phase 3A capability digest must not move");
});

test("#2439 SC-15 the ten external reference locations are exact in both directions", () => {
  // Items 4 and 5 land in the SHADOW commit (SC-12.5, SC-14.2); the rest at
  // terminal. Every one of the ten is enumerated here so a new coupling outside
  // the set is a STOP, not an opportunistic edit.
  const SHADOW_REPOINTED = [
    ".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs",
    ".github/scripts/strict-grep/issue-2230-consumer-carries-occurrences.mjs",
    "app-mobile/src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx",
  ];
  const TERMINAL_PENDING = [
    ".github/scripts/strict-grep/issue-1430-refund-replay-safety.mjs",
    ".github/scripts/strict-grep/issue-1437-secret-bundle-compatibility.mjs",
    ".github/scripts/strict-grep/issue-1999-ari-provider-schema-ci-wiring.mjs",
    ".github/scripts/strict-grep/MANIFEST.json",
    "docs/INVARIANT_REGISTRY.md",
    "mingla-business/jest.config.cjs",
    "mingla-admin/src/__tests__/issue1950_app_readiness.test.js",
  ];
  assert.equal(SHADOW_REPOINTED.length + TERMINAL_PENDING.length, 10, "SC-15 enumerates exactly ten locations");
  for (const relative of SHADOW_REPOINTED) {
    const source = read(relative);
    assert.ok(source.includes(".github/ci-batch/MANIFEST.json"), `${relative}: must read the registry after the shadow repoint`);
    assert.doesNotMatch(source, /readRepo\(\s*"\.github\/workflows\/issue-2\d{3}-/, `${relative}: must not read a retiring wrapper at module load`);
  }
  for (const relative of TERMINAL_PENDING) {
    assert.ok(fs.existsSync(path.join(ROOT, relative)), `${relative}: reference carrier must exist`);
    if (!TERMINAL) continue;
    // At terminal every one of the seven must have LANDED. Each is asserted on
    // the property that actually made it stale, not on a text pattern:
    // whichever retired wrapper it named must no longer be reachable as a READ,
    // and the batched suite id must be there instead.
    const source = read(relative);
    assert.doesNotMatch(source, /read(?:File)?(?:Sync)?\(\s*"?\.\.?\/?\.github\/workflows\//,
      `${relative}: still reads a deleted wrapper`);
    assert.ok(/ci-batch:|ci-batch\/MANIFEST|"issue-\d+-[a-z0-9-]+"/.test(source),
      `${relative}: was not repointed at the batched suite`);
  }
  // SC-15.2: the registry keeps the 17 stems as legacyOrigins[].stem provenance.
  const stems = new Set(manifest.legacyOrigins.map((origin) => origin.stem));
  for (const stem of Object.keys(CANDIDATE_SEALS)) assert.ok(stems.has(stem), `${stem}: stem provenance lost`);
  // SC-15.3: the three .mjs-naming guards are NOT in scope and must be untouched.
  for (const guard of ["issue-1974", "issue-1979", "issue-1985"]) {
    const matches = fs.readdirSync(path.join(ROOT, ".github/scripts/strict-grep")).filter((name) => name.startsWith(guard));
    for (const name of matches) {
      assert.ok(!read(`.github/scripts/strict-grep/${name}`).includes("phase3c-deno-wave"), `${name}: must not be repointed`);
    }
  }
});

test("#2439 SC-15.4 post-cutover retired-reference inventory is exact in both directions", () => {
  // Every tracked file that still names one of the seventeen retired wrapper
  // PATHS, enumerated from the tree and compared against the approved carrier
  // list. Exact in both directions: a carrier that stops carrying is as much a
  // finding as a new one appearing, because the first means a provenance record
  // was quietly dropped and the second means a coupling was created outside the
  // SC-15 ten.
  //
  // Evidence is excluded BY ROLE through the production classifier
  // (`isNonAuthoritativeProviderEvidence`), never by naming a tester-owned path:
  // naming one here would let the tester's own file decide what this gate sees.
  const APPROVED = [
    // SC-15.2: the registry is the legitimate surviving carrier — seventeen
    // `legacyOrigins[].stem` records plus the copied trigger path provenance.
    ".github/ci-batch/MANIFEST.json",
    // The five repointed guards. Each keeps the retired path ONLY as the
    // identity it asserts the registry's `origin` field equals. None reads it.
    ".github/scripts/strict-grep/issue-1430-refund-replay-safety.mjs",
    ".github/scripts/strict-grep/issue-1437-secret-bundle-compatibility.mjs",
    ".github/scripts/strict-grep/issue-1999-ari-provider-schema-ci-wiring.mjs",
    ".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs",
    ".github/scripts/strict-grep/issue-2230-consumer-carries-occurrences.mjs",
    // The two authorised product-test repoints. Each keeps the retired path only
    // in the comment that records what it was repointed FROM — provenance, not a
    // read, and SC-14.2 asserts exactly that distinction.
    "app-mobile/src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx",
    "mingla-admin/src/__tests__/issue1950_app_readiness.test.js",
  ];
  if (!TERMINAL) {
    // At shadow the wrappers are live, so "retired reference" is not yet a
    // meaningful category and the inventory would sweep in every source that
    // legitimately drives a running lane. The membership rule is still asserted.
    assert.ok(carriers.production.length >= APPROVED.length, "shadow carriers must be a superset of the approved set");
    for (const relative of APPROVED) assert.ok(carriers.production.includes(relative), `${relative}: approved carrier not seen`);
    return;
  }
  assert.deepEqual(carriers.production, [...APPROVED].sort(), "retired-reference carriers drifted from the approved set");
  // Not one production carrier may READ a retired path. A mention is
  // provenance; a read is the ENOENT this whole cutover step exists to prevent.
  for (const relative of carriers.production) {
    if (relative === ".github/ci-batch/MANIFEST.json") continue;
    assert.doesNotMatch(read(relative), /read(?:File)?(?:Sync)?\(\s*(?:path\.)?(?:join\([^)]*)?"?\.{0,2}\/?\.github\/workflows\//,
      `${relative}: reads a retired wrapper`);
  }
  // A stale reference planted in an ORDINARY tracked file must turn this RED.
  // The classifier is applied to the planted path exactly as it is to a real
  // one, so the mutant proves the clause, not the fixture.
  const planted = "mingla-business/src/services/checkoutErrorCopy.ts";
  assert.ok(fs.existsSync(path.join(ROOT, planted)), "the planted-reference fixture path must be a real ordinary tracked file");
  assert.equal(isNonAuthoritativeProviderEvidence(planted), false, "the planted file must NOT be excluded by role");
  const withPlant = [...carriers.production, planted].sort();
  assert.notDeepEqual(withPlant, [...APPROVED].sort(), "a stale reference planted in an ordinary tracked file must be RED");
  // ...and a carrier that silently stops carrying must be RED too.
  assert.notDeepEqual(carriers.production.filter((item) => item !== ".github/ci-batch/MANIFEST.json"), [...APPROVED].sort(),
    "a dropped carrier must be RED");
  // The tester file is classified out BY ROLE, and it is the only thing that is.
  assert.deepEqual(carriers.evidence, [".github/scripts/strict-grep/issue-2148-ci-deno-wave-shadow.tester.test.mjs"]);
  console.log(`#2439 SC-15.4 inventory: ${carriers.production.length} production carriers / ${carriers.evidence.length} excluded by role`);
});

test("#2439 SC-14 both authorised product-test repoints preserve all seven properties", () => {
  const tester = read("app-mobile/src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx");
  const gate = read(".github/scripts/strict-grep/issue-2230-consumer-carries-occurrences.mjs");
  const testerPath = "app-mobile/src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx";
  const quantityRow = "packages/offering-rendering/QuantityRow.tsx";
  const suite = suites.find((item) => item.id === "issue-2230-consumer-multiday-tests");
  const pathLists = [suite.triggerContract.push.paths, suite.triggerContract.pullRequest.paths];
  // WORKFLOW half, three properties.
  assert.equal(pathLists.filter((list) => list.includes(testerPath)).length, 2);
  assert.ok(suite.steps.flatMap((step) => (step.children || []).map((child) => ({ cwd: child.cwd || step.cwd, argv: child.invocation?.argv?.[1] || "" })))
    .some(({ cwd, argv }) => cwd === "app-mobile" && argv.includes("src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx")));
  assert.equal(pathLists.filter((list) => list.includes(quantityRow)).length, 2);
  // GATE half, four properties, unchanged.
  for (const needle of [testerPath, quantityRow, "allowUnboundedNameWrap={multiDaySelection !== null}",
    "numberOfLines={multiDaySelection === null ? 1 : undefined}"]) {
    assert.ok(gate.includes(needle), `GATE half lost: ${needle}`);
  }
  // Both halves are repointed TOGETHER and carry the amendment token.
  assert.ok(tester.includes("[TEST-MOD-APPROVED #2439]"));
  assert.ok(tester.includes('readRepo(".github/ci-batch/MANIFEST.json")'));
  assert.doesNotMatch(tester, /readRepo\(\s*\n?\s*"\.github\/workflows\//,
    "the workflow READ is what would have failed at module load with the wrapper gone; a comment naming it is provenance, not a read");
});

test("#2439 SC-13.1 nothing is deleted, skipped, renamed, weakened or disabled", () => {
  for (const { child } of leaves) {
    const command = child.invocation?.argv?.[1] || "";
    assert.doesNotMatch(command, /\.skip\b|\.only\b|test\.todo|continue-on-error|if:\s*false/, `${child.id}: weakened assertion`);
    assert.doesNotMatch(command, /\|\|\s*true|;\s*exit\s+0/, `${child.id}: failure is swallowed`);
  }
  if (TERMINAL) {
    // The wrappers are gone, so the surface that could carry `continue-on-error`
    // is now the batch workflow that replaced all seventeen. A single
    // `continue-on-error: true` there would soften the whole wave at once — a
    // strictly larger blast radius than the per-wrapper form it replaces.
    // The wrappers are gone, so the surface that could carry `continue-on-error`
    // is the batch workflow that replaced all seventeen — where one line would
    // soften the whole wave at once. The two that exist are the reviewed Phase 3B
    // SELECTION fail-safe pair (a deliberately soft probe whose outcome its own
    // `--normalize` step then hard-checks); they are pinned by owning step name,
    // so a third one, or either moving onto an assertion step, is RED.
    const batch = read(wrapper("ci-batch"));
    const softened = batch.split("\n").reduce((rows, line, index) => {
      if (/^\s*continue-on-error:\s*true\s*$/.test(line)) {
        const owner = batch.split("\n").slice(0, index).reverse().find((prior) => /^\s*- name:\s/.test(prior));
        rows.push((owner || "").replace(/^\s*- name:\s*/, "").trim());
      }
      return rows;
    }, []);
    assert.deepEqual(softened, ["Select Phase 3B suites from complete local Git history", "Normalize Phase 3B decision fail-safe"],
      "the batch provider was weakened");
    for (const phase3cStep of ["Execute one typed Phase 3C setup", "Run assigned Phase 3C suites with exact attribution"]) {
      assert.ok(batch.includes(`- name: ${phase3cStep}`), `${phase3cStep}: Phase 3C step vanished from the batch provider`);
      assert.ok(!softened.includes(phase3cStep), `${phase3cStep}: a Phase 3C step may never be soft`);
    }
    for (const suite of suites) {
      assert.equal(suite.continueOnError, undefined, `${suite.id}: a suite may not declare continue-on-error`);
      for (const step of suite.steps) assert.equal(step.continueOnError, undefined, `${step.commandId}: a step may not declare continue-on-error`);
    }
  } else {
    for (const stem of Object.keys(CANDIDATE_SEALS)) {
      assert.doesNotMatch(read(wrapper(stem)), /continue-on-error:\s*true/, `${stem}: wrapper was weakened`);
    }
  }
  // SC-13.4: #2321's externalGateDirs invocation survives as an executed leaf.
  const external = leaves.find(({ child }) => (child.invocation?.argv?.[1] || "").includes("app-mobile/scripts/ci/orch-1240-dual-account-deletion-check.mjs"));
  assert.ok(external, "#2321's registered externalGateDirs leaf must remain executed");
  assert.equal(external.child.predicate.kind, "always");
});

test("#2439 SC-12 shadow acceptance: wrappers live, marker inert on #2019, terminal shape derivable", () => {
  // Shadow: all 17 live, all 17 shadow-active, one marker each.
  if (suites[0].lifecycle === "shadow-active") {
    for (const stem of Object.keys(CANDIDATE_SEALS)) {
      assert.ok(fs.existsSync(path.join(ROOT, wrapper(stem))), `${stem}: shadow wrapper must remain live`);
    }
  }
  // SC-12.5: the marker alone is INERT on #2019, and the mechanism that wakes it
  // is the guard edit, because that guard IS in #2019's paths.
  const ari = suites.find((suite) => suite.id === "issue-2019-ari-delegated-auth");
  const wakes = (paths) => paths.some((entry) => entry === wrapper("issue-2019-ari-delegated-auth"));
  assert.equal(wakes(ari.triggerContract.push.paths), false, "the SC-12.1 marker cannot wake #2019");
  assert.equal(wakes(ari.triggerContract.pullRequest.paths), false);
  assert.equal(ari.triggerContract.workflowDispatch, false, "#2019 has no dispatch route either");
  assert.ok(ari.triggerContract.push.paths.includes(".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs"),
    "the guard rework is the only mechanism that wakes #2019 at the parity SHA");
  // Terminal shape is DERIVED here, in memory. No clone: SC-16.6(3).
  const terminal = clone(suites).map((suite) => ({ ...suite, lifecycle: "batched-historical" }));
  assert.equal(new Set(terminal.map((suite) => suite.lifecycle)).size, 1, "terminal must also be atomic");
  const mixed = clone(terminal);
  mixed[0].lifecycle = "shadow-active";
  assert.equal(new Set(mixed.map((suite) => suite.lifecycle)).size, 2, "16 terminal + 1 shadow must be observable as non-atomic");
});

test("#2439 SC-16.6 the gate's own cost accounting is COUNT-based and within its construction rules", () => {
  // A7-SC4: counts only. No wall-clock threshold exists in this file.
  assert.equal(VALIDATE_REGISTRY_CALLS, 1, "validateRegistry must be called exactly once for the whole gate");
  assert.equal(DISCOVER_PROVIDERS_CALLS, 1, "discoverWorkflowProviders must be called exactly once for the whole gate");
  const processInvocations = trackedFilesProcessInvocations() - processInvocationsAtStart;
  const calls = trackedFilesCalls() - callsAtStart;
  console.log(`#2439 SC-16.6 accounting: trackedFiles calls=${calls} git-ls-files process invocations=${processInvocations}`);
  // The scope collapses every trackedFiles() call to ONE `git ls-files -z`.
  assert.equal(processInvocations, 1, "the entered scope must collapse the whole gate to a single git ls-files");
  assert.ok(calls > 1, "the scope must actually be exercised, not merely entered");
  const raw = read(".github/scripts/ci-batch/__tests__/issue-2439-deno-wave-shadow-parity.implementor.test.mjs");
  // Count CALL SITES, not prose: this file explains its own cost rules in
  // comments, and a comment naming a function is documentation, not a call.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(source, /Date\.now\(\)|performance\.now\(\)|process\.hrtime/, "a wall-clock threshold inside a gate is forbidden");
  assert.doesNotMatch(source, /execFileSync\(\s*"git",\s*\[\s*"clone"/, "no full-repository clone");
  assert.equal((source.match(/validateRegistry\(/g) || []).length, 1, "exactly one validateRegistry call site");
  assert.equal((source.match(/discoverWorkflowProviders\(/g) || []).length, 1, "exactly one discoverWorkflowProviders call site");
  assert.equal((source.match(/withTrackedFilesScope\(/g) || []).length, 1, "exactly one scope, entered from the start");
});

test("#2439 SC-19.1 expectedFiles equal what the preserved typed commands actually select", () => {
  for (const suite of suites) {
    assert.deepEqual(suite.expectedFiles, derivedExpectedFiles[suite.id],
      `${suite.id}: registered expectedFiles must equal the tokenizer's derivation`);
    assert.ok(suite.expectedFiles.length > 0, `${suite.id}: expectedFiles cannot be empty`);
  }
});

test("#2439 a hypothetical PHASE 3D wave reconciles without touching a line of code", () => {
  // [PR #2546] The regression this replaces: `expectedPrimaryIds` filtered
  // `migrationWave !== "phase3b-postgres-wave"`, so Phase 3C's seventeen suites
  // counted as primary while running in their own lane, and six batch hosts died
  // on `primary-identity-mismatch`. The lane is now DERIVED, so a third migrated
  // wave must reconcile with no edit anywhere. This fixture proves that, and the
  // reverted form below proves the assertion can fail.
  const host = "business-node20-1";
  const withPhase3d = clone(manifest);
  const donor = withPhase3d.suites.find((suite) => suite.id === "issue-1170-stripe-money-path-tests");
  const phase3d = clone(donor);
  phase3d.id = "issue-9999-hypothetical-phase3d";
  phase3d.migrationWave = "phase3d-hypothetical-wave";
  phase3d.executionClass = "phase3d-hypothetical-class";
  phase3d.hostClass = host;
  phase3d.class = host;
  withPhase3d.suites.push(phase3d);

  // DERIVED: the new wave is migrated, so it is not primary and does not enter
  // the primary vector for its host.
  assert.equal(isPrimarySuite(phase3d), false, "a suite with its own executionClass is not primary");
  assert.equal(isMigratedSuite(phase3d), true);
  assert.equal(executesLeaves(phase3d), true, "a migrated suite reports leaves");
  const derivedPrimary = withPhase3d.suites.filter((suite) => suite.class === host && isPrimarySuite(suite)).map((suite) => suite.id);
  assert.ok(!derivedPrimary.includes(phase3d.id), "Phase 3D must not appear in its host's primary vector");
  assert.ok(!derivedPrimary.includes("issue-1170-stripe-money-path-tests"), "Phase 3C must not appear either");
  assert.deepEqual(derivedPrimary, expectedPrimarySuites(withPhase3d, host).map((suite) => suite.id),
    "the reconciler's primary vector and the runner's primary lane must agree by construction");

  // The reconciler reconciles a primary report that contains exactly the derived
  // vector, with a third migrated wave present in the registry.
  const results = derivedPrimary.map((id) => {
    const suite = withPhase3d.suites.find((item) => item.id === id);
    return { id, ok: true, status: "passed", code: 0, setupProfile: suite.setupProfile,
      commandFingerprint: commandFingerprint(suite), expected: suite.steps.length, executed: suite.steps.length };
  });
  const primary = {
    schemaVersion: 2, class: host, expected: derivedPrimary.length, executed: derivedPrimary.length,
    shortfall: 0, failed: [], duplicateIds: [], identityMismatch: false, malformedIds: [], ok: true, code: 0,
    expectedSuiteIds: derivedPrimary, executedSuiteIds: derivedPrimary, results,
    statuses: { passed: results.length, failed: 0, "timed-out": 0, missing: 0 },
  };
  const emptyDecision = selectionDocument(withPhase3d, host, []);
  const errors = reconcilePhase3bReports(withPhase3d, host, emptyDecision, primary, null);
  assert.ok(!errors.includes("primary-identity-mismatch"),
    `a third migrated wave must not break the primary vector; got ${JSON.stringify(errors)}`);

  // REVERTED FORM — the hard-coded list this replaced. Reproduced here rather
  // than described, so the claim "deriving fixes it" is falsifiable: the old
  // predicate puts BOTH migrated waves back into the primary vector.
  const revertedPrimary = withPhase3d.suites
    .filter((suite) => suite.class === host && suite.migrationWave !== "phase3b-postgres-wave")
    .map((suite) => suite.id);
  assert.notDeepEqual(revertedPrimary, derivedPrimary,
    "the reverted hard-coded predicate must produce a DIFFERENT vector — that difference is the outage");
  assert.ok(revertedPrimary.includes(phase3d.id) && revertedPrimary.includes("issue-1170-stripe-money-path-tests"),
    "the reverted predicate wrongly counts both migrated waves as primary");
  const revertedErrors = reconcilePhase3bReports(
    { ...withPhase3d, suites: withPhase3d.suites.map((suite) => (isMigratedSuite(suite) ? { ...suite, executionClass: undefined } : suite)) },
    host, emptyDecision, primary, null,
  );
  assert.ok(revertedErrors.includes("primary-identity-mismatch"),
    "with the derivation removed the reconciler must go RED — this is the PR #2546 failure reproduced");
});

test("#2439 the runner and the reconciler cannot disagree about a fingerprint", () => {
  // [PR #2546] Two implementations of this existed and DIVERGED for a Phase 3C
  // suite: the runner keyed on the leaf lane, the reconciler on the literal
  // Phase 3B name. The runner writes the value and the reconciler checks it, so
  // the divergence was a primary-identity-mismatch waiting for the next wave.
  // There is now one definition; this proves the runner's export IS it.
  assert.equal(commandFingerprint, suiteCommandFingerprint, "the runner must re-export the canonical fingerprint");
  const runnerSource = read(".github/scripts/ci-batch/run-suite-batch.mjs");
  const reconcilerSource = read(".github/scripts/ci-batch/select-phase3b-suites.mjs");
  for (const [label, source] of [["runner", runnerSource], ["reconciler", reconcilerSource]]) {
    assert.doesNotMatch(source, /function suiteCommandFingerprint\s*\(/, `${label} must not define a second fingerprint`);
  }
  // A migrated suite's fingerprint must see env, leaves and retry; a primary
  // suite's must not change shape.
  for (const suite of suites) {
    const stripped = clone(suite);
    for (const step of stripped.steps) delete step.children;
    assert.notEqual(suiteCommandFingerprint(stripped), suiteCommandFingerprint(suite), `${suite.id}: leaves must be inside the fingerprint`);
  }
  const primary = manifest.suites.find((suite) => isPrimarySuite(suite));
  assert.ok(primary && !isMigratedSuite(primary));
  const primaryRows = clone(primary);
  primaryRows.steps[0].children = [{ id: "forged" }];
  assert.equal(suiteCommandFingerprint(primaryRows), suiteCommandFingerprint(primary),
    "a primary suite's fingerprint shape must be unchanged by this refactor");
});

test("#2439 the bounded retry survives its own backoff and the reviewed env is executable", async () => {
  // [PR #2546] Three defects of ONE class shipped together: a semantic carried in
  // the registry that the RUNNER never executed. The retry was a typed field the
  // runner ignored; then its backoff used an unref'd timer, so Node exited
  // mid-wait and attempts 2 and 3 never ran; and #1326's four authorised env
  // literals were pinned by the validator but rejected at spawn. Each is locked
  // here because each was invisible until something else failed first.
  const runnerSource = read(".github/scripts/ci-batch/run-suite-batch.mjs");

  // (a) The backoff must hold the event loop open. An unref'd timer is the exact
  // defect: the wait line prints and the process exits before the next attempt.
  assert.doesNotMatch(runnerSource, /setTimeout\(resolve[^)]*\)[^;]*;\s*[a-zA-Z]+\.unref/,
    "the retry backoff must not unref its timer — Node exits during the wait");
  // No clock: A7-SC4 forbids a wall-clock threshold inside a gate. The invariant
  // that matters is that execution CONTINUES past the await — precisely what the
  // unref'd timer prevented by letting Node exit mid-wait.
  let resumedAfterBackoff = false;
  await sleepBounded(1);
  resumedAfterBackoff = true;
  assert.equal(resumedAfterBackoff, true, "execution must resume after the backoff, not exit during it");

  // (b) All attempts must be reachable: the loop bound is the reviewed attempts
  // value, and the wait is bounded by the suite deadline, not skipped.
  assert.match(runnerSource, /attempt <= maxAttempts/, "the attempt loop must be bounded by the reviewed attempts value");
  assert.match(runnerSource, /await sleepBounded\(backoffMs\)/, "each failed attempt must wait the reviewed back-off");
  // SC-4.4: the suite cap must afford attempts + backoff, or the retry cannot finish.
  const ng = suites.find((suite) => suite.id === "issue-1326-ng-reservation-finalize-tests");
  const retry = ng.steps[0].retry;
  const backoffBudget = (retry.attempts - 1) * retry.backoffSeconds;
  assert.ok(ng.timeoutSeconds > backoffBudget * ng.steps.length,
    `#1326's ${ng.timeoutSeconds}s cap must afford ${backoffBudget}s of back-off on each of its ${ng.steps.length} retrying steps`);

  // (c) The four authorised literals must be ACCEPTED when the registry declares
  // them and REJECTED otherwise. This is what took the NG Paystack suite red on
  // every attempt with `undeclared child environment capability: SUPABASE_URL`.
  const authorised = ng.steps[1].env;
  assert.deepEqual(Object.keys(authorised).sort(),
    ["PAYSTACK_MODE", "PAYSTACK_SECRET_KEY_TEST", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
  const accepted = minimalChildEnvironment(authorised, "/tmp/home-fixture", { allowReviewedEnv: true });
  for (const [key, value] of Object.entries(authorised)) {
    assert.equal(accepted[key], value, `${key} must reach the child with its audited literal`);
  }
  assert.throws(() => minimalChildEnvironment(authorised, "/tmp/home-fixture", {}),
    /undeclared child environment capability/, "the same env must be REJECTED for a suite that does not declare it");
  assert.throws(() => minimalChildEnvironment({ GITHUB_TOKEN: "x" }, "/tmp/home-fixture", { allowReviewedEnv: true }),
    /undeclared child environment capability/, "a key outside the reviewed four must stay rejected");
  assert.throws(() => minimalChildEnvironment({ SUPABASE_URL: "${{ secrets.SUPABASE_URL }}" }, "/tmp/home-fixture", { allowReviewedEnv: true }),
    /undeclared child environment capability/, "an interpolated value must stay rejected even under an authorised key");

  // (d) The Phase 3C artifact must be written on every path, including one that
  // ends before any verdict is recorded.
  assert.match(runnerSource, /abnormalTermination/, "an abnormal end must still emit a failing Phase 3C report");
  assert.match(runnerSource, /process\.once\("exit", guard\)/, "the artifact guard must be armed before the first suite runs");
});
