// #2882 implementor happy path. Proves the pull-request router selects the
// suites a diff invalidates, prints that selection beside its derived
// denominator, and leaves every non-pull-request event running the complete
// registered set.
//
// The adversarial angle — every way the router could select nothing WITHOUT
// saying so — is the tester's file, deliberately not duplicated here.

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  REPO_ROOT, loadManifest, expectedPrimarySuites,
  routingContext, selectSuites, renderRoutingLine, routingReport, ROUTED_EVENTS,
} from "../run-suite-batch.mjs";
import { suiteOriginPatterns } from "../validate-manifest-v2.mjs";
import { pathMatches } from "../select-phase3b-suites.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
void HERE;

const manifest = loadManifest();
const routed = (changedPaths) => ({ eventName: "pull_request", mode: "routed", changedPaths });
const idsOf = (selection) => selection.suites.map((suite) => suite.id);

// A synthetic suite is the only honest way to exercise a shape the real registry
// does not currently hold. It never touches the committed manifest.
function manifestWith(...suites) {
  return { ...manifest, suites: [...manifest.suites, ...suites] };
}
function syntheticSuite(id, originPaths) {
  const template = manifest.suites.find((suite) => suite.class === "node20-noinstall");
  return { ...template, id, originPaths };
}

test("#2882 case 1: a stay component change selects the suite that mounts it", () => {
  const changed = ["mingla-business/src/components/stay/StayChipRow.tsx"];
  const candidates = expectedPrimarySuites(manifest, "business-node20-4");
  const selection = selectSuites(manifest, candidates, routed(changed));
  assert.equal(selection.mode, "routed");
  assert.ok(idsOf(selection).includes("issue-1532-tester-adversarial"),
    `issue-1532-tester-adversarial must be selected by ${changed[0]}; selected ${JSON.stringify(idsOf(selection))}`);
  // Registry-wide selection is what the denominator counts, and it is a superset
  // of this one class's share.
  assert.ok(selection.selectedSuiteIds.includes("issue-1532-tester-adversarial"));
  assert.ok(selection.selectedSuiteIds.length >= selection.suites.length);
});

test("#2882 case 2: a diff that invalidates nothing selects zero and does not throw", () => {
  const candidates = expectedPrimarySuites(manifest, "business-node20-4");
  const selection = selectSuites(manifest, candidates, routed(["README.md"]));
  assert.deepEqual(idsOf(selection), []);
  assert.deepEqual(selection.selectedSuiteIds, []);
  // Zero is an EVENT, not a silence: the line still prints, still carries its
  // denominator, and says in words that nothing was invalidated.
  const line = renderRoutingLine("business-node20-4", routed(["README.md"]), selection);
  assert.match(line, /selected=0 of 85/);
  assert.match(line, /no registered suite is invalidated by this diff/);
});

test("#2882 case 3: push, schedule and workflow_dispatch run the complete class set", () => {
  const candidates = expectedPrimarySuites(manifest, "business-node20-4");
  for (const eventName of ["push", "schedule", "workflow_dispatch", ""]) {
    assert.equal(ROUTED_EVENTS.has(eventName), false, `${eventName || "<local>"} must not be a routed event`);
    const context = routingContext({ env: { GITHUB_EVENT_NAME: eventName } });
    assert.equal(context.mode, "full");
    const selection = selectSuites(manifest, candidates, context);
    // Identity function: the full class set, whatever any diff might have said.
    assert.deepEqual(idsOf(selection), candidates.map((suite) => suite.id));
    assert.equal(selection.selectedSuiteIds.length, manifest.suites.length);
    assert.match(renderRoutingLine("business-node20-4", context, selection),
      new RegExp(`mode=full changed=n/a registry=${manifest.suites.length} selected=${manifest.suites.length} of ${manifest.suites.length}`));
  }
});

