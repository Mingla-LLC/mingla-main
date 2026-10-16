/**
 * #3720 Slice G — Host-facing Community reads + prefs.
 *
 * Announcements and roadmap are RLS-scoped (published only). Mutations go
 * through SECURITY DEFINER RPCs (`community_mark_announcement_read`,
 * `community_set_email_pref`). Support availability is `support_is_online()`.
 */

import { supabase } from "./supabase";

export type CommunityAnnouncement = {
  id: string;
  title: string;
  body_md: string;
  published_at: string | null;
  /** ISO timestamp when this host marked it read; null = unread. */
  read_at: string | null;
};

export type CommunityRoadmapLane = "now" | "next" | "later";

export type CommunityRoadmapCard = {
  id: string;
  public_title: string;
  public_body: string | null;
  lane: CommunityRoadmapLane;
  sort_order: number;
};

type AnnouncementRow = {
  id: string;
  title: string;
  body_md: string;
  published_at: string | null;
};

type ReceiptRow = {
  announcement_id: string;
  read_at: string;
};

type RoadmapRow = {
  id: string;
  public_title: string;
  public_body: string | null;
  lane: string;
  sort_order: number;
};

function asLane(raw: string): CommunityRoadmapLane {
  if (raw === "next" || raw === "later") return raw;
  return "now";
}

/** Published announcements newest-first, with this host's read receipt joined. */
export async function listPublishedAnnouncements(): Promise<
  CommunityAnnouncement[]
> {
  const { data: rows, error } = await supabase
    .from("community_announcements")
    .select("id, title, body_md, published_at")
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

/** Host-safe roadmap projection (no internal_note). */
export async function listPublicRoadmap(): Promise<CommunityRoadmapCard[]> {
  const { data, error } = await supabase
    .from("community_roadmap_public")
    .select("id, public_title, public_body, lane, sort_order")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  return ((data ?? []) as RoadmapRow[]).map((row) => ({
    id: row.id,
    public_title: row.public_title,
    public_body: row.public_body,
    lane: asLane(row.lane),
    sort_order: row.sort_order,
  }));
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
