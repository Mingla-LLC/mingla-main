// Issue #3980 synced program, Wave 1 — tester adversarial suite for the merge
// bot, the PR links check, the bridge that reads records back, and the chat
// key the connector derives.
//
// Unlike the implementor's suite (which tests the pure rules one by one),
// this one RUNS the two GitHub runners, record.mjs and pr-links.mjs, against
// a stand-in GitHub API with crafted event payloads: an admin squash merge
// read from the push to main, a pull request that links several issues and
// one that links none, a web change merged without [deploy], migrations not
// yet applied, a failed edge deploy, a push to main with no pull request, an
// idempotent refresh, hostile pull request and comment text, untrusted
// "Live check:" comments, and the PR links phases. It also attacks the
// bridge's bot-only trust rule and the connector's session id handling.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import {
  deployState,
  parseFeatureGuide,
  parseIssueRefs,
  prLinksVerdict,
  readRecordData,
  renderRecord,
} from "../../../../.github/scripts/release-records/lib.mjs";
import { readRecordData as readRecordDataTs, recordRows, runReleaseBridges } from "../opsBridges.ts";
import { chatKey, createTeamAgentHandler, sha256Hex } from "../teamAgentMcp.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const SHA = "1234567890abcdef1234567890abcdef12345678";
const MERGED_AT = "2026-10-21T09:30:00Z";

// ---------------------------------------------------------------------------
// A stand-in GitHub REST API, enough for the two runners.
// ---------------------------------------------------------------------------
type Comment = {
  id: number;
  body: string;
  user: { login: string; type: string };
  author_association: string;
  created_at: string;
  updated_at: string;
  html_url: string;
};

class FakeGitHub {
  calls: { method: string; path: string; body?: Any }[] = [];
  prs = new Map<number, Any>();
  shaPulls = new Map<string, Any[]>();
  commitMessages = new Map<string, string>();
  files = new Map<number, { filename: string; status: string }[]>();
  statuses = new Map<string, Any[]>();
  checks = new Map<string, Any[]>();
  runs = new Map<string, Any[]>();
  issues = new Map<number, Any>();
  comments = new Map<number, Comment[]>();
  landed: Any[] | "error" | "throw" = [];
  failWrites = false;
  nextId = 5000;

  addComment(issue: number, body: string, login = "github-actions[bot]", type = "Bot", assoc = "NONE", at = "2026-10-21T10:00:00Z") {
    const c: Comment = {
      id: this.nextId++,
      body,
      user: { login, type },
      author_association: assoc,
      created_at: at,
      updated_at: at,
      html_url: `https://github.com/${REPO}/issues/${issue}#issuecomment-${this.nextId}`,
    };
    this.comments.set(issue, [...(this.comments.get(issue) ?? []), c]);
    return c;
  }

  writes() {
    return this.calls.filter((c) => c.method !== "GET");
  }

  fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    this.calls.push({ method, path: path + url.search, body });
    if (url.origin !== API) return Promise.resolve(json(599, { message: "not GitHub" }));
    const base = `/repos/${REPO}`;
    let m: RegExpExecArray | null;
    if (method === "GET" && path === `${base}/commits` && url.searchParams.get("path")) {
      if (this.landed === "throw") return Promise.reject(new Error("network down"));
      if (this.landed === "error") return Promise.resolve(json(500, { message: "boom" }));
      return Promise.resolve(json(200, this.landed));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/commits/([0-9a-f]{40})/pulls$`).exec(path))) {
      return Promise.resolve(json(200, this.shaPulls.get(m[1]) ?? []));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/commits/([0-9a-f]{40})/status$`).exec(path))) {
      return Promise.resolve(json(200, { statuses: this.statuses.get(m[1]) ?? [] }));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/commits/([0-9a-f]{40})/check-runs$`).exec(path))) {
      return Promise.resolve(json(200, { check_runs: this.checks.get(m[1]) ?? [] }));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/commits/([0-9a-f]{40})$`).exec(path))) {
      return Promise.resolve(json(200, { commit: { message: this.commitMessages.get(m[1]) ?? "" } }));
    }
    if (method === "GET" && path === `${base}/actions/runs`) {
      return Promise.resolve(json(200, { workflow_runs: this.runs.get(url.searchParams.get("head_sha") ?? "") ?? [] }));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/pulls/(\\d+)/files$`).exec(path))) {
      const page = Number(url.searchParams.get("page") ?? "1");
      const all = this.files.get(Number(m[1])) ?? [];
      return Promise.resolve(json(200, all.slice((page - 1) * 100, page * 100)));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/pulls/(\\d+)$`).exec(path))) {
      const pr = this.prs.get(Number(m[1]));
      return Promise.resolve(pr ? json(200, pr) : json(404, { message: "Not Found" }));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/issues/(\\d+)/comments$`).exec(path))) {
      const n = Number(m[1]);
      let all = this.comments.get(n) ?? [];
      const since = url.searchParams.get("since");
      if (since) all = all.filter((c) => Date.parse(c.updated_at) >= Date.parse(since));
      const page = Number(url.searchParams.get("page") ?? "1");
      const last = Math.max(1, Math.ceil(all.length / 100));
      const headers: Record<string, string> = {};
      if (last > 1) headers.link = `<${API}${path}?per_page=100&page=${last}>; rel="last"`;
      return Promise.resolve(json(200, all.slice((page - 1) * 100, page * 100), headers));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/issues/(\\d+)$`).exec(path))) {
      const n = Number(m[1]);
      if (this.prs.has(n)) return Promise.resolve(json(200, { number: n, pull_request: { url: "x" } }));
      const issue = this.issues.get(n);
      return Promise.resolve(issue ? json(200, issue) : json(404, { message: "Not Found" }));
    }
    if (method === "POST" && (m = new RegExp(`^${base}/issues/(\\d+)/comments$`).exec(path))) {
      if (this.failWrites) return Promise.resolve(json(500, { message: "write failed" }));
      const c = this.addComment(Number(m[1]), body.body);
      return Promise.resolve(json(201, c));
    }
    if (method === "PATCH" && (m = new RegExp(`^${base}/issues/comments/(\\d+)$`).exec(path))) {
      if (this.failWrites) return Promise.resolve(json(500, { message: "write failed" }));
      for (const list of this.comments.values()) {
        const c = list.find((x) => x.id === Number(m![1]));
        if (c) {
          if (c.user.login !== "github-actions[bot]") return Promise.resolve(json(403, { message: "not yours" }));
          c.body = body.body;
          return Promise.resolve(json(200, c));
        }
      }
      return Promise.resolve(json(404, { message: "Not Found" }));
    }
    return Promise.resolve(json(404, { message: `no route ${method} ${path}` }));
  };
}

