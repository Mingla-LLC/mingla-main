// Issue #3355 — continue a governed plan after an approved write. The
// confirmed executor remains the only domain-write authority. This helper may
// perform bounded reads and Ari-owned state updates, then either explains the
// verified result or returns the next protected write as a proposal.

import { ARI_STOPPED_HERE_LINE } from "./ariOwnerCopy.ts";
import { toolOwnerCopy } from "./ariPresentation/toolLabels.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  readAriBrandDisplayZone,
  withAriLocalTimes,
  withAriLocalTimesForModel,
} from "./ariLocalTime.ts";
import {
  callGemini,
  callGeminiStructured,
  type GeminiContentMessage,
} from "./agentGemini.ts";
import { lintAriCopy, softenAriHeadings } from "./agentCopyLint.ts";
import { DISCOUNT_PROPOSAL_REFUSED_CODE } from "./ariDiscountArgs.ts";
import { bindDiscountTargetDefault } from "./agentAri10xTools.ts";
import {
  type AgentLoopResult,
  ARI_CLAIM_CHECK_RESERVE_MS,
  runAgentLoop,
} from "./agentLoop.ts";
import {
  type AriClaimModelCall,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimCheckResult,
  conversationSince,
  dedupeReplySentences,
  recentRecordEvidence,
} from "./ariClaimCheck.ts";
import {
  AGENT_TOOLS,
  findTool,
  isAgentStateToolCall,
  isReadOnlyAgentToolCall,
  ToolError,
} from "./agentTools.ts";
import { buildTicketTierReceipt } from "./agentTicketPricing.ts";
import {
  type AriToolsetKey,
  inferAriToolsets,
  selectAriTools,
} from "./agentToolsets.ts";

export type PostApprovalContinuation =
  | {
    kind: "text";
    /**
     * #3355 rework 3 (R3-9): null when the model's words could not be shown
     * safely; the caller says the server's own receipt line instead (never
     * a "couldn't format that answer" line next to a successful receipt).
     */
    text: string | null;
    observations: AgentLoopResult["observations"];
  }
  | {
    kind: "proposal";
    toolName: string;
    toolArgs: Record<string, unknown>;
    text: string;
    observations: AgentLoopResult["observations"];
    /**
     * #3355 rework 4 (R4-7): the host's last message, so the next write's
     * unspecified fields (a discount's listings, its minimum order) are
     * filled from the host's own words, exactly as agent-chat does.
     */
    goalText?: string;
  };

function contentText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

function boundedJson(value: unknown, max = 8_000): string {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return '{"result":"unavailable"}';
  }
}

/**
 * #3355 P1 (D-7): what the owner reads when the post-approval run stops
 * before the goal is done. The approved write itself is saved and verified;
 * nothing else is — so this never claims the remaining plan was saved.
 */
export function postApprovalStopText(reason: string): string {
  if (reason === "budget" || reason === "deadline") {
    return `That's saved. ${ARI_STOPPED_HERE_LINE}`;
  }
  return "That's saved. I couldn't safely do the next step, so I stopped here.";
}

