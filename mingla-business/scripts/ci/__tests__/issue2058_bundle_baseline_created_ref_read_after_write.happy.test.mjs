/**
 * Issue #3337 implementor regression suite — the handoff refused its own branch.
 *
 * On a405a4ce8 the post-main ratchet created `bundle-baseline/main-<sha>` and
 * then read it straight back. GitHub had not caught up with its own write, the
 * read-back did not show the ref, and the handoff threw
 * `[COLLISION] Created ref does not equal the trusted generated commit.` No PR
 * was opened and main stayed red until a re-run recovered through the orphan
 * path.
 *
 * The fix re-reads a ref that is NOT VISIBLE YET on a short bounded schedule,
 * and nothing else. These cases pin both halves of that:
 *   - lag (404, or a ref with no object SHA) is waited out and the PR opens;
 *   - a ref pointing at a different commit still fails closed on the first
 *     read, with no retry;
 *   - a ref still not visible after the last read fails closed, never success;
 *   - any other REST failure is not retried.
 *
 * Like the #3096 suite, these build the REAL REST adapter over a fake `fetch`,
 * so the 404 travels through the same `getRef` mapping production uses. The
 * sleep is injected and recorded, so nothing here actually waits.
 *
 * Named `issue2058_*` so the existing #2058 handoff lane (`node --test
 * scripts/ci/__tests__/issue2058_*.mjs`) runs it; no new lane exists for it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_PATH,
  BRANCH_PREFIX,
  CREATED_REF_READ_DELAYS_MS,
  HandoffError,
  makeRestAdapter,
  readBackCreatedRef,
  runHandoff,
} from "../bundle-baseline-pr-handoff.mjs";

const OWNER = "Mingla-LLC";
const REPO = "mingla-main";
const FULL = `${OWNER}/${REPO}`;
const TOKEN = "x".repeat(40);
const SLUG = "mingla-bundle-baseline";
const ACTOR = `${SLUG}[bot]`;
const SOURCE = "a".repeat(40);
const GENERATED = "d".repeat(40);
const INTRUDER = "e".repeat(40);
const BRANCH = `${BRANCH_PREFIX}${SOURCE}`;

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

/**
 * A small repository whose read of the managed branch lags its own creation.
 *
 *   lagReads     how many read-backs after POST /git/refs do not show the ref
 *   lagShape     "404" (GitHub's Not Found) or "no-sha" (a ref with no object SHA)
 *   liveSha      when set, what the managed branch reads as after creation
 *   readFailure  when set, the HTTP status every post-creation read returns
 */
class LaggingGitHub {
  constructor({ lagReads = 0, lagShape = "404", liveSha = null, readFailure = null, orphan = false } = {}) {
    this.mainSha = SOURCE;
    this.refs = new Map();
    this.pulls = [];
    this.nextPull = 900;
    this.lagReads = lagReads;
    this.lagShape = lagShape;
    this.liveSha = liveSha;
    this.readFailure = readFailure;
    this.created = false;
    this.readsAfterCreate = 0;
    this.requests = [];
    if (orphan) {
      this.refs.set(BRANCH, { ref: `refs/heads/${BRANCH}`, object: { sha: GENERATED } });
    }
  }

