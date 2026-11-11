// Issue #3355 Wave B (B1) — Ari reads the Feature Guide.
//
// MINGLA-INVARIANT: I-ARI-KNOWLEDGE-FROM-GUIDE | issue #3355 | Ari's product knowledge comes from the Feature Guide: a how-to or "can I / I want to" message runs search_mingla_guide (ari_search_feature_guide, signed-in callers only, public entry text plus the guide's own Live / Needs review status) before the model answers; a reply saying Mingla can't do something, in a turn with no guide search, runs one guide search and the model answers again; the reply carries the capability keys it used as structured data.
//
// Production 2026-11-10: product_capabilities had 160 entries with steps and
// limits; Ari never read them, said "I can't" about things Mingla does, and
// gave steps from memory.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_b_guide.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { runAgentLoop } from "../agentLoop.ts";
import type { AgentLoopObservation } from "../agentLoop.ts";
import {
  AGENT_TOOLS,
  findTool,
  isReadOnlyAgentToolCall,
  ToolError,
} from "../agentTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { selectAriTools } from "../agentToolsets.ts";
import { ARI_CAPABILITY_INDEX } from "../agentSystemPrompt.ts";
import {
  ariGuideCitations,
  ariGuideInitialCalls,
  ariGuideRecoveryCalls,
  isAriCantReply,
  isAriHowToAsk,
} from "../ariGuideKnowledge.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

const GUIDE_ROWS: Record<string, Record<string, unknown>> = {
  discount: {
    capability_key: "events-discount-codes",
    title: "Discount codes",
    outcome_summary:
      "Hosts create discount codes, automatic discounts and sale prices for tickets.",
    how_to:
      "In Mingla Host, open a brand, then Discounts. Create a code, automatic discount or sale price; choose what it applies to; review the server preview; and publish it.",
    limitations: "Door sales, RSVP tickets and comps are not discounted.",
    support_wording: "Hosts control codes, dates and limits.",
    who_can_use: ["Brand owner", "Brand admin"],
    surfaces: ["Mingla Host iOS", "Mingla Host Android", "Mingla Host web"],
    claimed_status: "live",
    guide_status: "Needs review",
    evidence_current: false,
    rank: 0.6,
  },
  contacts: {
    capability_key: "marketing-contact-import",
    title: "Import your customer list",
    outcome_summary:
      "Hosts upload a CSV of their existing customers into Brand People.",
    how_to:
      "In Mingla Host, open Marketing > People, then Import. Choose a CSV file, match its columns and confirm you have permission to contact these people.",
    limitations: "CSV only; up to 10,000 rows per file.",
    support_wording: "Hosts can import their own customer lists.",
    who_can_use: ["Brand owner", "Marketing manager"],
    surfaces: ["Mingla Host iOS", "Mingla Host web"],
    claimed_status: "live",
    guide_status: "Live",
    evidence_current: true,
    rank: 0.5,
  },
};

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function guideClient(
  pick: (query: string) => Record<string, unknown>[],
  calls: RpcCall[] = [],
  fail = false,
) {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(
        fail
          ? { data: null, error: { message: "boom", code: "PGRST000" } }
          : { data: pick(String(args.p_query)), error: null },
      );
    },
  };
}

const pickByWords = (query: string) =>
  /discount|code/i.test(query)
    ? [GUIDE_ROWS.discount]
    : /customer|contact|list|upload/i.test(query)
    ? [GUIDE_ROWS.contacts]
    : [];

/** The real tool executor (no auth wrapper) against a stub RPC. */
async function runGuide(
  args: Record<string, unknown>,
  client: ReturnType<typeof guideClient>,
) {
  const tool = findTool("search_mingla_guide");
  assert(tool);
  // The secure wrapper authorizes against the session; the raw executor is
  // the definition registered in agentAri10xTools.ts.
  const source = read("supabase/functions/_shared/agentAri10xTools.ts");
  assertStringIncludes(source, 'client.rpc("ari_search_feature_guide"');
  const { ARI_10X_TOOLS } = await import("../agentAri10xTools.ts");
  const raw = ARI_10X_TOOLS.find((t) => t.name === "search_mingla_guide");
  assert(raw);
  return await raw!.executor(args, client as never, "user", {
    operationId: null,
  });
}

