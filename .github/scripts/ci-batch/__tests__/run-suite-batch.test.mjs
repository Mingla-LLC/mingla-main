// #2148 Stage 3. Self-test for the batch runner.
//
// The runner replaces one CI job per suite with one job for many, and the ONLY
// thing that makes that safe is R4: executed === expected. These tests exist to
// prove R4 actually bites, because a batch runner that silently skips is strictly
// WORSE than the per-job arrangement it replaces — it converts many visible
// checks into one green lie. #2113 and #2120 are open about that exact class.
//
// Every test below fails if the corresponding rule is weakened.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDependencyCwds, createIsolatedWorkspace, dependencyMaterializations, expectedPrimarySuites, loadManifest, expectedSuites, runSuites, verdict, runStep } from "../run-suite-batch.mjs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { canonicalInstallIdentity, SUITES_ADDED_SINCE_SEAL } from "../validate-manifest-v2.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

const okSuite = (id) => ({ id, class: "t", steps: [{ name: id, cwd: ".", run: "true" }] });
const badSuite = (id, code = 1) => ({ id, class: "t", steps: [{ name: id, cwd: ".", run: `exit ${code}` }] });

test("R4: a suite that silently vanishes turns the run RED even when every suite that ran passed", () => {
  const results = runSuites([okSuite("a"), okSuite("b")]);
  assert.equal(results.every((r) => r.ok), true, "both ran suites passed");
  // Expected 3, only 2 executed — the shape of a dropped/renamed suite.
  const v = verdict(3, results);
  assert.equal(v.ok, false, "a shortfall MUST fail the run");
  assert.equal(v.shortfall, 1);
  assert.notEqual(v.code, 0, "exit code must be non-zero on a shortfall");
});

test("R2: one failing suite does not stop the others from running", () => {
  const results = runSuites([badSuite("first"), okSuite("second"), okSuite("third")]);
  assert.equal(results.length, 3, "every suite must run even after a failure");
  assert.deepEqual(results.map((r) => r.id), ["first", "second", "third"]);
  assert.equal(results[1].ok, true);
  assert.equal(results[2].ok, true);
});

test("R8: green requires BOTH no failures AND no shortfall", () => {
  assert.equal(verdict(2, runSuites([okSuite("a"), okSuite("b")])).ok, true);
  assert.equal(verdict(2, runSuites([okSuite("a"), badSuite("b")])).ok, false);
});

test("R9: a suite's exit code is passed through, never collapsed", () => {
  const v = verdict(1, runSuites([badSuite("hard", 2)]));
  assert.equal(v.code, 2, "exit 2 must not become 1");
});

test("R3: a step whose working directory is missing FAILS, it does not skip", () => {
  const r = runStep({ name: "x", cwd: "definitely/not/here", run: "true" });
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
  assert.match(r.reason, /working directory does not exist/);
});

test("R1: the expected set is derived from the manifest, and the real manifest is self-consistent", () => {
  const m = loadManifest();
  const all = expectedSuites(m, null);
  assert.equal(
    all.length,
    m.expectedSuites,
    "expectedSuites must equal the number of registered suites — if this fails, someone added or removed a suite without the visible act of changing the count",
  );
  assert.ok(all.length > 0, "an empty manifest must never be treated as success");
  const ids = all.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "suite ids must be unique");
});

// [TEST-MOD-APPROVED #2897] The 55 established suites are unchanged; the vector
// and the total now add the validator's single declared post-seal set rather than
// carrying a second hand-typed number that must agree with it.
test("#2438 primary routing freezes 55 established suites and excludes every Phase 3B suite", () => {
  const manifest = loadManifest(); const phase3b = new Set(manifest.suites.filter((suite) => suite.migrationWave === "phase3b-postgres-wave").map((suite) => suite.id));
  const vector = Object.fromEntries(manifest.classes.map((klass) => [klass, expectedPrimarySuites(manifest, klass).length]));
  assert.deepEqual(vector, { "admin-node20-install":2, "app-node22-install":6, "business-node20-1":2, "business-node20-2":3,
    "business-node20-3":5, "business-node20-4":5, "business-node22-ignore-scripts":3, "cross-root-node22-ignore-scripts":1,
    "node20-19-noinstall":1, "node20-noinstall":14 + SUITES_ADDED_SINCE_SEAL.length, "node22-noinstall":10, "ota-app-node20-19-install":1,
    "ota-business-node20-19-install":1, "root-node20-yaml-no-save":1 });
  assert.equal(expectedPrimarySuites(manifest, null).length, 55 + SUITES_ADDED_SINCE_SEAL.length);
  assert.equal(expectedPrimarySuites(manifest, null).some((suite) => phase3b.has(suite.id)), false);
});

