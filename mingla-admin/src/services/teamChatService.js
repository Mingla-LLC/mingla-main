// Issue #4255 (W4) — the ONLY Admin caller of the Mingla team chat functions
// (20280614034255_issue_4255_team_chat_functions.sql) and of the shared team
// notification settings. Every function gates on the server: confirmed,
// active staff only, and a stale revision raises PT409 (stale_write). Errors
// come back as an OpsError the screens word with opsErrorWords.
import { supabase } from "../lib/supabase";
import { OpsError } from "./opsService";
import { parseServerError } from "../lib/crmModel";

async function call(run) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new OpsError({ token: "network", message: "" });
  }
  let result;
  try {
    result = await run();
  } catch (error) {
    throw new OpsError(parseServerError(error));
  }
  if (result?.error) throw new OpsError(parseServerError(result.error));
  return result?.data;
}

const rpc = (name, args = {}) => call(() => supabase.rpc(name, args));

export const fetchBadge = () => rpc("team_badge");
export const listThreads = () => rpc("team_list_threads");
export const listPeople = () => rpc("team_people");
export const getMessages = (threadId, limit = 50, before = null) =>
  rpc("team_get_messages", { p_thread_id: threadId, p_limit: limit, p_before: before });
export const postMessage = (threadId, { body = "", mentions = [], replyToId = null, attachmentIds = [], everyone = false, key = null } = {}) =>
  rpc("team_post", {
    p_thread_id: threadId,
    p_body: body,
    p_mentions: mentions,
    p_reply_to_id: replyToId,
    p_attachment_ids: attachmentIds.length ? attachmentIds : null,
    p_everyone: !!everyone,
    p_request_key: key,
  });
export const editMessage = (id, body, revision) => rpc("team_edit", { p_message_id: id, p_body: body, p_expected_revision: revision });
export const deleteMessage = (id, revision) => rpc("team_delete", { p_message_id: id, p_expected_revision: revision });
export const reactMessage = (id, emoji, on) => rpc("team_react", { p_message_id: id, p_emoji: emoji, p_on: on !== false });
export const markThreadRead = (threadId) => rpc("team_mark_read", { p_thread_id: threadId });
export const createGroup = (title, memberIds) => rpc("team_group_create", { p_title: title, p_member_ids: memberIds });
export const openDm = (userId) => rpc("team_dm_open", { p_user_id: userId });
export const addAttachment = (threadId, file) => rpc("team_attachment_add", { p_thread_id: threadId, p_file: file });
export const signAttachment = (attachmentId) => rpc("team_attachment_sign", { p_attachment_id: attachmentId });

/** A photo or document into a chat: the row first (checks staff, type, 25 MB), then the upload to its path. */
export async function uploadAttachment(threadId, file, { kind, mime }) {
  const added = await addAttachment(threadId, { kind, name: String(file?.name || "file").slice(0, 200), mime, size_bytes: Number(file?.size) || 0 });
  const upload = added?.upload;
  if (upload?.path) {
    await call(() => supabase.storage.from(upload.bucket || "team-files").upload(upload.path, file, { contentType: mime, upsert: false, cacheControl: "3600" }));
  }
  return added?.attachment || null;
}

/** A link into a chat (no page is fetched). */
export const addLink = (threadId, url, name) =>
  addAttachment(threadId, { kind: "link", url, ...(name ? { name } : {}) }).then((r) => r?.attachment || null);

/** A short-lived address to open an attachment: a link's own, or a 5-minute signed one. */
export async function attachmentUrl(attachmentId) {
  const s = await signAttachment(attachmentId);
  if (s?.kind === "link") return s.url || "";
  const data = await call(() => supabase.storage.from(s?.bucket || "team-files").createSignedUrl(s?.path, Math.min(Number(s?.expires_in) || 300, 300)));
  return data?.signedUrl || "";
}

// The shared settings (#4255 D14): notification_channel_prefs, keyed by the
// signed-in auth user, the same rows the Host app's Mingla team settings
// read and write (mingla-business TeamNotificationPrefs).
// #4255 fix-up: direct messages (business.team_message) and group messages
// (business.team_group_message) are separate switches.
// #4255 rework: and "My cards due and late" (business.team_due, the 09:00 push).
export const TEAM_PREF_CATEGORIES = Object.freeze(["business.team_mention", "business.team_decision", "business.team_message", "business.team_group_message", "business.team_due"]);

export const getTeamPrefs = (userId) =>
  call(() => supabase.from("notification_channel_prefs").select("category_key, channel, enabled").eq("user_id", userId).in("category_key", TEAM_PREF_CATEGORIES));

/**
 * One switch. Group message pushes off goes back to the default (a group
 * pushes only on a mention), exactly as the Host app does.
 */
export const setTeamPref = (userId, categoryKey, channel, enabled) =>
  call(() => (categoryKey === "business.team_group_message" && channel === "push" && !enabled
    ? supabase.from("notification_channel_prefs").delete().eq("user_id", userId).eq("category_key", categoryKey).eq("channel", channel)
    : supabase.from("notification_channel_prefs").upsert({ user_id: userId, category_key: categoryKey, channel, enabled: !!enabled, updated_at: new Date().toISOString() })));