Deno.test("B1: search_mingla_guide is registered as a read everywhere tools are registered", () => {
  const tool = AGENT_TOOLS.find((t) => t.name === "search_mingla_guide");
  assert(tool, "in AGENT_TOOLS");
  assertEquals(AGENT_TOOL_AUTHORIZATION.search_mingla_guide, {
    requiredRole: "self",
    resource: "none",
  });
  assert(isReadOnlyAgentToolCall("search_mingla_guide", { query: "x" }));
  assertStringIncludes(ARI_CAPABILITY_INDEX, "- search_mingla_guide — ");
  assertStringIncludes(
    read("supabase/functions/_shared/agentRenditions.ts"),
    'search_mingla_guide: "Check the Mingla guide"',
  );
  // Core toolset: offered on every agent-loop turn.
  const selected = selectAriTools(AGENT_TOOLS, ["core", "marketing"], 12, "x");
  assert(selected.some((t) => t.name === "search_mingla_guide"));
  assertEquals(
    (tool!.parameters as { required: string[] }).required,
    ["query"],
  );
});

Deno.test("B1: the tool calls ari_search_feature_guide and says how Ari may speak per status", async () => {
  const calls: RpcCall[] = [];
  const result = await runGuide(
    { query: "How do I make a discount code?", limit: 9 },
    guideClient(() => [GUIDE_ROWS.discount, GUIDE_ROWS.contacts], calls),
  ) as {
    results: Array<Record<string, unknown>>;
    found: boolean;
  };
  assertEquals(calls, [{
    fn: "ari_search_feature_guide",
    args: { p_query: "How do I make a discount code?", p_limit: 5 },
  }]);
  assert(result.found);
  const [discount, contacts] = result.results;
  assertEquals(discount.capability_key, "events-discount-codes");
  assertEquals(discount.status, "needs_review");
  assertEquals(discount.how_to_say, "hedge_and_point_to_the_screen");
  assertEquals(discount.evidence_current, false);
  // The App Map screen the guide names comes along.
  assertEquals(discount.screens, [{
    route: "/brand/[id]/discounts",
    title: "Discounts",
  }]);
  assertEquals(contacts.status, "live");
  assertEquals(contacts.how_to_say, "state_as_fact");
  // Evidence internals never reach the model.
  assert(!("rank" in discount) && !("evidence" in discount));
});

Deno.test("B1: a failed guide read is a typed, explained error", async () => {
  const error = await assertRejects(
    () => runGuide({ query: "discounts" }, guideClient(() => [], [], true)),
    ToolError,
  );
  assertEquals((error as ToolError).code, "READ_FAILED");
  assertEquals(
    (error as ToolError).user_reason,
    "Ari couldn't read the Mingla guide just now.",
  );
});

Deno.test("B1: how-to and capability asks are recognised; ordinary replies are not refusals", () => {
  assert(isAriHowToAsk("How do I make a discount code?"));
  assert(isAriHowToAsk("I want to upload my customer list"));
  assert(isAriHowToAsk("Can I sell tickets in naira?"));
  assert(!isAriHowToAsk("Thanks!"));
  assert(isAriCantReply("Sorry, I can't create discount codes."));
  assert(isAriCantReply("Mingla doesn't support customer list uploads."));
  assert(isAriCantReply("That isn't available yet."));
  assert(!isAriCantReply("Open Discounts and tap New code."));
});

async function harness(
  message: string,
  modelText: (obs: readonly AgentLoopObservation[]) => string,
) {
  const calls: RpcCall[] = [];
  const client = guideClient(pickByWords, calls);
  let modelCalls = 0;
  const result = await runAgentLoop({
    initialCalls: ariGuideInitialCalls(message),
    callModel: (observations) => {
      modelCalls += 1;
      return Promise.resolve({
        toolCalls: [],
        textResponse: modelText(observations),
      });
    },
    classifyTool: (call) =>
      findTool(call.name)
        ? isReadOnlyAgentToolCall(call.name, call.args) ? "read" : "write"
        : "unknown",
    executeTool: (call) => runGuide(call.args, client),
    recoverReadsFromPrematureText: (text, observations) =>
      ariGuideRecoveryCalls(text, observations, message),
  });
  return { result, calls, modelCalls };
}

/** A stub model that answers from the guide's how_to when it has one. */
const answerFromGuide =
  (fallback: string) => (observations: readonly AgentLoopObservation[]) => {
    const guide = observations.find((o) => o.tool === "search_mingla_guide");
    const first = (guide?.result as { results?: Array<{ how_to: string }> })
      ?.results?.[0];
    return first ? first.how_to : fallback;
  };

Deno.test("I-ARI-KNOWLEDGE-FROM-GUIDE: 'How do I make a discount code?' reads the guide and the reply cites events-discount-codes", async () => {
  const { result, calls, modelCalls } = await harness(
    "How do I make a discount code?",
    answerFromGuide("I'm not sure."),
  );
  assertEquals(result.kind, "text");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "ari_search_feature_guide");
  assertEquals(modelCalls, 1);
  if (result.kind !== "text") return;
  assertStringIncludes(result.text, "then Discounts");
  assertEquals(
    ariGuideCitations(result.observations).map((c) => c.capability_key),
    ["events-discount-codes"],
  );
});

