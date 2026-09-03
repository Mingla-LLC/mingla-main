// #2882 TESTER, adversarial. The implementor's file proves the router selects
// the right suites. This one attacks the opposite question:
//
//     can the router select NOTHING — or select less than it owes — without
//     saying so?
//
// Every case below is a distinct mechanism by which a routed run could report
// success having executed nothing. None of them is a renamed copy of a happy
// path: where the implementor asserts a selection, this file asserts a REFUSAL,
// a boundary, or an invariant over the committed registry.
//
// Angles, in order:
//   1  F1  absent / null / empty originPaths must THROW, never select zero
//   2  F2  malformed and nested entries must THROW, never be skipped or coerced
//   3  F5  an unparseable pattern must propagate, never be caught-and-skipped
//   4  the SILENT under-selection mode: a pattern that PARSES and matches
//      nothing (brace globs) — the one F5 cannot see
//   5  F3  a changed-path list that cannot be derived must fail the run
//   6  F4  an empty changed-path list on a routed event is "could not observe"
//   7  tier 2 must be the identity function, and must not be weakened by any
//      router failure
//   8  a diff of DELETED files must still route
//   9  zero selection must print its denominator, never an empty log
//  10  the four seal-authorised registry repairs are load-bearing
//  11  SELF-COVERAGE: a suite must be selected when a file it itself EXECUTES
//      changes. This one currently finds real gaps and is a ratchet — see
//      KNOWN_SELF_COVERAGE_GAP_SUITES.

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import {
  REPO_ROOT, loadManifest, expectedPrimarySuites,
  routingContext, selectSuites, renderRoutingLine, ROUTED_EVENTS,
} from "../run-suite-batch.mjs";
import { suiteOriginPatterns, validateOriginPathShapes, validateOriginPathLiveness } from "../validate-manifest-v2.mjs";
import { parseOriginPattern, pathMatches } from "../select-phase3b-suites.mjs";

const manifest = loadManifest();
const routed = (changedPaths) => ({ eventName: "pull_request", mode: "routed", changedPaths });
const CLASS = "business-node20-4";

// A synthetic suite never touches the committed registry. It is the only honest
// way to exercise a shape the real one must never hold.
function syntheticSuite(id, originPaths) {
  const template = manifest.suites.find((suite) => suite.class === "node20-noinstall");
  return { ...template, id, originPaths };
}
const withSuite = (suite) => ({ ...manifest, suites: [...manifest.suites, suite] });
const selectWith = (suite, changedPaths) => selectSuites(withSuite(suite), [suite], routed(changedPaths));

// ---------------------------------------------------------------------------
// 1. F1 — routing to nothing is a BUILD FAILURE, not a quiet zero.
// ---------------------------------------------------------------------------
test("#2882 adversarial 1: a suite that routes to nothing throws, it does not select zero", () => {
  // The distinction this case exists for: `[]` intersects every diff in exactly
  // the same way `["README.md"]` intersects a diff that does not touch it — the
  // selection is empty either way. One is a suite legitimately not invalidated;
  // the other is a suite that could NEVER be invalidated again. A router that
  // treats them alike deletes a suite from CI and reports green.
  for (const [label, value] of [["empty array", []], ["undefined", undefined], ["null", null], ["not an array", { "0": "a.ts" }]]) {
    const suite = syntheticSuite(`issue-2882-adversarial-f1-${label.replace(/\s+/g, "-")}`, value);
    assert.throws(() => selectWith(suite, ["README.md"]),
      /originPaths is empty for .*: a suite that routes to nothing would never run/,
      `${label}: must throw F1, not select zero`);
    // The validator names it too, so it reds at registry time and not only at
    // selection time inside an already-running job.
    assert.equal(validateOriginPathShapes({ suites: [suite] }).length, 1, `${label}: validator must name it`);
  }
});

