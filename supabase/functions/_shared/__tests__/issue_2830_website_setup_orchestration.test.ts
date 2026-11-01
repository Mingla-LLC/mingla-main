import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { AgentLoopObservation } from "../agentLoop.ts";
import {
  buildWebsiteSetupReply,
  detectWebsiteSetupIntent,
  websiteSetupInitialCalls,
  websiteSetupWorkflowInitialCalls,
} from "../agentWebsiteSetup.ts";

const BRAND_ID = "28300000-0000-4000-8000-000000000002";

function observation(
  tool: string,
  result: unknown,
): AgentLoopObservation {
  return { tool, args: { brand_id: BRAND_ID }, result, elapsedMs: 1 };
}

const plan = {
  status: {
    done_count: 2,
    parts: [
      { key: "offer", done: true },
      { key: "brand", done: true },
      { key: "look", done: false },
      { key: "story", done: false },
      { key: "approve", done: false },
      { key: "build", done: false },
      { key: "first_offering", done: false },
      { key: "publish", done: false },
    ],
  },
  completeness: {
    fields: [
      {
        key: "design_key",
        label: "Website design",
        requirement: "required",
        state: "missing",
      },
      {
        key: "story.who",
        label: "Who comes with you",
        requirement: "recommended",
        state: "missing",
      },
      {
        key: "profile_photo",
        label: "Brand logo",
        requirement: "recommended",
        state: "missing",
        human_action_required: true,
      },
      {
        key: "theme",
        label: "Theme",
        requirement: "optional",
        state: "missing",
      },
    ],
  },
};

Deno.test("#2830 Website setup is a hard task boundary from event planning", () => {
  assertEquals(
    detectWebsiteSetupIntent(
      "Start Website setup. Read get_site_plan and summarize every gap.",
    ),
    "audit",
  );
  assertEquals(
    detectWebsiteSetupIntent(
      "Fix all Website brand-context gaps. Resume the durable job.",
    ),
    "fix_all",
  );
  assertEquals(
    detectWebsiteSetupIntent("Use November 15th at 18:00 for the event"),
    null,
  );
});

Deno.test("#2830 Website setup enforces its required tool chain before speaking", () => {
  assertEquals(websiteSetupInitialCalls("audit", BRAND_ID), [{
    name: "get_site_plan",
    args: { brand_id: BRAND_ID },
  }]);
  assertEquals(websiteSetupInitialCalls("fix_all", BRAND_ID), [{
    name: "get_site_plan",
    args: { brand_id: BRAND_ID },
  }, {
    name: "start_brand_completeness_job",
    args: { brand_id: BRAND_ID, takeover: false },
  }]);
});

Deno.test("#2830 later Website answers resume an active Fix all job before reasoning", () => {
  assertEquals(
    websiteSetupWorkflowInitialCalls({
      intent: null,
      brandId: BRAND_ID,
      activeFixAllJob: true,
    }),
    [{
      name: "get_site_plan",
      args: { brand_id: BRAND_ID },
    }, {
      name: "start_brand_completeness_job",
      args: { brand_id: BRAND_ID, takeover: false },
    }],
  );
  assertEquals(
    websiteSetupWorkflowInitialCalls({
      intent: null,
      brandId: BRAND_ID,
      activeFixAllJob: false,
    }),
    [{
      name: "get_site_plan",
      args: { brand_id: BRAND_ID },
    }],
  );
});

Deno.test("#2830 first Website response gives the live rundown and all three paths", () => {
  const reply = buildWebsiteSetupReply(
    "audit",
    [observation("get_site_plan", plan)],
    "North Star",
  );
  assertStringIncludes(reply ?? "", "2 of 8 complete");
  assertStringIncludes(reply ?? "", "Website design");
  assertStringIncludes(reply ?? "", "Who comes with you");
  assertStringIncludes(reply ?? "", "Brand logo");
  assertStringIncludes(reply ?? "", "Fix all gaps with Ari");
  assertStringIncludes(reply ?? "", "one named gap");
  assertStringIncludes(reply ?? "", "Add it myself");
  assertStringIncludes(reply ?? "", "not create a draft");
});

Deno.test("#2830 Fix all creates one durable job and asks one current-step question", () => {
  const reply = buildWebsiteSetupReply(
    "fix_all",
    [
      observation("get_site_plan", plan),
      observation("start_brand_completeness_job", {
        resumed: false,
        job: {
          id: "28300000-0000-4000-8000-000000000003",
          status: "queued",
          pending_step_keys: ["design_key", "story.who", "approved_plan"],
          completed_step_keys: ["name", "description"],
          checkpoint: { current_step: "design_key" },
        },
        completeness: plan.completeness,
      }),
    ],
    "North Star",
  );
  assertStringIncludes(reply ?? "", "started one durable Fix all job");
  assertStringIncludes(reply ?? "", "3 remain");
  assertStringIncludes(reply ?? "", "Atelier or Voyage?");
  assertEquals((reply?.match(/\?/g) ?? []).length, 1);
  assertMatch(reply ?? "", /No draft will be created first/i);
});

Deno.test("#2830 Fix all reports teammate ownership without taking over", () => {
  const reply = buildWebsiteSetupReply(
    "fix_all",
    [
      observation("get_site_plan", plan),
      observation("start_brand_completeness_job", {
        blocked_by_other_job: true,
        takeover_available: true,
      }),
    ],
    "North Star",
  );
  assertStringIncludes(reply ?? "", "Another teammate already owns");
  assertStringIncludes(reply ?? "", "explicitly take over");
  assertStringIncludes(reply ?? "", "did not start a competing chain");
});
