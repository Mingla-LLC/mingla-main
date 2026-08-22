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
const SOURCE = { eventName: "pull_request", baseSha: "1".repeat(40), headSha: "2".repeat(40), mergeBaseSha: "1".repeat(40), pathSource: "local-git-three-dot-nul" };

test("canonical cost fixture is complete and byte-locked", () => {
  assert.equal(digest(fixture), "e31b286ac8d29fbb5749a1fd21025559aab6ce7df62af9f1562e6a8c52bd8d55");
  const lines = fixture.toString("utf8").trimEnd().split("\n"); assert.equal(lines.length, 100); assert.equal(fixture.at(-1), 10);
  const records = lines.map(JSON.parse); const distribution = [0,1,2,3,4,5].map((count) => records.filter((row) => row.matchedOrigins.length === count).length);
  assert.deepEqual(distribution, [25,41,20,9,4,1]);
  const large = records.find((row) => row.pr === 2201); assert.equal(large.pathCount, 11362); assert.equal(large.pathSha256, "51764c43bad76f056f343f9bb851597e378e23b005680d10b7e4b5fc1a7c135b");
});

test("all 100 frozen records reproduce from complete local Git objects", () => {
  const records=fixture.toString("utf8").trimEnd().split("\n").map(JSON.parse); const suites=phase3bSuites(manifest);
  for(const record of records){
    const mergeBase=execFileSync("git",["merge-base",record.baseSha,record.headSha],{cwd:ROOT,encoding:"utf8"}).trim(); assert.equal(mergeBase,record.mergeBaseSha,`PR #${record.pr} merge-base`);
    const paths=parseNulPaths(execFileSync("git",["diff","--name-only","-z","--no-renames","--diff-filter=ACMRTD",`${record.baseSha}...${record.headSha}`],{cwd:ROOT,encoding:"buffer",maxBuffer:64*1024*1024}));
    assert.equal(paths.length,record.pathCount,`PR #${record.pr} path count`); assert.equal(digest(Buffer.concat(paths.map((value)=>Buffer.from(`${value}\0`)))),record.pathSha256,`PR #${record.pr} path digest`);
    const matched=suites.filter((suite)=>paths.some((file)=>suite.originPaths.some((pattern)=>pathMatches(pattern,file)))).map((suite)=>path.basename(suite.origin)).sort();
    assert.deepEqual(matched,record.matchedOrigins,`PR #${record.pr} matched origins`);
  }
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
