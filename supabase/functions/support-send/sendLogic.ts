/**
 * #4382 — support-send request parsing and error mapping (pure, no I/O).
 *
 * The database function issue_4382_post_support_message owns the rules
 * (attachments belong to this ticket and sender, a customer reply reopens a
 * Waiting or Resolved ticket, a closed ticket refuses replies, internal notes
 * and "Send and wait" are staff only). This module only shapes the request
 * and turns database refusals into clear HTTP answers.
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_ATTACHMENTS = 11; // 10 images + 1 voice note
export const MAX_CONTENT = 8000;

export type ActorMode = "staff" | "requester" | null;

export interface SendRequest {
  ticketId: string;
  content: string;
  attachmentIds: string[];
  isInternal: boolean;
  actorMode: ActorMode;
  setWaiting: { nextUpdateAt: string; note: string } | null;
}

export type ParseResult =
  | { ok: true; value: SendRequest }
  | { ok: false; status: number; error: string };

function bad(error: string, status = 400): ParseResult {
  return { ok: false, status, error };
}

export function parseSendRequest(
  body: unknown,
  nowMs = Date.now(),
): ParseResult {
  if (!body || typeof body !== "object") return bad("bad_request");
  const b = body as Record<string, unknown>;
  if (typeof b.ticketId !== "string" || !UUID_RE.test(b.ticketId)) {
    return bad("ticketId_required");
  }
  const content = typeof b.content === "string" ? b.content.trim() : "";
  if (content.length > MAX_CONTENT) return bad("content_too_long");

  let attachmentIds: string[] = [];
  if (b.attachmentIds !== undefined) {
    if (!Array.isArray(b.attachmentIds)) return bad("attachmentIds_invalid");
    const unique = new Set<string>();
    for (const id of b.attachmentIds) {
      if (typeof id !== "string" || !UUID_RE.test(id)) {
        return bad("attachmentIds_invalid");
      }
      unique.add(id.toLowerCase());
    }
    attachmentIds = [...unique];
    if (attachmentIds.length > MAX_ATTACHMENTS) {
      return bad("too_many_attachments");
    }
  }
  // A message may be images only.
  if (content.length === 0 && attachmentIds.length === 0) {
    return bad("content_required");
  }

  if (b.isInternal !== undefined && typeof b.isInternal !== "boolean") {
    return bad("isInternal_invalid");
  }
  const isInternal = b.isInternal === true;

  let actorMode: ActorMode = null;
  if (b.actorMode !== undefined) {
    if (b.actorMode !== "staff" && b.actorMode !== "requester") {
      return bad("invalid_actor_mode");
    }
    actorMode = b.actorMode;
  }

  let setWaiting: SendRequest["setWaiting"] = null;
  if (b.setWaiting !== undefined && b.setWaiting !== null) {
    const w = b.setWaiting as Record<string, unknown>;
    const at = typeof w?.nextUpdateAt === "string"
      ? Date.parse(w.nextUpdateAt)
      : NaN;
    const note = typeof w?.note === "string" ? w.note.trim() : "";
    if (!Number.isFinite(at) || at <= nowMs) {
      return bad("next_update_must_be_future");
    }
    if (note.length === 0) return bad("next_update_note_required");
    if (isInternal) return bad("wait_needs_a_customer_reply");
    setWaiting = {
      nextUpdateAt: new Date(at).toISOString(),
      note: note.slice(0, 500),
    };
  }

  return {
    ok: true,
    value: {
      ticketId: b.ticketId,
      content,
      attachmentIds,
      isInternal,
      actorMode,
      setWaiting,
    },
  };
}

/** Staff-only options asked for by someone sending as the customer. */
export function staffOnlyViolation(
  req: SendRequest,
  senderIsStaff: boolean,
): string | null {
  if (senderIsStaff) return null;
  if (req.isInternal) return "internal_notes_are_staff_only";
  if (req.setWaiting) return "send_and_wait_is_staff_only";
  return null;
}

/** Map a database refusal to an HTTP status and a stable error code. */
export function mapPostError(
  error: { code?: string | null; message?: string | null } | null,
): { status: number; error: string } {
  const code = error?.code ?? "";
  const message = (error?.message ?? "send_failed").trim() || "send_failed";
  if (code === "PT409") return { status: 409, error: message };
  if (code === "42501") return { status: 403, error: message };
  if (code === "P0002") return { status: 404, error: message };
  if (code === "22023") return { status: 400, error: message };
  return { status: 500, error: "send_failed" };
}

/** Plain words for the closed refusal; every surface shows the same thing. */
export const TICKET_CLOSED_MESSAGE =
  "This request is closed. Start a new request and we will pick it up.";
