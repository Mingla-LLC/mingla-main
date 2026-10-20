// Issue #3980 synced program, Wave 1 — the release-record bridge inside the
// 5-minute product-avengers-sync reconcile, run with a fake GitHub and a fake
// database: only the merge bot's own record comments are read, cursors only
// move forward, a low rate budget or a spent time budget stops new GitHub
// calls, a refused status post is logged once, and the #3720 steps still run
// first.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ProductAvengersClient } from "../_shared/productAvengers.ts";
import {
  type BridgeAdmin,
  type BridgeGitHub,
  runReleaseBridges,
} from "../_shared/opsBridges.ts";
import { renderRecord } from "../../../.github/scripts/release-records/lib.mjs";

type Json = Record<string, unknown>;

function record(pr: number): string {
  return renderRecord({
    v: 1, repo: "Mingla-LLC/mingla-main", pr, title: `PR ${pr}`,
    pr_url: `https://github.com/Mingla-LLC/mingla-main/pull/${pr}`, merged_at: "2026-10-21T09:00:00Z",
    merge_sha: "b".repeat(40), merged_by: "seth", author: "seth", issues: [{ number: 3980, relation: "toward" }],
    migrations_added: [], migrations_applied_state: "none", migrations_status: null, edge_functions: [], web_projects: [],
    deploy_marker: true, deploy: { web: {}, edge: "none" }, feature_guide: [], live_check: null, test_files: [],
    problems: ["live_check_missing"],
  });
}

function fakeAdmin(calls: { name: string; args?: Json }[], overrides: Record<string, unknown> = {}): BridgeAdmin {
  return {
    rpc(name: string, args?: Json) {
      calls.push({ name, args });
      const data = name in overrides ? overrides[name]
        : name === "ops_bridge_cursor" ? "2026-10-20T00:00:00+00:00"
        : name === "ops_release_records_ingest" ? { ingested: (args?.p_records as unknown[]).length, invalid: 0, completed: [] }
        : name === "ops_main_commits_ingest" ? { inserted: (args?.p_commits as unknown[]).length }
        : name === "ops_release_status_due" ? []
        : name === "ops_engineering_cards_sync" ? { added: 0, closed: 0 }
        : null;
      return Promise.resolve({ data, error: null });
    },
  };
}

function fakeGitHub(opts: Partial<BridgeGitHub> & { comments?: Json[]; commits?: Json[]; seen?: string[] } = {}): BridgeGitHub {
  const seen = opts.seen ?? [];
  return {
    budget: opts.budget ?? 4000,
    issueCommentsSince: opts.issueCommentsSince ?? (async (iso) => { seen.push(`comments:${iso}`); return opts.comments ?? []; }),
    mainCommitsSince: opts.mainCommitsSince ?? (async (iso) => { seen.push(`commits:${iso}`); return opts.commits ?? []; }),
    pullsForCommit: opts.pullsForCommit ?? (async (sha) => { seen.push(`pulls:${sha}`); return sha.startsWith("d") ? 4001 : null; }),
    createCommitStatus: opts.createCommitStatus ?? (async (sha) => { seen.push(`status:${sha}`); }),
  };
}

const BOT = { login: "github-actions[bot]", type: "Bot" };

Deno.test("#3980 bridges: only the bot's own record comments are ingested, and the cursor moves to the newest read", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const seen: string[] = [];
  const comments = [
    { user: BOT, body: record(4001), html_url: "https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-1", issue_url: "https://api.github.com/repos/Mingla-LLC/mingla-main/issues/3980", updated_at: "2026-10-21T10:00:00Z" },
    { user: { login: "github-actions[bot]", type: "User" }, body: record(4002), issue_url: "x/issues/3980", updated_at: "2026-10-21T10:05:00Z" },
    { user: { login: "stranger", type: "User" }, body: record(4003), issue_url: "x/issues/3980", updated_at: "2026-10-21T10:06:00Z" },
    { user: BOT, body: "A comment with no record", issue_url: "x/issues/3980", updated_at: "2026-10-21T10:07:00Z" },
  ];
  const out = await runReleaseBridges(fakeAdmin(calls), fakeGitHub({ comments, seen }));
  const ingest = calls.find((c) => c.name === "ops_release_records_ingest")!;
  const rows = ingest.args!.p_records as Json[];
  assertEquals(rows.map((r) => (r.data as Json).pr), [4001]);
  assertEquals(rows[0].issue_number, 3980);
  // The read starts 10 minutes before the cursor and the cursor moves to the newest comment seen.
  assertEquals(seen[0], "comments:2026-10-19T23:50:00.000Z");
  const set = calls.find((c) => c.name === "ops_bridge_cursor_set" && c.args?.p_name === "issue_comments")!;
  assertEquals(set.args!.p_at, "2026-10-21T10:07:00Z");
  assertEquals((out.release_records as Json).ingested, 1);
  assertEquals(out.failed, 0);
});

Deno.test("#3980 bridges: main commits carry their pull request, and a direct push carries none", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const commits = [
    { sha: "d".repeat(40), commit: { message: "[deploy] toward #3980: x (#4001)\n\nbody", committer: { date: "2026-10-21T09:00:00Z" } }, author: { login: "seth" } },
    { sha: "e".repeat(40), commit: { message: "Direct push", committer: { date: "2026-10-21T09:30:00Z" } }, author: null },
    { sha: "not-a-sha", commit: { message: "x", committer: { date: "2026-10-21T09:40:00Z" } } },
  ];
  await runReleaseBridges(fakeAdmin(calls), fakeGitHub({ commits }));
  const rows = calls.find((c) => c.name === "ops_main_commits_ingest")!.args!.p_commits as Json[];
  assertEquals(rows.map((r) => [r.subject, r.pr]), [["[deploy] toward #3980: x (#4001)", 4001], ["Direct push", null]]);
  assertEquals(calls.find((c) => c.name === "ops_bridge_cursor_set" && c.args?.p_name === "main_commits")!.args!.p_at, "2026-10-21T09:30:00Z");
});

