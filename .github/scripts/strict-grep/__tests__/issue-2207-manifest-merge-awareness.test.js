#!/usr/bin/env node
/**
 * Issue #2207 implementor regression guard.
 *
 * Different truths are exercised together because they failed independently:
 * META-1383 must reject a wired floor that trails reality, and a combined-main
 * mismatch must name the recent gate-registration commits that produced it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectRecentGateRegistrationCommits,
  formatMergeCounterCollision,
  runChecks,
} from "../meta-1383-manifest-parity.mjs";

const SG_REL = ".github/scripts/strict-grep";

function exactTruthFixture() {
  const gates = ["alpha.mjs", "beta.mjs"].map((name) => ({
    script: `${SG_REL}/${name}`,
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["self-test", "plain"],
    selfTest: "wired",
    jobKeys: [],
  }));
  return {
    manifest: {
      expectedStrictGrepMjsFiles: 2,
      selfTestWiredFloor: 1,
      unenforcedCap: 0,
      fixtureCap: 0,
      capableUnwiredCap: 0,
      externalGateDirs: [],
      gates,
    },
    diskFiles: gates.map((gate) => gate.script),
    readSource: () => `if (process.argv.includes('${"--" + "self-test"}')) {}`,
    fileExists: () => true,
    workflowInvocations: {},
    jobInvocations: {},
    externalDiskFiles: {},
  };
}

function git(repo, ...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function gate(name) {
  return {
    script: `${SG_REL}/${name}`,
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["self-test", "plain"],
    selfTest: "wired",
    jobKeys: [],
  };
}

function writeManifest(repo, { expected, floor, names }) {
  writeFileSync(
    join(repo, SG_REL, "MANIFEST.json"),
    `${JSON.stringify({ expectedStrictGrepMjsFiles: expected, selfTestWiredFloor: floor, gates: names.map(gate) }, null, 2)}\n`,
  );
}

test("P7 rejects the false-green state where wired truth is above the stored floor", () => {
  const failures = runChecks(exactTruthFixture());
  assert.deepEqual(
    failures,
    [
      "P7: selfTest:\"wired\" count 2 does not EQUAL selfTestWiredFloor 1. " +
        "The floor is measured truth, not a lower bound: wiring a self-test and advancing " +
        "the floor must land together. Lowering it still needs a GATE-REMOVAL: commit token.",
    ],
  );
});

test("combined-main collision evidence names both back-to-back gate registrations", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "issue-2207-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, SG_REL), { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Issue 2207 Test");
  git(repo, "config", "user.email", "issue-2207@example.invalid");

  writeFileSync(join(repo, SG_REL, "alpha.mjs"), "// alpha\n");
  writeManifest(repo, { expected: 1, floor: 1, names: ["alpha.mjs"] });
  git(repo, "add", SG_REL);
  git(repo, "commit", "-m", "baseline");

  writeFileSync(join(repo, SG_REL, "beta.mjs"), "// beta\n");
  writeManifest(repo, { expected: 2, floor: 2, names: ["alpha.mjs", "beta.mjs"] });
  git(repo, "add", SG_REL);
  git(repo, "commit", "-m", "Feature A gate registration (#201)");

  // This is the combined tree produced when a second PR was correct on its
  // stale base but retained the first PR's already-used counter values.
  writeFileSync(join(repo, SG_REL, "gamma.mjs"), "// gamma\n");
  writeManifest(repo, { expected: 2, floor: 2, names: ["alpha.mjs", "beta.mjs", "gamma.mjs"] });
  git(repo, "add", SG_REL);
  git(repo, "commit", "-m", "Feature B gate registration (#202)");

  const candidates = collectRecentGateRegistrationCommits({ repoRoot: repo, limit: 3 });
  const diagnosis = formatMergeCounterCollision({
    declaredFiles: 2,
    diskFileCount: 3,
    wiredFloor: 2,
    wiredCount: 3,
    candidates,
  });

  assert.equal(candidates.length, 2);
  assert.match(diagnosis, /Feature B gate registration \(#202\)/);
  assert.match(diagnosis, /Feature A gate registration \(#201\)/);
  assert.match(diagnosis, /gamma\.mjs/);
  assert.match(diagnosis, /beta\.mjs/);
  assert.match(diagnosis, /expected files 1 -> 2/);
  assert.match(diagnosis, /expected files 2 -> 2/);
  assert.match(diagnosis, /wired entries 2 -> 3/);
});

test("no mismatch emits no collision banner", () => {
  assert.equal(
    formatMergeCounterCollision({
      declaredFiles: 4,
      diskFileCount: 4,
      wiredFloor: 3,
      wiredCount: 3,
      candidates: [],
    }),
    "",
  );
});
