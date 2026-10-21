// Issue #3980 synced program, Wave 2 rework 2 — tester adversarial suite for
// record.mjs reading its record back after writing (stabilize). Angles the
// implementor's suite does not take:
//   - the live check lands in the window and NO other run records it: the
//     re-read alone must find it in the "Live check:" comments
//   - a stranger's "Live check:" and one dated before the merge, landing in
//     the same window, are never taken by the re-read
//   - endless churn (a newer trusted live check on every read): the run
//     still ends, with at most three re-merge writes and one record
//   - a second record comment posted by another run in the window: the
//     re-read leaves exactly one, and the re-read never posts
//   - the record deleted in the window: the re-read never posts it again
// Stand-in GitHub API in-process (no network). The harness mirrors the
// implementor's (issue_3980_release_records_rework2.implementor.test.ts).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import { readRecordData } from "../../../../.github/scripts/release-records/lib.mjs";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const SHA = "1234567890abcdef1234567890abcdef12345678";
const MERGED_AT = "2026-10-21T09:30:00Z";

type Comment = { id: number; body: string; user: { login: string; type: string }; author_association: string; created_at: string; updated_at: string; html_url: string };

class FakeGitHub {
  calls: { method: string; path: string }[] = [];
  comments = new Map<number, Comment[]>();
  statuses: Any[] = [];
  nextId = 9100;

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
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    this.calls.push({ method, path: path + url.search });
    if (url.origin !== API) return Promise.resolve(json(599, {}));
    const b = `/repos/${REPO}`;
    let m: RegExpExecArray | null;
    if (method === "GET" && path === `${b}/commits/${SHA}/pulls`) {
      return Promise.resolve(json(200, [{ number: 4100, merged_at: MERGED_AT, base: { ref: "main" }, merge_commit_sha: SHA }]));
    }
    if (method === "GET" && path === `${b}/commits/${SHA}/status`) return Promise.resolve(json(200, { statuses: this.statuses }));
    if (method === "GET" && path === `${b}/commits/${SHA}/check-runs`) return Promise.resolve(json(200, { check_runs: [] }));
    if (method === "GET" && path === `${b}/commits/${SHA}`) return Promise.resolve(json(200, { commit: { message: "toward #3980: the synced system (#4100)" } }));
    if (method === "GET" && path === `${b}/actions/runs`) return Promise.resolve(json(200, { workflow_runs: [] }));
    if (method === "GET" && path === `${b}/pulls/4100/files`) {
      return Promise.resolve(json(200, Number(url.searchParams.get("page") ?? "1") === 1 ? [{ filename: "supabase/migrations/20271201003980_x.sql", status: "added" }] : []));
    }
    if (method === "GET" && path === `${b}/pulls/4100`) {
      return Promise.resolve(json(200, { number: 4100, title: "toward #3980: the synced system", body: "Issue: toward #3980\n\nFeature Guide: none\n",
        merged_at: MERGED_AT, merge_commit_sha: SHA, base: { ref: "main" }, merged_by: { login: "m" }, user: { login: "a" } }));
    }
    if (method === "GET" && path === `${b}/issues/3980`) return Promise.resolve(json(200, { number: 3980 }));
    if (method === "GET" && (m = new RegExp(`^${b}/issues/comments/(\\d+)$`).exec(path))) {
      for (const list of this.comments.values()) {
        const c = list.find((x) => x.id === Number(m![1]));
        if (c) return Promise.resolve(json(200, c));
      }
      return Promise.resolve(json(404, { message: "Not Found" }));
    }
    if (method === "GET" && (m = new RegExp(`^${b}/issues/(\\d+)/comments$`).exec(path))) {
      let all = this.comments.get(Number(m[1])) ?? [];
      const since = url.searchParams.get("since");
      if (since) all = all.filter((c) => Date.parse(c.updated_at) >= Date.parse(since));
      return Promise.resolve(json(200, all.slice(0, 100)));
    }
    if (method === "POST" && (m = new RegExp(`^${b}/issues/(\\d+)/comments$`).exec(path))) {
      return Promise.resolve(json(201, this.addComment(Number(m[1]), body.body)));
    }
    if ((method === "PATCH" || method === "DELETE") && (m = new RegExp(`^${b}/issues/comments/(\\d+)$`).exec(path))) {
      for (const [issue, list] of this.comments) {
        const c = list.find((x) => x.id === Number(m![1]));
        if (!c) continue;
        if (method === "DELETE") {
          this.comments.set(issue, list.filter((x) => x !== c));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        c.body = body.body;
        return Promise.resolve(json(200, c));
      }
      return Promise.resolve(json(404, {}));
    }
    return Promise.resolve(json(404, { message: `no route ${method} ${path}` }));
  };
}

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const FIXTURES = new URL("fixtures/issue_3980_release_records/", import.meta.url);
let runs = 0;

