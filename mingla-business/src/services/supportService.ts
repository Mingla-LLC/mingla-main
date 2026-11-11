/**
 * supportService — the Host app's side of a support request (#4382 Wave 4,
 * built on META-ORCH-1104 and #3720).
 *
 * A request is a support_tickets row that owns a conversation. This service
 * creates it through issue_4382_create_customer_ticket (topic, summary,
 * details, screenshots, brand, client_meta), uploads screenshots through
 * issue_4382_register_support_attachment and the private
 * `support-attachments` bucket, reads the thread (messages, internal notes
 * for staff, attachments) and sends through the `support-send` edge
 * function, which owns timestamps, audit, reopen-on-reply and pushes.
 *
 * Reads and writes THROW on failure (Prime Directive #5); the React Query
 * hooks and screens surface the error.
 */

import { supabase } from "./supabase";
import {
  SUPPORT_ATTACHMENTS_BUCKET,
  SUPPORT_SIGNED_URL_SECONDS,
  MAX_SUPPORT_IMAGE_BYTES,
  buildHostCreateTicketArgs,
  keepOwnTickets,
  supportImageMime,
  type HostCreateTicketInput,
  type SupportPickedImage,
} from "../components/support/supportRequestModel";

const SUPPORT_TICKET_FIELDS =
  "id,ticket_number,subject,topic,status,priority,conversation_id,brand_id,requester_user_id,requester_segment,origin,visibility,created_at,last_message_at,last_sender_kind,resolved_at,next_update_at,next_update_note";

/** A support ticket as the requester (or staff, through RLS) sees it. */
export interface SupportTicket {
  id: string;
  ticket_number: number | null;
  subject: string;
  topic: string | null;
  /** new | open | pending | resolved | closed (support_tickets.status CHECK). */
  status: string;
  /** low | normal | high | urgent (support_tickets.priority CHECK). */
  priority: string;
  conversation_id: string;
  brand_id: string | null;
  requester_user_id: string | null;
  requester_segment: string | null;
  origin: "customer" | "staff" | null;
  /** internal | person | brand. */
  visibility: "internal" | "person" | "brand" | null;
  created_at: string;
  last_message_at: string;
  last_sender_kind: "customer" | "staff" | null;
  resolved_at: string | null;
  next_update_at: string | null;
  next_update_note: string | null;
}

/**
 * The signed-in person's OWN requests, newest activity first. RLS also lets
 * support staff read every ticket, so the requester filter here is what keeps
 * a host who is also on the Mingla team from seeing the whole queue.
 */
export async function listOwnSupportTickets(userId: string): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select(SUPPORT_TICKET_FIELDS)
    .eq("requester_user_id", userId)
    .neq("visibility", "internal")
    .order("last_message_at", { ascending: false });
  if (error) throw new Error(error.message);
  return keepOwnTickets((data ?? []) as SupportTicket[], userId);
}

/**
 * Read one ticket the caller may see. Returns null when the row is absent or
 * RLS hides it (a foreign / deep-linked id) so the screen shows not-found.
 */
export async function getOwnSupportTicket(ticketId: string): Promise<SupportTicket | null> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select(SUPPORT_TICKET_FIELDS)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SupportTicket | null) ?? null;
}

// ── Attachments ────────────────────────────────────────────────────────────

export interface SupportAttachment {
  id: string;
  message_id: string | null;
  storage_path: string;
  kind: "image" | "audio";
  mime: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  is_internal: boolean;
}

export class SupportUploadError extends Error {
  constructor(
    readonly code: "wrong_type" | "too_large" | "upload_failed" | "register_failed",
    message: string,
  ) {
    super(message);
    this.name = "SupportUploadError";
  }
}

interface RegisteredAttachment {
  attachment_id: string;
  bucket: string;
  storage_path: string;
}

/**
 * Register then upload one screenshot. `ticketOrDraftId` is the ticket id, or
 * — before the ticket exists — the create call's client request id.
 * Returns the attachment id to pass to the create or send call.
 */