Deno.test("#3980 bridges: a rate budget under 500 starts no GitHub call; the database steps still run", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const seen: string[] = [];
  const lines: Json[] = [];
  const out = await runReleaseBridges(fakeAdmin(calls, { ops_release_status_due: [{ pr: 4001, sha: "f".repeat(40), state: "success", description: "No migrations in this change" }] }),
    fakeGitHub({ budget: 499, seen }), { log: (l) => lines.push(l) });
  assertEquals(seen, []);
  assertEquals(out.deferred, ["release_records", "main_commits", "statuses"]);
  assert(lines.some((l) => l.event === "github_budget_low"));
  assert(calls.some((c) => c.name === "ops_engineering_cards_sync"));
  assert(!calls.some((c) => c.name === "ops_release_status_posted"));
});

Deno.test("#3980 bridges: after 40 seconds no new GitHub call starts", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const seen: string[] = [];
  let t = 0;
  const out = await runReleaseBridges(fakeAdmin(calls), fakeGitHub({
    seen,
    issueCommentsSince: async (iso) => { seen.push(`comments:${iso}`); t += 41_000; return []; },
  }), { now: () => t });
  assertEquals(seen.length, 1);
  assertEquals(out.deferred, ["main_commits"]);
});

Deno.test("#3980 bridges: statuses are posted and stamped; a refused post is logged once and stops", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const posted: string[] = [];
  const due = [
    { pr: 1, sha: "1".repeat(40), state: "success", description: "All applied: 20271124003980" },
    { pr: 2, sha: "2".repeat(40), state: "pending", description: "Waiting: 20271125003980" },
  ];
  const out = await runReleaseBridges(fakeAdmin(calls, { ops_release_status_due: due }), fakeGitHub({
    createCommitStatus: async (sha, s) => { posted.push(`${sha.slice(0, 1)}:${s.state}:${s.context}`); },
  }));
  assertEquals(posted, ["1:success:mingla/production-migrations", "2:pending:mingla/production-migrations"]);
  assertEquals(calls.filter((c) => c.name === "ops_release_status_posted").map((c) => c.args), [{ p_pr: 1, p_state: "success" }, { p_pr: 2, p_state: "pending" }]);
  assertEquals(out.statuses_posted, 2);

  const calls2: { name: string; args?: Json }[] = [];
  const out2 = await runReleaseBridges(fakeAdmin(calls2, { ops_release_status_due: due }), fakeGitHub({
    createCommitStatus: async () => { throw new Error("GITHUB_REST_403"); },
  }));
  assertEquals(calls2.filter((c) => c.name === "ops_release_status_refused").length, 1);
  assertEquals(out2.statuses_posted, 0);
  assertEquals(out2.failed, 0);
});

Deno.test("#3980 the client's bridge reads record the rate budget and the status write is narrow", async () => {
  const requests: { url: string; method: string; body?: string }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined });
    const u = String(url);
    const body = u.includes("/pulls") ? [{ number: 9, merged_at: null, base: { ref: "main" } }, { number: 4001, merged_at: "2026-10-21T09:00:00Z", base: { ref: "main" } }]
      : u.includes("/statuses/") ? { id: 1 } : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "x-ratelimit-remaining": "4321" } });
  }) as typeof fetch;
  const client = new ProductAvengersClient("token", fetcher);
  assertEquals(await client.pullsForCommit("d".repeat(40)), 4001);
  assertEquals(client.budget, 4321);
  await client.issueCommentsSince("2026-10-20T00:00:00Z", 3);
  assert(requests.at(-1)!.url.includes("/repos/Mingla-LLC/mingla-main/issues/comments?since=2026-10-20T00%3A00%3A00Z&sort=updated&direction=asc&per_page=100&page=1"));
  await client.createCommitStatus("d".repeat(40), { state: "success", description: "No migrations in this change", context: "mingla/production-migrations" });
  assertEquals(requests.at(-1)!.method, "POST");
  assertEquals(JSON.parse(requests.at(-1)!.body!), { state: "success", description: "No migrations in this change", context: "mingla/production-migrations" });
  await assertRejects(() => client.createCommitStatus("d".repeat(40), { state: "failure", description: "x", context: "mingla/production-migrations" }));
  await assertRejects(() => client.createCommitStatus("d".repeat(40), { state: "success", description: "x", context: "ci/other" }));
});

Deno.test("#3980 the reconcile runs the #3720 steps first, then the bridges", () => {
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const body = src.slice(src.indexOf("async function reconcile("), src.indexOf("async function postWeeklyFeatureGuideDrift("));
  const at = (s: string) => body.indexOf(s);
  assert(at("processCommand(admin, github") > 0 && at("postWeeklyFeatureGuideDrift(admin, github)") > at("processCommand(admin, github"));
  assert(at("issue_3720_apply_product_avengers_snapshot") > at("postWeeklyFeatureGuideDrift(admin, github)"));
  assert(at("runReleaseBridges(admin, github") > at("issue_3720_apply_product_avengers_snapshot"));
});