const finished = (logs: string[]) => logs.filter((l) => l.startsWith("release-record: PR #") || l.startsWith("release-record: stopped")).length;

/**
 * Starts the record runner for an event fixture. The returned wait resolves
 * once this run's own last line is written: the n-th finished line of the
 * test, n counting runs started so far.
 */
async function startRun(fixture: string, logs: string[], nth: number) {
  const env = nodeProcess.env as Record<string, string | undefined>;
  env.GITHUB_EVENT_PATH = decodeURIComponent(new URL(fixture, FIXTURES).pathname);
  env.GITHUB_TOKEN = "test-token-not-real";
  env.GITHUB_REPOSITORY = REPO;
  runs += 1;
  await import(new URL(`.github/scripts/release-records/record.mjs?w2-rework2-tester=${runs}`, ROOT).href);
  return async () => {
    for (let i = 0; i < 3000 && finished(logs) < nth; i++) await new Promise((r) => setTimeout(r, 1));
    assert(finished(logs) >= nth, `run ${nth} finished`);
  };
}

async function withRunner(gh: FakeGitHub, fn: (logs: string[]) => Promise<void>) {
  const g = globalThis as Any;
  const before = { process: g.process, fetch: g.fetch, log: console.log };
  const env = nodeProcess.env as Record<string, string | undefined>;
  const saved = { p: env.GITHUB_EVENT_PATH, t: env.GITHUB_TOKEN, r: env.GITHUB_REPOSITORY };
  const logs: string[] = [];
  try {
    g.process = nodeProcess;
    g.fetch = (input: Any, init?: Any) => gh.fetch(input, init);
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    await fn(logs);
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

void read;

const records = (gh: FakeGitHub) =>
  (gh.comments.get(3980) ?? []).filter((c) => c.user.login === "github-actions[bot]" && c.body.includes("mingla-release-record:pr-4100"));
const FULL_READ = /\/issues\/3980\/comments\?per_page=100$/;
const method = (init: Any) => String(init?.method ?? "GET").toUpperCase();

/** Runs fn after the n-th call that matches, once. */
function after(gh: FakeGitHub, match: (input: string, init: Any) => boolean, nth: number, fn: () => void) {
  const realFetch = gh.fetch;
  let seen = 0;
  gh.fetch = async (input: Any, init: Any = {}) => {
    const res = await realFetch(input, init);
    if (match(String(input), init) && ++seen === nth) fn();
    return res;
  };
}

Deno.test("#3980 tester stabilize: a live check that lands in the window with no run to record it is found by the re-read alone", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "applied" }];
    // Right after run A's last read before writing, Seth writes the live check; no comment run follows.
    after(gh, (u, i) => method(i) === "GET" && FULL_READ.test(u), 1, () =>
      gh.addComment(3980, "Live check: nobody recorded this one", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z"));
    await (await startRun("status_merge_commit.json", logs, 2))();
    assertEquals(records(gh).length, 1);
    const data = readRecordData(records(gh)[0].body);
    assertEquals(data.migrations_applied_state, "applied");
    assertEquals(data.live_check?.text, "nobody recorded this one");
    assertEquals(data.live_check?.by_login, "sethogieva");
  });
});