export async function uploadSupportImage(
  ticketOrDraftId: string,
  image: SupportPickedImage,
  options: { isInternal?: boolean } = {},
): Promise<string> {
  const mime = supportImageMime(image.mimeType, image.name);
  if (mime === null) {
    throw new SupportUploadError("wrong_type", "Only PNG, JPEG, WebP or HEIC images can be added.");
  }
  const bytes = typeof image.size === "number" && image.size > 0
    ? image.size
    : image.webFile?.size ?? null;
  if (bytes === null) {
    throw new SupportUploadError("upload_failed", "We couldn't read that image. Try another.");
  }
  if (bytes > MAX_SUPPORT_IMAGE_BYTES) {
    throw new SupportUploadError("too_large", "Images can be up to 10 MB each.");
  }

  const { data, error } = await supabase.rpc("issue_4382_register_support_attachment", {
    p_ticket_id: ticketOrDraftId,
    p_kind: "image",
    p_mime: mime,
    p_bytes: bytes,
    p_width: typeof image.width === "number" && image.width > 0 ? Math.round(image.width) : null,
    p_height: typeof image.height === "number" && image.height > 0 ? Math.round(image.height) : null,
    p_duration_ms: null,
    p_is_internal: options.isInternal === true,
  });
  if (error) throw new SupportUploadError("register_failed", error.message);
  const registered = data as RegisteredAttachment | null;
  if (!registered?.attachment_id || !registered.storage_path) {
    throw new SupportUploadError("register_failed", "We couldn't prepare that image.");
  }

  // Browser builds upload the File; native builds the local file URI.
  const body: File | FormData = image.webFile ?? (() => {
    const form = new FormData();
    form.append("file", { uri: image.uri, type: mime, name: image.name } as unknown as Blob);
    return form;
  })();
  const { error: uploadError } = await supabase.storage
    .from(registered.bucket || SUPPORT_ATTACHMENTS_BUCKET)
    .upload(registered.storage_path, body, { contentType: mime, upsert: false });
  if (uploadError) {
    throw new SupportUploadError("upload_failed", `Upload failed: ${uploadError.message}`);
  }
  return registered.attachment_id;
}

/** One-hour signed links for attachments, keyed by storage path. */
export async function signSupportAttachments(paths: readonly string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .createSignedUrls([...paths], SUPPORT_SIGNED_URL_SECONDS);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
  }
  return out;
}

// ── Create ─────────────────────────────────────────────────────────────────

/**
 * Create a Host request through issue_4382_create_customer_ticket. The
 * client request id doubles as the ticket id, so a retry after a dropped
 * response returns the same ticket instead of a second one.
 */
export async function createHostSupportTicket(input: HostCreateTicketInput): Promise<string> {
  const args = buildHostCreateTicketArgs(input);
  if (args.p_subject.length === 0) throw new Error("Add a short summary so we know what it's about.");
  if (args.p_message.length === 0 && args.p_attachment_ids.length === 0) {
    throw new Error("Tell us what happened.");
  }
  const { data, error } = await supabase.rpc("issue_4382_create_customer_ticket", args);
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("We couldn't send your request. Try again.");
  }
  return data;
}

/**
 * @deprecated #3720 — staff delivery is enqueued by the create function.
 * Kept as a no-op for older callers.
 */
export async function notifyNewSupportTicket(_ticketId: string): Promise<void> {
  return;
}

// ── Thread ─────────────────────────────────────────────────────────────────

export interface SupportThreadMessage {
  id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
  is_internal: boolean;
  sender_display_name_snapshot: string | null;
  sender_role_snapshot: string | null;
  attachments: SupportAttachment[];
}

/**
 * The thread: messages oldest first with their attachments. RLS hides
 * internal notes and internal attachments from customers; staff see both.
 */
