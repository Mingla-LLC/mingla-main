// Issue #3980 synced program, Wave 2 rework 4 — the merge bot treats a GitHub
// read that did not answer 200 as an error, never as "nothing there". An
// error read as an empty file list would record "migrations applied: none"
// and let the issue turn Live before its migration is applied.
//   E1  first read, no record yet: a 502 on any read (pull request, merge
//       commit, files, statuses, check runs, workflow runs, a linked issue,
//       the comments) writes nothing, says ERROR, and the run exits 1
//   E2  first read, a record already there: the same 502s leave it exactly
//       as it was (still "pending" with its migration), exit 1
//   E3  read-back: a 502 on the file list keeps this run's record (its
//       migration and "pending"), says ERROR, exit 1
//   E4  read-back: a 502 on one linked issue keeps both issues on both
//       records, exit 1
//   E5  a 404 on a linked number (it does not exist) still drops it, exit 0
//   E6  a 500 re-reading a racer's live check comment is not "deleted": the
//       record keeps the racer's live check, exit 1
//   E7  a 502 resolving the pull request from a status event is an error
//       (exit 1), not "no merged pull request"
//   E8  a refused update during the read-back is an error, exit 1
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import { readRecordData, recordProblems, renderRecord } from "../../../../.github/scripts/release-records/lib.mjs";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const SHA = "1234567890abcdef1234567890abcdef12345678";
const MERGED_AT = "2026-10-21T09:30:00Z";
const B = `/repos/${REPO}`;

type Comment = { id: number; body: string; user: { login: string; type: string }; author_association: string; created_at: string; updated_at: string; html_url: string };

class FakeGitHub {
  calls: { method: string; path: string }[] = [];
  comments = new Map<number, Comment[]>();
  statuses: Any[] = [];
  issues = [3980];
  refs = [3980];
  nextId = 9300;
  /** Returns a status to answer instead (e.g. 502), or null to answer normally. */
  fail: (method: string, path: string, n: number) => number | null = () => null;
  seen = new Map<string, number>();

  addComment(issue: number, body: string, login = "github-actions[bot]", type = "Bot", assoc = "NONE", at = "2026-10-21T10:00:00Z") {
    const id = this.nextId++;
    const c: Comment = { id, body, user: { login, type }, author_association: assoc, created_at: at, updated_at: at,
      html_url: `https://github.com/${REPO}/issues/${issue}#issuecomment-${id}` };
    this.comments.set(issue, [...(this.comments.get(issue) ?? []), c]);
    return c;
  }

  fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname;
    this.calls.push({ method, path: path + url.search });
    const key = `${method} ${path}`;
    const n = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, n);
    const forced = this.fail(method, path, n);
    if (forced !== null) return Promise.resolve(json(forced, { message: "Bad Gateway" }));
    return Promise.resolve(this.answer(method, url, init.body ? JSON.parse(String(init.body)) : undefined));
  };

  answer(method: string, url: URL, body: Any): Response {
    const path = url.pathname;
    let m: RegExpExecArray | null;
    if (url.origin !== API) return json(599, {});
    if (method === "GET" && path === `${B}/commits/${SHA}/pulls`) {
      return json(200, [{ number: 4100, merged_at: MERGED_AT, base: { ref: "main" }, merge_commit_sha: SHA }]);
    }
    if (method === "GET" && path === `${B}/commits/${SHA}/status`) return json(200, { statuses: this.statuses });
    if (method === "GET" && path === `${B}/commits/${SHA}/check-runs`) return json(200, { check_runs: [] });
    if (method === "GET" && path === `${B}/commits/${SHA}`) return json(200, { commit: { message: "toward #3980: the synced system (#4100)" } });
    if (method === "GET" && path === `${B}/actions/runs`) return json(200, { workflow_runs: [] });
    if (method === "GET" && path === `${B}/pulls/4100/files`) {
      return json(200, Number(url.searchParams.get("page") ?? "1") === 1 ? [{ filename: "supabase/migrations/20271201003980_x.sql", status: "added" }] : []);
    }
    if (method === "GET" && path === `${B}/pulls/4100`) {
      return json(200, { number: 4100, title: "toward #3980: the synced system",
        body: `Issue: ${this.refs.map((x) => `toward #${x}`).join(", ")}\n\nFeature Guide: none\n`,
        merged_at: MERGED_AT, merge_commit_sha: SHA, base: { ref: "main" }, merged_by: { login: "m" }, user: { login: "a" } });
    }
    if (method === "GET" && (m = new RegExp(`^${B}/issues/(\\d+)$`).exec(path))) {
      return this.issues.includes(Number(m[1])) ? json(200, { number: Number(m[1]) }) : json(404, { message: "Not Found" });
    }
    if (method === "GET" && (m = new RegExp(`^${B}/issues/comments/(\\d+)$`).exec(path))) {
      for (const list of this.comments.values()) {
        const c = list.find((x) => x.id === Number(m![1]));
        if (c) return json(200, c);
      }
      return json(404, { message: "Not Found" });
    }
    if (method === "GET" && (m = new RegExp(`^${B}/issues/(\\d+)/comments$`).exec(path))) {
      let all = this.comments.get(Number(m[1])) ?? [];
      const since = url.searchParams.get("since");
      if (since) all = all.filter((c) => Date.parse(c.updated_at) >= Date.parse(since));
      return json(200, all.slice(0, 100));
    }
    if (method === "POST" && (m = new RegExp(`^${B}/issues/(\\d+)/comments$`).exec(path))) {
      return json(201, this.addComment(Number(m[1]), body.body));
    }
    if ((method === "PATCH" || method === "DELETE") && (m = new RegExp(`^${B}/issues/comments/(\\d+)$`).exec(path))) {
      for (const [issue, list] of this.comments) {
        const c = list.find((x) => x.id === Number(m![1]));
        if (!c) continue;
        if (method === "DELETE") {
          this.comments.set(issue, list.filter((x) => x !== c));
          return new Response(null, { status: 204 });
        }
        c.body = body.body;
        return json(200, c);
      }
      return json(404, {});
    }
    return json(404, { message: `no route ${method} ${path}` });
  }
}

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const FIXTURES = new URL("fixtures/issue_3980_release_records/", import.meta.url);
let runs = 0;
const finished = (logs: string[]) => logs.filter((l) => l.startsWith("release-record: PR #") || l.startsWith("release-record: stopped")).length;

