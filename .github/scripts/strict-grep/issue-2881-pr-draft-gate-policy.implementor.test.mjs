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

// [TEST-MOD-APPROVED #3643] These are immutable CAS receipts for the
// reviewed #3643 workflow transitions, not a latest-digest registry. Names
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
  // #3643 (2026-10-26, Taofeek + Seth): the test append-only gate is retired.
  // Its job, self-test and the ORCH-1383 MANIFEST ratchet step are deleted from
  // the always-on lane; the main-health pregate job is kept byte-for-byte, and
  // the #2909 wiring gate is the proof that it is still live. The bulk deletion
  // makes T-12's generic regex sweep flag ~138 literals that merely matched the
  // deleted prose; none pins the removed job.
  Object.freeze({
    workflow: ["tests-append-only", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "5ae5d2959382ed35994032afcbe96c86d9d799c8d7b3156931b633602ec6e633",
    afterSha256: "a69c4667462ef550c4e1b185546823bdbd1349c9d6ba7c22b9f72995cb69655f",
    proofOwner: ".github/scripts/strict-grep/issue-2909-main-health-wiring.mjs",
  }),
  // #3643 (2026-10-26, Seth-approved PR 1 of the redundant-checks cleanup): these
  // per-issue workflows drop only the jest steps (and jobs left with only setup)
  // that re-ran Host files the required "mingla-business jest (full suite)" check
  // already runs on every PR with the stock config. That required lane is the
  // proof owner. T-12's generic regex sweep flags literals that merely matched
  // the deleted steps; the gates that genuinely pin a step (#1985, #2714, #2851)
  // keep their workflows unchanged in this PR.
  Object.freeze({
    workflow: ["issue-1014-free-publish-currency-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "89affda86ea2374a88530ef6021fad00820522eec64d329da82c44e58b2f4598",
    afterSha256: "2d0cafca803e5faded316b49daa10d4c9464060468d291a5e63ebbbd29614d33",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1039-1043-theme-readback-rsvp-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "3ec0df9b4e5af9e09c66a9574cbf96a3d4c7eb187fed7c215d36d2582d45758e",
    afterSha256: "bd7378a59babefe9e8d88db65cbe323c212a64d782ad44024570467855158e5c",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1044-auth-failure-capture-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "9458e823fe84fe2da691a5107c7f7e2d15213f95b6a585d63ec7ff115f3bb603",
    afterSha256: "afa3f591465ac2eb191783e2b69429185ffa69df0bdd5d02e7b28c4a451e4850",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1459-venue-manager-photo-upload-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "bf51bf03d1a57f5ced076a7008da6c5b5a77372e095593da30b4922158e62c7d",
    afterSha256: "bfcb51958addde1907da13c83b7167fa3d1df008848c8363e70df6116f9369a6",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1463-permitted-staff-venue-submit-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "d009bfe492c2ab1b9e05428ea91d80a944250721ff19a58159cf905fcba78c76",
    afterSha256: "de3db09005424a5848ba1e142e5b4a2e3163da704a2d9c8343ea30853f5cbc31",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1469-stay-authoring-permissions", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "20ceb1a5d1973b42b03603648e2e20d0693ddaf9e765dc87d1218561c235ddb2",
    afterSha256: "d7c7c5740be8de1e77e14ddf1dc2c712ae64c32c0350b12a20fb1fb5ddc3c0ab",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1484-stay-desktop-shell-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "9817eb07ff72fb77e0fb99049a26198ac01933305cd2e22321965ad0f1bad735",
    afterSha256: "bbbdefb152966a016590af6b2b81deacea4b71412a6aea081fb0656972b49298",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1501-add-rooms-form-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "cfdb09abc85019d78140d462ef855eb4f224814eb57e1c739c2458159bba9a4b",
    afterSha256: "0be55e3cd997acc1cbb8327a3595bb676043905dec4746a9c73f056f538d9595",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1503-stay-date-pickers-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "1cf9996aeb1ddcabc83886cc9eec1701b48513743e5ac8f4fcc64f211b384374",
    afterSha256: "7af7d4cbf9d357de2a870249520bf9d3822db61e8e548ff6427096a1eaf1e826",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1532-stay-manager-ux-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "b79fe16a307a92c7017ebe3abdd1e7f64d9a349d13ff03598e842f3e05b51e99",
    afterSha256: "578bf5d3328f8c9755f1a0e9fc913c29ccae1fce43644d1fc49808e566116243",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1719-unified-sharing", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "1b64bb49a4a009a3f9c3d63298946ec473ed2a6cf355dac35867f6d786400a06",
    afterSha256: "68bc5b674f34f27eb62ed3a6967da3b86db4d95c4d35eca9c53d74f5e1a8d8a5",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1775-csv-contact-import-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "fef158667f2909ee12095a10f2b435b951d3076de471857252d69f130cec238f",
    afterSha256: "6b14c84612bf99c6b48b56928227920c5970a81c325c408323266d59e2c1e42c",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1789-spots-print-menu-depth-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "74372ad9c74cefa90833266d3c8402e21cd7dd1bc44b1db4415d6aa9e2e82be3",
    afterSha256: "11997ab74714beb86ef77c5c3ff223a7c270765f74b730f8d5ed0de489161e08",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1791-orders-queue-alerting-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "9107f97e9549a5d2719f368e1002ef0ad089c62315d10d4c1376280cb1ea03ff",
    afterSha256: "cedf79079a7fb3f297f66d662118d512c13cba34abbff3b4648ae0602e0890ca",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1792-waiter-mode-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "2e121214ba9f9b8a0fabefe9a5303039464516e8006c0c5d6a019679aa632dfa",
    afterSha256: "f99d0cdeb45520cd964c7c7f63ee1379cea808169254a43cf1e09adce0981f5a",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1793-guest-ordering-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "9b2e8d2f2c86d5c1c242a287e6ce7c776ad3221472d4a2398aa5f2a96cffa61a",
    afterSha256: "76344f49210be901c7e86e4b06141739e8728b3c20956e6777911f10e704cd10",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1929-hidden-direct-checkout-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "4c0bca5aaf18836293f2b01713348e13b01bd2458de9d3ba9d6316736b20a249",
    afterSha256: "a8ce1baa10f13cf9f1e20f1d456d6b5071102d9f7cf0056b7b6d01f2c1355be5",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-1931-private-event-access", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "1b6dffa5a9f074b91305db20f8343e6eef48b853f27647518d938d7494de766c",
    afterSha256: "1752650bfdb4969594caa76943484dffd61bc0dc01c8f004bada0dcdf993a0e5",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2009-published-event-visibility", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "bed31d354aaa7b1b38d7f4a06abd57a606c7c125e2b55cc33d318ab6780ae641",
    afterSha256: "200dc453a0e498b357417654fc9b2fe2b0d368f8a4febebbe0803c70cf960a8b",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2063-ari-brand-management", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "4474efa75f5518c2dbd61552227ffd0163c37a65a7a673e97da4036f2d9d42a1",
    afterSha256: "c915b6ea1dcb4ac2cda5e0251fc70e898571398b887906bc9866fbf48bdce482",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2075-force-update", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "957efc89df99fdc6116c8a0a830ffc29217eec8f5b9acc0da691346282099534",
    afterSha256: "792be1c7fbbcbb82d4008b3b2585d388e465a636db08e3b5f4f73e2c070af963",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2101-named-buyer-checkout-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "02eeb918be43c1151fa6dfdb0d08c01b7532229bc47f2ea3b6eb253607b38305",
    afterSha256: "0c21e9c57736be9e6b0369030f007295b616bd181016280ee51c2f34ddb74f26",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2107-mandatory-js-update", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "ddceb563842f833344dbfd407ccb35f6f2d6afb9247800eb2a4fba5d2644b5ec",
    afterSha256: "9d4906b67eae85e62f8a352e9cf5abebacea6a512d7a5a1f4b1e29305f3b7a8d",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2136-free-checkout-contract-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "1e93228d10165103d26e0da6b14db31ac56b8cc09cd957e4f9f575965a89698c",
    afterSha256: "e37c4c107aa7ad70b70be3e9c1f44dc7bc7a751cae84346e753a85abe31ea77c",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2150-free-resubmit-idempotent-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "b9497285c41830003a06e375bbc1a1ba81c9bd7ccd2c9f5184dee0bdaa064df9",
    afterSha256: "a2fd5310ee7a5d6afa84fc34771c671a43355ab65bc60bcff1a8147e00bc7b0a",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2160-multiday-multiselect-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "11c4e053a76c8146a8d3b8c1851dca9d5aa9f6c4355437180610a109d2058050",
    afterSha256: "35c8dcfbb699af52cc6883e3cbf57e4faa0bc937cec08eaf180083985fb3be8d",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2198-paystack-return-verify-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "216a69d8ba7ddf22f33ae95fcb021f03338da9714f6a0f15734ccc70b0b06f8e",
    afterSha256: "957af53824af18994dd9043dec1f16e9103a3f1c57a8c01ada1474ac09e46d5b",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2217-confirmation-app-cta-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "79a54dfa7b7ab6849466fb5cd30dd9fb903401fb21e64135bbf60d729e63cb12",
    afterSha256: "95f90626e8e44286d2d5ae8429aee6a8ec1028e36ccc5116c13bb9734ed4100b",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2262-composer-responsive-layout", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "2a78462d7a8b56bc6d5f734b9e80aadec2af592655ec470a2bece67e77033a70",
    afterSha256: "77496e8cd7a276b5a2eabe7d0947ca4ea1e452a881f5ac34124cac1a1d8ec136",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2267-marketing-tenancy", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "79edcee04093c95da4a1cf00d989232dde5e65d8062d27c9c5e603c80ce7882e",
    afterSha256: "f637c7986868a0413b5d81517a3c06dc75a889b4d11062256423d6c8d36ebc99",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2306-lazy-native-imports", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "6226e7c857bfaf5c9d638a2e703c26c49723a22c501d587fc465779a03c7be31",
    afterSha256: "f933157f13a6c4028cb67db2880b5a80ee46f619c16a180304c024c0de3e95cd",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2323-free-order-claim-and-cta-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "8fc46243564d9f7c88257308ef594b25999d012a864dc0162f381170f341843c",
    afterSha256: "13c1d4250c9de9ffd8824fb6a090ee093ea1234f3e0e8cbaa63a84269b0810cf",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2337-free-409-honest-copy-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "3b4d20c12594e0f1af613f08cf92921646c561e7fa1031328a1719cd43885d9e",
    afterSha256: "a8b99a065cc1e13f576f8f60f1c6d71993b126238dd6b2f4c1334967a0132295",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2395-manual-contact-groups-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "efbe52c3ebb5a81cd267dc5eb24d95218a99759ce4c4cdecfa090358c5e63de9",
    afterSha256: "0a9755577d84c3324ba01b67f516f0c12e60d71c49f402bfc2b6f19dffb9e861",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-2418-bank-list-native-identity", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "08793649ecd1046bc2e48e94dd40f7ec5ad20163a4788320108460b4698b40a1",
    afterSha256: "704c5013d6cd1b3f427c32b1ebf2211b6c0ad64c769bb83d179eeb8072f04445",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-855-pr2-source-tracking-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "40b4bbccfd3c732c81fc9ca9db575bb31afd104ff51c4040a7c1cbfed4a0c7d8",
    afterSha256: "ffe8ca4485e8ab048d5a346e4a819a29ddc0ebb8799d7c568782e2e9b8ccd5ff",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-871-attendance-entitlement-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "a44118abfa87d7388d37acd3cc4c7a60282e8975eb8ae38f319fbfc86939e600",
    afterSha256: "f872b220df4b5ed38869d782e82aba88f90a06758f9efae9b4c628af18c8cbe1",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["issue-922-business-web-actionable", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "d86a09de4df2d6067247066e82f1573ea1cd3c9a8a8fce4b0c290c7b371c1f1e",
    afterSha256: "a2b57e94ca5614d50c6a149fd2304a2e74b1bb6239fe303419877688784d2b9a",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
  }),
  Object.freeze({
    workflow: ["meta-orch-1337-social-proof-tests", "yml"].join("."),
    issue: "#3643",
    beforeSha256: "6de10da3db7d1d76ad03cf6122a39e9b49ce464b8e985fb8af0aaefc673e4b86",
    afterSha256: "b30aa8d0903397f3857674cdf2b622d6be8d77654e1b2259a119e32108af8d7a",
    proofOwner: [".github/workflows/mingla-business-jest-suite", "yml"].join("."),
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
assert.equal(PHASE3_TRANSITION_RECEIPT_INDEX.size, 42, "Phase 3 transition receipt cardinality");

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
