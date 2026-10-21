// Issue #3980 synced program, Wave 2 rework 4 -- TESTER adversarial suite for
// the merge bot's "a GitHub error is an error" rule. Angles the implementor
// suite (502s) does not take:
//   R1  the 404/410 "not there" exception cannot wipe the record: a 404 or
//       410 on the file list, statuses, check runs or workflow runs, during
//       the first read or the read-back, is an error (exit 1) and the record
//       keeps its migration and "pending"
//   R2  a 200 with the wrong shape (an object for a list, an HTML error page,
//       a null list) is an error too, never an empty list
//   R3  a 403 rate limit and a 404 on page 2 of the check runs are errors,
//       never a short list
//   R4  a 404 on the pull request during the read-back keeps this run's
//       record (never emptier); a 404 on a linked issue during the read-back
//       never touches migrations and never makes a record complete
//   R5  no duplicate comment: a failed read right after posting, then a
//       normal run, ends with exactly one record; a refused update never
//       posts a second one
//   R6  the read-back is bounded when every re-read fails: at most three
//       rounds, no new comment, exit 1
//   E8  a refused update during the read-back is an error, exit 1
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import { readRecordData, recordProblems } from "../../../../.github/scripts/release-records/lib.mjs";

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
    await import(new URL(`.github/scripts/release-records/record.mjs?w2-rework4-tester=${runs}`, ROOT).href);
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



/** The fake, with a hook that can answer any request with a whole Response. */
class Fake extends FakeGitHub {
  custom: (method: string, url: URL, n: number) => Response | null = () => null;
  override fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname;
    this.calls.push({ method, path: path + url.search });
    const key = `${method} ${path}`;
    const n = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, n);
    const c = this.custom(method, url, n);
    if (c) return Promise.resolve(c);
    const forced = this.fail(method, path, n);
    if (forced !== null) return Promise.resolve(json(forced, { message: "Not Found" }));
    return Promise.resolve(this.answer(method, url, init.body ? JSON.parse(String(init.body)) : undefined));
  };
}

const DATA_READS: [string, RegExp][] = [
  ["the file list", new RegExp(`^${B}/pulls/4100/files$`)],
  ["the statuses", new RegExp(`^${B}/commits/${SHA}/status$`)],
  ["the check runs", new RegExp(`^${B}/commits/${SHA}/check-runs$`)],
  ["the workflow runs", new RegExp(`^${B}/actions/runs$`)],
  ["the merge commit", new RegExp(`^${B}/commits/${SHA}$`)],
];

const keptPending = (gh: FakeGitHub, what: string) => {
  assertEquals(records(gh).length, 1, `${what}: exactly one record`);
  const d = readRecordData(records(gh)[0].body);
  assertEquals(d.migrations_added, ["20271201003980"], `${what}: the migration is still on the record`);
  assertEquals(d.migrations_applied_state, "pending", `${what}: still pending, never "none"`);
};

Deno.test("#3980 W2 rework 4 tester R1: a 404 or 410 on a data read is an error, first read and read-back", async () => {
  for (const status of [404, 410]) {
    for (const [what, re] of DATA_READS) {
      // First read, record already there.
      const gh = new Fake();
      const logs: string[] = [];
      assertEquals(await run(gh, "push_main.json", logs), 0, "the first run writes the record");
      const before = records(gh)[0].body;
      gh.fail = (method, path) => (method === "GET" && re.test(path) ? status : null);
      assertEquals(await run(gh, "status_merge_commit.json", logs), 1, `${status} ${what} (first read): exit 1`);
      assertEquals(records(gh)[0].body, before, `${status} ${what} (first read): the record is unchanged`);
      keptPending(gh, `${status} ${what} (first read)`);
      // Read-back: the first read answers, every later one does not.
      const gh2 = new Fake();
      const logs2: string[] = [];
      gh2.fail = (method, path, n) => (method === "GET" && re.test(path) && n >= 2 ? status : null);
      assertEquals(await run(gh2, "push_main.json", logs2), 1, `${status} ${what} (read-back): exit 1\n${logs2.join("\n")}`);
      keptPending(gh2, `${status} ${what} (read-back)`);
      assert(logs2.some((l) => l.startsWith("release-record: ERROR:") && l.includes(`HTTP ${status}`)), `${status} ${what}: said as an ERROR`);
    }
  }
});