test("#2438 canonical dependency materialization deduplicates repeated cwd and preserves isolation", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phase3b-clone-once-")));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["config", "user.email", "ci@example.invalid"], { cwd: root }); execFileSync("git", ["config", "user.name", "CI"], { cwd: root });
    fs.mkdirSync(path.join(root,"pkg"),{recursive:true}); fs.mkdirSync(path.join(root,"packages/local"),{recursive:true});
    fs.writeFileSync(path.join(root,"pkg/proof.txt"),"proof\n"); fs.writeFileSync(path.join(root,"packages/local/package.json"),'{"name":"local"}\n');
    execFileSync("git",["add","."],{cwd:root}); execFileSync("git",["commit","-qm","fixture"],{cwd:root});
    fs.mkdirSync(path.join(root,"pkg/node_modules/renderer"),{recursive:true}); fs.writeFileSync(path.join(root,"pkg/node_modules/renderer/second-install.txt"),"present\n");
    fs.symlinkSync("../../packages/local",path.join(root,"pkg/node_modules/local-link"));
    const profile={classes:["fixture"],installs:[{cwd:"pkg"},{cwd:"pkg"}]}; const suite={setupProfile:"fixture"};
    assert.deepEqual(canonicalDependencyCwds(profile,"fixture"),["pkg"]);
    const workspace=createIsolatedWorkspace({root,profile,suite});
    try {
      assert.deepEqual(workspace.dependencyCwds,["pkg"]); assert.equal(workspace.dependencyCloneCount,1);
      assert.equal(fs.existsSync(path.join(workspace.root,"pkg/node_modules/node_modules")),false);
      assert.equal(fs.readFileSync(path.join(workspace.root,"pkg/node_modules/renderer/second-install.txt"),"utf8"),"present\n");
      assert.equal(fs.realpathSync(path.join(workspace.root,"pkg/node_modules/local-link")),fs.realpathSync(path.join(workspace.root,"packages/local")));
      const source=fs.statSync(path.join(root,"pkg/node_modules/renderer/second-install.txt"),{bigint:true}); const isolated=fs.statSync(path.join(workspace.root,"pkg/node_modules/renderer/second-install.txt"),{bigint:true});
      assert.notDeepEqual([source.dev,source.ino],[isolated.dev,isolated.ino]); fs.writeFileSync(path.join(workspace.root,"pkg/node_modules/renderer/second-install.txt"),"mutated\n");
      assert.equal(fs.readFileSync(path.join(root,"pkg/node_modules/renderer/second-install.txt"),"utf8"),"present\n");
    } finally { workspace.cleanup(); }
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("#2438 repository-root sentinel is one exact tuple and never a joined manifest path", () => {
  const manifest=loadManifest(); const profile=manifest.setupProfiles["root-node20-yaml-no-save"];
  const rootInstall=profile.installs[0];
  assert.deepEqual(dependencyMaterializations(profile,"root-node20-yaml-no-save"),[{canonicalCwd:"<repo-root>",storedCwd:"."}]);
  assert.equal(canonicalInstallIdentity("root-node20-yaml-no-save",profile,0),"<repo-root>");
  const mutants=[
    [structuredClone(profile),"other"],
    [{...structuredClone(profile),classes:["other"]},"root-node20-yaml-no-save"],
    [{classes:[...profile.classes],installs:[structuredClone(rootInstall),structuredClone(rootInstall)]},"root-node20-yaml-no-save"],
    [{...structuredClone(profile),installs:[{...rootInstall,cwd:"./"}]},"root-node20-yaml-no-save"],
    [{...structuredClone(profile),installs:[{...rootInstall,cwd:""}]},"root-node20-yaml-no-save"],
    [{...structuredClone(profile),installs:[{...rootInstall,invocation:{...rootInstall.invocation,argv:["ci"]}}]},"root-node20-yaml-no-save"],
  ];
  for(const [candidate,name] of mutants) {assert.throws(()=>dependencyMaterializations(candidate,name),/canonical/);assert.throws(()=>canonicalInstallIdentity(name,candidate,0),/noncanonical/);}
  for(const cwd of ["./x","x/.","x/..","..","../x","/x","x/","x//y","x\\y","<repo-root>","C:/x"]) {
    assert.throws(()=>canonicalDependencyCwds({installs:[{cwd}]},"fixture"),/canonical/);
    assert.throws(()=>canonicalInstallIdentity("fixture",{classes:["fixture"],installs:[{cwd}]},0),/noncanonical/);
  }
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"root-sentinel-clone-")));
  try {
    execFileSync("git",["init","-q"],{cwd:root}); execFileSync("git",["config","user.email","ci@example.invalid"],{cwd:root}); execFileSync("git",["config","user.name","CI"],{cwd:root});
    fs.writeFileSync(path.join(root,"proof.txt"),"proof\n"); execFileSync("git",["add","."],{cwd:root}); execFileSync("git",["commit","-qm","fixture"],{cwd:root});
    fs.mkdirSync(path.join(root,"node_modules/pkg"),{recursive:true}); fs.writeFileSync(path.join(root,"node_modules/pkg/index.js"),"source\n");
    const workspace=createIsolatedWorkspace({root,profile,suite:{setupProfile:"root-node20-yaml-no-save"}});
    try {
      assert.deepEqual(workspace.dependencyCwds,["<repo-root>"]); assert.equal(workspace.dependencyCloneCount,1);
      assert.equal(fs.existsSync(path.join(workspace.root,"node_modules/pkg/index.js")),true);
      assert.equal(fs.existsSync(path.join(workspace.root,"<repo-root>")),false); assert.equal(fs.existsSync(path.join(workspace.root,"node_modules/node_modules")),false);
      const source=fs.statSync(path.join(root,"node_modules/pkg/index.js"),{bigint:true}); const isolated=fs.statSync(path.join(workspace.root,"node_modules/pkg/index.js"),{bigint:true});
      assert.notDeepEqual([source.dev,source.ino],[isolated.dev,isolated.ino]);
    } finally {workspace.cleanup();}
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test("every registered suite names real files and a real working directory", () => {
  for (const suite of expectedSuites(loadManifest(), null)) {
    assert.ok(suite.steps.length > 0, `${suite.id} has no steps — it would pass vacuously`);
    for (const step of suite.steps) {
      const dir = path.resolve(REPO_ROOT, step.cwd || ".");
      assert.ok(fs.existsSync(dir), `${suite.id}: cwd does not exist: ${step.cwd}`);
      assert.ok(step.run && step.run.trim().length > 0, `${suite.id}: empty command`);
    }
  }
});

test("every manifest class has a matrix entry — a class with no runner NEVER RUNS", () => {
  // Without this, adding a class to the manifest and forgetting the matrix entry
  // silently retires every suite in it: expectedSuites still counts them, but no
  // job ever asks for that class, so R4 never fires. That is a dark gate created
  // by omission, which is the failure mode this whole runner exists to prevent.
  const m = loadManifest();
  const wf = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ci-batch.yml"), "utf8");
  const matrix = new Set([...wf.matchAll(/- class:\s*(\S+)/g)].map((x) => x[1]));
  for (const klass of m.classes) {
    assert.ok(matrix.has(klass), `manifest class "${klass}" has no matrix entry in ci-batch.yml — its suites would never run`);
  }
  const declared = new Set(m.suites.map((s) => s.class));
  for (const klass of declared) {
    assert.ok(m.classes.includes(klass), `suite class "${klass}" is missing from manifest.classes`);
  }
  for (const klass of matrix) {
    assert.ok(declared.has(klass), `ci-batch.yml runs class "${klass}" but no suite is registered in it — an empty class must not report green`);
  }
});

test("no batched suite provides a REQUIRED status check", () => {
  // framework-major-guard.yml was caught by this in review: its job name
  // "Framework Major Guard" is required by ruleset 19508605. Folding it into the
  // batch deletes that check name, it never reports again, and EVERY pull request
  // in the repo blocks forever on a check that no longer exists.
  const REQUIRED = ["Framework Major Guard", "mingla-business jest (full suite)"];
  for (const suite of expectedSuites(loadManifest(), null)) {
    for (const req of REQUIRED) {
      const slug = req.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      assert.notEqual(
        suite.id,
        slug,
        `${suite.id} provides required check "${req}" — batching it would block every PR permanently`,
      );
    }
  }
});

test("executable suite origins obey the lifecycle-specific duplicate-provider contract", () => {
  // [TEST-MOD-APPROVED #2437] Shadow is the one reviewed state where both
  // providers intentionally exist. Cutover lifecycles still require the wrapper
  // absent, and shadow requires the exact registered historical provider live.
  const manifest = loadManifest();
  for (const suite of expectedSuites(manifest, null)) {
    const origin = path.resolve(REPO_ROOT, suite.origin);
    assert.ok(
      ["batched-active", "batched-historical", "shadow-active"].includes(suite.lifecycle),
      `${suite.id} has an unreviewed executable lifecycle ${suite.lifecycle}`,
    );
    if (suite.lifecycle === "shadow-active") {
      const legacy = manifest.legacyOrigins.find((item) => `${item.stem}.${item.extension}` === path.basename(suite.origin));
      assert.ok(fs.existsSync(origin), `${suite.id} removed its historical wrapper before shadow parity`);
      assert.equal(legacy?.disposition, "shadow-active", `${suite.id} is not claimed by the shadow origin registry`);
      assert.equal(legacy?.providerWorkflow, suite.origin, `${suite.id} does not name the exact registered live provider`);
    } else {
      assert.equal(
        fs.existsSync(origin),
        false,
        `${suite.id} restored a historical wrapper after batch cutover at ${suite.origin}`,
      );
    }
  }
});
