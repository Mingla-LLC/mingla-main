// ORCH-0821 — agent-chat
//
// SECURITY MODEL (do not modify without re-reviewing SPEC §10):
//   1. Every request requires a valid user JWT.
//   2. Tool executors use the caller's JWT — NEVER service role. Service role
//      appears here ONLY for rate-limit reads via _shared/agentRateLimit.ts.
//   3. The model PROPOSES writes; agent-confirm-action EXECUTES them. This
//      function NEVER calls a write tool executor directly.
//   4. User-stored content is wrapped in <user_data> delimiters before being
//      sent to Gemini (I-ARI-USER-DATA-WRAP).

// deno-lint-ignore-file no-explicit-any
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentUserProfile,
  BrandSummary,
  buildSystemPrompt,
  BusinessContext,
  OfferingSummary,
  TENANT_CONTEXT_VERSION,
} from "../_shared/agentSystemPrompt.ts";
import { detectPromptInjection } from "../_shared/agentPromptInjection.ts";
import {
  ARI_MODEL_VERSION,
  callGemini,
  GeminiContentMessage,
  GeminiError,
} from "../_shared/agentGemini.ts";
import {
  AGENT_TOOLS,
  findTool,
  READ_ONLY_TOOL_NAMES,
  ToolError,
} from "../_shared/agentTools.ts";
import { authorizeAgentTool } from "../_shared/agentToolAuthorization.ts";
import {
  buildServiceClient,
  enforceTurnRateLimit,
} from "../_shared/agentRateLimit.ts";
import { AgentChoices, detectChoices } from "../_shared/agentChoices.ts";
import { logError } from "../_shared/structuredLog.ts";
import {
  AccessibleAgentBrand,
  requireAccessibleAgentBrand,
  resolveAccessibleAgentBrands,
} from "../_shared/agentTenantScope.ts";

const MAX_MESSAGE_LENGTH = 4096;
const HISTORY_WINDOW = 10;
const WALL_CLOCK_TIMEOUT_MS = 60_000;

interface RequestBody {
  conversation_id: string | null;
  message: string;
  brand_id?: string | null;
}

type Response_ =
  | {
    kind: "text";
    text: string;
    conversation_id: string;
    message_id: string;
    choices?: AgentChoices;
  }
  | {
    kind: "pending_action";
    pending_action_id: string;
    tool_name: string;
    tool_args: Record<string, unknown>;
    conversation_id: string;
    message_id: string;
  }
  | {
    kind: "error";
    code: string;
    message: string;
    retry_after_seconds?: number;
    cooldown_until?: string;
  };

function jsonResponse(status: number, body: Response_): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  recovery?: { retry_after_seconds?: number; cooldown_until?: string },
): Response {
  return jsonResponse(status, { kind: "error", code, message, ...recovery });
}

function tenantScopeResponse(
  status: number,
  code: string,
  message: string,
  scopeState: "new" | "bound" | "legacy",
  requestBrandSupplied: boolean,
  accessibleBrandCount: number,
): Response {
  // Intentionally excludes user/brand/conversation IDs, names, messages,
  // prompts, args, and results.
  console.warn(
    "[agent-chat] tenant scope stopped",
    JSON.stringify({
      fn: "agent-chat",
      revision: "2013",
      code,
      scope_state: scopeState,
      request_brand_supplied: requestBrandSupplied,
      accessible_brand_count: accessibleBrandCount,
    }),
  );
  return errorResponse(status, code, message);
}

