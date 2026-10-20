// Issue #3980 synced program, Wave 2 rework — the implementor's regression
// suite for the tester's CONDITIONAL verdict, JavaScript side:
//   P3 follow   an answer about another repository (a transferred issue
//               whose old number matches) is left out and its title is never
//               taken; the query asks every node for its repository
//   P3 record   a live check written by one run is never lost when a run in
//               another queue (a deploy status for the same merge) writes
//               after it; a deleted live-check comment stops counting
//   P4          recordCommentFor is a test helper only; the runner uses
//               recordCommentsFor
// Runs the record runner in-process against a stand-in GitHub API (no network).
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import { buildFollowQuery, followNodeInRepo, parseFollowResponse } from "../productAvengers.ts";
import { mergeRecordData, readRecordData, recordProblems, renderRecord } from "../../../../.github/scripts/release-records/lib.mjs";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const SHA = "1234567890abcdef1234567890abcdef12345678";
const MERGED_AT = "2026-10-21T09:30:00Z";

// ---------------------------------------------------------------------------
// P3 follow: another repository's answer is left out.
// ---------------------------------------------------------------------------
Deno.test("#3980 W2 rework follow: an answer naming another repository is left out, this repository's is kept", () => {
  const items = parseFollowResponse([4410, 4411, 4412, 4413], {
    data: { repository: {
      n4410: { __typename: "Issue", number: 4410, title: "Private roadmap item", url: "https://github.com/Mingla-LLC/private-ops/issues/4410", state: "CLOSED" },
      n4411: { __typename: "Issue", number: 4411, title: "Moved by repository", repository: { nameWithOwner: "Mingla-LLC/private-ops" },
        url: "https://github.com/Mingla-LLC/mingla-main/issues/4411", state: "OPEN" },
      n4412: { __typename: "PullRequest", number: 4412, title: "Ours", repository: { nameWithOwner: REPO },
        url: "https://github.com/Mingla-LLC/mingla-main/pull/4412", state: "OPEN", merged: false },
      n4413: { __typename: "Issue", number: 4413, title: "Address of another number", url: "https://github.com/Mingla-LLC/mingla-main/issues/1", state: "OPEN" },
    } },
  });
  assertEquals(items.map((i) => `${i.number}:${i.title}`), ["4412:Ours"]);
  assert(!JSON.stringify(items).includes("Private roadmap item"), "another repository's title is never taken");
  assertEquals(followNodeInRepo({ repository: null }, 1), false, "a repository GitHub would not name is not ours");
  assertEquals(followNodeInRepo({ url: "https://github.com/mingla-llc/MINGLA-MAIN/issues/1" }, 1), false, "the address must be exact");
  assertEquals(followNodeInRepo({ repository: { nameWithOwner: REPO }, url: `https://github.com/${REPO}/issues/7` }, 7), true);
  // [TEST-MOD-APPROVED #3980] W2 rework 2: issueOrPullRequest is a union, so repository is asked inside both fragments, never directly on it
  assertMatch(buildFollowQuery([5]), /n5: issueOrPullRequest\(number: 5\) \{ __typename \.\.\. on Issue \{ repository \{ nameWithOwner \} .*\.\.\. on PullRequest \{ repository \{ nameWithOwner \} /);
});

// ---------------------------------------------------------------------------
// P3 record: the pure merge.
// ---------------------------------------------------------------------------
const base = () => ({
  v: 1, repo: REPO, pr: 4100, title: "toward #3980: the synced system", pr_url: `https://github.com/${REPO}/pull/4100`,
  merged_at: MERGED_AT, merge_sha: SHA, merged_by: "m", author: "a", issues: [{ number: 3980, relation: "toward" }],
  migrations_added: [], migrations_applied_state: "none", migrations_status: null, edge_functions: [], web_projects: [],
  deploy_marker: false, deploy: { web: {}, edge: "none" }, feature_guide: [], live_check: null as Any, test_files: [], problems: [] as string[],
});
const check = (id: number, at: string, text = "looked at production") =>
  ({ text, by_login: "sethogieva", url: `https://github.com/${REPO}/issues/3980#issuecomment-${id}`, at });

Deno.test("#3980 W2 rework record: the merge keeps the newer live check made after the merge and works out the problems again", () => {
  const fresh = base();
  fresh.problems = recordProblems(fresh);
  assert(fresh.problems.includes("live_check_missing"));
  const kept = mergeRecordData(fresh, { ...base(), live_check: check(1, "2026-10-21T12:00:00Z") });
  assertEquals(kept.live_check?.url, check(1, "").url);
  assert(!kept.problems.includes("live_check_missing"), "the problems follow the kept live check");
  const newer = mergeRecordData({ ...base(), live_check: check(2, "2026-10-21T13:00:00Z") }, { ...base(), live_check: check(1, "2026-10-21T12:00:00Z") });
  assertEquals(newer.live_check?.url, check(2, "").url, "this run's newer live check wins");
  const older = mergeRecordData({ ...base(), live_check: check(2, "2026-10-21T11:00:00Z") }, { ...base(), live_check: check(1, "2026-10-21T12:00:00Z") });
  assertEquals(older.live_check?.url, check(1, "").url, "the record's newer live check wins");
  assertEquals(mergeRecordData(fresh, { ...base(), live_check: check(1, "2026-10-21T08:00:00Z") }).live_check, null, "never one from before the merge");
  assertEquals(mergeRecordData(fresh, { ...base(), pr: 4101, live_check: check(1, "2026-10-21T12:00:00Z") }).live_check, null, "never another pull request's");
});

// ---------------------------------------------------------------------------
// P3 record: two runs in different queues.
// ---------------------------------------------------------------------------
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
  await import(new URL(`.github/scripts/release-records/record.mjs?w2-rework=${runs}`, ROOT).href);
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

const records = (gh: FakeGitHub) =>
  (gh.comments.get(3980) ?? []).filter((c) => c.user.login === "github-actions[bot]" && c.body.includes("mingla-release-record:pr-4100"));

Deno.test("#3980 W2 rework record: a deploy-status run that read the comments before a live check never drops it", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    // The record as the merge wrote it: migrations pending, no live check.
    await (await startRun("push_main.json", logs, 1))();
    assertEquals(records(gh).length, 1);
    assertEquals(readRecordData(records(gh)[0].body).live_check, null);

    // Run A (the production-migrations status) reads the comments for live
    // checks, then waits here, before it writes.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    const realFetch = gh.fetch;
    gh.fetch = async (input: Any, init: Any = {}) => {
      const res = await realFetch(input, init);
      if (!held && /issues\/3980\/comments\?since=/.test(String(input))) {
        held = true;
        await gate;
      }
      return res;
    };
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "applied" }];
    const doneA = await startRun("status_merge_commit.json", logs, 3);
    for (let i = 0; i < 500 && !held; i++) await new Promise((r) => setTimeout(r, 1));
    assert(held, "run A read the comments before the live check existed");

    // Meanwhile Seth writes the live check and run B (the comment) records it.
    gh.addComment(3980, "Live check: the Work board shows the chip", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z");
    await (await startRun("comment_live_check_3980.json", logs, 2))();
    assertEquals(readRecordData(records(gh)[0].body).live_check?.text, "the Work board shows the chip", "run B wrote the live check");

    // Run A writes last.
    release();
    await doneA();
    assertEquals(records(gh).length, 1);
    const data = readRecordData(records(gh)[0].body);
    assertEquals(data.migrations_applied_state, "applied", "run A's news is written");
    assertEquals(data.live_check?.text, "the Work board shows the chip", "and the live check run B wrote is kept");
    assert(!data.problems.includes("live_check_missing"));
    assert(gh.calls.some((c) => c.method === "GET" && /\/issues\/comments\/\d+$/.test(c.path)), "the kept live check was read again from GitHub");
  });
});

