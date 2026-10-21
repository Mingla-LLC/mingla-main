// Issue #3980 synced program, Wave 1 rework — tester adversarial suite for
// the merge bot's duplicate clean-up (D2) and full comment paging (D3).
// Runs record.mjs in-process against a stand-in GitHub API (no network, no
// real GitHub, nothing written anywhere). Angles the implementor's suite does
// not take:
//   - three runs racing on one merge leave one record: the OLDEST comment
//     survives (the link people already have keeps working) and no stub is
//     left behind when GitHub allows the deletes
//   - the clean-up of PR #4100's record never touches PR #41001's record on
//     the same issue (one number a prefix of the other)
//   - a comment page GitHub does not answer stops the run before it writes,
//     so a record on that page is never duplicated
//   - a record post GitHub refuses fails the run and deletes or edits
//     nothing
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import { readRecordData } from "../../../../.github/scripts/release-records/lib.mjs";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const SHA = "1234567890abcdef1234567890abcdef12345678";
const MERGED_AT = "2026-10-21T09:30:00Z";
const FIXTURES = new URL("fixtures/issue_3980_release_records/", import.meta.url);

type Comment = {
  id: number;
  body: string;
  user: { login: string; type: string };
  author_association: string;
  created_at: string;
  updated_at: string;
  html_url: string;
};

function json(status: number, data: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

class FakeGitHub {
  calls: { method: string; path: string }[] = [];
  comments = new Map<number, Comment[]>();
  failPage: number | null = null;
  refusePosts = false;
  nextId = 9000;

  addComment(issue: number, body: string, login = "github-actions[bot]", type = "Bot") {
    const id = this.nextId++;
    const c: Comment = {
      id, body, user: { login, type }, author_association: "NONE",
      created_at: "2026-10-21T10:00:00Z", updated_at: "2026-10-21T10:00:00Z",
      html_url: `https://github.com/${REPO}/issues/${issue}#issuecomment-${id}`,
    };
    this.comments.set(issue, [...(this.comments.get(issue) ?? []), c]);
    return c;
  }

  fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    this.calls.push({ method, path: path + url.search });
    if (url.origin !== API) return Promise.resolve(json(599, { message: "not GitHub" }));
    const base = `/repos/${REPO}`;
    let m: RegExpExecArray | null;
    if (method === "GET" && new RegExp(`^${base}/commits/${SHA}/pulls$`).test(path)) {
      return Promise.resolve(json(200, [{ number: 4100, merged_at: MERGED_AT, base: { ref: "main" }, merge_commit_sha: SHA }]));
    }
    if (method === "GET" && new RegExp(`^${base}/commits/${SHA}/status$`).test(path)) return Promise.resolve(json(200, { statuses: [] }));
    if (method === "GET" && new RegExp(`^${base}/commits/${SHA}/check-runs$`).test(path)) return Promise.resolve(json(200, { check_runs: [] }));
    if (method === "GET" && new RegExp(`^${base}/commits/${SHA}$`).test(path)) {
      return Promise.resolve(json(200, { commit: { message: "toward #3980: the synced system (#4100)" } }));
    }
    if (method === "GET" && path === `${base}/actions/runs`) return Promise.resolve(json(200, { workflow_runs: [] }));
    if (method === "GET" && path === `${base}/pulls/4100/files`) return Promise.resolve(json(200, url.searchParams.get("page") === "1" || !url.searchParams.get("page") ? [{ filename: "README.md", status: "modified" }] : []));
    if (method === "GET" && path === `${base}/pulls/4100`) {
      return Promise.resolve(json(200, {
        number: 4100, title: "toward #3980: the synced system", body: "Issue: toward #3980\n\nFeature Guide: none\n",
        merged_at: MERGED_AT, merge_commit_sha: SHA, base: { ref: "main" }, merged_by: { login: "admin-merger" }, user: { login: "author-person" },
      }));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/issues/(\\d+)/comments$`).exec(path))) {
      let all = this.comments.get(Number(m[1])) ?? [];
      const since = url.searchParams.get("since");
      if (since) all = all.filter((c) => Date.parse(c.updated_at) >= Date.parse(since));
      const page = Number(url.searchParams.get("page") ?? "1");
      if (this.failPage !== null && page === this.failPage) return Promise.resolve(json(502, { message: "Server Error" }));
      const last = Math.max(1, Math.ceil(all.length / 100));
      const headers: Record<string, string> = {};
      if (last > 1) headers.link = `<${API}${path}?per_page=100&page=${last}>; rel="last"`;
      return Promise.resolve(json(200, all.slice((page - 1) * 100, page * 100), headers));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/issues/(\\d+)$`).exec(path))) {
      const n = Number(m[1]);
      if (n === 4100) return Promise.resolve(json(200, { number: n, pull_request: { url: "x" } }));
      return Promise.resolve(n === 3980 ? json(200, { number: n }) : json(404, { message: "Not Found" }));
    }
    if (method === "POST" && (m = new RegExp(`^${base}/issues/(\\d+)/comments$`).exec(path))) {
      if (this.refusePosts) return Promise.resolve(json(403, { message: "Resource not accessible by integration" }));
      return Promise.resolve(json(201, this.addComment(Number(m[1]), body.body)));
    }
    if ((method === "PATCH" || method === "DELETE") && (m = new RegExp(`^${base}/issues/comments/(\\d+)$`).exec(path))) {
      for (const [issue, list] of this.comments) {
        const c = list.find((x) => x.id === Number(m![1]));
        if (!c) continue;
        if (c.user.login !== "github-actions[bot]") return Promise.resolve(json(403, { message: "not yours" }));
        if (method === "DELETE") {
          this.comments.set(issue, list.filter((x) => x !== c));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        c.body = body.body;
        return Promise.resolve(json(200, c));
      }
      return Promise.resolve(json(404, { message: "Not Found" }));
    }
    return Promise.resolve(json(404, { message: `no route ${method} ${path}` }));
  };
}