test("#2882 adversarial 1b: F1 is checked across the WHOLE registry, not just the executing class", () => {
  // A broken entry must not be able to hide in a class this job did not run.
  // The synthetic below belongs to `node20-noinstall`; the candidates handed to
  // the selector are a different class entirely.
  const stowaway = syntheticSuite("issue-2882-adversarial-f1-stowaway", []);
  const candidates = expectedPrimarySuites(manifest, CLASS);
  assert.ok(candidates.length > 0, "the sampled class must be registered");
  assert.ok(!candidates.some((suite) => suite.id === stowaway.id), "the stowaway must not be in the executing class");
  assert.throws(() => selectSuites(withSuite(stowaway), candidates, routed(["README.md"])),
    /originPaths is empty for issue-2882-adversarial-f1-stowaway/);
});

// ---------------------------------------------------------------------------
// 2. F2 — an entry the router does not recognise is refused, never guessed at.
// ---------------------------------------------------------------------------
test("#2882 adversarial 2: malformed originPaths entries throw; none is skipped or coerced", () => {
  // Both fail-open readings are covered here. SKIPPING a non-string entry
  // under-selects. COERCING one (`String(entry)` -> "[object Object]") invents a
  // pattern that matches nothing, which under-selects while looking like a
  // pattern. Throwing is the only fail-closed reading.
  const malformed = [
    ["null", null],
    ["number", 42],
    ["boolean", true],
    ["array", []],
    ["bare object", {}],
    ["wrong encoding", { encoding: "concat-v2", parts: ["a"] }],
    ["missing parts", { encoding: "concat-v1" }],
    ["non-array parts", { encoding: "concat-v1", parts: "a" }],
    ["empty parts", { encoding: "concat-v1", parts: [] }],
    ["numeric part", { encoding: "concat-v1", parts: [1] }],
    ["null part", { encoding: "concat-v1", parts: [null] }],
    ["NESTED encoding", { encoding: "concat-v1", parts: [{ encoding: "concat-v1", parts: ["a"] }] }],
  ];
  for (const [label, entry] of malformed) {
    const suite = syntheticSuite("issue-2882-adversarial-f2", [entry]);
    assert.throws(() => suiteOriginPatterns(suite),
      /is neither a path nor a reviewed concat-v1 representation/, `${label}: must throw F2`);
    assert.throws(() => selectWith(suite, ["a.ts"]), /is neither a path nor a reviewed concat-v1 representation/,
      `${label}: the SELECTOR must refuse it too, not only the validator`);
  }
});

test("#2882 adversarial 2b: a malformed entry beside a VALID one still throws", () => {
  // The dangerous shape: one good pattern makes the suite selectable, so a
  // router that skipped the bad entry would look correct on the happy diff and
  // silently under-select on every other one.
  const suite = syntheticSuite("issue-2882-adversarial-f2-mixed", ["mingla-business/src/**", { encoding: "concat-v9", parts: ["x"] }]);
  assert.throws(() => selectWith(suite, ["mingla-business/src/a.ts"]),
    /originPaths\[1\] is neither a path nor a reviewed concat-v1 representation/);
});

// ---------------------------------------------------------------------------
// 3. F5 — an unparseable pattern propagates. It is never caught and skipped.
// ---------------------------------------------------------------------------
test("#2882 adversarial 3: unparseable patterns throw out of the selector, they are not swallowed", () => {
  // Each of these was live in the registry before this change and each names a
  // real class of mistake: a mid-path `**`, a mid-path `*`, a wildcard that is
  // not the last character of its segment, and an unsafe traversal.
  const unparseable = [
    "a/**/b.ts",
    "a/*/b.ts",
    "pkg*.json",
    "mingla-business/package*.json",
    "supabase/migrations/**1950**",
    "**/.well-known/**",
    "app-mobile/src/i18n/locales/*/settings.json",
    "../escape.ts",
    "/absolute.ts",
  ];
  for (const pattern of unparseable) {
    assert.throws(() => parseOriginPattern(pattern), /unsupported origin wildcard|unsafe origin path/, `${pattern}: grammar must reject`);
    const suite = syntheticSuite("issue-2882-adversarial-f5", [pattern]);
    assert.throws(() => selectWith(suite, ["a/b/b.ts"]), /unsupported origin wildcard|unsafe origin path/,
      `${pattern}: the selector must propagate, not catch-and-skip`);
  }
});

