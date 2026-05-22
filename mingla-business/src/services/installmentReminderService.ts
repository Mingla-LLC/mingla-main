import { supabase } from "./supabase";

export interface InstallmentReminderResult {
  ok: boolean;
  deliveredVia?: ("email" | "push")[];
  error?: string;
}

export interface RecentInstallmentReminder {
  id: string;
  orderId: string;
  sentAt: string;
}

export async function sendInstallmentReminder(input: {
  orderId: string;
}): Promise<InstallmentReminderResult> {
  const { data, error } = await supabase.functions.invoke<InstallmentReminderResult>(
    "send-installment-reminder",
    { body: { orderId: input.orderId } },
  );

  if (error !== null) {
    throw new Error(`send-installment-reminder failed: ${error.message}`);
  }
  if (data === null) {
    throw new Error("send-installment-reminder returned no data");
  }
  return data;
}

export async function fetchRecentReminderForOrder(
  orderId: string,
): Promise<RecentInstallmentReminder | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("manual_buyer_reminders")
    .select("id, order_id, sent_at")
    .eq("order_id", orderId)
    .gt("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`fetchRecentReminderForOrder failed: ${error.message}`);
  }
  if (data === null) return null;
  const row = data as { id: string; order_id: string; sent_at: string };
  return {
    id: row.id,
    orderId: row.order_id,
    sentAt: row.sent_at,
  };
}
