/** Issue #3355 — quality feedback for one authenticated Ari reply. */

import { supabase } from "./supabase";

export type AriFeedbackReason =
  "inaccurate" | "missed_request" | "hard_to_use" | "unsafe" | "other";

export async function submitAriMessageFeedback(input: {
  messageId: string;
  sentiment: "positive" | "negative";
  reasonCode?: AriFeedbackReason | null;
  comment?: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{
    accepted?: boolean;
    code?: string;
  }>("ari-message-feedback", {
    body: {
      message_id: input.messageId,
      sentiment: input.sentiment,
      reason_code: input.reasonCode ?? null,
      comment: input.comment ?? "",
    },
  });
  if (error || !data?.accepted)
    throw new Error(data?.code ?? "FEEDBACK_UNAVAILABLE");
}
