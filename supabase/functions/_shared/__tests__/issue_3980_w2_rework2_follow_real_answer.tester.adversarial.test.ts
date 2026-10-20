// Issue #3980 synced program, Wave 2 rework 2 — tester adversarial suite for
// the follow query against a SECOND real GitHub answer, recorded by the tester
// on 2026-10-20 with one read-only `gh api graphql` call at cf975fa96
// (fixtures/issue_3980_follow_query/tester_cf975_*). Angles the implementor's
// suites do not take:
//   - a wider batch: an open issue on the board, a closed issue on no board,
//     a merged pull request that closes an issue, a merged pull request that
//     closes none, and a number that does not exist
//   - the recorded query is byte-for-byte what buildFollowQuery builds for
//     those numbers, so the answer is the answer to the code's own query
//   - fail closed on GitHub's real nodes, one node at a time: another
//     repository, no repository field, repository null, a near-miss name
//     (case, trailing space, a fork), the right name with another
//     repository's address. The bad node is left out, is never reported
//     "not found", and the other nodes in the same answer are still kept
//   - end to end through runReleaseBridges with the real ProductAvengersClient:
//     the bad node never reaches ops_github_items_apply, so it is never linked
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFollowQuery, parseFollowResponse, ProductAvengersClient } from "../productAvengers.ts";
import { type BridgeAdmin, runReleaseBridges } from "../opsBridges.ts";

type Json = Record<string, unknown>;
const FIX = new URL("fixtures/issue_3980_follow_query/", import.meta.url);
const NUMBERS = [3980, 3762, 3763, 3991, 9_999_999];
const realAnswer = (): Json => JSON.parse(Deno.readTextFileSync(new URL("tester_cf975_answer.json", FIX)));
const nodes = (a: Json) => ((a.data as Json).repository as Json);

Deno.test("#3980 tester real answer: the recorded query is the one the code builds, and GitHub answered it with data", () => {
  const recorded = Deno.readTextFileSync(new URL("tester_cf975_query.graphql", FIX)).trim();
  assertEquals(recorded, buildFollowQuery(NUMBERS));
  const a = realAnswer();
  assert(nodes(a), "GitHub returned data, not a refusal");
  assertEquals((a.errors as Json[]).map((e) => `${e.type}:${(e.path as string[]).join(".")}`), ["NOT_FOUND:repository.n9999999"]);
});

Deno.test("#3980 tester real answer: every kind of node GitHub returned parses to the right item", () => {
  const items = parseFollowResponse(NUMBERS, realAnswer());
  assertEquals(items.map((i) => `${i.number}:${i.found}:${i.kind ?? "-"}`),
    ["3980:true:issue", "3762:true:issue", "3763:true:pull", "3991:true:pull", "9999999:false:-"]);
  const by = Object.fromEntries(items.map((i) => [i.number, i]));
  assertEquals([by[3980].board_status, by[3980].board_horizon], ["In Review", "Now"]);
  assertEquals([by[3762].state, by[3762].board_status, by[3762].board_horizon], ["CLOSED", null, null], "on no board: null, never invented");
  assertEquals([by[3763].merged, by[3763].merge_sha, by[3763].closing_issues], [true, "67d4dde7a3e3a6d618a78a28f52d6ff014ca81a3", [3762]]);
  assertEquals(by[3991].closing_issues, []);
});

const MUTATIONS: [string, (node: Json) => void][] = [
  ["another repository", (n) => { n.repository = { nameWithOwner: "Mingla-LLC/mingla-site-cms" }; }],
  ["no repository field", (n) => { delete n.repository; }],
  ["repository null", (n) => { n.repository = null; }],
  ["repository without nameWithOwner", (n) => { n.repository = {}; }],
  ["name in another case", (n) => { n.repository = { nameWithOwner: "mingla-llc/mingla-main" }; }],
  ["name with a trailing space", (n) => { n.repository = { nameWithOwner: "Mingla-LLC/mingla-main " }; }],
  ["a fork of the same name", (n) => { n.repository = { nameWithOwner: "someone/mingla-main" }; }],
  ["right name, another repository's address", (n) => { n.url = String(n.url).replace("Mingla-LLC/mingla-main", "Mingla-LLC/other"); }],
];

for (const [label, mutate] of MUTATIONS) {
  for (const target of [3980, 3763]) {
    Deno.test(`#3980 tester fail closed: ${label} on real node n${target} is left out, never 'not found', the rest kept`, () => {
      const a = realAnswer();
      mutate(nodes(a)[`n${target}`] as Json);
      const items = parseFollowResponse(NUMBERS, a);
      assertEquals(items.some((i) => i.number === target), false, "the node is never taken, and never marked not found");
      assertEquals(items.map((i) => i.number), NUMBERS.filter((n) => n !== target), "the other nodes in the answer are kept");
    });
  }
}

Deno.test("#3980 tester fail closed end to end: a node from another repository never reaches ops_github_items_apply", async () => {
  const a = realAnswer();
  (nodes(a).n3980 as Json).repository = { nameWithOwner: "Mingla-LLC/other" };
  delete (nodes(a).n3763 as Json).repository;
  const sent: string[] = [];
  const client = new ProductAvengersClient("token", (async (_u: string | URL | Request, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    return new Response(JSON.stringify(a), { status: 200 });
  }) as typeof fetch);
  const calls: { name: string; args?: Json }[] = [];
  const admin: BridgeAdmin = {
    rpc(name: string, args?: Json) {
      calls.push({ name, args });
      const data = name === "ops_bridge_cursor" ? "2026-10-20T00:00:00+00:00"
        : name === "ops_release_records_ingest" ? { ingested: 0, invalid: 0, completed: [] }
        : name === "ops_main_commits_ingest" ? { inserted: 0 }
        : name === "ops_release_status_due" ? []
        : name === "ops_engineering_cards_sync" ? { added: 0, closed: 0 }
        : name === "ops_github_follow_list" ? NUMBERS.map((n) => ({ number: n, kind_hint: "issue" }))
        : name === "ops_github_items_apply" ? { applied: (args?.p_items as unknown[]).length, changed: [] }
        : null;
      return Promise.resolve({ data, error: null });
    },
  };
  const github = {
    budget: 4000,
    issueCommentsSince: async () => [],
    mainCommitsSince: async () => [],
    pullsForCommit: async () => null,
    createCommitStatus: async () => {},
    followBatch: (n: number[]) => client.followBatch(n) as Promise<Json[]>,
  };
  await runReleaseBridges(admin, github as never);
  assertEquals(JSON.parse(sent[0]).query, buildFollowQuery(NUMBERS), "the code's own query was sent");
  const applies = calls.filter((c) => c.name === "ops_github_items_apply");
  assertEquals(applies.length, 1);
  const applied = applies[0].args!.p_items as Json[];
  assertEquals(applied.map((i) => i.number), [3762, 3991, 9_999_999]);
  assertEquals(applied.find((i) => i.number === 9_999_999)!.found, false, "only GitHub's own NOT_FOUND is 'not found'");
});
