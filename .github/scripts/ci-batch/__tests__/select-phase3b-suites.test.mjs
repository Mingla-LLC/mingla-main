import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveChangedPaths, parseNulPaths, parseOriginPattern, pathMatches, phase3bSuites, selectionDocument, normalizeDecision, validateDecision } from "../select-phase3b-suites.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
const fixture = fs.readFileSync(path.join(ROOT, ".github/scripts/ci-batch/__tests__/fixtures/issue-2438-cost-baseline-v1.jsonl"));
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
// [#2438 A7-SC6] Region-scoped offline guard. It asserts ONLY on the bytes
// between the two sentinels, so retained subtest 5 — which legitimately shells
// to git against a synthetic repository it creates itself — stays green. A
// guard that reds on subtest 5 is itself a defect, so the paired negative is
// asserted too. It lives at module scope so it can run BEFORE the region and
// again as its own test: a guard placed after the code it guards cannot fail.
// Assembled at runtime so the only literal occurrence of each sentinel in this
// file is the sentinel itself. The exactly-one assertions below then pin that.
const OFFLINE_REGION_MARK = "// [#2438 A7-SC6 OFFLINE-REGION ";
const OFFLINE_REGION_BEGIN = `${OFFLINE_REGION_MARK}BEG${"IN]"}`;
const OFFLINE_REGION_END = `${OFFLINE_REGION_MARK}E${"ND]"}`;
const OFFLINE_REGION_FORBIDDEN = [
  "test.skip", "it.skip", "describe.skip", ".only", "t.skip(",
  "execFileSync", "spawnSync", "execSync", "exec(",
  "return", "try {", "catch", "fetch(", "refs/pull", "https:", "http:",
  // [#2438] process.exit is the remaining silent bypass: it ends the worker
  // before the runner can record a failure, so a region that calls it reports
  // nothing rather than reporting red.
  "process.exit",
];
// [#2438] Generic sealed-region guard. Subtest 1 is the ONLY reader of the
// e31b286a... baseline seal — a fixture byte flip fires that subtest and nothing
// else — so gutting it with a three-line pure addition while corrupting the
// fixture would leave the whole file green with the cost claim unverified. It
// gets the same treatment as the offline region: a guard that runs BEFORE the
// body it guards, and again as its own test.
function assertSealedRegion(mark, label, minimumAssertions) {
  const begin = `${mark}BEG${"IN]"}`;
  const end = `${mark}E${"ND]"}`;
  const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const at = self.indexOf(begin);
  const to = self.indexOf(end);
  assert.ok(at > 0 && to > at, `the ${label} sentinels must both be present and ordered`);
  assert.equal(self.split(begin).length - 1, 1, `exactly one ${label} BEGIN sentinel must exist in this file`);
  assert.equal(self.split(end).length - 1, 1, `exactly one ${label} END sentinel must exist in this file`);
  const region = self.slice(at + begin.length, to);
  const outside = self.slice(0, at) + self.slice(to + end.length);
  for (const token of OFFLINE_REGION_FORBIDDEN) {
    assert.equal(region.includes(token), false, `the ${label} must never contain ${token}`);
  }
  for (const invocation of ['"git",', "'git',", "child_process"]) {
    assert.equal(region.includes(invocation), false, `the ${label} must never invoke a subprocess (${invocation})`);
  }
  assert.ok((region.match(/\bassert\./g) || []).length >= minimumAssertions,
    `the ${label} must retain its full assertion body`);
  assert.equal(outside.includes('execFileSync("git",args,{cwd:repo,encoding:"utf8"})'), true,
    `${label}: retained subtest 5's synthetic-repo git invocation must stay outside the guarded region`);
  assert.equal(OFFLINE_REGION_FORBIDDEN.filter((token) => outside.includes(token)).length >= 4, true,
    `${label} must be region-scoped, not file-scoped: forbidden tokens legitimately exist outside it`);
}

const BASELINE_SEAL_MARK = "// [#2438 A7-SC6 BASELINE-SEAL-REGION ";
function assertBaselineSealRegionIsSealed() {
  assertSealedRegion(BASELINE_SEAL_MARK, "A7-SC6 baseline-seal region", 6);
}

