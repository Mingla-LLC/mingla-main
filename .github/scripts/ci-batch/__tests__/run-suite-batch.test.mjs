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
import { loadManifest, expectedSuites, runSuites, verdict, runStep } from "../run-suite-batch.mjs";

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

test("the batched suites' original workflows are GONE, so nothing runs twice", () => {
  for (const suite of expectedSuites(loadManifest(), null)) {
    const origin = path.resolve(REPO_ROOT, suite.origin);
    assert.equal(
      fs.existsSync(origin),
      false,
      `${suite.id} is registered in the batch AND still has its own workflow at ${suite.origin} — it would run twice, and deleting the batch entry would leave no trace`,
    );
  }
});
