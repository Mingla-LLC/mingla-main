// Issue #3355 — authenticated, sanitized feedback on a specific Ari reply.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { sanitizeAriText } from "../_shared/agentSanitization.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = new Set([
  "inaccurate",
  "missed_request",
  "hard_to_use",
  "unsafe",
  "other",
]);

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response(405, { code: "METHOD_NOT_ALLOWED" });
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return response(401, { code: "UNAUTHENTICATED" });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) {
    return response(500, { code: "INTERNAL" });
  }
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(
    authHeader.slice("Bearer ".length),
  );
  if (authError || !auth.user) {
    return response(401, { code: "UNAUTHENTICATED" });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return response(400, { code: "BAD_REQUEST" });
  }
  const messageId = typeof body.message_id === "string" ? body.message_id : "";
  const sentiment = body.sentiment;
  const reasonCode = typeof body.reason_code === "string"
    ? body.reason_code
    : null;
  const comment = typeof body.comment === "string" ? body.comment : "";
  if (
    !UUID_PATTERN.test(messageId) ||
    !["positive", "negative"].includes(String(sentiment))
  ) {
    return response(400, { code: "BAD_REQUEST" });
  }
  if (reasonCode && !REASONS.has(reasonCode)) {
    return response(400, { code: "BAD_REQUEST" });
  }
  if (comment.length > 1200) return response(400, { code: "COMMENT_TOO_LONG" });

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: assistant, error: messageError } = await admin
    .from("agent_messages")
    .select("id,conversation_id,user_id,role,content,created_at")
    .eq("id", messageId)
    .eq("user_id", auth.user.id)
    .eq("role", "assistant")
    .maybeSingle();
  if (messageError) return response(500, { code: "FEEDBACK_UNAVAILABLE" });
  if (!assistant) return response(404, { code: "MESSAGE_NOT_FOUND" });

  const sanitizedComment = sanitizeAriText(comment).text;
  const { error: feedbackError } = await admin.from("ari_message_feedback")
    .upsert({
      user_id: auth.user.id,
      conversation_id: assistant.conversation_id,
      assistant_message_id: assistant.id,
      sentiment,
      reason_code: sentiment === "negative" ? reasonCode ?? "other" : null,
      sanitized_comment: sanitizedComment,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,assistant_message_id" });
  if (feedbackError) return response(500, { code: "FEEDBACK_UNAVAILABLE" });

  if (sentiment === "negative") {
    const { data: previousUser } = await admin.from("agent_messages")
      .select("id,content")
      .eq("conversation_id", assistant.conversation_id)
      .eq("user_id", auth.user.id)
      .eq("role", "user")
      .lt("created_at", assistant.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const userText =
      sanitizeAriText(String(previousUser?.content?.text ?? "")).text;
    const assistantText =
      sanitizeAriText(String(assistant.content?.text ?? "")).text;
    let { data: training } = await admin.from("ari_training_turns")
      .select("id,signal_codes")
      .eq("source_assistant_message_id", assistant.id)
      .maybeSingle();
    if (!training) {
      const inserted = await admin.from("ari_training_turns").insert({
        archive_conversation_key: assistant.conversation_id,
        source_user_id: auth.user.id,
        source_conversation_id: assistant.conversation_id,
        source_user_message_id: previousUser?.id ?? null,
        source_assistant_message_id: assistant.id,
        sanitized_user_text: userText,
        sanitized_assistant_text: assistantText,
        sanitized_tool_trace: [],
        signal_codes: ["negative_feedback"],
      }).select("id,signal_codes").maybeSingle();
      training = inserted.data;
    } else if (!training.signal_codes?.includes("negative_feedback")) {
      await admin.from("ari_training_turns").update({
        signal_codes: [...(training.signal_codes ?? []), "negative_feedback"],
      }).eq("id", training.id);
    }
    if (training?.id) {
      const { data: existingCase } = await admin.from("ari_quality_cases")
        .select("id")
        .eq("training_turn_id", training.id)
        .contains("signal_codes", ["negative_feedback"])
        .maybeSingle();
      if (!existingCase) {
        await admin.from("ari_quality_cases").insert({
          training_turn_id: training.id,
          source_user_id: auth.user.id,
          source_conversation_id: assistant.conversation_id,
          status: "new",
          severity: reasonCode === "unsafe" ? "critical" : "high",
          title: reasonCode === "unsafe"
            ? "Host flagged an unsafe Ari reply"
            : "Host marked an Ari reply unhelpful",
          redacted_summary: sanitizedComment ||
            `${userText.slice(0, 320)} — ${assistantText.slice(0, 520)}`,
          sanitized_transcript: [
            { role: "user", text: userText },
            { role: "assistant", text: assistantText },
            ...(sanitizedComment
              ? [{ role: "feedback", text: sanitizedComment }]
              : []),
          ],
          signal_codes: ["negative_feedback"],
          root_cause: reasonCode === "hard_to_use"
            ? "presentation"
            : reasonCode === "unsafe"
            ? "policy"
            : null,
        });
      }
    }
  }
  return response(200, { accepted: true, sentiment, message_id: messageId });
});
