// Issue #3980 synced program, Wave 2 — Bridge A inside the 5-minute
// product-avengers-sync reconcile, run with a fake GitHub and a fake
// database (no real GitHub call is ever made): every followed number is read
// in batches of 50 with one read-only GraphQL query each, at most 4 a run;
// a rate budget under 500 starts no read; a rate-limited or empty answer
// applies nothing and says so; a number counts as not found only when GitHub
// said NOT_FOUND for it.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AVENGERS_PROJECT_ID,
  buildFollowQuery,
  parseFollowResponse,
  ProductAvengersClient,
} from "../_shared/productAvengers.ts";
import {
  type BridgeAdmin,
  type BridgeGitHub,
  runReleaseBridges,
} from "../_shared/opsBridges.ts";

type Json = Record<string, unknown>;

function fakeAdmin(calls: { name: string; args?: Json }[], follow: number[]): BridgeAdmin {
  return {
    rpc(name: string, args?: Json) {
      calls.push({ name, args });
      const data = name === "ops_bridge_cursor" ? "2026-10-20T00:00:00+00:00"
        : name === "ops_release_records_ingest" ? { ingested: 0, invalid: 0, completed: [] }
        : name === "ops_main_commits_ingest" ? { inserted: 0 }
        : name === "ops_release_status_due" ? []
        : name === "ops_engineering_cards_sync" ? { added: 0, closed: 0 }
        : name === "ops_github_follow_list" ? follow.map((n) => ({ number: n, kind_hint: "issue" }))
        : name === "ops_github_items_apply" ? { applied: (args?.p_items as unknown[]).length, changed: [] }
        : null;
      return Promise.resolve({ data, error: null });
    },
  };
}

function fakeGitHub(opts: { budget?: number; followBatch?: BridgeGitHub["followBatch"] } = {}): BridgeGitHub {
  return {
    budget: opts.budget ?? 4000,
    issueCommentsSince: async () => [],
    mainCommitsSince: async () => [],
    pullsForCommit: async () => null,
    createCommitStatus: async () => {},
    followBatch: opts.followBatch,
  };
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

Deno.test("#3980 follow: every followed number is read in batches of 50, at most 4 a run, then applied", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const batches: number[][] = [];
  const out = await runReleaseBridges(
    fakeAdmin(calls, range(1, 230)),
    fakeGitHub({ followBatch: async (numbers) => { batches.push(numbers); return numbers.map((n) => ({ number: n, found: true, kind: "issue" })); } }),
  );
  assertEquals(batches.map((b) => b.length), [50, 50, 50, 50]);
  assertEquals(batches[0][0], 1);
  assertEquals(calls.find((c) => c.name === "ops_github_follow_list")!.args, { p_limit: 200 });
  assertEquals(calls.filter((c) => c.name === "ops_github_items_apply").length, 4);
  assertEquals(out.github_follow.followed, 230);
  assertEquals(out.github_follow.applied, 200);
  assertEquals(out.github_follow.refused, null);
});

Deno.test("#3980 follow: a rate budget under 500 starts no GitHub read (budget cap)", async () => {
  const calls: { name: string; args?: Json }[] = [];
  let reads = 0;
  const out = await runReleaseBridges(fakeAdmin(calls, [3980]),
    fakeGitHub({ budget: 499, followBatch: async () => { reads += 1; return []; } }));
  assertEquals(reads, 0);
  assert(out.deferred.includes("follow"));
  assertEquals(calls.some((c) => c.name === "ops_github_items_apply"), false);
});

Deno.test("#3980 follow: the budget falling under 500 mid-run stops the next batch", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const github = fakeGitHub();
  let reads = 0;
  github.followBatch = async (numbers) => {
    reads += 1;
    github.budget = 120;
    return numbers.map((n) => ({ number: n, found: true, kind: "issue" }));
  };
  const out = await runReleaseBridges(fakeAdmin(calls, range(1, 120)), github);
  assertEquals(reads, 1);
  assert(out.deferred.includes("follow"));
  assertEquals(out.github_budget, 120);
});

Deno.test("#3980 follow: a rate-limited or empty answer applies nothing and says so (fails closed)", async () => {
  for (const code of ["GITHUB_FOLLOW_RATE_LIMITED", "GITHUB_FOLLOW_EMPTY"]) {
    const calls: { name: string; args?: Json }[] = [];
    const lines: Json[] = [];
    const out = await runReleaseBridges(fakeAdmin(calls, range(1, 80)),
      fakeGitHub({ followBatch: async () => { throw new Error(code); } }), { log: (l) => lines.push(l) });
    assertEquals(calls.some((c) => c.name === "ops_github_items_apply"), false, code);
    assertEquals(out.github_follow.refused, code);
    assert(out.deferred.includes("follow"));
    assert(lines.some((l) => l.event === "follow_refused" && l.code === code), code);
  }
  // An answer with no items at all is treated the same way.
  const calls: { name: string; args?: Json }[] = [];
  const out = await runReleaseBridges(fakeAdmin(calls, [1, 2]), fakeGitHub({ followBatch: async () => [] }));
  assertEquals(calls.some((c) => c.name === "ops_github_items_apply"), false);
  assertEquals(out.github_follow.refused, "GITHUB_FOLLOW_EMPTY");
});

