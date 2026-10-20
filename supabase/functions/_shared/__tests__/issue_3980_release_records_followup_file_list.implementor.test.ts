// Issue #3980 synced program, Wave 2 follow-up -- the merge bot reads a pull
// request's whole file list, up to GitHub's own limit (30 pages of 100), and
// treats a list cut short as an error, never as the list. Before, it read
// three pages: a migration on page 4 was missed and the record said
// "migrations applied: none", so the issue could turn Live before its
// migration was applied.
//   F1  a migration on page 4 (301 files) is on the record, still "pending"
//   F2  30 full pages (GitHub's limit, maybe more past it): no record is
//       written, ERROR, exit 1; never "none"
//   F3  a record already there keeps its migration and "pending" when the
//       next read is cut at 30 full pages, exit 1
//   F4  fewer files read than the pull request says it changed
//       (changed_files) is an error too; a record already there is kept
//   F5  a list that ends inside the limit and matches changed_files is fine
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
const B = `/repos/${REPO}`;

type Comment = { id: number; body: string; user: { login: string; type: string }; author_association: string; created_at: string; updated_at: string; html_url: string };

class FakeGitHub {
  calls: { method: string; path: string }[] = [];
  comments = new Map<number, Comment[]>();
  statuses: Any[] = [];
  issues = [3980];
  refs = [3980];
  nextId = 9300;
  /** The pages of the file list (page 1 first); a page past the end is []. */
  filePages: { filename: string; status: string }[][] = [[{ filename: "supabase/migrations/20271201003980_x.sql", status: "added" }]];
  /** What the pull request says it changed (GitHub's changed_files), or undefined to leave it out. */
  changedFiles: number | undefined = undefined;
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
      return json(200, this.filePages[Number(url.searchParams.get("page") ?? "1") - 1] ?? []);
    }
    if (method === "GET" && path === `${B}/pulls/4100`) {
      return json(200, { number: 4100, title: "toward #3980: the synced system",
        body: `Issue: ${this.refs.map((x) => `toward #${x}`).join(", ")}\n\nFeature Guide: none\n`,
        merged_at: MERGED_AT, merge_commit_sha: SHA, base: { ref: "main" }, merged_by: { login: "m" }, user: { login: "a" },
        ...(this.changedFiles === undefined ? {} : { changed_files: this.changedFiles }) });
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
    await import(new URL(`.github/scripts/release-records/record.mjs?w2-followup-files=${runs}`, ROOT).href);
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


const page = (p: number, n = 100) => Array.from({ length: n }, (_, i) => ({ filename: `mingla-admin/src/f${p}_${i}.ts`, status: "modified" }));
const MIG = { filename: "supabase/migrations/20271201003980_x.sql", status: "added" };
const filePagesRead = (gh: FakeGitHub) =>
  gh.calls.filter((c) => c.method === "GET" && c.path.startsWith(`${B}/pulls/4100/files`)).map((c) => Number(new URL(c.path, API).searchParams.get("page")));

Deno.test("#3980 W2 follow-up F1: a migration on page 4 is on the record, still pending", async () => {
  const gh = new FakeGitHub();
  gh.filePages = [page(1), page(2), page(3), [MIG]];
  gh.changedFiles = 301;
  const logs: string[] = [];
  const code = await run(gh, "push_main.json", logs);
  assertEquals(code, 0, logs.join("\n"));
  assertEquals(records(gh).length, 1, "one record");
  const d = readRecordData(records(gh)[0].body);
  assertEquals(d.migrations_added, ["20271201003980"], "the migration on page 4 is on the record");
  assertEquals(d.migrations_applied_state, "pending", "pending, never none");
  assert(filePagesRead(gh).includes(4), `page 4 was read: ${filePagesRead(gh).join(",")}`);
});

Deno.test("#3980 W2 follow-up F2: 30 full pages is a list cut short: nothing written, ERROR, exit 1", async () => {
  const gh = new FakeGitHub();
  gh.filePages = Array.from({ length: 31 }, (_, i) => (i === 30 ? [MIG] : page(i + 1)));
  const logs: string[] = [];
  const code = await run(gh, "push_main.json", logs);
  assertEquals(code, 1, logs.join("\n"));
  assertEquals(records(gh).length, 0, "no record says none");
  assertEquals(gh.calls.filter((c) => c.method !== "GET").length, 0, "no write at all");
  assert(errored(logs) && logs.some((l) => /file list of #4100 is cut short/.test(l)), `said as an ERROR\n${logs.join("\n")}`);
  assertEquals(Math.max(...filePagesRead(gh)), 30, "read up to GitHub's limit and no further");
});

Deno.test("#3980 W2 follow-up F3: a record already there keeps its migration when the next read is cut at 30 pages", async () => {
  const gh = new FakeGitHub();
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0, "the first run writes the record");
  const before = records(gh)[0].body;
  assertEquals(readRecordData(before).migrations_applied_state, "pending");
  gh.filePages = Array.from({ length: 30 }, (_, i) => page(i + 1));
  const code = await run(gh, "push_main.json", logs);
  assertEquals(code, 1, logs.join("\n"));
  assertEquals(records(gh).length, 1, "still one record");
  assertEquals(records(gh)[0].body, before, "left exactly as it was");
  assert(errored(logs), "said as an ERROR");
});

Deno.test("#3980 W2 follow-up F4: fewer files than changed_files is an error; a record already there is kept", async () => {
  const fresh = new FakeGitHub();
  fresh.filePages = [page(1), page(2, 40)];
  fresh.changedFiles = 141;
  const logs0: string[] = [];
  assertEquals(await run(fresh, "push_main.json", logs0), 1, logs0.join("\n"));
  assertEquals(records(fresh).length, 0, "no record from a short list");
  assert(logs0.some((l) => /read 140 files of 141/.test(l)), logs0.join("\n"));

  const gh = new FakeGitHub();
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0, "the first run writes the record");
  const before = records(gh)[0].body;
  gh.filePages = [[{ filename: "mingla-admin/src/a.ts", status: "modified" }]];
  gh.changedFiles = 2;
  assertEquals(await run(gh, "push_main.json", logs), 1, logs.join("\n"));
  assertEquals(records(gh)[0].body, before, "left exactly as it was");
  assertEquals(readRecordData(records(gh)[0].body).migrations_added, ["20271201003980"]);
});

Deno.test("#3980 W2 follow-up F5: a whole list inside the limit that matches changed_files is fine", async () => {
  const gh = new FakeGitHub();
  gh.filePages = [page(1), [MIG]];
  gh.changedFiles = 101;
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0, logs.join("\n"));
  assert(!errored(logs), logs.join("\n"));
  assertEquals(readRecordData(records(gh)[0].body).migrations_added, ["20271201003980"]);
  assertEquals(filePagesRead(gh).filter((p) => p === 3).length, 0, "stops at the short page");
});
