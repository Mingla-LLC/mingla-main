import { supabase } from "./supabase";
import type { BrandGroupMentionCandidate } from "../utils/brandGroupMentions";

export interface BrandGroupMember {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
}

/** Route-scoped access-checked candidates for the Brand-group composer. */
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
    error: error ? error.message || "Couldn't load Brand group teammates" : null,
  };
}

/** #4173 route-scoped roster read; kept out of the eager shared web chunk. */
export async function listBrandGroupMembers(
  conversationId: string,
): Promise<{ members: BrandGroupMember[]; error: string | null }> {
  const { data, error } = await supabase.rpc("issue_4173_list_brand_group_members", {
    p_conversation_id: conversationId,
  });
  return {
    members: (data ?? []) as BrandGroupMember[],
    error: error ? error.message || "Couldn't load Brand group teammates" : null,
  };
}
