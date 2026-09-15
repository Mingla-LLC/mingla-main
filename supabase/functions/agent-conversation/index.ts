// Issue #3429 — authenticated Ari conversation titles and cleanup-aware deletion.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

type ConversationAction = "rename" | "regenerate" | "delete" | "delete_all";
interface RequestBody {
  action?: ConversationAction;
  conversation_id?: string;
  title?: string;
  confirm_replace_manual?: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { code: "METHOD_NOT_ALLOWED" });
  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return response(400, { code: "BAD_REQUEST" });
  }
  if (!body.action) return response(400, { code: "BAD_REQUEST" });
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return response(401, { code: "UNAUTHENTICATED" });
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return response(500, { code: "INTERNAL" });
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const jwt = authHeader.slice("Bearer ".length);
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user) return response(401, { code: "UNAUTHENTICATED" });
  const userId = userData.user.id;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (body.action === "delete_all") {
    const { error: conversationsError } = await admin.from("agent_conversations")
      .delete().eq("user_id", userId);
    if (conversationsError) return response(500, { code: "DELETE_FAILED" });
    const { error: profileError } = await admin.from("agent_user_profile")
      .delete().eq("user_id", userId);
    if (profileError) return response(500, { code: "DELETE_FAILED" });
    return response(200, { deleted: true });
  }

  if (!body.conversation_id || !UUID_PATTERN.test(body.conversation_id)) {
    return response(400, { code: "BAD_REQUEST" });
  }
  const { data: owned, error: ownedError } = await userClient
    .from("agent_conversations")
    .select("id,title,title_source,brand_id,created_at,updated_at")
    .eq("id", body.conversation_id)
    .maybeSingle();
  if (ownedError || !owned) return response(404, { code: "CONVERSATION_NOT_FOUND" });

  if (body.action === "delete") {
    const { data: deleted, error } = await admin.from("agent_conversations")
      .delete().eq("id", owned.id).eq("user_id", userId).select("id");
    if (error || !deleted?.length) return response(409, { code: "DELETE_CONFLICT" });
    return response(200, { conversation_id: owned.id, deleted: true });
  }

  if (body.action === "rename") {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > 60) {
      return response(400, { code: "TITLE_INVALID" });
    }
    const now = new Date().toISOString();
    const { data: renamed, error } = await admin.from("agent_conversations")
      .update({
        title,
        title_source: "manual",
        title_generation_version: null,
        title_generated_at: now,
        updated_at: now,
      })
      .eq("id", owned.id).eq("user_id", userId)
      .select("id,title,title_source,title_generation_version,title_generated_at")
      .single();
    if (error || !renamed) return response(500, { code: "TITLE_UPDATE_FAILED" });
    return response(200, { conversation: renamed });
  }

  if (owned.title_source === "manual" && body.confirm_replace_manual !== true) {
    return response(409, {
      code: "MANUAL_TITLE_CONFIRMATION_REQUIRED",
      message: "Replace your name with a new Ari title?",
    });
  }
  const { data: earliest } = await admin.from("agent_messages")
    .select("content")
    .eq("conversation_id", owned.id)
    .eq("user_id", userId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: attachments } = await admin.from("agent_attachments")
    .select("file_type")
    .eq("conversation_id", owned.id)
    .eq("user_id", userId)
    .order("display_order", { ascending: true });
  const firstText = typeof (earliest?.content as { text?: unknown } | undefined)?.text === "string"
    ? (earliest?.content as { text: string }).text
    : "";
  const attachmentTypes = (attachments ?? []).map((row) => String(row.file_type));
  const { data: generated, error: generateError } = await admin.rpc(
    "agent_safe_provisional_title",
    { p_text: firstText, p_attachment_types: attachmentTypes },
  );
  if (generateError || typeof generated !== "string" || generated.trim().length === 0) {
    return response(500, {
      code: "TITLE_GENERATION_FAILED",
      message: "Couldn’t update the title. Your previous title is unchanged.",
    });
  }
  const now = new Date().toISOString();
  const { data: renamed, error } = await admin.from("agent_conversations")
    .update({
      title: generated,
      title_source: "generated",
      title_generation_version: "safe-taxonomy-v1",
      title_generated_at: now,
      updated_at: now,
    })
    .eq("id", owned.id).eq("user_id", userId)
    .select("id,title,title_source,title_generation_version,title_generated_at")
    .single();
  if (error || !renamed) {
    return response(500, {
      code: "TITLE_GENERATION_FAILED",
      message: "Couldn’t update the title. Your previous title is unchanged.",
    });
  }
  return response(200, { conversation: renamed });
});
