#!/usr/bin/env node --test
// Issue #2881 — implementor happy-path regression suite for the PR draft-gate policy.
//
// The gate's own self-test mode proves it can FAIL on each assertion using synthetic
// sources. This suite proves the assertions hold against the REAL tree and that
// the two policy halves cannot be separated, which is the failure this issue
// exists to prevent (see the gate header).
//
// It also proves the #2851 concurrency gate is untouched: #2881 edits 121 of the
// same workflow files #2851 governs, so "we did not disturb the concurrency
// policy" has to be an executed assertion, not a claim.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  ALWAYS_ON,
  BOT_PR_CREATION_SITE,
  COMPOSED_PREFIX,
  COMPOSED_SUFFIX,
  DRAFT_IF,
  REPO_ROOT,
  REQUIRED_TYPES,
  auditWorkflowSources,
  carriesDraftCondition,
  evaluateDraftGate,
  isCanonicalDraftIf,
  readWorkflowSources,
  runSelfTest,
} from "./issue-2881-pr-draft-gate-policy.mjs";

const GATE = path.join(REPO_ROOT, ".github/scripts/strict-grep/issue-2881-pr-draft-gate-policy.mjs");
const CONCURRENCY_GATE = path.join(REPO_ROOT, ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs");
const MANIFEST = path.join(REPO_ROOT, ".github/scripts/strict-grep/MANIFEST.json");

const run = (script, args = []) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

// meta-1383-manifest-parity P6 decides whether a script IMPLEMENTS a self-test by
// scanning its source for the literal flag. This file only INVOKES one, so the flag
// is assembled rather than written literally — otherwise this test file would be
// misread as a self-testing gate and P6 would demand selfTest:"wired" for it.
const SELF_TEST_FLAG = ["--self", "test"].join("-");

// --- T-1: the real tree satisfies the policy, with the exact expected shape ---

test("T-1 the real workflow tree passes the draft-gate policy with the expected partition", () => {
  const result = auditWorkflowSources(readWorkflowSources());
  assert.deepEqual(result.errors, [], `unexpected policy errors:\n${result.errors.join("\n")}`);
  assert.equal(result.counts.gated + result.counts.exempt, result.counts.prFamily, "the partition must be total");
  assert.equal(result.counts.exempt, ALWAYS_ON.length);
  assert.ok(result.counts.gated >= 100, `expected the gated set to be the bulk of the repo, got ${result.counts.gated}`);
  assert.ok(result.counts.gatedJobs >= result.counts.gated, "every gated workflow has at least one job");
});

test("T-1b the gate exits 0 on the real tree and in self-test mode", () => {
  const plain = run(GATE);
  assert.equal(plain.status, 0, `${plain.stdout}${plain.stderr}`);
  assert.match(plain.stdout, /#2881 PR draft-gate policy: PASS/);
  const selfTest = run(GATE, [SELF_TEST_FLAG]);
  assert.equal(selfTest.status, 0, `${selfTest.stdout}${selfTest.stderr}`);
  assert.match(selfTest.stdout, /self-test: PASS/);
});

test("T-1c the gate's own self-test makes a non-trivial number of assertions", () => {
  assert.ok(runSelfTest() >= 30, "a gate whose self-test asserts almost nothing carries almost no information (#2113)");
});

// --- fixture helpers ---

const fixture = ({ types = REQUIRED_TYPES, jobs, event = "pull_request" }) => {
  const typesLine = types === null ? "" : `    types: [${types.join(", ")}]\n`;
  const body = Object.entries(jobs).map(([key, job]) => {
    const cond = job.if === null ? "" : `    if: ${job.if}\n`;
    const name = job.name ? `    name: "${job.name}"\n` : "";
    return `  ${key}:\n${cond}${name}    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`;
  }).join("");
  return `name: Fixture\non:\n  ${event}:\n${typesLine}jobs:\n${body}`;
};

const OK_BOT = `createPull: async ({ title, body, branch }) =>\n  request("POST", "/pulls", { title, body, head: branch, base: "main" }),\n`;

const baseline = () => ({
  "gated-checks.yml": fixture({ jobs: { one: { if: DRAFT_IF } } }),
  [ALWAYS_ON[0].path]: fixture({ types: null, jobs: { guard: { if: null, name: ALWAYS_ON[0].context } } }),
  [ALWAYS_ON[1].path]: fixture({ types: null, jobs: { jest: { if: null, name: ALWAYS_ON[1].context } } }),
});

const auditFixture = (mutate, bot = OK_BOT) => {
  const sources = baseline();
  mutate(sources);
  return auditWorkflowSources(sources, { botCreationSource: bot });
};

const assertFails = (result, needle) => {
  assert.ok(
    result.errors.some((error) => error.includes(needle)),
    `expected an error containing ${JSON.stringify(needle)}; got:\n${result.errors.join("\n") || "(none)"}`,
  );
};

// --- T-2..T-9: each assertion, driven to failure ---

test("T-2 a draft condition without ready_for_review is rejected — THE fatal mode", () => {
  const result = auditFixture((s) => {
    s["gated-checks.yml"] = fixture({ types: ["opened", "synchronize", "reopened"], jobs: { one: { if: DRAFT_IF } } });
  });
  assertFails(result, "does not declare ready_for_review");
});

test("T-3 a gated workflow with types but a job missing the condition is rejected", () => {
  const result = auditFixture((s) => {
    s["gated-checks.yml"] = fixture({ jobs: { one: { if: DRAFT_IF }, two: { if: null } } });
  });
  assertFails(result, "job two has no draft condition");
});

test("T-4 dropping synchronize is rejected with the stale-green diagnostic", () => {
  const result = auditFixture((s) => {
    s["gated-checks.yml"] = fixture({ types: ["opened", "reopened", "ready_for_review"], jobs: { one: { if: DRAFT_IF } } });
  });
  assertFails(result, "merge on a stale green");
});

test("T-5 draft-gating a required merge-gate workflow is rejected", () => {
  const result = auditFixture((s) => {
    s[ALWAYS_ON[0].path] = fixture({ types: null, jobs: { guard: { if: DRAFT_IF, name: ALWAYS_ON[0].context } } });
  });
  assertFails(result, "would report `skipped`");
});

test("T-6 moving a required status-check context into a gated workflow is rejected", () => {
  const result = auditFixture((s) => {
    s["gated-checks.yml"] = fixture({ jobs: { one: { if: DRAFT_IF, name: ALWAYS_ON[1].context } } });
  });
  assertFails(result, "required status-check context owned by");
});

test("T-7 a brand-new pull-request workflow carrying neither policy nor exemption fails the build (AC-4)", () => {
  const result = auditFixture((s) => {
    s["brand-new-checks.yml"] = fixture({ types: null, jobs: { one: { if: null } } });
  });
  assertFails(result, "belongs to neither the #2881 draft-gated set nor the always-on merge gate");
});

test("T-8 the evaluation model skips iff the event is pull-request family AND draft is true", () => {
  const events = ["pull_request", "pull_request_target", "push", "schedule", "workflow_dispatch"];
  const drafts = [true, false, undefined];
  let skipped = 0;
  for (const eventName of events) {
    for (const draft of drafts) {
      const { runs, prFamily } = evaluateDraftGate(eventName, draft);
      const shouldSkip = prFamily && draft === true;
      assert.equal(runs, !shouldSkip, `event=${eventName} draft=${String(draft)}`);
      if (!runs) skipped += 1;
    }
  }
  assert.equal(skipped, 2, "exactly the two pull-request-family draft cells may skip");
});

test("T-8b non-pull-request triggers are untouched — this is AC-3", () => {
  for (const eventName of ["push", "schedule", "workflow_dispatch"]) {
    for (const draft of [true, false, undefined]) {
      assert.equal(evaluateDraftGate(eventName, draft).runs, true, `${eventName} must run`);
    }
  }
});

test("T-9 the bundle-baseline creation site opening a draft is rejected", () => {
  const drafted = OK_BOT.replace('base: "main"', 'base: "main", draft: true');
  assertFails(auditFixture(() => {}, drafted), "must NEVER be drafts");
  const unreadable = auditFixture(() => {}, "export const nothing = 1;\n");
  assertFails(unreadable, "could not locate the createPull");
});

test("T-9b the real bundle-baseline creation site does not open drafts", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, BOT_PR_CREATION_SITE), "utf8");
  const call = /createPull:[\s\S]{0,600}?request\(\s*"POST"\s*,\s*"\/pulls"\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(source);
  assert.ok(call, `${BOT_PR_CREATION_SITE}: createPull POST /pulls body not found`);
  assert.ok(!/\bdraft\b/.test(call[1]), "bundle-baseline pull requests must never be created as drafts");
});

