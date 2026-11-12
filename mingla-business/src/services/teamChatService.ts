/**
 * #4255 W5 — Mingla team chat for staff in the Host app.
 *
 * Every read and write goes through the team_* database functions
 * (20280624034255_issue_4255_team_chat_functions.sql). They refuse anyone who
 * is not confirmed, active Admin staff, so this module never decides access:
 * the screens only hide what the database would refuse anyway.
 *
 * Files: the database issues the upload path (`<thread>/<attachment>/<file>`
 * in the private bucket team-files) and the app uploads there itself; a read
 * is a short signed link made after team_attachment_sign says yes.
 */
import { Linking, Platform } from "react-native";

import { supabase } from "./supabase";
import { openExternal } from "./guestFunnelLink";
import { uploadStorageObject, type BrandGroupPickedFile } from "./brandGroupFilesService";
import type { TeamBadge } from "../components/minglaTeam/teamBadge";

export type { TeamBadge };

export type TeamThreadKind = "team" | "group" | "dm";
export type TeamAttachmentKind = "image" | "document" | "link";

export interface TeamLastMessage {
  id: string;
  author_id: string | null;
  author_name: string;
  at: string;
  preview: string | null;
}

export interface TeamThread {
  id: string;
  kind: TeamThreadKind;
  title: string;
  other_user_id: string | null;
  member_count: number;
  my_role: "owner" | "member" | null;
  muted: boolean;
  unread: number;
  unread_mentions: number;
  last_message: TeamLastMessage | null;
  last_message_at: string | null;
  created_at: string;
  archived: boolean;
  revision: number;
}

export interface TeamAttachment {
  id: string;
  thread_id: string;
  message_id: string | null;
  kind: TeamAttachmentKind;
  name: string;
  mime: string | null;
  size_bytes: number | null;
  url: string | null;
  width: number | null;
  height: number | null;
  uploaded: boolean;
  created_by: string | null;
  created_at: string;
}

export interface TeamReaction {
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
}

export interface TeamMessage {
  id: string;
  thread_id: string;
  author_id: string | null;
  author_name: string;
  body: string | null;
  mentions: { user_id: string; name: string }[];
  everyone: boolean;
  reply_to: { id: string; author_name: string; excerpt: string | null; deleted: boolean } | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  revision: number;
  mine: boolean;
  reactions: TeamReaction[];
  attachments: TeamAttachment[];
}

export interface TeamMember {
  user_id: string;
  name: string;
  role: "owner" | "member";
}

export interface TeamMessagesPage {
  thread: TeamThread;
  members: TeamMember[];
  messages: TeamMessage[];
  has_more: boolean;
  limit: number;
}

export interface TeamPerson {
  user_id: string;
  name: string;
  email: string;
  me: boolean;
}

export interface TeamMention {
  id: string;
  kind: string;
  source_kind: string;
  card_id: string | null;
  action: string | null;
  /** #4255: true when this notice asks you to decide (team_inbox). */
  decision?: boolean;
  thread_id: string | null;
  message_id: string | null;
  actor_name: string;
  body_excerpt: string | null;
  deep_link: string | null;
  created_at: string;
  read_at: string | null;
}

export const TEAM_FILES_BUCKET = "team-files";
export const TEAM_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const TEAM_MAX_ATTACHMENTS = 10;
export const TEAM_MAX_MESSAGE_CHARS = 10_000;
export const ADMIN_ORIGIN = "https://admin.usemingla.com";

/** A database refusal, with the person-facing words and whether it is a stale write. */
export class TeamChatError extends Error {
  constructor(message: string, readonly code: string | null, readonly stale: boolean, readonly forbidden: boolean) {
    super(message);
    this.name = "TeamChatError";
  }
}

/**
 * The functions raise "code: Words for a person." Keep the words; a stale
 * revision (PT409) and a refusal (42501) are flagged for the screen.
 */
export function teamChatError(error: { message?: string; code?: string } | null | undefined, fallback: string): TeamChatError {
  const raw = typeof error?.message === "string" ? error.message : "";
  const split = raw.match(/^([a-z_]+): (.+)$/s);
  const code = split ? split[1] : null;
  const stale = error?.code === "PT409" || code === "stale_write";
  const forbidden = error?.code === "42501";
  const words = split ? split[2] : stale ? "Someone changed this first. Reload, then try again." : fallback;
  return new TeamChatError(words, code, stale, forbidden);
}

