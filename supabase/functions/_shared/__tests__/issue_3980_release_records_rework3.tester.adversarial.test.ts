// Issue #3980 synced program, Wave 2 rework 3 — TESTER adversarial suite for
// the generic forward-only record merge and the GitHub re-read in the
// read-back. Different angles from the implementor's suite:
//   A1  property: over every combination of field states, the merge never
//       moves a result back to pending, and re-merging the result with either
//       input changes nothing (no flip-flop between two racing runs).
//   A4  API cost: one run with three linked issues re-reads the pull request
//       at most 1 + 3 x 3 times, and once per issue when nothing changes.
//   A5  the Feature Guide: a racing record's valid list is never replaced by
//       a run that saw no Feature Guide line, and GitHub's current "none" is
//       written back (what the PR says now wins).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import { mergeRecordData, readRecordData, recordProblems, renderRecord } from "../../../../.github/scripts/release-records/lib.mjs";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const SHA = "1234567890abcdef1234567890abcdef12345678";
const MERGED_AT = "2026-10-21T09:30:00Z";

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
  await import(new URL(`.github/scripts/release-records/record.mjs?w2-rework3-tester=${runs}`, ROOT).href);
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

const gets = (gh: FakeGitHub, from: number, re: RegExp) => gh.calls.slice(from).filter((c) => c.method === "GET" && re.test(c.path)).length;
const PR_GET = /^\/repos\/Mingla-LLC\/mingla-main\/pulls\/4100$/;

// ---------------------------------------------------------------------------
// A1  property: forward only, and no flip-flop
// ---------------------------------------------------------------------------
const lc = (id: number, at: string) => ({ text: "looked", by_login: "sethogieva", url: `https://github.com/${REPO}/issues/3980#issuecomment-${id}`, at });
const MIG = [["pending", null], ["applied", "1 of 1 applied"]] as const;
const WEB = ["pending", "ready", "failed"];
const EDGE = ["pending", "deployed", "failed"];
const GUIDE: Any[] = [null, [], ["staff-x"], ["staff-y", "staff-z"]];
const LIVE: Any[] = [null, lc(7, "2026-10-21T12:00:00Z"), lc(8, "2026-10-21T13:00:00Z")];
function rec(m: number, w: number, e: number, g: number, l: number): Any {
  const d: Any = {
    v: 1, repo: REPO, pr: 4100, title: "toward #3980: x", pr_url: `https://github.com/${REPO}/pull/4100`,
    merged_at: MERGED_AT, merge_sha: SHA, merged_by: "m", author: "a", issues: [{ number: 3980, relation: "toward" }],
    migrations_added: ["20271201003980_x.sql"], migrations_applied_state: MIG[m][0], migrations_status: MIG[m][1],
    edge_functions: ["ops-sync"], web_projects: ["mingla-admin"], deploy_marker: true,
    deploy: { web: { "mingla-admin": WEB[w] }, edge: EDGE[e] }, feature_guide: GUIDE[g], live_check: LIVE[l], test_files: [], problems: [],
  };
  d.problems = recordProblems(d);
  return d;
}
const all: Any[] = [];
for (let m = 0; m < MIG.length; m++) for (let w = 0; w < WEB.length; w++) for (let e = 0; e < EDGE.length; e++)
  for (let g = 0; g < GUIDE.length; g++) for (let l = 0; l < LIVE.length; l++) all.push(rec(m, w, e, g, l));
const pending = (v: unknown) => v === undefined || v === null || v === "pending";

Deno.test("#3980 W2 rework 3 tester A1: no field moves back to pending, and a merged record is a fixed point for both racers", () => {
  let pairs = 0;
  for (let i = 0; i < all.length; i += 3) {
    for (let j = 0; j < all.length; j += 5) {
      const a = all[i], b = all[j];
      const m = mergeRecordData(a, b);
      pairs++;
      const fields: [string, (d: Any) => unknown][] = [
        ["migrations", (d) => d.migrations_applied_state], ["web", (d) => d.deploy.web["mingla-admin"]],
        ["edge", (d) => d.deploy.edge], ["guide", (d) => d.feature_guide], ["live", (d) => d.live_check],
      ];
      for (const [name, f] of fields) {
        if (!pending(f(a)) || !pending(f(b))) assert(!pending(f(m)), `${name} went back to pending: ${JSON.stringify([f(a), f(b), f(m)])}`);
      }
      // No flip-flop: once merged, merging again with either racer's record changes nothing.
      assertEquals(JSON.stringify(mergeRecordData(m, a)), JSON.stringify(m), `re-merge with mine moved ${i},${j}`);
      assertEquals(JSON.stringify(mergeRecordData(m, b)), JSON.stringify(m), `re-merge with theirs moved ${i},${j}`);
      assertEquals(JSON.stringify(m.problems), JSON.stringify(recordProblems(m)), "problems match the merged fields");
    }
  }
  assert(pairs > 1000, `checked ${pairs} pairs`);
});

