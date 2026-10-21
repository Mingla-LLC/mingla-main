// Issue #3980 synced program, Wave 2 rework 3 — the record runner keeps EVERY
// field a racing run wrote, not only the live check (tester's P3), and a
// failed read-back after a write no longer stops the PR's other linked
// issues (tester's P4).
//   - mergeRecordData, pure: migrations applied, the deploy states, the
//     Feature Guide and the live check move forward only (pending -> value,
//     never back to pending); a field only the other record has survives;
//     between two results this run's wins.
//   - in-process runs against a stand-in GitHub API (no network): the
//     comment run reads before the migrations-status run writes "applied",
//     then writes its older snapshot; the record ends "applied" with the live
//     check. A racer that keeps writing the old snapshot back: three re-merge
//     rounds at most, one record. A read-back failure on one issue: the other
//     issue still gets its record, the log says ERROR, the run exits 1.
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import { mergeRecordData, readRecordData, recordProblems, renderRecord } from "../../../../.github/scripts/release-records/lib.mjs";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const SHA = "1234567890abcdef1234567890abcdef12345678";
const MERGED_AT = "2026-10-21T09:30:00Z";

// ---------------------------------------------------------------------------
// Pure merge
// ---------------------------------------------------------------------------
const base = (over: Record<string, unknown> = {}): Any => {
  const d: Any = {
    v: 1, repo: REPO, pr: 4100, title: "toward #3980: x", pr_url: `https://github.com/${REPO}/pull/4100`,
    merged_at: MERGED_AT, merge_sha: SHA, merged_by: "m", author: "a",
    issues: [{ number: 3980, relation: "toward" }], migrations_added: ["20271201003980_x.sql"],
    migrations_applied_state: "pending", migrations_status: null, edge_functions: ["ops-sync"],
    web_projects: ["mingla-admin", "mingla-business"], deploy_marker: true,
    deploy: { web: { "mingla-admin": "pending", "mingla-business": "pending" }, edge: "pending" },
    feature_guide: null, live_check: null, test_files: [], problems: [], ...over,
  };
  d.problems = recordProblems(d);
  return d;
};
const lc = (id: number, at: string) => ({ text: "looked", by_login: "sethogieva", url: `https://github.com/${REPO}/issues/3980#issuecomment-${id}`, at });

Deno.test("#3980 W2 rework 3: migrations applied moves forward only and keeps its status line", () => {
  const theirs = base({ migrations_applied_state: "applied", migrations_status: "2 of 2 applied" });
  const out = mergeRecordData(base(), theirs);
  assertEquals([out.migrations_applied_state, out.migrations_status], ["applied", "2 of 2 applied"], "pending -> applied");
  const back = mergeRecordData(base({ migrations_applied_state: "applied", migrations_status: "ok" }), base());
  assertEquals([back.migrations_applied_state, back.migrations_status], ["applied", "ok"], "never back to pending");
});

Deno.test("#3980 W2 rework 3: deploy states move forward key by key; a result beats pending, this run's result beats theirs", () => {
  const mine = base({ deploy: { web: { "mingla-admin": "ready", "mingla-business": "pending" }, edge: "pending" } });
  const theirs = base({ deploy: { web: { "mingla-admin": "pending", "mingla-business": "failed" }, edge: "deployed" } });
  assertEquals(mergeRecordData(mine, theirs).deploy, { web: { "mingla-admin": "ready", "mingla-business": "failed" }, edge: "deployed" });
  const both = mergeRecordData(base({ deploy: { web: { "mingla-admin": "ready", "mingla-business": "ready" }, edge: "deployed" } }),
    base({ deploy: { web: { "mingla-admin": "failed", "mingla-business": "failed" }, edge: "failed" } }));
  assertEquals(both.deploy, { web: { "mingla-admin": "ready", "mingla-business": "ready" }, edge: "deployed" }, "two results: this run's");
  assertEquals(mergeRecordData(mine, theirs).problems.includes("web_deploy_failed"), true, "problems worked out again");
});

Deno.test("#3980 W2 rework 3: the Feature Guide and the live check move forward only", () => {
  const out = mergeRecordData(base(), base({ feature_guide: ["staff-x"], live_check: lc(7, "2026-10-21T12:00:00Z") }));
  assertEquals(out.feature_guide, ["staff-x"]);
  assertEquals(out.live_check?.url, lc(7, "x").url);
  assertEquals(out.problems.includes("feature_guide_missing") || out.problems.includes("live_check_missing"), false);
  const kept = mergeRecordData(base({ feature_guide: ["staff-y"], live_check: lc(8, "2026-10-21T13:00:00Z") }),
    base({ feature_guide: ["staff-x"], live_check: lc(7, "2026-10-21T12:00:00Z") }));
  assertEquals([kept.feature_guide, kept.live_check?.url], [["staff-y"], lc(8, "x").url], "this run's newer results win");
  const bad = mergeRecordData(base({ feature_guide_bad: ["nope"] }), base({ feature_guide: ["staff-x"] }));
  assertEquals([bad.feature_guide, "feature_guide_bad" in bad], [["staff-x"], false], "a missing guide never replaces one already recorded");
});

