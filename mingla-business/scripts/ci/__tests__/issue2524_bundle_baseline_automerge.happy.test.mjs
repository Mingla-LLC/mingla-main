/**
 * Issue #2524 implementor regression suite — the five auto-merge guards.
 *
 * The mechanism under test is allowed to merge a pull request into main, so the
 * only interesting cases are the REFUSALS. Every guard is driven through a
 * secret-free fake REST adapter that records whether a merge was attempted, and
 * the assertion in each negative case is the same one that matters in
 * production: `merges.length === 0`.
 *
 * The two cases most likely to be got wrong are asserted explicitly and
 * separately, because both look like success to a careless reading:
 *   - PENDING IS NOT GREEN (a check that has not completed), and
 *   - AN EMPTY LISTING IS NOT GREEN (rate-limited, raced or dropped response).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_PATH, BRANCH_PREFIX } from "../bundle-baseline-pr-handoff.mjs";
import {
  AutomergeError,
  CEILING,
  CHECK_FANOUT_CEILING,
  REFUSAL_RUNWAY,
  STALE_REFUSAL_MINUTES,
  assertCeilingMirrorMatchesBudgetSource,
  assessCeilingRunway,
  assessCheckFanout,
  assessChecks,
  assessRefusalPersistence,
  describeMovement,
  makeAutomergeApi,
  renderSummary,
  runAutomerge,
} from "../bundle-baseline-automerge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../");
const SOURCE = "a".repeat(40);
const MOVED = "b".repeat(40);
const GENERATED = "d".repeat(40);
const SLUG = "mingla-bundle-baseline";
const ACTOR = `${SLUG}[bot]`;
const BRANCH = `${BRANCH_PREFIX}${SOURCE}`;

// #2148's CI registry scans every tracked non-workflow file for literal
// `*.yml` names and requires each one it finds to be a REGISTERED external
// workflow provider with an exact reference-file inventory. A literal here
// would therefore red the registry gate — as a 92nd provider it cannot count,
// and as a new reference on the ratchet it is inventory drift. The names are
// assembled instead, exactly as validate-manifest-v2.mjs assembles
// `STALE_CONFIG_ROOT` to avoid matching itself. Do NOT "simplify" these back
// into string literals.
const WORKFLOW_DIR = ".github/workflows";
const AUTOMERGE_WORKFLOW = `${WORKFLOW_DIR}/${["bundle-baseline-automerge", "yml"].join(".")}`;
const RATCHET_WORKFLOW = `${WORKFLOW_DIR}/${["bundle-baseline-ratchet", "yml"].join(".")}`;

const RECORDED = { common: { raw: 2_380_273, gzip: 606_000, brotli: 452_000 }, eager: { raw: 3_388_663, gzip: 884_000, brotli: 673_000 } };
const PROPOSED = { common: { raw: 2_382_860, gzip: 607_753, brotli: 452_820 }, eager: { raw: 3_391_250, gzip: 884_657, brotli: 673_763 } };

function baselineText(measurement, commit = SOURCE) {
  return `${JSON.stringify({ measuredOn: { commit }, ...measurement }, null, 2)}\n`;
}

function greenChecks() {
  return {
    total_count: 2,
    check_runs: [
      { name: "CI batch: node20-noinstall", status: "completed", conclusion: "success" },
      { name: "Bundle baseline provenance guard", status: "completed", conclusion: "success" },
    ],
  };
}

function greenStatus() {
  return { state: "success", total_count: 1, statuses: [{ context: "vercel", state: "success" }] };
}

class FakeApi {
  constructor(overrides = {}) {
    this.owner = "Mingla-LLC";
    this.repo = "mingla-main";
    this.fullName = "Mingla-LLC/mingla-main";
    this.mainSha = SOURCE;
    this.mainReads = [];
    this.merges = [];
    this.refs = new Map([[BRANCH, { ref: `refs/heads/${BRANCH}`, object: { sha: GENERATED } }]]);
    this.commits = new Map([[GENERATED, {
      sha: GENERATED,
      parents: [{ sha: SOURCE }],
      author: { login: ACTOR },
      committer: { login: ACTOR },
      commit: { message: `Record business-web boot payload growth\n\nMeasured from ${SOURCE} by ${RATCHET_WORKFLOW}.\nBaseline only — no limit was changed.` },
    }]]);
    this.contents = new Map([
      [SOURCE, baselineText(RECORDED)],
      [GENERATED, baselineText(overrides.proposed ?? PROPOSED)],
    ]);
    this.checkRuns = new Map([[GENERATED, overrides.checkRuns ?? greenChecks()]]);
    this.statuses = new Map([[GENERATED, overrides.statuses ?? greenStatus()]]);
    this.pulls = [{
      number: 2530,
      state: "open",
      title: "Record business-web boot payload growth (common +2,587 B, eager +2,587 B)",
      html_url: "https://example.test/pull/2530",
      user: { login: overrides.actor ?? ACTOR },
      head: { ref: overrides.headRef ?? BRANCH, sha: GENERATED, repo: { full_name: this.fullName } },
      base: { ref: "main", sha: SOURCE, repo: { full_name: this.fullName } },
      files: overrides.files ?? [{ filename: BASELINE_PATH }],
      changed_files: overrides.changedFiles ?? 1,
      mergeable: overrides.mergeable === undefined ? true : overrides.mergeable,
      mergeable_state: overrides.mergeableState ?? "clean",
      // #2885: the age of the candidate is what tells a refusal from a jam.
      created_at: overrides.createdAt ?? new Date().toISOString(),
      draft: overrides.draft ?? false,
    }];
    // #2885: GitHub's own answer to "may this actor merge this", which is the
    // only authority on the question. `null` = it merges.
    this.mergeRejection = overrides.mergeRejection ?? null;
  }

  async getMainSha() { return this.mainReads.length ? this.mainReads.shift() : this.mainSha; }
  async getRef(branch) { return this.refs.get(branch) ?? null; }
  async getCommit(sha) { return this.commits.get(sha); }
  async listPulls(state = "open") { return this.pulls.filter((pull) => state === "all" || pull.state === state); }
  async getPull(number) { return this.pulls.find((pull) => pull.number === number); }
  async getPullFiles(number) { return (await this.getPull(number)).files; }
  async listCheckRuns(sha) { return this.checkRuns.get(sha) ?? { total_count: 0, check_runs: [] }; }
  async getCombinedStatus(sha) { return this.statuses.get(sha) ?? { state: "pending", total_count: 0, statuses: [] }; }

  async getContent(_path, ref) {
    if (!this.contents.has(ref)) {
      const error = new Error("not found");
      error.details = { status: 404 };
      throw error;
    }
    const body = this.contents.get(ref);
    return {
      encoding: "base64",
      content: Buffer.from(body).toString("base64"),
      sha: createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex"),
    };
  }

  async compare(base, head) {
    const commit = this.commits.get(head);
    if (commit && commit.parents[0].sha === base) {
      return { status: "ahead", ahead_by: 1, behind_by: 0, merge_base_commit: { sha: base }, files: [{ filename: BASELINE_PATH }] };
    }
    return { status: "diverged", ahead_by: 1, behind_by: 1, merge_base_commit: { sha: "f".repeat(40) }, files: [] };
  }

  async mergePull(input) {
    this.merges.push(input);
    if (this.mergeRejection) return { merged: false, ...this.mergeRejection };
    return { merged: true, sha: "e".repeat(40) };
  }
}

const run = (api) => runAutomerge(api, { expectedAppSlug: SLUG });

describe("#2524 guard 1 — author-locked", () => {
  test("the App's own recording PR is merged", async () => {
    const api = new FakeApi();
    const result = await run(api);
    assert.equal(result.state, "MERGED");
    assert.equal(api.merges.length, 1);
    assert.equal(api.merges[0].number, 2530);
    assert.equal(api.merges[0].headSha, GENERATED);
  });

  test("a PR on the reserved ref grammar authored by anyone else is REFUSED and never merged", async () => {
    for (const impostor of ["sethogieva", "dependabot[bot]", "mingla-bundle-baselines[bot]", "renovate[bot]"]) {
      const api = new FakeApi({ actor: impostor });
      const result = await run(api);
      assert.equal(result.state, "REFUSED", `${impostor} must not be merged`);
      assert.match(result.reason, /^PROVENANCE_/);
      assert.equal(api.merges.length, 0);
    }
  });

  test("a PR whose commit was authored by a human on the App's branch is REFUSED", async () => {
    const api = new FakeApi();
    api.commits.get(GENERATED).author = { login: "sethogieva" };
    const result = await run(api);
    assert.equal(result.state, "REFUSED");
    assert.equal(api.merges.length, 0);
  });

  test("an ordinary PR is not even a candidate — only the reserved ref grammar is", async () => {
    const api = new FakeApi({ headRef: "2524-baseline-automerge" });
    const result = await run(api);
    assert.equal(result.state, "NO_CANDIDATE");
    assert.equal(api.merges.length, 0);
  });
});

describe("#2524 guard 2 — single-file-locked", () => {
  test("a recording PR carrying a second file is REFUSED and left for a human", async () => {
    const api = new FakeApi({
      changedFiles: 2,
      files: [{ filename: BASELINE_PATH }, { filename: "mingla-business/scripts/ci/orch-1083-initial-bundle-budget.mjs" }],
    });
    const result = await run(api);
    assert.equal(result.state, "REFUSED");
    assert.equal(api.merges.length, 0);
  });

  test("a recording PR whose single file is NOT the baseline is REFUSED", async () => {
    const api = new FakeApi({ files: [{ filename: RATCHET_WORKFLOW }] });
    const result = await run(api);
    assert.equal(result.state, "REFUSED");
    assert.equal(api.merges.length, 0);
  });

  test("the underlying provenance compare must still see exactly one baseline-only commit", async () => {
    const api = new FakeApi();
    api.commits.get(GENERATED).parents = [{ sha: MOVED }];
    const result = await run(api);
    assert.equal(result.state, "REFUSED");
    assert.equal(api.merges.length, 0);
  });
});

describe("#2524 guard 3 — all-green-locked (pending and empty are NOT green)", () => {
  test("PENDING IS NOT GREEN — a check still running refuses the merge", async () => {
    const api = new FakeApi({
      checkRuns: {
        total_count: 2,
        check_runs: [
          { name: "CI batch: node20-noinstall", status: "completed", conclusion: "success" },
          { name: "Business jest", status: "in_progress", conclusion: null },
        ],
      },
    });
    const result = await run(api);
    assert.equal(result.state, "REFUSED");
    assert.equal(result.reason, "CHECKS_PENDING");
    assert.match(result.detail, /Business jest=in_progress/);
    assert.equal(api.merges.length, 0);
  });

  test("a queued check refuses the merge", async () => {
    const api = new FakeApi({
      checkRuns: { total_count: 1, check_runs: [{ name: "web-build-check", status: "queued", conclusion: null }] },
    });
    const result = await run(api);
    assert.equal(result.reason, "CHECKS_PENDING");
    assert.equal(api.merges.length, 0);
  });

  test("a completed check with a null conclusion refuses the merge", async () => {
    const api = new FakeApi({
      checkRuns: { total_count: 1, check_runs: [{ name: "web-build-check", status: "completed", conclusion: null }] },
    });
    const result = await run(api);
    assert.equal(result.reason, "CHECKS_FAILED");
    assert.equal(api.merges.length, 0);
  });

  test("AN EMPTY CHECK LISTING IS NOT GREEN — zero checks and zero statuses refuses", async () => {
    const api = new FakeApi({
      checkRuns: { total_count: 0, check_runs: [] },
      statuses: { state: "pending", total_count: 0, statuses: [] },
    });
    const result = await run(api);
    assert.equal(result.state, "REFUSED");
    assert.equal(result.reason, "CHECKS_NOT_REPORTED");
    assert.match(result.detail, /empty listing is not a green listing/i);
    assert.equal(api.merges.length, 0);
  });

  test("a TRUNCATED listing (total_count exceeds the page returned) refuses", async () => {
    const api = new FakeApi({
      checkRuns: { total_count: 140, check_runs: [{ name: "one", status: "completed", conclusion: "success" }] },
    });
    const result = await run(api);
    assert.equal(result.reason, "CHECKS_TRUNCATED");
    assert.equal(api.merges.length, 0);
  });

  test("a malformed or rate-limited response body refuses instead of reading as green", () => {
    for (const payload of [null, undefined, {}, { total_count: 3 }, { check_runs: [] }, { total_count: "3", check_runs: [] }, "rate limit exceeded"]) {
      const verdict = assessChecks(payload, greenStatus());
      assert.equal(verdict.ok, false, `${JSON.stringify(payload)} must not read as green`);
      assert.match(verdict.reason, /^CHECKS_(UNREADABLE|TRUNCATED|NOT_REPORTED)$/);
    }
    for (const payload of [null, undefined, {}, { state: "success" }, { state: "success", total_count: 2, statuses: [] }]) {
      const verdict = assessChecks(greenChecks(), payload);
      assert.equal(verdict.ok, false, `status ${JSON.stringify(payload)} must not read as green`);
    }
  });

  test("every non-passing conclusion refuses the merge", async () => {
    for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "stale"]) {
      const api = new FakeApi({
        checkRuns: { total_count: 1, check_runs: [{ name: "gate", status: "completed", conclusion }] },
      });
      const result = await run(api);
      assert.equal(result.reason, "CHECKS_FAILED", `${conclusion} must refuse`);
      assert.equal(api.merges.length, 0);
    }
  });

  test("neutral and skipped are the only non-success conclusions that pass", async () => {
    const api = new FakeApi({
      checkRuns: {
        total_count: 3,
        check_runs: [
          { name: "a", status: "completed", conclusion: "success" },
          { name: "b", status: "completed", conclusion: "skipped" },
          { name: "c", status: "completed", conclusion: "neutral" },
        ],
      },
    });
    assert.equal((await run(api)).state, "MERGED");
  });

  test("a failing or pending combined commit status refuses even when every check run passed", async () => {
    for (const [state, reason] of [["pending", "CHECKS_PENDING"], ["failure", "CHECKS_FAILED"], ["error", "CHECKS_FAILED"]]) {
      const api = new FakeApi({ statuses: { state, total_count: 1, statuses: [{ context: "vercel", state }] } });
      const result = await run(api);
      assert.equal(result.reason, reason);
      assert.equal(api.merges.length, 0);
    }
  });

  test("mergeable=null (GitHub has not computed it) refuses rather than merging on an unknown", async () => {
    const api = new FakeApi({ mergeable: null });
    const result = await run(api);
    assert.equal(result.reason, "MERGEABILITY_UNKNOWN");
    assert.equal(api.merges.length, 0);
  });

  // [TEST-MOD-APPROVED #2885] SUPERSEDED. This test previously asserted that
  // every non-"clean" `mergeable_state` refuses with MERGE_BLOCKED. That
  // assertion is what made this a guard that could not pass: GitHub computes
  // `mergeable_state` WITHOUT REFERENCE TO THE CALLER, so it says "blocked" to
  // an actor holding a ruleset bypass, and the automation refused every run for
  // a week while printing an operator prerequisite that had been satisfied
  // since 2026-08-24. Proven on live PR #2884 (2026-09-01T02:30Z): read
  // mergeable_state="blocked" with 56 checks green, then PUT /pulls/2884/merge
  // -> HTTP 200 merged:true, same job, same token, four seconds apart. The
  // contract below is the corrected one.
  test("a caller-blind mergeable_state does NOT decide — the merge is attempted and GitHub answers", async () => {
    for (const state of ["blocked", "behind", "unstable", "has_hooks", "unknown"]) {
      const api = new FakeApi({ mergeableState: state });
      const result = await run(api);
      assert.equal(result.state, "MERGED", `${state} must be attempted, not predicted`);
      assert.equal(api.merges.length, 1, `${state} must reach the merge endpoint`);
    }
  });

  test("the caller-INDEPENDENT signals still refuse without spending an attempt", async () => {
    // A git conflict and a draft are true for every caller alike, so reading
    // them is not the mistake #2885 fixed. They must still fail closed.
    const conflicted = new FakeApi({ mergeable: false, mergeableState: "dirty" });
    assert.equal((await run(conflicted)).reason, "NOT_MERGEABLE");
    assert.equal(conflicted.merges.length, 0);

    const draft = new FakeApi({ draft: true, mergeableState: "draft" });
    assert.equal((await run(draft)).reason, "DRAFT_PR");
    assert.equal(draft.merges.length, 0);
  });

  // [TEST-MOD-APPROVED #2885] SUPERSEDED. This test pinned the exact wording of
  // an operator prerequisite — "add the App as a bypass actor" — that had been
  // satisfied on 2026-08-24, and so it actively protected a stale instruction
  // and kept it printing for a week. It is replaced by its inverse:
  // that instruction must never be printed again, because following it a second
  // time is a no-op that costs a person an afternoon.
  test("THE #2885 FIX — a green recording PR reported as blocked is MERGED, not refused", async () => {
    const api = new FakeApi({ mergeableState: "blocked" });
    const result = await run(api);
    assert.equal(result.state, "MERGED", "reading mergeable_state must not be able to refuse this");
    assert.equal(result.reason, "GUARDS_SATISFIED");
    assert.equal(api.merges.length, 1);
    // The field is still REPORTED, so a human can see what GitHub claimed.
    assert.equal(result.mergeableState, "blocked");
    assert.match(renderSummary(result), /context only, never the decision/);
  });

  test("no refusal, and no summary, may ever print the stale operator prerequisite again", async () => {
    const rejected = new FakeApi({
      mergeableState: "blocked",
      mergeRejection: { status: 405, message: "Base branch was modified. Review and try the merge again." },
    });
    const result = await run(rejected);
    assert.equal(result.reason, "MERGE_REJECTED");
    // GitHub's own words, verbatim, and the status alongside them.
    assert.match(result.detail, /HTTP 405/);
    assert.match(result.detail, /Base branch was modified\. Review and try the merge again\./);
    for (const text of [result.detail, renderSummary(result)]) {
      assert.doesNotMatch(text, /OPERATOR PREREQUISITE/, "the satisfied prerequisite must be gone");
      assert.doesNotMatch(text, /bypass actor/, "nothing here may send anyone to grant a permission");
      assert.doesNotMatch(text, /cannot satisfy/, "the App can satisfy it — it holds the bypass");
    }
  });

  test("a declined merge names the real blocker even when GitHub sends no message", async () => {
    const api = new FakeApi({ mergeRejection: { status: 409, message: undefined } });
    const result = await run(api);
    assert.equal(result.reason, "MERGE_REJECTED");
    assert.equal(result.mergeAttemptStatus, 409);
    assert.match(result.detail, /409/);
  });
});

describe("#2524 guard 4 — ceiling-locked", () => {
  test("the refusal threshold is exactly one per-PR allowance beneath each ceiling", () => {
    assert.deepEqual(
      Object.fromEntries(["common", "eager"].map((scope) => [scope, {
        raw: CEILING[scope].raw - REFUSAL_RUNWAY[scope],
        brotli: CEILING[scope].brotli - REFUSAL_RUNWAY[scope],
      }])),
      {
        common: { raw: 2_588_000, brotli: 488_000 },
        eager: { raw: 3_975_000, brotli: 725_000 },
      },
    );
  });

  test("a measurement AT or OVER a ceiling refuses", async () => {
    for (const [scope, metric, value] of [
      ["common", "raw", CEILING.common.raw],
      ["common", "brotli", CEILING.common.brotli + 1],
      ["eager", "raw", CEILING.eager.raw + 10_000],
      ["eager", "brotli", CEILING.eager.brotli],
    ]) {
      const proposed = JSON.parse(JSON.stringify(PROPOSED));
      proposed[scope][metric] = value;
      const api = new FakeApi({ proposed });
      const result = await run(api);
      assert.equal(result.state, "REFUSED");
      assert.equal(result.reason, "CEILING_RUNWAY");
      assert.equal(result.breaches[0].kind, "OVER_CEILING");
      assert.equal(api.merges.length, 0);
    }
  });

  test("a measurement that leaves LESS THAN one allowance of runway refuses, one byte inside the ceiling", async () => {
    const proposed = JSON.parse(JSON.stringify(PROPOSED));
    proposed.common.raw = CEILING.common.raw - REFUSAL_RUNWAY.common + 1;
    const api = new FakeApi({ proposed });
    const result = await run(api);
    assert.equal(result.reason, "CEILING_RUNWAY");
    assert.equal(result.breaches[0].kind, "NO_RUNWAY");
    assert.match(result.detail, /leaving less than one 12000 B per-PR allowance/);
    assert.equal(api.merges.length, 0);
  });

  test("a measurement leaving EXACTLY one allowance of runway is still merged", async () => {
    const proposed = JSON.parse(JSON.stringify(PROPOSED));
    proposed.common.raw = CEILING.common.raw - REFUSAL_RUNWAY.common;
    const api = new FakeApi({ proposed });
    assert.equal((await run(api)).state, "MERGED");
  });

  test("an unreadable or absurd measurement refuses instead of defaulting to allowed", () => {
    for (const bad of [null, undefined, {}, { common: { raw: 0, brotli: 1 }, eager: { raw: 1, brotli: 1 } },
      { common: { raw: -5, brotli: 1 }, eager: { raw: 1, brotli: 1 } },
      { common: { raw: "2382860", brotli: 1 }, eager: { raw: 1, brotli: 1 } },
      { common: { raw: 1.5, brotli: 1 }, eager: { raw: 1, brotli: 1 } }]) {
      assert.equal(assessCeilingRunway(bad).ok, false, `${JSON.stringify(bad)} must refuse`);
    }
  });

  test("today's committed baseline is comfortably inside the refusal margin", () => {
    const live = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), "utf8"));
    assert.equal(assessCeilingRunway(live).ok, true);
  });

  test("the mirrored ceilings are re-derived from the budget source and cannot rot in silence", () => {
    const derived = assertCeilingMirrorMatchesBudgetSource();
    assert.deepEqual(derived.ceiling, JSON.parse(JSON.stringify(CEILING)));
    assert.deepEqual(derived.runway, JSON.parse(JSON.stringify(REFUSAL_RUNWAY)));

    const drifted = readFileSync(join(ROOT, "mingla-business/scripts/ci/orch-1083-initial-bundle-budget.mjs"), "utf8")
      .replace("raw: 2_600_000", "raw: 3_000_000");
    assert.throws(() => assertCeilingMirrorMatchesBudgetSource(drifted), (error) =>
      error instanceof AutomergeError && error.code === "MIRROR_DRIFTED");
  });

  test("#2524 changes neither PR_DELTA_ALLOWANCE nor HARD_CEILING in the budget script", () => {
    const source = readFileSync(join(ROOT, "mingla-business/scripts/ci/orch-1083-initial-bundle-budget.mjs"), "utf8");
    assert.match(source, /const PR_DELTA_ALLOWANCE = \{ common: 12_000, eager: 25_000 \};/);
    assert.match(source, /common: \{ raw: 2_600_000, brotli: 500_000 \}/);
    assert.match(source, /eager: \{ raw: 4_000_000, brotli: 750_000 \}/);
  });
});

describe("#2524 guard 5 — loud, not silent", () => {
  test("the merge commit names the automation, the source and the exact recorded movement", async () => {
    const api = new FakeApi();
    const result = await run(api);
    assert.equal(result.state, "MERGED");
    const { title, message } = api.merges[0];
    assert.match(title, /^Record business-web boot payload growth \(common \+2,587 B, eager \+2,587 B\) \(#2530\)$/);
    assert.match(message, /bundle-baseline-automerge\.mjs \(issue #2524\)/);
    assert.match(message, new RegExp(`Measured main at ${SOURCE}`));
    assert.match(message, /common raw: 2,380,273 B -> 2,382,860 B \(\+2,587 B\)/);
    assert.match(message, /common brotli: 452,000 B -> 452,820 B \(\+820 B\)/);
    assert.match(message, /eager raw: 3,388,663 B -> 3,391,250 B \(\+2,587 B\)/);
    assert.match(message, /HARD_CEILING and PR_DELTA_ALLOWANCE are untouched/);
    assert.match(message, /Guards satisfied: author=VALID_GENERATED_PR, files=1/);
  });

  test("a reduction is rendered with its true sign", () => {
    const lines = describeMovement({ common: { raw: 100, brotli: 60 }, eager: { raw: 10, brotli: 5 } },
      { common: { raw: 90, brotli: 60 }, eager: { raw: 10, brotli: 5 } });
    assert.match(lines[0], /100 B -> 90 B \(-10 B\)/);
    assert.match(lines[1], /60 B -> 60 B \(±0 B\)/);
  });

  test("every outcome renders a summary carrying its state, reason and candidate", async () => {
    const merged = renderSummary(await run(new FakeApi()));
    assert.match(merged, /state: `MERGED`/);
    assert.match(merged, /candidate PR: #2530/);
    assert.match(merged, /common raw: 2,380,273 B -> 2,382,860 B/);

    const refused = renderSummary(await run(new FakeApi({ checkRuns: { total_count: 0, check_runs: [] }, statuses: { state: "pending", total_count: 0, statuses: [] } })));
    assert.match(refused, /state: `REFUSED`/);
    assert.match(refused, /reason: `CHECKS_NOT_REPORTED`/);
    assert.match(refused, /empty listing is not a green listing/i);
  });
});

describe("#2524 staleness and shared-write safety", () => {
  test("a recording PR whose source is no longer main is left alone for the ratchet to supersede", async () => {
    const api = new FakeApi();
    api.mainSha = MOVED;
    const result = await run(api);
    assert.equal(result.state, "NO_CANDIDATE");
    assert.equal(result.staleCount, 1);
    assert.equal(api.merges.length, 0);
  });

  test("main moving between the guards and the merge aborts the write", async () => {
    const api = new FakeApi();
    // reads: selection, verifyPullRequest's liveMain, final pre-write re-read.
    api.mainReads = [SOURCE, SOURCE, MOVED];
    const result = await run(api);
    assert.equal(result.state, "SUPERSEDED");
    assert.equal(result.reason, "MAIN_MOVED");
    assert.equal(api.merges.length, 0);
  });

  test("two open recording PRs claiming the same live main is a collision, not a coin flip", async () => {
    const api = new FakeApi();
    api.pulls.push({ ...api.pulls[0], number: 2531 });
    await assert.rejects(() => run(api), (error) => error instanceof AutomergeError && error.code === "COLLISION");
    assert.equal(api.merges.length, 0);
  });

  test("no open recording PR at all is a no-op, not an error", async () => {
    const api = new FakeApi();
    api.pulls = [];
    const result = await run(api);
    assert.equal(result.state, "NO_CANDIDATE");
    assert.equal(api.merges.length, 0);
  });

  test("the merge is pinned to the verified head SHA so a moved head cannot be merged blind", async () => {
    const api = new FakeApi();
    await run(api);
    assert.equal(api.merges[0].headSha, GENERATED);
    assert.equal(api.merges[0].merge_method, undefined);
  });
});

describe("#2524 the module and its workflow stay wired the way they are documented", () => {
  const workflow = readFileSync(join(ROOT, AUTOMERGE_WORKFLOW), "utf8");
  const module = readFileSync(join(ROOT, "mingla-business/scripts/ci/bundle-baseline-automerge.mjs"), "utf8");

  test("the App token is minted only in the scheduled job, never on a pull_request event", () => {
    const tokenIndex = workflow.indexOf("BUNDLE_BASELINE_APP_PRIVATE_KEY");
    assert.ok(tokenIndex > 0, "the automerge job must mint the App token");
    const automergeJob = workflow.slice(workflow.indexOf("  automerge:"));
    assert.ok(automergeJob.includes("BUNDLE_BASELINE_APP_PRIVATE_KEY"));
    assert.match(automergeJob, /if: \$\{\{ github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch' \}\}/);
    const guardJob = workflow.slice(workflow.indexOf("  guard-tests:"), workflow.indexOf("  automerge:"));
    assert.ok(!guardJob.includes("BUNDLE_BASELINE_APP_PRIVATE_KEY"), "the PR-triggered job must never see the App key");
  });

  test("the guard suite is named in full — never a glob or a -t pattern", () => {
    assert.match(workflow, /scripts\/ci\/__tests__\/issue2524_bundle_baseline_automerge\.happy\.test\.mjs/);
    assert.ok(!/issue2524_\*/.test(workflow), "a glob can silently match zero files and exit 0");
    assert.match(workflow, /test -f scripts\/ci\/__tests__\/issue2524_bundle_baseline_automerge\.happy\.test\.mjs/);
  });

  test("the automation holds no approval, review or force path", () => {
    for (const forbidden of ["/reviews", "approve", "enablePullRequestAutoMerge", "force"]) {
      assert.ok(!module.toLowerCase().includes(`"${forbidden.toLowerCase()}`), `${forbidden} must not be reachable`);
    }
    assert.ok(!module.includes("api.createPull"), "the auto-merger never creates artifacts");
    assert.ok(!module.includes("deleteRef"), "the auto-merger never deletes refs");
    const mergeCalls = module.match(/api\.mergePull\(/g) ?? [];
    assert.equal(mergeCalls.length, 1, "there is exactly one call site that can merge anything");
  });

  test("this suite names no workflow file literally, so #2148's registry stays intact", () => {
    const self = readFileSync(join(ROOT, "mingla-business/scripts/ci/__tests__", ["issue2524_bundle_baseline_automerge.happy.test", "mjs"].join(".")), "utf8");
    const literals = (self.match(/[A-Za-z0-9_-]+\.ya?ml/g) ?? []).filter((name) => !name.startsWith("issue2524_"));
    assert.deepEqual(literals, [], `a literal workflow filename here reds the #2148 registry gate: ${literals.join(", ")}`);
    assert.ok(!module.match(/[A-Za-z0-9_-]+\.ya?ml/), "the auto-merge module must not name a workflow file literally either");
  });

  test("#2058's handoff module still contains no merge endpoint of its own", () => {
    const handoff = readFileSync(join(ROOT, "mingla-business/scripts/ci/bundle-baseline-pr-handoff.mjs"), "utf8");
    assert.ok(!handoff.includes("/merge"), "the artifact creator must remain unable to merge");
  });

  test("the adapter reaches only the three endpoints the merge decision needs", () => {
    const calls = [];
    const api = makeAutomergeApi({
      token: "installation-token-for-tests-only",
      owner: "Mingla-LLC",
      repo: "mingla-main",
      fetchImpl: async (url, init) => {
        calls.push(`${init.method} ${url.replace("https://api.github.com/repos/Mingla-LLC/mingla-main", "")}`);
        return { status: 200, ok: true, text: async () => "{}" };
      },
    });
    return Promise.all([
      api.listCheckRuns(GENERATED),
      api.getCombinedStatus(GENERATED),
      api.mergePull({ number: 1, headSha: GENERATED, title: "t", message: "m" }),
    ]).then(() => {
      assert.deepEqual(calls, [
        `GET /commits/${GENERATED}/check-runs?per_page=100`,
        `GET /commits/${GENERATED}/status?per_page=100`,
        "PUT /pulls/1/merge",
      ]);
    });
  });

  test("a REST failure never leaks the token into its diagnostic", async () => {
    const api = makeAutomergeApi({
      token: "installation-token-for-tests-only",
      owner: "Mingla-LLC",
      repo: "mingla-main",
      fetchImpl: async () => ({ status: 403, ok: false, text: async () => JSON.stringify({ message: "API rate limit exceeded" }) }),
    });
    await assert.rejects(() => api.listCheckRuns(GENERATED), (error) => {
      assert.ok(error instanceof AutomergeError);
      assert.equal(error.code, "REST_FAILURE");
      assert.doesNotMatch(error.message, /installation-token-for-tests-only/);
      return true;
    });
  });
});