  get fetchImpl() {
    return async (rawUrl, init = {}) => {
      const method = init.method ?? "GET";
      const url = new URL(rawUrl);
      this.requests.push(`${method} ${decodeURIComponent(url.pathname)}`);
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

  readManagedBranch(branch) {
    const ref = this.refs.get(branch);
    if (branch !== BRANCH || !this.created) {
      return ref ? this.json(200, ref) : this.json(404, { message: "Not Found" });
    }
    this.readsAfterCreate += 1;
    if (this.readFailure !== null) {
      return this.json(this.readFailure, { message: "Server Error" });
    }
    if (this.lagReads > 0) {
      this.lagReads -= 1;
      return this.lagShape === "no-sha"
        ? this.json(200, { ref: `refs/heads/${branch}`, object: {} })
        : this.json(404, { message: "Not Found" });
    }
    if (this.liveSha !== null) {
      return this.json(200, { ref: `refs/heads/${branch}`, object: { sha: this.liveSha } });
    }
    return ref ? this.json(200, ref) : this.json(404, { message: "Not Found" });
  }

  route(method, path, url, body) {
    const q = url.searchParams;

    if (decodeURIComponent(url.pathname) === `/users/${ACTOR}`) {
      return this.json(200, { login: ACTOR, type: "Bot", id: 42 });
    }

    if (method === "GET" && path === "/git/ref/heads/main") {
      return this.json(200, { ref: "refs/heads/main", object: { sha: this.mainSha } });
    }
    if (method === "GET" && path.startsWith("/git/ref/heads/")) {
      return this.readManagedBranch(decodeURIComponent(path.slice("/git/ref/heads/".length)));
    }
    if (method === "GET" && path === "/git/matching-refs/heads/bundle-baseline/") {
      return this.json(200, [...this.refs.values()].slice((Number(q.get("page")) - 1) * 100, Number(q.get("page")) * 100));
    }
    if (method === "POST" && path === "/git/refs") {
      const branch = body.ref.replace(/^refs\/heads\//, "");
      if (this.refs.has(branch)) return this.json(422, { message: "Reference already exists" });
      const ref = { ref: body.ref, object: { sha: body.sha } };
      this.refs.set(branch, ref);
      if (branch === BRANCH) this.created = true;
      return this.json(201, ref);
    }
    if (method === "DELETE" && path.startsWith("/git/refs/heads/")) {
      this.refs.delete(decodeURIComponent(path.slice("/git/refs/heads/".length)));
      return this.json(204, null);
    }

    if (method === "GET" && path === "/pulls") {
      const head = q.get("head");
      let rows = this.pulls;
      if (q.get("state") !== "all") rows = rows.filter((pull) => pull.state === q.get("state"));
      if (head !== null) rows = rows.filter((pull) => `${OWNER}:${pull.head.ref}` === head);
      const page = Number(q.get("page"));
      return this.json(200, rows.slice((page - 1) * 100, page * 100));
    }
    if (method === "POST" && path === "/pulls") {
      const pull = {
        number: this.nextPull++,
        state: "open",
        html_url: "https://example.test/pull/generated",
        user: { login: ACTOR },
        head: { ref: body.head, sha: this.refs.get(body.head).object.sha, repo: { full_name: FULL } },
        base: { ref: "main", sha: SOURCE, repo: { full_name: FULL } },
        changed_files: 1,
      };
      this.pulls.push(pull);
      return this.json(201, pull);
    }

    if (method === "POST" && path === "/git/blobs") return this.json(201, { sha: "1".repeat(40) });
    if (method === "POST" && path === "/git/trees") return this.json(201, { sha: "3".repeat(40) });
    if (method === "GET" && path.startsWith("/git/commits/")) return this.json(200, { tree: { sha: "2".repeat(40) } });
    if (method === "POST" && path === "/git/commits") return this.json(201, { sha: GENERATED });
    if (method === "GET" && path.startsWith("/commits/")) {
      return this.json(200, {
        sha: path.slice("/commits/".length),
        parents: [{ sha: SOURCE }],
        author: { login: ACTOR },
        committer: { login: ACTOR },
        commit: { message: `Bank\n\n${marker(SOURCE)}\nBaseline only — no limit was changed.` },
      });
    }
    if (method === "GET" && path.startsWith("/compare/")) {
      const [base, head] = path.slice("/compare/".length).split("...");
      return this.json(200, {
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        merge_base_commit: { sha: base },
        files: head === GENERATED ? [{ filename: BASELINE_PATH }] : [],
      });
    }
    if (method === "GET" && path.startsWith("/contents/")) {
      return this.json(200, {
        encoding: "base64",
        content: Buffer.from(baselineJson(SOURCE), "utf8").toString("base64"),
      });
    }

    return this.json(500, { message: `unrouted ${method} ${path}` });
  }

  adapter() {
    return makeRestAdapter({ token: TOKEN, owner: OWNER, repo: REPO, fetchImpl: this.fetchImpl });
  }

  pullCreates() {
    return this.requests.filter((line) => line === `POST /repos/${FULL}/pulls`).length;
  }
}

function recordingSleep() {
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  return { waits, sleep };
}

function handoffOptions(overrides = {}) {
  return {
    sourceSha: SOURCE,
    changed: true,
    baselineContent: baselineJson(SOURCE),
    expectedAppSlug: SLUG,
    tokenAppSlug: SLUG,
    title: "Record measured payload growth",
    direction: "growth",
    summary: "common +2,692 B",
    commonRaw: "100",
    commonBrotli: "50",
    eagerBrotli: "60",
    ...overrides,
  };
}

describe("#3337 created-ref read-after-write", () => {
  test("the retry schedule is bounded, growing and well under ten seconds", () => {
    assert.ok(Object.isFrozen(CREATED_REF_READ_DELAYS_MS), "the schedule must not be mutable at runtime");
    assert.ok(CREATED_REF_READ_DELAYS_MS.length >= 2 && CREATED_REF_READ_DELAYS_MS.length <= 4,
      "3-5 reads in total: the first read plus 2-4 retries");
    for (let i = 1; i < CREATED_REF_READ_DELAYS_MS.length; i += 1) {
      assert.ok(CREATED_REF_READ_DELAYS_MS[i] > CREATED_REF_READ_DELAYS_MS[i - 1], "each wait must grow");
    }
    const total = CREATED_REF_READ_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
    assert.ok(total > 0 && total < 10_000, `total waiting must stay well under 10 s, got ${total} ms`);
  });

  for (const lagShape of ["404", "no-sha"]) {
    test(`a created ref that reads as ${lagShape} twice is waited out and the PR opens`, async () => {
      const github = new LaggingGitHub({ lagReads: 2, lagShape });
      const { waits, sleep } = recordingSleep();
      const result = await runHandoff(github.adapter(), handoffOptions({ sleep }));
      assert.equal(result.state, "CREATE");
      assert.equal(result.prUrl, "https://example.test/pull/generated");
      assert.equal(github.pullCreates(), 1, "exactly one PR must be opened");
      assert.deepEqual(waits, CREATED_REF_READ_DELAYS_MS.slice(0, 2), "one wait per invisible read, in schedule order");
      assert.ok(github.readsAfterCreate >= 3, "the ref is read until it is visible");
      assert.equal(github.pulls[0].head.sha, GENERATED, "the PR head is the trusted generated commit");
    });
  }

  test("lag that clears on the very last read still opens the PR", async () => {
    const github = new LaggingGitHub({ lagReads: CREATED_REF_READ_DELAYS_MS.length });
    const { waits, sleep } = recordingSleep();
    const result = await runHandoff(github.adapter(), handoffOptions({ sleep }));
    assert.equal(result.state, "CREATE");
    assert.equal(github.pullCreates(), 1);
    assert.deepEqual(waits, [...CREATED_REF_READ_DELAYS_MS]);
  });

  test("the orphan-recreate path waits out the same lag and keeps its provenance", async () => {
    const github = new LaggingGitHub({ orphan: true, lagReads: 1 });
    const { waits, sleep } = recordingSleep();
    const result = await runHandoff(github.adapter(), handoffOptions({ sleep }));
    assert.equal(result.state, "RECREATE_ORPHAN");
    assert.deepEqual(result.deleted, [BRANCH]);
    assert.equal(github.pullCreates(), 1);
    assert.deepEqual(waits, CREATED_REF_READ_DELAYS_MS.slice(0, 1));
  });

  test("a created ref pointing at a different commit fails closed on the first read, with no retry", async () => {
    const github = new LaggingGitHub({ liveSha: INTRUDER });
    const { waits, sleep } = recordingSleep();
    await assert.rejects(
      () => runHandoff(github.adapter(), handoffOptions({ sleep })),
      (error) => error instanceof HandoffError && error.code === "COLLISION" &&
        /does not equal the trusted generated commit/.test(error.message),
    );
    assert.equal(github.readsAfterCreate, 1, "a mismatched SHA must never be re-read");
    assert.deepEqual(waits, [], "a mismatched SHA must never wait");
    assert.equal(github.pullCreates(), 0, "no PR may be opened from a ref that is not the trusted commit");
  });

  test("a mismatch that appears after lag fails closed on that read, not after the schedule", async () => {
    const github = new LaggingGitHub({ lagReads: 1, liveSha: INTRUDER });
    const { waits, sleep } = recordingSleep();
    await assert.rejects(
      () => runHandoff(github.adapter(), handoffOptions({ sleep })),
      (error) => error.code === "COLLISION",
    );
    assert.equal(github.readsAfterCreate, 2);
    assert.deepEqual(waits, CREATED_REF_READ_DELAYS_MS.slice(0, 1));
    assert.equal(github.pullCreates(), 0);
  });

  test("a created ref still not visible after every read fails closed and opens no PR", async () => {
    const github = new LaggingGitHub({ lagReads: Number.POSITIVE_INFINITY });
    const { waits, sleep } = recordingSleep();
    await assert.rejects(
      () => runHandoff(github.adapter(), handoffOptions({ sleep })),
      (error) => error instanceof HandoffError && error.code === "CREATED_REF_NOT_VISIBLE" &&
        error.message.includes(BRANCH) && /not treated as created/.test(error.message),
    );
    assert.equal(github.readsAfterCreate, CREATED_REF_READ_DELAYS_MS.length + 1, "the first read plus one per scheduled wait");
    assert.deepEqual(waits, [...CREATED_REF_READ_DELAYS_MS]);
    assert.equal(github.pullCreates(), 0, "missing must never be treated as success");
  });

  test("a non-404 REST failure on the read-back is not retried", async () => {
    const github = new LaggingGitHub({ readFailure: 502 });
    const { waits, sleep } = recordingSleep();
    await assert.rejects(
      () => runHandoff(github.adapter(), handoffOptions({ sleep })),
      (error) => error.code === "REST_FAILURE" && error.details?.status === 502,
    );
    assert.equal(github.readsAfterCreate, 1);
    assert.deepEqual(waits, []);
    assert.equal(github.pullCreates(), 0);
  });

  test("readBackCreatedRef waits with a real timer when no sleep is injected", async () => {
    let reads = 0;
    const api = {
      getRef: async () => (++reads < 3 ? null : { object: { sha: GENERATED } }),
    };
    const ref = await readBackCreatedRef(api, BRANCH, GENERATED, { delaysMs: [1, 2] });
    assert.equal(ref.object.sha, GENERATED);
    assert.equal(reads, 3);
  });
});