Deno.test("#3980 W2 rework 3: a field only the other record has survives; another PR's record changes nothing", () => {
  const out = mergeRecordData(base(), base({ ops_note: "written by a newer run", deploy: { web: { "mingla-admin": "pending", "mingla-business": "pending", "mingla-sites": "ready" }, edge: "pending" } }));
  assertEquals(out.ops_note, "written by a newer run");
  assertEquals(out.deploy.web["mingla-sites"], "ready");
  const other = mergeRecordData(base(), base({ pr: 4101, migrations_applied_state: "applied" }));
  assertEquals(other.migrations_applied_state, "pending");
  const same = base();
  assertEquals(mergeRecordData(same, base()) === same, true, "nothing new: this run's record as it is");
});

// ---------------------------------------------------------------------------
// The runner, against a stand-in GitHub
// ---------------------------------------------------------------------------
type Comment = { id: number; body: string; user: { login: string; type: string }; author_association: string; created_at: string; updated_at: string; html_url: string };

class FakeGitHub {
  calls: { method: string; path: string }[] = [];
  comments = new Map<number, Comment[]>();
  statuses: Any[] = [];
  issues = [3980];
  nextId = 9100;
  failRead: (issue: number, n: number) => boolean = () => false;
  reads = new Map<number, number>();

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
      return Promise.resolve(json(200, { number: 4100, title: "toward #3980: the synced system",
        body: `Issue: ${this.issues.map((n) => `toward #${n}`).join(", ")}\n\nFeature Guide: none\n`,
        merged_at: MERGED_AT, merge_commit_sha: SHA, base: { ref: "main" }, merged_by: { login: "m" }, user: { login: "a" } }));
    }
    if (method === "GET" && (m = new RegExp(`^${b}/issues/(\\d+)$`).exec(path)) && this.issues.includes(Number(m[1]))) {
      return Promise.resolve(json(200, { number: Number(m[1]) }));
    }
    if (method === "GET" && (m = new RegExp(`^${b}/issues/comments/(\\d+)$`).exec(path))) {
      for (const list of this.comments.values()) {
        const c = list.find((x) => x.id === Number(m![1]));
        if (c) return Promise.resolve(json(200, c));
      }
      return Promise.resolve(json(404, { message: "Not Found" }));
    }
    if (method === "GET" && (m = new RegExp(`^${b}/issues/(\\d+)/comments$`).exec(path))) {
      const issue = Number(m[1]);
      let all = this.comments.get(issue) ?? [];
      const since = url.searchParams.get("since");
      if (!since) {
        const n = (this.reads.get(issue) ?? 0) + 1;
        this.reads.set(issue, n);
        if (this.failRead(issue, n)) return Promise.resolve(json(502, { message: "Bad Gateway" }));
      }
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

async function startRun(fixture: string, logs: string[], nth: number) {
  const env = nodeProcess.env as Record<string, string | undefined>;
  env.GITHUB_EVENT_PATH = decodeURIComponent(new URL(fixture, FIXTURES).pathname);
  env.GITHUB_TOKEN = "test-token-not-real";
  env.GITHUB_REPOSITORY = REPO;
  runs += 1;
  await import(new URL(`.github/scripts/release-records/record.mjs?w2-rework3=${runs}`, ROOT).href);
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

const records = (gh: FakeGitHub, issue = 3980) =>
  (gh.comments.get(issue) ?? []).filter((c) => c.user.login === "github-actions[bot]" && c.body.includes("mingla-release-record:pr-4100"));

Deno.test("#3980 W2 rework 3: a racing run's 'migrations applied' survives the run that read before it wrote", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    assertEquals(readRecordData(records(gh)[0].body).migrations_applied_state, "pending");
    gh.addComment(3980, "Live check: the chip reads Live", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z");
    // Hold the comment run (B) at its read right before writing (its second full read).
    const realFetch = gh.fetch;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    let fullReads = 0;
    gh.fetch = async (input: Any, init: Any = {}) => {
      const res = await realFetch(input, init);
      if (/\/issues\/3980\/comments\?per_page=100$/.test(String(input)) && ++fullReads === 2 && !held) { held = true; await gate; }
      return res;
    };
    const doneB = await startRun("comment_live_check_3980.json", logs, 3);
    for (let i = 0; i < 1000 && !held; i++) await new Promise((r) => setTimeout(r, 1));
    assert(held, "the comment run is held between its read and its write");
    // The migrations-status run (A) runs freely and writes "applied".
    gh.fetch = realFetch;
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "1 of 1 applied" }];
    await (await startRun("status_merge_commit.json", logs, 2))();
    assertEquals(readRecordData(records(gh)[0].body).migrations_applied_state, "applied");
    release();
    await doneB();
    const d = readRecordData(records(gh)[0].body);
    assertEquals(records(gh).length, 1, "one record");
    assertEquals(d.migrations_applied_state, "applied", "never back to pending");
    assertEquals(d.migrations_status, "1 of 1 applied");
    assertEquals(d.live_check?.text, "the chip reads Live");
    assertMatch(records(gh)[0].body, /- Migrations applied: all applied \(1 of 1 applied\)/);
    assert(!records(gh)[0].body.includes("migrations applied to production"), "Status no longer asks for it");
  });
});