function json(status: number, data: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

// ---------------------------------------------------------------------------
// Running a runner in this process: its own event file, the stand-in fetch,
// its log lines and its exit code. Nothing reaches the network.
// ---------------------------------------------------------------------------
let runs = 0;
const FIXTURES = new URL("fixtures/issue_3980_release_records/", import.meta.url);
// The lane runs with read, env and net only, so each event is a fixture file
// (the runners read GITHUB_EVENT_PATH; nothing is written to disk).
async function runScript(
  script: "record.mjs" | "pr-links.mjs",
  fixture: string,
  gh: FakeGitHub,
  repository = REPO,
): Promise<{ code: number; logs: string[] }> {
  const g = globalThis as Any;
  const before = { process: g.process, fetch: g.fetch, log: console.log };
  const logs: string[] = [];
  const env = nodeProcess.env as Record<string, string | undefined>;
  const saved = { p: env.GITHUB_EVENT_PATH, t: env.GITHUB_TOKEN, r: env.GITHUB_REPOSITORY };
  try {
    g.process = nodeProcess;
    g.fetch = gh.fetch;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    env.GITHUB_EVENT_PATH = decodeURIComponent(new URL(fixture, FIXTURES).pathname);
    env.GITHUB_TOKEN = "test-token-not-real";
    env.GITHUB_REPOSITORY = repository;
    nodeProcess.exitCode = undefined;
    runs += 1;
    await import(new URL(`.github/scripts/release-records/${script}?tester-run=${runs}`, ROOT).href);
    for (let i = 0; i < 2000 && nodeProcess.exitCode === undefined; i++) await new Promise((r) => setTimeout(r, 1));
    return { code: Number(nodeProcess.exitCode ?? -1), logs };
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

/** A merged pull request and everything GitHub knows about its merge commit. */
function merged(gh: FakeGitHub, opts: {
  number?: number;
  title?: string;
  body?: string;
  subject?: string;
  files?: { filename: string; status: string }[];
  statuses?: Any[];
  checks?: Any[];
  runs?: Any[];
  sha?: string;
  mergedBy?: string;
} = {}) {
  const number = opts.number ?? 4100;
  const sha = opts.sha ?? SHA;
  const title = opts.title ?? "toward #3980: the synced system";
  gh.prs.set(number, {
    number,
    title,
    body: opts.body ?? "Issue: toward #3980\n\nFeature Guide: none\n",
    merged_at: MERGED_AT,
    merge_commit_sha: sha,
    base: { ref: "main" },
    merged_by: { login: opts.mergedBy ?? "admin-merger" },
    user: { login: "author-person" },
  });
  gh.shaPulls.set(sha, [{ number, merged_at: MERGED_AT, base: { ref: "main" }, merge_commit_sha: sha }]);
  gh.commitMessages.set(sha, `${opts.subject ?? title} (#${number})\n\nsquashed body`);
  gh.files.set(number, opts.files ?? [{ filename: "README.md", status: "modified" }]);
  gh.statuses.set(sha, opts.statuses ?? []);
  gh.checks.set(sha, opts.checks ?? []);
  gh.runs.set(sha, opts.runs ?? []);
  gh.issues.set(3980, { number: 3980 });
  return { number, sha };
}


/** The bot's record comments on an issue. */
function records(gh: FakeGitHub, issue: number) {
  return (gh.comments.get(issue) ?? []).filter((c) => c.user.login === "github-actions[bot]" && c.body.includes("mingla-release-record:pr-"));
}

/** The visible bullet lines of a record. */
function bullets(body: string) {
  return body.split("\n").filter((l) => l.startsWith("- "));
}

// ---------------------------------------------------------------------------
// G3 / G6 through record.mjs.
// ---------------------------------------------------------------------------
Deno.test("#3980 tester G3: an admin squash merge is read from the push to main and recorded once on its issue", async () => {
  const gh = new FakeGitHub();
  const { number } = merged(gh, { mergedBy: "sethogieva" });
  const r = await runScript("record.mjs", "push_main.json", gh);
  assertEquals(r.code, 0, r.logs.join("\n"));
  const recs = records(gh, 3980);
  assertEquals(recs.length, 1);
  assertMatch(recs[0].body, new RegExp(`^<!-- mingla-release-record:pr-${number} -->`));
  assert(recs[0].body.includes(`- Merge commit: ${SHA}`));
  assert(recs[0].body.includes("merged 2026-10-21 09:30 UTC by @sethogieva"));
  const data = readRecordData(recs[0].body);
  assertEquals(data.pr, number);
  assertEquals(data.issues, [{ number: 3980, relation: "toward" }]);
  // Mingla's parser reads the same comment.
  assertEquals(readRecordDataTs(recs[0].body), data);
});

Deno.test("#3980 tester G6: a push to a branch other than main, and a push to main with no pull request, write nothing", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  let r = await runScript("record.mjs", "push_feature.json", gh);
  assertEquals(r.code, 0);
  assertEquals(gh.writes().length, 0);
  assertEquals(gh.calls.length, 0, "a push to another branch makes no GitHub call at all");
  r = await runScript("record.mjs", "push_main_direct.json", gh);
  assertEquals(r.code, 0);
  assertEquals(gh.writes().length, 0);
  assert(r.logs.some((l) => l.includes("no merged pull request")), r.logs.join("\n"));
});

Deno.test("#3980 tester G6: a commit whose pull requests are not merged into main as that commit is not recorded", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  gh.shaPulls.set(SHA, [
    { number: 4100, merged_at: null, base: { ref: "main" }, merge_commit_sha: SHA },
    { number: 4101, merged_at: MERGED_AT, base: { ref: "release" }, merge_commit_sha: SHA },
    { number: 4102, merged_at: MERGED_AT, base: { ref: "main" }, merge_commit_sha: "f".repeat(40) },
  ]);
  const r = await runScript("record.mjs", "push_main.json", gh);
  assertEquals(r.code, 0);
  assertEquals(gh.writes().length, 0);
});

Deno.test("#3980 tester G3: a PR that links several issues gets one record on each real issue, never on a PR number or a missing issue", async () => {
  const gh = new FakeGitHub();
  gh.issues.set(3981, { number: 3981 });
  gh.prs.set(3991, { number: 3991, merged_at: MERGED_AT, base: { ref: "main" } }); // a pull request, not an issue
  merged(gh, {
    title: "Fixes #3981: one fix",
    body: "Issue: toward #3980, #3991 and #9999990\nrefs https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-1\n\nFeature Guide: none",
  });
  const r = await runScript("record.mjs", "push_main.json", gh);
  assertEquals(r.code, 0, r.logs.join("\n"));
  assertEquals(records(gh, 3980).length, 1);
  assertEquals(records(gh, 3981).length, 1);
  assertEquals(records(gh, 3991).length, 0);
  assertEquals(records(gh, 9999990).length, 0);
  assertEquals(records(gh, 4100).length, 0, "no record on the PR itself when an issue is linked");
  const data = readRecordData(records(gh, 3981)[0].body);
  assertEquals(data.issues, [{ number: 3981, relation: "fixes" }, { number: 3980, relation: "toward" }]);
  assertEquals(records(gh, 3980)[0].body, records(gh, 3981)[0].body, "every linked issue carries the same record");
});

Deno.test("#3980 tester G3: a PR that links no issue gets its record on the PR itself, saying so", async () => {
  const gh = new FakeGitHub();
  const { number } = merged(gh, { title: "Tidy the README", body: "Feature Guide: none" });
  const r = await runScript("record.mjs", "push_main.json", gh);
  assertEquals(r.code, 0);
  const recs = records(gh, number);
  assertEquals(recs.length, 1);
  assert(recs[0].body.includes("- Issues: none linked: link one"));
  assertEquals(readRecordData(recs[0].body).problems.includes("no_issue"), true);
  assertMatch(recs[0].body, /Status: Not complete: an issue link, the live check/);
});

Deno.test("#3980 tester G6: a web change merged without [deploy] is not deployed even when the PR title had it and Vercel says cancelled", async () => {
  const gh = new FakeGitHub();
  merged(gh, {
    title: "[deploy] toward #3980: admin names",
    subject: "toward #3980: admin names", // the admin edited the squash subject
    files: [{ filename: "mingla-admin/src/pages/AdminPage.jsx", status: "modified" }],
    statuses: [{ context: "Vercel – mingla-admin", state: "error", description: "Canceled by Ignored Build Step" }],
  });
  const r = await runScript("record.mjs", "push_main.json", gh);
  assertEquals(r.code, 0);
  const body = records(gh, 3980)[0].body;
  const data = readRecordData(body);
  assertEquals(data.deploy_marker, false);
  assertEquals(data.deploy.web, { "mingla-admin": "not_deployed" });
  assert(data.problems.includes("web_not_deployed"));
  assert(body.includes("- Deploy: mingla-admin not deployed: the title has no [deploy]"));
});

Deno.test("#3980 tester G3: migrations added but not applied stay pending; a modified old migration is not 'added'", async () => {
  const gh = new FakeGitHub();
  merged(gh, {
    files: [
      { filename: "supabase/migrations/20271129003980_issue_3980_synced_w1_foundations.sql", status: "added" },
      { filename: "supabase/migrations/20271116003980_old.sql", status: "modified" },
      { filename: "supabase/migrations/__tests__/x.pg17.test.sql", status: "added" },
      { filename: "supabase/migrations/2027112400398_short.sql", status: "added" },
    ],
    statuses: [{ context: "mingla/production-migrations", state: "pending", description: "Waiting: 20271129003980" }],
  });
  const r = await runScript("record.mjs", "push_main.json", gh);
  assertEquals(r.code, 0);
  const body = records(gh, 3980)[0].body;
  const data = readRecordData(body);
  assertEquals(data.migrations_added, ["20271129003980"]);
  assertEquals(data.migrations_applied_state, "pending");
  assert(body.includes("- Migrations applied: pending: Mingla checks the production ledger every 5 minutes"));
  assertMatch(body, /Status: Not complete: .*migrations applied to production/);
  // Mingla posts success: the refresh fills it in place.
  gh.statuses.set(SHA, [{ context: "mingla/production-migrations", state: "success", description: "All applied: 20271129003980" }]);
  await runScript("record.mjs", "status_merge_commit.json", gh);
  const after = records(gh, 3980);
  assertEquals(after.length, 1);
  assert(after[0].body.includes("- Migrations applied: all applied (All applied: 20271129003980)"));
});

Deno.test("#3980 tester G6: a failed edge deploy is a problem; a governed Sites function is checked by hand", async () => {
  const gh = new FakeGitHub();
  merged(gh, {
    files: [{ filename: "supabase/functions/team-agent/index.ts", status: "modified" }],
    runs: [{ name: "Deploy Supabase Edge Functions", status: "completed", conclusion: "failure" }],
  });
  await runScript("record.mjs", "push_main.json", gh);
  let data = readRecordData(records(gh, 3980)[0].body);
  assertEquals(data.deploy.edge, "failed");
  assert(data.problems.includes("edge_deploy_failed"));
  assert(records(gh, 3980)[0].body.includes("- Deploy: edge functions team-agent failed"));

  const gh2 = new FakeGitHub();
  merged(gh2, {
    files: [
      { filename: "supabase/functions/brand-site-control/index.ts", status: "modified" },
      { filename: "supabase/functions/team-agent/index.ts", status: "modified" },
    ],
    runs: [{ name: "Deploy Supabase Edge Functions", status: "completed", conclusion: "success" }],
  });
  await runScript("record.mjs", "push_main.json", gh2);
  data = readRecordData(records(gh2, 3980)[0].body);
  assertEquals(data.deploy.edge, "manual");
  assert(records(gh2, 3980)[0].body.includes("Sites functions deploy only through their governed lane: check by hand"));
});

Deno.test("#3980 tester G3: a refresh with nothing new writes nothing; a change edits the one record in place", async () => {
  const gh = new FakeGitHub();
  merged(gh, {
    title: "[deploy] toward #3980: admin",
    files: [{ filename: "mingla-admin/src/App.jsx", status: "modified" }],
    statuses: [{ context: "Vercel – mingla-admin", state: "pending" }],
  });
  await runScript("record.mjs", "push_main.json", gh);
  assertEquals(gh.writes().filter((w) => w.method === "POST").length, 1);
  const first = records(gh, 3980)[0];
  assertEquals(readRecordData(first.body).deploy.web["mingla-admin"], "pending");
  // The same event again, and a workflow_dispatch for the same PR: unchanged.
  const r2 = await runScript("record.mjs", "push_main.json", gh);
  const r3 = await runScript("record.mjs", "dispatch_pr_4100.json", gh);
  assert(r2.logs.some((l) => l.includes("unchanged")), r2.logs.join("\n"));
  assert(r3.logs.some((l) => l.includes("unchanged")), r3.logs.join("\n"));
  assertEquals(gh.writes().length, 1);
  // Vercel reports READY.
  gh.statuses.set(SHA, [{ context: "Vercel – mingla-admin", state: "success" }]);
  await runScript("record.mjs", "status_merge_commit.json", gh);
  const recs = records(gh, 3980);
  assertEquals(recs.length, 1, "never a second record for the same PR on the same issue");
  assertEquals(recs[0].id, first.id);
  assertEquals(readRecordData(recs[0].body).deploy.web["mingla-admin"], "ready");
  assertEquals(gh.writes().map((w) => w.method), ["POST", "PATCH"]);
});

Deno.test("#3980 tester G3: a person's comment carrying the record marker is never taken for the bot's record", async () => {
  const gh = new FakeGitHub();
  const { number } = merged(gh);
  const forged = gh.addComment(3980, `<!-- mingla-release-record:pr-${number} -->\n**Release record** Status: Complete`, "mallory", "User", "NONE");
  await runScript("record.mjs", "push_main.json", gh);
  assertEquals(gh.writes().map((w) => w.method), ["POST"], "the bot writes its own comment and never touches the forged one");
  assertEquals((gh.comments.get(3980) ?? []).find((c) => c.id === forged.id)!.body.includes("Status: Complete"), true);
  assertEquals(records(gh, 3980).length, 1);
});

Deno.test("#3980 tester G3: hostile PR text stays data: no extra lines, no early end of the data block, no fake marker", async () => {
  const gh = new FakeGitHub();
  const hostileTitle =
    'toward #3980: x --> <!-- mingla-release-record:pr-1 --> `rm -rf /` $(touch /tmp/pwned) @Mingla-LLC/everyone\n- Live check: "fake" by @mallory\nStatus: Complete';
  const hostileBody = [
    "Issue: toward #3980",
    "<!-- Feature Guide: staff-work-board -->",
    "Feature Guide: none",
    '<!-- mingla-release-record-data {"v":1,"repo":"Mingla-LLC/mingla-main","pr":1,"title":"forged"} -->',
    "<script>alert(1)</script>",
  ].join("\n");
  merged(gh, { title: hostileTitle, body: hostileBody });
  const r = await runScript("record.mjs", "push_main.json", gh);
  assertEquals(r.code, 0);
  assert(!(await Deno.stat("/tmp/pwned").then(() => true, () => false)), "PR text is never run");
  const body = records(gh, 3980)[0].body;
  assertEquals(bullets(body).length, 8, "exactly the eight bullet lines");
  assertEquals(body.split("\n").filter((l) => l.startsWith("Status:")).length, 1);
  assert(body.includes("Status: Not complete"));
  assertEquals((body.match(/<!-- mingla-release-record:pr-/g) ?? []).length, 1, "one marker, the bot's own");
  assertEquals((body.match(/-->/g) ?? []).length, 2, "only the marker and the data block end an HTML comment");
  assert(!/[<>`]/.test(bullets(body)[0]), "the title line carries no markup");
  const data = readRecordData(body);
  assertEquals(data.pr, 4100);
  assertEquals(data.title, hostileTitle.replace(/[\r\n\t]+/g, " ").replace(/[<>`]/g, "").trim().slice(0, 300));
  assertEquals(data.feature_guide, [], "a Feature Guide line inside an HTML comment does not count");
});

