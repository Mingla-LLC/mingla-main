// Issue #4270 Wave 3 — the brand plan is for people. The host card's plan
// reads and writes have a written parity reason, and no agent tool reaches a
// plan function (staff or host).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TEAM_AGENT_WORK_TOOLS, WORK_SCREEN_FUNCTION_PARITY } from "../teamAgentWorkTools.ts";

Deno.test("#4270 W3 the plan functions on the host card have their parity reasons", () => {
  assertEquals(WORK_SCREEN_FUNCTION_PARITY.ops_brand_plan, { excluded: "the plan is for people on the host card" });
  assertEquals(WORK_SCREEN_FUNCTION_PARITY.ops_brand_plan_add, { excluded: "a person adds to a brand's plan; the agent adds cards with add_work" });
  assertEquals(WORK_SCREEN_FUNCTION_PARITY.ops_brand_plan_set_link, { excluded: "a person changes a plan link" });
});

Deno.test("#4270 W3 no agent tool reaches a brand plan function", () => {
  for (const t of TEAM_AGENT_WORK_TOOLS) {
    for (const fn of t.reaches) {
      assert(!/brand_plan/.test(fn), `${t.name} reaches ${fn}`);
    }
  }
});
