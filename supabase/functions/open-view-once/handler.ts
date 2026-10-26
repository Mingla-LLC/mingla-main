// Issue #4114 Wave 4 — open a view-once photo or video exactly once, and sweep
// opened, expired, unsent and orphaned chat attachments out of storage.
//
// Wave 7 (D18): the sweep also deletes the full file of an ordinary chat video
// 90 days after it was sent (reason "video_retention"), keeps its thumbnail, and
// marks the message media_expired_at instead of view_once_purged_at.
//
// Two callers:
//   * a signed-in recipient: POST { message_id } → one 60-second signed URL,
//     after recording their view. A second open (any device) is refused with
//     409 already_opened; the sender is refused with 403 (they cannot reopen it).
//     Recipients cannot read view-once objects from storage directly (the
//     message_attachments_select policy), so this is the only way in.
//   * the hourly pg_cron job: POST { action: "sweep" } with the service-role
//     bearer → deletes what issue_4114_view_once_media_due lists, through the
//     Storage API (SQL deletes from storage.objects are refused).
//
// The handler only depends on the narrow interface below (no supabase-js types),
// so the Deno test drives it with fakes.
// MINGLA-INVARIANT: I-4114-VIEW-ONCE-SERVER-ENFORCED | issue #4114 | A view-once item is handed out at most once per recipient, never to its sender, and only as a short-lived signed URL recorded in message_media_views before it is returned.

import { corsHeaders } from "../_shared/cors.ts";

export const VIEW_ONCE_URL_SECONDS = 60;
export const SWEEP_BATCH_LIMIT = 200;
const REMOVE_CHUNK = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOWER_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/**
 * The only object names a chat attachment can have, exactly as the
 * issue_4114_chat_attachment_conversation SQL function accepts them:
 * <conversation_id>/<uuid>.<ext> or <conversation_id>/once/<uuid>.<ext>, lower-case,
 * with no dot or empty segments, no encoding and nothing after the extension.
 */
export const CANONICAL_ATTACHMENT_PATH = new RegExp(
  `^(${LOWER_UUID})/(once/)?${LOWER_UUID}\\.[a-z0-9]{1,8}$`,
);
/** Wave 7: a thumbnail, <conversation_id>/<uuid>_thumb.jpg (never under once/). */
export const CANONICAL_THUMB_PATH = new RegExp(`^(${LOWER_UUID})/${LOWER_UUID}_thumb\\.jpg$`);
/** Sweep reasons that mark a message media_expired_at rather than view_once_purged_at. */
export const MEDIA_EXPIRY_REASONS: ReadonlySet<string> = new Set(["video_retention"]);
/** Returned by signUrl when the object's uploader is not the expected sender. */
export const OBJECT_NOT_OWNED = "object_not_owned";

export interface AttachmentPathParts {
  conversationId: string;
  once: boolean;
}

/** True for a name the sweep may delete: a canonical attachment or thumbnail. */
export function isSweepablePath(path: unknown): path is string {
  return typeof path === "string" && (CANONICAL_ATTACHMENT_PATH.test(path) || CANONICAL_THUMB_PATH.test(path));
}

/** The parts of a canonical attachment path, or null when the path is anything else. */
export function parseAttachmentPath(path: unknown): AttachmentPathParts | null {
  if (typeof path !== "string") return null;
  const match = CANONICAL_ATTACHMENT_PATH.exec(path);
  if (!match) return null;
  return { conversationId: match[1], once: match[2] === "once/" };
}

export interface ViewOnceMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  message_type: string | null;
  file_url: string | null;
  view_once: boolean;
  view_once_purged_at: string | null;
  deleted_at: string | null;
}

export interface DueRow {
  message_id: string | null;
  storage_path: string;
  reason: string;
}

export interface Result<T> {
  data: T;
  error: string | null;
}