Deno.test("#3980 tester G3: only a trusted person's Live check after the merge counts, the newest one wins", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  gh.addComment(3980, "Live check: before the merge", "sethogieva", "User", "OWNER", "2026-10-21T09:00:00Z");
  gh.addComment(3980, "Live check: a stranger says it works", "stranger", "User", "NONE", "2026-10-21T11:00:00Z");
  gh.addComment(3980, "Live check: a contributor says it works", "drive-by", "User", "CONTRIBUTOR", "2026-10-21T11:05:00Z");
  gh.addComment(3980, "Live check: <b>bold</b> `code` walked the board", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z");
  gh.addComment(3980, "Live check: newest from a member", "teammate", "User", "MEMBER", "2026-10-21T13:00:00Z");
  gh.addComment(3980, "live check: lower-case does not count", "sethogieva", "User", "OWNER", "2026-10-21T14:00:00Z");
  await runScript("record.mjs", "comment_live_check_3980.json", gh);
  // No record yet on the issue, so the comment event finds no PR: nothing written.
  assertEquals(gh.writes().length, 0);
  await runScript("record.mjs", "push_main.json", gh);
  const data = readRecordData(records(gh, 3980)[0].body);
  assertEquals(data.live_check.by_login, "teammate");
  assertEquals(data.live_check.text, "newest from a member");
  gh.comments.set(3980, (gh.comments.get(3980) ?? []).filter((c) => c.user.login !== "teammate"));
  gh.addComment(3980, "Live check: a stranger has the newest word", "stranger", "User", "NONE", "2026-10-21T16:00:00Z");
  gh.addComment(3980, "Live check: a first-time contributor too", "newcomer", "User", "FIRST_TIME_CONTRIBUTOR", "2026-10-21T16:05:00Z");
  await runScript("record.mjs", "comment_live_check_3980.json", gh);
  const again = readRecordData(records(gh, 3980)[0].body);
  assertEquals(again.live_check.by_login, "sethogieva");
  assertEquals(again.live_check.text, "bbold/b code walked the board", "angle brackets and backticks are stripped from the live check text");
});

