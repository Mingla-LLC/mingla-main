import { supabase } from "./supabase";

// #4459 — the event, trip and RSVP "Group chat" screens now run the brand's ONE
// Guest chat (linked_entity_type 'brand_guests'), shared by every guest of the
// brand. The per-listing chats are retired. Every write goes through the
// issue_4459_* RPCs: team posts are stamped as the brand, removal is sticky
// (restore lifts it), and the roster read is the server's member list.


export interface EventGroupConversation {
  id: string;
  name: string;
  /** #4459: the brand this Guest chat belongs to. */
  brand_id: string;
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
  /**
   * Attachment location. Host uploads and pre-#4114 Explorer media: a public
   * URL into the `messages` bucket. Explorer media since #4114 Wave 4: an
   * object path in the private `message-attachments` bucket (signed in
   * components/groupChat/GroupChatMessageMedia). NULL for plain text.
   */
  file_url: string | null;
  /** #4114 Wave 4: a photo or video each recipient may open once; never shown in the host panel. */
  view_once?: boolean | null;
  file_name: string | null;
  file_size: number | null;
  sender_display_name_snapshot: string | null;
  sender_role_snapshot: string | null;
  /** #4459: 'brand' for team posts (shown as the brand), 'guest' for guests. */
  sender_kind?: "guest" | "brand" | "system" | null;
  /** #4459: who on the team wrote a brand post (team-only read). */
  author_id?: string | null;
  author_name?: string | null;
  reply_to_id: string | null;
  related_message_ids: string[];
}

export interface EventGroupParticipant {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  joined_at: string;
  /** #4459: a brand team member (never removable from the Guest chat). */
  is_team: boolean;
  /** #4459: the guest chose "Show me as going" on a booking with the brand. */
  shown_as_going: boolean;
}