// ---------------------------------------------------------------------------
// 4. The mode F5 CANNOT see: a pattern that parses and matches nothing.
// ---------------------------------------------------------------------------
test("#2882 adversarial 4: a brace glob PARSES and silently matches nothing — liveness is what catches it", () => {
  // This is the quietest failure in the design. `mingla-business/{api,server}/**`
  // is not GitHub filter syntax and is not in this repository's grammar either,
  // but it does not throw: it parses as `descendants-v1` over a directory
  // literally named `{api,server}`, matches nothing, and the suite stops being
  // selected with no error anywhere. 38 tracked files sat behind it.
  const brace = "mingla-business/{api,server}/**";
  assert.equal(parseOriginPattern(brace).mode, "descendants-v1", "the brace glob must parse — that is the whole problem");
  assert.equal(pathMatches(brace, "mingla-business/api/og-image.js"), false, "and it must match nothing");
  const suite = syntheticSuite("issue-2882-adversarial-brace", [brace]);
  assert.deepEqual(selectWith(suite, ["mingla-business/api/og-image.js"]).selectedSuiteIds.filter((id) => id === suite.id), [],
    "a brace glob selects nothing, silently — F5 cannot see it");

  // So the liveness assertion is the only thing standing here. It must name it.
  const errors = validateOriginPathLiveness({ suites: [{ id: suite.id, originPaths: [brace] }] }, trackedFiles());
  assert.equal(errors.length, 1, "liveness must name the brace glob");
  assert.match(errors[0], /originPaths pattern matches no tracked file: mingla-business\/\{api,server\}\/\*\*/);

  // And the committed registry must hold no brace glob at all.
  for (const suiteEntry of manifest.suites) {
    for (const pattern of suiteOriginPatterns(suiteEntry)) {
      assert.doesNotMatch(pattern, /[{}]/, `${suiteEntry.id}: brace expansion is not in the grammar (${pattern})`);
    }
  }
});

