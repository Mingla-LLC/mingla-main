/**
 * #4420 — the wiring behind "Talk to a person" (spec part 2, 4.6).
 *
 * The logic is in components/support/supportHandover.ts (pure, tested); this
 * file connects it to the EXISTING paths, unchanged:
 *   - open conversation: listOwnSupportTickets (status new | open | pending)
 *   - new conversation: createSupportTicket (issue_4382_create_customer_ticket)
 *   - photos: agent-attachments `copy_to_support` (server-side copy)
 *   - message: sendSupportMessage (`support-send`, as the requester)
 *   - already handed over? the host's own newest messages in the conversation,
 *     read before sending into a conversation that existed (#4420 rework 3)
 *
 * Reached only through the support chunk (supportScreens.ts), never at boot.
 */

import { supabase } from "./supabase";
import {
  createSupportTicket,
  getOwnSupportTicket,
  listOwnSupportTickets,
  sendSupportMessage,
} from "./supportService";
import { hostSupportClientMeta } from "../components/support/supportClientMeta";
import { isOpenSupportStatus } from "../components/support/helpSupportRoute";
import { createSupportRequestId, supportCopy } from "../components/support/supportRequestModel";
import {
  HandoverError,
  asCopyRefusalCode,
  photoReasonKey,
  runSupportHandover,
  type CopyPhotoResult,
  type HandOverPayload,
  type HandoverOutcome,
  type HandoverProgress,
  type HandoverThreadMessage,
} from "../components/support/supportHandover";

/** Where a hand-over conversation says it came from (stored in client_meta). */
export const HANDOVER_SOURCE_SCREEN = "account/support#ari";

/** How many of the host's newest messages the duplicate check reads. */
const HANDOVER_CHECK_MESSAGES = 50;

interface FunctionErrorLike {
  context?: { json?: () => Promise<unknown> };
}

async function copyPhotoToSupport(ariAttachmentId: string, ticketId: string): Promise<CopyPhotoResult> {
  const { data, error } = await supabase.functions.invoke<{ support_attachment_id?: unknown; code?: unknown }>(
    "agent-attachments",
    { body: { action: "copy_to_support", attachment_id: ariAttachmentId, ticket_id: ticketId } },
  );
  if (error) {
    let code: unknown = null;
    const context = (error as FunctionErrorLike).context;
    if (typeof context?.json === "function") {
      try {
        const body = (await context.json()) as { code?: unknown } | null;
        code = body?.code ?? null;
      } catch {
        // Not JSON: treated as a network failure below.
      }
    }
    return { ok: false, code: asCopyRefusalCode(code) };
  }
  const id = data?.support_attachment_id;
  return typeof id === "string" && id.length > 0
    ? { ok: true, supportAttachmentId: id }
    : { ok: false, code: asCopyRefusalCode(data?.code) };
}

/**
 * Hand the payload over. `previous` is the progress a failed attempt
 * returned (HandoverError.progress), so a retry never sends anything twice.
 */
export async function handOverToSupport(input: {
  userId: string;
  brandId: string | null;
  payload: HandOverPayload;
  previous: HandoverProgress | null;
}): Promise<HandoverOutcome> {
  return runSupportHandover(
    input.payload,
    {
      findOpenConversation: async () => {
        const tickets = await listOwnSupportTickets(input.userId);
        // Newest activity first (the list's order); only the host's own.
        const open = tickets.find(
          (ticket) => ticket.requester_user_id === input.userId && isOpenSupportStatus(ticket.status),
        );
        return open?.id ?? null;
      },
      createConversation: ({ clientRequestId, subject, message }) =>
        createSupportTicket({
          clientRequestId,
          topic: "other",
          summary: subject,
          details: message,
          attachmentIds: [],
          clientMeta: hostSupportClientMeta(HANDOVER_SOURCE_SCREEN),
          brandId: input.brandId,
        }),
      copyPhoto: copyPhotoToSupport,
      send: async (ticketId, content, attachmentIds) => {
        await sendSupportMessage(ticketId, content, { attachmentIds, actorMode: "requester" });
      },
      newRequestId: createSupportRequestId,
      userId: input.userId,
      readThread: async (ticketId) => {
        const ticket = await getOwnSupportTicket(ticketId);
        if (ticket === null) throw new Error("support conversation not found");
        // The host's own newest messages there: a hand-over made before a
        // reload is among them however long the conversation is.
        const { data, error } = await supabase
          .from("messages")
          .select("sender_id, content, created_at, is_internal")
          .eq("conversation_id", ticket.conversation_id)
          .eq("sender_id", input.userId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(HANDOVER_CHECK_MESSAGES);
        if (error) throw new Error(error.message);
        return (data ?? []) as HandoverThreadMessage[];
      },
    },
    {
      fromAri: (text) => supportCopy("handover.from_ari", { text }),
      photoOnlySubject: supportCopy("handover.photo_only_subject"),
      photoOnlyMessage: supportCopy("handover.photo_only_message"),
    },
    input.previous,
  );
}

/** The plain lines the Support column shows after a hand-over (may be none). */
export function handoverNotices(outcome: Pick<HandoverOutcome, "photoFailures" | "skippedFiles">): string[] {
  const notices: string[] = [];
  const failures = outcome.photoFailures;
  if (failures.length > 0) {
    const lead =
      failures.length === 1
        ? supportCopy("handover.photo_not_sent")
        : supportCopy("handover.photos_not_sent", { count: failures.length });
    const reasons = [...new Set(failures.map((failure) => photoReasonKey(failure.code)))];
    notices.push([lead, ...reasons.map((key) => supportCopy(`handover.reason_${key}`))].join(" "));
  }
  if (outcome.skippedFiles > 0) notices.push(supportCopy("handover.files_skipped"));
  return notices;
}

/** The inline error when nothing could be handed over (stays on Ari, with Retry). */
export function handoverFailureMessage(error: unknown): string {
  if (error instanceof HandoverError && error.stage === "send" && error.progress.textDelivered) {
    return supportCopy("handover.photos_failed");
  }
  return supportCopy("handover.failed");
}

export { HandoverError };
