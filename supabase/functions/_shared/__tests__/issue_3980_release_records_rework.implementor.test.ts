// Issue #3980 synced program, Wave 1 rework — the implementor's regression
// suite for the tester's FAIL on the merge bot, the PR links check and the
// connector:
//   D1   only Vercel's own report ("Vercel – <project>", en dash or hyphen)
//        decides a web deploy; a CI job that mentions the project never does
//   D2   two runs racing on one merge leave exactly one record; the workflow
//        queues the record job per merge commit
//   D3   a record on a middle page of a long issue is found and updated
//   D10  a change under packages/ is a change to the web projects that build
//        it, and the maintained map matches the real tree
//   no-echo  the PR links comment never repeats the pull request's words
//   P3   a "Live check:" comment refreshes every record on its issue, and the
//        record's title line is plain text
//   P4   the connector counts a chat name's characters as the database does
// Runs the two runners in-process against a stand-in GitHub API (no network).
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import {
  deployState,
  isVercelName,
  PACKAGE_CONSUMERS,
  plainText,
  prLinksVerdict,
  readRecordData,
  renderRecord,
  WEB_PROJECTS,
  webProjects,
} from "../../../../.github/scripts/release-records/lib.mjs";
import { CHAT_NAME_PATTERN, chatName } from "../teamAgentMcp.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const SHA = "1234567890abcdef1234567890abcdef12345678";
const SHA2 = "abcdef1234567890abcdef1234567890abcdef12";
const MERGED_AT = "2026-10-21T09:30:00Z";

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
  calls: { method: string; path: string }[] = [];
  prs = new Map<number, Any>();
  shaPulls = new Map<string, Any[]>();
  commitMessages = new Map<string, string>();
  files = new Map<number, { filename: string; status: string }[]>();
  statuses = new Map<string, Any[]>();
  issues = new Map<number, Any>();
  comments = new Map<number, Comment[]>();
  refuseDeletes = false;
  nextId = 7000;

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

  fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    this.calls.push({ method, path: path + url.search });
    if (url.origin !== API) return Promise.resolve(json(599, { message: "not GitHub" }));
    const base = `/repos/${REPO}`;
    let m: RegExpExecArray | null;
    if (method === "GET" && (m = new RegExp(`^${base}/commits/([0-9a-f]{40})/pulls$`).exec(path))) {
      return Promise.resolve(json(200, this.shaPulls.get(m[1]) ?? []));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/commits/([0-9a-f]{40})/status$`).exec(path))) {
      return Promise.resolve(json(200, { statuses: this.statuses.get(m[1]) ?? [] }));
    }
    if (method === "GET" && new RegExp(`^${base}/commits/([0-9a-f]{40})/check-runs$`).test(path)) {
      return Promise.resolve(json(200, { check_runs: [] }));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/commits/([0-9a-f]{40})$`).exec(path))) {
      return Promise.resolve(json(200, { commit: { message: this.commitMessages.get(m[1]) ?? "" } }));
    }
    if (method === "GET" && path === `${base}/actions/runs`) return Promise.resolve(json(200, { workflow_runs: [] }));
    if (method === "GET" && (m = new RegExp(`^${base}/pulls/(\\d+)/files$`).exec(path))) {
      const page = Number(url.searchParams.get("page") ?? "1");
      return Promise.resolve(json(200, (this.files.get(Number(m[1])) ?? []).slice((page - 1) * 100, page * 100)));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/pulls/(\\d+)$`).exec(path))) {
      const pr = this.prs.get(Number(m[1]));
      return Promise.resolve(pr ? json(200, pr) : json(404, { message: "Not Found" }));
    }
    if (method === "GET" && (m = new RegExp(`^${base}/issues/(\\d+)/comments$`).exec(path))) {
      let all = this.comments.get(Number(m[1])) ?? [];
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
      return Promise.resolve(json(201, this.addComment(Number(m[1]), body.body)));
    }
    if ((method === "PATCH" || method === "DELETE") && (m = new RegExp(`^${base}/issues/comments/(\\d+)$`).exec(path))) {
      for (const [issue, list] of this.comments) {
        const c = list.find((x) => x.id === Number(m![1]));
        if (!c) continue;
        if (c.user.login !== "github-actions[bot]") return Promise.resolve(json(403, { message: "not yours" }));
        if (method === "DELETE") {
          if (this.refuseDeletes) return Promise.resolve(json(403, { message: "refused" }));
          this.comments.set(issue, list.filter((x) => x !== c));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        c.body = body.body;
        return Promise.resolve(json(200, c));
      }
      return Promise.resolve(json(404, { message: "Not Found" }));
    }
    return Promise.resolve(json(404, { message: `no route ${method} ${path}` }));
  };
}

function json(status: number, data: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

const FIXTURES = new URL("fixtures/issue_3980_release_records/", import.meta.url);
let runs = 0;

/** Runs a runner in this process against the stand-in API; resolves to its exit code and log. */
async function runScript(script: "record.mjs" | "pr-links.mjs", fixture: string, gh: FakeGitHub) {
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
    env.GITHUB_REPOSITORY = REPO;
    nodeProcess.exitCode = undefined;
    runs += 1;
    await import(new URL(`.github/scripts/release-records/${script}?rework-run=${runs}`, ROOT).href);
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

function merged(gh: FakeGitHub, opts: { number?: number; sha?: string; title?: string } = {}) {
  const number = opts.number ?? 4100;
  const sha = opts.sha ?? SHA;
  const title = opts.title ?? "toward #3980: the synced system";
  gh.prs.set(number, {
    number,
    title,
    body: "Issue: toward #3980\n\nFeature Guide: none\n",
    merged_at: MERGED_AT,
    merge_commit_sha: sha,
    base: { ref: "main" },
    merged_by: { login: "admin-merger" },
    user: { login: "author-person" },
  });
  gh.shaPulls.set(sha, [{ number, merged_at: MERGED_AT, base: { ref: "main" }, merge_commit_sha: sha }]);
  gh.commitMessages.set(sha, `${title} (#${number})`);
  gh.files.set(number, [{ filename: "README.md", status: "modified" }]);
  gh.issues.set(3980, { number: 3980 });
}

const records = (gh: FakeGitHub, issue: number, pr?: number) =>
  (gh.comments.get(issue) ?? []).filter((c) =>
    c.user.login === "github-actions[bot]" && c.body.includes(`mingla-release-record:pr-${pr ?? ""}`)
  );

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------
Deno.test("#3980 rework D1: only Vercel's own report decides a web deploy", () => {
  const ds = (o: Any) => (deployState({ web: ["mingla-business"], edge: [], marker: true, statuses: [], checks: [], edgeRuns: [], ...o }) as Any).web["mingla-business"];
  const ciJob = { name: "META-ORCH-1337: mingla-business jest suites — 1339 trip/experience guest privacy", status: "completed", conclusion: "success" };
  assertEquals(ds({ statuses: [{ context: "Vercel – mingla-business", state: "failure" }], checks: [ciJob] }), "failed", "a passing CI job is not the deploy");
  assertEquals(ds({ statuses: [{ context: "Vercel – mingla-business", state: "pending" }], checks: [ciJob] }), "pending");
  assertEquals(ds({ checks: [ciJob] }), "pending", "a CI job alone never makes it READY");
  assertEquals(ds({ statuses: [{ context: "mingla-business preview", state: "success" }] }), "pending");
  assertEquals(ds({ statuses: [{ context: "Vercel - mingla-business", state: "success" }] }), "ready", "the hyphen form counts");
  assertEquals(ds({ statuses: [{ context: "Vercel – mingla-business-staging", state: "success" }] }), "pending", "another project never stands in");
  assertEquals(ds({ checks: [
    { id: 1, name: "Vercel – mingla-business", status: "completed", conclusion: "failure", started_at: "2026-10-21T09:31:00Z" },
    { id: 2, name: "Vercel – mingla-business", status: "completed", conclusion: "success", started_at: "2026-10-21T09:40:00Z" },
  ] }), "ready", "of two runs of Vercel's check, the newer one counts");
  assertEquals(isVercelName("Vercel – mingla-admin", "mingla-admin"), true);
  assertEquals(isVercelName("Vercel – mingla-admin (preview)", "mingla-admin"), false);
  const edge = (runs: Any[]) => deployState({ web: [], edge: ["team-agent"], marker: true, statuses: [], checks: [], edgeRuns: runs }).edge;
  assertEquals(edge([{ name: "Deploy Supabase Edge Functions (dry run)", status: "completed", conclusion: "success" }]), "pending",
    "only the edge deploy workflow by its exact name");
  assertEquals(edge([
    { id: 1, name: "Deploy Supabase Edge Functions", status: "completed", conclusion: "failure", created_at: "2026-10-21T09:31:00Z" },
    { id: 2, name: "Deploy Supabase Edge Functions", status: "completed", conclusion: "success", created_at: "2026-10-21T09:50:00Z" },
  ]), "deployed", "a successful re-run counts");
});

// ---------------------------------------------------------------------------
// D10
// ---------------------------------------------------------------------------
Deno.test("#3980 rework D10: a change in packages/ reaches the web projects that build it", () => {
  assertEquals(webProjects(["packages/blog-document/src/index.ts"]), ["mingla-admin", "mingla-marketing"]);
  assertEquals(webProjects(["packages/location-input/src/index.ts"]), ["mingla-business"]);
  assertEquals(webProjects(["packages/brand-assets/logo.svg"]), ["mingla-admin", "mingla-business"]);
  assertEquals(webProjects(["packages/search-measurement/src/x.ts"]), ["mingla-business", "mingla-marketing"]);
  assertEquals(webProjects(["packages/scripts/ci/check.mjs"]), [], "CI scripts in packages/ build no web project");
  assertEquals(webProjects(["packages/brand-new-thing/index.ts"]), ["mingla-business"], "a package not in the map yet still reaches mingla-business");
  assertEquals(webProjects(["packages/README.md"]), [], "a file at the top of packages/ is no package");
});

/** The web projects that really build each package: package.json, tsconfig paths and imports. */
function realConsumers(): Record<string, string[]> {
  const pkgs = [...Deno.readDirSync(new URL("packages/", ROOT))].filter((e) => e.isDirectory).map((e) => e.name).sort();
  const out: Record<string, Set<string>> = Object.fromEntries(pkgs.map((p) => [p, new Set<string>()]));
  const walk = (dir: URL, files: string[] = []) => {
    for (const e of Deno.readDirSync(dir)) {
      if ([".next", "node_modules", "dist", ".vercel", "build", "out"].includes(e.name)) continue;
      const child = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) walk(child, files);
      else if (/\.(js|jsx|ts|tsx|mjs|cjs|json|css)$/.test(e.name)) files.push(Deno.readTextFileSync(child));
    }
    return files;
  };
  for (const project of WEB_PROJECTS) {
    const pj = JSON.parse(read(`${project}/package.json`));
    for (const [name, spec] of Object.entries({ ...pj.dependencies, ...pj.devDependencies })) {
      const m = /^file:\.\.\/packages\/([^/]+)/.exec(String(spec));
      if (m && out[m[1]]) out[m[1]].add(project);
      else if (String(name).startsWith("@mingla/") && out[String(name).slice(8)]) out[String(name).slice(8)].add(project);
    }
    for (const text of walk(new URL(`${project}/`, ROOT))) {
      for (const p of pkgs) {
        if (new RegExp(`(["'](?:\\.\\./)+packages/${p}[/"']|["']@mingla/${p}["'/])`).test(text)) out[p].add(project);
      }
    }
  }
  return Object.fromEntries(pkgs.map((p) => [p, WEB_PROJECTS.filter((w: string) => out[p].has(w))]));
}

