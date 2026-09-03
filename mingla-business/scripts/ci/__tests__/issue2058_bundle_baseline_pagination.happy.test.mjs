/**
 * Issue #3096 implementor regression suite — the repository outgrew the scan.
 *
 * The #2058 suites drive the state machine through a hand-written fake adapter,
 * so they never touch `paged()` and could not see this. The defect lived in the
 * REST adapter: four `state: "all"` call sites enumerated the repository's whole
 * pull-request history to find a handful of `bundle-baseline/<sha>` branches,
 * and `paged()` refuses past 20 pages. On 2026-09-03 the repository crossed
 * 2,000 pull requests and every post-main ratchet run began failing closed with
 * PAGINATION_LIMIT, so the baseline could no longer re-bank.
 *
 * These cases therefore build the REAL adapter over a fake `fetch` that serves a
 * repository LARGER than the cap. T-2 pins the fixture as genuinely past the cap
 * so none of this can pass vacuously, and T-3 pins the cap itself as intact.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_PATH,
  BRANCH_PREFIX,
  HandoffError,
  makeRestAdapter,
  runHandoff,
} from "../bundle-baseline-pr-handoff.mjs";

const OWNER = "Mingla-LLC";
const REPO = "mingla-main";
const FULL = `${OWNER}/${REPO}`;
const TOKEN = "x".repeat(40);
const SLUG = "mingla-bundle-baseline";
const ACTOR = `${SLUG}[bot]`;
const SOURCE = "a".repeat(40);
const PREVIOUS = "b".repeat(40);
const GENERATED = "d".repeat(40);
const PREV_HEAD = "e".repeat(40);

/** Comfortably past the 20-page / 2,000-record cap the live repository crossed. */
const HISTORY_SIZE = 2600;

function baselineJson(source) {
  return JSON.stringify({
    measuredOn: { commit: source },
    common: { raw: 1, gzip: 1, brotli: 1 },
    eager: { raw: 1, gzip: 1, brotli: 1 },
  }, null, 2) + "\n";
}

function marker(source) {
  return `Measured from ${source} by .github/workflows/bundle-baseline-ratchet` + ".y" + "ml.";
}

function managedPull(number, branch, headSha, state) {
  return {
    number,
    state,
    html_url: `https://example.test/pull/${number}`,
    user: { login: ACTOR },
    head: { ref: branch, sha: headSha, repo: { full_name: FULL } },
    base: { ref: "main", sha: branch.slice(BRANCH_PREFIX.length), repo: { full_name: FULL } },
    changed_files: 1,
  };
}

/**
 * A repository whose pull-request history is larger than the cap. Ordinary
 * pulls are inert padding; only the managed ones are ever asked for by branch.
 */
class FakeGitHub {
  constructor({ pulls = [], refs = new Map(), managedRefCount = null, openEvery = 200 } = {}) {
    this.mainSha = SOURCE;
    this.mainReads = [];
    this.refs = refs;
    this.managedRefCount = managedRefCount;
    this.requests = [];
    this.pulls = [];
    for (let i = 1; i <= HISTORY_SIZE; i += 1) {
      this.pulls.push({
        number: i,
        state: i % openEvery === 0 ? "open" : "closed",
        html_url: `https://example.test/pull/${i}`,
        user: { login: "someone" },
        head: { ref: `feature/pr-${i}`, sha: `${i}`.padStart(40, "f"), repo: { full_name: FULL } },
        base: { ref: "main", sha: SOURCE, repo: { full_name: FULL } },
        changed_files: 3,
      });
    }
    this.pulls.push(...pulls);
    this.nextPull = HISTORY_SIZE + 500;
  }

  get fetchImpl() {
    return async (rawUrl, init = {}) => {
      const method = init.method ?? "GET";
      const url = new URL(rawUrl);
      this.requests.push(`${method} ${url.pathname}${url.search}`);
      const body = init.body ? JSON.parse(init.body) : undefined;
      const path = url.pathname.replace(`/repos/${OWNER}/${REPO}`, "");
      return this.route(method, path, url, body);
    };
  }