function assertOfflineRegionIsSealed() {
  const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const begin = self.indexOf(OFFLINE_REGION_BEGIN);
  const end = self.indexOf(OFFLINE_REGION_END);
  assert.ok(begin > 0 && end > begin, "the A7-SC6 offline region sentinels must both be present and ordered");
  assert.equal(self.split(OFFLINE_REGION_BEGIN).length - 1, 1, "exactly one BEGIN sentinel must exist in this file");
  assert.equal(self.split(OFFLINE_REGION_END).length - 1, 1, "exactly one END sentinel must exist in this file");
  const region = self.slice(begin + OFFLINE_REGION_BEGIN.length, end);
  const outside = self.slice(0, begin) + self.slice(end + OFFLINE_REGION_END.length);
  for (const token of OFFLINE_REGION_FORBIDDEN) {
    assert.equal(region.includes(token), false, `the A7-SC6 offline region must never contain ${token}`);
  }
  for (const invocation of ['"git",', "'git',", "child_process"]) {
    assert.equal(region.includes(invocation), false, `the A7-SC6 offline region must never invoke a subprocess (${invocation})`);
  }
  // The region must still carry its weight: gutting it is as much a false green
  // as skipping it.
  assert.ok((region.match(/\bassert\./g) || []).length >= 30,
    "the A7-SC6 offline region must retain its full assertion body");
  // Paired negative: subtest 5's synthetic-repo shell-out is OUTSIDE the region
  // and must remain untouched and unguarded.
  assert.equal(outside.includes('execFileSync("git",args,{cwd:repo,encoding:"utf8"})'), true,
    "retained subtest 5's legitimate synthetic-repo git invocation must stay outside the guarded region");
  assert.equal(OFFLINE_REGION_FORBIDDEN.filter((token) => outside.includes(token)).length >= 4, true,
    "the guard must be region-scoped, not file-scoped: forbidden tokens legitimately exist outside the region");
}

const SOURCE = { eventName: "pull_request", baseSha: "1".repeat(40), headSha: "2".repeat(40), mergeBaseSha: "1".repeat(40), pathSource: "local-git-three-dot-nul" };

test("canonical cost fixture is complete and byte-locked", () => {
  assertBaselineSealRegionIsSealed();
  // [#2438 A7-SC6 BASELINE-SEAL-REGION BEGIN]
  assert.equal(digest(fixture), "e31b286ac8d29fbb5749a1fd21025559aab6ce7df62af9f1562e6a8c52bd8d55");
  const lines = fixture.toString("utf8").trimEnd().split("\n"); assert.equal(lines.length, 100); assert.equal(fixture.at(-1), 10);
  const records = lines.map(JSON.parse); const distribution = [0,1,2,3,4,5].map((count) => records.filter((row) => row.matchedOrigins.length === count).length);
  assert.deepEqual(distribution, [25,41,20,9,4,1]);
  const large = records.find((row) => row.pr === 2201); assert.equal(large.pathCount, 11362); assert.equal(large.pathSha256, "51764c43bad76f056f343f9bb851597e378e23b005680d10b7e4b5fc1a7c135b");
  // [#2438 A7-SC6 BASELINE-SEAL-REGION END]
});

