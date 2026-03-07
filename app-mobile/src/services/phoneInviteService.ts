import { supabase, supabaseUrl } from "./supabase";
import {
  PendingInvite,
  SendPhoneInviteResponse,
} from "../types/phoneInvite";

async function getAuthToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

export async function sendPhoneInvite(
  phone_e164: string
): Promise<SendPhoneInviteResponse> {
  const token = await getAuthToken();

  const response = await fetch(
    `${supabaseUrl}/functions/v1/send-phone-invite`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ phone_e164 }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    let errorMsg = "Failed to send invite";
    try {
      const parsed = JSON.parse(text);
      errorMsg = parsed.error || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }

  return response.json();
}

function mapPendingInvite(row: any): PendingInvite {
  return {
    id: row.id,
    inviterId: row.inviter_id,
    phoneE164: row.phone_e164,
    status: row.status,
    convertedUserId: row.converted_user_id ?? null,
    convertedAt: row.converted_at ?? null,
    createdAt: row.created_at,
  };
}

export async function getPendingPhoneInvites(
  userId: string
): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from("pending_invites")
    .select("*")
    .eq("inviter_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPendingInvite);
}
