// Issue #4453 Website workspace — the replay harness in CI mode: every
// scripted owner request (scripts/ari/eval/replay/websiteWorkspaceFixtures.mjs)
// through the shipped deterministic layers of a workspace turn, with a stub
// model and a stub Core, graded by the same grader the #3355 replay uses
// (scripts/ari/eval/replay/grade.mjs) plus the workspace's own facts.
//
// Per turn: the selected section is parsed and stated in the turn context;
// the draft snapshot is the loop's one required pre-read; the stub model's
// plan goes through the checks it can repair (shape, plain labels, the
// selected section's scope, ids that are on the draft) inside agent-chat's
// real loop budget; a confirmed plan runs through the real change-set
// executor (one group, steps in order, rollback, design checks) against the
// stub Core; the reply is the server's own follow-up line. No network, no
// model, no model key.
//
// MINGLA-INVARIANT: I-ARI-WORKSPACE-ONE-PLAN | issue #4453 | In the Website workspace one owner request becomes at most one change set applied as one undoable group; a failed step puts the whole plan back; a request scoped to a section changes only that section; Ari asks instead of guessing a missing fact, never publishes, and never says a change was made that was not applied. Every scripted workspace request passes the replay grader at 100.
//
// Run: deno test --no-check --allow-read --allow-env --allow-net \
//   supabase/functions/_shared/__tests__/issue_4453_website_workspace_replay.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  WEBSITE_WORKSPACE_FIXTURES,
} from "../../../../scripts/ari/eval/replay/websiteWorkspaceFixtures.mjs";
import { scoreRun } from "../../../../scripts/ari/eval/replay/grade.mjs";
import { SITE_STEP_OPS } from "../agentSiteWorkspaceTools.ts";
import { replayWorkspaceFixtures } from "./_issue4453WorkspaceGrade.ts";

Deno.test("#4453 replay: at least 24 owner requests, covering what the contract lists", () => {
  const fixtures = WEBSITE_WORKSPACE_FIXTURES;
  assert(fixtures.length >= 24, `only ${fixtures.length} fixtures`);
  assertEquals(new Set(fixtures.map((item) => item.id)).size, fixtures.length);
  const turns = fixtures.flatMap((item) => item.turns);
  const plans = turns.flatMap((turn) =>
    turn.stub.model.flatMap((step: Record<string, any>) =>
      step.call?.tool === "propose_site_change_set" ? [step.call.args] : []
    )
  );
  const ops = new Set(
    plans.flatMap((plan) =>
      plan.steps.map((step: { step: { op: string } }) => step.step.op)
    ),
  );
  // Every step type.
  assertEquals([...ops].sort(), [...SITE_STEP_OPS].sort());
  const ids = fixtures.map((item) => item.id);
  for (
    const needed of [
      "ws_scoped_this_section", // a scoped request
      "ws_missing_hours_question", // a missing-fact question
      "ws_cannot_do_team_request", // cannot do -> team request
      "ws_failing_step_full_rollback", // a failing step -> full rollback
      "ws_stale_draft_retry", // a stale-draft retry
    ]
  ) assert(ids.includes(needed), `missing fixture ${needed}`);
  // Synthetic brand only: no email, phone or real address in any fixture.
  assert(!/@|\+\d{6,}|\b0[789]\d{9}\b/.test(JSON.stringify(fixtures)));
});

Deno.test("#4453 replay: every workspace request passes the grader with a stub model and a stub Core", async () => {
  const graded = await replayWorkspaceFixtures();
  const failures = graded.flatMap((thread) =>
    thread.turns.flatMap((turn) =>
      turn.facts.filter((item) => !item.passed).map((item) =>
        `${thread.id} | ${turn.say.slice(0, 50)} | ${item.fact}: expected ${
          JSON.stringify(item.expected)
        }, got ${JSON.stringify(item.actual)}`
      )
    )
  );
  assertEquals(failures, []);
  // The gate: the workspace suite scores 100, like the #3355 replay suite.
  assertEquals(scoreRun({ replay: graded }).replay, 100);
});

Deno.test("#4453 replay: the grader fails a plan that claims success, publishes or half-applies", async () => {
  const [thread] = await replayWorkspaceFixtures((fixture) =>
    fixture.id === "ws_failing_step_full_rollback"
  );
  assert(thread.passed);
  // The same turn, as a broken executor would leave it.
  const { gradeTurn } = await import(
    "../../../../scripts/ari/eval/replay/grade.mjs"
  );
  const expect = WEBSITE_WORKSPACE_FIXTURES.find((item) =>
    item.id === "ws_failing_step_full_rollback"
  )!.turns[0].expect;
  const lied = gradeTurn(expect, {
    route: "proposal:propose_site_change_set",
    tool: "propose_site_change_set",
    args: {},
    text: "All 3 changes are on your draft, ready for you to read.",
  });
  assert(lied.some((item: { passed: boolean }) => !item.passed));
});