// [#2438 A7-SC6] Replacement for `all 100 frozen records reproduce from complete
// local Git objects`. That subtest has NEVER passed in CI and cannot, for two
// independent verified reasons: class A is a fetch-depth:1 checkout, and 60 of
// the 100 head commits are reachable from no remote ref, so `fetch-depth: 0`
// would not save it either. Its four assertions supplied only negative coverage.
// Provenance is discharged once and durably by the A7-SC7 reproduction ledger,
// off CI; CI enforces INTEGRITY against the sealed bytes. This replacement is
// strictly stronger offline: it locks the 100 identities and their order, the
// exact per-record key order by byte round-trip, every SHA shape, the origin
// distribution and mean, the #2201 facts, the no-truncation property, the
// bracket-path decisions through the production matcher, and — as the structural
// substitute for the removed merge-base derivation — the exact 98/100 split plus
// both divergent records by identity. It does NOT re-derive merge-base; that
// proof lives in the ledger.
test("all 100 frozen records are offline-locked: identity, key order, distribution, and merge-base split", () => {
  // The guard runs BEFORE the region it guards. Ordered the other way it is
  // itself unfalsifiable: an early return between the sentinels skips the
  // region's assertions AND the guard, and the subtest reports ok with nothing
  // executed. It is additionally re-run as its own test below, so no control
  // flow inside this body can suppress it.
  assertOfflineRegionIsSealed();
  // [#2438 A7-SC6 OFFLINE-REGION BEGIN]
  const lines = fixture.toString("utf8").trimEnd().split("\n");
  const records = lines.map(JSON.parse);
  const suites = phase3bSuites(manifest);
  const KEY_ORDER = ["pr", "baseSha", "headSha", "mergeBaseSha", "pathSource", "pathCount", "pathSha256", "matchedOrigins"];
  const SHA40 = /^[0-9a-f]{40}$/;
  const SHA64 = /^[0-9a-f]{64}$/;
  const allowlist = suites.map((suite) => path.basename(suite.origin)).sort();

  // 1. Exact ordered identity of all 100 PRs.
  assert.equal(records.length, 100);
  assert.deepEqual(records.map((row) => row.pr), [
    2456,2452,2451,2450,2447,2444,2442,2434,2433,2430,2428,2427,2424,2423,2420,2416,2413,2412,2410,2408,
    2405,2404,2403,2402,2397,2394,2392,2390,2388,2386,2384,2380,2372,2369,2366,2365,2364,2362,2361,2360,
    2354,2352,2350,2346,2345,2336,2334,2330,2327,2325,2320,2318,2316,2314,2313,2312,2311,2309,2307,2304,
    2303,2301,2299,2298,2296,2293,2288,2282,2278,2276,2275,2274,2263,2259,2258,2257,2255,2249,2247,2244,
    2236,2233,2225,2224,2221,2219,2214,2212,2206,2205,2203,2201,2196,2195,2194,2192,2189,2185,2183,2182,
  ]);
  assert.equal(new Set(records.map((row) => row.pr)).size, 100);

  // 2. Per-record exact key order, proven by compact round-trip byte equality
  //    against the raw line. Re-serialising with any other key order breaks this
  //    even when the fixture digest is re-sealed to match.
  assert.deepEqual([...new Set(records.map((row) => Object.keys(row).join(",")))], [KEY_ORDER.join(",")]);
  assert.deepEqual(records.map((row, index) => JSON.stringify(row) === lines[index]), records.map(() => true));

  // 3. Canonical derivation source, on every record.
  assert.equal(records.filter((row) => row.pathSource === "git-diff-z-v1").length, 100);

  // 4. 40-hex-lowercase shape on all 300 commit identities, plus 64-hex digests.
  assert.equal(records.filter((row) => SHA40.test(row.baseSha)).length, 100);
  assert.equal(records.filter((row) => SHA40.test(row.headSha)).length, 100);
  assert.equal(records.filter((row) => SHA40.test(row.mergeBaseSha)).length, 100);
  assert.equal(records.filter((row) => SHA64.test(row.pathSha256)).length, 100);

  // 5. Matched-origin distribution: sum 129 over 100 records, mean exactly 1.29.
  const originSum = records.reduce((total, row) => total + row.matchedOrigins.length, 0);
  assert.equal(originSum, 129);
  assert.equal(originSum / records.length, 1.29);

  // 6. Every matched origin is drawn from the frozen 12-origin Phase 3B
  //    allowlist, and every list is sorted and duplicate-free.
  assert.equal(allowlist.length, 12);
  assert.deepEqual([...new Set(records.flatMap((row) => row.matchedOrigins))].filter((name) => !allowlist.includes(name)), []);
  assert.equal(records.filter((row) => JSON.stringify(row.matchedOrigins) === JSON.stringify([...row.matchedOrigins].sort())).length, 100);
  assert.equal(records.filter((row) => new Set(row.matchedOrigins).size === row.matchedOrigins.length).length, 100);

  // 7. #2201, the largest record, by every field.
  const large = records.find((row) => row.pr === 2201);
  assert.equal(large.baseSha, "4414436a9617b075e2065118f5821458248058d2");
  assert.equal(large.headSha, "9a3c551798a3aae58fa4de5de3e1511647f5fa21");
  assert.equal(large.mergeBaseSha, large.baseSha);
  assert.equal(large.pathCount, 11362);
  assert.equal(large.pathSha256, "51764c43bad76f056f343f9bb851597e378e23b005680d10b7e4b5fc1a7c135b");
  assert.deepEqual(large.matchedOrigins, []);

  // 8. No-truncation: the 3,000-file-capped REST endpoint was never a source.
  assert.equal(records.filter((row) => row.pathCount === 3000).length, 0);
  assert.equal(records.filter((row) => row.pathCount > 3000).length, 1);

  // 9. Offline substitute for the removed `git merge-base` derivation. This
  //    preserves the INFORMATION that merge-base is not always base, and where,
  //    without needing the objects. It is a structural substitute, not an
  //    equivalent: the derivational proof is discharged in the A7-SC7 ledger.
  assert.equal(records.filter((row) => row.mergeBaseSha === row.baseSha).length, 98);
  assert.deepEqual(records.filter((row) => row.mergeBaseSha !== row.baseSha).map((row) => row.pr), [2402, 2361]);
  const divergent = (pr) => records.find((row) => row.pr === pr);
  assert.deepEqual(
    [divergent(2402).baseSha, divergent(2402).headSha, divergent(2402).mergeBaseSha],
    ["e2b248c9fa77894ad13658b1727a82ea06e0b85e", "8978872add35e6d794c4145cc5b3644eb1bfc8f2", "23588b7d1ecff4f1756b3e1a042d8df79941fb8d"],
  );
  assert.deepEqual(
    [divergent(2361).baseSha, divergent(2361).headSha, divergent(2361).mergeBaseSha],
    ["1c6f27bc733bee05980c5010120ae9a001158bb6", "8d30f0897cea103145c40b003144339b638780c4", "b65894f247974ee0348b15758e885b39976995da"],
  );

  // 10. Both `[id]` bracket literals decided by the PRODUCTION matcher, and the
  //     character-class reading rejected in both of its plausible forms.
  const themeHost = suites.find((suite) => suite.id === "issue-1022-theme-control-tests");
  for (const literal of ["mingla-business/app/event/[id]/edit.tsx", "mingla-business/app/rsvp/[id]/edit.tsx"]) {
    assert.deepEqual(selectionDocument(manifest, themeHost.hostClass, [literal]).selectedSuiteIds, ["issue-1022-theme-control-tests"]);
    assert.equal(pathMatches(literal, literal), true);
  }
  for (const impostor of ["mingla-business/app/event/id/edit.tsx", "mingla-business/app/event/i/edit.tsx"]) {
    assert.deepEqual(selectionDocument(manifest, themeHost.hostClass, [impostor]).selectedSuiteIds, []);
    assert.equal(pathMatches("mingla-business/app/event/[id]/edit.tsx", impostor), false);
  }
  // [#2438 A7-SC6 OFFLINE-REGION END]
});

