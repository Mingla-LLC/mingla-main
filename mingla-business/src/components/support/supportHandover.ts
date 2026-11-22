/**
 * #4420 — "Talk to a person": hand the host's last question to Ari, and the
 * photos sent with it, to their support conversation (spec part 2, 4.6).
 *
 * Pure: types and logic only. The wiring (support RPCs, `support-send`,
 * `agent-attachments` `copy_to_support`) is injected by
 * supportHandoverService.ts, so every step and every refusal is unit-tested.
 *
 * Nothing is sent twice: the caller keeps the returned progress and passes it
 * back on a retry, and (#4420 rework 3) before sending into a conversation
 * that already existed, its server thread is read for this question's
 * hand-over, so a reload or a new screen cannot send it again. The create call reuses its client request id (the RPC
 * returns the same conversation), copied photos are not copied again, and
 * text that already went out is not resent.
 */

/** Only the parts of an Ari message the hand-over reads (structural). */
export interface HandoverSourceMessage {
  role: string;
  content: unknown;
  /** The Ari message id and when it was asked (server time), when known. */
  id?: string;
  created_at?: string;
}

export interface HandOverPayload {
  /** What the host last typed to Ari, or null for a photo-only turn. */
  text: string | null;
  /** Ari attachment ids of the IMAGES in that turn (0..10). */
  ariImageIds: string[];
  /** Files in that turn that are not images; they stay with Ari. */
  skippedFiles: number;
  /** The Ari message this payload is (#4420 rework 3), when known. */
  ariMessageId?: string;
  /** When the host asked it (the Ari message's created_at), when known. */
  askedAt?: string;
}

const MAX_HANDOVER_IMAGES = 10;
const ATTACHMENT_COUNT_TEXT = /^\d+ attachments?$/;

function stringField(value: unknown, key: string): string | null {
  if (value === null || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

/**
 * The host's LAST user message in the Ari conversation. Ari's replies are not
 * carried. Returns null when the host has not asked Ari anything yet.
 */
export function handOverPayloadFromMessages(
  messages: readonly HandoverSourceMessage[],
): HandOverPayload | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const content = message.content;
    const rawAttachments =
      content !== null && typeof content === "object"
        ? (content as Record<string, unknown>).attachments
        : undefined;
    const attachments = Array.isArray(rawAttachments) ? rawAttachments : [];
    const imageIds: string[] = [];
    let skippedFiles = 0;
    for (const attachment of attachments) {
      const id = stringField(attachment, "id");
      if (id === null || id.length === 0) continue;
      if (stringField(attachment, "file_type") === "image" && imageIds.length < MAX_HANDOVER_IMAGES) {
        imageIds.push(id);
      } else {
        skippedFiles += 1;
      }
    }
    let text = stringField(content, "text")?.trim() ?? "";
    // A photo-only turn shows "1 attachment" in Ari; that is not the host's words.
    if (attachments.length > 0 && ATTACHMENT_COUNT_TEXT.test(text)) text = "";
    if (text.length === 0 && imageIds.length === 0 && skippedFiles === 0) continue;
    const payload: HandOverPayload = { text: text.length > 0 ? text : null, ariImageIds: imageIds, skippedFiles };
    if (typeof message.id === "string" && message.id.length > 0) payload.ariMessageId = message.id;
    if (typeof message.created_at === "string" && message.created_at.length > 0) payload.askedAt = message.created_at;
    return payload;
  }
  return null;
}

/** Codes `copy_to_support` returns (agent-attachments/copyToSupport.ts). */
export type CopyRefusalCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ATTACHMENT_NOT_READY"
  | "UNSUPPORTED_FOR_SUPPORT"
  | "FILE_TOO_LARGE"
  | "TICKET_CHECK_FAILED"
  | "TICKET_FORBIDDEN"
  | "TICKET_CLOSED"
  | "TOO_MANY_UPLOADS"
  | "REGISTER_FAILED"
  | "COPY_FAILED"
  | "ATTACHMENT_CHANGED"
  /** The call never reached the function, or answered without a code. */
  | "NETWORK";

export const COPY_REFUSAL_CODES: readonly CopyRefusalCode[] = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "FORBIDDEN",
  "ATTACHMENT_NOT_READY",
  "UNSUPPORTED_FOR_SUPPORT",
  "FILE_TOO_LARGE",
  "TICKET_CHECK_FAILED",
  "TICKET_FORBIDDEN",
  "TICKET_CLOSED",
  "TOO_MANY_UPLOADS",
  "REGISTER_FAILED",
  "COPY_FAILED",
  "ATTACHMENT_CHANGED",
  "NETWORK",
];

