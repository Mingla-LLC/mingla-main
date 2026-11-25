// MINGLA-INVARIANT: I-4618-LIVE-CHECK-CAP-EXACT | issue #4618 | The 40-record cap is exact (40 qualify: exit 0, no ERROR; 41: the 41st, newest merge, named, exit 1), and a live check created before a PR merged never counts for it, even when the comment is later edited.
//
// Issue #4618 — tester adversarial suite for the merge bot
// (.github/scripts/release-records/record.mjs and lib.mjs), driven against a
// fake GitHub. Angles the implementor suite does not take:
//   T1  only the baseline app's exact login and the exact single path make a
//       bundle baseline (look-alike logins, other bots, extra or no files,
//       a path with a prefix) — unit and through a real dispatch.
//   T2  the 40-record cap boundary: exactly 40 qualifying records, and 41.
//   T3  a live check created before a PR merged never counts for it, even as an
//       "edited" event; a PR merged at the very same instant does count.
//   T4  a too-short "Issue: none" reason keeps no_issue; a waiver that goes
//       away on a later refresh brings no_issue back (the fresh record wins).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import {
  isBundleBaselinePr,
  issueLinkWaiver,
  mergeRecordData,
  readRecordData,
  recordProblems,
  renderRecord,
} from "../../../../.github/scripts/release-records/lib.mjs";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPO = "Mingla-LLC/mingla-main";
const API = "https://api.github.com";
const ROOT = new URL("../../../../", import.meta.url);
const B = `/repos/${REPO}`;
const ISSUE = 4618;
const LIVE_AT = "2026-11-20T12:00:00Z";
const LIVE_URL = `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-7777`;
const BASELINE = "mingla-business/scripts/ci/bundle-baseline.json";

type Comment = { id: number; body: string; user: { login: string; type: string }; author_association: string; created_at: string; updated_at: string; html_url: string };
type Pr = { number: number; merged_at: string; sha: string; title: string; body: string; user: { login: string; type: string }; files: string[] };

const shaFor = (n: number) => String(n).padStart(40, "0");
const mergedAt = (i: number) => new Date(Date.parse("2026-11-01T00:00:00Z") + i * 3600_000).toISOString();

class FakeGitHub {
  calls: { method: string; path: string }[] = [];
  comments = new Map<number, Comment[]>();
  prs = new Map<number, Pr>();
  issues = [ISSUE];
  nextId = 20000;
  permissions = new Map<string, string>();

  addComment(issue: number, body: string, login = "github-actions[bot]", type = "Bot", assoc = "NONE", at = "2026-11-01T00:00:00Z", id?: number) {
    const cid = id ?? this.nextId++;
    const c: Comment = { id: cid, body, user: { login, type }, author_association: assoc, created_at: at, updated_at: at,
      html_url: `https://github.com/${REPO}/issues/${issue}#issuecomment-${cid}` };
    this.comments.set(issue, [...(this.comments.get(issue) ?? []), c]);
    return c;
  }

  addPr(number: number, i: number, over: Partial<Pr> = {}) {
    this.prs.set(number, { number, merged_at: mergedAt(i), sha: shaFor(number), title: `toward #${ISSUE}: change ${number}`,
      body: `Issue: toward #${ISSUE}\n\nFeature Guide: none — test only change\n`, user: { login: "a", type: "User" },
      files: ["supabase/functions/_shared/__tests__/x.test.ts"], ...over });
  }

  pullReads(n: number) {
    return this.calls.filter((c) => c.method === "GET" && c.path.split("?")[0] === `${B}/pulls/${n}`).length;
  }

  fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    this.calls.push({ method, path: url.pathname + url.search });
    return Promise.resolve(this.answer(method, url, init.body ? JSON.parse(String(init.body)) : undefined));
  };

  answer(method: string, url: URL, body: Any): Response {
    const path = url.pathname;
    let m: RegExpExecArray | null;
    if (url.origin !== API) return json(599, {});
    if (method === "GET" && (m = new RegExp(`^${B}/commits/([0-9a-f]{40})$`).exec(path))) {
      const pr = [...this.prs.values()].find((p) => p.sha === m![1]);
      return json(200, { commit: { message: `${pr?.title ?? "x"} (#${pr?.number ?? 0})` } });
    }
    if (method === "GET" && new RegExp(`^${B}/commits/[0-9a-f]{40}/status$`).test(path)) return json(200, { statuses: [] });
    if (method === "GET" && new RegExp(`^${B}/commits/[0-9a-f]{40}/check-runs$`).test(path)) return json(200, { check_runs: [] });
    if (method === "GET" && path === `${B}/actions/runs`) return json(200, { workflow_runs: [] });
    if (method === "GET" && (m = new RegExp(`^${B}/collaborators/([^/]+)/permission$`).exec(path))) {
      const perm = this.permissions.get(decodeURIComponent(m[1]));
      return perm === undefined ? json(404, { message: "Not Found" }) : json(200, { permission: perm });
    }
    if (method === "GET" && (m = new RegExp(`^${B}/pulls/(\\d+)/files$`).exec(path))) {
      const pr = this.prs.get(Number(m[1]));
      if (!pr) return json(404, {});
      return json(200, Number(url.searchParams.get("page") ?? "1") === 1 ? pr.files.map((filename) => ({ filename, status: "modified" })) : []);
    }
    if (method === "GET" && (m = new RegExp(`^${B}/pulls/(\\d+)$`).exec(path))) {
      const pr = this.prs.get(Number(m[1]));
      if (!pr) return json(404, { message: "Not Found" });
      return json(200, { number: pr.number, title: pr.title, body: pr.body, merged_at: pr.merged_at, merge_commit_sha: pr.sha,
        base: { ref: "main" }, merged_by: { login: "m" }, user: pr.user, changed_files: pr.files.length });
    }
    if (method === "GET" && (m = new RegExp(`^${B}/issues/(\\d+)$`).exec(path))) {
      const n = Number(m[1]);
      if (this.prs.has(n)) return json(200, { number: n, pull_request: {} });
      return this.issues.includes(n) ? json(200, { number: n }) : json(404, { message: "Not Found" });
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
      const page = Number(url.searchParams.get("page") ?? "1");
      const slice = all.slice((page - 1) * 100, page * 100);
      const last = Math.max(1, Math.ceil(all.length / 100));
      return new Response(JSON.stringify(slice), { status: 200, headers: { "content-type": "application/json",
        link: last > 1 ? `<${API}${path}?per_page=100&page=${last}>; rel="last"` : "" } });
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

const FIXTURES_4618 = new URL("fixtures/issue_4618_release_records/", import.meta.url);
const FIXTURES_3980 = new URL("fixtures/issue_3980_release_records/", import.meta.url);
let runs = 0;

/** One run of record.mjs against the fake; returns its exit code once the run has gone quiet. */
async function run(gh: FakeGitHub, fixture: URL, logs: string[]): Promise<number> {
  const env = nodeProcess.env as Record<string, string | undefined>;
  const g = globalThis as Any;
  const before = { process: g.process, fetch: g.fetch, log: console.log };
  const saved = { p: env.GITHUB_EVENT_PATH, t: env.GITHUB_TOKEN, r: env.GITHUB_REPOSITORY };
  const start = logs.length;
  const done = () => logs.slice(start).some((l) => /^release-record: (PR #|stopped|no merged)/.test(l));
  try {
    g.process = nodeProcess;
    g.fetch = (input: Any, init?: Any) => gh.fetch(input, init);
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    nodeProcess.exitCode = 0;
    env.GITHUB_EVENT_PATH = decodeURIComponent(fixture.pathname);
    env.GITHUB_TOKEN = "test-token-not-real";
    env.GITHUB_REPOSITORY = REPO;
    runs += 1;
    await import(new URL(`.github/scripts/release-records/record.mjs?issue-4618-tester=${runs}`, ROOT).href);
    for (let i = 0; i < 5000 && !done(); i++) await new Promise((r) => setTimeout(r, 1));
    assert(done(), `the run finished:\n${logs.slice(start).join("\n")}`);
    // Wait until the run goes quiet (no new log or call for 100 ticks).
    let quiet = 0;
    let seen = logs.length + gh.calls.length;
    while (quiet < 100) {
      await new Promise((r) => setTimeout(r, 1));
      const now = logs.length + gh.calls.length;
      quiet = now === seen ? quiet + 1 : 0;
      seen = now;
    }
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

const recordOn = (gh: FakeGitHub, issue: number, pr: number) =>
  (gh.comments.get(issue) ?? []).find((c) => c.user.login === "github-actions[bot]" && c.body.includes(`mingla-release-record:pr-${pr} -->`));
const dataOn = (gh: FakeGitHub, issue: number, pr: number) => readRecordData(recordOn(gh, issue, pr)?.body ?? "");
const DISPATCH_4100 = new URL("dispatch_pr_4100.json", FIXTURES_3980);
const LIVE_CREATED = new URL("comment_live_check.json", FIXTURES_4618);
const LIVE_EDITED = new URL("comment_live_check_edited.json", FIXTURES_4618);
// The fixtures' live check is at 2026-11-20T12:00Z = 1 Nov + 468 hours.
const LIVE_HOUR = 468;

function seed(gh: FakeGitHub, prs: { pr: number; i: number; live: "none" | "this" | "older" }[]) {
  gh.issues = [ISSUE];
  for (const { pr, i, live } of prs) {
    gh.addPr(pr, i);
    const data = {
      v: 1, repo: REPO, pr, title: `toward #${ISSUE}: change ${pr}`, pr_url: `https://github.com/${REPO}/pull/${pr}`,
      merged_at: mergedAt(i), merge_sha: shaFor(pr), merged_by: "m", author: "a",
      issues: [{ number: ISSUE, relation: "toward" }], release_kind: "standard", issue_waiver: null, issue_waiver_reason: null,
      migrations_added: [], migrations_applied_state: "none", migrations_status: null, edge_functions: [], web_projects: [],
      deploy_marker: false, deploy: { web: {}, edge: "none" }, web_original_state: {}, web_supersession: null,
      edge_original_state: "none", edge_supersession: null, feature_guide: [], feature_guide_reason: "test only change",
      live_check: live === "none" ? null
        : live === "this" ? { text: "walked production", by_login: "sethogieva", url: LIVE_URL, at: LIVE_AT }
        : { text: "an older check", by_login: "sethogieva", url: `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-1`, at: "2026-10-01T00:00:00Z" },
      test_files: [], problems: [] as string[],
    };
    data.problems = recordProblems(data);
    gh.addComment(ISSUE, renderRecord(data), "github-actions[bot]", "Bot", "NONE", mergedAt(i));
  }
  // The live-check comment itself (id 7777, the fixtures' comment).
  gh.addComment(ISSUE, "Live check: walked production", "sethogieva", "User", "OWNER", LIVE_AT, 7777);
}


// ---------------------------------------------------------------- T1

Deno.test("#4618 tester T1: only the exact baseline login and the exact single path are a bundle baseline", () => {
  const bot = { login: "mingla-bundle-baseline[bot]", type: "Bot" };
  assertEquals(isBundleBaselinePr({ author: bot, paths: [BASELINE] }), true);
  assertEquals(isBundleBaselinePr({ author: "mingla-bundle-baseline[bot]", paths: [BASELINE] }), true);
  const no: [Any, string[], string][] = [
    [{ login: "mingla-bundle-baseline", type: "User" }, [BASELINE], "look-alike person login"],
    [{ login: "Mingla-Bundle-Baseline[bot]", type: "Bot" }, [BASELINE], "case variant"],
    [{ login: "github-actions[bot]", type: "Bot" }, [BASELINE], "another bot"],
    [{ login: "dependabot[bot]", type: "Bot" }, [BASELINE], "dependabot"],
    [bot, [], "no files"],
    [bot, [BASELINE, BASELINE], "the file listed twice"],
    [bot, [`./${BASELINE}`], "a prefixed path"],
    [bot, ["mingla-business/scripts/ci/bundle-baseline.json.bak"], "a sibling path"],
    [bot, ["mingla-admin/scripts/ci/bundle-baseline.json"], "another app's baseline"],
    [null, [BASELINE], "no author"],
  ];
  for (const [author, paths, why] of no) assertEquals(isBundleBaselinePr({ author, paths }), false, why);
});

Deno.test("#4618 tester T1: another bot changing only the baseline file gets a standard record with the full checklist", async () => {
  const gh = new FakeGitHub();
  gh.issues = [3493];
  gh.addPr(4100, 0, { user: { login: "github-actions[bot]", type: "Bot" }, files: [BASELINE], title: "Record growth",
    body: "Issue: toward #3493\nFeature Guide: none — measured baseline only, no user-facing change\n" });
  const logs: string[] = [];
  assertEquals(await run(gh, DISPATCH_4100, logs), 0, logs.join("\n"));
  const data = dataOn(gh, 3493, 4100);
  assertEquals(data.release_kind, "standard");
  assertEquals(data.web_projects, ["mingla-business"]);
  assertEquals(data.problems, ["web_not_deployed", "live_check_missing"]);
  assert(!recordOn(gh, 3493, 4100)!.body.includes("N/A (machine-written bundle baseline"), "no N/A live check");
});

Deno.test("#4618 tester T1: the baseline app with no changed files is not a bundle baseline", async () => {
  const gh = new FakeGitHub();
  gh.issues = [3493];
  gh.addPr(4100, 0, { user: { login: "mingla-bundle-baseline[bot]", type: "Bot" }, files: [], title: "Empty",
    body: "Issue: toward #3493\nFeature Guide: none — measured baseline only, no user-facing change\n" });
  const logs: string[] = [];
  assertEquals(await run(gh, DISPATCH_4100, logs), 0, logs.join("\n"));
  assertEquals(dataOn(gh, 3493, 4100).release_kind, "standard");
  assert(dataOn(gh, 3493, 4100).problems.includes("live_check_missing"));
});

// ---------------------------------------------------------------- T2

async function capRun(n: number) {
  const gh = new FakeGitHub();
  const all = Array.from({ length: n }, (_, k) => ({ pr: 8000 + k, i: k, live: "none" as const }));
  seed(gh, all);
  const logs: string[] = [];
  const code = await run(gh, LIVE_CREATED, logs);
  return { gh, all, logs, code };
}

Deno.test("#4618 tester T2: exactly 40 qualifying records are all refreshed, exit 0, no ERROR", async () => {
  const { gh, all, logs, code } = await capRun(40);
  assertEquals(code, 0, logs.join("\n"));
  for (const { pr } of all) assertEquals(dataOn(gh, ISSUE, pr).live_check?.url, LIVE_URL, `PR #${pr}`);
  assert(!logs.some((l) => l.startsWith("release-record: ERROR")), logs.join("\n"));
});

Deno.test("#4618 tester T2: 41 qualifying records — the 41st (newest merge) is named, untouched, exit 1", async () => {
  const { gh, all, logs, code } = await capRun(41);
  assertEquals(code, 1, logs.join("\n"));
  const last = all[40].pr;
  for (const { pr } of all.slice(0, 40)) assertEquals(dataOn(gh, ISSUE, pr).live_check?.url, LIVE_URL, `PR #${pr}`);
  assertEquals(gh.pullReads(last), 0, "the 41st costs no refresh call");
  assertEquals(dataOn(gh, ISSUE, last).live_check ?? null, null);
  assertEquals(logs.filter((l) => l.startsWith("release-record: ERROR")),
    [`release-record: ERROR: live check reached 40 of 41 records; re-run this run for PRs #${last}`]);
});

// ---------------------------------------------------------------- T3

Deno.test("#4618 tester T3: a live check created before a PR merged never counts for it, even when edited", async () => {
  const gh = new FakeGitHub();
  // 8100 merged one hour after the comment; 8101 merged at the same instant.
  seed(gh, [{ pr: 8100, i: LIVE_HOUR + 1, live: "none" }, { pr: 8101, i: LIVE_HOUR, live: "none" }]);
  for (const fixture of [LIVE_CREATED, LIVE_EDITED]) {
    const logs: string[] = [];
    assertEquals(await run(gh, fixture, logs), 0, logs.join("\n"));
    assertEquals(gh.pullReads(8100), 0, "merged after the comment: never refreshed by it");
    assertEquals(dataOn(gh, ISSUE, 8100).live_check ?? null, null);
  }
  assertEquals(dataOn(gh, ISSUE, 8101).live_check?.url, LIVE_URL, "merged at the comment's instant: counts");
});

// ---------------------------------------------------------------- T4

Deno.test("#4618 tester T4: a too-short 'Issue: none' reason is no waiver; a removed waiver brings no_issue back", () => {
  const person = { login: "sethogieva", type: "User" };
  assertEquals(issueLinkWaiver({ author: person, body: "Issue: none, ok\n" }), null);
  assertEquals(issueLinkWaiver({ author: person, body: "Issue: none -\n" }), null);
  assertEquals(issueLinkWaiver({ author: person, body: "Issue: nonexistent thing\n" }), null);
  assertEquals(issueLinkWaiver({ author: person, body: "Issue: none, lockfile only\n" })?.kind, "none");

  const base = { pr: 1, merged_at: "2026-11-01T00:00:00Z", issues: [], feature_guide: [], deploy: { web: {}, edge: "none" },
    live_check: { text: "x", by_login: "sethogieva", url: "u", at: "2026-11-02T00:00:00Z" }, release_kind: "standard" };
  const previous = { ...base, issue_waiver: "none", issue_waiver_reason: "lockfile only", problems: [] as string[] };
  const fresh = { ...base, issue_waiver: null, issue_waiver_reason: null, problems: ["no_issue"] };
  const merged = mergeRecordData(fresh, previous);
  assertEquals(merged.issue_waiver, null, "the fresh record's waiver wins");
  assertEquals(merged.problems.includes("no_issue"), true, JSON.stringify(merged.problems));
  assertEquals(recordProblems({ ...fresh, issue_waiver: "bot" }).includes("no_issue"), false);
});

// ---------------------------------------------------------------- Retest (SC-12): T5 .. T8

type Live = { text: string; by_login: string; url: string; at: string } | null;
const EARLIER_ID = 6001;
const EARLIER_URL = `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-${EARLIER_ID}`;
const EARLIER_AT = "2026-11-10T00:00:00Z"; // 1 Nov + 216 hours
const earlier = (): Live => ({ text: "an earlier check", by_login: "sethogieva", url: EARLIER_URL, at: EARLIER_AT });

/** Records with an explicit live check and kind; the earlier live-check comment is really on the issue. */
function seedX(gh: FakeGitHub, prs: { pr: number; i: number; live: Live; kind?: string; user?: { login: string; type: string } }[]) {
  gh.issues = [ISSUE];
  gh.addComment(ISSUE, "Live check: an earlier check", "sethogieva", "User", "OWNER", EARLIER_AT, EARLIER_ID);
  for (const { pr, i, live, kind = "standard", user = { login: "a", type: "User" } } of prs) {
    gh.addPr(pr, i, { user });
    const data = {
      v: 1, repo: REPO, pr, title: `toward #${ISSUE}: change ${pr}`, pr_url: `https://github.com/${REPO}/pull/${pr}`,
      merged_at: mergedAt(i), merge_sha: shaFor(pr), merged_by: "m", author: user.login,
      issues: [{ number: ISSUE, relation: "toward" }], release_kind: kind, issue_waiver: null, issue_waiver_reason: null,
      migrations_added: [], migrations_applied_state: "none", migrations_status: null, edge_functions: [], web_projects: [],
      deploy_marker: false, deploy: { web: {}, edge: "none" }, web_original_state: {}, web_supersession: null,
      edge_original_state: "none", edge_supersession: null, feature_guide: [], feature_guide_reason: "test only change",
      live_check: live, test_files: [], problems: [] as string[],
    };
    data.problems = recordProblems(data);
    gh.addComment(ISSUE, renderRecord(data), "github-actions[bot]", "Bot", "NONE", mergedAt(i));
  }
  gh.addComment(ISSUE, "Live check: walked production", "sethogieva", "User", "OWNER", LIVE_AT, 7777);
}

Deno.test("#4618 tester T5 (SC-12): a record holding a live check made BEFORE its own merge still needs one and is refreshed", async () => {
  const gh = new FakeGitHub();
  // 8200 merged at hour 300 (after the earlier check at hour 216) but holds that earlier check.
  // 8201 merged at hour 100 and validly holds the same earlier check.
  seedX(gh, [{ pr: 8200, i: 300, live: earlier() }, { pr: 8201, i: 100, live: earlier() }]);
  const logs: string[] = [];
  assertEquals(await run(gh, LIVE_CREATED, logs), 0, logs.join("\n"));
  assert(gh.pullReads(8200) > 0, "a pre-merge live check is not valid: refreshed");
  assertEquals(dataOn(gh, ISSUE, 8200).live_check?.url, LIVE_URL);
  assertEquals(gh.pullReads(8201), 0, "a valid earlier live check: no call");
  assertEquals(dataOn(gh, ISSUE, 8201).live_check?.url, EARLIER_URL);
});

Deno.test("#4618 tester T6 (SC-12): a #3493-sized issue, 53 records mostly bundle_baseline, exits 0 and refreshes only what needs it", async () => {
  const gh = new FakeGitHub();
  const BOTU = { login: "mingla-bundle-baseline[bot]", type: "Bot" };
  const prs = [
    ...Array.from({ length: 45 }, (_, k) => ({ pr: 8300 + k, i: k, live: null as Live, kind: "bundle_baseline", user: BOTU })),
    ...Array.from({ length: 5 }, (_, k) => ({ pr: 8400 + k, i: 50 + k, live: earlier() })),
    ...Array.from({ length: 3 }, (_, k) => ({ pr: 8500 + k, i: 300 + k, live: null as Live })),
  ];
  seedX(gh, prs);
  const logs: string[] = [];
  assertEquals(await run(gh, LIVE_CREATED, logs), 0, logs.join("\n"));
  assert(!logs.some((l) => l.startsWith("release-record: ERROR")), logs.join("\n"));
  for (const { pr } of prs.slice(0, 50)) assertEquals(gh.pullReads(pr), 0, `PR #${pr} cost no call`);
  for (const { pr } of prs.slice(50)) assertEquals(dataOn(gh, ISSUE, pr).live_check?.url, LIVE_URL, `PR #${pr} took the check`);
});

Deno.test("#4618 tester T7 (SC-12): an edit re-qualifies only the record pointing at the edited comment", async () => {
  const gh = new FakeGitHub();
  // 8600 holds the fixtures' comment (7777); 8601 holds the earlier valid check; 8602 needs one.
  seedX(gh, [
    { pr: 8600, i: 220, live: { text: "walked production", by_login: "sethogieva", url: LIVE_URL, at: LIVE_AT } },
    { pr: 8601, i: 100, live: earlier() },
    { pr: 8602, i: 230, live: null },
  ]);
  const logs: string[] = [];
  assertEquals(await run(gh, LIVE_EDITED, logs), 0, logs.join("\n"));
  assert(gh.pullReads(8600) > 0, "the record holding the edited comment is refreshed");
  assertEquals(gh.pullReads(8601), 0, "a record holding another valid check is not");
  assert(gh.pullReads(8602) > 0, "a record needing a check is refreshed");
});

Deno.test("#4618 tester T8 (SC-12): an untrusted author's live check reaches nothing", async () => {
  const gh = new FakeGitHub();
  seedX(gh, [{ pr: 8700, i: 100, live: null }, { pr: 8701, i: 300, live: earlier() }]);
  const untrusted = new URL("comment_live_check_untrusted.json", FIXTURES_4618);
  const logs: string[] = [];
  assertEquals(await run(gh, untrusted, logs), 0, logs.join("\n"));
  assertEquals(gh.pullReads(8700) + gh.pullReads(8701), 0);
  assertEquals(gh.calls.filter((c) => c.method !== "GET").length, 0, "nothing written");
});