test("reviewed grammar treats brackets literally and rejects unsafe glob dialects", () => {
  for (const literal of ["mingla-business/app/event/[id]/edit.tsx", "mingla-business/app/rsvp/[id]/edit.tsx"]) {
    assert.equal(pathMatches(literal, literal), true); assert.equal(pathMatches(literal, literal.replace("[id]", "id")), false);
  }
  assert.equal(pathMatches("a/**", "a/b/c"), true); assert.equal(pathMatches("a/b*", "a/bee"), true); assert.equal(pathMatches("a/b*", "a/b/c"), false);
  for (const bad of ["/a", "a//b", "a/../b", "a?b", "a/**/b", "a/*/b", "a\0b", "a\nb"]) assert.throws(() => parseOriginPattern(bad));
  assert.deepEqual(parseNulPaths(Buffer.from("z\0a\0")), ["a", "z"]); assert.throws(() => parseNulPaths(Buffer.from("a\n")));
});

test("selection is host-local, exact, and fail-safe on missing or corrupt evidence", () => {
  assert.equal(phase3bSuites(manifest).length, 12);
  const host = "ota-app-node20-19-install";
  const selected = selectionDocument(manifest, host, ["mingla-business/app/venue/create.tsx"], { source: SOURCE });
  assert.equal(selected.selectedSuiteIds.length, 3); validateDecision(manifest, selected, host);
  const zero = selectionDocument(manifest, host, ["README.md"], { source: SOURCE }); assert.deepEqual(zero.selectedSuiteIds, []);
  const failed = normalizeDecision(manifest, null, host, "failure"); assert.equal(failed.deferredError, true); assert.equal(failed.selectedSuiteIds.length, 4);
  const corrupt = structuredClone(selected); corrupt.selectedSuiteIds.push("foreign"); assert.throws(() => validateDecision(manifest, corrupt, host));
});