async function rpc<T>(name: string, args: Record<string, unknown> | undefined, fallback: string): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw teamChatError(error, fallback);
  return data as T;
}

export async function listTeamThreads(): Promise<{ threads: TeamThread[]; badge: TeamBadge }> {
  const data = await rpc<{ threads?: TeamThread[]; badge?: TeamBadge }>("team_list_threads", undefined, "Couldn't load team chats.");
  return { threads: data?.threads ?? [], badge: data?.badge ?? { staff: true, admin: false, chats: 0, messages: 0, mentions: 0, total: 0 } };
}

export async function getTeamMessages(threadId: string, before: string | null = null): Promise<TeamMessagesPage> {
  return rpc<TeamMessagesPage>("team_get_messages", { p_thread_id: threadId, p_limit: 50, p_before: before }, "Couldn't load this chat.");
}

export async function listTeamPeople(): Promise<TeamPerson[]> {
  return (await rpc<TeamPerson[] | null>("team_people", undefined, "Couldn't load teammates.")) ?? [];
}

export async function postTeamMessage(input: {
  threadId: string;
  body: string;
  mentions: string[];
  replyToId: string | null;
  attachmentIds: string[];
  everyone: boolean;
  requestKey: string;
}): Promise<TeamMessage> {
  const data = await rpc<{ message: TeamMessage }>("team_post", {
    p_thread_id: input.threadId,
    p_body: input.body,
    p_mentions: input.mentions,
    p_reply_to_id: input.replyToId,
    p_attachment_ids: input.attachmentIds,
    p_everyone: input.everyone,
    p_request_key: input.requestKey,
  }, "Couldn't send. Try again.");
  return data.message;
}

export async function editTeamMessage(messageId: string, body: string, revision: number): Promise<TeamMessage> {
  const data = await rpc<{ message: TeamMessage }>("team_edit", { p_message_id: messageId, p_body: body, p_expected_revision: revision }, "Couldn't save the change.");
  return data.message;
}

export async function deleteTeamMessage(messageId: string, revision: number): Promise<TeamMessage> {
  const data = await rpc<{ message: TeamMessage }>("team_delete", { p_message_id: messageId, p_expected_revision: revision }, "Couldn't delete it.");
  return data.message;
}

export async function reactTeamMessage(messageId: string, emoji: string, on: boolean): Promise<TeamMessage> {
  const data = await rpc<{ message: TeamMessage }>("team_react", { p_message_id: messageId, p_emoji: emoji, p_on: on }, "Couldn't react.");
  return data.message;
}

export async function markTeamRead(threadId: string): Promise<TeamBadge | null> {
  const data = await rpc<{ badge?: TeamBadge } | null>("team_mark_read", { p_thread_id: threadId }, "Couldn't mark this chat read.");
  return data?.badge ?? null;
}

export async function createTeamGroup(title: string, memberIds: string[]): Promise<TeamThread> {
  const data = await rpc<{ thread: TeamThread }>("team_group_create", { p_title: title, p_member_ids: memberIds }, "Couldn't make the group.");
  return data.thread;
}

export async function renameTeamGroup(threadId: string, title: string, revision: number): Promise<TeamThread> {
  const data = await rpc<{ thread: TeamThread }>("team_group_update", { p_thread_id: threadId, p_title: title, p_expected_revision: revision }, "Couldn't rename the group.");
  return data.thread;
}

export async function openTeamDm(userId: string): Promise<TeamThread> {
  const data = await rpc<{ thread: TeamThread }>("team_dm_open", { p_user_id: userId }, "Couldn't open that chat.");
  return data.thread;
}

export async function addTeamMembers(threadId: string, userIds: string[]): Promise<void> {
  await rpc<unknown>("team_members_add", { p_thread_id: threadId, p_user_ids: userIds }, "Couldn't add them.");
}

export async function removeTeamMember(threadId: string, userId: string): Promise<void> {
  await rpc<unknown>("team_member_remove", { p_thread_id: threadId, p_user_id: userId }, "Couldn't take them out.");
}