Deno.test("#3980 W2 rework record: a live check whose comment was deleted stops counting on the next run", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    const live = gh.addComment(3980, "Live check: looked fine", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z");
    await (await startRun("push_main.json", logs, 1))();
    assertEquals(readRecordData(records(gh)[0].body).live_check?.url, live.html_url);
    gh.comments.set(3980, (gh.comments.get(3980) ?? []).filter((c) => c.id !== live.id));
    await (await startRun("push_main.json", logs, 2))();
    assertEquals(readRecordData(records(gh)[0].body).live_check, null, "a deleted comment is no live check");
  });
});

Deno.test("#3980 W2 rework record: a record's live check is kept only from its own pull request's issue comment address", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    // A record whose live check points somewhere else is never followed.
    const rec = records(gh)[0];
    const d = readRecordData(rec.body);
    rec.body = renderRecord({ ...d, live_check: { text: "x", by_login: "y", url: "https://evil.example/c#issuecomment-1", at: "2026-10-21T12:00:00Z" } });
    await (await startRun("push_main.json", logs, 2))();
    assertEquals(readRecordData(records(gh)[0].body).live_check, null);
    assert(!gh.calls.some((c) => c.method === "GET" && /\/issues\/comments\/1$/.test(c.path)));
  });
});

// ---------------------------------------------------------------------------
// P4: recordCommentFor is a test helper.
// ---------------------------------------------------------------------------
Deno.test("#3980 W2 rework P4: the runner finds records with recordCommentsFor; recordCommentFor is marked a test helper", () => {
  const runner = read(".github/scripts/release-records/record.mjs");
  assert(!/\brecordCommentFor\b/.test(runner), "record.mjs does not use recordCommentFor");
  assertMatch(runner, /\brecordCommentsFor\b/);
  const lib = read(".github/scripts/release-records/lib.mjs");
  assertMatch(lib, /Test helper only: record\.mjs uses recordCommentsFor[^\n]*\n[^\n]*\n \*\/\nexport function recordCommentFor\(/);
});
