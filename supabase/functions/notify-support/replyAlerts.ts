/**
 * #3988 — a Host reply on a support ticket becomes one outbox row per
 * recipient through issue_3988_enqueue_support_reply_alerts. The database
 * picks the recipients (Support roster + assignee, minus the sender) and the
 * push audience (available roster + assignee). The idempotency key is per
 * message and recipient, so a retried call never sends twice.
 *
 * Pure module (no Deno.serve / env reads) so the Deno suite can import it.
 */

export interface ReplyAlertsClient {
  rpc(
    fn: "issue_3988_enqueue_support_reply_alerts",
    args: {
      p_ticket_id: string;
      p_message_id: string;
      p_sender_user_id: string | null;
    },
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export type ReplyAlertsResult =
  | { ok: true; count: number }
  | { ok: false; reason: "message_id_missing" | "enqueue_failed" };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function enqueueReplyAlerts(
  admin: ReplyAlertsClient,
  input: { ticketId: string; messageId: string | null; senderUserId: string | null },
): Promise<ReplyAlertsResult> {
  if (!input.messageId || !UUID.test(input.messageId)) {
    return { ok: false, reason: "message_id_missing" };
  }
  try {
    const { data, error } = await admin.rpc(
      "issue_3988_enqueue_support_reply_alerts",
      {
        p_ticket_id: input.ticketId,
        p_message_id: input.messageId,
        p_sender_user_id: input.senderUserId,
      },
    );
    if (error || typeof data !== "number") {
      console.error("[notify-support] reply alert enqueue failed", {
        ticket_id: input.ticketId,
        code: (error as { code?: unknown } | null)?.code ?? null,
      });
      return { ok: false, reason: "enqueue_failed" };
    }
    return { ok: true, count: data };
  } catch (err) {
    console.error("[notify-support] reply alert enqueue threw", {
      ticket_id: input.ticketId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "enqueue_failed" };
  }
}