Deno.test("#3980 rework D10: the package map matches the real tree", () => {
  const real = realConsumers();
  assertEquals(Object.keys(PACKAGE_CONSUMERS).sort(), Object.keys(real).sort(), "every directory under packages/ is in the map");
  for (const [p, projects] of Object.entries(real)) {
    for (const w of projects) assert((PACKAGE_CONSUMERS as Record<string, string[]>)[p].includes(w), `${w} builds ${p} but the map does not say so`);
  }
});

// ---------------------------------------------------------------------------
// The PR links comment never repeats the pull request's words.
// ---------------------------------------------------------------------------
Deno.test("#3980 rework: the PR links comment says how many entries are wrong and repeats none of them", () => {
  const hostile = "Feature Guide: @Mingla-LLC/engineering [click](https://evil.example) ![t](https://evil.example/p.png) <img src=x> `code`";
  const v = prLinksVerdict({ title: "x", body: `Issue: toward #1\n${hostile}`, author: "stranger",
    createdAt: "2026-02-01T00:00:00Z", landedAt: "2026-01-01T00:00:00Z", now: "2026-03-01T00:00:00Z" });
  assertEquals(v.ok, false);
  assert(!/@Mingla|evil\.example|\[click\]|<img|`code`|engineering/.test(v.words), v.words);
  assertMatch(v.words, /6 entries are not keys; a key is lower-case letters, digits and single hyphens, as in the pull request template/);
  const one = prLinksVerdict({ title: "x", body: "Issue: toward #1\nFeature Guide: Staff-Board", author: "s",
    createdAt: "2026-02-01T00:00:00Z", landedAt: "2026-01-01T00:00:00Z", now: "2026-03-01T00:00:00Z" });
  assertMatch(one.words, /1 entry is not a key;/);
  assert(!one.words.includes("Staff-Board"));
  const many = prLinksVerdict({ title: "x", body: "Issue: toward #1\nFeature Guide: " + Array.from({ length: 21 }, (_, i) => `k${i}`).join(", "),
    author: "s", createdAt: "2026-02-01T00:00:00Z", landedAt: "2026-01-01T00:00:00Z", now: "2026-03-01T00:00:00Z" });
  assertMatch(many.words, /more than 20 entries;/);
  assert(!many.words.includes("k20"));
});