  json(status, payload) {
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => (payload === null ? "" : JSON.stringify(payload)),
    };
  }

  route(method, path, url, body) {
    const q = url.searchParams;

    if (decodeURIComponent(url.pathname) === `/users/${ACTOR}`) {
      return this.json(200, { login: ACTOR, type: "Bot", id: 42 });
    }

    if (method === "GET" && path === "/pulls") {
      const state = q.get("state");
      const head = q.get("head");
      const page = Number(q.get("page"));
      const perPage = Number(q.get("per_page"));
      let rows = this.pulls;
      if (state !== "all") rows = rows.filter((pull) => pull.state === state);
      if (head !== null) {
        // Exactly what GitHub's `head=<owner>:<branch>` filter does.
        const [owner, ...rest] = head.split(":");
        const ref = rest.join(":");
        rows = rows.filter((pull) =>
          pull.head.repo.full_name.split("/")[0] === owner && pull.head.ref === ref);
      }
      return this.json(200, rows.slice((page - 1) * perPage, page * perPage));
    }

    if (method === "POST" && path === "/pulls") {
      const ref = this.refs.get(body.head);
      const pull = managedPull(this.nextPull++, body.head, ref.object.sha, "open");
      this.pulls.push(pull);
      return this.json(201, pull);
    }

    if (method === "PATCH" && /^\/pulls\/\d+$/.test(path)) {
      const pull = this.pulls.find((row) => row.number === Number(path.split("/")[2]));
      pull.state = body.state;
      return this.json(200, pull);
    }

    if (method === "GET" && path === "/git/ref/heads/main") {
      const sha = this.mainReads.length ? this.mainReads.shift() : this.mainSha;
      return this.json(200, { ref: "refs/heads/main", object: { sha } });
    }

    if (method === "GET" && path.startsWith("/git/ref/heads/")) {
      const branch = decodeURIComponent(path.slice("/git/ref/heads/".length).replace(/%2F/gi, "/"));
      const ref = this.refs.get(branch);
      return ref ? this.json(200, ref) : this.json(404, { message: "Not Found" });
    }

    if (method === "GET" && path === "/git/matching-refs/heads/bundle-baseline/") {
      if (this.managedRefCount !== null) {
        const page = Number(q.get("page"));
        const perPage = Number(q.get("per_page"));
        const all = Array.from({ length: this.managedRefCount }, (_unused, i) => ({
          ref: `refs/heads/${BRANCH_PREFIX}${`${i}`.padStart(40, "0")}`,
          object: { sha: `${i}`.padStart(40, "0") },
        }));
        return this.json(200, all.slice((page - 1) * perPage, page * perPage));
      }
      return this.json(200, [...this.refs.entries()]
        .filter(([branch]) => branch.startsWith("bundle-baseline/"))
        .map(([, ref]) => ref));
    }

    if (method === "POST" && path === "/git/refs") {
      const branch = body.ref.replace(/^refs\/heads\//, "");
      if (this.refs.has(branch)) return this.json(422, { message: "Reference already exists" });
      const ref = { ref: body.ref, object: { sha: body.sha } };
      this.refs.set(branch, ref);
      return this.json(201, ref);
    }

    if (method === "DELETE" && path.startsWith("/git/refs/heads/")) {
      const branch = decodeURIComponent(path.slice("/git/refs/heads/".length).replace(/%2F/gi, "/"));
      this.refs.delete(branch);
      return this.json(204, null);
    }

    if (method === "POST" && path === "/git/blobs") {
      this.blobContent = body.content;
      return this.json(201, { sha: "1".repeat(40) });
    }
    if (method === "POST" && path === "/git/trees") return this.json(201, { sha: "3".repeat(40) });
    if (method === "GET" && path.startsWith("/git/commits/")) {
      return this.json(200, { tree: { sha: "2".repeat(40) } });
    }
    if (method === "POST" && path === "/git/commits") {
      return this.json(201, { sha: GENERATED });
    }

    if (method === "GET" && path.startsWith("/commits/")) {
      const sha = path.slice("/commits/".length);
      const source = sha === PREV_HEAD ? PREVIOUS : SOURCE;
      return this.json(200, {
        sha,
        parents: [{ sha: source }],
        author: { login: ACTOR },
        committer: { login: ACTOR },
        commit: { message: `Bank\n\n${marker(source)}\nBaseline only — no limit was changed.` },
      });
    }

    if (method === "GET" && path.startsWith("/compare/")) {
      const [base, head] = path.slice("/compare/".length).split("...");
      const generated = head === GENERATED || head === PREV_HEAD;
      return this.json(200, {
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        merge_base_commit: { sha: base },
        files: generated ? [{ filename: BASELINE_PATH }] : [],
      });
    }

    if (method === "GET" && path.startsWith("/contents/")) {
      const source = q.get("ref") === PREV_HEAD ? PREVIOUS : SOURCE;
      return this.json(200, {
        encoding: "base64",
        content: Buffer.from(baselineJson(source), "utf8").toString("base64"),
      });
    }

    return this.json(500, { message: `unrouted ${method} ${path}` });
  }

  adapter() {
    return makeRestAdapter({ token: TOKEN, owner: OWNER, repo: REPO, fetchImpl: this.fetchImpl });
  }

  pullRequests() {
    return this.requests.filter((line) => line.includes("/pulls?"));
  }
}