Deno.test("I-ARI-KNOWLEDGE-FROM-GUIDE: 'I want to upload my customer list' reads the guide and cites marketing-contact-import", async () => {
  const { result, calls } = await harness(
    "I want to upload my customer list",
    answerFromGuide("I'm not sure."),
  );
  assertEquals(calls.length, 1);
  assertEquals(result.kind, "text");
  if (result.kind !== "text") return;
  assertStringIncludes(result.text, "Marketing > People");
  assertEquals(
    ariGuideCitations(result.observations).map((c) => c.capability_key),
    ["marketing-contact-import"],
  );
});

Deno.test("I-ARI-KNOWLEDGE-FROM-GUIDE: a 'can't' reply with no guide search runs one and the model answers again", async () => {
  // Not a how-to ask, so nothing reads the guide up front.
  const message = "Make 50 discount codes for my influencers";
  assertEquals(ariGuideInitialCalls(message), []);
  const { result, calls, modelCalls } = await harness(
    message,
    (observations) =>
      observations.some((o) => o.tool === "search_mingla_guide")
        ? answerFromGuide("still no")(observations)
        : "Sorry, I can't create discount codes.",
  );
  assertEquals(modelCalls, 2, "the model is asked again after the search");
  assertEquals(calls.length, 1, "exactly one guide search");
  assertEquals(result.kind, "text");
  if (result.kind !== "text") return;
  assert(!isAriCantReply(result.text));
  assertStringIncludes(result.text, "Discounts");
  assertEquals(
    ariGuideCitations(result.observations)[0]?.capability_key,
    "events-discount-codes",
  );
});

Deno.test("I-ARI-KNOWLEDGE-FROM-GUIDE: the guard runs once — a refusal after a guide search stands", async () => {
  const { result, calls, modelCalls } = await harness(
    "How do I sell tickets on the moon?",
    () => "Sorry, Mingla can't do that.",
  );
  assertEquals(calls.length, 1); // the up-front read, no second search
  assertEquals(modelCalls, 1);
  assertEquals(result.kind, "text");
  assertEquals(
    ariGuideRecoveryCalls("Sorry, I can't.", [{
      tool: "search_mingla_guide",
      args: {},
      error: { code: "READ_FAILED", message: "x" },
      elapsedMs: 0,
    }], "x"),
    [],
  );
});

Deno.test("I-ARI-KNOWLEDGE-FROM-GUIDE: agent-chat wires the guide read, the refusal guard, the citations and the prompt rule", () => {
  const chat = read("supabase/functions/agent-chat/index.ts");
  assertStringIncludes(chat, ": ariGuideInitialCalls(semanticMessage);");
  assertStringIncludes(
    chat,
    "...ariGuideRecoveryCalls(text, observations, semanticMessage),",
  );
  assertStringIncludes(chat, "{ guide_citations: guideCitations }");
  const prompt = read("supabase/functions/_shared/agentSystemPrompt.ts");
  assertStringIncludes(
    prompt,
    "Before you tell a host something can't be done, and before you give how-to steps, call search_mingla_guide.",
  );
});

Deno.test("B1 migration: ari_search_feature_guide is static, definer, pinned, authenticated-only and reuses the guide's status", () => {
  const sql = read(
    "supabase/migrations/20280620043355_issue_3355_ari_search_feature_guide.sql",
  );
  assertStringIncludes(
    sql,
    "CREATE OR REPLACE FUNCTION public.ari_search_feature_guide(",
  );
  assertStringIncludes(sql, "SECURITY DEFINER");
  assertStringIncludes(sql, "SET search_path = ''");
  assertStringIncludes(sql, "IF auth.uid() IS NULL THEN");
  assertStringIncludes(
    sql,
    "public.issue_3720_feature_guide_effective_status(c.id) AS guide_status",
  );
  assertStringIncludes(sql, "USING gin (public.ari_feature_guide_document(");
  assert(
    /REVOKE ALL ON FUNCTION public\.ari_search_feature_guide\(text, integer\)\s+FROM PUBLIC, anon, authenticated, service_role;\s+GRANT EXECUTE ON FUNCTION public\.ari_search_feature_guide\(text, integer\)\s+TO authenticated;/
      .test(sql),
  );
  assert(!/\bEXECUTE\s+(?:format|v_|'|\$)/i.test(sql), "static SQL only");
  assert(!/product_capability_evidence/.test(sql), "no evidence rows");
  assert(!/40001/.test(sql));
});