test("#2882 case 4: a concat-v1 entry is decoded and matched, never skipped", () => {
  const encoded = { encoding: "concat-v1", parts: ["app-mobile/app.config", ".js"] };
  const synthetic = syntheticSuite("issue-2882-fixture-concat", [encoded]);
  assert.deepEqual(suiteOriginPatterns(synthetic), ["app-mobile/app.config.js"]);
  const value = manifestWith(synthetic);
  const selection = selectSuites(value, [synthetic], routed(["app-mobile/app.config.js"]));
  assert.deepEqual(idsOf(selection), ["issue-2882-fixture-concat"]);
  // The two real #994 suites carry concat-v1 entries, so this is not a shape
  // invented for the test: routing must decode them wherever they appear.
  //
  // Read the RAW registry, not the loaded one. `loadManifest` already decodes
  // concat-v1 — but only for the two hard-coded #994 suite ids, which is exactly
  // why routing decodes independently: an entry added to any other suite would
  // reach the matcher as an unhandled object.
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
  const real = raw.suites.find((suite) => suite.id === "issue-994-ota-env-resolution-app-mobile");
  assert.ok(real.originPaths.some((entry) => typeof entry !== "string"),
    "the #994 suite must still carry a non-string reviewed representation");
  assert.ok(suiteOriginPatterns(real).every((pattern) => typeof pattern === "string"));
  const undecoded = raw.suites.filter((suite) => !suite.id.startsWith("issue-994-ota-env-resolution-")
    && (suite.originPaths || []).some((entry) => typeof entry !== "string"));
  for (const suite of undecoded) assert.doesNotThrow(() => suiteOriginPatterns(suite), `${suite.id}: concat-v1 outside #994 must still decode`);
});

test("#2882 case 5: ** crosses a slash", () => {
  assert.equal(pathMatches("a/**", "a/b/c/d.ts"), true);
  const synthetic = syntheticSuite("issue-2882-fixture-descendants", ["mingla-business/src/**"]);
  const selection = selectSuites(manifestWith(synthetic), [synthetic], routed(["mingla-business/src/a/b/c/deep.ts"]));
  assert.deepEqual(idsOf(selection), ["issue-2882-fixture-descendants"]);
});

test("#2882 case 6: * does NOT cross a slash — the case fnmatch gets wrong", () => {
  // fnmatch(3) without FNM_PATHNAME matches `a/b*` against `a/b/c.ts`, because a
  // bare `*` there spans separators. GitHub's filter syntax does not, and this
  // repository's grammar does not. Routing that used fnmatch semantics would
  // over-select a whole subtree from one terminal wildcard.
  assert.equal(pathMatches("a/b*", "a/bc.ts"), true);
  assert.equal(pathMatches("a/b*", "a/b/c.ts"), false);
  const synthetic = syntheticSuite("issue-2882-fixture-terminal", ["mingla-business/scripts/ci/__tests__/issue1509_*"]);
  const value = manifestWith(synthetic);
  assert.deepEqual(
    idsOf(selectSuites(value, [synthetic], routed(["mingla-business/scripts/ci/__tests__/issue1509_boot_budget_ratchet.happy.test.mjs"]))),
    ["issue-2882-fixture-terminal"]);
  assert.deepEqual(
    idsOf(selectSuites(value, [synthetic], routed(["mingla-business/scripts/ci/__tests__/issue1509_nested/inner.mjs"]))),
    []);
});

test("#2882 case 7: a bracketed Expo Router file is a literal, not a character class", () => {
  const route = "mingla-business/app/event/[id]/edit.tsx";
  assert.equal(pathMatches(route, route), true);
  assert.equal(pathMatches(route, "mingla-business/app/event/id/edit.tsx"), false);
  const synthetic = syntheticSuite("issue-2882-fixture-bracket", [route]);
  const value = manifestWith(synthetic);
  assert.deepEqual(idsOf(selectSuites(value, [synthetic], routed([route]))), ["issue-2882-fixture-bracket"]);
  assert.deepEqual(idsOf(selectSuites(value, [synthetic], routed(["mingla-business/app/event/id/edit.tsx"]))), []);
});

test("#2882 case 8: + is a literal, not a repetition operator", () => {
  const route = "app-mobile/app/+native-intent.tsx";
  assert.equal(pathMatches(route, route), true);
  const synthetic = syntheticSuite("issue-2882-fixture-plus", [route]);
  assert.deepEqual(idsOf(selectSuites(manifestWith(synthetic), [synthetic], routed([route]))), ["issue-2882-fixture-plus"]);
});

