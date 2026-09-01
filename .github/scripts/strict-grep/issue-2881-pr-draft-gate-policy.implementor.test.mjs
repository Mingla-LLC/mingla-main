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
// not this branch's to guarantee -- and at the time of writing `main` is red there:
// sites-backup-restore.yml (added by #2895) ships a non-canonical concurrency group.
// Comparing our verdict to the merge-base's verdict is the STRICTER statement: if
// #2881 introduced even one concurrency regression the two error sets diverge and
// this fails, whether or not main was green to begin with.
test("T-10 #2881 moves the #2851 concurrency verdict not at all, versus the merge base", () => {
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
  const base = spawnSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: REPO_ROOT, encoding: "utf8" });
  const diff = spawnSync("git", ["diff", "--name-only", base.stdout.trim(), "--", ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(diff.stdout.trim(), "", "#2881 must not edit the #2851 gate to make it agree");
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
const mergeBase = () => gitOut(["merge-base", "HEAD", "origin/main"]).trim();

test("T-11 every pin-protected workflow is byte-identical to the merge base", () => {
  const base = mergeBase();
  const pinned = ALWAYS_ON.filter((entry) => entry.kind === "pin-protected");
  assert.ok(pinned.length > 0, "the pin-protected registry must not be empty — three lanes proved this class exists");
  const paths = pinned.map((entry) => `.github/workflows/${entry.path}`);
  const changed = gitOut(["diff", "--name-only", base, "--", ...paths]).trim();
  assert.equal(changed, "", `#2881 modified a pin-protected workflow: ${changed}`);
});

test("T-12 no workflow OUTSIDE the pin registry has a pin this change breaks — occurrence #4 fails here, not in CI", () => {
  const base = mergeBase();
  const dir = ".github/workflows";
  const headSources = readWorkflowSources();
  const baseNames = gitOut(["ls-tree", "--name-only", `${base}:${dir}`]).split("\n").filter((n) => /\.ya?ml$/i.test(n));
  const baseSources = Object.fromEntries(baseNames.map((n) => [n, gitOut(["show", `${base}:${dir}/${n}`])]));
  const registered = new Set(ALWAYS_ON.map((entry) => entry.path));

  const trackedSources = gitOut(["ls-files"]).split("\n").filter(Boolean)
    .filter((f) => /\.(mjs|cjs|js|ts|tsx)$/.test(f) && !f.startsWith(`${dir}/`) && !f.includes("issue-2881-pr-draft-gate-policy"));

  const digestsOf = (source) => new Set([source, source.trimEnd(), source.trim(), source.replace(/\r\n/g, "\n")]
    .map((variant) => createHash("sha256").update(variant).digest("hex")));
  const REGEX_LITERAL = /\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([gimsuy]*)/g;

  const broken = [];
  for (const file of trackedSources) {
    let src;
    try { src = readFileSync(join(REPO_ROOT, file), "utf8"); } catch { continue; }
    for (const [name, headSource] of Object.entries(headSources)) {
      if (registered.has(name)) continue;                 // declared, and T-11 proves it is untouched
      const baseSource = baseSources[name];
      if (baseSource === undefined || baseSource === headSource) continue;  // unchanged: cannot be broken by us
      if (!src.includes(name)) continue;                  // catches template-literal paths too
      for (const digest of digestsOf(baseSource)) {
        if (src.includes(digest)) { broken.push(`${name}: ${file} banks a sha256 of the pre-#2881 file`); break; }
      }
      for (const match of src.matchAll(REGEX_LITERAL)) {
        if (match[1].length < 8) continue;
        let pattern;
        try { pattern = new RegExp(match[1], match[2].replace(/[gy]/g, "")); } catch { continue; }
        let atBase, atHead;
        try { atBase = pattern.test(baseSource); atHead = pattern.test(headSource); } catch { continue; }
        if (atBase && !atHead) broken.push(`${name}: ${file} asserts /${match[1].slice(0, 70)}/ which matched before #2881 and does not now`);
      }
      const baseJobs = [...baseSource.matchAll(/^ {4}if: (.+)$/gm)].map((m) => m[1].trim());
      for (const raw of baseJobs) {
        const inner = (/^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(raw)?.[1] ?? raw).trim();
        if (inner.length < 12 || headSource.includes(inner) ) continue;
        if (src.includes(`"${inner}"`) || src.includes(`'${inner}'`)) broken.push(`${name}: ${file} pins job if: ${JSON.stringify(inner)} verbatim`);
      }
    }
  }
  assert.deepEqual([...new Set(broken)], [],
    "a workflow outside the pin registry carries an assertion #2881 breaks. Restore it byte-identical and register it in ALWAYS_ON as pin-protected.");
});

test("T-13 the ci-batch origin registry hashes the workflows on disk (A9 — the 108-workflow seal)", () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, CI_BATCH_MANIFEST), "utf8"));
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
