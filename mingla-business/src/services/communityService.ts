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

export type CommunityPostKind = "idea" | "question";

export type CommunityPost = {
  id: string;
  kind: CommunityPostKind;
  title: string;
  body: string;
  author_label: string;
  review_state: "pending" | "published" | "rejected" | "removed";
  created_at: string;
  vote_count: number;
  comment_count: number;
  voted_by_me: boolean;
  is_mine: boolean;
  accepted_comment_id: string | null;
};

export type CommunityComment = {
  id: string;
  body: string;
  author_label: string;
  created_at: string;
  is_mine: boolean;
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

export async function listCommunityPosts(
  kind?: CommunityPostKind,
): Promise<CommunityPost[]> {
  const { data, error } = await supabase.rpc("issue_3720_community_feed", {
    p_kind: kind ?? null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CommunityPost[]).map((post) => ({
    ...post,
    vote_count: Number(post.vote_count) || 0,
    comment_count: Number(post.comment_count) || 0,
  }));
}

export async function submitCommunityPost(input: {
  kind: CommunityPostKind;
  title: string;
  body: string;
}): Promise<{ post_id: string; review_state: string }> {
  const { data, error } = await supabase.rpc(
    "issue_3720_community_submit_post",
    { p_kind: input.kind, p_title: input.title, p_body: input.body },
  );
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.post_id) throw new Error("The Community post was not saved.");
  return row;
}

export async function toggleCommunityVote(postId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "issue_3720_community_toggle_vote",
    { p_post_id: postId },
  );
  if (error) throw new Error(error.message);
  return data === true;
}

export async function listCommunityComments(
  postId: string,
): Promise<CommunityComment[]> {
  const { data, error } = await supabase.rpc("issue_3720_community_comments", {
    p_post_id: postId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CommunityComment[];
}

export async function addCommunityComment(
  postId: string,
  body: string,
): Promise<string> {
  const { data, error } = await supabase.rpc(
    "issue_3720_community_add_comment",
    { p_post_id: postId, p_body: body },
  );
  if (error) throw new Error(error.message);
  return String(data);
}

export async function acceptCommunityAnswer(
  postId: string,
  commentId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "issue_3720_community_accept_answer",
    { p_post_id: postId, p_comment_id: commentId },
  );
  if (error) throw new Error(error.message);
  return data === true;
}

export async function reportCommunityContent(
  targetType: "post" | "comment",
  targetId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("issue_3720_community_report", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function blockCommunityAuthor(
  targetType: "post" | "comment",
  targetId: string,
): Promise<void> {
  const { error } = await supabase.rpc("issue_3720_community_block_author", {
    p_target_type: targetType,
    p_target_id: targetId,
  });
  if (error) throw new Error(error.message);
}

export async function appealCommunityModeration(
  targetType: "post" | "comment",
  targetId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("issue_3720_community_appeal", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
