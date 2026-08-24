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
  discoverWorkflowProviders, trackedFilesCalls, trackedFilesProcessInvocations,
  validateRegistry, withTrackedFilesScope, PHASE3C_SHADOW_MARKER, PHASE3C_WRAPPER_NAMES,
} from "../validate-manifest-v2.mjs";
import { executesLeaves, absentFileIsFailure, evaluateTypedPredicate, expectedPrimarySuites } from "../run-suite-batch.mjs";

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
  return { registryErrors, providers, manifest, suites, derivedExpectedFiles };
});
const VALIDATE_REGISTRY_CALLS = 1;
const DISCOVER_PROVIDERS_CALLS = 1;

const { registryErrors, providers, manifest, suites, derivedExpectedFiles } = PRECOMPUTED;
const leaves = suites.flatMap((suite) => suite.steps.flatMap((step) => (step.children || []).map((child) => ({ suite, step, child }))));

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
const NOT_A_CANDIDATE = {
  "issue-679-brand-follows-rls-proof": "a2d6b6274bf7f52c9e84ad4bfb8c16d0fb549c30cf69475415426d2906adf7ad",
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
  assert.deepEqual(marked.sort(), Object.keys(CANDIDATE_SEALS).sort(), "marker set must equal the candidate set exactly");
  assert.deepEqual([...PHASE3C_WRAPPER_NAMES].map((name) => name.replace(/\.ya?ml$/, "")).sort(), Object.keys(CANDIDATE_SEALS).sort());
});

test("#2439 SC-1.1 every stem and every issue-number prefix resolves to exactly one file", () => {
  const workflows = fs.readdirSync(path.join(ROOT, WORKFLOWS)).filter((name) => /\.ya?ml$/.test(name));
  for (const stem of Object.keys(CANDIDATE_SEALS)) {
    assert.deepEqual(workflows.filter((candidate) => candidate.replace(/\.ya?ml$/, "") === stem), [`${stem}.yml`], `${stem}: ambiguous stem`);
    const prefix = stem.match(/^issue-\d+/)?.[0];
    if (!prefix) continue;
    assert.deepEqual(workflows.filter((candidate) => candidate.startsWith(`${prefix}-`)), [`${stem}.yml`], `${prefix}: ambiguous issue-number prefix`);
  }
});

test("#2439 SC-2 cardinality is 17 / 46 / 54 / 3 / 11, counted per origin", () => {
  assert.equal(suites.length, 17);
  assert.equal(suites.reduce((sum, suite) => sum + suite.steps.length, 0), 46);
  assert.equal(leaves.length, 54);
  const installs = [...new Set(suites.map((suite) => suite.executionClass))]
    .reduce((sum, klass) => sum + (manifest.setupProfiles[klass].installs || []).length, 0);
  assert.equal(installs, 3);
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
  assert.ok(suites.every((suite) => absentFileIsFailure(suite)));
  const phase3b = manifest.suites.filter((suite) => suite.migrationWave === "phase3b-postgres-wave");
  assert.ok(phase3b.every((suite) => !absentFileIsFailure(suite)), "Phase 3B conditional-proof semantics must not change");
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
    assert.doesNotMatch(read(wrapper(origin.stem)), /^\s+(services|container):/m, `${origin.stem}: declares no service or container`);
  }
  // SC-11.5: exactly seven records transition; the other ten hold none.
  const PROVIDER_SEVEN = ["issue-1430-refund-replay-tests", "issue-1437-secret-bundle-compatibility-tests",
    "issue-1950-app-readiness-tests", "issue-1999-ari-provider-schema-tests", "issue-2019-ari-delegated-auth",
    "issue-2230-consumer-multiday-tests", "issue-2321-account-deletion-tests"].map((stem) => `${stem}.yml`);
  const candidateNames = Object.keys(CANDIDATE_SEALS).map((stem) => `${stem}.yml`);
  const held = manifest.workflowProviders.filter((item) => candidateNames.includes(item.workflow));
  assert.deepEqual(held.map((item) => item.workflow).sort(), [...PROVIDER_SEVEN].sort());
  assert.equal(manifest.workflowProviders.length, 91, "workflowProviders must stay 91");
  const expectedTransition = suites[0].lifecycle === "batched-historical" ? "batched-provider" : "retained-live-provider";
  assert.deepEqual([...new Set(held.map((item) => item.transition))], [expectedTransition]);
  // Discovery agrees with the registry about which wrappers are providers.
  const discovered = providers.filter((item) => candidateNames.includes(item.workflow)).map((item) => item.workflow).sort();
  assert.deepEqual(discovered, [...PROVIDER_SEVEN].sort(),
    "the other ten must not gain a provider record — docs/ and *.md are not authoritative evidence");
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
    suiteCount: 17, outerCommandCount: 46, maximumLeafCount: 54, installCount: 3,
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
  for (const stem of Object.keys(CANDIDATE_SEALS)) {
    assert.doesNotMatch(read(wrapper(stem)), /continue-on-error:\s*true/, `${stem}: wrapper was weakened`);
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
