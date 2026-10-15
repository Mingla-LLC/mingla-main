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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { auditWorkflowSources as auditConcurrency } from "./issue-2851-pr-concurrency-policy.mjs";
import { loadEffectiveManifest } from "../ci-batch/load-manifest.mjs";

import {
  ALWAYS_ON,
  CI_BATCH_MANIFEST,
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
  stringLiterals,
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

// T-10 asserts the thing #2881 is actually responsible for: that this change moved
// the #2851 concurrency verdict NOT AT ALL. It deliberately does NOT assert "the
// #2851 gate is green", because that also depends on the health of `main`, which is
// not this branch's to guarantee -- and at the time of writing `main` was red there
// over a workflow shipping a non-canonical concurrency group. NOTE: no live workflow
// FILENAME may appear anywhere in this file. validate-manifest-v2's
// discoverWorkflowProviders() scans every tracked source for workflow-name references
// and attributes the file as an external reference for that workflow; one such name in
// a COMMENT drifted the #2899 provider inventory and reddened six class-A gates.
// Same rule as #2851's liveWorkflow() helper and #2524's assembled filename.
// Comparing our verdict to the merge-base's verdict is the STRICTER statement: if
// #2881 introduced even one concurrency regression the two error sets diverge and
// this fails, whether or not main was green to begin with.
test("T-10 #2881 moves the #2851 concurrency verdict not at all, versus the merge base", (t) => {
  if (!historyAvailable()) {
    // Intrinsic fallback, NOT a skip: prove the concurrency policy holds on this
    // tree outright. That is stronger than "unchanged from base" -- it cannot pass
    // by both sides being equally broken.
    assert.deepEqual(auditConcurrency(readWorkflowSources()).errors, [],
      "#2851 concurrency policy must hold on this tree (history-free check; full clone adds the base comparison)");
    return;
  }
  const base = spawnSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(base.status, 0, base.stderr);
  const baseSha = base.stdout.trim();

  const names = spawnSync("git", ["ls-tree", "--name-only", `${baseSha}:.github/workflows`], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(names.status, 0, names.stderr);
  const baseSources = Object.fromEntries(names.stdout.split("\n")
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .map((name) => {
      const blob = spawnSync("git", ["show", `${baseSha}:.github/workflows/${name}`], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      assert.equal(blob.status, 0, blob.stderr);
      return [name, blob.stdout];
    }));

  const atBase = auditConcurrency(baseSources).errors.slice().sort();
  const atHead = auditConcurrency(readWorkflowSources()).errors.slice().sort();
  assert.deepEqual(
    atHead,
    atBase,
    `#2881 changed the #2851 concurrency verdict.\n  base(${baseSha.slice(0, 9)}): ${JSON.stringify(atBase, null, 2)}\n  head: ${JSON.stringify(atHead, null, 2)}`,
  );
  if (atHead.length) {
    console.log(`  note: ${atHead.length} PRE-EXISTING #2851 error(s) inherited from ${baseSha.slice(0, 9)}, unchanged by #2881:`);
    for (const error of atHead) console.log(`    - ${error}`);
  }
});

test("T-10a the #2851 gate source is byte-identical to the merge base and its self-test still passes", () => {
  if (historyAvailable()) {
    const base = spawnSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: REPO_ROOT, encoding: "utf8" });
    const diff = spawnSync("git", ["diff", "--name-only", base.stdout.trim(), "--", ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs"], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(diff.stdout.trim(), "", "#2881 must not edit the #2851 gate to make it agree");
  }
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

// --- the PIN CLASS (#1614 / #1719 / #2393 / #679 / ci-batch) -------------------
// Three lanes rediscovered this defect by going red in CI on one day. These tests
// move the fourth discovery to build time.

const gitOut = (args) => {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
/**
 * CI checks this repository out with `actions/checkout@v4` and NO `fetch-depth`,
 * which is a depth-1 SHALLOW clone: `origin/main` is absent or grafted and
 * `git merge-base` cannot resolve a true base. Locally the clone is complete, so
 * a base-dependent assertion passes here and fails there for reasons that have
 * nothing to do with the change under test -- that is exactly the local/CI
 * divergence this suite produced. Base-dependent checks therefore RESOLVE the
 * base honestly and say so when they cannot; they never invent one, and they
 * never silently pass. The intrinsic checks below (A8/A9 via the gate) need no
 * history at all and run everywhere.
 */
const historyAvailable = () => {
  const shallow = spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (shallow.status !== 0 || shallow.stdout.trim() === "true") return false;
  return spawnSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: REPO_ROOT, encoding: "utf8" }).status === 0;
};
const mergeBase = () => gitOut(["merge-base", "HEAD", "origin/main"]).trim();

const PHASE3_TRANSITION_RECEIPT_KEYS = Object.freeze([
  "afterSha256", "beforeSha256", "issue", "proofOwner", "workflow",
]);

// [TEST-MOD-APPROVED #3643] These are immutable CAS receipts for the two
// reviewed Phase 3 workflow transitions, not a latest-digest registry. Names
// stay assembled so this non-workflow file does not become a provider reference.
const PHASE3_TRANSITION_RECEIPTS = Object.freeze([
  Object.freeze({
    workflow: ["deploy-functions", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "662c833b4fd222a4d708d64a5ac0f7ff9f8b6b972522a671645d182619973c18",
    afterSha256: "56f268fc2d6853d4489e3b7128f3aa3cea130a07e193aa2cec8d5f917e441444",
    proofOwner: ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.implementor.test.mjs",
  }),
  Object.freeze({
    workflow: ["supabase-migrations-and-stripe-deno", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "27c8df5a8fec7536f07e3dad819b3ecdd21bb1b9ea5261109394093dea0a6c8c",
    afterSha256: "9222960b40d6f2b4fed23a0e5f0dc92584f9bb668a380c6cad2015fa4bfec830",
    proofOwner: ".github/scripts/ci-discovery/__tests__/issue-3643-self-registering-ci.implementor.test.mjs",
  }),
]);

const validateTransitionReceipts = (receipts) => {
  assert.ok(Array.isArray(receipts), "transition receipts must be an array");
  const workflows = new Set();
  const pairs = new Set();
  const index = new Map();
  for (const [position, receipt] of receipts.entries()) {
    assert.ok(receipt && typeof receipt === "object" && !Array.isArray(receipt),
      `transition receipt ${position} must be an object`);
    assert.deepEqual(Object.keys(receipt).sort(), PHASE3_TRANSITION_RECEIPT_KEYS,
      `transition receipt ${position} has an unsupported schema`);
    assert.equal(receipt.issue, "#3643", `transition receipt ${position} has the wrong issue`);
    assert.match(receipt.workflow, /^[a-z0-9][a-z0-9-]*\.ya?ml$/,
      `transition receipt ${position} has an invalid assembled workflow`);
    assert.match(receipt.beforeSha256, /^[0-9a-f]{64}$/,
      `transition receipt ${position} has an invalid base digest`);
    assert.match(receipt.afterSha256, /^[0-9a-f]{64}$/,
      `transition receipt ${position} has an invalid head digest`);
    assert.notEqual(receipt.beforeSha256, receipt.afterSha256,
      `transition receipt ${position} is a no-op`);
    const proofPath = join(REPO_ROOT, receipt.proofOwner);
    assert.equal(fs.existsSync(proofPath) && fs.statSync(proofPath).isFile(), true,
      `transition receipt ${position} proof owner does not exist: ${receipt.proofOwner}`);
    assert.equal(workflows.has(receipt.workflow), false,
      `duplicate transition workflow: ${receipt.workflow}`);
    const pair = `${receipt.beforeSha256}:${receipt.afterSha256}`;
    assert.equal(pairs.has(pair), false, `duplicate transition digest pair: ${pair}`);
    workflows.add(receipt.workflow);
    pairs.add(pair);
    index.set(receipt.workflow, receipt);
  }
  return index;
};

const authorizedTransitionNames = (transitions, receipts = PHASE3_TRANSITION_RECEIPTS) => {
  const index = validateTransitionReceipts(receipts);
  const accepted = new Set();
  for (const transition of transitions) {
    const receipt = index.get(transition.workflow);
    if (receipt
      && receipt.beforeSha256 === transition.beforeSha256
      && receipt.afterSha256 === transition.afterSha256) {
      accepted.add(transition.workflow);
    }
  }
  return accepted;
};

const PHASE3_TRANSITION_RECEIPT_INDEX = validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS);
assert.equal(PHASE3_TRANSITION_RECEIPT_INDEX.size, 2, "Phase 3 transition receipt cardinality");

test("T-11 every pin-protected workflow still satisfies the pin that protects it", () => {
  const pinned = ALWAYS_ON.filter((entry) => entry.kind === "pin-protected");
  assert.ok(pinned.length > 0, "the pin-protected registry must not be empty — several lanes proved this class exists");
  // Intrinsic and history-free: A8 proves each registration names a REAL pin that
  // the current file still satisfies (digest matches, regex matches, block embedded).
  // That is what "byte-identical" was a proxy for, and unlike the proxy it cannot be
  // defeated by the base ref moving underneath the test.
  assert.deepEqual(auditWorkflowSources(readWorkflowSources()).errors, [],
    "a pin-protected workflow no longer satisfies its pin");
  if (historyAvailable()) {
    const paths = pinned.map((entry) => `.github/workflows/${entry.path}`);
    const changed = gitOut(["diff", "--name-only", mergeBase(), "--", ...paths]).trim();
    assert.equal(changed, "", `#2881 modified a pin-protected workflow: ${changed}`);
  }
});

test("T-12 no workflow OUTSIDE the pin registry has a pin this change breaks — occurrence #4 fails here, not in CI", () => {
  if (!historyAvailable()) {
    // The delta sweep needs real history. Rather than invent a base or pass
    // vacuously, assert the history-free half (A8 registrations current, A9 seals
    // current) and let the full sweep run wherever the clone is complete.
    assert.deepEqual(auditWorkflowSources(readWorkflowSources()).errors, [],
      "history-free pin checks must hold even where the delta sweep cannot run");
    return;
  }
  const base = mergeBase();
  const dir = ".github/workflows";
  const headSources = readWorkflowSources();
  const baseNames = gitOut(["ls-tree", "--name-only", `${base}:${dir}`]).split("\n").filter((n) => /\.ya?ml$/i.test(n));
  const baseSources = Object.fromEntries(baseNames.map((n) => [n, gitOut(["show", `${base}:${dir}/${n}`])]));
  const registered = new Set(ALWAYS_ON.map((entry) => entry.path));

  // Only workflows this change actually touched can carry a pin it breaks.
  const changedCandidates = Object.keys(headSources)
    .filter((name) => !registered.has(name))
    .filter((name) => baseSources[name] !== undefined && baseSources[name] !== headSources[name]);

  // [TEST-MOD-APPROVED #3643] T-12 still sweeps every ordinary workflow. It
  // excludes only an exact reviewed name+base+head CAS transition; name-only,
  // head-only, issue-only, substring, and later-current-byte matches do nothing.
  const transitions = changedCandidates.map((workflow) => ({
    workflow,
    beforeSha256: createHash("sha256").update(baseSources[workflow]).digest("hex"),
    afterSha256: createHash("sha256").update(headSources[workflow]).digest("hex"),
  }));
  const authorized = authorizedTransitionNames(transitions);
  const changed = changedCandidates.filter((name) => !authorized.has(name));

  // Indexes, built once. NO "this source names the workflow" filter: #2524 and #2589
  // both ASSEMBLE the filename (`["bundle-baseline-automerge", "yml"].join(".")`)
  // precisely so a scanner cannot see it, so name-based narrowing is structurally
  // blind — that is how the #2524 security pin reached CI instead of failing here.
  const digestIndex = new Map();
  const jobIfIndex = new Map();
  for (const name of changed) {
    const before = baseSources[name];
    for (const variant of [before, before.trimEnd(), before.trim(), before.replace(/\r\n/g, "\n")]) {
      digestIndex.set(createHash("sha256").update(variant).digest("hex"), name);
    }
    for (const match of before.matchAll(/^ {4}if: (.+)$/gm)) {
      const raw = match[1].trim();
      const inner = (/^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(raw)?.[1] ?? raw).trim();
      // NO length floor. `always()` is eight characters and is load-bearing: #2594 pins it
      // verbatim because without it a timeout kill of class A skips the only check that can
      // see it. A 12-character floor here silently excluded that pin and let it reach CI.
      if (inner.length > 0 && !headSources[name].includes(inner)) jobIfIndex.set(inner, name);
    }
  }

  const REGEX_LITERAL = /\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([gimsuy]*)/g;
  const HEX64 = /\b[0-9a-f]{64}\b/g;
  const trackedSources = gitOut(["ls-files"]).split("\n").filter(Boolean)
    .filter((f) => /\.(mjs|cjs|js|ts|tsx)$/.test(f) && !f.startsWith(`${dir}/`) && !f.includes("issue-2881-pr-draft-gate-policy"));

  const broken = [];
  const regexLiterals = new Map();
  for (const file of trackedSources) {
    let src;
    try { src = readFileSync(join(REPO_ROOT, file), "utf8"); } catch { continue; }
    for (const match of src.matchAll(HEX64)) {
      const name = digestIndex.get(match[0]);
      if (name) broken.push(`${name}: ${file} banks a sha256 of the pre-#2881 file`);
    }
    // LITERAL-BLOCK pins: a test that embeds an exact multi-line block of a workflow
    // in order to delete it and prove its own assertion is still red on reversion.
    // Inserting a line inside that block removes the mutation target and the probe
    // silently stops proving anything — that is how #2851's Sites-recovery probe
    // broke. Template interpolations are matched on their static fragments.
    // Bounded: an embedded block OF A WORKFLOW necessarily contains workflow YAML
    // tokens, so require one before doing any per-workflow work. Without this the
    // sweep is O(every string literal in the repo x every changed workflow).
    const WORKFLOW_TOKEN = /(pull_request|workflow_dispatch|runs-on|jobs:|steps:|uses:|paths:|schedule:|branches:)/;
    // Whole-file gate first: extracting every string literal is the expensive step, so
    // only pay it for sources that could possibly embed a workflow block at all.
    const literalCandidates = src.length <= 512_000 && WORKFLOW_TOKEN.test(src) ? stringLiterals(src) : [];
    for (const literal of literalCandidates) {
      if (!literal.includes("\n") || !WORKFLOW_TOKEN.test(literal)) continue;
      const fragments = literal.split(/\$\{[^}]*\}/).map((part) => part.trim()).filter((part) => part.length >= 8);
      if (!fragments.length) continue;
      for (const name of changed) {
        const inBase = fragments.every((fragment) => baseSources[name].includes(fragment));
        const inHead = fragments.every((fragment) => headSources[name].includes(fragment));
        if (inBase && !inHead) broken.push(`${name}: ${file} embeds a multi-line block that #2881 split apart`);
      }
    }
    for (const [literal, name] of jobIfIndex) {
      if (src.includes(`"${literal}"`) || src.includes(`'${literal}'`) || src.includes(`\`${literal}\``)) {
        broken.push(`${name}: ${file} pins a job if: value verbatim`);
      }
    }
    // Regex literals only from non-comment lines: this repo's audit-regex-matches-comments
    // trap produced a false positive here (a prose "Mingla_Artifacts/ + .github/scripts/").
    // Collected here and evaluated ONCE below, deduplicated across the whole repo --
    // the same literal appears in many files, and re-testing it against all 117 changed
    // workflows per occurrence is what made this gate too slow for a bounded CI lane.
    for (const line of src.split("\n")) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      for (const match of line.matchAll(REGEX_LITERAL)) {
        if (match[1].length < 10) continue;
        const key = `${match[1]}\u0000${match[2]}`;
        if (!regexLiterals.has(key)) regexLiterals.set(key, { source: match[1], flags: match[2], files: [] });
        const entry = regexLiterals.get(key);
        if (!entry.files.includes(file)) entry.files.push(file);
      }
    }
  }

  for (const { source, flags, files } of regexLiterals.values()) {
    let pattern;
    try { pattern = new RegExp(source, flags.replace(/[gy]/g, "")); } catch { continue; }
    for (const name of changed) {
      let atBase, atHead;
      try { atBase = pattern.test(baseSources[name]); atHead = pattern.test(headSources[name]); } catch { break; }
      if (atBase && !atHead) {
        for (const file of files) broken.push(`${name}: ${file} asserts /${source.slice(0, 70)}/ which matched before #2881 and does not now`);
      }
    }
  }
  assert.deepEqual([...new Set(broken)], [],
    "a workflow outside the pin registry carries an assertion #2881 breaks. Restore it byte-identical and register it in ALWAYS_ON as pin-protected.");
});

test("T-12b Phase 3 transition receipts authorize only both exact CAS pairs once", () => {
  assert.equal(Object.isFrozen(PHASE3_TRANSITION_RECEIPTS), true);
  assert.ok(PHASE3_TRANSITION_RECEIPTS.every(Object.isFrozen));
  const exact = PHASE3_TRANSITION_RECEIPTS.map(({ workflow, beforeSha256, afterSha256 }) => ({
    workflow, beforeSha256, afterSha256,
  }));
  assert.deepEqual([...authorizedTransitionNames(exact)].sort(), exact.map(({ workflow }) => workflow).sort());
  for (const transition of exact) {
    assert.deepEqual([...authorizedTransitionNames([transition])], [transition.workflow],
      `${transition.workflow}: exact pair must authorize once`);
  }

  const flipNibble = (digest) => `${digest[0] === "0" ? "1" : "0"}${digest.slice(1)}`;
  for (const [index, receipt] of PHASE3_TRANSITION_RECEIPTS.entries()) {
    for (const field of ["beforeSha256", "afterSha256"]) {
      const mutated = PHASE3_TRANSITION_RECEIPTS.map((row, position) => position === index
        ? Object.freeze({ ...row, [field]: flipNibble(row[field]) })
        : row);
      const accepted = authorizedTransitionNames(exact, mutated);
      assert.equal(accepted.has(receipt.workflow), false,
        `${receipt.workflow}: one-nibble ${field} receipt drift must not authorize`);
      assert.equal(accepted.size, PHASE3_TRANSITION_RECEIPTS.length - 1);
    }
  }

  const first = exact[0];
  const wrongName = { ...first, workflow: ["unreviewed-transition", "yml"].join(".") };
  const wrongBase = { ...first, beforeSha256: flipNibble(first.beforeSha256) };
  const wrongHead = { ...first, afterSha256: flipNibble(first.afterSha256) };
  assert.equal(authorizedTransitionNames([wrongName]).size, 0, "name-only exemption is forbidden");
  assert.equal(authorizedTransitionNames([wrongBase]).size, 0, "head-only exemption is forbidden");
  assert.equal(authorizedTransitionNames([wrongHead]).size, 0, "base-only exemption is forbidden");
  assert.equal(authorizedTransitionNames([{
    workflow: ["third-transition", "yml"].join("."),
    beforeSha256: "1".repeat(64),
    afterSha256: "2".repeat(64),
  }]).size, 0, "a third changed workflow needs its own reviewed receipt");

  assert.throws(() => validateTransitionReceipts([
    ...PHASE3_TRANSITION_RECEIPTS,
    PHASE3_TRANSITION_RECEIPTS[0],
  ]), /duplicate transition workflow/);
  assert.throws(() => validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS.map((row, index) => index === 0
    ? { ...row, workflow: ["duplicate-pair", "yml"].join(".") }
    : row).concat(PHASE3_TRANSITION_RECEIPTS[0])), /duplicate transition digest pair/);
  assert.throws(() => validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS.map((row, index) => index === 0
    ? { ...row, beforeSha256: row.afterSha256 }
    : row)), /no-op/);
  assert.throws(() => validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS.map((row, index) => index === 0
    ? { ...row, proofOwner: ".github/scripts/strict-grep/missing-transition-proof.mjs" }
    : row)), /proof owner does not exist/);
  assert.throws(() => validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS.map((row, index) => index === 0
    ? { ...row, issue: "#0000" }
    : row)), /wrong issue/);
  assert.throws(() => validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS.map((row, index) => index === 0
    ? { ...row, extra: true }
    : row)), /unsupported schema/);
  assert.throws(() => validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS.map((row, index) => index === 0
    ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== "proofOwner"))
    : row)), /unsupported schema/);
  assert.throws(() => validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS.map((row, index) => index === 0
    ? { ...row, workflow: ["unassembled", "json"].join(".") }
    : row)), /invalid assembled workflow/);
  assert.throws(() => validateTransitionReceipts(PHASE3_TRANSITION_RECEIPTS.map((row, index) => index === 0
    ? { ...row, beforeSha256: row.beforeSha256.toUpperCase() }
    : row)), /invalid base digest/);
});

test("T-13 the ci-batch origin registry hashes the workflows on disk (A9 — the 108-workflow seal)", () => {
  const manifest = loadEffectiveManifest();
  const sources = readWorkflowSources();
  const stale = [];
  let checked = 0;
  for (const origin of manifest.legacyOrigins ?? []) {
    const name = `${origin.stem}.${origin.extension}`;
    const source = sources[name];
    if (typeof source !== "string") continue;
    checked += 1;
    if (createHash("sha256").update(source).digest("hex") !== origin.workflowMetadata?.sourceSha256) stale.push(name);
  }
  assert.ok(checked > 50, `expected the origin registry to cover most workflows, only saw ${checked}`);
  assert.deepEqual(stale, [], "re-bank sourceSha256 in the same commit that edits the workflow");
});