export async function listSupportThread(ticket: Pick<SupportTicket, "id" | "conversation_id">): Promise<SupportThreadMessage[]> {
  const [messagesResult, attachmentsResult] = await Promise.all([
    supabase
      .from("messages")
      .select("id, sender_id, content, created_at, is_internal, sender_display_name_snapshot, sender_role_snapshot")
      .eq("conversation_id", ticket.conversation_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("support_attachments")
      .select("id, message_id, storage_path, kind, mime, width, height, duration_ms, is_internal")
      .eq("ticket_id", ticket.id)
      .not("message_id", "is", null)
      .order("created_at", { ascending: true }),
  ]);
  if (messagesResult.error) throw new Error(messagesResult.error.message);
  if (attachmentsResult.error) throw new Error(attachmentsResult.error.message);
  const byMessage = new Map<string, SupportAttachment[]>();
  for (const attachment of (attachmentsResult.data ?? []) as SupportAttachment[]) {
    if (!attachment.message_id) continue;
    const list = byMessage.get(attachment.message_id) ?? [];
    list.push(attachment);
    byMessage.set(attachment.message_id, list);
  }
  return ((messagesResult.data ?? []) as Omit<SupportThreadMessage, "attachments">[]).map((message) => ({
    ...message,
    is_internal: message.is_internal === true,
    content: message.content ?? "",
    attachments: byMessage.get(message.id) ?? [],
  }));
}

export class SupportSendError extends Error {
  constructor(readonly code: "ticket_closed" | "forbidden" | "failed", message: string) {
    super(message);
    this.name = "SupportSendError";
  }
}

export interface SupportSendResult {
  messageId: string | null;
  status: string | null;
  reopened: boolean;
}

interface FunctionErrorLike {
  message?: string;
  context?: { status?: number; json?: () => Promise<unknown> };
}

async function readSendError(error: FunctionErrorLike): Promise<SupportSendError> {
  const status = typeof error.context?.status === "number" ? error.context.status : null;
  let code: string | null = null;
  let message: string | null = null;
  if (typeof error.context?.json === "function") {
    try {
      const body = (await error.context.json()) as { error?: unknown; message?: unknown } | null;
      if (body && typeof body.error === "string") code = body.error;
      if (body && typeof body.message === "string") message = body.message;
    } catch {
      // The body was not JSON; fall back to the status below.
    }
  }
  if (code === "ticket_closed" || status === 409) {
    return new SupportSendError(
      "ticket_closed",
      message ?? "This request is closed. Start a new request and we'll pick it up.",
    );
  }
  if (status === 403) return new SupportSendError("forbidden", "You can't reply to this request.");
  return new SupportSendError("failed", code ?? error.message ?? "We couldn't send your message. Try again.");
}

/**
 * Send through `support-send`. A message may be text, screenshots or both.
 * `actorMode` says which composer this is: the requester's, or the staff
 * console's (where `isInternal` adds an internal note).
 */
export async function sendSupportMessage(
  ticketId: string,
  content: string,
  options: {
    attachmentIds?: readonly string[];
    actorMode?: "requester" | "staff";
    isInternal?: boolean;
  } = {},
): Promise<SupportSendResult> {
  const trimmed = content.trim();
  const attachmentIds = [...(options.attachmentIds ?? [])];
  if (trimmed.length === 0 && attachmentIds.length === 0) {
    throw new Error("Write a message before sending.");
  }
  const actorMode = options.actorMode ?? "requester";
  const body: Record<string, unknown> = { ticketId, content: trimmed, actorMode };
  if (attachmentIds.length > 0) body.attachmentIds = attachmentIds;
  if (actorMode === "staff" && options.isInternal === true) body.isInternal = true;

  const { data, error } = await supabase.functions.invoke("support-send", { body });
  if (error) throw await readSendError(error as FunctionErrorLike);
  if (data && typeof data === "object" && "error" in data) {
    const errVal = (data as { error?: unknown }).error;
    throw new SupportSendError(
      errVal === "ticket_closed" ? "ticket_closed" : "failed",
      typeof errVal === "string" ? errVal : "We couldn't send your message.",
    );
  }
  const result = (data ?? {}) as { message_id?: unknown; status?: unknown; reopened?: unknown };
  return {
    messageId: typeof result.message_id === "string" ? result.message_id : null,
    status: typeof result.status === "string" ? result.status : null,
    reopened: result.reopened === true,
  };
}
