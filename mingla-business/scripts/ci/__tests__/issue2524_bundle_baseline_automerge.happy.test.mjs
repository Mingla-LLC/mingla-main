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
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_PATH, BRANCH_PREFIX } from "../bundle-baseline-pr-handoff.mjs";
import {
  AutomergeError,
  CEILING,
  REFUSAL_RUNWAY,
  assertCeilingMirrorMatchesBudgetSource,
  assessCeilingRunway,
  assessChecks,
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
    }];
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

  async mergePull(input) { this.merges.push(input); return { merged: true, sha: "e".repeat(40) }; }
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

  test("a blocked or dirty mergeable_state refuses, and says a review is a human's job", async () => {
    for (const state of ["blocked", "dirty", "behind", "unstable", "draft"]) {
      const api = new FakeApi({ mergeableState: state });
      const result = await run(api);
      assert.equal(result.reason, "MERGE_BLOCKED", `${state} must refuse`);
      assert.equal(api.merges.length, 0);
    }
  });

  test("green-but-blocked names the required-review rule and the operator prerequisite by name", async () => {
    // main carries a `general security` ruleset requiring an approving
    // code-owner review, and the App is not a bypass actor on it. Without this
    // diagnostic the automation would refuse identically forever and look, from
    // the outside, exactly like "there was nothing to merge".
    const result = await run(new FakeApi({ mergeableState: "blocked" }));
    assert.equal(result.reason, "MERGE_BLOCKED");
    assert.match(result.detail, /all 2 check\(s\) green/);
    assert.match(result.detail, /required-review rule on main/);
    assert.match(result.detail, /mingla-bundle-baseline App cannot satisfy/);
    assert.match(result.detail, /never approves its own pull request/);
    assert.match(result.detail, /OPERATOR PREREQUISITE: .*bypass actor on the "general security" ruleset/);
    assert.match(renderSummary(result), /OPERATOR PREREQUISITE/);
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