/** One run of record.mjs against the fake; returns its exit code. */
async function run(gh: FakeGitHub, fixture: string, logs: string[]): Promise<number> {
  const env = nodeProcess.env as Record<string, string | undefined>;
  const g = globalThis as Any;
  const before = { process: g.process, fetch: g.fetch, log: console.log };
  const saved = { p: env.GITHUB_EVENT_PATH, t: env.GITHUB_TOKEN, r: env.GITHUB_REPOSITORY };
  const start = finished(logs);
  try {
    g.process = nodeProcess;
    g.fetch = (input: Any, init?: Any) => gh.fetch(input, init);
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    nodeProcess.exitCode = 0;
    env.GITHUB_EVENT_PATH = decodeURIComponent(new URL(fixture, FIXTURES).pathname);
    env.GITHUB_TOKEN = "test-token-not-real";
    env.GITHUB_REPOSITORY = REPO;
    runs += 1;
    await import(new URL(`.github/scripts/release-records/record.mjs?w2-rework4=${runs}`, ROOT).href);
    for (let i = 0; i < 3000 && finished(logs) <= start; i++) await new Promise((r) => setTimeout(r, 1));
    assert(finished(logs) > start, `the run finished:\n${logs.join("\n")}`);
    // main() sets the exit code once it returns.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    return Number(nodeProcess.exitCode ?? 0);
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

const records = (gh: FakeGitHub, issue = 3980) =>
  (gh.comments.get(issue) ?? []).filter((c) => c.user.login === "github-actions[bot]" && c.body.includes("mingla-release-record:pr-4100"));
const errored = (logs: string[]) => logs.some((l) => l.startsWith("release-record: ERROR:"));

// Every GitHub read collect makes, as a method and path the fake can fail.
const READS: [string, RegExp][] = [
  ["the pull request", new RegExp(`^${B}/pulls/4100$`)],
  ["the merge commit", new RegExp(`^${B}/commits/${SHA}$`)],
  ["the file list", new RegExp(`^${B}/pulls/4100/files$`)],
  ["the statuses", new RegExp(`^${B}/commits/${SHA}/status$`)],
  ["the check runs", new RegExp(`^${B}/commits/${SHA}/check-runs$`)],
  ["the workflow runs", new RegExp(`^${B}/actions/runs$`)],
  ["a linked issue", new RegExp(`^${B}/issues/3980$`)],
];

Deno.test("#3980 W2 rework 4 E1: no record yet, a 502 on any read writes nothing and exits 1", async () => {
  for (const [what, re] of READS) {
    const gh = new FakeGitHub();
    gh.fail = (method, path) => (method === "GET" && re.test(path) ? 502 : null);
    const logs: string[] = [];
    const code = await run(gh, "push_main.json", logs);
    assertEquals(code, 1, `${what}: exit code\n${logs.join("\n")}`);
    assertEquals(records(gh).length, 0, `${what}: nothing written`);
    assert(errored(logs) && logs.some((l) => /HTTP 502/.test(l)), `${what}: said as an ERROR with the answer\n${logs.join("\n")}`);
    assertEquals(gh.calls.filter((c) => c.method !== "GET").length, 0, `${what}: no write at all`);
  }
});

Deno.test("#3980 W2 rework 4 E2: a record already there is left exactly as it was when a read fails", async () => {
  for (const [what, re] of [...READS, ["the comments since the merge", new RegExp(`^${B}/issues/3980/comments$`)] as [string, RegExp]]) {
    const gh = new FakeGitHub();
    const logs: string[] = [];
    assertEquals(await run(gh, "push_main.json", logs), 0, "the first run writes the record");
    const before = records(gh)[0].body;
    assertEquals(readRecordData(before).migrations_applied_state, "pending");
    // The comments read of the "since" kind is the live check read; the full
    // list read (no since) is the record read, which already stops the run.
    gh.fail = (method, path) => {
      if (method !== "GET" || !re.test(path)) return null;
      return 502;
    };
    const code = await run(gh, "status_merge_commit.json", logs);
    assertEquals(code, 1, `${what}: exit code`);
    assertEquals(records(gh).length, 1, `${what}: still one record`);
    assertEquals(records(gh)[0].body, before, `${what}: the record is unchanged`);
    assertEquals(readRecordData(records(gh)[0].body).migrations_added.length, 1, `${what}: the migration is still there`);
  }
});

Deno.test("#3980 W2 rework 4 E3: a 502 on the file list during the read-back keeps this run's record and exits 1", async () => {
  const gh = new FakeGitHub();
  gh.fail = (method, path, n) => (method === "GET" && path === `${B}/pulls/4100/files` && n >= 2 ? 502 : null);
  const logs: string[] = [];
  const code = await run(gh, "push_main.json", logs);
  assert((gh.seen.get(`GET ${B}/pulls/4100/files`) ?? 0) >= 2, "the read-back re-read the file list");
  assertEquals(code, 1, logs.join("\n"));
  const d = readRecordData(records(gh)[0].body);
  assertEquals(d.migrations_added, ["20271201003980"]);
  assertEquals(d.migrations_applied_state, "pending");
  assert(logs.some((l) => /^release-record: ERROR: PR #4100: re-reading GitHub for the record on #3980 failed/.test(l)), logs.join("\n"));
  assert(logs.some((l) => /^release-record: ERROR: 1 GitHub read failed while reading records back/.test(l)), logs.join("\n"));
});

Deno.test("#3980 W2 rework 4 E4: a 502 on one linked issue during the read-back keeps both issues on both records", async () => {
  const gh = new FakeGitHub();
  gh.issues = [3980, 3981];
  gh.refs = [3980, 3981];
  gh.fail = (method, path, n) => (method === "GET" && path === `${B}/issues/3981` && n >= 2 ? 502 : null);
  const logs: string[] = [];
  const code = await run(gh, "push_main.json", logs);
  assertEquals(code, 1, logs.join("\n"));
  for (const t of [3980, 3981]) {
    assertEquals(records(gh, t).length, 1, `#${t} has its record`);
    assertEquals(readRecordData(records(gh, t)[0].body).issues.map((i: Any) => i.number), [3980, 3981], `#${t} names both`);
  }
});

Deno.test("#3980 W2 rework 4 E5: a linked number that does not exist (404) is still dropped, exit 0", async () => {
  const gh = new FakeGitHub();
  gh.refs = [3980, 3999];
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0, logs.join("\n"));
  assertEquals(readRecordData(records(gh)[0].body).issues.map((i: Any) => i.number), [3980]);
  assertEquals(errored(logs), false);
});

Deno.test("#3980 W2 rework 4 E6: a 500 re-reading a racer's live check comment keeps the racer's live check", async () => {
  const gh = new FakeGitHub();
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0);
  // A racer recorded a live check from a trusted comment that this run's
  // "since" read does not return (it reads it again by id).
  const lcComment = gh.addComment(3980, "Live check: looked in production", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z");
  const d = readRecordData(records(gh)[0].body);
  const lc = { text: "looked in production", by_login: "sethogieva", url: lcComment.html_url, at: lcComment.created_at };
  records(gh)[0].body = renderRecord({ ...d, live_check: lc, problems: recordProblems({ ...d, live_check: lc }) });
  const hidden = lcComment.id;
  const real = gh.answer.bind(gh);
  gh.answer = (method: string, url: URL, body: Any) => {
    // the "since" list leaves it out; the read by id answers 500
    if (method === "GET" && url.pathname === `${B}/issues/3980/comments` && url.searchParams.get("since")) {
      return json(200, (gh.comments.get(3980) ?? []).filter((c) => c.id !== hidden));
    }
    if (method === "GET" && url.pathname === `${B}/issues/comments/${hidden}`) return json(500, { message: "boom" });
    return real(method, url, body);
  };
  const code = await run(gh, "status_merge_commit.json", logs);
  assertEquals(code, 1, logs.join("\n"));
  assertEquals(readRecordData(records(gh)[0].body).live_check?.url, lc.url, "the racer's live check is kept");
});

Deno.test("#3980 W2 rework 4 E7: a 502 resolving the pull request from a status event is an error, not 'nothing to do'", async () => {
  const gh = new FakeGitHub();
  gh.fail = (_method, path) => (path === `${B}/commits/${SHA}/pulls` ? 502 : null);
  const logs: string[] = [];
  assertEquals(await run(gh, "status_merge_commit.json", logs), 1, logs.join("\n"));
  assertEquals(logs.some((l) => /nothing to do/.test(l)), false, logs.join("\n"));
});

Deno.test("#3980 W2 rework 4 E8: a refused update during the read-back is an error", async () => {
  const gh = new FakeGitHub();
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0);
  // A racer rewrites the record stale after this run's write; the re-merge's update is refused.
  const stale = records(gh)[0].body;
  gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "1 of 1 applied" }];
  gh.fail = (method, _path, n) => (method === "PATCH" && n >= 2 ? 500 : null);
  const real = gh.fetch;
  gh.fetch = async (input: Any, init: Any = {}) => {
    const res = await real(input, init);
    if ((init.method ?? "GET").toUpperCase() === "PATCH" && res.status === 200) records(gh)[0].body = stale;
    return res;
  };
  const code = await run(gh, "status_merge_commit.json", logs);
  assertEquals(code, 1, logs.join("\n"));
  assert(logs.some((l) => /read-back failed/.test(l)), logs.join("\n"));
});
