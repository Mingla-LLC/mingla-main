// Issue #4114 Wave 4 — open-view-once. See handler.ts for the contract.
// verify_jwt stays true (function-policy.json): recipients send their user JWT,
// the hourly cron sends the service-role bearer (also a JWT), and the handler
// re-checks which one it got before doing anything.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { createOpenViewOnceHandler, type DueRow, type ViewOnceMessage } from "./handler.ts";

const BUCKET = "message-attachments";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function bearer(authorization: string | null): string {
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
}

function errorText(error: { message?: string; code?: string } | null): string | null {
  if (!error) return null;
  return error.code ?? error.message ?? "error";
}

serve(createOpenViewOnceHandler({
  async userIdFor(authorization) {
    const token = bearer(authorization);
    if (!token || token === serviceRoleKey) return null;
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  },
  isCronCaller: (authorization) => isAuthorizedCronCaller(authorization),
  async loadMessage(messageId) {
    const { data, error } = await admin
      .from("messages")
      .select("id, conversation_id, sender_id, message_type, file_url, view_once, view_once_purged_at, deleted_at")
      .eq("id", messageId)
      .maybeSingle();
    return { data: (data as ViewOnceMessage | null) ?? null, error: errorText(error) };
  },
  async isParticipant(conversationId, userId) {
    const { data, error } = await admin
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .limit(1);
    return { data: (data ?? []).length > 0, error: errorText(error) };
  },
  async signUrl(path, seconds) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds);
    return { data: data?.signedUrl ?? null, error: errorText(error) };
  },
  async recordView(messageId, userId) {
    const { data, error } = await admin
      .from("message_media_views")
      .upsert({ message_id: messageId, user_id: userId }, {
        onConflict: "message_id,user_id",
        ignoreDuplicates: true,
      })
      .select("viewed_at");
    const rows = (data ?? []) as Array<{ viewed_at: string }>;
    return {
      data: { inserted: rows.length > 0, viewedAt: rows[0]?.viewed_at ?? null },
      error: errorText(error),
    };
  },
  async listDue(limit) {
    const { data, error } = await admin.rpc("issue_4114_view_once_media_due", { p_limit: limit });
    return { data: (data ?? []) as DueRow[], error: errorText(error) };
  },
  async removeObjects(paths) {
    const { error } = await admin.storage.from(BUCKET).remove(paths);
    return { error: errorText(error) };
  },
  async markPurged(messageIds) {
    const { error } = await admin.rpc("issue_4114_mark_view_once_purged", { p_message_ids: messageIds });
    return { error: errorText(error) };
  },
}));