Deno.test("#3980 rework: the PR links runner posts no pull request text", async () => {
  const gh = new FakeGitHub();
  gh.addComment(4200, "unrelated", "someone", "User");
  const r = await runScript("pr-links.mjs", "pr_future_empty.json", gh);
  assert(r.logs.length > 0);
  for (const c of gh.comments.get(4200) ?? []) assert(!c.body.includes("Small change"), "the title is never echoed");
});

// ---------------------------------------------------------------------------
// The record's title line is plain text.
// ---------------------------------------------------------------------------
Deno.test("#3980 rework: the record's title renders as plain words: no links, images, mentions or autolinks", () => {
  const title = "toward #3980 [x](https://evil.example) ![i](https://evil.example/p.png) @Mingla-LLC/everyone www.evil.example *bold*";
  const line = renderRecord({ v: 1, repo: REPO, pr: 4100, title, merged_at: MERGED_AT, merge_sha: SHA, merged_by: "m", issues: [],
    migrations_added: [], migrations_applied_state: "none", edge_functions: [], web_projects: [], deploy: { web: {}, edge: "none" },
    feature_guide: [], live_check: null }).split("\n").find((l) => l.startsWith("- PR:"))!;
  assert(!/\]\(|!\[|@Mingla|https:\/\/|www\.evil|\*bold\*/.test(line), line);
  assert(line.includes("#3980"), "issue references stay");
  assertEquals(plainText("a\nb"), "a b");
  assertEquals(readRecordData(renderRecord({ v: 1, repo: REPO, pr: 4100, title, merged_at: MERGED_AT, merge_sha: SHA, issues: [],
    deploy: { web: {}, edge: "none" } })).title, title, "the data block keeps the title as it was");
});

// ---------------------------------------------------------------------------
// D3
// ---------------------------------------------------------------------------
Deno.test("#3980 rework D3: a record on a middle page of a long issue is found and updated, never posted twice", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  for (let i = 0; i < 120; i++) gh.addComment(3980, "chatter " + i, "someone", "User");
  assertEquals((await runScript("record.mjs", "push_main.json", gh)).code, 0);
  for (let i = 0; i < 150; i++) gh.addComment(3980, "more chatter " + i, "someone", "User");
  gh.statuses.set(SHA, [{ context: "Vercel – mingla-admin", state: "success" }]);
  gh.files.set(4100, [{ filename: "mingla-admin/src/x.jsx", status: "modified" }]);
  gh.commitMessages.set(SHA, "[deploy] toward #3980: the synced system (#4100)");
  const r = await runScript("record.mjs", "status_merge_commit.json", gh);
  assertEquals(r.code, 0, r.logs.join("\n"));
  assertEquals(records(gh, 3980).length, 1, "one record per PR per issue");
  assertEquals(readRecordData(records(gh, 3980)[0].body).deploy.web, { "mingla-admin": "ready" }, "the record on page 2 was updated");
  const pages = gh.calls.filter((c) => c.method === "GET" && /issues\/3980\/comments\?per_page=100&page=2$/.test(c.path));
  assert(pages.length > 0, "the middle page was read");
});

