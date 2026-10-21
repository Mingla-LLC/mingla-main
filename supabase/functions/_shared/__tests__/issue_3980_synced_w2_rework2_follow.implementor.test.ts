// Issue #3980 synced program, Wave 2 rework 2 — the follow bridge against
// GitHub's REAL answers (recorded 2026-10-20 with read-only `gh api graphql`
// calls; fixtures/issue_3980_follow_query/):
//   P0  the b70f9953d query selected repository directly on the
//       IssueOrPullRequest union and GitHub refused the whole request; the
//       answer now fails the batch closed, never "nothing found"
//   P0  the fixed query (repository inside "... on Issue" and
//       "... on PullRequest") is what GitHub answered with data, and that
//       real answer parses to the right items
//   P0  fail closed: a node GitHub answered without a repository is left out
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFollowQuery, followNodeInRepo, parseFollowResponse, ProductAvengersClient } from "../productAvengers.ts";

const FIX = new URL("fixtures/issue_3980_follow_query/", import.meta.url);
const answer = (name: string) => JSON.parse(Deno.readTextFileSync(new URL(name, FIX)));
const REPO = "Mingla-LLC/mingla-main";

Deno.test("#3980 W2 rework 2 follow: GitHub's real answer to the fixed query parses to the right items", () => {
  const items = parseFollowResponse([3980, 3991, 9_999_999], answer("rework2_answer.json"));
  assertEquals(items.map((i) => `${i.number}:${i.found}:${i.kind ?? "-"}`), ["3980:true:issue", "3991:true:pull", "9999999:false:-"]);
  const [issue, pull] = items;
  assertEquals([issue.board_status, issue.board_horizon, issue.state], ["In Review", "Now", "OPEN"]);
  assertEquals(issue.url, `https://github.com/${REPO}/issues/3980`);
  assertEquals([pull.merged, pull.merge_sha, pull.state], [true, "2f1ef910d01119ba5248901ad6dbfa3e2ba63ee1", "MERGED"]);
  assertEquals(pull.closing_issues, []);
});

Deno.test("#3980 W2 rework 2 follow: GitHub's real refusal of the b70f9953d query fails the batch closed", () => {
  assertThrows(() => parseFollowResponse([3980, 3991], answer("b70f_answer.json")), Error, "GITHUB_FOLLOW_FAILED");
});

Deno.test("#3980 W2 rework 2 follow: real nodes GitHub answered without a repository are all left out (fail closed)", () => {
  // The pre-rework query never asked for the repository: same issue, same pull request, no repository field.
  const bare = answer("pre_rework_answer.json");
  assertEquals(bare.data.repository.n3980.number, 3980, "GitHub did answer for the number");
  assertEquals(parseFollowResponse([3980, 3991], bare), [], "but a node that does not name this repository is never taken");
  // The tester's fragment variant: the same answer with the repository named, both kept.
  assertEquals(parseFollowResponse([3980, 3991], answer("fragment_variant_answer.json")).map((i) => i.number), [3980, 3991]);
});

Deno.test("#3980 W2 rework 2 follow: followNodeInRepo keeps only a node that names exactly this repository", () => {
  const url = `https://github.com/${REPO}/issues/7`;
  assertEquals(followNodeInRepo({ url }, 7), false, "no repository: left out even with this repository's address");
  assertEquals(followNodeInRepo({}, 7), false);
  assertEquals(followNodeInRepo({ repository: REPO, url }, 7), false, "a bare string is not GitHub's shape");
  assertEquals(followNodeInRepo({ repository: {}, url }, 7), false);
  assertEquals(followNodeInRepo({ repository: { nameWithOwner: "mingla-llc/mingla-main" }, url }, 7), false, "exact, as GitHub writes it");
  assertEquals(followNodeInRepo({ repository: { nameWithOwner: REPO } }, 7), true, "no address: the repository decides");
  assertEquals(followNodeInRepo({ repository: { nameWithOwner: REPO }, url }, 7), true);
  assertEquals(followNodeInRepo({ repository: { nameWithOwner: REPO }, url }, 8), false, "the address must still be this number");
});

Deno.test("#3980 W2 rework 2 follow: followBatch sends the fixed query and reads GitHub's real answer", async () => {
  const sent: string[] = [];
  const client = new ProductAvengersClient("token", (async (_u: string | URL | Request, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    return new Response(JSON.stringify(answer("rework2_answer.json")), { status: 200 });
  }) as typeof fetch);
  const items = await client.followBatch([3980, 3991, 9_999_999]);
  assertEquals(items.length, 3);
  assertEquals(client.budget, 4793, "the budget GitHub reported");
  const query = JSON.parse(sent[0]).query as string;
  assertEquals(query, buildFollowQuery([3980, 3991, 9_999_999]));
  assert(!/issueOrPullRequest\(number: \d+\) \{ __typename repository/.test(query), "repository is never asked directly on the union");
  // The refused query's answer makes followBatch throw, so the bridge stops and applies nothing.
  const refused = new ProductAvengersClient("token", (async () => new Response(JSON.stringify(answer("b70f_answer.json")), { status: 200 })) as typeof fetch);
  await assertRejects(() => refused.followBatch([3980, 3991]), Error, "GITHUB_FOLLOW_FAILED");
});