test("PR three-dot and push two-dot derive complete NUL-safe local Git evidence", () => {
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),"phase3b-selector-git-")); const git=(args)=>execFileSync("git",args,{cwd:repo,encoding:"utf8"}).trim();
  try {
    git(["init","-q"]); git(["config","user.email","ci@example.invalid"]); git(["config","user.name","CI"]);
    fs.mkdirSync(path.join(repo,"old")); fs.writeFileSync(path.join(repo,"old","deleted.txt"),"old\n"); git(["add","."]); git(["commit","-qm","base"]); const base=git(["rev-parse","HEAD"]);
    fs.rmSync(path.join(repo,"old","deleted.txt")); fs.mkdirSync(path.join(repo,"mingla-business","app","event","[id]"),{recursive:true}); fs.writeFileSync(path.join(repo,"mingla-business","app","event","[id]","edit.tsx"),"new\n");
    git(["add","-A"]); git(["commit","-qm","head"]); const head=git(["rev-parse","HEAD"]);
    const pr=deriveChangedPaths({root:repo,eventName:"pull_request",event:{pull_request:{base:{sha:base},head:{sha:head}}}});
    const push=deriveChangedPaths({root:repo,eventName:"push",event:{before:base,after:head}});
    assert.deepEqual(pr.changedPaths,["mingla-business/app/event/[id]/edit.tsx","old/deleted.txt"]); assert.deepEqual(push.changedPaths,pr.changedPaths);
    assert.equal(pr.pathSource,"local-git-three-dot-nul"); assert.equal(push.pathSource,"local-git-two-dot-nul"); assert.equal(pr.mergeBaseSha,base);
    validateDecision(manifest,selectionDocument(manifest,"node22-noinstall",pr.changedPaths,{source:pr}),"node22-noinstall");
  } finally { fs.rmSync(repo,{recursive:true,force:true}); }
});

test("#2013 wakes from its exact guard path and every other wrapper wakes from its marker path", () => {
  const suites = phase3bSuites(manifest);
  const tenant = suites.find((suite) => suite.ownerIssue === "#2013");
  assert.equal(tenant.originPaths.length, 16); assert.equal(tenant.originPaths.at(-1), ".github/scripts/strict-grep/issue-2013-ari-tenant-containment.mjs");
  assert.equal(selectionDocument(manifest, tenant.hostClass, [tenant.originPaths.at(-1)]).selectedSuiteIds.includes(tenant.id), true);
  for (const suite of suites.filter((item) => item !== tenant)) assert.equal(selectionDocument(manifest, suite.hostClass, [suite.origin]).selectedSuiteIds.includes(suite.id), true);
});

// [#2438 A7-SC6] The guard again, as a test of its own. Nothing inside the
// offline subtest's body — an early return, a thrown bail-out, any control flow
// at all — can suppress a separate test() call. This is the assertion that makes
// "insert an early return between the sentinels" turn the gate RED even if the
// in-body call were ever removed.
test("the A7-SC6 offline region is sealed against skips, bail-outs, and subprocesses", () => {
  assertOfflineRegionIsSealed();
});

// [#2438] The baseline-seal guard as a test of its own, for the same reason the
// offline one has one: nothing inside subtest 1's body can suppress a separate
// test() call, so an early return there turns the gate RED even though the
// gutted subtest itself would still report ok.
test("the A7-SC6 baseline-seal region is sealed against skips, bail-outs, and subprocesses", () => {
  assertBaselineSealRegionIsSealed();
});