// --- T-10: the #2851 concurrency policy is untouched ---

test("T-10 the #2851 concurrency gate still passes, plain and in self-test mode", () => {
  const plain = run(CONCURRENCY_GATE);
  assert.equal(plain.status, 0, `${plain.stdout}${plain.stderr}`);
  assert.match(plain.stdout, /#2851 PR concurrency policy: PASS/);
  const selfTest = run(CONCURRENCY_GATE, [SELF_TEST_FLAG]);
  assert.equal(selfTest.status, 0, `${selfTest.stdout}${selfTest.stderr}`);
});

test("T-10b no workflow lost its top-level concurrency policy to the #2881 edit", () => {
  const sources = readWorkflowSources();
  const missing = Object.entries(sources)
    .filter(([, source]) => /^\s{2}pull_request(_target)?:\s*$/m.test(source))
    .filter(([, source]) => !/^concurrency:\s*$/m.test(source))
    .map(([name]) => name);
  assert.deepEqual(missing, [], "#2852's per-workflow concurrency policy must survive the draft-gate edit");
});

// --- shape-level unit assertions ---

test("the canonical shapes are recognised and near-misses are not", () => {
  assert.ok(isCanonicalDraftIf(DRAFT_IF));
  assert.ok(isCanonicalDraftIf(`${COMPOSED_PREFIX}always()${COMPOSED_SUFFIX}`));
  assert.ok(!isCanonicalDraftIf("${{ github.event.pull_request.draft == false }}"));
  assert.ok(!isCanonicalDraftIf("${{ always() && github.event.pull_request.draft != true }}"));
  assert.ok(!isCanonicalDraftIf(`${COMPOSED_PREFIX}${COMPOSED_SUFFIX}`));
  assert.ok(carriesDraftCondition("${{ github.event.pull_request.draft == false }}"));
  assert.ok(!carriesDraftCondition("${{ always() }}"));
  assert.ok(!carriesDraftCondition(undefined));
});

// --- registry wiring ---

test("both new gate files are registered batch:A in MANIFEST.json", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  for (const stem of ["issue-2881-pr-draft-gate-policy.mjs", "issue-2881-pr-draft-gate-policy.implementor.test.mjs"]) {
    const entry = manifest.gates.find((gate) => gate.script.endsWith(`/${stem}`));
    assert.ok(entry, `${stem} is not registered in MANIFEST.json — an unregistered gate is a gate CI never runs`);
    assert.equal(entry.enforcement, "batch:A");
  }
  const gate = manifest.gates.find((g) => g.script.endsWith("/issue-2881-pr-draft-gate-policy.mjs"));
  assert.equal(gate.selfTest, "wired");
  assert.deepEqual([...gate.modes].sort(), ["plain", "self-test"]);
});