// ---------------------------------------------------------------------------
// 5 + 6. Absence of signal. This repository's recorded failure mode.
// ---------------------------------------------------------------------------
test("#2882 adversarial 5: a changed-path list that cannot be derived FAILS, it is never read as 'nothing changed'", () => {
  const cases = [
    ["GITHUB_EVENT_PATH unset", { GITHUB_EVENT_NAME: "pull_request" }, undefined],
    ["event file unreadable", { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/nonexistent" }, undefined],
    ["event payload has no SHAs", { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" }, () => JSON.stringify({ pull_request: {} })],
    ["event payload is not JSON", { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" }, () => "not json"],
    ["base SHA does not exist", { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" },
      () => JSON.stringify({ pull_request: { base: { sha: "0".repeat(40) }, head: { sha: "HEAD" } } })],
  ];
  for (const [label, env, readFile] of cases) {
    assert.throws(() => routingContext(readFile ? { env, readFile } : { env }),
      /changed-path derivation failed/, `${label}: must be F3, not an empty selection`);
  }
});

test("#2882 adversarial 6: an EMPTY changed-path list on a routed event is 'could not observe', not 'observed zero'", () => {
  // A pull request whose base and head are the same commit produces a genuinely
  // empty diff. That is indistinguishable from a diff the runner failed to read,
  // so it must fail rather than skip all 85 suites and report green.
  assert.throws(() => routingContext({
    env: { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" },
    readFile: () => JSON.stringify({ pull_request: { base: { sha: "HEAD" }, head: { sha: "HEAD" } } }),
  }), /could not observe, not observed zero/);

  // pull_request_target routes as well, so the same refusal must hold there.
  assert.equal(ROUTED_EVENTS.has("pull_request_target"), true);
  assert.throws(() => routingContext({
    env: { GITHUB_EVENT_NAME: "pull_request_target", GITHUB_EVENT_PATH: "/x" },
    readFile: () => JSON.stringify({ pull_request: { base: { sha: "HEAD" }, head: { sha: "HEAD" } } }),
  }), /could not observe, not observed zero/);
});

// ---------------------------------------------------------------------------
// 7. Tier 2 must never be weakened by anything the router does.
// ---------------------------------------------------------------------------
test("#2882 adversarial 7: no router failure can reduce what a non-routed event runs", () => {
  const candidates = expectedPrimarySuites(manifest, CLASS);
  for (const eventName of ["push", "schedule", "workflow_dispatch", "merge_group", ""]) {
    assert.equal(ROUTED_EVENTS.has(eventName), false, `${eventName || "<local>"} must not route`);
    // An event file that would be fatal on a pull request must not even be READ
    // here: tier 2 does not depend on a derivable diff.
    const context = routingContext({
      env: { GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: "/nonexistent" },
      readFile: () => { throw new Error("tier 2 must not read the event payload"); },
    });
    assert.equal(context.mode, "full");
    const selection = selectSuites(manifest, candidates, context);
    assert.equal(selection.selectedSuiteIds.length, manifest.suites.length,
      `${eventName || "<local>"}: every registered suite must still run`);
    assert.deepEqual(selection.suites.map((suite) => suite.id), candidates.map((suite) => suite.id));
  }
});

// ---------------------------------------------------------------------------
// 8. A deleted file is a changed file.
// ---------------------------------------------------------------------------
test("#2882 adversarial 8: a diff of files that no longer exist still routes", () => {
  // Matching is lexical, so it must not consult the working tree. A change that
  // DELETES the last file a suite watches is exactly when that suite most needs
  // to run, and a matcher that stat()ed the path would skip it.
  const suite = syntheticSuite("issue-2882-adversarial-deleted", ["mingla-business/src/components/stay/**"]);
  const deleted = "mingla-business/src/components/stay/DeletedByThisDiff.tsx";
  assert.deepEqual(selectWith(suite, [deleted]).suites.map((entry) => entry.id), [suite.id],
    "a deleted path must still select the suite that watched it");
});

// ---------------------------------------------------------------------------
// 9. A zero is an event, not a silence.
// ---------------------------------------------------------------------------
test("#2882 adversarial 9: zero selection prints its denominator and says so in words", () => {
  const candidates = expectedPrimarySuites(manifest, CLASS);
  const context = routed(["docs/NOTHING_ROUTES_HERE.md"]);
  const selection = selectSuites(manifest, candidates, context);
  const line = renderRoutingLine(CLASS, context, selection);
  assert.ok(line.trim().length > 0, "a zero selection must never render an empty log");
  assert.match(line, new RegExp(`registry=${manifest.suites.length} `), "the denominator is always printed");
  assert.match(line, /class_selected=0 of \d+/);
  assert.match(line, /no (registered suite is invalidated|suite in this class is invalidated)/,
    "zero must be stated in words, not inferred from an absence of lines");
  // The denominator is DERIVED. A typed literal would not move when the registry
  // does, and this repository has already shipped that bug once.
  const grown = { ...manifest, suites: [...manifest.suites, syntheticSuite("issue-2882-adversarial-denominator", ["a.ts"])] };
  assert.match(renderRoutingLine(CLASS, context, selectSuites(grown, candidates, context)),
    new RegExp(`registry=${manifest.suites.length + 1} `));
});

// ---------------------------------------------------------------------------
// 10. The seal-authorised repairs are load-bearing, not cosmetic.
// ---------------------------------------------------------------------------
test("#2882 adversarial 10: the four repaired Phase 2 suites route on what their repair unlocked", () => {
  // [TEST-MOD-APPROVED #2882] These four sit inside `suites.slice(0, 23)`, which
  // is byte-sealed by PHASE2_SUITES_SHA256. The seal was re-pinned under that
  // token so this repair could land. Locking the BEHAVIOUR here means a silent
  // revert of the registry edit reds a test that explains itself, rather than
  // only a digest that says "something changed".
  const expectations = [
    ["issue-903-open-external-admin-tests", "mingla-admin/src/lib/__tests__/openExternal.adversarial.tester.test.js"],
    ["issue-1532-tester-adversarial", "mingla-business/src/components/stay/StayChipRow.tsx"],
    ["issue-1532-tester-adversarial", "mingla-business/jest.issue1532.tester.cjs"],
    ["issue-948-w2-bank-route-web-tests", "mingla-business/app/brand/[id]/connect.tsx"],
    ["issue-948-w2-bank-route-web-tests", "mingla-business/app/brand/[id]/connect.web.tsx"],
    ["issue-2322-ios-picker-theming-tests", "app-mobile/src/components/__tests__/issue_2322_ios_picker_theming.tester_adversarial.test.mjs"],
  ];
  for (const [id, file] of expectations) {
    const selection = selectSuites(manifest, manifest.suites, routed([file]));
    assert.ok(selection.selectedSuiteIds.includes(id), `${id} must be selected by ${file}`);
  }
  // And every one of the 23 sealed suites must now be routable at all.
  for (const suite of manifest.suites.slice(0, 23)) {
    const patterns = suiteOriginPatterns(suite);
    assert.ok(patterns.length > 0, `${suite.id}: sealed suite must declare routing data`);
    for (const pattern of patterns) assert.doesNotThrow(() => parseOriginPattern(pattern), `${suite.id}: ${pattern}`);
  }
});

// ---------------------------------------------------------------------------
// 11. SELF-COVERAGE. The invariant that decides whether routing loses coverage.
// ---------------------------------------------------------------------------
function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "buffer" })
    .toString("utf8").split("\0").filter(Boolean);
}

// Repo-relative tracked files that a suite's own COMMANDS name directly. Single
// `*` inside one segment is expanded; anything wider is left alone, so this
// under-reports rather than inventing a dependency.
function executedFiles(suite, tracked, trackedSet) {
  const found = new Set();
  const expand = (candidate) => {
    if (!candidate.includes("*")) return trackedSet.has(candidate) ? [candidate] : [];
    const source = candidate.split("*").map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
    const matcher = new RegExp(`^${source}$`);
    return tracked.filter((file) => matcher.test(file));
  };
  for (const step of suite.steps || []) {
    const cwd = step.cwd && step.cwd !== "." ? step.cwd : "";
    const text = [step.run, ...(step.invocation?.argv || [])].filter(Boolean).join(" ");
    for (const raw of text.split(/[\s"';()]+/)) {
      const token = raw.replace(/^['"]+|['"]+$/g, "");
      if (!token || token.startsWith("-") || token.startsWith("$") || token.includes("**")) continue;
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|sh|ya?ml)$/.test(token)) continue;
      for (const candidate of [cwd ? path.posix.join(cwd, token) : token, token]) {
        for (const file of expand(candidate)) found.add(file);
      }
    }
  }
  return [...found];
}

function selfCoverageGapSuites(value, tracked, trackedSet) {
  const gaps = new Map();
  for (const suite of value.suites) {
    const patterns = suiteOriginPatterns(suite);
    for (const file of executedFiles(suite, tracked, trackedSet)) {
      if (!patterns.some((pattern) => pathMatches(pattern, file))) {
        if (!gaps.has(suite.id)) gaps.set(suite.id, []);
        gaps.get(suite.id).push(file);
      }
    }
  }
  return gaps;
}

// [#2882 tester finding P1-A] Suites that EXECUTE a tracked file their own
// `originPaths` does not watch. Before this change ci-batch ran everything on
// every pull request, so the gap was inert; routing gives it teeth, and a pull
// request touching only such a file now skips the suite that reads it.
//
// Enumerated by suite id, never pattern-matched, so the set cannot quietly grow:
// a NEW suite developing this gap reds this test. Shrinking is free — the
// assertion is a subset, so repairing any of these needs no edit here.
// Reported on #2882 with the full (suite, file) list; the repair is pure
// widening of each suite's originPaths, exactly as §6a widened issue-1532's.
const KNOWN_SELF_COVERAGE_GAP_SUITES = Object.freeze([
  "issue-1022-theme-control-tests",
  "issue-1326-ng-reservation-finalize-tests",
  "issue-1467-venue-submit-idempotency-tests",
  "issue-1685-venue-draft-multi-tests",
  "issue-1902-public-event-lifecycle-tests",
  "issue-1950-app-readiness-tests",
  "issue-1996-business-desktop-sharing-tests",
  "issue-2230-consumer-multiday-tests",
  "issue-2321-account-deletion-tests",
  "issue-2399-multiday-picker-ticket-box",
  "production-readiness-audit",
]);

test("#2882 adversarial 11a: the self-coverage detector is not vacuous", () => {
  // #2113's bug class: a check that cannot fail reports clean forever. Prove the
  // detector fires on a suite constructed to have the exact gap it hunts.
  const tracked = trackedFiles();
  const trackedSet = new Set(tracked);
  const executed = "mingla-business/jest.issue1532.tester.cjs";
  assert.ok(trackedSet.has(executed), "the fixture's executed file must be tracked");
  const template = manifest.suites.find((suite) => suite.id === "issue-1532-tester-adversarial");
  const blind = { ...template, id: "issue-2882-adversarial-selfblind", originPaths: ["docs/**"] };
  const gaps = selfCoverageGapSuites({ suites: [blind] }, tracked, trackedSet);
  assert.deepEqual([...gaps.keys()], ["issue-2882-adversarial-selfblind"], "the detector must fire on a known gap");
  assert.ok(gaps.get("issue-2882-adversarial-selfblind").includes(executed));

  // And it must NOT fire on the same suite once its originPaths covers the file.
  const seeing = { ...template };
  const clean = selfCoverageGapSuites({ suites: [seeing] }, tracked, trackedSet);
  assert.equal(clean.has(seeing.id), false, "a suite that watches what it executes must not be reported");
});

test("#2882 adversarial 11b: no NEW suite may route past a file it executes", () => {
  const tracked = trackedFiles();
  const gaps = selfCoverageGapSuites(manifest, tracked, new Set(tracked));
  const unexpected = [...gaps.keys()].filter((id) => !KNOWN_SELF_COVERAGE_GAP_SUITES.includes(id)).sort();
  assert.deepEqual(unexpected, [],
    `these suites execute a tracked file their originPaths does not watch, so routing would skip them for a diff that changes it:\n`
    + unexpected.map((id) => `  ${id}\n${gaps.get(id).map((file) => `      ${file}`).join("\n")}`).join("\n"));
});

// ---------------------------------------------------------------------------
// Registry-wide closing invariant.
// ---------------------------------------------------------------------------
test("#2882 adversarial 12: the committed registry is clean under all three assertions", () => {
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
  assert.deepEqual(validateOriginPathShapes(raw), [], "F1/F2 must hold on the committed registry");
  assert.deepEqual(validateOriginPathLiveness(manifest, trackedFiles()), [],
    "every pattern must parse and match at least one tracked file, outside the declared exemptions");
  // Selection order equals registry order, because verdict()'s identity check is
  // preserved verbatim on the routed set.
  const order = manifest.suites.map((suite) => suite.id);
  const selection = selectSuites(manifest, manifest.suites, routed(["mingla-business/src/components/stay/StayChipRow.tsx"]));
  assert.deepEqual(selection.selectedSuiteIds, [...selection.selectedSuiteIds].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
});