Deno.test("#3980 tester G3: a comment event refreshes the PR named by the bot's newest record, never by a person's forged marker", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  await runScript("record.mjs", "push_main.json", gh);
  gh.addComment(3980, "<!-- mingla-release-record:pr-777 -->", "mallory", "User", "NONE", "2026-10-21T15:00:00Z");
  gh.addComment(3980, "Live check: looked at production", "sethogieva", "User", "OWNER", "2026-10-21T15:05:00Z");
  const r = await runScript("record.mjs", "comment_live_check_3980.json", gh);
  assertEquals(r.code, 0);
  assert(!gh.calls.some((c) => c.path.includes("/pulls/777")), "the forged PR number is never read");
  assertEquals(readRecordData(records(gh, 3980)[0].body).live_check.by_login, "sethogieva");
});

Deno.test("#3980 tester G3: on another repository the runners do nothing and call nobody", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  const a = await runScript("record.mjs", "push_main.json", gh, "someone/mingla-main");
  const b = await runScript("pr-links.mjs", "pr_before_landing.json", gh, "someone/mingla-main");
  assertEquals([a.code, b.code], [0, 0]);
  assertEquals(gh.calls.length, 0);
});

Deno.test("#3980 tester G3: a GitHub write that fails stops the run with an error, so the run is red, never silently fine", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  gh.failWrites = true;
  const r = await runScript("record.mjs", "push_main.json", gh);
  // The write was attempted; the log names the HTTP status so a person can see it.
  assert(r.logs.some((l) => /#3980 created \(HTTP 500\)/.test(l)), r.logs.join("\n"));
});

// ---------------------------------------------------------------------------
// G4 through pr-links.mjs.
// ---------------------------------------------------------------------------
const LANDED = "2026-01-01T00:00:00Z";
const landedCommits = [{ commit: { committer: { date: "2026-03-01T00:00:00Z" } } }, { commit: { committer: { date: LANDED } } }];
const reminders = (gh: FakeGitHub, n = 4200) => (gh.comments.get(n) ?? []).filter((c) => c.body.includes("<!-- mingla-pr-links -->"));

Deno.test("#3980 tester G4: a PR opened before the check landed is never blocked, even months later", async () => {
  const gh = new FakeGitHub();
  gh.landed = landedCommits;
  const r = await runScript("pr-links.mjs", "pr_before_landing.json", gh);
  assertEquals(r.code, 0, r.logs.join("\n"));
  assert(r.logs.some((l) => l.includes("phase=exempt")));
  assertEquals(reminders(gh).length, 1);
  assert(reminders(gh)[0].body.includes("This PR was opened before the check landed, so it never blocks this PR."));
});

Deno.test("#3980 tester G4: the first week reminds and passes; the same PR edited still reminds once, in place", async () => {
  const gh = new FakeGitHub();
  gh.landed = [{ commit: { committer: { date: new Date(Date.now() - 2 * 86400000).toISOString() } } }];
  let r = await runScript("pr-links.mjs", "pr_future_empty.json", gh);
  assertEquals(r.code, 0);
  assert(r.logs.some((l) => l.includes("phase=reminder")));
  r = await runScript("pr-links.mjs", "pr_future_issue_only.json", gh);
  assertEquals(r.code, 0);
  assertEquals(reminders(gh).length, 1, "one reminder comment per PR, updated in place");
  assert(reminders(gh)[0].body.includes('Missing: a "Feature Guide:" line.'));
  r = await runScript("pr-links.mjs", "pr_future_complete.json", gh);
  assertEquals(r.code, 0);
  assertEquals(reminders(gh).length, 1);
  assert(reminders(gh)[0].body.includes("Issue and Feature Guide lines found. Thank you."));
});

Deno.test("#3980 tester G4: after the first week a missing line fails the check; the reminder is still written", async () => {
  const gh = new FakeGitHub();
  gh.landed = landedCommits;
  const r = await runScript("pr-links.mjs", "pr_after_landing_issue_none.json", gh);
  assertEquals(r.code, 1);
  assert(r.logs.some((l) => l.includes("phase=blocking")));
  assertEquals(reminders(gh).length, 1);
  assertMatch(reminders(gh)[0].body, /Missing: an issue link; a "Feature Guide:" line\./);
  const ok = await runScript("pr-links.mjs", "pr_after_landing_complete.json", gh);
  assertEquals(ok.code, 0, "\"Issue: none, <reason>\" is an answer");
  assert(reminders(gh)[0].body.includes("Issue and Feature Guide lines found. Thank you."));
});

Deno.test("#3980 tester G4: when the landing time cannot be read the check only reminds", async () => {
  for (const landed of ["error", "throw", []] as const) {
    const gh = new FakeGitHub();
    gh.landed = landed as Any;
    const r = await runScript("pr-links.mjs", "pr_after_landing_empty.json", gh);
    assertEquals(r.code, 0, `landed=${JSON.stringify(landed)}: ${r.logs.join("\n")}`);
    assert(r.logs.some((l) => l.includes("phase=reminder")));
  }
});

Deno.test("#3980 tester G4: bots are exempt and never get a reminder", async () => {
  for (const fixture of ["pr_dependabot.json", "pr_app_bot.json"]) {
    const gh = new FakeGitHub();
    gh.landed = landedCommits;
    const r = await runScript("pr-links.mjs", fixture, gh);
    assertEquals(r.code, 0);
    assertEquals(gh.writes().length, 0);
  }
});

Deno.test("#3980 tester G4: a reminder that cannot be written never changes the verdict; a person's look-alike comment is not edited", async () => {
  const gh = new FakeGitHub();
  gh.landed = landedCommits;
  gh.addComment(4200, "<!-- mingla-pr-links -->\nI removed the reminder myself", "mallory", "User");
  gh.failWrites = true;
  const blocked = await runScript("pr-links.mjs", "pr_after_landing_empty.json", gh);
  assertEquals(blocked.code, 1);
  assert(!gh.calls.some((c) => c.method === "PATCH"), "the person's comment is never patched");
  gh.failWrites = false;
  const passes = await runScript("pr-links.mjs", "pr_before_landing.json", gh);
  assertEquals(passes.code, 0);
});

Deno.test("#3980 tester G4: issue links in prose, comments and other repositories", () => {
  const nums = (t: string, b: string) => parseIssueRefs(t, b).map((r: Any) => `${r.number}:${r.relation}`);
  assertEquals(nums("Fixes: #1, #2 and #3", ""), ["1:fixes", "2:fixes", "3:fixes"]);
  assertEquals(nums("prefixes #12 and suffixes #13", ""), []);
  assertEquals(nums("", "see https://github.com/someone/mingla-main/issues/5 and toward https://github.com/Mingla-LLC/mingla-main/pull/6"), []);
  assertEquals(nums("", "<!-- Fixes #7 -->\ntoward #8"), ["8:toward"]);
  assertEquals(nums("toward #9", "Fixes #9"), ["9:fixes"]);
  assertEquals(nums("", "toward " + Array.from({ length: 50 }, (_, i) => `#${i + 1}`).join(", ")).length, 10);
  assertEquals(parseFeatureGuide("Feature Guide: staff-work-board,staff-agent-log."), { kind: "keys", keys: ["staff-work-board", "staff-agent-log"] });
  assertEquals(parseFeatureGuide("Feature Guide: Staff-Work-Board").kind, "invalid");
  assertEquals(parseFeatureGuide("Feature Guide: " + Array.from({ length: 33 }, (_, i) => `k${i}`).join(", ")).kind, "keys");
  assertEquals(parseFeatureGuide("Feature Guide: " + Array.from({ length: 501 }, (_, i) => `k${i}`).join(", ")).kind, "invalid");
  assertEquals(parseFeatureGuide("<!-- Feature Guide: none -->").kind, "missing");
  const v = prLinksVerdict({ title: "x", body: "Issue: none\nFeature Guide: none", author: "someone", createdAt: "2026-11-05T00:00:00Z", landedAt: LANDED, now: "2026-11-06T00:00:00Z" });
  assertEquals([v.ok, v.missing], [false, ["an issue link"]], "\"Issue: none\" without a reason is not an answer");
});

// ---------------------------------------------------------------------------
// The deploy rule, record rendering and the data block.
// ---------------------------------------------------------------------------
Deno.test("#3980 tester G6: deploy state per project and for the edge run", () => {
  const ds = (o: Any) => deployState({ web: [], edge: [], marker: true, statuses: [], checks: [], edgeRuns: [], ...o });
  // Similar project names never stand in for each other.
  assertEquals(ds({ web: ["mingla-sites", "mingla-site-cms"], statuses: [{ context: "Vercel – mingla-site-cms", state: "success" }] }).web,
    { "mingla-sites": "pending", "mingla-site-cms": "ready" });
  assertEquals(ds({ web: ["mingla-admin"], statuses: [{ context: "Vercel – mingla-admin", state: "failure" }] }).web, { "mingla-admin": "failed" });
  assertEquals(ds({ web: ["mingla-admin"], marker: false, statuses: [{ context: "Vercel – mingla-admin", state: "success" }] }).web,
    { "mingla-admin": "not_deployed" }, "no [deploy] is not deployed whatever a status says");
  for (const [conclusion, want] of [["success", "deployed"], ["failure", "failed"], ["cancelled", "failed"], ["timed_out", "failed"], ["skipped", "pending"]]) {
    assertEquals(ds({ edge: ["team-agent"], edgeRuns: [{ name: "Deploy Supabase Edge Functions", status: "completed", conclusion }] }).edge, want, conclusion);
  }
  assertEquals(ds({ edge: ["team-agent"], edgeRuns: [{ name: "Deploy Supabase Edge Functions", status: "in_progress" }] }).edge, "pending");
  assertEquals(ds({ edge: ["team-agent"], edgeRuns: [{ name: "Some other workflow", status: "completed", conclusion: "success" }] }).edge, "pending");
  assertEquals(ds({ edge: ["(shared code)"], edgeRuns: [] }).edge, "pending", "shared code changes still wait for the edge run");
});

Deno.test("#3980 tester G3: a record never says Complete while anything is pending, missing or failed", () => {
  const base: Any = {
    v: 1, repo: REPO, pr: 4300, title: "t", pr_url: `https://github.com/${REPO}/pull/4300`, merged_at: MERGED_AT, merge_sha: SHA,
    merged_by: "m", author: "a", issues: [{ number: 3980, relation: "toward" }], migrations_added: [], migrations_applied_state: "none",
    edge_functions: [], web_projects: [], deploy_marker: true, deploy: { web: {}, edge: "none" }, feature_guide: [],
    live_check: { text: "ok", by_login: "s", url: "u", at: MERGED_AT }, test_files: [], problems: [],
  };
  assertMatch(renderRecord(base), /\nStatus: Complete\n/);
  const variants: Any[] = [
    { migrations_added: ["20271129003980"], migrations_applied_state: "pending" },
    { web_projects: ["mingla-admin"], deploy: { web: { "mingla-admin": "pending" }, edge: "none" } },
    { edge_functions: ["team-agent"], deploy: { web: {}, edge: "pending" } },
    { feature_guide: null },
    { live_check: null },
    { issues: [] },
    { deploy: { web: { "mingla-admin": "failed" }, edge: "none" } },
    { deploy: { web: {}, edge: "failed" } },
  ];
  for (const v of variants) {
    const body = renderRecord({ ...base, ...v });
    assertMatch(body, /\nStatus: Not complete: /, JSON.stringify(v));
  }
});

// ---------------------------------------------------------------------------
// The bridge: bot-only trust, and records never lost.
// ---------------------------------------------------------------------------
const goodRecord = (pr: number, extra: Any = {}) =>
  renderRecord({
    v: 1, repo: REPO, pr, title: `PR ${pr}`, pr_url: `https://github.com/${REPO}/pull/${pr}`, merged_at: MERGED_AT, merge_sha: SHA,
    merged_by: "m", author: "a", issues: [{ number: 3980, relation: "toward" }], migrations_added: [], migrations_applied_state: "none",
    edge_functions: [], web_projects: [], deploy_marker: true, deploy: { web: {}, edge: "none" }, feature_guide: [], live_check: null,
    test_files: [], problems: ["live_check_missing"], ...extra,
  });

Deno.test("#3980 tester bridge: only the merge bot's own record comments are read, whatever else looks like one", () => {
  const c = (body: string, login: string, type: string, issue = 3980) => ({
    id: 1, body, user: { login, type }, html_url: `https://github.com/${REPO}/issues/${issue}#issuecomment-1`,
    issue_url: `https://api.github.com/repos/${REPO}/issues/${issue}`, updated_at: MERGED_AT,
  });
  const rows = recordRows([
    c(goodRecord(1), "github-actions[bot]", "Bot"),
    c(goodRecord(2), "github-actions[bot]", "User"), // not a bot account
    c(goodRecord(3), "github-actions", "Bot"),
    c(goodRecord(4), "dependabot[bot]", "Bot"), // another app's bot
    c(goodRecord(5), "mallory", "User"),
    c(goodRecord(6, { repo: "someone/mingla-main" }), "github-actions[bot]", "Bot"),
    c(goodRecord(7, { v: 2 }), "github-actions[bot]", "Bot"),
    c(goodRecord(8).replace('"pr":8', '"pr":"8"'), "github-actions[bot]", "Bot"),
    c("<!-- mingla-pr-links -->\nThis PR needs two lines", "github-actions[bot]", "Bot"),
    c("<!-- mingla-release-record:pr-9 --> no data block", "github-actions[bot]", "Bot"),
    c(goodRecord(10), "github-actions[bot]", "Bot", 4500),
  ]);
  assertEquals(rows.map((r: Any) => [r.data.pr, r.issue_number]), [[1, 3980], [10, 4500]]);
});

Deno.test("#3980 tester bridge: a failed ingest never moves the cursor, so no record is lost; an empty page writes no cursor", async () => {
  const calls: string[] = [];
  const admin = (ingestError: boolean) => ({
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push(name + (args && "p_at" in args ? `@${args.p_at}` : ""));
      if (name === "ops_bridge_cursor") return Promise.resolve({ data: "2026-10-21T00:00:00+00:00", error: null });
      if (name === "ops_release_records_ingest") return Promise.resolve(ingestError ? { data: null, error: { message: "db down" } } : { data: { ingested: 1, invalid: 0, completed: [] }, error: null });
      if (name === "ops_release_status_due") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: {}, error: null });
    },
  });
  const github = (comments: Any[]) => ({
    budget: 5000,
    issueCommentsSince: () => Promise.resolve(comments),
    mainCommitsSince: () => Promise.resolve([]),
    pullsForCommit: () => Promise.resolve(null),
    createCommitStatus: () => Promise.resolve(),
  });
  const page = [{ body: goodRecord(11), user: { login: "github-actions[bot]", type: "Bot" }, html_url: `https://github.com/${REPO}/issues/3980#issuecomment-2`, issue_url: `https://api.github.com/repos/${REPO}/issues/3980`, updated_at: "2026-10-21T10:00:00Z" }];
  let res = await runReleaseBridges(admin(true), github(page));
  assertEquals(res.failed >= 1, true);
  assert(!calls.some((c) => c.startsWith("ops_bridge_cursor_set") && c.includes("2026-10-21T10:00:00Z")), calls.join(","));
  calls.length = 0;
  res = await runReleaseBridges(admin(false), github(page));
  assert(calls.includes("ops_bridge_cursor_set@2026-10-21T10:00:00Z"), calls.join(","));
  calls.length = 0;
  await runReleaseBridges(admin(false), github([]));
  assert(!calls.some((c) => c.startsWith("ops_bridge_cursor_set")), "an empty page leaves the cursor alone");
  // A person's comment that is newer than the bot's still moves the cursor past it (it was read and rightly skipped).
  calls.length = 0;
  await runReleaseBridges(admin(false), github([...page, { body: "Live check: fine", user: { login: "sethogieva", type: "User" }, updated_at: "2026-10-21T11:00:00Z" }]));
  assert(calls.includes("ops_bridge_cursor_set@2026-10-21T11:00:00Z"), calls.join(","));
});

