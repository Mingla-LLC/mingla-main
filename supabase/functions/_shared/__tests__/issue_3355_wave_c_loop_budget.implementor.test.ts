// Issue #3355 Wave C (C3) — the production loop budget.
//
// MINGLA-INVARIANT: I-ARI-PRODUCTION-LOOP-BUDGET | issue #3355 | With the local-model lane off, agent-chat runs at most 6 steps, 7 model calls and 5 model-chosen tool calls (plus the turn's required deterministic pre-reads) inside the 55 s deadline, and the deadline still stops the loop first.
//
// Before: production passed `budget: undefined` and fell through to the
// default (12 tool calls); only ARI_LOCAL_MODEL_ENABLED had an explicit budget.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_c_loop_budget.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ARI_LOCAL_LOOP_BUDGET,
  ARI_PRODUCTION_LOOP_BUDGET,
  ariChatLoopBudget,
  DEFAULT_AGENT_LOOP_BUDGET,
  runAgentLoop,
} from "../agentLoop.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

Deno.test("C3: with the local flag off agent-chat gets 6 steps / 5 tool calls / 7 model calls / 55 s", () => {
  const budget = ariChatLoopBudget({ localModelEnabled: false });
  assertEquals(budget.maxSteps, 6);
  assertEquals(budget.maxToolCalls, 5);
  assertEquals(budget.maxModelCalls, 7);
  assertEquals(budget.deadlineMs, 55_000);
  assertEquals(
    budget.maxConsecutiveErrors,
    DEFAULT_AGENT_LOOP_BUDGET.maxConsecutiveErrors,
  );
  assert(
    budget.maxToolCalls! < DEFAULT_AGENT_LOOP_BUDGET.maxToolCalls,
    "production no longer falls through to the 12-call default",
  );
  // Required pre-reads (initialCalls, expanded page reads) come on top, so a
  // four-read onboarding lane still leaves the model its 5 calls.
  assertEquals(
    ariChatLoopBudget({ localModelEnabled: false, requiredReads: 4 })
      .maxToolCalls,
    9,
  );
  assertEquals(
    ariChatLoopBudget({ localModelEnabled: false, requiredReads: -3 })
      .maxToolCalls,
    5,
  );
});

Deno.test("C3: the local lane keeps its own budget", () => {
  const budget = ariChatLoopBudget({
    localModelEnabled: true,
    requiredReads: 4,
  });
  assertEquals(budget, { ...ARI_LOCAL_LOOP_BUDGET });
  assertEquals(budget.maxSteps, 9);
  assertEquals(budget.maxModelCalls, 10);
  assertEquals(budget.maxToolCalls, 8);
  assertEquals(budget.deadlineMs, 115_000);
});

Deno.test("C3: a model that keeps reading stops after 5 tool calls in production", async () => {
  let executed = 0;
  let modelCalls = 0;
  const result = await runAgentLoop({
    budget: ariChatLoopBudget({ localModelEnabled: false }),
    callModel: () => {
      modelCalls++;
      return Promise.resolve({
        toolCalls: [{ name: "list_events", args: { n: modelCalls } }],
      });
    },
    classifyTool: () => "read",
    executeTool: () => {
      executed++;
      return Promise.resolve({ events: [] });
    },
  });
  assertEquals(result.kind, "stopped");
  if (result.kind === "stopped") assertEquals(result.reason, "budget");
  assertEquals(executed, ARI_PRODUCTION_LOOP_BUDGET.maxToolCalls);
  assert(modelCalls <= ARI_PRODUCTION_LOOP_BUDGET.maxModelCalls);
});

Deno.test("C3: the 55 s deadline still wins over the step and tool budget", async () => {
  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    let executed = 0;
    const result = await runAgentLoop({
      budget: ariChatLoopBudget({ localModelEnabled: false }),
      callModel: () => {
        // Each Flash call takes 30 s in this harness.
        clock += 30_000;
        return Promise.resolve({
          toolCalls: [{ name: "list_events", args: { at: clock } }],
        });
      },
      classifyTool: () => "read",
      executeTool: () => {
        executed++;
        return Promise.resolve({ events: [] });
      },
    });
    assertEquals(result.kind, "stopped");
    if (result.kind === "stopped") assertEquals(result.reason, "deadline");
    assertEquals(
      executed,
      2,
      "two 30 s steps pass 55 s before the 5-call budget",
    );
  } finally {
    Date.now = realNow;
  }
});

Deno.test("C3: agent-chat uses ariChatLoopBudget for the main loop, counting required pre-reads", () => {
  const source = read("supabase/functions/agent-chat/index.ts");
  assertStringIncludes(
    source,
    'budget: ariChatLoopBudget({\n          localModelEnabled: Deno.env.get("ARI_LOCAL_MODEL_ENABLED") === "true",\n          requiredReads: initialCalls.length +',
  );
  assert(
    !/budget: Deno\.env\.get\("ARI_LOCAL_MODEL_ENABLED"\) === "true"\s*\?\s*\{\s*deadlineMs: 115_000/
      .test(source),
    "the old local-only budget with an undefined production fallthrough is gone",
  );
});
