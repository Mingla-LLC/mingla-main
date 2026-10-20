// Issue #3980 synced program, Wave 2 — tester adversarial suite for Bridge A
// (following linked GitHub issues and pull requests). A fake GitHub and a
// fake database only: no real GitHub call is ever made and nothing is
// written anywhere. Angles the implementor's happy path does not take:
//   - the budget boundary: exactly 500 still reads, and a run whose clock
//     is spent starts no read
//   - a rate limit on the SECOND batch: the first batch is applied, the
//     second is not, and no third batch starts
//   - the database refusing an apply stops the step before another GitHub
//     read is spent
//   - a follow list with junk rows (strings, zero, negatives, duplicates,
//     nulls) reads only real numbers, once each
//   - partial and malformed answers: a node whose number is not the one
//     asked (a redirect after a transfer), a node of another type, missing
//     board fields, junk closing issues, an alias NOT_FOUND three levels deep,
//     a repository GitHub will not show (private, other repo, lost access),
//     a body that is not JSON, a 429 and a 500
//   - numbers: 0, negatives, fractions, 8 digits and NaN are never asked;
//     duplicates count once against the 50 cap
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AVENGERS_PROJECT_ID,
  buildFollowQuery,
  followNumbers,
  parseFollowResponse,
  ProductAvengersClient,
} from "../_shared/productAvengers.ts";
import {
  type BridgeAdmin,
  type BridgeGitHub,
  runReleaseBridges,
} from "../_shared/opsBridges.ts";

type Json = Record<string, unknown>;

