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
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { buildSystemPrompt, PROMPT_VERSION, AgentUserProfile, BrandSummary } from "../_shared/agentSystemPrompt.ts";
import { detectPromptInjection } from "../_shared/agentPromptInjection.ts";
import { callGemini, ARI_MODEL_VERSION, GeminiContentMessage } from "../_shared/agentGemini.ts";
import { AGENT_TOOLS, READ_ONLY_TOOL_NAMES, findTool, ToolError } from "../_shared/agentTools.ts";
import { buildServiceClient, enforceTurnRateLimit } from "../_shared/agentRateLimit.ts";

const MAX_MESSAGE_LENGTH = 4096;
const HISTORY_WINDOW = 10;
const WALL_CLOCK_TIMEOUT_MS = 60_000;

interface RequestBody {
  conversation_id: string | null;
  message: string;
  brand_id?: string | null;
}

type Response_ =
  | { kind: "text"; text: string; conversation_id: string; message_id: string }
  | { kind: "pending_action"; pending_action_id: string; tool_name: string; tool_args: Record<string, unknown>; conversation_id: string; message_id: string }
  | { kind: "error"; code: string; message: string };

function jsonResponse(status: number, body: Response_): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { kind: "error", code, message });
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
      () => resolve(errorResponse(504, "TIMEOUT", "Ari is taking too long — try again")),
      WALL_CLOCK_TIMEOUT_MS,
    )
  );

  // Top-level safety net — without this, an uncaught exception in handle()
  // returns Deno's default 500 with no body, leaving the client with a
  // generic "Edge Function returned a non-2xx status code". Surface the
  // exception message in a typed response so we can debug from the toast.
  const wrapped = handle(req).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[agent-chat] UNCAUGHT:", message, stack);
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
    return errorResponse(400, "MESSAGE_TOO_LONG", `Messages must be ≤ ${MAX_MESSAGE_LENGTH} characters`);
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
    return errorResponse(429, "RATE_LIMITED", message);
  }

  // Validate brand_id if provided
  if (body.brand_id) {
    const { data: brand, error: brandErr } = await userClient
      .from("brands")
      .select("id")
      .eq("id", body.brand_id)
      .eq("account_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (brandErr || !brand) {
      return errorResponse(400, "INVALID_BRAND", "Brand not found or not owned");
    }
  }

  // Prompt injection detection (flag but do not refuse)
  const injection = detectPromptInjection(body.message);

  // Load or create conversation
  let conversationId: string;
  if (body.conversation_id) {
    const { data: convo, error: convoErr } = await userClient
      .from("agent_conversations")
      .select("id")
      .eq("id", body.conversation_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (convoErr || !convo) {
      return errorResponse(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    conversationId = convo.id;
  } else {
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
      return errorResponse(500, "INTERNAL", `Failed to create conversation: ${createErr?.message ?? "unknown"}`);
    }
    conversationId = created.id;
  }

  // Load last N messages
  const { data: historyRows } = await userClient
    .from("agent_messages")
    .select("role, content, tool_calls, tool_results, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);
  const history = (historyRows ?? []).reverse(); // oldest -> newest

  // Load profile
  const { data: profileRow } = await userClient
    .from("agent_user_profile")
    .select("display_name, preferred_timezone, preferred_currency, communication_style")
    .eq("user_id", userId)
    .maybeSingle();
  const profile = profileRow as AgentUserProfile | null;

  // Load brands summary (ORCH-1103 — widened for edit/delete targeting +
  // disambiguation: currency, cover presence, and a per-brand deletable hint).
  const { data: brandsRows } = await userClient
    .from("brands")
    .select("id, name, slug, default_currency, cover_media_url")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  // hasBlockingEvents (Q1 = grouped count, no migration) — mirrors the
  // delete-guard semantics EXACTLY so the prompt's "deletable" hint and the
  // delete_brand executor's actual guard cannot drift: scheduled/live events
  // with a future event_dates.end_at, type-agnostic.
  // orch-strict-grep-allow events-type-filter — intentionally NO event_type filter.
  const brandIds = (brandsRows ?? []).map((b: any) => b.id as string);
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

  const brandsList: BrandSummary[] = (brandsRows ?? []).map((b: any) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    defaultCurrency: b.default_currency ?? null,
    hasCover: b.cover_media_url != null,
    hasBlockingEvents: blockingBrandIds.has(b.id),
  }));

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
      prompt_version: PROMPT_VERSION,
      model_version: ARI_MODEL_VERSION,
    })
    .select("id")
    .single();
  if (userMsgErr || !userMsg) {
    return errorResponse(500, "INTERNAL", `Failed to write user message: ${userMsgErr?.message ?? "unknown"}`);
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(profile, brandsList, {
    injectStrictReminder: injection.flagged,
  });

  // Build contents — wrap user-stored content in <user_data> delimiters per I-ARI-USER-DATA-WRAP
  const contents: GeminiContentMessage[] = [];
  for (const m of history) {
    if (m.role === "user") {
      const text = (m.content as any)?.text ?? "";
      contents.push({
        role: "user",
        parts: [{ text: `<user_data>\n${String(text)}\n</user_data>` }],
      });
    } else if (m.role === "assistant") {
      const text = (m.content as any)?.text;
      const toolCall = (m.tool_calls as any);
      if (toolCall?.tool_name && toolCall?.args) {
        contents.push({
          role: "model",
          parts: [{ functionCall: { name: toolCall.tool_name, args: toolCall.args } }],
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
    console.error("[agent-chat] Gemini error:", err?.kind, err?.message, err?.detail);
    // Surface config errors specifically — these are operator-fixable
    // (set the secret) and the generic "having trouble" message hides
    // the actual problem. HTTP errors with a status get a more
    // specific message too. Everything else falls back to MODEL_UNAVAILABLE.
    if (err?.kind === "config") {
      return errorResponse(
        500,
        "MODEL_NOT_CONFIGURED",
        err.message ?? "Ari isn't configured yet — operator must set GEMINI_API_KEY_ARI in Supabase function secrets.",
      );
    }
    if (err?.kind === "http") {
      const status = typeof err.status === "number" ? err.status : 0;
      if (status === 401 || status === 403) {
        return errorResponse(500, "MODEL_AUTH_FAILED", "Ari's API key was rejected by Google. Operator: verify GEMINI_API_KEY_ARI is a valid AI Studio key.");
      }
      if (status === 429) {
        return errorResponse(429, "MODEL_RATE_LIMITED", "Ari is hitting Google's rate limit — try again in a moment.");
      }
    }
    // Generic fallback for any other Gemini failure mode (HTTP 4xx other
    // than auth/rate-limit, malformed responses after retries, empty
    // responses). The real diagnostic detail is in the server logs above;
    // the user-visible message stays friendly.
    return errorResponse(502, "MODEL_UNAVAILABLE", "Ari is having trouble right now — try again in a moment.");
  }

  // Branch on tool call vs text
  if (gemini.toolCall) {
    const tool = findTool(gemini.toolCall.name);
    if (!tool) {
      return errorResponse(500, "INTERNAL", `Unknown tool: ${gemini.toolCall.name}`);
    }

    // For READ-ONLY tools, execute inline (no confirmation needed)
    if (READ_ONLY_TOOL_NAMES.has(tool.name)) {
      try {
        const result = await tool.executor(gemini.toolCall.args, userClient, userId);
        // Log tool result as a tool message, then ask Gemini for a natural-language summary
        const { data: toolMsg } = await userClient
          .from("agent_messages")
          .insert({
            conversation_id: conversationId,
            user_id: userId,
            role: "tool",
            content: { text: "" },
            tool_results: { tool_name: tool.name, result },
            prompt_version: PROMPT_VERSION,
            model_version: ARI_MODEL_VERSION,
          })
          .select("id")
          .single();

        // Follow-up Gemini call to summarise the read result
        const followupContents: GeminiContentMessage[] = [
          ...contents,
          {
            role: "model",
            parts: [{ functionCall: { name: tool.name, args: gemini.toolCall.args } }],
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
        } catch {
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
            prompt_version: PROMPT_VERSION,
            model_version: ARI_MODEL_VERSION,
          })
          .select("id")
          .single();
        if (asstErr || !asstMsg) {
          return errorResponse(500, "INTERNAL", "Failed to write assistant message");
        }
        return jsonResponse(200, {
          kind: "text",
          text,
          conversation_id: conversationId,
          message_id: asstMsg.id,
        });
      } catch (err: any) {
        if (err instanceof ToolError) {
          return errorResponse(403, err.code, err.message);
        }
        return errorResponse(500, "EXECUTION_FAILED", err?.message ?? "Tool failed");
      }
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
      return errorResponse(500, "INTERNAL", `Failed to create pending action: ${pendingErr?.message ?? "unknown"}`);
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
        prompt_version: PROMPT_VERSION,
        model_version: ARI_MODEL_VERSION,
      })
      .select("id")
      .single();
    if (asstErr || !asstMsg) {
      return errorResponse(500, "INTERNAL", "Failed to write assistant message");
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
  const { data: asstMsg, error: asstErr } = await userClient
    .from("agent_messages")
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "assistant",
      content: { text },
      prompt_version: PROMPT_VERSION,
      model_version: ARI_MODEL_VERSION,
    })
    .select("id")
    .single();
  if (asstErr || !asstMsg) {
    return errorResponse(500, "INTERNAL", "Failed to write assistant message");
  }

  // Update conversation updated_at
  await userClient
    .from("agent_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return jsonResponse(200, {
    kind: "text",
    text,
    conversation_id: conversationId,
    message_id: asstMsg.id,
  });
}
