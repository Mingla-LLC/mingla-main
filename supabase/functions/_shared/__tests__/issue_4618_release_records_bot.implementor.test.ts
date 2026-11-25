// MINGLA-INVARIANT: I-4618-BASELINE-RECORD-IDENTITY-EXACT | issue #4618 | Only a pull request by mingla-bundle-baseline[bot] that changes exactly mingla-business/scripts/ci/bundle-baseline.json is classified as a bundle_baseline release record. Every other pull request keeps the standard release kind.
// MINGLA-INVARIANT: I-4618-LIVE-CHECK-REACHES-EVERY-QUALIFYING-RECORD | issue #4618 | A trusted "Live check:" comment refreshes every record on its issue that merged before it and needs a live check (no valid one, not a bundle baseline; or an edit of the comment it holds), at most 40 per run with the rest named as an ERROR and a non-zero exit; a record that already holds any valid live check costs no GitHub calls.
// MINGLA-INVARIANT: I-4618-ISSUE-WAIVER-ONE-RULE | issue #4618 | The release record drops no_issue exactly when the PR links check needs no issue link (a bot pull request, or "Issue: none, <reason>"), read from the one rule issueLinkWaiver.
//
// Issue #4618 — the merge bot (.github/scripts/release-records/record.mjs and
// lib.mjs) driven against a fake GitHub:
//   SC-1   the baseline bot changing only the baseline file: bundle_baseline,
//          no live_check_missing, no web_not_deployed, "Live check: N/A".
//   SC-2   the same file by a person, or the bot changing another file too:
//          standard, with the full checklist.
//   SC-5   a trusted live check on an issue with 45 records refreshes exactly
//          the 30 that need it; the other 15 cost zero GitHub calls.
//   SC-6   45 qualifying records: 40 refreshed, the 5 left named as an ERROR,
//          exit 1; a re-run refreshes the 5 and touches none of the 40.
//   SC-7   records merged after the live check are not refreshed by it.
//   SC-12  (rework P2-1) 44 records already holding a valid live check, 1
//          without, and bundle baselines without: exactly 1 refreshed, exit 0.
//   ADV    an untrusted author's "Live check:" refreshes nothing; an edited
//          live-check comment re-qualifies the record that holds it.
//   SC-8   once the PR links an issue, the old record comment on the PR itself
//          loses its marker and points at the issue's record.
//   SC-10  a Dependabot PR's record has no no_issue.
//   SC-11  "Issue: none, <reason>" by a person: no no_issue; bare "Issue: none": no_issue.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import nodeProcess from "node:process";
import {
  issueLinkWaiver,
  prLinksVerdict,
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
    await import(new URL(`.github/scripts/release-records/record.mjs?issue-4618=${runs}`, ROOT).href);
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

// ---------------------------------------------------------------- SC-1, SC-2

const BOT = { login: "mingla-bundle-baseline[bot]", type: "Bot" };
const BASELINE_BODY = `Re-measured main.\n\nIssue: toward #3493\nFeature Guide: none — measured baseline only, no user-facing change\n`;

async function dispatchBaseline(user: { login: string; type: string }, files: string[]) {
  const gh = new FakeGitHub();
  gh.issues = [3493];
  gh.addPr(4100, 0, { user, files, title: "Record business-web boot payload growth", body: BASELINE_BODY });
  const logs: string[] = [];
  const code = await run(gh, DISPATCH_4100, logs);
  return { gh, logs, code, data: dataOn(gh, 3493, 4100), body: recordOn(gh, 3493, 4100)?.body ?? "" };
}

Deno.test("#4618 SC-1: the baseline bot changing only the baseline file gets a bundle_baseline record with nothing left", async () => {
  const { code, logs, data, body } = await dispatchBaseline(BOT, [BASELINE]);
  assertEquals(code, 0, logs.join("\n"));
  assertEquals(data.release_kind, "bundle_baseline");
  assertEquals(data.web_projects, []);
  assertEquals(data.deploy.web, {});
  assertEquals(data.problems, [], "no live_check_missing, no web_not_deployed, no no_issue");
  assert(body.includes("- Live check: N/A (machine-written bundle baseline; nothing ships)"), body);
  assert(body.includes("- Deploy: N/A"), body);
  assert(body.includes("Status: Complete"), body);
});

Deno.test("#4618 SC-2: the baseline file changed by a person keeps the full checklist", async () => {
  const { code, logs, data } = await dispatchBaseline({ login: "sethogieva", type: "User" }, [BASELINE]);
  assertEquals(code, 0, logs.join("\n"));
  assertEquals(data.release_kind, "standard");
  assertEquals(data.web_projects, ["mingla-business"]);
  assertEquals(data.problems, ["web_not_deployed", "live_check_missing"]);
});

Deno.test("#4618 SC-2: the baseline bot changing another file as well keeps the full checklist", async () => {
  const { code, logs, data } = await dispatchBaseline(BOT, [BASELINE, "mingla-business/src/app.tsx"]);
  assertEquals(code, 0, logs.join("\n"));
  assertEquals(data.release_kind, "standard");
  assert(data.problems.includes("live_check_missing"), JSON.stringify(data.problems));
  assert(data.problems.includes("web_not_deployed"), JSON.stringify(data.problems));
});

Deno.test("#4618 SC-1: an older record's web deploy state does not come back into a bundle_baseline record", () => {
  // The merge keeps the fresh record's deploy for a bundle baseline.
  const fresh = { pr: 1, merged_at: "2026-11-01T00:00:00Z", release_kind: "bundle_baseline", issues: [{ number: 3493, relation: "toward" }],
    feature_guide: [], deploy: { web: {}, edge: "none" }, web_projects: [], live_check: null };
  assertEquals(recordProblems(fresh), []);
  assertEquals(recordProblems({ ...fresh, deploy: { web: { "mingla-business": "not_deployed" }, edge: "none" } }), [],
    "a bundle baseline never needs a web deploy");
  assertEquals(recordProblems({ ...fresh, release_kind: "standard" }), ["live_check_missing"]);
});

// ---------------------------------------------------------------- SC-5 .. SC-7

// live: "older" is a check made before the PR merged (not valid for it);
// "earlier" is a valid check made after the merge, before this comment.
type Live = "none" | "this" | "older" | "earlier";
function seed(gh: FakeGitHub, prs: { pr: number; i: number; live: Live; kind?: string }[]) {
  gh.issues = [ISSUE];
  for (const { pr, i, live, kind } of prs) {
    gh.addPr(pr, i);
    const data = {
      v: 1, repo: REPO, pr, title: `toward #${ISSUE}: change ${pr}`, pr_url: `https://github.com/${REPO}/pull/${pr}`,
      merged_at: mergedAt(i), merge_sha: shaFor(pr), merged_by: "m", author: "a",
      issues: [{ number: ISSUE, relation: "toward" }], release_kind: kind ?? "standard", issue_waiver: null, issue_waiver_reason: null,
      migrations_added: [], migrations_applied_state: "none", migrations_status: null, edge_functions: [], web_projects: [],
      deploy_marker: false, deploy: { web: {}, edge: "none" }, web_original_state: {}, web_supersession: null,
      edge_original_state: "none", edge_supersession: null, feature_guide: [], feature_guide_reason: "test only change",
      live_check: live === "none" ? null
        : live === "this" ? { text: "walked production", by_login: "sethogieva", url: LIVE_URL, at: LIVE_AT }
        : live === "earlier" ? { text: "an earlier check", by_login: "sethogieva", url: `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-2`, at: "2026-11-19T00:00:00Z" }
        : { text: "an older check", by_login: "sethogieva", url: `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-1`, at: "2026-10-01T00:00:00Z" },
      test_files: [], problems: [] as string[],
    };
    data.problems = recordProblems(data);
    gh.addComment(ISSUE, renderRecord(data), "github-actions[bot]", "Bot", "NONE", mergedAt(i));
  }
  // The earlier live check ("earlier" records hold it) and the live-check
  // comment itself (id 7777, the fixtures' comment).
  gh.addComment(ISSUE, "Live check: an earlier check", "sethogieva", "User", "OWNER", "2026-11-19T00:00:00Z", 2);
  gh.addComment(ISSUE, "Live check: walked production", "sethogieva", "User", "OWNER", LIVE_AT, 7777);
}

// Merged before the live check (2026-11-20T12:00Z): i < 467 hours after 1 Nov.
const BEFORE = (k: number) => k;          // 1 Nov + k hours
const AFTER = (k: number) => 500 + k;     // after 21 Nov

Deno.test("#4618 SC-5/SC-7: a live check refreshes exactly the 30 records that need it; the other 15 cost no calls", async () => {
  const gh = new FakeGitHub();
  const needs = Array.from({ length: 30 }, (_, k) => ({ pr: 5000 + k, i: BEFORE(k), live: (k % 2 === 0 ? "none" : "older") as "none" | "older" }));
  const holds = Array.from({ length: 10 }, (_, k) => ({ pr: 5100 + k, i: BEFORE(40 + k), live: "this" as const }));
  const later = Array.from({ length: 5 }, (_, k) => ({ pr: 5200 + k, i: AFTER(k), live: "none" as const }));
  seed(gh, [...needs, ...holds, ...later]);
  const untouched = [...holds, ...later].map((r) => [r.pr, recordOn(gh, ISSUE, r.pr)!.body] as const);
  const logs: string[] = [];
  assertEquals(await run(gh, new URL("comment_live_check.json", FIXTURES_4618), logs), 0, logs.join("\n"));
  for (const { pr } of needs) {
    assertEquals(gh.pullReads(pr) > 0, true, `PR #${pr} was refreshed`);
    assertEquals(dataOn(gh, ISSUE, pr).live_check?.url, LIVE_URL, `PR #${pr} took the live check`);
  }
  for (const [pr, body] of untouched) {
    assertEquals(gh.pullReads(pr), 0, `PR #${pr} cost no refresh call`);
    assertEquals(recordOn(gh, ISSUE, pr)!.body, body, `PR #${pr} is untouched`);
  }
  // SC-7: a record merged after the live check never takes it.
  for (const { pr } of later) assertEquals(dataOn(gh, ISSUE, pr).live_check ?? null, null);
  assert(!logs.some((l) => l.startsWith("release-record: ERROR:")), logs.join("\n"));
});

Deno.test("#4618 SC-6: 45 qualifying records — 40 refreshed oldest first, 5 named as an ERROR, exit 1; a re-run does the 5", async () => {
  const gh = new FakeGitHub();
  const all = Array.from({ length: 45 }, (_, k) => ({ pr: 6000 + k, i: BEFORE(k), live: "none" as const }));
  seed(gh, all);
  const logs: string[] = [];
  assertEquals(await run(gh, new URL("comment_live_check.json", FIXTURES_4618), logs), 1, logs.join("\n"));
  const first = all.slice(0, 40).map((r) => r.pr);
  const rest = all.slice(40).map((r) => r.pr);
  for (const pr of first) assertEquals(dataOn(gh, ISSUE, pr).live_check?.url, LIVE_URL, `PR #${pr} refreshed in the first run`);
  for (const pr of rest) assertEquals(gh.pullReads(pr), 0, `PR #${pr} left for the re-run`);
  const err = logs.find((l) => l.startsWith("release-record: ERROR: live check reached"));
  assertEquals(err, `release-record: ERROR: live check reached 40 of 45 records; re-run this run for PRs ${rest.map((n) => `#${n}`).join(", ")}`);

  const before = gh.calls.length;
  const again: string[] = [];
  assertEquals(await run(gh, new URL("comment_live_check.json", FIXTURES_4618), again), 0, again.join("\n"));
  const second = gh.calls.slice(before);
  for (const pr of rest) assertEquals(dataOn(gh, ISSUE, pr).live_check?.url, LIVE_URL, `PR #${pr} refreshed by the re-run`);
  for (const pr of first) {
    assertEquals(second.filter((c) => c.method === "GET" && c.path.split("?")[0] === `${B}/pulls/${pr}`).length, 0, `PR #${pr} not refreshed again`);
  }
});

Deno.test("#4618 SC-12: on a busy issue only the record that needs a live check is refreshed; exit 0", async () => {
  const gh = new FakeGitHub();
  const holding = Array.from({ length: 44 }, (_, k) => ({ pr: 6500 + k, i: BEFORE(k), live: "earlier" as const }));
  const needs = { pr: 6600, i: BEFORE(50), live: "none" as const };
  const baselines = Array.from({ length: 3 }, (_, k) => ({ pr: 6700 + k, i: BEFORE(60 + k), live: "none" as const, kind: "bundle_baseline" }));
  seed(gh, [...holding, needs, ...baselines]);
  const logs: string[] = [];
  assertEquals(await run(gh, new URL("comment_live_check.json", FIXTURES_4618), logs), 0, logs.join("\n"));
  assertEquals(dataOn(gh, ISSUE, needs.pr).live_check?.url, LIVE_URL, "the one record without a live check took it");
  for (const { pr } of [...holding, ...baselines]) assertEquals(gh.pullReads(pr), 0, `PR #${pr} cost no refresh call`);
  assertEquals(gh.calls.filter((c) => c.method === "GET" && /\/pulls\/\d+$/.test(c.path.split("?")[0])).length > 0, true);
  assert(!logs.some((l) => l.startsWith("release-record: ERROR:")), logs.join("\n"));
});

Deno.test("#4618 ADV: an untrusted author's Live check refreshes nothing", async () => {
  const gh = new FakeGitHub();
  seed(gh, [{ pr: 7000, i: BEFORE(0), live: "none" }]);
  const logs: string[] = [];
  assertEquals(await run(gh, new URL("comment_live_check_untrusted.json", FIXTURES_4618), logs), 0, logs.join("\n"));
  assertEquals(gh.pullReads(7000), 0);
  assertEquals(gh.calls.filter((c) => c.method !== "GET").length, 0, "nothing written");
});

Deno.test("#4618 ADV: an edited live-check comment re-qualifies the record that holds it; a created one does not", async () => {
  const gh = new FakeGitHub();
  seed(gh, [{ pr: 7100, i: BEFORE(0), live: "this" }]);
  const logs: string[] = [];
  assertEquals(await run(gh, new URL("comment_live_check.json", FIXTURES_4618), logs), 0, logs.join("\n"));
  assertEquals(gh.pullReads(7100), 0, "created: already holds this live check");
  assertEquals(await run(gh, new URL("comment_live_check_edited.json", FIXTURES_4618), logs), 0, logs.join("\n"));
  assert(gh.pullReads(7100) > 0, "edited: refreshed");
});

// ---------------------------------------------------------------- SC-8 (bot side)

Deno.test("#4618 SC-8: once the PR links an issue, its old record on the PR itself becomes a pointer without the marker", async () => {
  const gh = new FakeGitHub();
  gh.issues = [ISSUE];
  gh.addPr(4100, 0, { body: "Feature Guide: none — test only change\n", title: "a change" });
  const logs: string[] = [];
  assertEquals(await run(gh, DISPATCH_4100, logs), 0, logs.join("\n"));
  assert(recordOn(gh, 4100, 4100), "first written on the PR itself (no issue linked)");
  assertEquals(dataOn(gh, 4100, 4100).problems.includes("no_issue"), true);
  gh.prs.get(4100)!.body = `Issue: toward #${ISSUE}\n\nFeature Guide: none — test only change\n`;
  assertEquals(await run(gh, DISPATCH_4100, logs), 0, logs.join("\n"));
  assert(recordOn(gh, ISSUE, 4100), "the record now lives on the issue");
  assertEquals(recordOn(gh, 4100, 4100), undefined, "the PR comment carries no marker");
  const pointer = (gh.comments.get(4100) ?? [])[0];
  assert(pointer.body.startsWith(`The release record for PR #4100 now lives on #${ISSUE}: https://github.com/${REPO}/issues/${ISSUE}#issuecomment-`), pointer.body);
  assert(!pointer.body.includes("mingla-release-record"), pointer.body);
});

// ---------------------------------------------------------------- SC-10, SC-11 (D1)

async function dispatchNoIssue(user: { login: string; type: string }, body: string) {
  const gh = new FakeGitHub();
  gh.addPr(4100, 0, { user, body, title: "bump a dependency" });
  const logs: string[] = [];
  assertEquals(await run(gh, DISPATCH_4100, logs), 0, logs.join("\n"));
  return { data: dataOn(gh, 4100, 4100), body: recordOn(gh, 4100, 4100)?.body ?? "" };
}

Deno.test("#4618 SC-10: a Dependabot PR's record has no no_issue", async () => {
  const { data, body } = await dispatchNoIssue({ login: "dependabot[bot]", type: "Bot" }, "Bumps x from 1.0.0 to 1.0.1.\n");
  assertEquals(data.issue_waiver, "bot");
  assertEquals(data.problems.includes("no_issue"), false, JSON.stringify(data.problems));
  assert(body.includes("- Issues: none needed (a bot pull request)"), body);
});

Deno.test("#4618 SC-11: 'Issue: none, <reason>' by a person drops no_issue; a bare 'Issue: none' keeps it", async () => {
  const withReason = await dispatchNoIssue({ login: "sethogieva", type: "User" },
    "Issue: none, lockfile-only dependency patch\nFeature Guide: none — lockfile only\n");
  assertEquals(withReason.data.issue_waiver, "none");
  assertEquals(withReason.data.problems.includes("no_issue"), false, JSON.stringify(withReason.data.problems));
  assert(withReason.body.includes("- Issues: none: lockfile-only dependency patch"), withReason.body);
  const bare = await dispatchNoIssue({ login: "sethogieva", type: "User" }, "Issue: none\nFeature Guide: none — lockfile only\n");
  assertEquals(bare.data.issue_waiver, null);
  assertEquals(bare.data.problems.includes("no_issue"), true, JSON.stringify(bare.data.problems));
});

Deno.test("#4618 D1: the record's waiver and the PR links check agree, from one rule", () => {
  const now = "2026-12-30T00:00:00Z";
  const landedAt = "2026-01-01T00:00:00Z";
  const cases: [Any, string][] = [
    [{ login: "dependabot[bot]", type: "Bot" }, "Bumps x."],
    [{ login: "mingla-bundle-baseline[bot]", type: "Bot" }, "Issue: toward #3493"],
    [{ login: "sethogieva", type: "User" }, "Issue: none, lockfile-only patch\nFeature Guide: none — lockfile only"],
    [{ login: "sethogieva", type: "User" }, "Issue: none\nFeature Guide: none — lockfile only"],
    [{ login: "sethogieva", type: "User" }, "Feature Guide: none — lockfile only"],
  ];
  for (const [author, body] of cases) {
    const verdict = prLinksVerdict({ title: "x", body, author, createdAt: now, landedAt, now });
    const needsLink = verdict.missing.includes("an issue link");
    const waived = issueLinkWaiver({ author, body }) !== null;
    // A PR with no linked issue: the check asks for a link exactly when the record would say no_issue.
    assertEquals(needsLink, !waived, `${author.login}: ${body}`);
    const problems = recordProblems({ issues: [], issue_waiver: issueLinkWaiver({ author, body })?.kind ?? null, feature_guide: [], live_check: { at: now } });
    assertEquals(problems.includes("no_issue"), needsLink, `${author.login}: ${body}`);
  }
});
