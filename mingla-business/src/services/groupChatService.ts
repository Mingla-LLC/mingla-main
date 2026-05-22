import { supabase } from "./supabase";

export interface EventGroupConversation {
  id: string;
  name: string;
  /**
   * Live event title fetched at read-time. Use THIS in the header — `name` is a
   * cached snapshot from when the auto-create trigger fired, which becomes stale
   * if the planner later renames the event (e.g., "Untitled draft" → "Beach Party").
   */
  event_name: string;
  is_broadcast_only: boolean;
  is_enabled: boolean;
}

export interface EventGroupMessage {
  id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
  marketing_campaign_id: string | null;
  /** 'text' | 'image' | 'video' | 'file' | 'card' per messages.message_type CHECK constraint. */
  message_type: string;
  /** Public URL into the `messages` storage bucket for image/video/file attachments. NULL for plain text. */
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
}

/**
 * Local picked-asset shape for image uploads. Mirrors the consumer-side
 * pattern at ConnectionsPage.tsx:2210-2259. `uri` is the local file path
 * from expo-image-picker; `name` + `type` + `size` come from the picker
 * result.
 */
export interface PlannerImageAttachment {
  uri: string;
  name: string;
  type: string;
  size: number;
}

export interface EventGroupParticipant {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  joined_at: string;
}

export async function getEventGroupChat(eventId: string): Promise<{
  conversation: EventGroupConversation | null;
  error: string | null;
}> {
  // JOIN events so the header shows the live event title (auto-updates on rename)
  // rather than the cached conversation.name snapshot from auto-create trigger time.
  // Note: events table column is `title`, NOT `name` — verified against
  // supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7796.
  const { data, error } = await supabase
    .from("conversations")
    .select("id, name, is_broadcast_only, is_enabled, events!event_id(title)")
    .eq("event_id", eventId)
    .in("linked_entity_type", ["trip", "event"])
    .maybeSingle();
  if (error) return { conversation: null, error: error.message };
  if (data === null) return { conversation: null, error: null };
  const eventName =
    (data as { events?: { title?: string | null } | null }).events?.title?.trim() ||
    data.name?.trim() ||
    "Group chat";
  return {
    conversation: {
      id: data.id,
      name: data.name ?? "Group chat",
      event_name: eventName,
      is_broadcast_only: Boolean(data.is_broadcast_only),
      is_enabled: Boolean(data.is_enabled),
    },
    error: null,
  };
}

export async function postPlannerMessage(
  conversationId: string,
  content: string,
  attachment?: PlannerImageAttachment | null,
): Promise<{ messageId: string | null; error: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (userId === null) return { messageId: null, error: "Not signed in" };

  let fileUrl: string | null = null;
  let fileName: string | null = null;
  let fileSize: number | null = null;
  let messageType: "text" | "image" = "text";

  if (attachment) {
    // Mirror consumer-side pattern at app-mobile/src/components/ConnectionsPage.tsx:2210-2259.
    // Path format `<conversation_id>/<file>` is what the messages-bucket storage RLS
    // expects — `is_message_conversation_participant((storage.foldername(name))[1], auth.uid())`.
    const ext =
      attachment.name.split(".").pop()?.toLowerCase() ||
      (attachment.type.startsWith("image/") ? "jpg" : "bin");
    const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
    const filePath = `${conversationId}/${userId}_${Date.now()}.${safeExt}`;
    const contentType = attachment.type.startsWith("image/")
      ? attachment.type
      : "image/jpeg";

    const formData = new FormData();
    formData.append("file", {
      uri: attachment.uri,
      type: contentType,
      name: attachment.name,
    } as unknown as Blob);

    const { error: uploadError } = await supabase.storage
      .from("messages")
      .upload(filePath, formData, { contentType, upsert: false });
    if (uploadError) {
      return { messageId: null, error: `Upload failed: ${uploadError.message}` };
    }
    const { data: urlData } = supabase.storage.from("messages").getPublicUrl(filePath);
    fileUrl = urlData.publicUrl;
    fileName = attachment.name;
    fileSize = attachment.size || null;
    messageType = "image";
  }

  const trimmed = content.trim();
  if (messageType === "text" && trimmed.length === 0) {
    return { messageId: null, error: "Message is empty." };
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      content: trimmed,
      message_type: messageType,
      file_url: fileUrl,
      file_name: fileName,
      file_size: fileSize,
    })
    .select("id")
    .single();
  if (error) return { messageId: null, error: error.message };
  return { messageId: data.id, error: null };
}

export async function listMessages(
  conversationId: string,
  limit = 80,
): Promise<{ messages: EventGroupMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, sender_id, content, created_at, marketing_campaign_id, message_type, file_url, file_name, file_size",
    )
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return { messages: [], error: error.message };
  return { messages: (data ?? []) as EventGroupMessage[], error: null };
}

export async function listParticipants(
  conversationId: string,
): Promise<{ participants: EventGroupParticipant[]; error: string | null }> {
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("user_id, joined_at")
    .eq("conversation_id", conversationId)
    .order("joined_at", { ascending: true });
  if (error) return { participants: [], error: error.message };

  const userIds = (data ?? []).map((row) => row.user_id).filter(Boolean);
  const { data: profilesData, error: profilesError } = userIds.length > 0
    ? await supabase
        .from("profiles")
        .select("id, display_name, first_name, last_name, username, avatar_url")
        .in("id", userIds)
    : { data: [], error: null };
  if (profilesError) return { participants: [], error: profilesError.message };

  const profiles = new Map((profilesData ?? []).map((profile: any) => [profile.id, profile]));
  const participants = (data ?? []).map((row: any) => {
    const profile = profiles.get(row.user_id) ?? {};
    const displayName =
      profile.display_name ||
      [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
      profile.username ||
      "Buyer";
    return {
      user_id: row.user_id,
      joined_at: row.joined_at,
      display_name: displayName,
      avatar_url: profile.avatar_url ?? null,
    };
  });

  return { participants, error: null };
}

export async function setBroadcastOnly(
  conversationId: string,
  isBroadcastOnly: boolean,
): Promise<{ error: string | null }> {
  // I-PROPOSED-I: chain .select("id") so RLS-denied updates surface as 0-row, not silent success.
  const { data, error } = await supabase
    .from("conversations")
    .update({
      is_broadcast_only: isBroadcastOnly,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Not allowed to toggle broadcast-only on this conversation." };
  }
  return { error: null };
}

export async function removeParticipant(
  conversationId: string,
  userId: string,
): Promise<{ error: string | null }> {
  // I-PROPOSED-I: chain .select("user_id") so RLS-denied deletes surface as 0-row, not silent success.
  const { data, error } = await supabase
    .from("conversation_participants")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Not allowed to remove this participant or participant already removed." };
  }
  return { error: null };
}

export async function deleteMessage(
  messageId: string,
): Promise<{ error: string | null }> {
  // I-PROPOSED-I: chain .select("id") so RLS-denied soft-deletes surface as 0-row, not silent success.
  const { data, error } = await supabase
    .from("messages")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Not allowed to delete this message or message already deleted." };
  }
  return { error: null };
}
