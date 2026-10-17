// MINGLA-INVARIANT: I-3720-AVENGERS-SERVER-ONLY | issue #3720 | Authenticated browsers can queue bounded Product commands but cannot mutate GitHub-backed snapshots or bridge tables directly.
// MINGLA-INVARIANT: I-3720-AVENGERS-EXISTING-FIRST | issue #3720 | A new Avengers issue requires a completed candidate search, reviewed candidate decisions, and a written no-fit reason.
// MINGLA-INVARIANT: I-3720-AVENGERS-PRIVATE-EVIDENCE | issue #3720 | Only explicit public-safe review fields are eligible for GitHub writes; private Product sources and customer evidence never enter a bridge command.
// MINGLA-INVARIANT: I-3720-AVENGERS-DRAFT-ONLY | issue #3720 | Engineering movement creates customer-safe drafts only; people separately approve roadmap wording and customer communications.

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCandidateSearchQuery,
  buildIssueBody,
  ProductAvengersClient,
  type PublicProductReview,
} from "../_shared/productAvengers.ts";

const review: PublicProductReview = {
  signal_id: "37200000-0000-4000-8000-000000000401",
  public_title: "Host calendar cards need reliable publishing state",
  public_problem_statement:
    "Hosts cannot reliably tell whether a scheduled calendar card is published.",
  public_outcome:
    "Hosts can confirm the exact publishing state before sharing their calendar.",
  public_acceptance_criteria: [
    "A published card has one unambiguous state",
    "The Host can recover after a failed publish",
  ],
  board_work_type: "Bug",
  board_product: "Business",
  board_theme: "Business Tooling",
  board_priority: "P1",
  board_estimate: "3",
  board_horizon: "Now",
  board_quarter: "Q4 2026",
};

Deno.test("#3720 GitHub search and issue body contain only reviewed public-safe fields", () => {
  const query = buildCandidateSearchQuery(review);
  const body = buildIssueBody(review);
  assertStringIncludes(query, "repo:Mingla-LLC/mingla-main is:issue");
  assertStringIncludes(query, "calendar");
  assertStringIncludes(body, review.public_problem_statement);
  assertStringIncludes(
    body,
    "<!-- mingla-product-signal:37200000-0000-4000-8000-000000000401 -->",
  );
  assertNotMatch(
    `${query}\n${body}`,
    /customer@example|support_ticket|private evidence/i,
  );
});

Deno.test("#3720 create is retry-safe because it finds the durable signal marker first", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const client = new ProductAvengersClient(
    "test-token",
    async (input, init) => {
      calls.push({ url: String(input), method: String(init?.method || "GET") });
      return new Response(
        JSON.stringify([{
          number: 3720,
          title: "Existing",
          body:
            "<!-- mingla-product-signal:37200000-0000-4000-8000-000000000401 -->",
          html_url: "https://github.com/Mingla-LLC/mingla-main/issues/3720",
          state: "open",
        }]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  assertEquals(await client.createIssue(review), 3720);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "GET");
  assertStringIncludes(
    decodeURIComponent(calls[0].url),
    "/repos/Mingla-LLC/mingla-main/issues?state=all",
  );
});

Deno.test("#3720 Admin source has no browser GitHub mutation path and keeps customer work draft-only", async () => {
  const root = new URL("../../../", import.meta.url);
  const service = await Deno.readTextFile(
    new URL("mingla-admin/src/services/productAvengersService.js", root),
  );
  const panel = await Deno.readTextFile(
    new URL(
      "mingla-admin/src/components/community/ProductInboxPanel.jsx",
      root,
    ),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "supabase/migrations/20271031003720_issue_3720_product_avengers_bridge.sql",
      root,
    ),
  );
  const edge = await Deno.readTextFile(
    new URL("supabase/functions/product-avengers-sync/index.ts", root),
  );
  assertNotMatch(
    `${service}\n${panel}`,
    /api[.]github[.]com|SPRINT_ROLLOVER_TOKEN|github_token/i,
  );
  assertMatch(service, /invokeWithRefresh\("product-avengers-sync"/);
  assertMatch(panel, /Existing issue first · public-safe fields only/);
  assertMatch(panel, /it does not send anything/);
  assertMatch(migration, /candidate_search_and_no_fit_reason_required/);
  assertMatch(migration, /candidate_decisions_required/);
  assertMatch(migration, /selected_candidate_required/);
  assertMatch(migration, /product_avengers_commands_one_inflight_per_signal/);
  assertMatch(migration, /state text NOT NULL DEFAULT 'draft'/);
  assertNotMatch(migration, /FUNCTION public[.]issue_3720_[^(]*send/i);
  assertMatch(edge, /Deno[.]env[.]get\("SPRINT_ROLLOVER_TOKEN"\)/);
  assertMatch(edge, /admin_team_my_access/);
  assert(edge.includes("issue_3720_apply_product_avengers_snapshot"));
});