function schemaErrorResponse(err: unknown): Response | null {
  const geminiError = err as Partial<GeminiError>;
  if (geminiError?.kind !== "schema") return null;
  // Schema errors contain only static tool names, JSON pointers, keywords,
  // and classifications. Never log the schema value, prompt, or user data.
  console.error("[agent-chat] Ari provider schema error:", geminiError.message);
  return errorResponse(
    500,
    "MODEL_SCHEMA_INVALID",
    "Ari's tools need an update before chat can continue. Please try again later.",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "POST required");
  }

  // Race the handler against a wall-clock timeout
  const timeout = new Promise<Response>((resolve) =>
    setTimeout(
      () =>
        resolve(
          errorResponse(504, "TIMEOUT", "Ari is taking too long — try again"),
        ),
      WALL_CLOCK_TIMEOUT_MS,
    )
  );

  // Top-level safety net — without this, an uncaught exception in handle()
  // returns Deno's default 500 with no body, leaving the client with a
  // generic "Edge Function returned a non-2xx status code". Surface the
  // exception message in a typed response so we can debug from the toast.
  const wrapped = handle(req).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logError("agent-chat uncaught handler error", err, { fn: "agent-chat" });
    return errorResponse(500, "HANDLER_THREW", `agent-chat threw: ${message}`);
  });

  return await Promise.race([wrapped, timeout]);
});