function fakeAdmin(
  calls: { name: string; args?: Json }[],
  follow: unknown[],
  opts: { applyError?: boolean } = {},
): BridgeAdmin {
  return {
    rpc(name: string, args?: Json) {
      calls.push({ name, args });
      if (name === "ops_github_items_apply" && opts.applyError) {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      }
      const data = name === "ops_bridge_cursor" ? "2026-10-20T00:00:00+00:00"
        : name === "ops_release_records_ingest" ? { ingested: 0, invalid: 0, completed: [] }
        : name === "ops_main_commits_ingest" ? { inserted: 0 }
        : name === "ops_release_status_due" ? []
        : name === "ops_engineering_cards_sync" ? { added: 0, closed: 0 }
        : name === "ops_github_follow_list" ? follow
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

const rows = (numbers: number[]) => numbers.map((n) => ({ number: n, kind_hint: "issue" }));
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
const found = (numbers: number[]) => numbers.map((n) => ({ number: n, found: true, kind: "issue" }));

Deno.test("#3980 tester follow: a budget of exactly 500 still reads; the floor is 'under 500'", async () => {
  const calls: { name: string; args?: Json }[] = [];
  let reads = 0;
  const out = await runReleaseBridges(fakeAdmin(calls, rows([3980])),
    fakeGitHub({ budget: 500, followBatch: async (n) => { reads += 1; return found(n); } }));
  assertEquals(reads, 1);
  assertEquals(out.deferred.includes("follow"), false);
  assertEquals(calls.filter((c) => c.name === "ops_github_items_apply").length, 1);
});

Deno.test("#3980 tester follow: a run whose 40 s are spent starts no GitHub read", async () => {
  const calls: { name: string; args?: Json }[] = [];
  let reads = 0;
  let t = 0;
  const out = await runReleaseBridges(fakeAdmin(calls, rows(range(1, 120))),
    fakeGitHub({ followBatch: async (n) => { reads += 1; t += 50_000; return found(n); } }),
    { now: () => t });
  assertEquals(reads, 1, "the first batch ran, then the clock was spent");
  assert(out.deferred.includes("follow"));
  assertEquals(calls.filter((c) => c.name === "ops_github_items_apply").length, 1);
});

Deno.test("#3980 tester follow: a rate limit on the second batch keeps the first batch, applies nothing of the second and starts no third", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const asked: number[][] = [];
  const out = await runReleaseBridges(fakeAdmin(calls, rows(range(1, 150))),
    fakeGitHub({
      followBatch: async (n) => {
        asked.push(n);
        if (asked.length === 2) throw new Error("GITHUB_FOLLOW_RATE_LIMITED");
        return found(n);
      },
    }));
  assertEquals(asked.length, 2, "no third batch after the refusal");
  const applies = calls.filter((c) => c.name === "ops_github_items_apply");
  assertEquals(applies.length, 1);
  assertEquals((applies[0].args!.p_items as Json[]).map((i) => i.number), range(1, 50));
  assertEquals(out.github_follow.applied, 50);
  assertEquals(out.github_follow.batches, 1);
  assertEquals(out.github_follow.refused, "GITHUB_FOLLOW_RATE_LIMITED");
  assert(out.deferred.includes("follow"));
});

Deno.test("#3980 tester follow: when the database refuses an apply, no further GitHub read is spent", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const lines: Json[] = [];
  let reads = 0;
  const out = await runReleaseBridges(fakeAdmin(calls, rows(range(1, 200)), { applyError: true }),
    fakeGitHub({ followBatch: async (n) => { reads += 1; return found(n); } }), { log: (l) => lines.push(l) });
  assertEquals(reads, 1);
  assertEquals(out.failed, 1);
  assert(lines.some((l) => l.event === "follow_failed" && l.code === "FOLLOW_APPLY_FAILED"));
});

Deno.test("#3980 tester follow: junk rows in the follow list are never asked, and each number is asked once", async () => {
  const calls: { name: string; args?: Json }[] = [];
  const asked: number[][] = [];
  await runReleaseBridges(fakeAdmin(calls, [
    { number: "12" }, { number: 0 }, { number: -5 }, { number: 1.5 }, null, {}, { number: 7 }, { number: 7 }, { number: 8 },
  ]), fakeGitHub({ followBatch: async (n) => { asked.push(n); return found(n); } }));
  // "12" is a numeric string from the database and is a real number; the rest are not.
  assertEquals(asked, [[12, 7, 8]]);
});

Deno.test("#3980 tester follow: a follow list that cannot be read starts no GitHub read", async () => {
  let reads = 0;
  const admin: BridgeAdmin = {
    rpc(name: string) {
      if (name === "ops_github_follow_list") return Promise.resolve({ data: null, error: { message: "down" } });
      return fakeAdmin([], []).rpc(name);
    },
  };
  const out = await runReleaseBridges(admin, fakeGitHub({ followBatch: async (n) => { reads += 1; return found(n); } }));
  assertEquals(reads, 0);
  assertEquals(out.failed, 1);
});

Deno.test("#3980 tester parse: a node that is not the number asked (a transfer redirect) or not an issue or pull request is left out", () => {
  const items = parseFollowResponse([10, 11, 12], {
    data: { repository: {
      n10: { __typename: "Issue", number: 4410, title: "Moved", url: "https://github.com/Mingla-LLC/mingla-main/issues/4410", state: "OPEN" },
      n11: { __typename: "Discussion", number: 11, title: "A discussion" },
      n12: { __typename: "Issue", number: 12, title: "Real", url: "https://github.com/Mingla-LLC/mingla-main/issues/12", state: "OPEN", projectItems: null },
    } },
  });
  assertEquals(items.map((i) => i.number), [12]);
  assertEquals(items[0].board_status, null, "no project items reads as no board column, never a crash");
  assertEquals(items[0].board_horizon, null);
});

Deno.test("#3980 tester parse: board fields come only from the Avengers item; a missing column there is null, not another project's", () => {
  const items = parseFollowResponse([5], {
    data: { repository: {
      n5: { __typename: "Issue", number: 5, title: "x", url: "u", state: "CLOSED", projectItems: { nodes: [
        { project: { id: "PVT_someone_else" }, status: { name: "Done" }, horizon: { name: "Now" } },
        { project: { id: AVENGERS_PROJECT_ID }, status: null, horizon: {} },
      ] } },
    } },
  });
  assertEquals([items[0].board_status, items[0].board_horizon], [null, null]);
});

Deno.test("#3980 tester parse: junk closing issues are dropped and at most ten are kept", () => {
  const nodes = [null, { number: "3" }, { number: -1 }, { number: 2.5 }, ...range(1, 12).map((n) => ({ number: n }))];
  const items = parseFollowResponse([77], {
    data: { repository: { n77: { __typename: "PullRequest", number: 77, title: "p", url: "u", state: "MERGED", merged: "yes",
      mergedAt: 12345, mergeCommit: null, closingIssuesReferences: { nodes } } } },
  });
  assertEquals(items[0].closing_issues, [3, ...range(1, 9)]);
  assertEquals(items[0].merged, false, "only a real true is merged");
  assertEquals(items[0].merged_at, null);
  assertEquals(items[0].merge_sha, null);
});

Deno.test("#3980 tester parse: a NOT_FOUND below an alias, or on the repository itself, fails the whole answer closed", () => {
  let err = "";
  try {
    parseFollowResponse([5], { data: { repository: { n5: null } }, errors: [{ type: "NOT_FOUND", path: ["repository", "n5", "projectItems"] }] });
  } catch (e) { err = (e as Error).message; }
  assertEquals(err, "GITHUB_FOLLOW_FAILED");
  err = "";
  try {
    // A private repository, another repository, or a token that lost access: GitHub says the repository is not found.
    parseFollowResponse([5, 6], { data: { repository: null }, errors: [{ type: "NOT_FOUND", path: ["repository"] }] });
  } catch (e) { err = (e as Error).message; }
  assertEquals(err, "GITHUB_FOLLOW_FAILED", "never 'every number is missing'");
  err = "";
  try {
    parseFollowResponse([5], { data: { repository: { n5: null } }, errors: [{ type: "NOT_FOUND", path: ["repository", "n6"] }, { type: "INSUFFICIENT_SCOPES" }] });
  } catch (e) { err = (e as Error).message; }
  assertEquals(err, "GITHUB_FOLLOW_FAILED");
});

Deno.test("#3980 tester parse: a NOT_FOUND for one alias marks only that number, and a partial answer keeps the numbers it has", () => {
  const items = parseFollowResponse([1, 2, 3], {
    data: { repository: {
      n1: null,
      n2: { __typename: "Issue", number: 2, title: "two", url: "u", state: "OPEN" },
    } },
    errors: [{ type: "NOT_FOUND", path: ["repository", "n1"] }],
  });
  assertEquals(items.map((i) => `${i.number}:${i.found}`), ["1:false", "2:true"]);
});

function fetchOnce(reply: { status: number; body: string; headers?: Record<string, string> }, seen: string[]) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(init?.body ?? ""));
    return new Response(reply.body, { status: reply.status, headers: reply.headers ?? {} });
  }) as typeof fetch;
}

