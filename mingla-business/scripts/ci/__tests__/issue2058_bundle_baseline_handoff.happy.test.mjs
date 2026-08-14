/**
 * Issue #2058 implementor regression suite.
 *
 * This drives the exported production state machine through a secret-free fake
 * REST adapter, then statically locks the workflow trust boundary. Restoring
 * the old push-then-gh-pr-create workflow makes the workflow-contract tests
 * fail immediately; removing the state machine breaks the behavioral cases.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_PATH,
  BRANCH_PREFIX,
  HandoffError,
  makeRestAdapter,
  runHandoff,
  verifyRolloutEvidence,
  verifyPullRequest,
} from "../bundle-baseline-pr-handoff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../");
const SOURCE = "a".repeat(40);
const NEXT = "c".repeat(40);
const PREVIOUS = "b".repeat(40);
const GENERATED = "d".repeat(40);
const ACTOR = "mingla-bundle-baseline[bot]";
const SLUG = "mingla-bundle-baseline";

function baseline(source = SOURCE) {
  return JSON.stringify({
    measuredOn: { commit: source },
    common: { raw: 1, gzip: 1, brotli: 1 },
    eager: { raw: 1, gzip: 1, brotli: 1 },
  }, null, 2) + "\n";
}

function options(overrides = {}) {
  return {
    sourceSha: SOURCE,
    changed: true,
    baselineContent: baseline(),
    expectedAppSlug: SLUG,
    tokenAppSlug: SLUG,
    title: "Bank measured payload",
    direction: "reduction",
    summary: "common -2,100 B",
    commonRaw: "100",
    commonBrotli: "50",
    eagerBrotli: "60",
    ...overrides,
  };
}

class FakeApi {
  constructor() {
    this.owner = "Mingla-LLC";
    this.repo = "mingla-main";
    this.fullName = "Mingla-LLC/mingla-main";
    this.mainSha = SOURCE;
    this.mainReads = [];
    this.refs = new Map();
    this.commits = new Map();
    this.contents = new Map();
    this.pulls = [];
    this.events = [];
    this.nextPull = 80;
    this.generatedSha = GENERATED;
    this.ancestors = new Set([`${PREVIOUS}:${SOURCE}`, `${SOURCE}:${NEXT}`]);
  }

  async getMainSha() {
    const value = this.mainReads.length ? this.mainReads.shift() : this.mainSha;
    this.events.push(`read-main:${value}`);
    return value;
  }

  async getRef(branch) { return this.refs.get(branch) ?? null; }
  async listManagedRefs() { return [...this.refs.values()]; }
  async createBlob(content) { this.pendingContent = content; this.events.push("create-blob"); return { sha: "1".repeat(40) }; }
  async getGitCommit() { return { tree: { sha: "2".repeat(40) } }; }
  async createTree() { this.events.push("create-tree"); return { sha: "3".repeat(40) }; }
  async createCommit({ message, parentSha }) {
    this.events.push("create-commit");
    this.commits.set(this.generatedSha, {
      sha: this.generatedSha,
      parents: [{ sha: parentSha }],
      author: { login: ACTOR },
      committer: { login: ACTOR },
      commit: { message },
    });
    this.contents.set(this.generatedSha, this.pendingContent);
    return { sha: this.generatedSha };
  }

  async createRef(branch, sha) {
    this.events.push(`create-ref:${branch}`);
    if (this.refs.has(branch)) {
      throw new HandoffError("REST_FAILURE", "ref exists", { status: 422 });
    }
    const ref = { ref: `refs/heads/${branch}`, object: { sha } };
    this.refs.set(branch, ref);
    return ref;
  }

  async deleteRef(branch) {
    this.events.push(`delete-ref:${branch}`);
    this.refs.delete(branch);
  }

  async listPulls(state = "open") {
    return this.pulls.filter((pull) => state === "all" || pull.state === state);
  }

  async getPull(number) { return this.pulls.find((pull) => pull.number === number); }
  async getPullFiles(number) {
    const pull = await this.getPull(number);
    return pull.files ?? [{ filename: BASELINE_PATH }];
  }

  async createPull({ title, body, branch }) {
    this.events.push(`create-pr:${branch}`);
    const ref = this.refs.get(branch);
    const source = branch.slice(BRANCH_PREFIX.length);
    const pull = {
      number: this.nextPull++,
      state: "open",
      html_url: "https://example.test/pull/generated",
      title,
      body,
      user: { login: ACTOR },
      head: { ref: branch, sha: ref.object.sha, repo: { full_name: this.fullName } },
      base: { ref: "main", sha: source, repo: { full_name: this.fullName } },
      files: [{ filename: BASELINE_PATH }],
    };
    this.pulls.push(pull);
    return pull;
  }

  async closePull(number) {
    this.events.push(`close-pr:${number}`);
    const pull = await this.getPull(number);
    pull.state = "closed";
    return pull;
  }

  async getCommit(sha) { return this.commits.get(sha); }
  async getContent(_path, ref) {
    return { encoding: "base64", content: Buffer.from(this.contents.get(ref)).toString("base64") };
  }

  async compare(base, head) {
    if (this.commits.has(head) && this.commits.get(head).parents[0].sha === base) {
      return {
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        merge_base_commit: { sha: base },
        files: [{ filename: BASELINE_PATH }],
      };
    }
    if (this.ancestors.has(`${base}:${head}`)) {
      return { status: "ahead", ahead_by: 1, behind_by: 0, merge_base_commit: { sha: base }, files: [] };
    }
    if (base === head) {
      return { status: "identical", ahead_by: 0, behind_by: 0, merge_base_commit: { sha: base }, files: [] };
    }
    return { status: "diverged", ahead_by: 1, behind_by: 1, merge_base_commit: { sha: "f".repeat(40) }, files: [] };
  }

  addArtifact({ source = SOURCE, head = GENERATED, state = "open", number = 70, actor = ACTOR, branch = `${BRANCH_PREFIX}${source}` } = {}) {
    this.refs.set(branch, { ref: `refs/heads/${branch}`, object: { sha: head } });
    this.commits.set(head, {
      sha: head,
      parents: [{ sha: source }],
      author: { login: actor },
      committer: { login: actor },
      commit: { message: `Measured\n\nMeasured from ${source} by .github/workflows/bundle-baseline-ratchet.yml.\nBaseline only — no limit was changed.` },
    });
    this.contents.set(head, baseline(source));
    const pull = {
      number,
      state,
      html_url: `https://example.test/pull/${number}`,
      user: { login: actor },
      head: { ref: branch, sha: head, repo: { full_name: this.fullName } },
      base: { ref: "main", sha: source, repo: { full_name: this.fullName } },
      files: [{ filename: BASELINE_PATH }],
    };
    this.pulls.push(pull);
    return pull;
  }
}

describe("#2058 handoff state machine", () => {
  test("current changed main creates one immutable full-SHA ref and one REST PR", async () => {
    const api = new FakeApi();
    const result = await runHandoff(api, options());
    assert.equal(result.state, "CREATE");
    assert.equal(result.branch, `${BRANCH_PREFIX}${SOURCE}`);
    assert.equal(api.pulls.length, 1);
    assert.equal(api.pulls[0].head.ref, `${BRANCH_PREFIX}${SOURCE}`);
    assert.equal(api.pulls[0].head.sha, GENERATED);
    assert.ok(api.events.indexOf("create-commit") < api.events.indexOf(`create-ref:${result.branch}`));
    assert.ok(api.events.indexOf(`create-ref:${result.branch}`) < api.events.indexOf(`create-pr:${result.branch}`));
  });

  test("a valid branch-only orphan is deleted and trusted-recreated, never adopted", async () => {
    const api = new FakeApi();
    api.addArtifact({ state: "closed" });
    api.pulls = [];
    const result = await runHandoff(api, options());
    assert.equal(result.state, "RECREATE_ORPHAN");
    assert.equal(result.recreatedOrphan, true);
    const deletion = api.events.indexOf(`delete-ref:${BRANCH_PREFIX}${SOURCE}`);
    const creation = api.events.indexOf(`create-ref:${BRANCH_PREFIX}${SOURCE}`);
    const pull = api.events.indexOf(`create-pr:${BRANCH_PREFIX}${SOURCE}`);
    assert.ok(deletion >= 0 && deletion < creation && creation < pull);
  });

  test("a competing ref between delete and create loses closed without PR adoption", async () => {
    const api = new FakeApi();
    api.addArtifact({ state: "closed" });
    api.pulls = [];
    const realCreate = api.createRef.bind(api);
    api.createRef = async (branch, sha) => {
      api.refs.set(branch, { object: { sha: "e".repeat(40) } });
      return realCreate(branch, sha);
    };
    await assert.rejects(() => runHandoff(api, options()), (error) => error.code === "COLLISION");
    assert.equal(api.events.some((event) => event.startsWith("create-pr:")), false);
  });

  test("a PR appearing during orphan validation prevents deletion", async () => {
    const api = new FakeApi();
    api.addArtifact({ state: "closed" });
    api.pulls = [];
    const realList = api.listPulls.bind(api);
    let allReads = 0;
    api.listPulls = async (state) => {
      if (state === "all" && ++allReads === 2) api.addArtifact({ number: 55 });
      return realList(state);
    };
    await assert.rejects(() => runHandoff(api, options()), (error) => error.code === "COLLISION");
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${SOURCE}`), true);
    assert.equal(api.events.some((event) => event.startsWith("delete-ref:")), false);
  });

  test("a mismatched reserved orphan fails closed without deletion", async () => {
    const api = new FakeApi();
    api.addArtifact({ state: "closed", actor: "spoofed-writer" });
    api.pulls = [];
    await assert.rejects(() => runHandoff(api, options()), (error) => error.code === "PROVENANCE_MISMATCH");
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${SOURCE}`), true);
    assert.equal(api.events.some((event) => event.startsWith("delete-ref:")), false);
  });

  test("an exact valid current PR is reused idempotently", async () => {
    const api = new FakeApi();
    const pull = api.addArtifact();
    const result = await runHandoff(api, options());
    assert.equal(result.state, "REUSE");
    assert.equal(result.prUrl, pull.html_url);
    assert.equal(api.events.some((event) => event.startsWith("create-pr:")), false);
  });

  test("a current-source PR with a different measured payload is a collision, not a reuse", async () => {
    const api = new FakeApi();
    api.addArtifact();
    const different = JSON.parse(baseline());
    different.common.raw = 999;
    await assert.rejects(
      () => runHandoff(api, options({ baselineContent: `${JSON.stringify(different, null, 2)}\n` })),
      (error) => error.code === "COLLISION",
    );
    assert.equal(api.events.some((event) => event.startsWith("create-pr:")), false);
  });

  test("an invalid trusted baseline fails before orphan cleanup or any other write", async () => {
    const api = new FakeApi();
    api.addArtifact({ state: "closed" });
    api.pulls = [];
    await assert.rejects(
      () => runHandoff(api, options({ baselineContent: "not json" })),
      (error) => error.code === "INVALID_INPUT",
    );
    assert.equal(api.events.length, 0);
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${SOURCE}`), true);
  });

  test("no movement makes no git object, ref or PR write", async () => {
    const api = new FakeApi();
    const result = await runHandoff(api, options({ changed: false }));
    assert.equal(result.state, "NO_CHANGE");
    assert.deepEqual(api.events.filter((event) => /create-(blob|tree|commit|ref|pr)/.test(event)), []);
  });

  test("no movement closes a fully proven ancestor PR without inventing a current PR", async () => {
    const api = new FakeApi();
    api.addArtifact({ source: PREVIOUS, head: "3".repeat(40), number: 43 });
    const result = await runHandoff(api, options({ changed: false }));
    assert.equal(result.state, "NO_CHANGE");
    assert.deepEqual(result.closed, [43]);
    assert.equal(api.events.some((event) => event.startsWith("create-pr:")), false);
  });

  test("a main advance before the first write is SUPERSEDED", async () => {
    const api = new FakeApi();
    api.mainSha = NEXT;
    const result = await runHandoff(api, options());
    assert.equal(result.state, "SUPERSEDED");
    assert.equal(api.events.some((event) => event.startsWith("create-ref:")), false);
  });

  test("a mismatched minted App identity fails before the first shared write", async () => {
    const api = new FakeApi();
    await assert.rejects(
      () => runHandoff(api, options({ tokenAppSlug: "wrong-app" })),
      (error) => error.code === "INVALID_CREDENTIAL_CONFIG",
    );
    assert.equal(api.events.length, 0);
  });

  test("a closed exact-current PR is never treated as an orphan", async () => {
    const api = new FakeApi();
    const pull = api.addArtifact({ state: "closed", number: 41 });
    await assert.rejects(() => runHandoff(api, options()), (error) => error.code === "COLLISION");
    assert.equal(pull.state, "closed");
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${SOURCE}`), true);
    assert.equal(api.events.some((event) => event.startsWith("delete-ref:")), false);
  });

  test("main advancing immediately after ref creation compensates only that exact ref", async () => {
    const api = new FakeApi();
    api.mainReads = [SOURCE, SOURCE, SOURCE, NEXT, NEXT];
    api.mainSha = NEXT;
    const result = await runHandoff(api, options());
    assert.equal(result.state, "STALE_AFTER_WRITE");
    assert.deepEqual(result.deleted, [`${BRANCH_PREFIX}${SOURCE}`]);
    assert.equal(api.pulls.length, 0);
  });

  test("main advancing immediately before ref creation writes no ref or PR", async () => {
    const api = new FakeApi();
    api.mainReads = [SOURCE, SOURCE, NEXT];
    api.mainSha = NEXT;
    const result = await runHandoff(api, options());
    assert.equal(result.state, "SUPERSEDED");
    assert.equal(api.events.some((event) => event.startsWith("create-ref:")), false);
    assert.equal(api.events.some((event) => event.startsWith("create-pr:")), false);
  });

  test("main advancing immediately before PR creation compensates the exact ref without a PR", async () => {
    const api = new FakeApi();
    api.mainReads = [SOURCE, SOURCE, SOURCE, SOURCE, NEXT, NEXT];
    api.mainSha = NEXT;
    const result = await runHandoff(api, options());
    assert.equal(result.state, "STALE_AFTER_WRITE");
    assert.deepEqual(result.deleted, [`${BRANCH_PREFIX}${SOURCE}`]);
    assert.equal(api.events.some((event) => event.startsWith("create-pr:")), false);
  });

  test("main advancing immediately after PR creation closes and deletes only its own artifact", async () => {
    const api = new FakeApi();
    api.mainReads = [SOURCE, SOURCE, SOURCE, SOURCE, SOURCE, NEXT, NEXT, NEXT];
    api.mainSha = NEXT;
    const result = await runHandoff(api, options());
    assert.equal(result.state, "STALE_AFTER_WRITE");
    assert.deepEqual(result.closed, [80]);
    assert.deepEqual(result.deleted, [`${BRANCH_PREFIX}${SOURCE}`]);
    assert.equal(api.pulls[0].state, "closed");
  });

  test("a PR-create REST failure leaves predecessors untouched and the next run recreates the orphan", async () => {
    const api = new FakeApi();
    const predecessor = api.addArtifact({ source: PREVIOUS, head: "2".repeat(40), number: 40 });
    const realCreatePull = api.createPull.bind(api);
    api.createPull = async () => {
      throw new HandoffError("REST_FAILURE", "simulated create failure", { status: 503 });
    };
    await assert.rejects(() => runHandoff(api, options()), (error) => error.code === "REST_FAILURE");
    assert.equal(predecessor.state, "open");
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${SOURCE}`), true);

    api.createPull = realCreatePull;
    const result = await runHandoff(api, options());
    assert.equal(result.state, "RECREATE_ORPHAN");
    assert.deepEqual(result.closed, [40]);
  });

  test("a later all-main run removes a proven ancestor ref left by cancellation", async () => {
    const api = new FakeApi();
    api.addArtifact({ source: PREVIOUS, head: "0".repeat(40), number: 39 });
    api.pulls = [];
    const result = await runHandoff(api, options());
    assert.equal(result.state, "CREATE");
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${PREVIOUS}`), false);
    assert.ok(result.deleted.includes(`${BRANCH_PREFIX}${PREVIOUS}`));
  });

  test("legacy seven-character refs stay quarantined for enumerated cleanup", async () => {
    const api = new FakeApi();
    const legacy = "bundle-baseline/abcdef0";
    api.refs.set(legacy, { ref: `refs/heads/${legacy}`, object: { sha: "f".repeat(40) } });
    const result = await runHandoff(api, options());
    assert.equal(result.state, "CREATE");
    assert.equal(api.refs.has(legacy), true);
    assert.deepEqual(result.untouched, [{ branch: legacy, reason: "quarantined-legacy-ref" }]);
  });

  test("current success closes and deletes only a proven strict-ancestor predecessor", async () => {
    const api = new FakeApi();
    const predecessor = api.addArtifact({ source: PREVIOUS, head: "9".repeat(40), number: 44 });
    const result = await runHandoff(api, options());
    assert.equal(result.state, "CREATE");
    assert.deepEqual(result.closed, [44]);
    assert.equal(predecessor.state, "closed");
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${PREVIOUS}`), false);
  });

  test("a divergent managed PR is untouched and fails closed", async () => {
    const api = new FakeApi();
    const other = "8".repeat(40);
    const pull = api.addArtifact({ source: other, head: "7".repeat(40), number: 45 });
    await assert.rejects(() => runHandoff(api, options()), (error) => error.code === "COLLISION");
    assert.equal(pull.state, "open");
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${other}`), true);
  });

  test("a descendant managed PR with a deceptively smaller PR number is untouched", async () => {
    const api = new FakeApi();
    const descendant = NEXT;
    const pull = api.addArtifact({ source: descendant, head: "5".repeat(40), number: 1 });
    await assert.rejects(() => runHandoff(api, options()), (error) => error.code === "COLLISION");
    assert.equal(pull.state, "open");
    assert.equal(api.events.includes("close-pr:1"), false);
  });

  test("a legacy or otherwise malformed managed PR is untouched and fails closed", async () => {
    for (const branch of ["bundle-baseline/abcdef0", "bundle-baseline/main-not-a-sha"]) {
      const api = new FakeApi();
      api.pulls.push({
        number: 4,
        state: "open",
        user: { login: ACTOR },
        head: { ref: branch, sha: "4".repeat(40), repo: { full_name: api.fullName } },
        base: { ref: "main", sha: SOURCE, repo: { full_name: api.fullName } },
      });
      await assert.rejects(() => runHandoff(api, options()), (error) => error.code === "COLLISION");
      assert.equal(api.pulls[0].state, "open");
    }
  });

  test("unverifiable ancestry blocks stale compensation and leaves the exact ref for review", async () => {
    const api = new FakeApi();
    api.ancestors.delete(`${SOURCE}:${NEXT}`);
    api.mainReads = [SOURCE, SOURCE, SOURCE, NEXT];
    api.mainSha = NEXT;
    await assert.rejects(
      () => runHandoff(api, options()),
      (error) => error.code === "STALE_COMPENSATION_BLOCKED",
    );
    assert.equal(api.refs.has(`${BRANCH_PREFIX}${SOURCE}`), true);
    assert.equal(api.events.some((event) => event.startsWith("create-pr:")), false);
  });

  test("a main advance during reconciliation halts the batch", async () => {
    const api = new FakeApi();
    api.addArtifact({ source: PREVIOUS, head: "6".repeat(40), number: 46 });
    // Reads: initial, pre-object, pre-ref, post-ref, pre-PR, post-PR,
    // reconciliation-batch, before-close. Advance at before-close.
    api.mainReads = [SOURCE, SOURCE, SOURCE, SOURCE, SOURCE, SOURCE, SOURCE, NEXT];
    api.mainSha = NEXT;
    const result = await runHandoff(api, options());
    assert.equal(result.state, "STALE_AFTER_WRITE");
    assert.equal(api.pulls.find((pull) => pull.number === 46).state, "open");
  });
});

describe("#2058 read-only provenance verifier", () => {
  test("ordinary PRs pass without baseline-specific restrictions", async () => {
    const api = new FakeApi();
    api.pulls.push({
      number: 1,
      head: { ref: "feature", repo: { full_name: api.fullName } },
      base: { ref: "main", repo: { full_name: api.fullName } },
      files: [{ filename: "README.md" }],
    });
    assert.deepEqual(await verifyPullRequest(api, { pullNumber: 1, expectedAppSlug: SLUG }), {
      state: "ORDINARY_PR",
      pullNumber: 1,
    });
  });

  test("a current App-authored baseline-only PR with final grammar passes", async () => {
    const api = new FakeApi();
    const pull = api.addArtifact({ number: 2 });
    pull.base.sha = SOURCE;
    const result = await verifyPullRequest(api, { pullNumber: 2, expectedAppSlug: SLUG });
    assert.equal(result.state, "VALID_GENERATED_PR");
    assert.equal(result.sourceSha, SOURCE);
  });

  test("extra files, stale source, wrong actor and abbreviated grammar fail closed", async () => {
    for (const mutation of [
      (api, pull) => pull.files.push({ filename: "README.md" }),
      (api) => { api.mainSha = NEXT; },
      (api, pull) => { pull.user.login = "human"; },
      (api, pull) => { pull.head.ref = "bundle-baseline/main-abcdef0"; },
    ]) {
      const api = new FakeApi();
      const pull = api.addArtifact({ number: 3 });
      mutation(api, pull);
      await assert.rejects(() => verifyPullRequest(api, { pullNumber: 3, expectedAppSlug: SLUG }));
    }
  });
});

describe("#2058 workflow trust boundary", () => {
  const ratchet = readFileSync(join(ROOT, ".github/workflows/bundle-baseline-ratchet.yml"), "utf8");
  const guard = readFileSync(join(ROOT, ".github/workflows/bundle-baseline-provenance-guard.yml"), "utf8");
  const tests = readFileSync(join(ROOT, ".github/workflows/issue-2058-bundle-baseline-handoff-tests.yml"), "utf8");
  const helper = readFileSync(join(ROOT, "mingla-business/scripts/ci/bundle-baseline-pr-handoff.mjs"), "utf8");

  test("all main pushes run the ratchet and the built-in token is read-only", () => {
    const pushBlock = ratchet.slice(ratchet.indexOf("push:"), ratchet.indexOf("workflow_dispatch:"));
    assert.doesNotMatch(pushBlock, /paths(?:-ignore)?:/);
    assert.match(ratchet, /permissions:\n  contents: read/);
    assert.doesNotMatch(ratchet, /permissions:\n(?:.*\n)*?  (?:contents|pull-requests): write/);
    assert.doesNotMatch(ratchet, /secrets\.GITHUB_TOKEN/);
  });

  test("the App token is repository-only and exactly contents + pulls write", () => {
    assert.match(ratchet, /actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1/);
    assert.match(ratchet, /client-id: \$\{\{ vars\.BUNDLE_BASELINE_APP_CLIENT_ID \}\}/);
    assert.match(ratchet, /BUNDLE_BASELINE_TOKEN_APP_SLUG: \$\{\{ steps\.app-token\.outputs\.app-slug \}\}/);
    assert.match(ratchet, /owner: Mingla-LLC/);
    assert.match(ratchet, /repositories: mingla-main/);
    assert.match(ratchet, /permission-contents: write/);
    assert.match(ratchet, /permission-pull-requests: write/);
    assert.doesNotMatch(ratchet, /permission-(?:actions|administration|checks|workflows|issues|statuses|deployments):/);
    assert.throws(
      () => makeRestAdapter({ token: "", owner: "Mingla-LLC", repo: "mingla-main" }),
      (error) => error.code === "INVALID_CREDENTIAL_CONFIG",
    );
  });

  test("every external action in the #2058 trust boundary has a full-SHA pin", () => {
    for (const [name, source] of [["ratchet", ratchet], ["guard", guard], ["tests", tests]]) {
      const uses = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
      assert.ok(uses.length > 0, `${name} must contain at least one action`);
      for (const value of uses) {
        if (value.startsWith("./")) continue;
        assert.match(value, /^[^@\s]+@[0-9a-f]{40}$/, `${name}: ${value} is not full-SHA pinned`);
      }
    }
  });

  test("the provenance job is trusted-code, read-only, App-secret-free and never checks out the head", () => {
    assert.match(guard, /pull_request_target:/);
    assert.match(guard, /permissions:\n  contents: read\n  pull-requests: read/);
    assert.match(guard, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
    assert.doesNotMatch(guard, /pull_request\.head\.(?:ref|sha)/);
    assert.doesNotMatch(guard, /BUNDLE_BASELINE_APP_(?:PRIVATE_KEY|TOKEN|CLIENT_ID)/);
    assert.doesNotMatch(guard, /permissions:[\s\S]*?\bwrite\b/);
  });

  test("the old push/GraphQL handoff and forbidden elevated operations cannot return", () => {
    const production = `${ratchet}\n${guard}\n${helper}`;
    assert.doesNotMatch(production, /gh\s+pr\s+create/);
    assert.doesNotMatch(production, /gh\s+pr\s+(?:merge|review)/);
    assert.doesNotMatch(production, /git\s+push[^\n]*(?:--force|-f\b)/);
    assert.doesNotMatch(helper, /request\("(?:PUT|POST)",\s*`?\/pulls\/[^\n]*(?:merge|reviews)/);
    assert.doesNotMatch(helper, /auto_merge\s*:/);
    assert.doesNotMatch(helper, /createOrUpdateRef|updateRef/);
    assert.doesNotMatch(helper, /deleteRef\([^)]*[*?]/);
  });

  test("the final ref grammar is main plus full SHA; bare and abbreviated forms are absent", () => {
    assert.match(helper, /bundle-baseline\/main-/);
    assert.match(helper, /\[0-9a-f\]\{40\}/);
    assert.doesNotMatch(ratchet, /GITHUB_SHA::7/);
    assert.doesNotMatch(ratchet, /bundle-baseline\/\$\{?GITHUB_SHA/);
  });

  test("staged rollout proof requires an active no-bypass non-fast-forward prefix boundary", () => {
    const valid = {
      stage: "before-general-exclusion",
      prefixRuleset: {
        enforcement: "active",
        bypass_actors: [],
        conditions: { ref_name: { include: ["refs/heads/bundle-baseline/*"] } },
        rules: [{ type: "non_fast_forward" }],
      },
      generalSecurityRuleset: { conditions: { ref_name: { exclude: [] } } },
    };
    assert.equal(verifyRolloutEvidence(valid, { expectedAppSlug: SLUG }).state, "ROLLOUT_EVIDENCE_VALID");
    for (const mutate of [
      (copy) => { copy.prefixRuleset.enforcement = "disabled"; },
      (copy) => { copy.prefixRuleset.bypass_actors.push({ actor_type: "OrganizationAdmin" }); },
      (copy) => { copy.prefixRuleset.rules = []; },
      (copy) => { copy.prefixRuleset.rules.push({ type: "deletion" }); },
      (copy) => { copy.generalSecurityRuleset.conditions.ref_name.exclude.push("refs/heads/bundle-baseline/*"); },
    ]) {
      const copy = structuredClone(valid);
      mutate(copy);
      assert.throws(
        () => verifyRolloutEvidence(copy, { expectedAppSlug: SLUG }),
        (error) => error.code === "ROLLOUT_EVIDENCE_INVALID",
      );
    }
  });

  test("required-context activation rejects ordinary-only, manual, API-posted and wrong-grammar evidence", () => {
    const valid = {
      stage: "before-required-context",
      requiredContextActive: false,
      prefixRuleset: {
        enforcement: "active",
        bypass_actors: [],
        conditions: { ref_name: { include: ["refs/heads/bundle-baseline/*"] } },
        rules: [{ type: "non_fast_forward" }],
      },
      generalSecurityRuleset: {
        conditions: { ref_name: { exclude: ["refs/heads/bundle-baseline/*"] } },
      },
      ordinaryDelivery: {
        event: "pull_request_target",
        producer: "workflow-run",
        workflowRunId: 100,
        checkName: "Bundle baseline provenance guard",
        conclusion: "success",
        trustedWorkflowSha: SOURCE,
        headSha: "1".repeat(40),
        headRef: "2058-bundle-baseline-pr-handoff",
      },
      generatedDelivery: {
        event: "pull_request_target",
        producer: "workflow-run",
        workflowRunId: 101,
        checkName: "Bundle baseline provenance guard",
        conclusion: "success",
        trustedWorkflowSha: SOURCE,
        headSha: GENERATED,
        headRef: `${BRANCH_PREFIX}${SOURCE}`,
        author: ACTOR,
        sourceSha: SOURCE,
        baseSha: SOURCE,
        liveMainSha: SOURCE,
      },
    };
    assert.equal(verifyRolloutEvidence(valid, { expectedAppSlug: SLUG }).state, "ROLLOUT_EVIDENCE_VALID");
    for (const mutate of [
      (copy) => { copy.generatedDelivery = structuredClone(copy.ordinaryDelivery); },
      (copy) => { copy.generatedDelivery.event = "pull_request"; },
      (copy) => { copy.generatedDelivery.producer = "api-posted-check"; },
      (copy) => { copy.generatedDelivery.headRef = "bundle-baseline/abcdef0"; },
      (copy) => { copy.generatedDelivery.author = "human"; },
      (copy) => { copy.requiredContextActive = true; },
    ]) {
      const copy = structuredClone(valid);
      mutate(copy);
      assert.throws(() => verifyRolloutEvidence(copy, { expectedAppSlug: SLUG }));
    }
  });
});