describe("#2885 AC-6 — a refusal nobody reads must red the job", () => {
  test("a fresh refusal is a normal outcome and stays quiet", () => {
    const verdict = assessRefusalPersistence({
      state: "REFUSED",
      candidateOpenedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });
    assert.equal(verdict.persistent, false);
    assert.equal(verdict.reason, "REFUSAL_IS_FRESH");
  });

  test("a refusal that OUTLIVES its candidate is the #2885 failure mode and must be loud", () => {
    const justInside = assessRefusalPersistence({
      state: "REFUSED",
      candidateOpenedAt: new Date(Date.now() - (STALE_REFUSAL_MINUTES - 1) * 60_000).toISOString(),
    });
    assert.equal(justInside.persistent, false, "one minute short of the threshold is still fresh");

    const justOver = assessRefusalPersistence({
      state: "REFUSED",
      candidateOpenedAt: new Date(Date.now() - (STALE_REFUSAL_MINUTES + 1) * 60_000).toISOString(),
    });
    assert.equal(justOver.persistent, true);
    assert.equal(justOver.reason, "REFUSAL_OUTLIVED_CANDIDATE");

    // The actual #2885 defect: a week of identical refusals.
    const week = assessRefusalPersistence({
      state: "REFUSED",
      candidateOpenedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
    });
    assert.equal(week.persistent, true);
  });

  test("an unreadable candidate age is LOUD, never quiet — a missing answer is not a good one", () => {
    for (const opened of [null, undefined, "", "not-a-date"]) {
      const verdict = assessRefusalPersistence({ state: "REFUSED", candidateOpenedAt: opened });
      assert.equal(verdict.persistent, true, `${JSON.stringify(opened)} must not read as fresh`);
      assert.equal(verdict.reason, "OPENED_AT_UNREADABLE");
    }
  });

  test("nothing that is not a refusal can red the job", () => {
    for (const state of ["MERGED", "NO_CANDIDATE", "SUPERSEDED"]) {
      const verdict = assessRefusalPersistence({
        state,
        candidateOpenedAt: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
      });
      assert.equal(verdict.persistent, false, `${state} is not a refusal`);
      assert.equal(verdict.reason, "NOT_A_REFUSAL");
    }
  });

  test("a run carries the candidate's age forward so the job can judge it", async () => {
    const opened = new Date(Date.now() - 90 * 60_000).toISOString();
    const result = await run(new FakeApi({ createdAt: opened }));
    assert.equal(result.candidateOpenedAt, opened);
  });
});

