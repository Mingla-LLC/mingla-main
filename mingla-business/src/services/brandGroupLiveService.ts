/**
 * #4304 part 2 — reactions and seen-by for Brand groups.
 *
 * Reactions live in public.direct_message_reactions (the Explorer chats'
 * table, already in the realtime publication); 20280426004304 scopes them to
 * people who can read the Brand group. Seen-by reads the real per-person read
 * pointers through issue_4304_list_brand_group_read_state. Services throw on
 * error; the hook surfaces it.
 */
import { supabase } from "./supabase";
import type {
  BrandGroupReactionRow,
  BrandGroupReadState,
} from "../utils/brandGroupThreadModel";

export async function listBrandGroupReactions(
  messageIds: readonly string[],
): Promise<BrandGroupReactionRow[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from("direct_message_reactions")
    .select("id, message_id, user_id, emoji")
    .in("message_id", [...messageIds]);
  if (error) throw new Error(error.message || "Couldn't load reactions");
  return (data ?? []) as BrandGroupReactionRow[];
}

export async function addBrandGroupReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<BrandGroupReactionRow> {
  const { data, error } = await supabase
    .from("direct_message_reactions")
    .insert({ message_id: input.messageId, user_id: input.userId, emoji: input.emoji })
    .select("id, message_id, user_id, emoji")
    .single();
  if (error) throw new Error(error.message || "Couldn't add the reaction");
  return data as BrandGroupReactionRow;
}

export async function removeBrandGroupReaction(rowId: string): Promise<void> {
  const { error } = await supabase
    .from("direct_message_reactions")
    .delete()
    .eq("id", rowId);
  if (error) throw new Error(error.message || "Couldn't remove the reaction");
}

export async function listBrandGroupReadState(
  conversationId: string,
): Promise<BrandGroupReadState[]> {
  const { data, error } = await supabase.rpc("issue_4304_list_brand_group_read_state", {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message || "Couldn't load who has seen this");
  return (data ?? []) as BrandGroupReadState[];
}