export interface OpenViewOnceDeps {
  /** The signed-in user's id for this bearer, or null when it is not a user JWT. */
  userIdFor(authorization: string | null): Promise<string | null>;
  /** True only for the scheduled caller (service-role bearer / CRON_SECRET). */
  isCronCaller(authorization: string | null): Promise<boolean>;
  loadMessage(messageId: string): Promise<Result<ViewOnceMessage | null>>;
  isParticipant(conversationId: string, userId: string): Promise<Result<boolean>>;
  /**
   * A short-lived signed URL for `path`, only when the storage object's uploader
   * is `uploaderId`. Otherwise `{ data: null, error: OBJECT_NOT_OWNED }`.
   */
  signUrl(path: string, seconds: number, uploaderId: string): Promise<Result<string | null>>;
  /** Inserts (message_id, user_id); `inserted` is false when the row already existed. */
  recordView(messageId: string, userId: string): Promise<Result<{ inserted: boolean; viewedAt: string | null }>>;
  listDue(limit: number): Promise<Result<DueRow[]>>;
  removeObjects(paths: string[]): Promise<{ error: string | null }>;
  markPurged(messageIds: string[]): Promise<{ error: string | null }>;
  /**
   * Wave 7: stamps media_expired_at on videos whose full file was deleted.
   * Optional only for older test fakes; without it a retention row fails the
   * sweep closed (after the delete, before anything is reported as done).
   */
  markExpired?(messageIds: string[]): Promise<{ error: string | null }>;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function sweep(deps: OpenViewOnceDeps): Promise<Response> {
  const due = await deps.listDue(SWEEP_BATCH_LIMIT);
  if (due.error) {
    console.error("[open-view-once] sweep listing failed", { code: due.error.slice(0, 80) });
    return json({ error: "sweep_list_failed" }, 500);
  }
  const rows = due.data ?? [];
  // Only canonical chat attachment (or orphaned thumbnail) paths are ever handed
  // to the deleter. A retention row is only ever a video's full file: a
  // thumbnail is never listed for retention and is refused here if it were.
  const paths = [...new Set(rows.filter((row) =>
    MEDIA_EXPIRY_REASONS.has(row.reason)
      ? parseAttachmentPath(row.storage_path)?.once === false
      : row.reason === "orphan"
        ? isSweepablePath(row.storage_path)
        : parseAttachmentPath(row.storage_path) !== null
  ).map((row) => row.storage_path))];
  for (let index = 0; index < paths.length; index += REMOVE_CHUNK) {
    const removed = await deps.removeObjects(paths.slice(index, index + REMOVE_CHUNK));
    if (removed.error) {
      console.error("[open-view-once] sweep remove failed", { code: removed.error.slice(0, 80) });
      return json({ error: "sweep_remove_failed" }, 500);
    }
  }
  const idsFor = (expiry: boolean) => [...new Set(rows
    .filter((row) => MEDIA_EXPIRY_REASONS.has(row.reason) === expiry && paths.includes(row.storage_path))
    .map((row) => row.message_id)
    .filter((id): id is string => !!id))];
  const messageIds = idsFor(false);
  if (messageIds.length > 0) {
    const marked = await deps.markPurged(messageIds);
    if (marked.error) {
      console.error("[open-view-once] sweep mark failed", { code: marked.error.slice(0, 80) });
      return json({ error: "sweep_mark_failed" }, 500);
    }
  }
  const expiredIds = idsFor(true);
  if (expiredIds.length > 0) {
    const marked = deps.markExpired ? await deps.markExpired(expiredIds) : { error: "mark_expired_unavailable" };
    if (marked.error) {
      console.error("[open-view-once] sweep expiry mark failed", { code: marked.error.slice(0, 80) });
      return json({ error: "sweep_mark_failed" }, 500);
    }
  }
  const byReason: Record<string, number> = {};
  for (const row of rows) byReason[row.reason] = (byReason[row.reason] ?? 0) + 1;
  return json({ ok: true, removed: paths.length, purged: messageIds.length, expired: expiredIds.length, by_reason: byReason });
}

export async function openOnce(
  deps: OpenViewOnceDeps,
  userId: string,
  messageId: string,
): Promise<Response> {
  const loaded = await deps.loadMessage(messageId);
  if (loaded.error) return json({ error: "message_read_failed" }, 500);
  const message = loaded.data;
  if (!message) return json({ error: "not_found", message: "This message is no longer available." }, 404);
  if (!message.view_once) return json({ error: "not_view_once" }, 400);
  if (message.sender_id === userId) {
    return json({ error: "sender_cannot_open", message: "You sent this, so you can't open it." }, 403);
  }
  const member = await deps.isParticipant(message.conversation_id, userId);
  if (member.error) return json({ error: "membership_read_failed" }, 500);
  if (!member.data) return json({ error: "not_participant" }, 403);
  if (message.deleted_at || message.view_once_purged_at || !message.file_url) {
    return json({ error: "gone", message: "This photo or video has expired." }, 410);
  }

  // Only the one object this message can legitimately name: a canonical once/
  // path in the message's own conversation folder, uploaded by its sender.
  // Every refusal reads the same as an expired item.
  const parts = parseAttachmentPath(message.file_url);
  if (!parts || !parts.once || parts.conversationId !== message.conversation_id || !message.sender_id) {
    return json({ error: "gone", message: "This photo or video has expired." }, 410);
  }

  // Sign first, record second, return last: the URL never leaves this function
  // unless this call is the one that recorded the view.
  const signed = await deps.signUrl(message.file_url, VIEW_ONCE_URL_SECONDS, message.sender_id);
  if (signed.error === OBJECT_NOT_OWNED) {
    return json({ error: "gone", message: "This photo or video has expired." }, 410);
  }
  if (signed.error || !signed.data) return json({ error: "sign_failed" }, 500);

  const recorded = await deps.recordView(message.id, userId);
  if (recorded.error) return json({ error: "view_record_failed" }, 500);
  if (!recorded.data.inserted) {
    return json({ error: "already_opened", message: "You've already opened this." }, 409);
  }

  return json({
    url: signed.data,
    expires_in: VIEW_ONCE_URL_SECONDS,
    message_type: message.message_type,
    viewed_at: recorded.data.viewedAt,
  });
}

/**
 * signUrl for production: looks up the object's uploader (service role) and
 * signs only when it is the expected sender. A missing object or a failed
 * lookup never signs.
 */
export function createOwnerCheckedSignUrl(io: {
  objectOwner(path: string): Promise<Result<string | null>>;
  sign(path: string, seconds: number): Promise<Result<string | null>>;
}): OpenViewOnceDeps["signUrl"] {
  return async (path, seconds, uploaderId) => {
    if (!parseAttachmentPath(path)) return { data: null, error: OBJECT_NOT_OWNED };
    const owner = await io.objectOwner(path);
    if (owner.error) return { data: null, error: owner.error };
    if (!owner.data || owner.data !== uploaderId) return { data: null, error: OBJECT_NOT_OWNED };
    return await io.sign(path, seconds);
  };
}

export function createOpenViewOnceHandler(deps: OpenViewOnceDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const authorization = req.headers.get("Authorization");
    const body = await readBody(req);
    if (!body) return json({ error: "invalid_body" }, 400);

    if (body.action === "sweep") {
      if (!(await deps.isCronCaller(authorization))) return json({ error: "forbidden" }, 403);
      return await sweep(deps);
    }

    const userId = await deps.userIdFor(authorization);
    if (!userId) return json({ error: "unauthorized" }, 401);
    const messageId = body.message_id;
    if (typeof messageId !== "string" || !UUID.test(messageId)) {
      return json({ error: "invalid_message_id" }, 400);
    }
    return await openOnce(deps, userId, messageId);
  };
}