export async function muteTeamThread(threadId: string, muted: boolean): Promise<void> {
  await rpc<unknown>("team_mute", { p_thread_id: threadId, p_muted: muted }, "Couldn't change notifications for this chat.");
}

/** Admin mentions, replies and decisions for you (team_inbox). Team chat mentions live in their chats. */
export async function listTeamMentions(): Promise<TeamMention[]> {
  const data = await rpc<{ mentions?: TeamMention[] } | null>("team_inbox", { p_alert_types: null, p_limit: 100 }, "Couldn't load your mentions.");
  return (data?.mentions ?? []).filter((m) => m.source_kind !== "team_message");
}

/** #4398: Work updates > Mark all read (mentions and work updates; support alerts stay as they are). */
export async function markAllWorkUpdatesRead(): Promise<void> {
  await rpc<unknown>("team_inbox_mark_read", { p_scope: "mentions", p_alert_types: null }, "Couldn't mark them read.");
  await rpc<unknown>("team_inbox_mark_read", { p_scope: "work_updates", p_alert_types: null }, "Couldn't mark them read.");
}

export async function markTeamMentionRead(mentionId: string): Promise<void> {
  await rpc<unknown>("issue_3720_mark_team_mention_read", { p_mention_id: mentionId }, "Couldn't mark it read.");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where "Open in Mingla Admin" goes: the link Admin issued for that mention
 * (a work card, a content calendar card), only when it is on Admin's own
 * origin; else the card on Work; else Messages.
 */
export function teamAdminUrl(mention: Pick<TeamMention, "deep_link" | "card_id">): string {
  const link = typeof mention.deep_link === "string" ? mention.deep_link.trim() : "";
  if (link.startsWith(`${ADMIN_ORIGIN}/#/`) && !/\s/.test(link)) return link;
  // #4255 rework (P3): the card opens with its thread beside it.
  if (mention.card_id && UUID.test(mention.card_id)) return `${ADMIN_ORIGIN}/#/work-board?card=${mention.card_id}&side=thread:${mention.card_id}`;
  return `${ADMIN_ORIGIN}/#/messages`;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heic",
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", key: "application/vnd.apple.keynote",
  numbers: "application/vnd.apple.numbers", pages: "application/vnd.apple.pages",
};
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"]);
const DOCUMENT_MIMES = new Set(Object.values(MIME_BY_EXTENSION).filter((mime) => !IMAGE_MIMES.has(mime)));

/** What the pickers offer for team chats (photos and the rev 4 document list). */
export const TEAM_PICK_OPTIONS = {
  imagesOnly: true,
  documentMimes: [...IMAGE_MIMES, ...DOCUMENT_MIMES],
  accept: ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.key,.numbers,.pages,image/*",
} as const;

export interface TeamCheckedFile {
  local: BrandGroupPickedFile;
  kind: "image" | "document";
  name: string;
  mime: string;
  size: number;
}

/** Refuse a file before any upload: unknown type, empty, or over 25 MB (rev 4 §6). */
export function checkTeamFile(file: BrandGroupPickedFile): TeamCheckedFile {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  let mime = String(file.mimeType || MIME_BY_EXTENSION[extension] || "").split(";", 1)[0].toLowerCase();
  if (mime === "image/jpg") mime = "image/jpeg";
  if (mime === "image/heif") mime = "image/heic";
  if (mime === "application/csv") mime = "text/csv";
  const size = Number(file.size || 0);
  if (size > TEAM_MAX_FILE_BYTES) throw new Error(`${file.name} is over 25 MB. Share it as a link instead.`);
  const kind = IMAGE_MIMES.has(mime) ? "image" : DOCUMENT_MIMES.has(mime) ? "document" : null;
  if (!kind) throw new Error(`${file.name} can't be sent here. Send a photo, a document or a link.`);
  if (!Number.isFinite(size) || size < 1) throw new Error(`We couldn't read ${file.name}.`);
  return { local: file, kind, name: file.name.trim().slice(0, 200) || "file", mime, size };
}

const UPLOAD_PATH = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,120}$/;

/** Add one photo or document to a chat; the database answers with where to upload it. */
export async function addTeamFile(threadId: string, file: TeamCheckedFile): Promise<{ attachment: TeamAttachment; path: string }> {
  const data = await rpc<{ attachment: TeamAttachment; upload: { bucket: string; path: string } | null }>(
    "team_attachment_add",
    { p_thread_id: threadId, p_file: { kind: file.kind, name: file.name, mime: file.mime, size_bytes: file.size } },
    `Couldn't add ${file.name}.`,
  );
  if (!data.upload || data.upload.bucket !== TEAM_FILES_BUCKET) throw new Error(`Couldn't upload ${file.name}. Try again.`);
  return { attachment: data.attachment, path: data.upload.path };
}

/**
 * Upload to the path the database issued. It must sit in team-files under
 * this chat and this attachment; anything else is refused before a byte
 * leaves the phone.
 */
export async function uploadTeamFile(
  threadId: string,
  attachmentId: string,
  path: string,
  file: TeamCheckedFile,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const match = UPLOAD_PATH.exec(path);
  if (!match || match[1] !== threadId || match[2] !== attachmentId) throw new Error(`Couldn't upload ${file.name}. Try again.`);
  await uploadStorageObject(TEAM_FILES_BUCKET, path, file.mime, file.local, onProgress);
}

export async function addTeamLink(threadId: string, url: string, name: string | null): Promise<TeamAttachment> {
  const data = await rpc<{ attachment: TeamAttachment }>(
    "team_attachment_add",
    { p_thread_id: threadId, p_file: name ? { kind: "link", url, name } : { kind: "link", url } },
    "Couldn't add that link.",
  );
  return data.attachment;
}

/** A short signed link to a photo or document (or the link itself). */
export async function signTeamAttachment(attachmentId: string): Promise<string> {
  const data = await rpc<{ kind: string; url?: string; bucket?: string; path?: string; expires_in?: number }>(
    "team_attachment_sign", { p_attachment_id: attachmentId }, "That file is no longer here.",
  );
  if (data.kind === "link" && typeof data.url === "string") return data.url;
  if (data.bucket !== TEAM_FILES_BUCKET || typeof data.path !== "string") throw new Error("That file is no longer here.");
  const { data: signed, error } = await supabase.storage.from(TEAM_FILES_BUCKET).createSignedUrl(data.path, Math.min(Number(data.expires_in) || 300, 300));
  if (error || !signed?.signedUrl) throw new Error("Couldn't open this file. Try again.");
  return signed.signedUrl;
}

/** Links: a friendly name with no page fetch (rev 4 §5). */
export function teamLinkLabel(rawUrl: string): { name: string; host: string } {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(rawUrl);
    host = parsed.hostname.replace(/^www\./, "");
    path = parsed.pathname;
  } catch {
    return { name: "Link", host: rawUrl.slice(0, 60) };
  }
  if (host === "drive.google.com") return { name: "Google Drive file", host };
  if (host === "docs.google.com") {
    if (path.startsWith("/spreadsheets")) return { name: "Google Sheet", host };
    if (path.startsWith("/presentation")) return { name: "Google Slides", host };
    return { name: "Google Doc", host };
  }
  if (host === "instagram.com") return { name: path.startsWith("/reel") ? "Instagram reel" : "Instagram post", host };
  if (host === "tiktok.com") return { name: "TikTok video", host };
  if (host === "youtube.com" || host === "youtu.be") return { name: "YouTube video", host };
  const site = host.split(".").slice(-2, -1)[0] ?? host;
  return { name: site ? site.charAt(0).toUpperCase() + site.slice(1) : "Link", host };
}

/** A link a teammate typed: https only, no spaces, under 2,000 characters. */
export function normalizeTeamLink(input: string): string | null {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed.replace(/^http:\/\//i, "https://") : `https://${trimmed}`;
  if (withScheme.length < 9 || withScheme.length > 2000 || /\s/.test(withScheme)) return null;
  try {
    const parsed = new URL(withScheme);
    return parsed.hostname.includes(".") ? withScheme : null;
  } catch {
    return null;
  }
}

/** Open a URL outside the app: a new tab on web, the browser or system viewer on phones. */
export async function openOutside(url: string): Promise<void> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    // ORCH-1381: new tabs open only through the one openExternal owner.
    openExternal(url);
    return;
  }
  await Linking.openURL(url);
}