Deno.test("#3980 tester stabilize: a stranger's live check, and one dated before the merge, are never taken by the re-read", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "applied" }];
    after(gh, (u, i) => method(i) === "GET" && FULL_READ.test(u), 1, () => {
      gh.addComment(3980, "Live check: a stranger says it is live", "drive-by", "User", "NONE", "2026-10-21T12:00:00Z");
      gh.addComment(3980, "Live check: before the merge", "sethogieva", "User", "OWNER", "2026-10-21T09:00:00Z");
    });
    await (await startRun("status_merge_commit.json", logs, 2))();
    const data = readRecordData(records(gh)[0].body);
    assertEquals(data.migrations_applied_state, "applied");
    assertEquals(data.live_check, null);
  });
});

Deno.test("#3980 tester stabilize: endless churn still ends, with at most three re-merge writes and one record", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    let minute = 10;
    let patches = 0;
    let posts = 0;
    const realFetch = gh.fetch;
    gh.fetch = async (input: Any, init: Any = {}) => {
      if (method(init) === "PATCH") patches += 1;
      if (method(init) === "POST") posts += 1;
      const res = await realFetch(input, init);
      // Every full read finds a newer trusted live check than the last.
      if (method(init) === "GET" && FULL_READ.test(String(input))) {
        minute += 1;
        gh.addComment(3980, `Live check: round ${minute}`, "sethogieva", "User", "OWNER", `2026-10-21T12:${String(minute).padStart(2, "0")}:00Z`);
      }
      return res;
    };
    await (await startRun("push_main.json", logs, 2))();
    assert(patches <= 4, `${patches} writes`);
    assertEquals(posts, 0, "the record existed: nothing is posted");
    assertEquals(records(gh).length, 1);
    assert(logs.some((l) => /#3980 \(still changing after 3 re-reads\)/.test(l)), logs.join("\n"));
  });
});

Deno.test("#3980 tester stabilize: a second record posted by another run in the window leaves exactly one, and the re-read never posts", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    const original = records(gh)[0];
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "applied" }];
    let posts = 0;
    const realFetch = gh.fetch;
    gh.fetch = async (input: Any, init: Any = {}) => {
      if (method(init) === "POST") posts += 1;
      return realFetch(input, init);
    };
    // Right after run A's write, another run posts a second record for the same pull request.
    after(gh, (_u, i) => method(i) === "PATCH", 1, () => gh.addComment(3980, original.body.replace("pending", "pending (other run)")));
    await (await startRun("status_merge_commit.json", logs, 2))();
    assertEquals(posts, 0, "run A posted nothing (the other run's comment was added by the stand-in)");
    assertEquals(records(gh).length, 1);
    assertEquals(records(gh)[0].id, original.id, "the oldest record survives");
    assertEquals(readRecordData(records(gh)[0].body).migrations_applied_state, "applied");
  });
});

Deno.test("#3980 tester stabilize: a record deleted in the window is never posted again by the re-read", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "applied" }];
    let posts = 0;
    const realFetch = gh.fetch;
    gh.fetch = async (input: Any, init: Any = {}) => {
      if (method(init) === "POST") posts += 1;
      return realFetch(input, init);
    };
    after(gh, (_u, i) => method(i) === "PATCH", 1, () => gh.comments.set(3980, (gh.comments.get(3980) ?? []).filter((c) => !c.body.includes("mingla-release-record:pr-4100"))));
    await (await startRun("status_merge_commit.json", logs, 2))();
    assertEquals(posts, 0);
    assertEquals(records(gh).length, 0);
    assert(logs.some((l) => /#3980 \(record gone on re-read\)/.test(l)), logs.join("\n"));
  });
});