Deno.test("#3980 W2 rework 4 tester R2: a 200 with the wrong shape is an error, never an empty list", async () => {
  const shapes: [string, RegExp, () => Response][] = [
    ["files as an object", new RegExp(`^${B}/pulls/4100/files$`), () => json(200, { message: "Server Error" })],
    ["files as an HTML page", new RegExp(`^${B}/pulls/4100/files$`), () => new Response("<html>unicorn</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["files as null", new RegExp(`^${B}/pulls/4100/files$`), () => json(200, null)],
    ["statuses with no list", new RegExp(`^${B}/commits/${SHA}/status$`), () => json(200, { state: "pending" })],
    ["statuses list null", new RegExp(`^${B}/commits/${SHA}/status$`), () => json(200, { statuses: null })],
    ["check runs with no list", new RegExp(`^${B}/commits/${SHA}/check-runs$`), () => json(200, { total_count: 0 })],
    ["workflow runs with no list", new RegExp(`^${B}/actions/runs$`), () => json(200, {})],
    ["linked issue as an HTML page", new RegExp(`^${B}/issues/3980$`), () => new Response("<html>oops</html>", { status: 200 })],
  ];
  for (const [what, re, res] of shapes) {
    const gh = new Fake();
    const logs: string[] = [];
    gh.custom = (method, url, n) => (method === "GET" && re.test(url.pathname) && n >= 2 ? res() : null);
    const code = await run(gh, "push_main.json", logs);
    assertEquals(code, 1, `${what} (read-back): exit 1\n${logs.join("\n")}`);
    keptPending(gh, `${what} (read-back)`);
    assertEquals(readRecordData(records(gh)[0].body).issues.map((i: Any) => i.number), [3980], `${what}: the issue stays`);
    const gh2 = new Fake();
    const logs2: string[] = [];
    gh2.custom = (method, url) => (method === "GET" && re.test(url.pathname) ? res() : null);
    assertEquals(await run(gh2, "push_main.json", logs2), 1, `${what} (first read): exit 1`);
    assertEquals(records(gh2).length, 0, `${what} (first read): nothing written`);
  }
});

Deno.test("#3980 W2 rework 4 tester R3: a 403 rate limit, and a 404 on page 2 of the check runs, are errors", async () => {
  const gh = new Fake();
  const logs: string[] = [];
  gh.fail = (method, path, n) => (method === "GET" && path === `${B}/pulls/4100/files` && n >= 2 ? 403 : null);
  assertEquals(await run(gh, "push_main.json", logs), 1, "403 on the files during the read-back: exit 1");
  keptPending(gh, "403 files");
  // 100 check runs on page 1, then a 404 on page 2: never a 100-run list.
  const gh2 = new Fake();
  const logs2: string[] = [];
  const hundred = Array.from({ length: 100 }, (_, i) => ({ name: `job ${i}`, status: "completed", conclusion: "success", app: { slug: "github-actions" } }));
  gh2.custom = (method, url) => {
    if (method !== "GET" || url.pathname !== `${B}/commits/${SHA}/check-runs`) return null;
    return Number(url.searchParams.get("page") ?? "1") === 1 ? json(200, { check_runs: hundred }) : json(404, { message: "Not Found" });
  };
  assertEquals(await run(gh2, "push_main.json", logs2), 1, `404 on check runs page 2: exit 1\n${logs2.join("\n")}`);
  assertEquals(records(gh2).length, 0, "nothing written from a short list");
});

Deno.test("#3980 W2 rework 4 tester R4: 404s on the pull request or a linked issue during the read-back never empty the record", async () => {
  // The pull request answers 404 on every re-read: this run's record stays.
  const gh = new Fake();
  const logs: string[] = [];
  gh.fail = (method, path, n) => (method === "GET" && path === `${B}/pulls/4100` && n >= 2 ? 404 : null);
  await run(gh, "push_main.json", logs);
  keptPending(gh, "404 on the pull request (read-back)");
  assertEquals(readRecordData(records(gh)[0].body).issues.map((i: Any) => i.number), [3980]);
  // One of two linked issues answers 404 on the re-read (the "not there"
  // exception): whatever happens to the list, migrations stay pending and
  // no record turns complete.
  const gh2 = new Fake();
  gh2.issues = [3980, 3981];
  gh2.refs = [3980, 3981];
  const logs2: string[] = [];
  gh2.fail = (method, path, n) => (method === "GET" && path === `${B}/issues/3981` && n >= 2 ? 404 : null);
  await run(gh2, "push_main.json", logs2);
  for (const t of [3980, 3981]) {
    assertEquals(records(gh2, t).length, 1, `#${t}: one record`);
    const d = readRecordData(records(gh2, t)[0].body);
    assertEquals(d.migrations_applied_state, "pending", `#${t}: still pending`);
    assertEquals(d.migrations_added.length, 1, `#${t}: migration kept`);
    assert(recordProblems(d).length > 0 || d.problems.length > 0, `#${t}: not complete`);
    assert(/Status: Not complete/.test(records(gh2, t)[0].body), `#${t}: the comment says not complete`);
  }
});

Deno.test("#3980 W2 rework 4 tester R5: no duplicate comment after a failed read-back or a refused update", async () => {
  // The read right after posting fails (settle); the next run must still end with one record.
  const gh = new Fake();
  const logs: string[] = [];
  let fullReads = 0;
  gh.custom = (method, url) => {
    if (method === "GET" && url.pathname === `${B}/issues/3980/comments` && !url.searchParams.get("since")) {
      fullReads += 1;
      if (fullReads === 2) return json(502, { message: "Bad Gateway" });
    }
    return null;
  };
  assertEquals(await run(gh, "push_main.json", logs), 1, "the failed read after posting exits 1");
  assertEquals(records(gh).length, 1, "one record after the failed read-back");
  gh.custom = () => null;
  assertEquals(await run(gh, "status_merge_commit.json", logs), 0, "the next run is clean");
  assertEquals(records(gh).length, 1, "still exactly one record");
  // A refused update (403) on the existing record: error, and no second comment.
  const before = records(gh)[0].body;
  gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "1 of 1 applied" }];
  gh.fail = (method, path) => (method === "PATCH" && /\/issues\/comments\/\d+$/.test(path) ? 403 : null);
  const logs2: string[] = [];
  assertEquals(await run(gh, "status_merge_commit.json", logs2), 1, "a refused update exits 1");
  assertEquals(records(gh).length, 1, "a refused update never posts a second record");
  assertEquals(records(gh)[0].body, before, "and leaves the record as it was");
  assertEquals(gh.calls.filter((c) => c.method === "POST").length, 1, "only the very first run ever posted");
});