function handoffOptions(overrides = {}) {
  return {
    sourceSha: SOURCE,
    changed: true,
    baselineContent: baselineJson(SOURCE),
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

describe("#3096 the handoff outlives 2,000 pull requests", () => {
  test("T-1: a repository past the cap hands off instead of failing PAGINATION_LIMIT", async () => {
    const github = new FakeGitHub();
    const result = await runHandoff(github.adapter(), handoffOptions());

    assert.equal(result.state, "CREATE");
    assert.equal(result.branch, `${BRANCH_PREFIX}${SOURCE}`);
    assert.ok(result.prUrl, "a generated PR must exist");

    // The defect, stated as a property rather than a symptom: no request may ask
    // for the whole pull-request history. Every `state=all` read names a branch.
    const unbounded = github.pullRequests().filter((line) =>
      line.includes("state=all") && !line.includes("head="));
    assert.deepEqual(unbounded, [], "no state=all read may enumerate the repository");
  });

  test("T-2: the fixture really is past the cap — an unnarrowed scan still refuses", async () => {
    const github = new FakeGitHub();
    await assert.rejects(
      () => github.adapter().listPulls("all"),
      (error) => error instanceof HandoffError
        && error.code === "PAGINATION_LIMIT"
        && /2,000 records/.test(error.message),
    );
  });

  test("T-3: the cap is intact and still guards the readers that cannot be narrowed", async () => {
    const github = new FakeGitHub({ managedRefCount: 2500 });
    await assert.rejects(
      () => github.adapter().listManagedRefs(),
      (error) => error instanceof HandoffError && error.code === "PAGINATION_LIMIT",
    );
  });

  test("T-4: state=all is preserved — a CLOSED exact-source PR is still found", async () => {
    const branch = `${BRANCH_PREFIX}${SOURCE}`;
    const github = new FakeGitHub({ pulls: [managedPull(9001, branch, GENERATED, "closed")] });
    await assert.rejects(
      () => runHandoff(github.adapter(), handoffOptions()),
      (error) => error instanceof HandoffError
        && error.code === "COLLISION"
        && /closed PR already claims/.test(error.message),
    );
  });

  test("T-5: a proven predecessor is still reconciled across a history past the cap", async () => {
    const previousBranch = `${BRANCH_PREFIX}${PREVIOUS}`;
    const refs = new Map([[previousBranch, {
      ref: `refs/heads/${previousBranch}`,
      object: { sha: PREV_HEAD },
    }]]);
    const github = new FakeGitHub({
      refs,
      pulls: [managedPull(9002, previousBranch, PREV_HEAD, "closed")],
    });

    const result = await runHandoff(github.adapter(), handoffOptions());

    assert.equal(result.state, "CREATE");
    assert.deepEqual(result.deleted, [previousBranch]);
    assert.ok(result.ancestryProofs.includes(`${PREVIOUS}->${SOURCE}`));
    assert.deepEqual(
      github.pullRequests().filter((line) => line.includes("state=all") && !line.includes("head=")),
      [],
    );
  });

  test("T-6: the narrowed read costs one request per branch, not a walk of the history", async () => {
    const github = new FakeGitHub();
    await runHandoff(github.adapter(), handoffOptions());

    // Pre-fix a single `state=all` call site needed 21 requests just to fail,
    // and there were four of them. Each now costs exactly one.
    const stateAll = github.pullRequests().filter((line) => line.includes("state=all"));
    assert.ok(stateAll.length <= 2, `expected at most 2 state=all reads, saw ${stateAll.length}`);
    assert.ok(
      stateAll.every((line) => line.includes("&page=1") && !line.includes("&page=2")),
      "a narrowed read must resolve in its first page",
    );
    assert.ok(stateAll.some((line) =>
      line.includes(`head=${encodeURIComponent(`${OWNER}:${BRANCH_PREFIX}${SOURCE}`)}`)),
      "the exact reserved branch must be named to GitHub, not filtered locally");
  });

  test("T-7: the one read that must enumerate is unnarrowed BY DESIGN and still fails closed", async () => {
    // `reconcilePredecessors` discovers same-prefix open PRs whose branches it
    // does not know yet, and `head=` can only name an exact branch — so this
    // read is deliberately left enumerating and deliberately left capped. It is
    // nowhere near the cap in practice (open pull requests are few), but when it
    // does reach it, it must refuse rather than scan on.
    const github = new FakeGitHub({ openEvery: 1 });
    await assert.rejects(
      () => runHandoff(github.adapter(), handoffOptions()),
      (error) => error instanceof HandoffError
        && error.code === "PAGINATION_LIMIT"
        && /\/pulls\?state=open/.test(error.message),
    );
  });
});
