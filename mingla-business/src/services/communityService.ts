/**
 * #3720 Slice G — Host-facing Community reads + prefs.
 *
 * #4420 — the Host app keeps only announcements, the email preference and
 * support availability. Roadmap, ideas, questions, votes, comments, reports,
 * blocks and appeals left the Host app with Community; their server RPCs and
 * tables stay for Host phones still on an older build.
 *
 * Announcements are RLS-scoped (published only). Mutations go
 * through SECURITY DEFINER RPCs (`community_mark_announcement_read`,
 * `community_set_email_pref`). Support availability is `support_is_online()`.
 */

import { supabase } from "./supabase";

export type CommunityAnnouncement = {
  id: string;
  title: string;
  body_md: string;
  action_line: string | null;
  roadmap_card_id: string | null;
  published_at: string | null;
  /** ISO timestamp when this host marked it read; null = unread. */
  read_at: string | null;
};

type AnnouncementRow = {
  id: string;
  title: string;
  body_md: string;
  action_line?: string | null;
  roadmap_card_id?: string | null;
  published_at: string | null;
};

type ReceiptRow = {
  announcement_id: string;
  read_at: string;
};

/** Published announcements newest-first, with this host's read receipt joined. */
export async function listPublishedAnnouncements(): Promise<
  CommunityAnnouncement[]
> {
  const { data: rows, error } = await supabase
    .from("community_announcements")
    .select("id, title, body_md, action_line, roadmap_card_id, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (error) throw new Error(error.message);

  const { data: receipts, error: receiptError } = await supabase
    .from("community_read_receipts")
    .select("announcement_id, read_at");
  if (receiptError) throw new Error(receiptError.message);

  const readById = new Map<string, string>();
  for (const r of (receipts ?? []) as ReceiptRow[]) {
    readById.set(r.announcement_id, r.read_at);
  }

  return ((rows ?? []) as AnnouncementRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    body_md: row.body_md,
    action_line: row.action_line ?? null,
    roadmap_card_id: row.roadmap_card_id ?? null,
    published_at: row.published_at,
    read_at: readById.get(row.id) ?? null,
  }));
}

/** Count of published announcements this host has not marked read. */
export async function countUnreadAnnouncements(): Promise<number> {
  const list = await listPublishedAnnouncements();
  return list.filter((a) => a.read_at === null).length;
}

export async function markAnnouncementRead(
  announcementId: string,
): Promise<void> {
  const { error } = await supabase.rpc("community_mark_announcement_read", {
    p_announcement_id: announcementId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Email preference for community announcements.
 * Absent row = on (transactional category default).
 */
export async function getCommunityEmailPrefEnabled(): Promise<boolean> {
  const { data, error } = await supabase
    .from("notification_channel_prefs")
    .select("enabled")
    .eq("category_key", "business.community_announcement")
    .eq("channel", "email")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data == null) return true;
  return Boolean((data as { enabled: boolean }).enabled);
}

export async function setCommunityEmailPref(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("community_set_email_pref", {
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

/** True when any enabled support staffer has available=true. */
export async function fetchSupportIsOnline(): Promise<boolean> {
  const { data, error } = await supabase.rpc("support_is_online");
  if (error) throw new Error(error.message);
  return Boolean(data);
}
