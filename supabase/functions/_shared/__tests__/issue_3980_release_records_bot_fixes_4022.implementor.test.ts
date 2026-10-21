// Issue #3980, after the first live release (#4022) -- two merge-bot gaps
// seen in production:
//   E1  the edge deploy run is found among more than 20 workflow runs of the
//       merge commit (#4022 had 46 and the record kept saying "pending")
//   E2  a "Live check:" by someone whose organisation membership is private
//       (author_association CONTRIBUTOR through the Actions token) counts when
//       they have write access or above to the repository
//   E3  a "Live check:" by someone with read access only still does not count
//   E4  a GitHub error on that permission check is an ERROR, never "trusted"
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
  /** Workflow runs of the merge commit, newest first, as GitHub lists them. */
  runs: Any[] = [];
  /** A login's repository permission (admin, maintain, write, triage, read). */
  permissions = new Map<string, string>();

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
    if (method === "GET" && path === `${B}/actions/runs`) {
      const p = Number(url.searchParams.get("page") ?? "1");
      const per = Number(url.searchParams.get("per_page") ?? "30");
      return json(200, { workflow_runs: this.runs.slice((p - 1) * per, p * per) });
    }
    if (method === "GET" && (m = new RegExp(`^${B}/collaborators/([^/]+)/permission$`).exec(path))) {
      const perm = this.permissions.get(decodeURIComponent(m[1]));
      return perm === undefined ? json(404, { message: "Not Found" }) : json(200, { permission: perm });
    }
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
    await import(new URL(`.github/scripts/release-records/record.mjs?bot-fixes-4022=${runs}`, ROOT).href);
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



const EDGE_FILE = { filename: "supabase/functions/team-agent/index.ts", status: "modified" };
const otherRun = (i: number) => ({ id: 1000 + i, name: `Workflow ${i}`, status: "completed", conclusion: "success", created_at: "2026-10-21T09:40:00Z" });
const edgeRun = { id: 1, name: "Deploy Supabase Edge Functions", status: "completed", conclusion: "success", created_at: "2026-10-21T09:31:00Z" };

Deno.test("#3980 bot fix E1: the edge deploy run is found past the first 20 (and past 100) workflow runs", async () => {
  const gh = new FakeGitHub();
  gh.filePages = [[EDGE_FILE]];
  gh.runs = [...Array.from({ length: 120 }, (_, i) => otherRun(i)), edgeRun];
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0, logs.join("\n"));
  const d = readRecordData(records(gh)[0].body);
  assertEquals(d.edge_functions.includes("team-agent"), true);
  assertEquals(d.deploy.edge, "deployed", `the edge deploy is seen\n${logs.join("\n")}`);
});

Deno.test("#3980 bot fix E2: a private org member's live check counts through write access", async () => {
  const gh = new FakeGitHub();
  gh.permissions.set("sethogieva", "admin");
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0, logs.join("\n"));
  gh.addComment(3980, "Live check: walked production", "sethogieva", "User", "CONTRIBUTOR", "2026-10-21T10:05:00Z");
  assertEquals(await run(gh, "comment_live_check_3980.json", logs), 0, logs.join("\n"));
  const d = readRecordData(records(gh)[0].body);
  assertEquals(d.live_check?.by_login, "sethogieva", `the live check counts\n${logs.join("\n")}`);
});

Deno.test("#3980 bot fix E3: a live check by someone with read access only does not count", async () => {
  const gh = new FakeGitHub();
  gh.permissions.set("drive-by", "read");
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0, logs.join("\n"));
  gh.addComment(3980, "Live check: looks fine to me", "drive-by", "User", "CONTRIBUTOR", "2026-10-21T10:05:00Z");
  gh.addComment(3980, "Live check: from nobody", "stranger", "User", "NONE", "2026-10-21T10:06:00Z");
  assertEquals(await run(gh, "comment_live_check_3980.json", logs), 0, logs.join("\n"));
  assertEquals(readRecordData(records(gh)[0].body).live_check ?? null, null, "no live check from read access or a stranger");
});

Deno.test("#3980 bot fix E4: a GitHub error on the permission check is an ERROR, never trusted", async () => {
  const gh = new FakeGitHub();
  const logs: string[] = [];
  assertEquals(await run(gh, "push_main.json", logs), 0, logs.join("\n"));
  const before = records(gh)[0].body;
  gh.addComment(3980, "Live check: walked production", "sethogieva", "User", "CONTRIBUTOR", "2026-10-21T10:05:00Z");
  gh.fail = (method, path) => (method === "GET" && /\/collaborators\//.test(path) ? 502 : null);
  assertEquals(await run(gh, "comment_live_check_3980.json", logs), 1, logs.join("\n"));
  assert(errored(logs), `said as an ERROR\n${logs.join("\n")}`);
  assertEquals(records(gh)[0].body, before, "the record is left as it was");
});