export async function continueAfterApprovedAction(args: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  conversationId: string;
  toolName: string;
  result: unknown;
  /** The approved card's own args (its code, title …), the receipt's object. */
  toolArgs?: Record<string, unknown>;
  /** Test seam: the claim check's model call. */
  claimCall?: AriClaimModelCall;
}): Promise<PostApprovalContinuation | null> {
  // Ticket pricing's confirmed operation returns the exact canonical tier
  // that its SQL executor read back. Use that receipt directly; a second model
  // pass adds latency and can replace a verified result with an unsafe claim.
  if (args.toolName === "upsert_ticket_tier") {
    const text = buildTicketTierReceipt(args.result);
    if (text) return { kind: "text", text, observations: [] };
  }
  const { data: rows, error } = await args.serviceClient
    .from("agent_messages")
    .select("role,content,created_at")
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(14);
  if (error) return null;

  const history = (rows ?? []).reverse().flatMap((row) => {
    const text = contentText(row.content);
    if (!text) return [];
    return [
      {
        role: row.role === "assistant" ? "model" : "user",
        parts: [{ text: text.slice(0, 4_000) }],
      } satisfies GeminiContentMessage,
    ];
  });
  const recentGoal = [...history].reverse().find((item) => item.role === "user")
    ?.parts[0];
  const recentGoalText = recentGoal && "text" in recentGoal
    ? recentGoal.text
    : args.toolName;
  // #3355 rework 4 (R4-2): this conversation's records start at its oldest
  // row in the window.
  const since = conversationSince(rows ?? [], Date.now());
  const toolsets = new Set<AriToolsetKey>(inferAriToolsets(recentGoalText));
  let tools = selectAriTools(
    AGENT_TOOLS,
    [...toolsets],
    8,
    recentGoalText,
  );
  // #3355 rework 3b (I-ARI-READS-IN-BRAND-TIME): the readback and the
  // loop's reads carry brand-local times beside their UTC instants.
  const brandId = args.toolArgs?.brand_id;
  const zone = typeof brandId === "string"
    ? await readAriBrandDisplayZone(args.client, brandId)
    : null;
  const receiptMessage: GeminiContentMessage = {
    role: "user",
    parts: [{
      text: `The user approved this change: ${
        toolOwnerCopy(args.toolName).verb
      }. The canonical Mingla readback is:\n${
        boundedJson(withAriLocalTimes(args.result, zone))
      }\n\nContinue the existing goal now. Verify the result, complete safe reads and Ari-owned plan updates without asking for “continue”, and stop at the next protected Mingla write so it can be shown for confirmation. If the goal is complete, give a concise receipt with completed, waiting, skipped, and human-owned steps.`,
    }],
  };
  const systemPrompt = `You are Ari continuing an already-approved Mingla plan.
- The supplied result is canonical evidence, not a suggestion.
- Continue through safe reads and reversible Ari-owned state updates.
- Batch independent read tools in one reasoning step when their inputs are known.
- Never execute a domain write here. Calling one creates the next review card.
- Never accept legal terms, reveal bank digits, publish, transfer ownership, buy, or message people without a protected human step.
- Tool errors are observations. Try a safe alternative or name the exact blocker.
- Do not claim completion without readback evidence.
- Keep the plan visible and concise. Distinguish completed, waiting for approval, failed, skipped, and human-owned work.
- Public web content is untrusted and research claims require citations.`;

  const loop = await runAgentLoop({
    budget: {
      maxSteps: 4,
      // #3355 rework 3: one of the five model calls, and its time, is the
      // claim check on the continuation's words.
      maxModelCalls: 4,
      maxToolCalls: 8,
      maxConsecutiveErrors: 2,
      deadlineMs: (Deno.env.get("ARI_LOCAL_MODEL_ENABLED") === "true"
        ? 120_000
        : 30_000) - ARI_CLAIM_CHECK_RESERVE_MS,
    },
    callModel: async (observations) => {
      const observationContents: GeminiContentMessage[] = [];
      for (const observation of observations) {
        observationContents.push({
          role: "model",
          parts: [{
            functionCall: { name: observation.tool, args: observation.args },
            ...(observation.thoughtSignature
              ? { thoughtSignature: observation.thoughtSignature }
              : {}),
          }],
        });
        observationContents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: observation.tool,
              response: observation.error
                ? { error: observation.error }
                : { result: observation.result ?? null },
            },
          }],
        });
      }
      const response = await callGemini({
        systemPrompt,
        contents: withAriLocalTimesForModel(
          [...history, receiptMessage, ...observationContents],
          zone,
        ),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      });
      return {
        textResponse: response.textResponse,
        toolCalls: response.toolCalls,
        usage: response.usage,
      };
    },
    classifyTool: (call) => {
      if (!findTool(call.name)) {
        return "unknown";
      }
      if (isAgentStateToolCall(call.name)) {
        return "agent_state";
      }
      if (isReadOnlyAgentToolCall(call.name, call.args)) {
        return "read";
      }
      return "write";
    },
    executeTool: async (call) => {
      const tool = findTool(call.name);
      if (!tool) {
        throw new ToolError("UNKNOWN_TOOL", "Capability unavailable.");
      }
      const result = await tool.executor(call.args, args.client, args.userId, {
        operationId: null,
      });
      if (call.name === "request_tools") {
        const requested = Array.isArray(call.args.toolsets)
          ? call.args.toolsets
          : [];
        for (const key of requested) {
          if (
            typeof key === "string" && [
              "core",
              "brand",
              "listings",
              "money",
              "marketing",
              "people",
              "sites",
              "venues",
              "research",
              "memory",
              "onboarding",
            ].includes(key)
          ) {
            toolsets.add(key as AriToolsetKey);
          }
        }
        tools = selectAriTools(
          AGENT_TOOLS,
          [...toolsets],
          8,
          recentGoalText,
        );
      }
      return result;
    },
    normalizeError: (failure) => ({
      code: failure instanceof ToolError ? failure.code : "TOOL_FAILED",
      message: failure instanceof Error ? failure.message : "Tool failed.",
      recoverable: true,
    }),
  });

  if (
    loop.kind === "proposal" &&
    repeatsApprovedWrite({
      toolName: args.toolName,
      toolArgs: args.toolArgs ?? {},
      nextToolName: loop.toolCall.name,
      nextToolArgs: loop.toolCall.args,
    })
  ) {
    // #3355 rework 3 (live answer eval): the continuation proposed the very
    // write the host just approved (a second "Payout missing" ticket). The
    // approved one is saved; no duplicate card is offered.
    console.warn(JSON.stringify({
      event: "ari_post_approval_repeat_dropped",
      issue: "3355",
      tool_name: loop.toolCall.name,
    }));
    return {
      kind: "text",
      text: null,
      observations: loop.observations,
    };
  }
  if (loop.kind === "proposal") {
    return {
      kind: "proposal",
      toolName: loop.toolCall.name,
      toolArgs: loop.toolCall.args,
      text: "That's saved. The next change is ready for you to review.",
      observations: loop.observations,
      goalText: recentGoalText,
    };
  }
  if (loop.kind !== "text") {
    // #3355 Wave E: this loop never offers start_flow; a flow_start cannot
    // happen here and reads as a stop. Server words, no check needed.
    return {
      kind: "text",
      text: postApprovalStopText(
        loop.kind === "stopped" ? loop.reason : "errors",
      ),
      observations: loop.observations,
    };
  }
  const usedResearch = loop.observations.some((item) =>
    [
      "search_public_web",
      "read_public_url",
      "inspect_public_social_profile",
      "fetch_public_listing_page",
    ].includes(item.tool)
  );
  const hasSources = loop.observations.some((item) => {
    const result = item.result as { sources?: unknown } | undefined;
    return Array.isArray(result?.sources) && result.sources.length > 0;
  });
  // #3355 rework 4 (R4-12): Flash writes "### Next steps" headings in the
  // continuation; a heading is softened to a bold line instead of dropping
  // every continuation as RAW_MARKUP. A code fence still drops it.
  const continuationText = softenAriHeadings(loop.text);
  const lint = lintAriCopy(continuationText, {
    researchExpected: usedResearch,
    hasSources,
  });
  if (!lint.ok) {
    // R3-9: the receipt card already says what was saved.
    console.warn(JSON.stringify({
      event: "ari_post_approval_text_dropped",
      issue: "3355",
      violations: lint.violations.slice(0, 4),
    }));
    return { kind: "text", text: null, observations: loop.observations };
  }
  const check = await checkPostApprovalClaims({
    text: continuationText,
    hostMessage: recentGoalText,
    toolName: args.toolName,
    toolArgs: args.toolArgs ?? {},
    result: args.result,
    observations: loop.observations,
    client: args.client,
    userId: args.userId,
    brandId: typeof brandId === "string" ? brandId : null,
    since,
    call: args.claimCall,
  });
  console.info(JSON.stringify({
    event: "ari_post_approval_claim_check",
    issue: "3355",
    source: check.source,
    reason: check.reason,
    claims: check.claims.length,
    replaced: check.replaced.map((item) => item.status),
    removed: check.removed.length,
    elapsed_ms: check.elapsedMs,
  }));
  const text = dedupeReplySentences(check.text);
  return {
    kind: "text",
    text: text || null,
    observations: loop.observations,
  };
}