async function handle(req: Request): Promise<Response> {
  // Parse + validate body
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (typeof body.message !== "string" || body.message.length === 0) {
    return errorResponse(400, "BAD_REQUEST", "message is required");
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(
      400,
      "MESSAGE_TOO_LONG",
      `Messages must be ≤ ${MAX_MESSAGE_LENGTH} characters`,
    );
  }

  // Auth — extract JWT from Authorization header and build user-scoped client
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(401, "UNAUTHORIZED", "Missing authorization");
  }
  const jwt = authHeader.slice("Bearer ".length);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse(500, "INTERNAL", "Supabase config missing");
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or expired session");
  }
  const userId = userData.user.id;

  // Rate limit — uses service role (system table reads only)
  let serviceClient: SupabaseClient;
  try {
    serviceClient = buildServiceClient();
  } catch {
    return errorResponse(500, "INTERNAL", "Server misconfigured");
  }

  const rateLimit = await enforceTurnRateLimit(userId, serviceClient);
  if (!rateLimit.allowed) {
    const message = rateLimit.reason === "rate_limited_inflight"
      ? "Another action is currently being processed — please wait a moment"
      : "You've reached today's chat limit. Resets in 24 hours.";
    const cooldownUntil = rateLimit.resetAt ??
      new Date(Date.now() + 5_000).toISOString();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(cooldownUntil) - Date.now()) / 1000),
    );
    return errorResponse(429, "RATE_LIMITED", message, {
      retry_after_seconds: retryAfterSeconds,
      cooldown_until: cooldownUntil,
    });
  }

  // #2013: resolve private tenant scope before conversation/model/message/tool work.
  let accessibleBrands: AccessibleAgentBrand[];
  try {
    accessibleBrands = await resolveAccessibleAgentBrands(userClient, userId);
  } catch (_error) {
    console.error(
      "[agent-chat] tenant scope denied",
      JSON.stringify({
        fn: "agent-chat",
        revision: "2013",
        code: "TENANT_SCOPE_UNAVAILABLE",
        scope_state: body.conversation_id ? "bound_or_legacy" : "new",
        request_brand_supplied: typeof body.brand_id === "string",
      }),
    );
    return errorResponse(
      503,
      "TENANT_SCOPE_UNAVAILABLE",
      "Ari couldn't verify your brand access. Try again.",
    );
  }

  // Prompt injection detection (flag but do not refuse)
  const injection = detectPromptInjection(body.message);

  // Load or create conversation
  let conversationId: string;
  let conversationSummary: string | null = null;
  let activeBrand: AccessibleAgentBrand | null = null;
  if (body.conversation_id) {
    const { data: convo, error: convoErr } = await userClient
      .from("agent_conversations")
      .select("id, summary, brand_id")
      .eq("id", body.conversation_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (convoErr || !convo) {
      return errorResponse(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found",
      );
    }
    conversationId = convo.id;
    conversationSummary =
      typeof (convo as { summary?: unknown }).summary === "string"
        ? (convo as { summary: string }).summary
        : null;
    const storedBrandId = (convo as { brand_id?: string | null }).brand_id ??
      null;
    if (storedBrandId) {
      try {
        activeBrand = requireAccessibleAgentBrand(
          accessibleBrands,
          storedBrandId,
        );
      } catch {
        return tenantScopeResponse(
          403,
          "BRAND_ACCESS_DENIED",
          "You no longer have access to this conversation's brand.",
          "bound",
          typeof body.brand_id === "string",
          accessibleBrands.length,
        );
      }
      if (body.brand_id !== storedBrandId) {
        return tenantScopeResponse(
          409,
          "CONVERSATION_BRAND_MISMATCH",
          "This conversation belongs to a different brand. Start a new chat for the selected brand.",
          "bound",
          typeof body.brand_id === "string",
          accessibleBrands.length,
        );
      }
    } else if (accessibleBrands.length > 0) {
      return tenantScopeResponse(
        409,
        "LEGACY_CONVERSATION_UNSCOPED",
        "This older conversation is read-only. Start a new chat for the selected brand.",
        "legacy",
        typeof body.brand_id === "string",
        accessibleBrands.length,
      );
    } else if (body.brand_id) {
      return tenantScopeResponse(
        403,
        "BRAND_ACCESS_DENIED",
        "That brand is not available to this account.",
        "legacy",
        true,
        accessibleBrands.length,
      );
    }
  } else {
    if (accessibleBrands.length > 0 && !body.brand_id) {
      return tenantScopeResponse(
        409,
        "BRAND_CONTEXT_REQUIRED",
        "Select a brand before starting a new Ari chat.",
        "new",
        false,
        accessibleBrands.length,
      );
    }
    if (body.brand_id) {
      try {
        activeBrand = requireAccessibleAgentBrand(
          accessibleBrands,
          body.brand_id,
        );
      } catch {
        return tenantScopeResponse(
          403,
          "BRAND_ACCESS_DENIED",
          "That brand is not available to this account.",
          "new",
          true,
          accessibleBrands.length,
        );
      }
    }
    const { data: created, error: createErr } = await userClient
      .from("agent_conversations")
      .insert({
        user_id: userId,
        brand_id: body.brand_id ?? null,
        title: null,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return errorResponse(
        500,
        "INTERNAL",
        `Failed to create conversation: ${createErr?.message ?? "unknown"}`,
      );
    }
    conversationId = created.id;
  }

  // Load last N messages
  const { data: historyRows } = await userClient
    .from("agent_messages")
    .select(
      "role, content, tool_calls, tool_results, prompt_version, created_at",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);
  const history = (historyRows ?? []).reverse(); // oldest -> newest

  // Load profile
  const { data: profileRow } = await userClient
    .from("agent_user_profile")
    .select(
      "display_name, preferred_timezone, preferred_currency, communication_style",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const profile = profileRow as AgentUserProfile | null;

  // hasBlockingEvents (Q1 = grouped count, no migration) — mirrors the
  // delete-guard semantics EXACTLY so the prompt's "deletable" hint and the
  // delete_brand executor's actual guard cannot drift: scheduled/live events
  // with a future event_dates.end_at, type-agnostic.
  // orch-strict-grep-allow events-type-filter — intentionally NO event_type filter.
  const brandIds = activeBrand ? [activeBrand.id] : [];
  const blockingBrandIds = new Set<string>();
  if (brandIds.length > 0) {
    const nowIso = new Date().toISOString();
    const { data: blockingRows } = await userClient
      .from("events")
      .select("brand_id, event_dates!inner(end_at)")
      .in("brand_id", brandIds)
      .in("status", ["scheduled", "live"])
      .is("deleted_at", null)
      .gt("event_dates.end_at", nowIso);
    for (const r of (blockingRows ?? []) as any[]) {
      if (r?.brand_id) blockingBrandIds.add(r.brand_id as string);
    }
  }

  const brandsList: BrandSummary[] = accessibleBrands.slice(0, 20).map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    defaultCurrency: b.default_currency ?? null,
    hasCover: b.cover_media_url != null,
    hasBlockingEvents: blockingBrandIds.has(b.id),
    role: b.role,
    effectiveRank: b.effective_rank,
  }));

  // Wave 0 — compact offerings + payout-ready. Cap tokens; never dump PII.
  const offerings: OfferingSummary[] = [];
  let payoutReady: boolean | null = null;
  if (brandIds.length > 0) {
    const { data: offeringRows } = await userClient
      .from("events")
      .select("id, title, status, event_type")
      .in("brand_id", brandIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(12);
    for (const row of (offeringRows ?? []) as any[]) {
      offerings.push({
        id: row.id,
        title: String(row.title ?? "untitled").slice(0, 80),
        kind: String(row.event_type ?? "event"),
        status: String(row.status ?? "draft"),
      });
    }
    const probeBrand = activeBrand?.id;
    try {
      const { data: can } = await userClient.rpc("pg_brand_can_collect", {
        p_brand_id: probeBrand,
      });
      payoutReady = can === true ||
        (can as { can_collect?: boolean } | null)?.can_collect === true;
    } catch {
      payoutReady = null;
    }
  }
  const business: BusinessContext = {
    brands: brandsList,
    activeBrand: activeBrand
      ? brandsList.find((brand) => brand.id === activeBrand.id) ?? null
      : null,
    offerings,
    payoutReady,
    roleHint: activeBrand?.role ?? null,
    conversationSummary,
  };

  // Auto-title: if this is the first user message in the conversation and
  // the title is still null, derive a short title from the message text so
  // the conversations drawer shows something meaningful instead of "Untitled".
  // Best-effort; failures don't block the chat turn.
  if (history.length === 0) {
    const derivedTitle = body.message.trim().slice(0, 60).replace(/\s+/g, " ");
    if (derivedTitle.length > 0) {
      await userClient
        .from("agent_conversations")
        .update({ title: derivedTitle })
        .eq("id", conversationId)
        .is("title", null);
    }
  }

  // Insert the new user message
  const { data: userMsg, error: userMsgErr } = await userClient
    .from("agent_messages")
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "user",
      content: { text: body.message },
      prompt_version: TENANT_CONTEXT_VERSION,
      model_version: ARI_MODEL_VERSION,
    })
    .select("id")
    .single();
  if (userMsgErr || !userMsg) {
    return errorResponse(
      500,
      "INTERNAL",
      `Failed to write user message: ${userMsgErr?.message ?? "unknown"}`,
    );
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(profile, brandsList, {
    injectStrictReminder: injection.flagged,
    business,
  });

  // Build contents — wrap user-stored content in <user_data> delimiters per I-ARI-USER-DATA-WRAP
  const contents: GeminiContentMessage[] = [];
  // #2013 rework: only rows written under the first tenant-contained prompt
  // revision have authenticated scope provenance. Older/unmarked transcript
  // remains visible in the client but never crosses the Gemini boundary.
  const trustedHistoryPromptVersion = "tenant-v1";
  for (const m of history) {
    if (m.prompt_version !== trustedHistoryPromptVersion) continue;
    if (m.role === "user") {
      const text = (m.content as any)?.text ?? "";
      contents.push({
        role: "user",
        parts: [{ text: `<user_data>\n${String(text)}\n</user_data>` }],
      });
    } else if (m.role === "assistant") {
      const text = (m.content as any)?.text;
      const toolCall = m.tool_calls as any;
      if (toolCall?.tool_name && toolCall?.args) {
        contents.push({
          role: "model",
          parts: [{
            functionCall: { name: toolCall.tool_name, args: toolCall.args },
          }],
        });
      } else if (typeof text === "string") {
        contents.push({ role: "model", parts: [{ text }] });
      }
    } else if (m.role === "tool") {
      const tr = m.tool_results as any;
      if (tr?.tool_name) {
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: tr.tool_name,
              response: { result: tr.result ?? tr },
            },
          }],
        });
      }
    }
  }
  // Append the new user message
  contents.push({
    role: "user",
    parts: [{ text: `<user_data>\n${body.message}\n</user_data>` }],
  });

  // Call Gemini
  let gemini;
  try {
    gemini = await callGemini({
      systemPrompt,
      contents,
      tools: AGENT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    });
  } catch (err: any) {
    const schemaResponse = schemaErrorResponse(err);
    if (schemaResponse) return schemaResponse;
    console.error(
      "[agent-chat] Gemini error:",
      err?.kind,
      err?.message,
      err?.detail,
    );
    // Surface config errors specifically — these are operator-fixable
    // (set the secret) and the generic "having trouble" message hides
    // the actual problem. HTTP errors with a status get a more
    // specific message too. Everything else falls back to MODEL_UNAVAILABLE.
    if (err?.kind === "config") {
      return errorResponse(
        500,
        "MODEL_NOT_CONFIGURED",
        err.message ??
          "Ari isn't configured yet — operator must set GEMINI_API_KEY_ARI in Supabase function secrets.",
      );
    }
    if (err?.kind === "http") {
      const status = typeof err.status === "number" ? err.status : 0;
      if (status === 401 || status === 403) {
        return errorResponse(
          500,
          "MODEL_AUTH_FAILED",
          "Ari's API key was rejected by Google. Operator: verify GEMINI_API_KEY_ARI is a valid AI Studio key.",
        );
      }
      if (status === 429) {
        return errorResponse(
          429,
          "MODEL_RATE_LIMITED",
          "Ari is hitting Google's rate limit — try again in a moment.",
        );
      }
    }
    // Generic fallback for any other Gemini failure mode (HTTP 4xx other
    // than auth/rate-limit, malformed responses after retries, empty
    // responses). The real diagnostic detail is in the server logs above;
    // the user-visible message stays friendly.
    return errorResponse(
      502,
      "MODEL_UNAVAILABLE",
      "Ari is having trouble right now — try again in a moment.",
    );
  }

  // Branch on tool call vs text
  if (gemini.toolCall) {
    const tool = findTool(gemini.toolCall.name);
    if (!tool) {
      return errorResponse(
        500,
        "INTERNAL",
        `Unknown tool: ${gemini.toolCall.name}`,
      );
    }

    // For READ-ONLY tools, execute inline (no confirmation needed)
    if (READ_ONLY_TOOL_NAMES.has(tool.name)) {
      try {
        const result = await tool.executor(
          gemini.toolCall.args,
          userClient,
          userId,
          {
            operationId: null,
          },
        );
        // Log tool result as a tool message, then ask Gemini for a natural-language summary
        await userClient
          .from("agent_messages")
          .insert({
            conversation_id: conversationId,
            user_id: userId,
            role: "tool",
            content: { text: "" },
            tool_results: { tool_name: tool.name, result },
            prompt_version: TENANT_CONTEXT_VERSION,
            model_version: ARI_MODEL_VERSION,
          })
          .select("id")
          .single();

        // Follow-up Gemini call to summarise the read result
        const followupContents: GeminiContentMessage[] = [
          ...contents,
          {
            role: "model",
            parts: [{
              functionCall: { name: tool.name, args: gemini.toolCall.args },
            }],
          },
          {
            role: "user",
            parts: [{
              functionResponse: {
                name: tool.name,
                response: { result },
              },
            }],
          },
        ];
        let followup;
        try {
          followup = await callGemini({
            systemPrompt,
            contents: followupContents,
            tools: AGENT_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          });
        } catch (err: unknown) {
          const schemaResponse = schemaErrorResponse(err);
          if (schemaResponse) return schemaResponse;
          followup = undefined;
        }
        const text = followup?.textResponse ?? "Here's what I found.";

        const { data: asstMsg, error: asstErr } = await userClient
          .from("agent_messages")
          .insert({
            conversation_id: conversationId,
            user_id: userId,
            role: "assistant",
            content: { text, structured: result },
            prompt_version: TENANT_CONTEXT_VERSION,
            model_version: ARI_MODEL_VERSION,
          })
          .select("id")
          .single();
        if (asstErr || !asstMsg) {
          return errorResponse(
            500,
            "INTERNAL",
            "Failed to write assistant message",
          );
        }
        return jsonResponse(200, {
          kind: "text",
          text,
          conversation_id: conversationId,
          message_id: asstMsg.id,
        });
      } catch (err: any) {
        if (err instanceof ToolError) {
          console.error(
            "[agent-chat] tenant-scoped read stopped",
            JSON.stringify({
              fn: "agent-chat",
              revision: "2013",
              code: err.code,
              scope_state: activeBrand ? "bound" : "legacy_or_zero_brand",
              request_brand_supplied: typeof body.brand_id === "string",
              accessible_brand_count: accessibleBrands.length,
              tool_name: tool.name,
            }),
          );
          return errorResponse(
            err.code === "TENANT_SCOPE_UNAVAILABLE" ||
              err.code === "ROLE_CHECK_UNAVAILABLE"
              ? 503
              : err.code === "INVALID_ARGS"
              ? 400
              : 403,
            err.code,
            err.message,
          );
        }
        return errorResponse(
          500,
          "EXECUTION_FAILED",
          err?.message ?? "Tool failed",
        );
      }
    }

    // #2019: authorization precedes every persisted proposal.
    try {
      await authorizeAgentTool(tool, gemini.toolCall.args, userClient, userId);
    } catch (err: unknown) {
      if (err instanceof ToolError) {
        const status = err.code === "ROLE_CHECK_UNAVAILABLE"
          ? 503
          : err.code === "INVALID_ARGS"
          ? 400
          : 403;
        return errorResponse(status, err.code, err.message);
      }
      return errorResponse(
        503,
        "ROLE_CHECK_UNAVAILABLE",
        "Ari could not verify permissions right now",
      );
    }

    // For WRITE tools, register a pending action (NOT execute)
    const { data: pending, error: pendingErr } = await userClient
      .from("agent_pending_actions")
      .insert({
        user_id: userId,
        conversation_id: conversationId,
        tool_name: tool.name,
        tool_args: gemini.toolCall.args,
        status: "pending",
      })
      .select("id, tool_name, tool_args")
      .single();
    if (pendingErr || !pending) {
      return errorResponse(
        500,
        "INTERNAL",
        `Failed to create pending action: ${pendingErr?.message ?? "unknown"}`,
      );
    }

    const { data: asstMsg, error: asstErr } = await userClient
      .from("agent_messages")
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: { text: "" },
        tool_calls: {
          tool_name: tool.name,
          args: gemini.toolCall.args,
          pending_action_id: pending.id,
        },
        prompt_version: TENANT_CONTEXT_VERSION,
        model_version: ARI_MODEL_VERSION,
      })
      .select("id")
      .single();
    if (asstErr || !asstMsg) {
      return errorResponse(
        500,
        "INTERNAL",
        "Failed to write assistant message",
      );
    }

    return jsonResponse(200, {
      kind: "pending_action",
      pending_action_id: pending.id,
      tool_name: tool.name,
      tool_args: pending.tool_args as Record<string, unknown>,
      conversation_id: conversationId,
      message_id: asstMsg.id,
    });
  }

  // Text response (no tool call)
  if (!gemini.textResponse) {
    return errorResponse(502, "MODEL_EMPTY", "Ari didn't respond — try again");
  }
  const text = gemini.textResponse.trim();

  // ORCH-1103 REWORK 2 — attach the presentational choices payload (if this text
  // turn is a disambiguation or a no-brand handoff). Persisted in
  // content.structured so it survives a thread refetch and the chips re-render
  // from history (single source of truth = the stored message).
  const choices = detectChoices(body.message, text, brandsList);
  const content = choices ? { text, structured: { choices } } : { text };

  const { data: asstMsg, error: asstErr } = await userClient
    .from("agent_messages")
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "assistant",
      content,
      prompt_version: TENANT_CONTEXT_VERSION,
      model_version: ARI_MODEL_VERSION,
    })
    .select("id")
    .single();
  if (asstErr || !asstMsg) {
    return errorResponse(500, "INTERNAL", "Failed to write assistant message");
  }

  // Wave 0 / child O — compress last turn into reserved summary columns.
  const nextSummary = `${body.message.slice(0, 160)} → ${text.slice(0, 160)}`
    .slice(0, 400);
  await userClient
    .from("agent_conversations")
    .update({
      updated_at: new Date().toISOString(),
      summary: nextSummary,
      summary_through_message_id: asstMsg.id,
      summary_updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return jsonResponse(200, {
    kind: "text",
    text,
    conversation_id: conversationId,
    message_id: asstMsg.id,
    ...(choices ? { choices } : {}),
  });
}