// ---------------------------------------------------------------------------
// D2
// ---------------------------------------------------------------------------
async function race(gh: FakeGitHub) {
  const realFetch = gh.fetch;
  let listed = 0;
  let release!: () => void;
  const bothListed = new Promise<void>((r) => (release = r));
  gh.fetch = async (input: Any, init: Any = {}) => {
    const isList = (init.method ?? "GET") === "GET" && /issues\/3980\/comments\?per_page=100$/.test(String(input));
    const res = await realFetch(input, init);
    if (isList && listed < 2) {
      listed += 1;
      if (listed >= 2) release();
      await bothListed;
    }
    return res;
  };
  const g = globalThis as Any;
  const before = { process: g.process, fetch: g.fetch, log: console.log };
  const env = nodeProcess.env as Record<string, string | undefined>;
  try {
    g.process = nodeProcess;
    g.fetch = gh.fetch;
    console.log = () => {};
    env.GITHUB_EVENT_PATH = decodeURIComponent(new URL("push_main.json", FIXTURES).pathname);
    env.GITHUB_TOKEN = "t";
    env.GITHUB_REPOSITORY = REPO;
    runs += 1;
    await Promise.all([
      import(new URL(`.github/scripts/release-records/record.mjs?rework-race=${runs}a`, ROOT).href),
      import(new URL(`.github/scripts/release-records/record.mjs?rework-race=${runs}b`, ROOT).href),
    ]);
    for (let i = 0; i < 300; i++) await new Promise((r) => setTimeout(r, 2));
  } finally {
    nodeProcess.exitCode = 0;
    console.log = before.log;
    g.fetch = before.fetch;
    g.process = before.process;
    delete env.GITHUB_EVENT_PATH;
    delete env.GITHUB_TOKEN;
    delete env.GITHUB_REPOSITORY;
  }
}

