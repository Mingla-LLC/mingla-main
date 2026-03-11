import { supabase } from "./supabase";

export interface PendingFriendLinkIntent {
  id: string;
  inviterId: string;
  phoneE164: string;
  personId: string | null;
  status: "pending" | "converted" | "cancelled";
  convertedLinkId: string | null;
  convertedAt: string | null;
  createdAt: string;
}

export async function getPendingFriendLinkIntents(
  userId: string
): Promise<PendingFriendLinkIntent[]> {
  const { data, error } = await supabase
    .from("pending_friend_link_intents")
    .select("*")
    .eq("inviter_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    id: row.id,
    inviterId: row.inviter_id,
    phoneE164: row.phone_e164,
    personId: row.person_id,
    status: row.status,
    convertedLinkId: row.converted_link_id,
    convertedAt: row.converted_at,
    createdAt: row.created_at,
  }));
}

export async function cancelFriendLinkIntent(intentId: string): Promise<void> {
  const { error } = await supabase
    .from("pending_friend_link_intents")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", intentId);

  if (error) throw new Error(error.message);
}
