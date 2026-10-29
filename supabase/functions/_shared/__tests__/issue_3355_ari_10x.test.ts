import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runAgentLoop } from "../agentLoop.ts";
import { lintAriCopy } from "../agentCopyLint.ts";
import {
  sanitizeAriPublicText,
  sanitizeAriText,
  sanitizeAriUserFacingDiagnostics,
  sanitizeAriValue,
} from "../agentSanitization.ts";
import {
  ariDeterministicReadPlan,
  ariDeterministicSafetyReply,
  buildAriCapabilityPlan,
  buildAriDeterministicReadReply,
  buildAriOnboardingResumeReply,
  inferAriToolsets,
  needsAriCapabilityDiscovery,
  needsAriOnboardingResumeRead,
  selectAriTools,
} from "../agentToolsets.ts";
import type { AgentTool } from "../agentToolHelpers.ts";
import {
  compareListingCandidateSources,
  extractCandidates,
} from "../agentAri10xTools.ts";
import {
  assertSafePublicUrl,
  canCompleteResearchFromSearchIndex,
  canonicalizePublicResearchUrl,
  curatePublicResearchSources,
  isPrivateIpAddress,
  isStandalonePublicResearchRequest,
  parseBingPublicSearchResults,
  parseLocalPublicSearchResults,
} from "../agentWebResearch.ts";
import {
  ariUserFacingToolError,
  buildAgentRunRendition,
} from "../agentRenditions.ts";
import {
  buildBrandLaunchPlan,
  isBrandLaunchPlanRequest,
  launchPlanInitialCalls,
  launchPlanNeedsPublicResearch,
} from "../agentLaunchPlan.ts";
import { AGENT_TOOLS, findTool } from "../agentTools.ts";
import {
  isCreateEventPlanningRequest,
  planEventTurn,
} from "../agentConversationPlanner.ts";
import { callGemini } from "../agentGemini.ts";
import {
  detectAriQualitySignals,
  inferAriCapabilityGap,
} from "../agentQuality.ts";
import {
  detectAriMediaMime,
  verifyAriAttachment,
} from "../agentAttachments.ts";
// The executable catalogue is shared with the Node evaluation runner.
// @ts-ignore Deno can execute the local ESM catalogue without a declaration file.
import { ARI_EVAL_SCENARIOS } from "../../../../scripts/ari/eval/scenarios.mjs";

Deno.test("#3355 event proposals preserve an explicit guest limit", () => {
  const createEvent = findTool("create_event");
  assert(createEvent);
  const schema = createEvent.parameters as {
    properties?: Record<string, {
      description?: string;
      items?: { required?: string[]; properties?: Record<string, unknown> };
    }>;
  };
  const tickets = schema.properties?.tickets;
  assert(tickets);
  assertMatch(tickets.description ?? "", /20 guests.*capacity 20/i);
  assert(tickets.items?.required?.includes("capacity"));
  assert(tickets.items?.properties?.capacity);
});

Deno.test("#3355 deterministic event planning carries capacity into the confirmed draft", () => {
  const planned = planEventTurn(
    {
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    },
    "Create a private dinner event called Capacity Proof on January 17, 2027 at 7 PM for exactly 20 guests",
    {
      now: new Date("2026-10-29T18:00:00-04:00"),
      timezone: "America/New_York",
      activeBrand: {
        id: "33550000-0000-4000-a000-000000000002",
        name: "Lantern Room",
      },
      originMessageId: "message-capacity",
      taskId: "task-capacity",
      questionId: "question-capacity",
    },
  );
  assertEquals(planned.state.status, "ready_to_propose");
  assertEquals(planned.proposal?.tool_name, "create_event");
  const tickets = planned.proposal?.tool_args.tickets as Array<
    Record<string, unknown>
  >;
  assertEquals(tickets[0].capacity, 20);
  assertEquals(tickets[0].isFree, true);
  assertMatch(planned.text, /limited to 20 guests/i);
});

Deno.test("#3355 general planning language does not become an event workflow", () => {
  assertEquals(
    isCreateEventPlanningRequest(
      "Show me a plan for improving Harmattan Club this week.",
    ),
    false,
  );
  assertEquals(
    isCreateEventPlanningRequest("Plan a live show for Friday."),
    true,
  );
  assertEquals(
    isCreateEventPlanningRequest("Create an event for Friday."),
    true,
  );
  assertEquals(
    isCreateEventPlanningRequest(
      "For Harmattan Club, build a complete launch plan. First show me the steps and identify what is missing.",
    ),
    false,
  );
});