test("#2882 case 9: the real registry over a real commit's real diff", () => {
  const changed = execFileSync("git", ["diff", "--name-only", "2bb26d372^", "2bb26d372"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
  assert.ok(changed.length > 0, "the sampled commit must have changed files");
  const selection = selectSuites(manifest, manifest.suites, routed(changed));
  // Measured 2 of 85 on this commit while the change was written. The COUNT is
  // deliberately not pinned: this diff touches `.github/scripts/strict-grep/**`,
  // a path a future suite may legitimately claim, and a test that reds on
  // somebody else's unrelated originPaths entry is a tax, not a guard.
  //
  // What IS pinned is the pair that matters: routing must filter (a router that
  // selected everything would pass a bare "does not throw"), and it must pick
  // these two by the patterns that actually match.
  assert.ok(selection.selectedSuiteIds.length > 0, "this diff invalidates real suites");
  assert.ok(selection.selectedSuiteIds.length < manifest.suites.length,
    `routing must select a strict subset, got ${selection.selectedSuiteIds.length} of ${manifest.suites.length}`);
  for (const id of ["issue-2207-manifest-merge-awareness", "issue-1437-secret-bundle-compatibility-tests"]) {
    assert.ok(selection.selectedSuiteIds.includes(id),
      `${id} must be selected by this diff; selected ${JSON.stringify(selection.selectedSuiteIds)}`);
  }
  assert.equal(selection.reasons.get("issue-2207-manifest-merge-awareness"), ".github/scripts/strict-grep/**");
});

test("#2882 the denominator is DERIVED from the registry, never typed", () => {
  const candidates = expectedPrimarySuites(manifest, "business-node20-4");
  const context = routed(["mingla-business/src/components/stay/StayChipRow.tsx"]);
  const before = selectSuites(manifest, candidates, context);
  const grown = manifestWith(syntheticSuite("issue-2882-fixture-denominator", ["mingla-business/src/components/stay/**"]));
  const after = selectSuites(grown, candidates, context);
  assert.equal(after.registry, before.registry + 1);
  assert.match(renderRoutingLine("business-node20-4", context, after), new RegExp(`registry=${before.registry + 1} `));
  // Both the registry-wide count and this job's own share are printed, so a
  // reader can tell "this job had nothing to do" from "the whole run selected
  // nothing".
  const line = renderRoutingLine("business-node20-4", context, before);
  assert.match(line, /selected=\d+ of \d+ class_selected=\d+ of \d+/);
});

test("#2882 the artifact carries the routing evidence, digest and all", () => {
  const changed = ["mingla-business/src/components/stay/StayChipRow.tsx"];
  const context = routed(changed);
  const selection = selectSuites(manifest, expectedPrimarySuites(manifest, "business-node20-4"), context);
  const report = routingReport(context, selection);
  assert.equal(report.mode, "routed");
  assert.equal(report.registry, manifest.suites.length);
  assert.equal(report.changedPathCount, 1);
  assert.deepEqual(report.changedPaths, changed);
  assert.match(report.changedPathSha256, /^[0-9a-f]{64}$/);
  assert.ok(report.classSelectedSuiteIds.includes("issue-1532-tester-adversarial"));
  // Order must equal manifest order, because verdict()'s identity-and-order
  // check is preserved verbatim on the routed set.
  const manifestOrder = manifest.suites.map((suite) => suite.id);
  const sortedByManifest = [...report.selectedSuiteIds].sort((a, b) => manifestOrder.indexOf(a) - manifestOrder.indexOf(b));
  assert.deepEqual(report.selectedSuiteIds, sortedByManifest);
});

test("#2882 every registered suite carries routing data that parses and resolves", () => {
  // The router reads originPaths on EVERY suite on every run, not only the class
  // in hand, so a suite that could never be selected has to be visible here too.
  for (const suite of manifest.suites) {
    const patterns = suiteOriginPatterns(suite);
    assert.ok(patterns.length > 0, `${suite.id}: originPaths must not be empty`);
    for (const pattern of patterns) {
      assert.equal(typeof pattern, "string", `${suite.id}: ${JSON.stringify(pattern)} did not decode to a path`);
      assert.doesNotThrow(() => pathMatches(pattern, "a/b.ts"), `${suite.id}: ${pattern} does not parse`);
    }
  }
});