export function asCopyRefusalCode(value: unknown): CopyRefusalCode {
  return typeof value === "string" && (COPY_REFUSAL_CODES as readonly string[]).includes(value)
    ? (value as CopyRefusalCode)
    : "NETWORK";
}

/** The plain reason shown for a photo that could not be carried over. */
export type PhotoReasonKey = "type_or_size" | "not_ready" | "unavailable" | "too_many" | "closed" | "failed";

export function photoReasonKey(code: CopyRefusalCode): PhotoReasonKey {
  switch (code) {
    case "UNSUPPORTED_FOR_SUPPORT":
    case "FILE_TOO_LARGE":
      return "type_or_size";
    case "ATTACHMENT_NOT_READY":
      return "not_ready";
    case "NOT_FOUND":
    case "FORBIDDEN":
    case "TICKET_FORBIDDEN":
    case "ATTACHMENT_CHANGED":
      return "unavailable";
    case "TOO_MANY_UPLOADS":
      return "too_many";
    case "TICKET_CLOSED":
      return "closed";
    case "BAD_REQUEST":
    case "TICKET_CHECK_FAILED":
    case "REGISTER_FAILED":
    case "COPY_FAILED":
    case "NETWORK":
      return "failed";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

export type CopyPhotoResult =
  | { ok: true; supportAttachmentId: string }
  | { ok: false; code: CopyRefusalCode };

export interface HandoverDeps {
  /** The host's newest open conversation (new, open or pending), or null. */
  findOpenConversation: () => Promise<string | null>;
  /** The existing create path; idempotent on `clientRequestId`. */
  createConversation: (input: { clientRequestId: string; subject: string; message: string }) => Promise<string>;
  copyPhoto: (ariAttachmentId: string, ticketId: string) => Promise<CopyPhotoResult>;
  /** `support-send` as the requester. Throws when nothing was sent. */
  send: (ticketId: string, content: string, supportAttachmentIds: readonly string[]) => Promise<void>;
  newRequestId: () => string;
  /** The host handing over: only their own messages count as a hand-over. */
  userId: string;
  /**
   * #4420 rework 3: the conversation's own messages, read from the server, so
   * a hand-over already made (before a reload, or by a send whose answer was
   * lost) is found and not sent again. Throws when the thread cannot be read.
   */
  readThread: (ticketId: string) => Promise<readonly HandoverThreadMessage[]>;
}

/** Only the parts of a support message the duplicate check reads. */
export interface HandoverThreadMessage {
  sender_id: string | null;
  content: string;
  created_at: string;
  is_internal: boolean;
}

/**
 * #4420 rework 3 (QA P2-2): has this Ari question already been handed over
 * into this conversation? True when the host (`userId`) has a customer-visible
 * message there with exactly the hand-over words, sent at or after the Ari
 * message was asked. The server's thread is the truth, so it holds across a
 * reload and a new screen; a NEW Ari question (asked later) is not matched by
 * an older hand-over, even with the same words. With no askedAt known, any
 * earlier match counts (never a duplicate).
 */
export function threadHasHandover(
  thread: readonly HandoverThreadMessage[],
  input: { userId: string; words: string; askedAt?: string },
): boolean {
  const words = input.words.trim();
  if (words.length === 0) return false;
  const asked = input.askedAt ? Date.parse(input.askedAt) : Number.NaN;
  return thread.some((message) => {
    if (message.is_internal || message.sender_id !== input.userId) return false;
    if ((message.content ?? "").trim() !== words) return false;
    if (!Number.isFinite(asked)) return true;
    const sent = Date.parse(message.created_at);
    return Number.isFinite(sent) && sent >= asked;
  });
}

/** Words the hand-over adds so staff can see the conversation came from Ari. */
export interface HandoverWording {
  /** Wraps the host's text, e.g. "From my chat with Ari: {{text}}". */
  fromAri: (text: string) => string;
  /** Subject and first message when the host only sent Ari a photo. */
  photoOnlySubject: string;
  photoOnlyMessage: string;
}

export interface HandoverProgress {
  clientRequestId: string;
  ticketId: string | null;
  /** The host's words (or the photo-only line) are in the conversation. */
  textDelivered: boolean;
  /** Ari attachment id -> support attachment id, copied but maybe not sent. */
  copied: Record<string, string>;
  /** Support attachment ids already sent in a message. */
  sentPhotoIds: string[];
}

export function newHandoverProgress(requestId: string): HandoverProgress {
  return { clientRequestId: requestId, ticketId: null, textDelivered: false, copied: {}, sentPhotoIds: [] };
}

export interface HandoverOutcome {
  ticketId: string;
  createdConversation: boolean;
  /** This Ari question was already in the conversation: nothing was sent. */
  alreadyHandedOver: boolean;
  photosSent: number;
  photoFailures: { ariAttachmentId: string; code: CopyRefusalCode }[];
  skippedFiles: number;
  progress: HandoverProgress;
}

export class HandoverError extends Error {
  constructor(
    readonly stage: "find" | "check" | "create" | "send",
    readonly progress: HandoverProgress,
    message: string,
  ) {
    super(message);
    this.name = "HandoverError";
  }
}

const SUBJECT_MAX = 120;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "unknown";
}

export async function runSupportHandover(
  payload: HandOverPayload,
  deps: HandoverDeps,
  wording: HandoverWording,
  previous: HandoverProgress | null,
): Promise<HandoverOutcome> {
  const progress: HandoverProgress = previous
    ? { ...previous, copied: { ...previous.copied }, sentPhotoIds: [...previous.sentPhotoIds] }
    : newHandoverProgress(deps.newRequestId());
  const firstMessage = payload.text !== null ? wording.fromAri(payload.text) : wording.photoOnlyMessage;
  let createdConversation = false;

  // 1. The open conversation, or a new one through the existing create path.
  if (progress.ticketId === null) {
    let openId: string | null;
    try {
      openId = await deps.findOpenConversation();
    } catch (error) {
      throw new HandoverError("find", progress, errorMessage(error));
    }
    if (openId !== null) {
      progress.ticketId = openId;
    } else {
      const subject = (payload.text ?? wording.photoOnlySubject).slice(0, SUBJECT_MAX);
      try {
        progress.ticketId = await deps.createConversation({
          clientRequestId: progress.clientRequestId,
          subject,
          message: firstMessage,
        });
      } catch (error) {
        throw new HandoverError("create", progress, errorMessage(error));
      }
      // The new conversation's first message already carries the words.
      progress.textDelivered = true;
      createdConversation = true;
    }
  }
  const ticketId = progress.ticketId;

  // 1b. A conversation that existed already: if its thread holds this Ari
  // question's hand-over (a press before a reload, or a send whose answer was
  // lost), nothing is copied or sent again.
  if (!createdConversation && !progress.textDelivered) {
    let thread: readonly HandoverThreadMessage[];
    try {
      thread = await deps.readThread(ticketId);
    } catch (error) {
      throw new HandoverError("check", progress, errorMessage(error));
    }
    if (threadHasHandover(thread, { userId: deps.userId, words: firstMessage, askedAt: payload.askedAt })) {
      progress.textDelivered = true;
      return {
        ticketId,
        createdConversation: false,
        alreadyHandedOver: true,
        photosSent: 0,
        photoFailures: [],
        skippedFiles: payload.skippedFiles,
        progress,
      };
    }
  }

  // 2. Each Ari photo is copied on the server; a refusal keeps the rest going.
  const photoFailures: HandoverOutcome["photoFailures"] = [];
  for (const ariId of payload.ariImageIds) {
    if (progress.copied[ariId] !== undefined) continue;
    let result: CopyPhotoResult;
    try {
      result = await deps.copyPhoto(ariId, ticketId);
    } catch {
      result = { ok: false, code: "NETWORK" };
    }
    if (result.ok) progress.copied[ariId] = result.supportAttachmentId;
    else photoFailures.push({ ariAttachmentId: ariId, code: result.code });
  }

  // 3. One message: the words (unless already delivered) and the photos.
  const unsentPhotos = Object.values(progress.copied).filter((id) => !progress.sentPhotoIds.includes(id));
  const content = progress.textDelivered ? "" : firstMessage;
  if (content.length > 0 || unsentPhotos.length > 0) {
    try {
      await deps.send(ticketId, content, unsentPhotos);
    } catch (error) {
      throw new HandoverError("send", progress, errorMessage(error));
    }
    progress.textDelivered = true;
    progress.sentPhotoIds = [...progress.sentPhotoIds, ...unsentPhotos];
  }

  return {
    ticketId,
    createdConversation,
    alreadyHandedOver: false,
    photosSent: progress.sentPhotoIds.length,
    photoFailures,
    skippedFiles: payload.skippedFiles,
    progress,
  };
}