Deno.test("#3980 W2 rework 4 tester R6: every re-read failing: at most three rounds, no new comment, exit 1", async () => {
  const gh = new Fake();
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0);
  // A racer keeps rewriting a stale record, and every re-read of the files fails.
  gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "1 of 1 applied" }];
  const stale = records(gh)[0].body;
  const base = gh.fetch;
  gh.fetch = async (input: Any, init: Any = {}) => {
    const res = await base(input, init);
    if ((init.method ?? "GET").toUpperCase() === "PATCH") records(gh)[0].body = stale;
    return res;
  };
  let files = 0;
  gh.custom = (method, url) => (method === "GET" && url.pathname === `${B}/pulls/4100/files` && ++files >= 2 ? json(500, {}) : null);
  const from = gh.calls.length;
  const logs2: string[] = [];
  const code = await run(gh, "status_merge_commit.json", logs2);
  const calls = gh.calls.slice(from);
  assertEquals(code, 1, `exit 1\n${logs2.join("\n")}`);
  assert(calls.filter((c) => c.method === "PATCH").length <= 4, `a write and at most three re-merges (${calls.filter((c) => c.method === "PATCH").length})`);
  assertEquals(calls.filter((c) => c.method === "POST").length, 0, "never a new comment");
  assert(files <= 1 + 3, `the files were re-read at most three times (${files})`);
  assert(logs2.filter((l) => l.includes("re-reading GitHub for the record")).length <= 3, "one ERROR per failed round");
});