describe("#2885 AC-4 — a one-file recording PR may not cost a full fan-out", () => {
  test("the ceiling passes today's scoped fan-out and fails the 53 that provoked this", () => {
    assert.equal(assessCheckFanout(6).ok, true, "three jobs plus three app checks is the scoped shape");
    assert.equal(assessCheckFanout(CHECK_FANOUT_CEILING).ok, true, "exactly at the ceiling is allowed");
    assert.equal(assessCheckFanout(CHECK_FANOUT_CEILING + 1).ok, false);
    const measured = assessCheckFanout(56);
    assert.equal(measured.ok, false, "the 56 checks measured on PR #2884 must fail this");
    assert.equal(measured.reason, "FANOUT_REGRESSED");
  });

  test("an unreadable check count fails rather than defaulting to allowed", () => {
    for (const count of [null, undefined, -1, 1.5, Number.NaN, "6"]) {
      assert.equal(assessCheckFanout(count).ok, false, `${JSON.stringify(count)} must not read as scoped`);
    }
  });

  test("the fan-out is reported on a successful merge, never used to refuse one", async () => {
    // A diagnostic that refused the merge would re-create the stale-baseline
    // jam it exists to report. It rides along; the job reds afterwards.
    const api = new FakeApi({
      checkRuns: {
        total_count: 40,
        check_runs: Array.from({ length: 40 }, (_unused, i) => ({ name: `job-${i}`, status: "completed", conclusion: "success" })),
      },
    });
    const result = await run(api);
    assert.equal(result.state, "MERGED", "the merge must still happen");
    assert.equal(api.merges.length, 1);
    assert.equal(result.fanout.ok, false, "and the regression must still be reported");
    assert.match(renderSummary(result), /FANOUT_REGRESSED/);
  });
});