Deno.test("#3355 narrow product questions use canonical reads instead of model guesses", () => {
  const brandId = "33550000-0000-4000-a000-000000000001";
  assertEquals(
    ariDeterministicReadPlan("Existing brand with admin invite", brandId),
    {
      intent: "existing_brands",
      calls: [{ name: "list_brands", args: { limit: 20 } }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan("Owner invitation not found", brandId),
    {
      intent: "brand_team",
      calls: [{ name: "list_brand_team", args: { brand_id: brandId } }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan("Naira bookable class", brandId),
    {
      intent: "listing_capabilities",
      calls: [{
        name: "get_listing_type_capabilities",
        args: { listing_type: "experience" },
      }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan("Lagos event from New York device", brandId),
    {
      intent: "market_rules",
      calls: [{ name: "get_market_rules", args: { country_code: "NG" } }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan("Flyer 1 PM vs text 2–10 PM", brandId),
    {
      intent: "listing_candidates",
      calls: [{
        name: "extract_listing_candidates",
        args: {
          text: "Flyer 1 PM",
          source_label: "supplied material",
          comparison_text: "text 2–10 PM",
          comparison_label: "message text",
        },
      }],
    },
  );
});

Deno.test("#3355 canonical product reads become concise public replies without model calls", () => {
  const plan = ariDeterministicReadPlan(
    "Per-hour charter rate card",
    "33550000-0000-4000-a000-000000000001",
  );
  assert(plan !== null);
  const reply = buildAriDeterministicReadReply(
    plan,
    [{
      tool: "get_listing_type_capabilities",
      args: { listing_type: "experience" },
      result: {
        listing_type: "experience",
        schedule: ["single", "open_hours"],
        commerce: ["person", "time_block"],
        location: ["single", "per_stop"],
      },
      elapsedMs: 2,
    }],
    "Harmattan Club",
  );
  assertMatch(reply ?? "", /experience capabilities/i);
  assertMatch(reply ?? "", /time block/i);
  assertMatch(reply ?? "", /Nothing was created or changed/);
});

Deno.test("#3355 sensitive and invalid media inputs use deterministic safe copy", () => {
  const bank = ariDeterministicSafetyReply("Bank number typed in chat") ?? "";
  assertMatch(bank, /protected payout setup/i);
  assert(!/\d{6,}/.test(bank));
  const ambiguous = ariDeterministicSafetyReply(
    "Bank-like number offered as phone",
  ) ?? "";
  assertMatch(ambiguous, /won’t save or repeat/i);
  const video = ariDeterministicSafetyReply("Eighty-two second host video") ??
    "";
  assertMatch(video, /15-second limit/i);
  assertMatch(video, /did not upload or change/i);
});

Deno.test("#3355 local model lane is explicit and loopback-only", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  const originalBase = Deno.env.get("ARI_LOCAL_MODEL_BASE_URL");
  const originalModel = Deno.env.get("ARI_LOCAL_MODEL_ID");
  let wireModel = "";
  try {
    Deno.env.set("ARI_LOCAL_MODEL_ENABLED", "true");
    Deno.env.set(
      "ARI_LOCAL_MODEL_BASE_URL",
      "http://host.docker.internal:11434",
    );
    Deno.env.set("ARI_LOCAL_MODEL_ID", "qwen3:4b-instruct");
    globalThis.fetch = async (input, init) => {
      assertEquals(String(input), "http://host.docker.internal:11434/api/chat");
      wireModel = String(
        (JSON.parse(String(init?.body)) as Record<string, unknown>).model ?? "",
      );
      return new Response(
        JSON.stringify({
          message: { content: "I will show the plan before any changes." },
          done_reason: "stop",
          prompt_eval_count: 15,
          eval_count: 8,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await callGemini({
      systemPrompt: "Act safely.",
      contents: [{ role: "user", parts: [{ text: "Plan the launch." }] }],
      tools: [],
    });
    assertEquals(
      result.textResponse,
      "I will show the plan before any changes.",
    );
    assertEquals(result.usage.total_tokens, 23);
    assertEquals(wireModel, "qwen3:4b-instruct");

    Deno.env.set("ARI_LOCAL_MODEL_BASE_URL", "https://example.com");
    let refused = false;
    try {
      await callGemini({
        systemPrompt: "Act safely.",
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        tools: [],
      });
    } catch (error) {
      refused = error instanceof Error && error.message.includes("loopback");
    }
    assert(refused, "external local-model endpoints must be refused");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnabled === undefined) {
      Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    } else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", originalEnabled);
    if (originalBase === undefined) Deno.env.delete("ARI_LOCAL_MODEL_BASE_URL");
    else Deno.env.set("ARI_LOCAL_MODEL_BASE_URL", originalBase);
    if (originalModel === undefined) Deno.env.delete("ARI_LOCAL_MODEL_ID");
    else Deno.env.set("ARI_LOCAL_MODEL_ID", originalModel);
  }
});

Deno.test("#3355 local model refuses unsupported media instead of silently dropping it", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  const originalBase = Deno.env.get("ARI_LOCAL_MODEL_BASE_URL");
  let fetchCalled = false;
  try {
    Deno.env.set("ARI_LOCAL_MODEL_ENABLED", "true");
    Deno.env.set(
      "ARI_LOCAL_MODEL_BASE_URL",
      "http://host.docker.internal:11434",
    );
    globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    };

    let rejected: unknown;
    try {
      await callGemini({
        systemPrompt: "Inspect only evidence you received.",
        contents: [{
          role: "user",
          parts: [
            { text: "Summarize this voice note." },
            {
              inlineData: {
                mimeType: "audio/mp4",
                data: "c3ludGhldGljLWF1ZGlv",
              },
            },
          ],
        }],
        tools: [],
      });
    } catch (error) {
      rejected = error;
    }

    assertEquals(fetchCalled, false);
    assertEquals((rejected as { kind?: string })?.kind, "unsupported_input");
    assertMatch(
      (rejected as Error)?.message ?? "",
      /can’t read this attachment type/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnabled === undefined) {
      Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    } else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", originalEnabled);
    if (originalBase === undefined) Deno.env.delete("ARI_LOCAL_MODEL_BASE_URL");
    else Deno.env.set("ARI_LOCAL_MODEL_BASE_URL", originalBase);
  }
});

Deno.test("#3355 quality detector opens a case when Ari pursues the wrong goal", () => {
  const signals = detectAriQualitySignals({
    userId: "user-a",
    conversationId: "conversation-a",
    userText: "Show me a plan for improving Harmattan Club this week.",
    assistantText:
      "For Harmattan Club, I’ve kept the event direction you shared. What future date and time should I use?",
  });
  assert(signals.includes("intent_mismatch"));

  const realEvent = detectAriQualitySignals({
    userId: "user-a",
    conversationId: "conversation-b",
    userText: "Plan a dinner event and ask me for the date and time.",
    assistantText: "What future date and time should I use?",
  });
  assert(!realEvent.includes("intent_mismatch"));
});

Deno.test("#3355 unsupported requests aggregate into privacy-safe capability gaps", () => {
  const social = inferAriCapabilityGap(
    "Can you inspect https://instagram.com/example and compare it with our page?",
  );
  assertEquals(social.capabilityKey, "research.public_social");
  const unknown = inferAriCapabilityGap(
    "Email me at host@example.com and invent a capability we have never seen.",
  );
  assertMatch(unknown.capabilityKey, /^request\.[0-9a-f]{8}$/);
  assert(!unknown.exampleRequest.includes("host@example.com"));
});

Deno.test("#3355 loop executes bounded reads then stops at the first write", async () => {
  let modelCalls = 0;
  const executed: string[] = [];
  const result = await runAgentLoop({
    callModel: async (observations) => {
      modelCalls += 1;
      return observations.length === 0
        ? {
          toolCalls: [{ name: "inspect", args: { id: "one" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }
        : {
          toolCalls: [{ name: "publish", args: { id: "one" } }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        };
    },
    classifyTool: (call) => call.name === "inspect" ? "read" : "write",
    executeTool: async (call) => {
      executed.push(call.name);
      return { canonical: true };
    },
  });
  assertEquals(result.kind, "proposal");
  if (result.kind !== "proposal") return;
  assertEquals(result.toolCall.name, "publish");
  assertEquals(executed, ["inspect"]);
  assertEquals(modelCalls, 2);
  assertEquals(result.observations[0].result, { canonical: true });
});

Deno.test("#3355 required launch reads run before the model's first turn", async () => {
  const executed: string[] = [];
  const result = await runAgentLoop({
    initialCalls: [
      { name: "get_operator_snapshot", args: { brand_id: "brand-a" } },
      { name: "get_brand_site", args: { brand_id: "brand-a" } },
    ],
    callModel: async (observations) => {
      assertEquals(observations.map((item) => item.tool), [
        "get_operator_snapshot",
        "get_brand_site",
      ]);
      return { toolCalls: [], textResponse: "The plan is ready." };
    },
    classifyTool: () => "read",
    executeTool: async (call) => {
      executed.push(call.name);
      return { canonical: true };
    },
  });
  assertEquals(result.kind, "text");
  assertEquals(executed, ["get_operator_snapshot", "get_brand_site"]);
});

Deno.test("#3355 standalone cited research completes without a redundant model pass", async () => {
  let modelCalls = 0;
  const result = await runAgentLoop({
    initialCalls: [
      {
        name: "search_public_web",
        args: { query: "Lantern Room latest events" },
      },
    ],
    completeAfterInitialReads: (observations) => {
      const result = observations[0]?.result as { answer?: string } | undefined;
      return result?.answer ?? null;
    },
    callModel: async () => {
      modelCalls += 1;
      return { toolCalls: [], textResponse: "This should not run." };
    },
    classifyTool: () => "read",
    executeTool: async () => ({
      answer: "I found two cited public pages.",
      sources: [{ url: "https://example.com" }],
    }),
  });
  assertEquals(result.kind, "text");
  if (result.kind !== "text") return;
  assertEquals(result.text, "I found two cited public pages.");
  assertEquals(result.usage.calls, 0);
  assertEquals(modelCalls, 0);
});

Deno.test("#3355 search-index shortcut never pretends it read or compared pages", () => {
  assert(
    isStandalonePublicResearchRequest(
      "Compare public sources for Lantern Room events.",
    ),
  );
  assert(
    canCompleteResearchFromSearchIndex(
      "Find public sources for Lantern Room and show citations with checked dates.",
    ),
  );
  assertEquals(
    canCompleteResearchFromSearchIndex(
      "Compare public sources for Lantern Room events and summarize the latest details.",
    ),
    false,
  );
  assertEquals(
    canCompleteResearchFromSearchIndex(
      "Search public sources for the latest Lantern Room events.",
    ),
    false,
  );
  assertEquals(
    isStandalonePublicResearchRequest(
      "Research Lantern Room and publish a new event.",
    ),
    false,
  );
});

Deno.test("#3355 premature research prose is replaced by required page reads", async () => {
  let modelCalls = 0;
  const executed: string[] = [];
  const result = await runAgentLoop({
    initialCalls: [{ name: "search_public_web", args: { query: "Lantern" } }],
    callModel: async () => {
      modelCalls += 1;
      return modelCalls === 1
        ? { textResponse: "The search results are enough.", toolCalls: [] }
        : {
          textResponse: "I read the official page and found no named event.",
          toolCalls: [],
        };
    },
    recoverReadsFromPrematureText: (_text, observations) =>
      observations.some((item) => item.tool === "read_public_url") ? [] : [{
        name: "read_public_url",
        args: { url: "https://example.com/events" },
      }],
    classifyTool: () => "read",
    executeTool: async (call) => {
      executed.push(call.name);
      return call.name === "search_public_web"
        ? { sources: [{ url: "https://example.com/events" }] }
        : { content: "No upcoming event is named." };
    },
  });
  assertEquals(result.kind, "text");
  if (result.kind === "text") {
    assertEquals(
      result.text,
      "I read the official page and found no named event.",
    );
  }
  assertEquals(modelCalls, 2);
  assertEquals(executed, ["search_public_web", "read_public_url"]);
});

Deno.test("#3355 search discovery expands into page reads before reasoning", async () => {
  let modelCalls = 0;
  const executed: string[] = [];
  const result = await runAgentLoop({
    initialCalls: [{ name: "search_public_web", args: { query: "Lantern" } }],
    expandInitialReads: (observations) => {
      assertEquals(observations[0]?.tool, "search_public_web");
      return [{
        name: "read_public_url",
        args: { url: "https://example.com/events" },
      }];
    },
    callModel: async (observations) => {
      modelCalls += 1;
      assertEquals(
        observations.map((item) => item.tool),
        ["search_public_web", "read_public_url"],
      );
      return {
        textResponse: "The official page names one upcoming event.",
        toolCalls: [],
      };
    },
    classifyTool: () => "read",
    executeTool: async (call) => {
      executed.push(call.name);
      return call.name === "search_public_web"
        ? { sources: [{ url: "https://example.com/events" }] }
        : { content: "The Maker's Table — June 17, 2026." };
    },
  });
  assertEquals(result.kind, "text");
  assertEquals(modelCalls, 1);
  assertEquals(executed, ["search_public_web", "read_public_url"]);
});

Deno.test("#3355 completed readbacks survive an unavailable reasoning model", async () => {
  const result = await runAgentLoop({
    initialCalls: [
      { name: "get_operator_snapshot", args: { brand_id: "brand-a" } },
    ],
    callModel: () => {
      throw new Error("The local Ari model returned no usable content.");
    },
    classifyTool: () => "read",
    executeTool: async () => ({ selected_brand: { name: "Harmattan Club" } }),
  });
  assertEquals(result.kind, "stopped");
  if (result.kind !== "stopped") return;
  assertEquals(result.reason, "errors");
  assertEquals(result.observations[0].tool, "get_operator_snapshot");
  assertEquals(result.observations[1].error?.code, "MODEL_UNAVAILABLE");
});

Deno.test("#3355 loop treats a recoverable tool failure as an observation", async () => {
  const result = await runAgentLoop({
    callModel: async (observations) =>
      observations.length === 0
        ? { toolCalls: [{ name: "primary", args: {} }] }
        : {
          toolCalls: [],
          textResponse: "The primary source failed, so I stopped.",
        },
    classifyTool: () => "read",
    executeTool: () => {
      throw new Error("upstream unavailable");
    },
    normalizeError: () => ({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Public source unavailable.",
      recoverable: true,
    }),
  });
  assertEquals(result.kind, "text");
  assertEquals(result.observations[0].error?.code, "UPSTREAM_UNAVAILABLE");
});

Deno.test("#3355 loop preserves the useful plan after two independent read failures", async () => {
  const result = await runAgentLoop({
    callModel: async (observations) =>
      observations.length === 0
        ? {
          toolCalls: [
            { name: "search_public_web", args: { query: "Harmattan Club" } },
            { name: "read_public_url", args: { url: "https://example.com" } },
          ],
        }
        : {
          toolCalls: [],
          textResponse:
            "Here is the launch plan from Mingla. I could not verify public sources, so public presence remains an evidence gap.",
        },
    classifyTool: () => "read",
    executeTool: () => {
      throw new Error("upstream unavailable");
    },
    normalizeError: () => ({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Public source unavailable.",
      recoverable: true,
    }),
  });
  assertEquals(result.kind, "text");
  assertEquals(result.observations.length, 2);
});

Deno.test("#3355 loop enforces the safe tool budget", async () => {
  const result = await runAgentLoop({
    budget: { maxSteps: 5, maxModelCalls: 5, maxToolCalls: 1 },
    callModel: async () => ({
      toolCalls: [
        { name: "read_one", args: {} },
        { name: "read_two", args: {} },
      ],
    }),
    classifyTool: () => "read",
    executeTool: async () => ({ ok: true }),
  });
  assertEquals(result.kind, "stopped");
  if (result.kind === "stopped") assertEquals(result.reason, "budget");
  assertEquals(result.observations.length, 1);
});

Deno.test("#3355 strict archive sanitization removes identity and credentials", () => {
  const value = sanitizeAriText(
    "Email seth@example.com phone +1 (212) 555-0100 token=secret123 https://x.test/?signature=abc",
  );
  assertMatch(value.text, /\[email removed\]/);
  assertMatch(value.text, /\[phone removed\]/);
  assertMatch(value.text, /token=\[removed\]/);
  assertMatch(value.text, /signature=\[removed\]/);
  assert(!value.text.includes("seth@example.com"));
});

Deno.test("#3355 strict archive sanitization preserves freshness dates", () => {
  const value = sanitizeAriText(
    "The Lantern Room, Monterey, CA (2026) (2026-10-29); fetched 2026-10-30T14:05:00Z; call +1 (212) 555-0100.",
  );
  assert(value.text.includes("(2026) (2026-10-29)"));
  assert(value.text.includes("2026-10-29"));
  assert(value.text.includes("2026-10-30T14:05:00Z"));
  assert(value.text.includes("[phone removed]"));
  assertEquals(
    value.findings.filter((finding) => finding === "phone").length,
    1,
  );
});

Deno.test("#3355 public research preserves public facts but removes secrets", () => {
  const value = sanitizeAriPublicText(
    "Contact tickets@example.com at +44 20 7946 0958; api_key=private; https://x.test/?token=abc",
  );
  assert(value.text.includes("tickets@example.com"));
  assert(value.text.includes("+44 20 7946 0958"));
  assertMatch(value.text, /api_key=\[removed\]/);
  assertMatch(value.text, /token=\[removed\]/);
});

Deno.test("#3355 structured sanitization drops bank and auth fields", () => {
  assertEquals(
    sanitizeAriValue({
      bank: "123456789",
      Authorization: "Bearer private",
      nested: { email: "host@example.com" },
    }),
    {
      bank: "[removed]",
      Authorization: "[removed]",
      nested: { email: "[email removed]" },
    },
  );
});

Deno.test("#3355 copy lint refuses unsourced research and sensitive success copy", () => {
  const research = lintAriCopy("I compared the profiles.", {
    researchExpected: true,
    hasSources: false,
  });
  assert(research.violations.includes("UNSOURCED_RESEARCH"));
  const secret = lintAriCopy(
    "Bank account 123456789 was successfully created for you.",
  );
  assert(secret.violations.includes("BANK_DIGITS"));
  assert(secret.violations.includes("UNVERIFIED_SUCCESS"));

  const honestGap = lintAriCopy(
    "Here is the plan from Mingla. I could not verify any usable public sources, so public presence remains unverified.",
    { researchExpected: true, hasSources: false },
  );
  assert(!honestGap.violations.includes("UNSOURCED_RESEARCH"));
});

Deno.test("#3355 toolsets are inferred and capped without losing core tools", () => {
  const keys = inferAriToolsets(
    "Research Instagram, import my people CSV and launch our event website",
  );
  assert(keys.includes("research"));
  assert(keys.includes("people"));
  assert(keys.includes("sites"));
  assert(keys.includes("listings"));
  const tools = [
    "list_brands",
    "request_tools",
    "search_public_web",
    "manage_brand_people",
    "get_brand_site",
  ].map((name) => ({
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    requiredRole: "self",
    resource: "none",
    executor: async () => null,
  })) satisfies AgentTool[];
  const selected = selectAriTools(tools, keys, 8).map((tool) => tool.name);
  assert(selected.includes("request_tools"));
  assert(selected.includes("search_public_web"));
  assert(selected.includes("manage_brand_people"));
  assert(selected.includes("get_brand_site"));

  const launchGoal =
    "For Harmattan Club, build a complete launch plan from the business information already in Mingla, research our public presence, and do not change anything.";
  const launchTools = selectAriTools(
    AGENT_TOOLS,
    inferAriToolsets(launchGoal),
    8,
    launchGoal,
  ).map((tool) => tool.name);
  assertEquals(launchTools.length, 8);
  for (
    const required of [
      "get_operator_snapshot",
      "get_brand_site",
      "search_public_web",
      "read_public_url",
    ]
  ) {
    assert(
      launchTools.includes(required),
      `${required} should stay discoverable`,
    );
  }
});

Deno.test("#3355 broad host promotion goals discover capabilities before reasoning", () => {
  assert(needsAriCapabilityDiscovery("Host promotion plan"));
  assert(needsAriCapabilityDiscovery("Build a marketing plan for this brand"));
  assert(!needsAriCapabilityDiscovery("Create an event called Autumn Table"));
  const selected = selectAriTools(AGENT_TOOLS, ["core", "marketing"], 8);
  assert(selected.some((tool) => tool.name === "search_capabilities"));
  const plan = buildAriCapabilityPlan(
    "Host promotion plan",
    "Harmattan Club",
    ["propose_ad_plan", "get_ad_campaign_report", "create_discount"],
  );
  assert(plan?.includes("practical promotion plan for Harmattan Club"));
  assert(plan?.includes("Nothing has been created, published or charged"));
  assert(!plan?.includes("propose_ad_plan"));
});

Deno.test("#3355 terse continuation requests read the durable onboarding plan", () => {
  assert(needsAriOnboardingResumeRead("Next steps after accepting"));
  assert(needsAriOnboardingResumeRead("Greeting after silence resumes plan"));
  assert(!needsAriOnboardingResumeRead("Create an event called Autumn Table"));
  const noPlan = buildAriOnboardingResumeReply(null, "Harmattan Club");
  assert(noPlan.includes("no active plan to resume"));
  const resumed = buildAriOnboardingResumeReply({
    state: {
      steps: [
        { id: "brand_profile", status: "completed" },
        { id: "first_offering", status: "pending" },
      ],
    },
  }, "Harmattan Club");
  assert(resumed.includes("first offering"));
  assert(resumed.includes("will not repeat completed work"));
});

Deno.test("#3355 every active scenario's required capability exists in the real registry", () => {
  const registered = new Set(AGENT_TOOLS.map((tool) => tool.name));
  const scenarios = ARI_EVAL_SCENARIOS as unknown as Array<{
    id: string;
    status: string;
    expected: { required_tools?: string[] };
  }>;
  const missing = scenarios.flatMap(
    (scenario) =>
      scenario.status === "active"
        ? (scenario.expected.required_tools ?? [])
          .filter((name) => !registered.has(name))
          .map((name) => `${scenario.id}:${name}`)
        : [],
  );
  assertEquals(missing, []);
});

Deno.test("#3355 onboarding blueprint covers launch, verification and handover", async () => {
  const tool = findTool("build_host_onboarding_blueprint");
  assert(tool);
  const result = await tool.executor(
    {
      goal: "Set up Lantern Room from its flyer and voice note",
      mode: "self_serve",
      materials: ["flyer", "voice_note"],
    },
    {} as never,
    "11111111-1111-4111-8111-111111111111",
  ) as {
    steps: Array<Record<string, unknown>>;
    completion_contract: Record<string, unknown>;
  };
  const keys = result.steps.map((step) => step.key);
  for (
    const key of [
      "brand",
      "market",
      "listing",
      "tickets",
      "payouts",
      "terms",
      "preview",
      "publish",
      "verify",
      "handover",
    ]
  ) {
    assert(keys.includes(key), `missing onboarding step ${key}`);
  }
  assertEquals(result.completion_contract.verify_public_result, true);
  assertEquals(
    result.completion_contract.resume_without_repeating_completed_writes,
    true,
  );
  assert(result.steps.some((step) => step.human_owned === true));
});

Deno.test("#3355 multimodal candidates make cross-source conflicts blocking", () => {
  const flyer = extractCandidates(
    "October 30, 2026 at 1 PM. Tickets $40",
    null,
  );
  const message = extractCandidates(
    "October 30, 2026 at 2 PM. Tickets $50",
    null,
  );
  const conflicts = compareListingCandidateSources(
    flyer,
    message,
    ["flyer", "message"],
  );
  assert(conflicts.some((conflict) => conflict.field === "times"));
  assert(conflicts.some((conflict) => conflict.field === "prices"));
  assert(conflicts.every((conflict) => conflict.blocking === true));
});

Deno.test("#3355 voice notes and video require a matching verified container", async () => {
  const wav = new Uint8Array(44);
  wav.set(new TextEncoder().encode("RIFF"), 0);
  wav.set(new TextEncoder().encode("WAVE"), 8);
  assertEquals(detectAriMediaMime(wav, "audio/wav"), {
    mime: "audio/wav",
    fileType: "audio",
    container: "wave",
  });
  assertEquals(detectAriMediaMime(wav, "video/mp4"), null);
  assertEquals(
    (await verifyAriAttachment(wav, "audio/x-wav", wav.length)).fileType,
    "audio",
  );

  const mp4 = new Uint8Array(32);
  mp4.set([0, 0, 0, 32], 0);
  mp4.set(new TextEncoder().encode("ftyp"), 4);
  mp4.set(new TextEncoder().encode("mp42"), 8);
  assertEquals(
    (await verifyAriAttachment(mp4, "video/mp4", mp4.length)).fileType,
    "video",
  );

  let mismatch = false;
  try {
    await verifyAriAttachment(mp4, "audio/mpeg", mp4.length);
  } catch (error) {
    mismatch = error instanceof Error &&
      ["CORRUPT_FILE", "MIME_MISMATCH"].includes(error.message);
  }
  assert(mismatch, "renamed media must be refused");
});

Deno.test("#3355 browser URL guard blocks private IPv4 and IPv6 forms", () => {
  for (
    const host of [
      "127.0.0.1",
      "10.0.0.4",
      "169.254.169.254",
      "172.16.4.2",
      "192.168.1.8",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]
  ) assert(isPrivateIpAddress(host), `${host} should be private`);
  for (
    const url of [
      "http://localhost/private",
      "http://127.0.0.1/private",
      "http://[::1]/private",
      "http://169.254.169.254/latest/meta-data",
    ]
  ) {
    let blocked = false;
    try {
      assertSafePublicUrl(url);
    } catch (error) {
      blocked = error instanceof Error &&
        error.message === "PUBLIC_URL_PRIVATE_NETWORK";
    }
    assert(blocked, `${url} should be blocked`);
  }
  assertEquals(
    assertSafePublicUrl("https://example.com/path").hostname,
    "example.com",
  );
});

Deno.test("#3355 local research parses cited public destinations without promoting private links", () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fharmattan&amp;rut=x">Harmattan &amp; Co</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=http%3A%2F%2F127.0.0.1%2Fsecret&amp;rut=x">Private</a>
    <a class="result__a" href="https://events.example.org/lantern">Lantern Room events</a>`;
  const sources = parseLocalPublicSearchResults(
    html,
    "2026-10-29T17:00:00.000Z",
  );
  assertEquals(sources.map((source) => source.url), [
    "https://example.com/harmattan",
    "https://events.example.org/lantern",
  ]);
  assertEquals(sources[0].title, "Harmattan & Co");
  assertEquals(sources[0].source_type, "search");
});

Deno.test("#3355 local research decodes Bing citations through the public URL guard", () => {
  const publicTarget = btoa("https://events.example.org/harmattan").replaceAll(
    "+",
    "-",
  ).replaceAll("/", "_").replace(/=+$/g, "");
  const privateTarget = btoa("http://127.0.0.1/secret").replaceAll("+", "-")
    .replaceAll("/", "_").replace(/=+$/g, "");
  const html = `
    <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${publicTarget}">Harmattan Club events</a></h2></li>
    <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${privateTarget}">Private</a></h2></li>`;
  const sources = parseBingPublicSearchResults(
    html,
    "2026-10-29T18:00:00.000Z",
  );
  assertEquals(sources.map((source) => source.url), [
    "https://events.example.org/harmattan",
  ]);
  assertEquals(sources[0].title, "Harmattan Club events");
});

Deno.test("#3355 research citations reject provider tracking and irrelevant same-name noise", () => {
  assertEquals(
    canonicalizePublicResearchUrl(
      "https://events.example.org/lantern?utm_source=bing&gclid=secret#results",
    ),
    "https://events.example.org/lantern",
  );
  let providerBlocked = false;
  try {
    canonicalizePublicResearchUrl(
      "https://www.bing.com/rebates/welcome?url=https%3A%2F%2Fevents.example.org",
    );
  } catch (error) {
    providerBlocked = error instanceof Error &&
      error.message === "RESEARCH_SOURCE_LOW_SIGNAL";
  }
  assert(providerBlocked, "Bing affiliate links must not become citations");

  const curated = curatePublicResearchSources([
    {
      url: "https://lanternroom.com/",
      title: "The Lantern Room | Official Site",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
    {
      url: "https://lanternroom.com/events?utm_campaign=test",
      title: "Lantern Room events",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
    {
      url: "https://lanternroom.com/about",
      title: "About the Lantern Room",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
    {
      url: "https://calendar.google.com/",
      title: "Google Calendar - Appointments",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
    {
      url: "https://example.org/generic-agenda.pdf",
      title: "Meeting agenda",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
  ], "Compare the official Lantern Room homepage and events calendar");
  assertEquals(curated.map((source) => source.url), [
    "https://lanternroom.com/events",
    "https://lanternroom.com/",
  ]);
});

Deno.test("#3355 server emits a visible plan with verified research sources", () => {
  const rendition = buildAgentRunRendition({
    renditionId: "run:11111111-1111-4111-8111-111111111111",
    goal: "Compare the public event page and prepare the next safe action",
    result: {
      kind: "text",
      text: "The page is verified.",
      observations: [{
        tool: "search_public_web",
        args: { query: "Lantern Room events" },
        result: {
          sources: [{
            url: "https://example.com/events",
            title: "Lantern Room events &amp; tickets",
            fetched_at: "2026-10-29T12:00:00.000Z",
            source_type: "search",
          }],
        },
        elapsedMs: 24,
      }],
      usage: { input: 10, output: 4, calls: 2 },
      exhausted: false,
    },
  });
  assertEquals(rendition.schema_version, 2);
  assertEquals(rendition.kind, "research");
  const blocks = rendition.blocks as Array<Record<string, unknown>>;
  assert(blocks.some((block) => block.type === "timeline"));
  assert(blocks.some((block) => block.type === "progress"));
  const sources = blocks.find((block) => block.type === "sources");
  assert(sources);
  assertEquals(
    (sources.items as Array<Record<string, unknown>>)[0].url,
    "https://example.com/events",
  );
  assertEquals(
    (sources.items as Array<Record<string, unknown>>)[0].label,
    "Lantern Room events & tickets",
  );
});

Deno.test("#3355 user-facing renditions never expose diagnostic error slugs", () => {
  assertEquals(
    ariUserFacingToolError({
      code: "TOOL_FAILED",
      message: "RESEARCH_NOT_CONFIGURED",
    }),
    "Public research is not available in this environment yet.",
  );
  const rendition = buildAgentRunRendition({
    renditionId: "run:error-copy",
    goal: "Research Harmattan Club",
    result: {
      kind: "stopped",
      reason: "errors",
      observations: [{
        tool: "search_public_web",
        args: { query: "Harmattan Club" },
        error: {
          code: "TOOL_FAILED",
          message: "RESEARCH_NOT_CONFIGURED",
        },
        elapsedMs: 10,
      }],
      usage: { input: 2, output: 1, calls: 1 },
      exhausted: false,
    },
  });
  const serialized = JSON.stringify(rendition);
  assert(!serialized.includes("RESEARCH_NOT_CONFIGURED"));
  assert(!serialized.includes("TOOL_FAILED"));
  assert(serialized.includes("Public research is not available"));
});

Deno.test("#3355 plain Ari replies never expose diagnostic error slugs", () => {
  const response = sanitizeAriUserFacingDiagnostics(
    "Search public sources: RESEARCH_NOT_CONFIGURED (TOOL_FAILED).\n\nKeep the completed plan.",
  );
  assert(response.includes("Public research is temporarily unavailable"));
  assert(response.includes("Keep the completed plan"));
  assert(!response.includes("RESEARCH_NOT_CONFIGURED"));
  assert(!response.includes("TOOL_FAILED"));
  assert(response.includes("\n\n"));
});

Deno.test("#3355 every committed assistant reply crosses the diagnostic sanitizer", async () => {
  const source = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  const commitBoundary = source.slice(
    source.indexOf("async function commitTextTurn"),
    source.indexOf(
      "function jsonResponse",
      source.indexOf("async function commitTextTurn"),
    ),
  );
  assertMatch(
    commitBoundary,
    /const publicText = sanitizeAriUserFacingDiagnostics\(args\.text\)/,
  );
  assertMatch(commitBoundary, /const content = \{\s*text: publicText,/);
  assertMatch(commitBoundary, /assistantText: publicText,/);
  assertMatch(commitBoundary, /kind: "text",\s*text: publicText,/);
  assert(!/text: args\.text/.test(commitBoundary));
});

Deno.test("#3355 unknown internal codes also fail closed to product copy", () => {
  const response = sanitizeAriUserFacingDiagnostics(
    "The operation stopped with EVENT_GRAPH_STALE and DATE_WINDOW_AMBIGUOUS.",
  );
  assert(!response.includes("EVENT_GRAPH_STALE"));
  assert(!response.includes("DATE_WINDOW_AMBIGUOUS"));
  assert(response.includes("This step needs attention"));
});

Deno.test("#3355 plain Ari replies never expose tool names or UUID routes", () => {
  const response = sanitizeAriUserFacingDiagnostics(
    "Create it using the tool create_site_draft, then open /brand/33550000-0000-4000-a000-000000000001/website.",
  );
  assert(!response.includes("create_site_draft"));
  assert(!response.includes("33550000-0000-4000-a000-000000000001"));
  assert(response.includes("website draft"));
  assert(response.includes("Website screen"));
});

Deno.test("#3355 complete launch requests receive a deterministic real-data plan", () => {
  const request =
    "For Harmattan Club, build a complete brand launch plan, research our public presence, and show every step.";
  assert(isBrandLaunchPlanRequest(request));
  assert(
    launchPlanNeedsPublicResearch(
      "Check public evidence without guessing before launch.",
    ),
  );
  assertEquals(
    launchPlanInitialCalls({
      brandId: "brand-a",
      brandName: "Harmattan Club",
      includeResearch: true,
    }).map((call) => call.name),
    ["get_operator_snapshot", "get_brand_site", "search_public_web"],
  );
  const plan = buildBrandLaunchPlan({
    brandName: "Harmattan Club",
    observations: [
      {
        tool: "get_operator_snapshot",
        args: { brand_id: "brand-a" },
        result: {
          selected_brand: {
            name: "Harmattan Club",
            description: "A Lagos culture club",
            city: "Lagos",
            country_code: "NG",
            default_currency: "NGN",
            genuinely_missing: ["cover image", "public phone"],
          },
          offerings: [],
          payout_ready: false,
        },
        elapsedMs: 10,
      },
      {
        tool: "get_brand_site",
        args: { brand_id: "brand-a" },
        result: { website_state: "not_set_up" },
        elapsedMs: 10,
      },
      {
        tool: "search_public_web",
        args: { query: "Harmattan Club" },
        result: {
          sources: [
            {
              title: "Fall Festival Tickets",
              url: "https://example.com/fall-festival",
            },
            {
              title: "Harmattan Club Lagos",
              url: "https://directory.example/harmattan-club",
            },
          ],
        },
        elapsedMs: 10,
      },
    ],
  });
  assertEquals(plan.steps.length, 8);
  assert(plan.text.includes("Harmattan Club"));
  assert(plan.text.includes("Lagos"));
  assert(plan.text.includes("NGN"));
  assert(plan.text.includes("Nothing has been changed or published"));
  assert(plan.text.includes("cover image"));
  assert(!plan.text.includes("RESEARCH_NOT_CONFIGURED"));
  assert(!plan.text.includes("create_site_draft"));
  assertEquals(plan.sourceUrls, [
    "https://directory.example/harmattan-club",
  ]);
  assert(!plan.text.includes("2 public search leads"));

  const rendition = buildAgentRunRendition({
    renditionId: "run:launch-plan",
    goal: request,
    result: {
      kind: "text",
      text: plan.text,
      observations: [],
      usage: { input: 1, output: 1, calls: 1 },
      exhausted: false,
    },
    plan,
  });
  assertEquals(rendition.title, "Launch plan ready");
  assertEquals(rendition.state, "ready");
  const blocks = rendition.blocks as Array<Record<string, unknown>>;
  const timeline = blocks.find((block) => block.type === "timeline");
  assertEquals(
    (timeline?.items as Array<Record<string, unknown>>).length,
    8,
  );
  assert(blocks.some((block) => block.id === "genuinely-missing"));
  assertEquals(rendition.actions, undefined);
});
