import { supabase } from "./supabase";
import type { BrandGroupMentionCandidate } from "../utils/brandGroupMentions";

export interface BrandGroupSummary {
  conversation_id: string;
  brand_id: string;
  brand_name: string;
  brand_slug: string;
  brand_photo_url: string | null;
  last_message_at: string | null;
  last_message_preview: string;
  unread_count: number;
  member_count: number;
  access_kind: "brand" | "support";
  push_enabled: boolean;
  muted: boolean;
}

export interface BrandGroupMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
  reply_to_id: string | null;
  related_message_ids: string[];
  sender_display_name: string;
  sender_role: string | null;
  reply_content: string | null;
  reply_sender_display_name: string | null;
  message_type: "text" | "image" | "video" | "file";
  file_id: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime: string | null;
}

function errorMessage(error: { message?: string } | null, fallback: string): string | null {
  return error ? error.message || fallback : null;
}

export async function listBrandGroups(): Promise<{
  groups: BrandGroupSummary[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("issue_3720_list_brand_groups");
  return {
    groups: ((data ?? []) as BrandGroupSummary[]).map((group) => ({
      ...group,
      unread_count: Number(group.unread_count || 0),
      member_count: Number(group.member_count || 0),
    })),
    error: errorMessage(error, "Couldn't load Brand groups"),
  };
}

export async function listBrandGroupMessages(
  conversationId: string,
  before: string | null = null,
): Promise<{ messages: BrandGroupMessage[]; error: string | null }> {
  const { data, error } = await supabase.rpc("issue_3720_list_brand_group_messages", {
    p_conversation_id: conversationId,
    p_limit: 120,
    p_before: before,
  });
  return {
    messages: ((data ?? []) as BrandGroupMessage[]).slice().reverse(),
    error: errorMessage(error, "Couldn't load this Brand group"),
  };
}

export async function markBrandGroupRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("issue_3720_mark_brand_group_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message || "Couldn't mark the Brand group read");
}

export async function setBrandGroupWatch(
  conversationId: string,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("issue_3720_set_brand_group_watch", {
    p_conversation_id: conversationId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message || "Couldn't update Brand group notifications");
  return data === true;
}

export async function setBrandGroupMuted(
  conversationId: string,
  muted: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("issue_3988_set_brand_group_muted", {
    p_conversation_id: conversationId,
    p_muted: muted,
  });
  if (error) throw new Error(error.message || "Couldn't update Brand group notifications");
  return data === true;
}

export async function getBrandGroupPushPrefEnabled(
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("notification_channel_prefs")
    .select("enabled")
    .eq("user_id", userId)
    .eq("category_key", "business.brand_group_message")
    .eq("channel", "push")
    .maybeSingle();
  if (error) throw new Error(error.message || "Couldn't load Brand group notifications");
  return data == null ? true : Boolean((data as { enabled: boolean }).enabled);
}

export async function setBrandGroupPushPrefEnabled(
  userId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("notification_channel_prefs")
    .upsert({
      user_id: userId,
      category_key: "business.brand_group_message",
      channel: "push",
      enabled,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(error.message || "Couldn't save Brand group notifications");
}

export async function listBrandGroupMentionCandidates(
  conversationId: string,
  query: string,
): Promise<{ candidates: BrandGroupMentionCandidate[]; error: string | null }> {
  const { data, error } = await supabase.rpc("issue_3988_list_brand_group_mention_candidates", {
    p_conversation_id: conversationId,
    p_query: query,
    p_limit: 4,
  });
  return {
    candidates: (data ?? []) as BrandGroupMentionCandidate[],
    error: errorMessage(error, "Couldn't load Brand group teammates"),
  };
}

export async function sendBrandGroupMessage(input: {
  conversationId: string;
  content: string;
  replyToId?: string | null;
  relatedMessageIds?: string[];
  mentionedUserIds?: string[];
  actorMode: "brand" | "support";
}): Promise<string> {
  const { data, error } = await supabase.rpc("issue_3720_send_brand_group_message", {
    p_conversation_id: input.conversationId,
    p_content: input.content,
    p_reply_to_id: input.replyToId ?? null,
    p_related_message_ids: input.relatedMessageIds ?? [],
    p_mentioned_user_ids: input.mentionedUserIds ?? [],
    p_actor_mode: input.actorMode,
  });
  if (error) throw new Error(error.message || "Couldn't send the message");
  return String(data);
}

export async function createBrandMessageProductSignal(input: {
  clientRequestId: string;
  sourceId: string;
  signalKind: "question" | "account" | "bug" | "feature" | "trust_safety";
  title: string;
  problemStatement: string;
  productArea: string;
  userJourney: string;
  impactSummary: string;
  affectedPeople: number;
  priority: "low" | "normal" | "high" | "urgent";
  nextUpdateAt: string;
  nextStep: string;
  customerReplyDraft: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("issue_3720_create_brand_message_product_signal", {
    p_client_request_id: input.clientRequestId,
    p_source_id: input.sourceId,
    p_signal_kind: input.signalKind,
    p_title: input.title,
    p_problem_statement: input.problemStatement,
    p_product_area: input.productArea,
    p_user_journey: input.userJourney,
    p_impact_summary: input.impactSummary,
    p_affected_people: input.affectedPeople,
    p_priority: input.priority,
    p_next_update_at: input.nextUpdateAt,
    p_next_step: input.nextStep,
    p_customer_reply_draft: input.customerReplyDraft,
  });
  if (error) throw new Error(error.message || "Couldn't create the Product signal");
  return String(data);
}