export async function getEventGroupChat(eventId: string): Promise<{
  conversation: EventGroupConversation | null;
  error: string | null;
}> {
  // #4459: the listing's brand, then that brand's Guest chat (the team is a
  // member through the team mirror, so RLS lets it read the row).
  // orch-strict-grep-allow events-type-filter — #4459 every listing type (event, trip, experience, RSVP) opens its brand's Guest chat
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("brand_id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) return { conversation: null, error: eventError.message };
  const brandId = (event as { brand_id?: string | null } | null)?.brand_id ?? null;
  if (brandId === null) return { conversation: null, error: null };
  return getBrandGuestChat(brandId);
}

/** #4459: a brand's Guest chat by brand id. */
export async function getBrandGuestChat(brandId: string): Promise<{
  conversation: EventGroupConversation | null;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, name, brand_id, is_broadcast_only, is_enabled, brands!brand_id(name)")
    .eq("brand_id", brandId)
    .eq("linked_entity_type", "brand_guests")
    .maybeSingle();
  if (error) return { conversation: null, error: error.message };
  if (data === null) return { conversation: null, error: null };
  const brandName =
    (data as { brands?: { name?: string | null } | null }).brands?.name?.trim() ||
    data.name?.trim() ||
    "Your brand";
  return {
    conversation: {
      id: data.id,
      name: brandName,
      brand_id: (data as { brand_id: string }).brand_id,
      event_name: `${brandName} Guests`,
      is_broadcast_only: Boolean(data.is_broadcast_only),
      is_enabled: Boolean(data.is_enabled),
    },
    error: null,
  };
}

export async function postPlannerMessage(
  conversationId: string,
  content: string,
): Promise<{ messageId: string | null; error: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (userId === null) return { messageId: null, error: "Not signed in" };

  // #4459: Guest chats are text only in v1 (photos follow on #4456's storage rule).

  const trimmed = content.trim();
  if (trimmed.length === 0) return { messageId: null, error: "Message is empty." };

  const { data, error } = await supabase.rpc("issue_4459_send_brand_guest_message", {
    p_conversation_id: conversationId,
    p_content: trimmed,
  });
  if (error) return { messageId: null, error: brandGuestErrorCopy(error) };
  const messageId = (data as { id?: string } | null)?.id ?? null;
  if (messageId === null) return { messageId: null, error: "Message failed. Try again." };

  // The server decides who is pushed (every unmuted guest for a brand post);
  // the app only names the message.
  supabase.functions
    .invoke("notify-message", {
      body: { type: "message", senderId: userId, conversationId, messageId },
    })
    .catch((err: unknown) => console.warn("[groupChatService] guest chat notify failed", err));
  return { messageId, error: null };
}

/** #4459: plain words for a refused Guest chat write. */
export function brandGuestErrorCopy(error: { code?: string | null; message?: string | null; details?: string | null }): string {
  const message = error.message ?? "";
  if (message.includes("chat_disabled")) return "This Guest chat is switched off.";
  if (error.code === "22023" && error.details === "user") return "That person is on your team, so they stay in the chat.";
  if (error.code === "22023") return "Messages need 1 to 4000 characters.";
  if (error.code === "42501") return "Only your brand team can do that.";
  return "Something went wrong. Try again.";
}

export async function listMessages(
  conversationId: string,
  limit = 80,
): Promise<{ messages: EventGroupMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, sender_id, content, created_at, marketing_campaign_id, message_type, file_url, file_name, file_size, sender_display_name_snapshot, sender_role_snapshot, sender_kind, reply_to_id, related_message_ids, view_once",
    )
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return { messages: [], error: error.message };
  const messages = (data ?? []) as EventGroupMessage[];
  // #4459: a brand post stores no sender (guests never see which team member
  // wrote it); the team reads the author from brand_guest_post_authors.
  const brandIds = messages.filter((m) => m.sender_kind === "brand").map((m) => m.id);
  if (brandIds.length === 0) return { messages, error: null };
  const { data: authors, error: authorsError } = await supabase
    .from("brand_guest_post_authors")
    .select("message_id, author_id")
    .in("message_id", brandIds);
  if (authorsError) return { messages, error: null };
  const authorIds = [...new Set(((authors ?? []) as Array<{ author_id: string | null }>).map((a) => a.author_id).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = authorIds.length > 0
    ? await supabase.from("profiles").select("id, display_name, first_name, username").in("id", authorIds)
    : { data: [] as Array<Record<string, unknown>> };
  const names = new Map(((profiles ?? []) as Array<{ id: string; display_name?: string | null; first_name?: string | null; username?: string | null }>)
    .map((p) => [p.id, p.display_name || p.first_name || p.username || "A teammate"]));
  const byMessage = new Map(((authors ?? []) as Array<{ message_id: string; author_id: string | null }>).map((a) => [a.message_id, a.author_id]));
  return {
    messages: messages.map((m) => {
      const author = byMessage.get(m.id) ?? null;
      return author ? { ...m, author_id: author, author_name: names.get(author) ?? "A teammate" } : m;
    }),
    error: null,
  };
}

export async function listParticipants(
  conversationId: string,
): Promise<{ participants: EventGroupParticipant[]; error: string | null }> {
  // #4459: the team reads the whole roster through the server's member list.
  const { data, error } = await supabase.rpc("issue_4459_list_brand_guest_members", {
    p_conversation_id: conversationId,
  });
  if (error) return { participants: [], error: brandGuestErrorCopy(error) };
  const members = Array.isArray((data as { members?: unknown } | null)?.members)
    ? ((data as { members: Array<Record<string, unknown>> }).members)
    : [];
  return {
    participants: members.map((member) => ({
      user_id: String(member.userId ?? ""),
      display_name: typeof member.displayName === "string" && member.displayName ? member.displayName : "Guest",
      avatar_url: typeof member.avatarUrl === "string" ? member.avatarUrl : null,
      joined_at: typeof member.joinedAt === "string" ? member.joinedAt : new Date(0).toISOString(),
      is_team: member.isTeam === true,
      shown_as_going: member.shownAsGoing === true,
    })),
    error: null,
  };
}

export async function setBroadcastOnly(
  conversationId: string,
  isBroadcastOnly: boolean,
): Promise<{ error: string | null }> {
  // #4459: announcements only, team only (the RPC refuses anyone else).
  const { error } = await supabase.rpc("issue_4459_set_brand_guest_announcements_only", {
    p_conversation_id: conversationId,
    p_value: isBroadcastOnly,
  });
  return { error: error ? brandGuestErrorCopy(error) : null };
}

export async function removeParticipant(
  conversationId: string,
  userId: string,
): Promise<{ error: string | null }> {
  // #4459: sticky — new bookings never add them back; restoreParticipant lifts it.
  const { error } = await supabase.rpc("issue_4459_remove_brand_guest", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  return { error: error ? brandGuestErrorCopy(error) : null };
}

export async function restoreParticipant(
  conversationId: string,
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("issue_4459_restore_brand_guest", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  return { error: error ? brandGuestErrorCopy(error) : null };
}

export async function deleteMessage(
  messageId: string,
): Promise<{ error: string | null }> {
  // #4459: the #4456 unsend path; guests see "Message removed by <Brand>".
  const { error } = await supabase.rpc("unsend_messages", { p_message_ids: [messageId] });
  return { error: error ? brandGuestErrorCopy(error) : null };
}