let runs = 0;

/** Runs record.mjs `n` times at once; every run's first full comment read waits until all have read. */
async function runRecord(gh: FakeGitHub, n: number): Promise<{ codes: number[]; logs: string[] }> {
  const realFetch = gh.fetch;
  let listed = 0;
  let release!: () => void;
  const allListed = new Promise<void>((r) => (release = r));
  const barrier = n > 1;
  const wrapped = async (input: Any, init: Any = {}) => {
    const isList = (init.method ?? "GET") === "GET" && /issues\/3980\/comments\?per_page=100$/.test(String(input));
    const res = await realFetch(input, init);
    if (barrier && isList && listed < n) {
      listed += 1;
      if (listed >= n) release();
      await allListed;
    }
    return res;
  };
  const g = globalThis as Any;
  const before = { process: g.process, fetch: g.fetch, log: console.log };
  const logs: string[] = [];
  const env = nodeProcess.env as Record<string, string | undefined>;
  const saved = { p: env.GITHUB_EVENT_PATH, t: env.GITHUB_TOKEN, r: env.GITHUB_REPOSITORY };
  try {
    g.process = nodeProcess;
    g.fetch = wrapped;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    env.GITHUB_EVENT_PATH = decodeURIComponent(new URL("push_main.json", FIXTURES).pathname);
    env.GITHUB_TOKEN = "test-token-not-real";
    env.GITHUB_REPOSITORY = REPO;
    nodeProcess.exitCode = undefined;
    runs += 1;
    const imports = [];
    for (let i = 0; i < n; i++) {
      imports.push(import(new URL(`.github/scripts/release-records/record.mjs?w2-tester=${runs}-${i}`, ROOT).href));
    }
    await Promise.all(imports);
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 2));
      if (logs.filter((l) => l.startsWith("release-record:")).length >= n) break;
    }
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
    return { codes: [Number(nodeProcess.exitCode ?? 0)], logs };
  } finally {
    nodeProcess.exitCode = 0;
    console.log = before.log;
    g.fetch = before.fetch;
    g.process = before.process;
    if (saved.p === undefined) delete env.GITHUB_EVENT_PATH; else env.GITHUB_EVENT_PATH = saved.p;
    if (saved.t === undefined) delete env.GITHUB_TOKEN; else env.GITHUB_TOKEN = saved.t;
    if (saved.r === undefined) delete env.GITHUB_REPOSITORY; else env.GITHUB_REPOSITORY = saved.r;
  }
}

