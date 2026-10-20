// Issue #3980 synced program, Wave 2 rework 2 — the record runner reads its
// record back after writing and merges again until it holds (at most three
// rounds). A run that read the comments, then waited while another run wrote
// a live check, used to overwrite that live check when it finally wrote; the
// re-read finds the live check again and writes it back.
// Runs the record runner in-process against a stand-in GitHub API (no network).
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
  await import(new URL(`.github/scripts/release-records/record.mjs?w2-rework2=${runs}`, ROOT).href);
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

/** Holds the first full comment read of #3980 (the read right before a write) until released. */
function holdFullRead(gh: FakeGitHub) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const state = { held: false };
  const realFetch = gh.fetch;
  gh.fetch = async (input: Any, init: Any = {}) => {
    const res = await realFetch(input, init);
    if (!state.held && /\/issues\/3980\/comments\?per_page=100$/.test(String(input))) {
      state.held = true;
      await gate;
    }
    return res;
  };
  return { state, release };
}

Deno.test("#3980 W2 rework 2 record: a live check written between a run's last read and its write is written back", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    assertEquals(readRecordData(records(gh)[0].body).live_check, null);

    // Run A (the production-migrations status) has read every comment and is
    // about to write a record without a live check.
    const hold = holdFullRead(gh);
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "applied" }];
    const doneA = await startRun("status_merge_commit.json", logs, 3);
    for (let i = 0; i < 500 && !hold.state.held; i++) await new Promise((r) => setTimeout(r, 1));
    assert(hold.state.held, "run A read the record before the live check existed");

    // In that window Seth writes the live check and run B records it.
    gh.addComment(3980, "Live check: the chip reads Live", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z");
    await (await startRun("comment_live_check_3980.json", logs, 2))();
    assertEquals(readRecordData(records(gh)[0].body).live_check?.text, "the chip reads Live", "run B wrote the live check");

    // Run A writes what it read (no live check), then reads back and merges again.
    hold.release();
    await doneA();
    assertEquals(records(gh).length, 1);
    const data = readRecordData(records(gh)[0].body);
    assertEquals(data.migrations_applied_state, "applied", "run A's news is written");
    assertEquals(data.live_check?.text, "the chip reads Live", "and the live check is back after the re-read");
    assert(!data.problems.includes("live_check_missing"));
    assert(logs.some((l) => /^release-record: PR #4100: .*#3980 \(re-merged 1x\)/.test(l)), logs.join("\n"));
  });
});

Deno.test("#3980 W2 rework 2 record: the re-read stops after three rounds when the record keeps changing", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    gh.addComment(3980, "Live check: looked fine", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z");
    await (await startRun("push_main.json", logs, 1))();
    assertEquals(readRecordData(records(gh)[0].body).live_check?.text, "looked fine");
    // From here on GitHub answers every edit of the record but keeps the old body.
    const stale = records(gh)[0].body.replace(/"live_check":\{[^}]*\}/, '"live_check":null');
    records(gh)[0].body = stale;
    const realFetch = gh.fetch;
    let patches = 0;
    gh.fetch = async (input: Any, init: Any = {}) => {
      if ((init.method ?? "GET").toUpperCase() === "PATCH") {
        patches += 1;
        return new Response(JSON.stringify({ id: 1 }), { status: 200 });
      }
      return realFetch(input, init);
    };
    await (await startRun("push_main.json", logs, 2))();
    assertEquals(patches, 1 + 3, "one write, then at most three re-merges");
    assert(logs.some((l) => /#3980 \(still changing after 3 re-reads\)/.test(l)), logs.join("\n"));
  });
});

Deno.test("#3980 W2 rework 2 record: a record that holds after the write is read once more and not written again", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    const writes = gh.calls.filter((c) => c.method === "POST" || c.method === "PATCH").length;
    assertEquals(writes, 1, "the record is posted once and the re-read finds it as written");
    assertEquals(gh.calls.filter((c) => c.method === "GET" && c.path === `/repos/${REPO}/issues/3980/comments?per_page=100`).length >= 3, true,
      "read before writing, once by the duplicate check after posting, and once more by the re-read");
    const runner = read(".github/scripts/release-records/record.mjs");
    assertMatch(runner, /const STABLE_ROUNDS = 3;/);
    assertMatch(runner, /const settled = await stabilize\(t, number, merged\);/);
  });
});