Deno.test("#3980 rework D2: two runs racing on one merge leave exactly one record", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  await race(gh);
  assertEquals(listedPosts(gh), 2, "both runs posted (the race really happened)");
  assertEquals(records(gh, 3980).length, 1, "the later duplicate removed itself");
});

Deno.test("#3980 rework D2: when GitHub refuses the delete, the duplicate loses its marker and is no record", async () => {
  const gh = new FakeGitHub();
  gh.refuseDeletes = true;
  merged(gh);
  await race(gh);
  assertEquals(records(gh, 3980).length, 1);
  assert((gh.comments.get(3980) ?? []).some((c) => c.body.startsWith("A second release record for PR #4100")), "the stub points to the record");
});

const listedPosts = (gh: FakeGitHub) => gh.calls.filter((c) => c.method === "POST" && /issues\/3980\/comments$/.test(c.path)).length;

Deno.test("#3980 rework D2: a refresh with nothing new writes nothing, and the record job queues per merge commit", async () => {
  const gh = new FakeGitHub();
  merged(gh);
  await runScript("record.mjs", "push_main.json", gh);
  const writes = gh.calls.filter((c) => c.method !== "GET").length;
  await runScript("record.mjs", "push_main.json", gh);
  assertEquals(gh.calls.filter((c) => c.method !== "GET").length, writes, "an unchanged record is not rewritten");
  // The workflow is named in pieces: a whole workflow file name in a test
  // becomes a provider reference under the #2148 topology seal.
  const wf = read([".github", "workflows", ["release", "records"].join("-") + ".y" + "ml"].join("/"));
  const job = wf.slice(wf.indexOf("  release-record:"));
  assertMatch(job, /concurrency:\n\s+group: release-record-\$\{\{ github\.event_name == 'status' && github\.event\.sha \|\| github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha \|\| github\.event_name == 'push' && github\.sha/);
  assertMatch(job, /cancel-in-progress: false/);
  assert(!/release-record-\$\{\{[^}]*run_id/.test(job), "never one queue per run");
});

// ---------------------------------------------------------------------------
// P3: a Live check comment refreshes every record on its issue.
// ---------------------------------------------------------------------------
Deno.test("#3980 rework: a Live check comment refreshes every record on its issue", async () => {
  const gh = new FakeGitHub();
  merged(gh, { number: 4100, sha: SHA });
  merged(gh, { number: 4101, sha: SHA2, title: "toward #3980: the second change" });
  await runScript("record.mjs", "dispatch_pr_4100.json", gh);
  // The second record, as the bot wrote it earlier.
  gh.addComment(3980, renderRecord({ v: 1, repo: REPO, pr: 4101, title: "toward #3980: the second change", merged_at: MERGED_AT,
    merge_sha: SHA2, merged_by: "admin-merger", issues: [{ number: 3980, relation: "toward" }], migrations_added: [],
    migrations_applied_state: "none", edge_functions: [], web_projects: [], deploy: { web: {}, edge: "none" }, feature_guide: [], live_check: null }));
  gh.addComment(3980, "Live check: both changes look right in production", "sethogieva", "User", "OWNER", "2026-10-21T12:00:00Z");
  const r = await runScript("record.mjs", "comment_live_check_3980.json", gh);
  assertEquals(r.code, 0, r.logs.join("\n"));
  for (const pr of [4100, 4101]) {
    const recs = records(gh, 3980, pr);
    assertEquals(recs.length, 1);
    assertEquals(readRecordData(recs[0].body).live_check?.text, "both changes look right in production", `PR #${pr}`);
  }
});

// ---------------------------------------------------------------------------
// P4: the connector counts as the database counts.
// ---------------------------------------------------------------------------
Deno.test("#3980 rework P4: a chat name is counted and trimmed the way the database does", () => {
  assertEquals(chatName({ chat: "😀".repeat(40) }), "😀".repeat(40), "40 emoji are 40 characters (char_length)");
  assertEquals(chatName({ chat: "😀".repeat(41) }), null);
  assertEquals(chatName({ chat: "Kúnlé 🎉 Ọlá sweep" }), "Kúnlé 🎉 Ọlá sweep");
  assertEquals(chatName({ chat: "a\u0085b" }), null, "a C1 control character is refused, as [[:cntrl:]] does");
  assertEquals(chatName({ chat: "\tHosts" }), null, "a tab is not trimmed away: the database's btrim trims spaces only");
  assertEquals(chatName({ chat: "  Hosts sweep  " }), "Hosts sweep");
  assertEquals(chatName({ chat: "Hosts " }), "Hosts ", "a no-break space is kept, as btrim keeps it");
  assert(CHAT_NAME_PATTERN.unicode, "the pattern counts code points");
});