describe("#2885 AC-4 — the workflow path filters that produce that fan-out", () => {
  // Evaluated, not grepped: this reproduces GitHub's own path-filter semantics
  // and asks each workflow the real question — "would a pull request whose ONLY
  // changed file is the baseline start you?". Validated against live behaviour:
  // run against the pre-fix workflows it reproduces exactly the 20 workflow runs
  // GitHub actually started on PR #2884, no more and no fewer.
  const WORKFLOWS = join(ROOT, WORKFLOW_DIR);

  // Assembled, never literal — see the #2148 registry note at the top of this file.
  //
  // Each entry is here because something OTHER than convenience keeps it here.
  // "It is cheap" is not a reason to be on this list, and "it is expensive" is
  // not a reason to come off it.
  const KEEP = new Set([
    // Required by ruleset 19508605, whose bypass actor list is EMPTY.
    ["framework-major-guard", "yml"].join("."),
    // Required by ruleset 19583754, bypass: OrganizationAdmin only — not the App.
    ["mingla-business-jest-suite", "yml"].join("."),
    // #2058's provenance proof: the check that the PR is genuinely machine-authored.
    ["bundle-baseline-provenance-guard", "yml"].join("."),
    // ci-batch is deliberately UNFILTERED. Its own header says so — "NO paths:
    // filter, deliberately" — and #2148's runner-v2 tester asserts
    // `doesNotMatch(/^\s*paths(?:-ignore)?:/m)` against it, an assertion written
    // to cover exactly the `paths-ignore` move #2885 tried. The reason is
    // recorded in that header: the batch consolidated ~340 individually
    // paths-gated jobs, and a paths-gated suite silently skips on a PR that
    // misses its globs — which is how a latent main-red landed in PR #743 and
    // surfaced on someone else's unrelated PR. It is the single most expensive
    // entry on this list (15 jobs) and it stays, because "it is expensive" is
    // not a reason to come off.
    ["ci-batch", "yml"].join("."),
    // #1614's arbiter audit is deliberately UNFILTERED and its own suite pins
    // that shape — `assert.match(workflow, /pull_request:\s*\n\s*push:\s*\n\s*branches: \[main\]/)`
    // and `assert.doesNotMatch(workflow, /\n\s+paths:/)` in the test named
    // "always-run workflow wires every implementor and tester contract". #2885
    // scoped it anyway on the reasoning that a JSON file cannot add an upsert
    // site — true, and beside the point: the audit's contract is that it runs on
    // EVERYTHING, so that its census can never be narrowed one defensible
    // exception at a time. That contract is worth more than the one job saved,
    // so the exclusion was reverted rather than the assertion weakened.
    ["issue-1614-onconflict-arbiter-audit", "yml"].join("."),
  ]);

  function globToRe(glob) {
    let re = "";
    for (let i = 0; i < glob.length; i += 1) {
      const c = glob[i];
      if (c === "*") {
        if (glob[i + 1] === "*") { re += ".*"; i += 1; if (glob[i + 1] === "/") i += 1; }
        else re += "[^/]*";
      } else if (c === "?") re += "[^/]";
      else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
  }

  function anchors(lines) {
    const found = new Map();
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^\s*[a-z-]+:\s*&([A-Za-z0-9_]+)\s*$/.exec(lines[i]);
      if (!m) continue;
      const items = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = /^\s+- "?([^"#]+?)"?\s*$/.exec(lines[j]);
        if (item) { items.push(item[1]); continue; }
        if (lines[j].trim() === "" || /^\s+#/.test(lines[j])) continue;
        break;
      }
      found.set(m[1], items);
    }
    return found;
  }

  // Throws on anything it cannot read with certainty. An unreadable filter is a
  // FAILURE, never a pass — that is the whole #2113 lesson.
  function filtersFor(text, event) {
    const lines = text.split("\n");
    const anchored = anchors(lines);
    const start = lines.indexOf(`  ${event}:`);
    if (start === -1) return null;
    let end = lines.length;
    for (let j = start + 1; j < lines.length; j += 1) {
      if (lines[j] && !/^\s/.test(lines[j])) { end = j; break; }
      if (/^  [A-Za-z_]/.test(lines[j])) { end = j; break; }
    }
    const block = lines.slice(start + 1, end);
    const grab = (key) => {
      const k = block.findIndex((line) => new RegExp(`^    ${key}:`).test(line));
      if (k === -1) return null;
      const alias = /^\s*[a-z-]+:\s*\*([A-Za-z0-9_]+)\s*$/.exec(block[k]);
      if (alias) {
        if (!anchored.has(alias[1])) throw new Error(`unresolved alias *${alias[1]}`);
        return anchored.get(alias[1]);
      }
      const out = [];
      for (let j = k + 1; j < block.length; j += 1) {
        const item = /^      - "?([^"#]+?)"?\s*$/.exec(block[j]);
        if (item) { out.push(item[1]); continue; }
        if (block[j].trim() === "" || /^\s+#/.test(block[j])) continue;
        break;
      }
      if (out.length === 0) throw new Error(`${key} is present but unreadable`);
      return out;
    };
    return { paths: grab("paths"), pathsIgnore: grab("paths-ignore") };
  }

  function starts(filters, file) {
    if (filters === null) return false;
    const { paths, pathsIgnore } = filters;
    if (paths && pathsIgnore) throw new Error("paths and paths-ignore on one event");
    if (paths) {
      let included = false;
      for (const pattern of paths) {
        const negated = pattern.startsWith("!");
        if (globToRe(negated ? pattern.slice(1) : pattern).test(file)) included = !negated;
      }
      return included;
    }
    if (pathsIgnore) return !pathsIgnore.some((pattern) => globToRe(pattern).test(file));
    return true; // no filter at all — every pull request starts it
  }

  function startedBy(file, events) {
    const hits = new Set();
    for (const name of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort()) {
      const text = readFileSync(join(WORKFLOWS, name), "utf8");
      for (const event of events) {
        let filters;
        try {
          filters = filtersFor(text, event);
        } catch (error) {
          assert.fail(`${name} [${event}]: filter unreadable (${error.message}). An unreadable filter is a failure, not a pass.`);
        }
        if (event === "push") {
          const head = text.slice(text.indexOf("  push:"), text.indexOf("  push:") + 400);
          if (!/branches:.*\bmain\b/.test(head)) continue;
        }
        if (starts(filters, file)) hits.add(name);
      }
    }
    return hits;
  }

  test("a pull request that changes ONLY the baseline starts nothing that cannot be affected by it", () => {
    const started = startedBy(BASELINE_PATH, ["pull_request", "pull_request_target"]);
    assert.deepEqual(
      [...started].sort(),
      [...KEEP].sort(),
      "Measured 2026-08-31: 53 jobs across 20 workflows on one machine-written JSON file. "
      + "A workflow added or widened without excluding that file puts the fan-out back, and nothing "
      + "else in the repo would notice. Exclude it, or add it here deliberately if it is genuinely required.",
    );
  });

  test("merging that baseline does not simply move the fan-out onto main", () => {
    // The recording PR auto-merges now, so every one of these lands a push to
    // main. Only the ratchet — which must re-measure main after every merge —
    // is allowed to run for a baseline-only commit.
    const started = startedBy(BASELINE_PATH, ["push"]);
    assert.deepEqual([...started].sort(), [
      // Must re-measure main after every merge — it is the mechanism.
      ["bundle-baseline-ratchet", "yml"].join("."),
      // Always-run by their own pinned contracts; see KEEP above.
      ["issue-1614-onconflict-arbiter-audit", "yml"].join("."),
      ["ci-batch", "yml"].join("."),
    ].sort());
  });

  test("an ordinary pull request is untouched by this scoping", () => {
    // The exclusion must be exactly one machine-written file and nothing near
    // it: a real source change still starts everything it always did.
    const ordinary = startedBy("mingla-business/src/services/eventOrdersService.ts", ["pull_request"]);
    assert.ok(ordinary.size > 20, `a real source change must still fan out; got ${ordinary.size}`);
    const sibling = startedBy("mingla-business/scripts/ci/orch-1083-initial-bundle-budget.mjs", ["pull_request"]);
    assert.ok(sibling.size > 1, `the baseline's SIBLINGS are not excluded; got ${sibling.size}`);
  });
});