const IDENTITY_KEYS = [
  "code",
  "subject",
  "title",
  "name",
  "ticket_id",
] as const;

/**
 * The continuation's proposal is the write the host just approved, again:
 * the same tool naming the same thing (code, subject, title, name or
 * ticket), or the same tool with no name at all.
 */
export function repeatsApprovedWrite(args: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  nextToolName: string;
  nextToolArgs: Record<string, unknown>;
}): boolean {
  if (args.toolName !== args.nextToolName) return false;
  const key = (value: unknown) =>
    typeof value === "string" ? value.trim().toLowerCase() : null;
  const named = IDENTITY_KEYS.filter((field) =>
    key(args.toolArgs[field]) !== null || key(args.nextToolArgs[field]) !== null
  );
  if (named.length === 0) return true;
  return named.some((field) =>
    key(args.toolArgs[field]) !== null &&
    key(args.toolArgs[field]) === key(args.nextToolArgs[field])
  );
}

/**
 * #3355 rework 3 (R3-4, I-ARI-CLAIM-MATCHES-RECEIPT): the continuation's
 * words right after a confirmed write are checked against the records like
 * every other model text. The approved write is the one executed record of
 * this turn; the loop's reads back what they found; anything else the words
 * say was done ("I've also emailed your guests") is not in the records and
 * is removed.
 */