// ---------------------------------------------------------------------------
// F2: the connector's session id and chat key.
// ---------------------------------------------------------------------------
const KEY = "mgla_c_" + "t".repeat(43);
function mcp(method: string, params: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("https://example.test/functions/v1/team-agent", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "mcp-protocol-version": "2025-11-25", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

Deno.test("#3980 tester F2: oversized, spaced and missing session ids are never echoed; the server hands out its own", async () => {
  const seen: string[] = [];
  const h = createTeamAgentHandler({
    minRefusalMs: 0,
    gateway: (_h, _t, _a, _c, chat) => {
      seen.push(chat);
      return Promise.resolve({ ok: true, result: { results: [] }, me: { role: "growth", agent: "claude", work: true } });
    },
  });
  const init = (sid?: string) =>
    h(mcp("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } }, sid === undefined ? {} : { "mcp-session-id": sid }));
  const ok128 = "s".repeat(128);
  assertEquals((await init(ok128)).headers.get("mcp-session-id"), ok128, "a well-formed 128-character id is kept");
  for (const bad of ["s".repeat(129), "short", "has space inside", "tab\tinside!", ""]) {
    const got = (await init(bad)).headers.get("mcp-session-id");
    assertMatch(got ?? "", /^[0-9a-f]{32}$/, `bad id ${JSON.stringify(bad)}`);
    assertNotEquals(got, bad);
  }
  const fresh = [await init(), await init()].map((r) => r.headers.get("mcp-session-id"));
  assertNotEquals(fresh[0], fresh[1], "two connections are two chats");
  // A tool call carrying an oversized id is served as an old client: no chat key, never refused.
  const r = await h(mcp("tools/call", { name: "my_work", arguments: {} }, { "mcp-session-id": "s".repeat(129) }));
  assertEquals(r.status, 200);
  assertEquals(seen.at(-1), "");
});

Deno.test("#3980 tester F2: one session is one key across tools; the session beats a chat name; names ignore case; non-work tools ignore names", async () => {
  const req = (sid: string | null, tool: string, args: Record<string, unknown>) =>
    mcp("tools/call", { name: tool, arguments: args }, sid ? { "mcp-session-id": sid } : {});
  const a = "session-a-0001", b = "session-b-0002";
  const ka = (await sha256Hex("chat:" + a)).slice(0, 16);
  assertEquals(await chatKey(req(a, "my_work", {}), true, {}), ka);
  assertEquals(await chatKey(req(a, "claim", { chat: "Other name" }), true, { chat: "Other name" }), ka);
  assertNotEquals(await chatKey(req(b, "my_work", {}), true, {}), ka);
  const n1 = await chatKey(req(null, "claim", {}), true, { chat: "Hosts Sweep" });
  const n2 = await chatKey(req(null, "claim", {}), true, { chat: "  hosts sweep " });
  assertEquals(n1, n2);
  assertEquals(n1, (await sha256Hex("name:hosts sweep")).slice(0, 16));
  assertEquals(await chatKey(req(null, "find_records", {}), false, { chat: "Hosts sweep" }), "");
  assertMatch(ka, /^[0-9a-f]{16}$/);
});

Deno.test("#3980 tester: the workflow checks out only the base branch and gives each job only the rights it needs", () => {
  const wf = read(".github/workflows/release-records" + ".yml");
  assert(!/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(wf), "never checks out the PR head");
  assert(!/github\.head_ref/.test(wf));
  assert(!/repository:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(wf));
  for (const run of wf.split("\n").filter((l) => /^\s*run:/.test(l))) {
    assert(!run.includes("${{"), `no expression in a shell line: ${run}`);
  }
  assertEquals((wf.match(/persist-credentials:\s*false/g) ?? []).length, 2);
  const prLinks = wf.slice(wf.indexOf("pr-links:"), wf.indexOf("release-record:"));
  assert(!/issues:\s*write/.test(prLinks), "the PR links job cannot write to issues");
  assert(!/contents:\s*write/.test(wf), "nothing writes repository contents");
  for (const f of ["lib.mjs", "record.mjs", "pr-links.mjs"]) {
    const src = read(`.github/scripts/release-records/${f}`);
    assert(!/child_process|\beval\(|new Function|import\(/.test(src), `${f} never runs code`);
  }
});