const recordsOf = (gh: FakeGitHub, pr: number) =>
  (gh.comments.get(3980) ?? []).filter((c) => c.user.login === "github-actions[bot]" && c.body.includes(`<!-- mingla-release-record:pr-${pr} -->`));
const posts = (gh: FakeGitHub) => gh.calls.filter((c) => c.method === "POST" && /issues\/3980\/comments$/.test(c.path)).length;

Deno.test("#3980 tester D2: three runs racing on one merge leave one record, the oldest comment, and no stub", async () => {
  const gh = new FakeGitHub();
  for (let i = 0; i < 5; i++) gh.addComment(3980, "chatter " + i, "someone", "User");
  await runRecord(gh, 3);
  assertEquals(posts(gh), 3, "all three runs posted (the race really happened)");
  const left = recordsOf(gh, 4100);
  assertEquals(left.length, 1, "exactly one record survives");
  const firstPostedId = 9005; // the five chatter comments took 9000-9004
  assertEquals(left[0].id, firstPostedId, "the oldest record comment is the one kept");
  assertEquals(readRecordData(left[0].body)?.pr, 4100);
  assertEquals((gh.comments.get(3980) ?? []).filter((c) => c.body.startsWith("A second release record")).length, 0,
    "deletes went through, so no stub is left");
  assertEquals((gh.comments.get(3980) ?? []).filter((c) => c.user.login === "someone").length, 5, "people's comments untouched");
});

Deno.test("#3980 tester D2: cleaning up PR #4100's record never touches PR #41001's record on the same issue", async () => {
  const gh = new FakeGitHub();
  const other = gh.addComment(3980, "<!-- mingla-release-record:pr-41001 -->\nRelease record for PR #41001 (kept as it is)");
  const otherBody = other.body;
  await runRecord(gh, 2);
  assertEquals(recordsOf(gh, 4100).length, 1);
  const still = (gh.comments.get(3980) ?? []).find((c) => c.id === other.id);
  assert(still, "PR #41001's record still exists");
  assertEquals(still!.body, otherBody, "and was not rewritten with PR #4100's record");
});

Deno.test("#3980 tester D3: a comment page GitHub does not answer stops the run before it writes, so its record is never duplicated", async () => {
  const gh = new FakeGitHub();
  for (let i = 0; i < 120; i++) gh.addComment(3980, "chatter " + i, "someone", "User");
  const existing = gh.addComment(3980, "<!-- mingla-release-record:pr-4100 -->\nan older record of PR #4100 on page 2");
  for (let i = 0; i < 100; i++) gh.addComment(3980, "more chatter " + i, "someone", "User");
  gh.failPage = 2;
  const r = await runRecord(gh, 1);
  assertEquals(r.codes[0], 1, "the run fails, so it is visible and re-runs");
  assertEquals(posts(gh), 0, "no second record was posted");
  assertEquals(gh.calls.filter((c) => c.method === "PATCH" || c.method === "DELETE").length, 0, "and nothing was edited or deleted");
  assertEquals(recordsOf(gh, 4100).map((c) => c.id), [existing.id]);
});

Deno.test("#3980 tester D2: a record post GitHub refuses fails the run and deletes or edits nothing", async () => {
  const gh = new FakeGitHub();
  gh.refusePosts = true;
  gh.addComment(3980, "a person's comment", "someone", "User");
  const r = await runRecord(gh, 1);
  assertEquals(r.codes[0], 1);
  assertEquals(gh.calls.filter((c) => c.method === "PATCH" || c.method === "DELETE").length, 0);
  assert(r.logs.some((l) => /GitHub refused the record on #3980/.test(l)), r.logs.join("\n"));
});