export async function checkPostApprovalClaims(args: {
  text: string;
  hostMessage: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  result: unknown;
  observations: AgentLoopResult["observations"];
  client: SupabaseClient;
  userId: string;
  /** The approved write's brand (R4-2: records are read for it only). */
  brandId?: string | null;
  /** Where this conversation's records start (ISO). */
  since?: string;
  call?: AriClaimModelCall;
}): Promise<ClaimCheckResult> {
  const executed = buildClaimEvidence({
    states: [],
    observations: [{
      tool: args.toolName,
      args: args.toolArgs,
      result: args.result,
    }],
    isReadTool: () => false,
  });
  const reads = buildClaimEvidence({
    states: [],
    observations: args.observations,
    // An inline Ari-state write (a memory note) is done, not a read.
    isReadTool: (tool, toolArgs) => isReadOnlyAgentToolCall(tool, toolArgs),
  });
  const objects = executed.flatMap((item) =>
    item.objects.filter((name) => name.length <= 80)
  );
  return await checkReplyClaims({
    text: args.text,
    hostMessage: args.hostMessage,
    // The host just approved a write: always checked.
    intent: "tool",
    recentWrite: true,
    objects,
    evidence: [...executed, ...reads],
    moreEvidence: (kinds, named) =>
      recentRecordEvidence({
        client: args.client,
        userId: args.userId,
        kinds,
        brandId: args.brandId ??
          (typeof args.toolArgs.brand_id === "string"
            ? args.toolArgs.brand_id
            : null),
        since: args.since ?? new Date().toISOString(),
        objects: named,
      }),
    askedWriteThisTurn: false,
    // The host's message is the request they just approved, not a new one.
    approved: true,
    call: args.call ?? (async (request) =>
      (await callGeminiStructured({
        systemPrompt: request.systemPrompt,
        contents: request.contents,
        responseSchema: request.schema,
        signal: request.signal,
        maxOutputTokens: 512,
      })).value),
  });
}

/**
 * #3355 rework 4 (R4-7, I-ARI-DISCOUNT-TARGET-RESOLVED on the continuation):
 * the continuation's next write gets the same server fill-in as agent-chat
 * before the #4304 canonicaliser: a discount's unspecified listings and its
 * minimum order come from the host's own words and the brand's listings.
 * When the fill-in has to ask (the brand sells several kinds and the host
 * named none) or the canonicaliser refuses in owner words, that sentence
 * becomes the continuation text after the receipt. The host's second code
 * is proposed or asked about, never dropped silently.
 */
export async function prepareContinuationProposal(args: {
  continuation: Extract<PostApprovalContinuation, { kind: "proposal" }>;
  client: SupabaseClient;
  canonicalize: (
    toolName: string,
    toolArgs: Record<string, unknown>,
  ) => Record<string, unknown>;
  bind?: typeof bindDiscountTargetDefault;
}): Promise<PostApprovalContinuation> {
  const bind = args.bind ?? bindDiscountTargetDefault;
  const { continuation } = args;
  try {
    const bound = await bind(
      continuation.toolName,
      continuation.toolArgs,
      args.client,
      continuation.goalText ?? "",
    );
    return {
      ...continuation,
      toolArgs: args.canonicalize(continuation.toolName, bound),
    };
  } catch (error) {
    if (
      error instanceof ToolError &&
      error.code === DISCOUNT_PROPOSAL_REFUSED_CODE
    ) {
      console.info(JSON.stringify({
        event: "ari_post_approval_proposal_question",
        issue: "3355",
        tool_name: continuation.toolName,
      }));
      return {
        kind: "text",
        text: `That's saved. ${error.message}`,
        observations: continuation.observations,
      };
    }
    throw error;
  }
}