function fakeFetch(seen: { url: string; body: string }[], reply: { status?: number; json: unknown; headers?: Record<string, string> }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200, headers: reply.headers ?? {} });
  }) as typeof fetch;
}

Deno.test("#3980 followBatch: one read-only GraphQL query per batch, board fields only from the Avengers project", async () => {
  const seen: { url: string; body: string }[] = [];
  const client = new ProductAvengersClient("token", fakeFetch(seen, {
    json: { data: { rateLimit: { remaining: 4321 }, repository: {
      n3980: { __typename: "Issue", number: 3980, title: "Synced", url: "https://github.com/Mingla-LLC/mingla-main/issues/3980", state: "OPEN",
        repository: { nameWithOwner: "Mingla-LLC/mingla-main" }, // #3980 W2 rework 2: a node is kept only when GitHub names this repository
        updatedAt: "2026-10-20T10:00:00Z", projectItems: { nodes: [
          { project: { id: "PVT_other" }, status: { name: "Done" }, horizon: { name: "Later" } },
          { project: { id: AVENGERS_PROJECT_ID }, status: { name: "In Progress" }, horizon: { name: "Now" } }] } },
      n3991: { __typename: "PullRequest", number: 3991, title: "Ops board", url: "https://github.com/Mingla-LLC/mingla-main/pull/3991", state: "MERGED",
        repository: { nameWithOwner: "Mingla-LLC/mingla-main" }, // #3980 W2 rework 2: a node is kept only when GitHub names this repository
        merged: true, mergedAt: "2026-10-20T02:28:00Z", mergeCommit: { oid: "2f1ef910d01119ba5248901ad6dbfa3e2ba63ee1" }, updatedAt: "2026-10-20T02:28:00Z",
        closingIssuesReferences: { nodes: [{ number: 3980 }] } },
      n9999999: null } },
      errors: [{ type: "NOT_FOUND", path: ["repository", "n9999999"], message: "Could not resolve" }] },
  }));
  const items = await client.followBatch([3980, 3991, 9999999]);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, "https://api.github.com/graphql");
  const query = JSON.parse(seen[0].body).query as string;
  assert(query.startsWith("query {"));
  assertEquals(/mutation|addProjectV2|updateProjectV2|createIssue/i.test(query), false);
  assertStringIncludes(query, 'repository(owner: "Mingla-LLC", name: "mingla-main")');
  assertEquals(client.budget, 4321);
  assertEquals(items, [
    { number: 3980, found: true, kind: "issue", title: "Synced", url: "https://github.com/Mingla-LLC/mingla-main/issues/3980", state: "OPEN",
      updated_at: "2026-10-20T10:00:00Z", board_status: "In Progress", board_horizon: "Now" },
    { number: 3991, found: true, kind: "pull", title: "Ops board", url: "https://github.com/Mingla-LLC/mingla-main/pull/3991", state: "MERGED",
      merged: true, merged_at: "2026-10-20T02:28:00Z", merge_sha: "2f1ef910d01119ba5248901ad6dbfa3e2ba63ee1", closing_issues: [3980],
      updated_at: "2026-10-20T02:28:00Z" },
    { number: 9999999, found: false },
  ]);
  await assertRejects(() => client.followBatch(range(1, 51)), Error, "GITHUB_FOLLOW_TOO_MANY");
});

Deno.test("#3980 followBatch: rate limited, empty or erroring answers throw and record the budget", async () => {
  const seen: { url: string; body: string }[] = [];
  const limited = new ProductAvengersClient("token", fakeFetch(seen, { status: 403, json: { message: "API rate limit exceeded" }, headers: { "x-ratelimit-remaining": "0" } }));
  await assertRejects(() => limited.followBatch([1]), Error, "GITHUB_FOLLOW_RATE_LIMITED");
  assertEquals(limited.budget, 0);
  const typed = new ProductAvengersClient("token", fakeFetch(seen, { json: { data: null, errors: [{ type: "RATE_LIMITED", message: "slow down" }] } }));
  await assertRejects(() => typed.followBatch([1]), Error, "GITHUB_FOLLOW_RATE_LIMITED");
  const empty = new ProductAvengersClient("token", fakeFetch(seen, { json: { data: { rateLimit: { remaining: 4000 }, repository: null } } }));
  await assertRejects(() => empty.followBatch([1]), Error, "GITHUB_FOLLOW_EMPTY");
  const nothing = new ProductAvengersClient("token", fakeFetch(seen, { json: {} }));
  await assertRejects(() => nothing.followBatch([1]), Error, "GITHUB_FOLLOW_EMPTY");
  const other = new ProductAvengersClient("token", fakeFetch(seen, { json: { data: { repository: {} }, errors: [{ type: "FORBIDDEN", path: ["repository", "n1"] }] } }));
  await assertRejects(() => other.followBatch([1]), Error, "GITHUB_FOLLOW_FAILED");
});

Deno.test("#3980 parseFollowResponse: a missing alias without NOT_FOUND is left out, never marked not found", () => {
  const items = parseFollowResponse([1, 2], { data: { repository: { n1: null } } });
  assertEquals(items, []);
  assertEquals(buildFollowQuery([5, 5, 0, -1, 6]).match(/issueOrPullRequest/g)?.length, 2);
});

Deno.test("#3980 the reconcile response carries the follow result", () => {
  const source = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  assertStringIncludes(source, "github_follow: result.github_follow");
});