Deno.test("#3980 tester followBatch: a 429, a 500 and a body that is not JSON all throw; a junk rate header leaves the budget alone", async () => {
  const seen: string[] = [];
  const c429 = new ProductAvengersClient("t", fetchOnce({ status: 429, body: "{}" }, seen));
  await assertRejects(() => c429.followBatch([1]), Error, "GITHUB_FOLLOW_RATE_LIMITED");
  const c500 = new ProductAvengersClient("t", fetchOnce({ status: 500, body: "oops" }, seen));
  await assertRejects(() => c500.followBatch([1]), Error, "GITHUB_FOLLOW_FAILED");
  const html = new ProductAvengersClient("t", fetchOnce({ status: 200, body: "<html>unicorn</html>", headers: { "x-ratelimit-remaining": "lots" } }, seen));
  const before = html.budget;
  await assertRejects(() => html.followBatch([1]), Error, "GITHUB_FOLLOW_EMPTY");
  assertEquals(html.budget, before);
});

Deno.test("#3980 tester followBatch: an empty or all-invalid list asks GitHub nothing", async () => {
  const seen: string[] = [];
  const c = new ProductAvengersClient("t", fetchOnce({ status: 200, body: "{}" }, seen));
  assertEquals(await c.followBatch([]), []);
  assertEquals(await c.followBatch([0, -1, 1.5, Number.NaN, 10_000_000]), []);
  assertEquals(seen.length, 0);
});

Deno.test("#3980 tester numbers: only whole numbers 1 to 9,999,999 are asked, duplicates count once against the 50 cap", () => {
  assertEquals(followNumbers([0, -1, 1.5, Number.NaN, 10_000_000, 9_999_999, 3, 3]), [9_999_999, 3]);
  const sixtyWithDuplicates = [...range(1, 50), ...range(1, 10)];
  assertEquals(followNumbers(sixtyWithDuplicates).length, 50);
  let err = "";
  try { followNumbers(range(1, 51)); } catch (e) { err = (e as Error).message; }
  assertEquals(err, "GITHUB_FOLLOW_TOO_MANY");
  const q = buildFollowQuery([3, 3, 9_999_999]);
  assertEquals(q.match(/issueOrPullRequest/g)?.length, 2);
  assertEquals(/\bn10000000\b/.test(buildFollowQuery([10_000_000, 1])), false);
});