Deno.test("#3980 W2 rework 3: a racer that keeps writing an old snapshot: at most three re-merges, one record, no new comment", async () => {
  const gh = new FakeGitHub();
  gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "1 of 1 applied" }];
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    const stale = records(gh)[0].body.replace(/"migrations_applied_state":"applied"/, '"migrations_applied_state":"pending"')
      .replace("- Migrations applied: all applied (1 of 1 applied)", "- Migrations applied: pending: Mingla checks the production ledger every 5 minutes");
    assert(stale !== records(gh)[0].body);
    const realFetch = gh.fetch;
    gh.fetch = async (input: Any, init: Any = {}) => {
      const res = await realFetch(input, init);
      if ((init.method ?? "GET").toUpperCase() === "PATCH") records(gh)[0].body = stale; // the racer writes its old snapshot back
      return res;
    };
    records(gh)[0].body = stale;
    const before = gh.calls.length;
    await (await startRun("status_merge_commit.json", logs, 2))();
    const mine = gh.calls.slice(before);
    assert(mine.filter((c) => c.method === "PATCH").length <= 4, "the write plus at most three re-merges");
    assertEquals(mine.filter((c) => c.method === "POST").length, 0, "never a new comment");
    assertEquals(records(gh).length, 1);
    assertMatch(logs.at(-1) ?? "", /still changing after 3 re-reads/);
  });
});

Deno.test("#3980 W2 rework 3: a failed read-back on one issue is loud, the other issue still gets its record, the run exits 1", async () => {
  const gh = new FakeGitHub();
  gh.issues = [3980, 3981];
  // #3980: the read before writing works; every read after the write fails.
  gh.failRead = (issue, n) => issue === 3980 && n >= 2;
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 2))();
    const stopped = logs.find((l) => l.startsWith("release-record: stopped"));
    assertEquals(records(gh, 3980).length, 1, "#3980 got its record before the read-back failed");
    assertEquals(records(gh, 3981).length, 1, "#3981 still got its record");
    assertEquals(readRecordData(records(gh, 3981)[0].body).pr, 4100);
    assert(logs.some((l) => /^release-record: ERROR: PR #4100: the record on #3980 was written but reading it back failed/.test(l)), logs.join("\n"));
    assertMatch(logs.find((l) => l.startsWith("release-record: PR #4100:")) ?? "", /#3980 written, read-back failed.*#3981 created \(HTTP 201\)/);
    assertMatch(stopped ?? "", /the record could not be read back on #3980/);
    assertEquals(nodeProcess.exitCode, 1, "the run ends non-zero");
  });
});

Deno.test("#3980 W2 rework 3: a field a newer run wrote that this run does not know survives this run's write", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    const d = readRecordData(records(gh)[0].body);
    records(gh)[0].body = renderRecord({ ...d, ops_note: "from a newer runner", feature_guide: ["staff-x"] });
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "1 of 1 applied" }];
    await (await startRun("status_merge_commit.json", logs, 2))();
    const after = readRecordData(records(gh)[0].body);
    assertEquals(after.ops_note, "from a newer runner");
    assertEquals(after.migrations_applied_state, "applied", "this run's own news is written");
    assertEquals(after.feature_guide, [], "between two results (the PR says none), what GitHub says now wins");
    assertEquals(records(gh).length, 1);
  });
});

void renderRecord;