// ---------------------------------------------------------------------------
// A4  API cost is bounded
// ---------------------------------------------------------------------------
Deno.test("#3980 W2 rework 3 tester A4: three linked issues: the PR is re-read once per issue when stable, at most 1 + 3x3 when churning", async () => {
  const gh = new FakeGitHub();
  gh.issues = [3980, 3981, 3982];
  await withRunner(gh, async (logs) => {
    let from = gh.calls.length;
    await (await startRun("push_main.json", logs, 1))();
    const firstPr = gets(gh, from, PR_GET);
    const firstAll = gh.calls.length - from;
    assertEquals(firstPr, 1 + 3, `first run: 1 read + 1 read-back per issue (got ${firstPr}, ${firstAll} calls)`);
    // Stable re-run: nothing changes, nothing is written.
    from = gh.calls.length;
    await (await startRun("status_merge_commit.json", logs, 2))();
    const stable = gh.calls.slice(from);
    assertEquals(stable.filter((c) => c.method !== "GET").length, 0, "a stable refresh writes nothing");
    assert(gets(gh, from, PR_GET) <= 1 + 3, `stable: ${gets(gh, from, PR_GET)} PR reads`);
    // A racer rewrites a stale record after every write on every issue.
    const realFetch = gh.fetch;
    gh.statuses = [{ context: "mingla/production-migrations", state: "success", description: "1 of 1 applied" }];
    const stale = new Map([3980, 3981, 3982].map((t) => [t, records(gh, t)[0].body]));
    gh.fetch = async (input: Any, init: Any = {}) => {
      const res = await realFetch(input, init);
      if ((init.method ?? "GET").toUpperCase() === "PATCH") for (const t of [3980, 3981, 3982]) records(gh, t)[0].body = stale.get(t)!;
      return res;
    };
    from = gh.calls.length;
    await (await startRun("status_merge_commit.json", logs, 3))();
    const churn = gh.calls.slice(from);
    const prReads = gets(gh, from, PR_GET);
    assert(prReads <= 1 + 3 * 3, `churn: ${prReads} PR reads`);
    assert(churn.filter((c) => c.method === "PATCH").length <= 3 * 4, "a write plus at most three re-merges per issue");
    assertEquals(churn.filter((c) => c.method === "POST").length, 0, "never a new comment");
    assert(churn.length <= 250, `churn total ${churn.length} calls`);
    console.error(`A4 cost: first ${firstAll} calls (${firstPr} PR reads); stable ${stable.length}; churn ${churn.length} (${prReads} PR reads)`);
  });
});

// ---------------------------------------------------------------------------
// A5  the Feature Guide
// ---------------------------------------------------------------------------
function withBody(gh: FakeGitHub, guideLine: string | null) {
  const realFetch = gh.fetch;
  gh.fetch = async (input: Any, init: Any = {}) => {
    const res = await realFetch(input, init);
    if ((init.method ?? "GET").toUpperCase() === "GET" && PR_GET.test(new URL(String(input)).pathname)) {
      const pr = await res.json();
      pr.body = String(pr.body).replace(/Feature Guide: none\n/, guideLine === null ? "" : `Feature Guide: ${guideLine}\n`);
      return json(200, pr);
    }
    return res;
  };
}

Deno.test("#3980 W2 rework 3 tester A5: a run that sees no Feature Guide line never wipes a valid list a racer recorded", async () => {
  const gh = new FakeGitHub();
  await withRunner(gh, async (logs) => {
    await (await startRun("push_main.json", logs, 1))();
    const d = readRecordData(records(gh)[0].body);
    records(gh)[0].body = renderRecord({ ...d, feature_guide: ["staff-x"], problems: recordProblems({ ...d, feature_guide: ["staff-x"] }) });
    withBody(gh, null);
    await (await startRun("status_merge_commit.json", logs, 2))();
    assertEquals(readRecordData(records(gh)[0].body).feature_guide, ["staff-x"], "missing line: the recorded list stays");
  });
  const gh2 = new FakeGitHub();
  await withRunner(gh2, async (logs) => {
    withBody(gh2, "staff-x");
    await (await startRun("push_main.json", logs, 1))();
    assertEquals(readRecordData(records(gh2)[0].body).feature_guide, ["staff-x"]);
    withBody(gh2, "Not_A_Key");
    await (await startRun("status_merge_commit.json", logs, 2))();
    const after = readRecordData(records(gh2)[0].body);
    assertEquals(after.feature_guide, ["staff-x"], "a later invalid line does not wipe the valid list");
    assertEquals("feature_guide_bad" in after, false);
  });
});
