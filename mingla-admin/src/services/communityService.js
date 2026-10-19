/**
 * #3720 Slice F — admin Community RPCs (Slice E schema).
 *
 * Mutations go through SECURITY DEFINER RPCs only. List reads use PostgREST
 * under RLS (admins see drafts via is_admin_user() policies).
 */

import { invokeWithRefresh, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "../lib/supabase";

function throwRpc(error) {
  if (!error) return;
  const msg = error.message || String(error);
  if (/not_authorized/i.test(msg))
    throw new Error("You need admin access for this action.");
  if (/not_found/i.test(msg)) throw new Error("That item was not found.");
  if (/invalid_title|invalid_lane|invalid_status|invalid_role/i.test(msg)) {
    throw new Error("Check the form fields and try again.");
  }
  if (/admin_use_is_admin_user/i.test(msg)) {
    throw new Error(
      "Admins already have full community access — do not add them as community staff.",
    );
  }
  throw new Error(msg);
}

// ── Announcements ────────────────────────────────────────────────────────────

export async function listAnnouncements() {
  const { data, error } = await supabase
    .from("community_announcements")
    .select(
      "id, title, body_md, status, published_at, author_user_id, created_at, updated_at",
    )
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function upsertAnnouncement({ id = null, title, bodyMd, actionLine = null, roadmapCardId = null }) {
  let { data, error } = await supabase.rpc("issue_3720_admin_upsert_announcement", {
    p_id: id,
    p_title: title,
    p_body_md: bodyMd,
    p_action_line: actionLine,
    p_roadmap_card_id: roadmapCardId,
  });
  if (error?.code === "PGRST202") {
    ({ data, error } = await supabase.rpc("community_upsert_announcement", {
      p_id: id,
      p_title: title,
      p_body_md: bodyMd,
    }));
  }
  throwRpc(error);
  return data;
}

export async function publishAnnouncement(id) {
  const { data, error } = await supabase.rpc("community_publish_announcement", {
    p_id: id,
  });
  throwRpc(error);
  return data;
}

export async function getAnnouncementNotificationStatus(campaignId = null) {
  const { data, error } = await supabase.rpc(
    "community_get_announcement_notification_status",
    { p_campaign_id: campaignId },
  );
  throwRpc(error);
  return data;
}

export async function listAnnouncementDeliveries() {
  const { data, error } = await supabase.rpc(
    "issue_3720_admin_announcement_deliveries",
  );
  throwRpc(error);
  return data ?? [];
}

export async function retryAnnouncementDelivery(campaignId) {
  const { data, error } = await supabase.rpc(
    "issue_3720_admin_retry_announcement",
    { p_campaign_id: campaignId },
  );
  throwRpc(error);
  return Number(data ?? 0);
}

export async function archiveAnnouncement(id) {
  const { data, error } = await supabase.rpc("community_archive_announcement", {
    p_id: id,
  });
  throwRpc(error);
  return data;
}

// ── Roadmap ──────────────────────────────────────────────────────────────────

export async function listRoadmapCards() {
  const { data, error } = await supabase
    .from("community_roadmap_cards")
    .select(
      "id, public_title, public_body, internal_note, lane, status, sort_order, shipped_at, target_label, idea_count, created_at, updated_at",
    )
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function upsertRoadmapCard({
  id = null,
  publicTitle,
  publicBody = "",
  internalNote = "",
  lane = "now",
  status = "draft",
}) {
  const { data, error } = await supabase.rpc("community_upsert_roadmap_card", {
    p_id: id,
    p_public_title: publicTitle,
    p_public_body: publicBody,
    p_internal_note: internalNote,
    p_lane: lane,
    p_status: status,
  });
  throwRpc(error);
  return data;
}

export async function reorderRoadmap(orderedIds) {
  const { error } = await supabase.rpc("community_reorder_roadmap", {
    p_ordered_ids: orderedIds,
  });
  throwRpc(error);
}

export async function getRoadmapNotificationPreview() {
  const { data, error } = await supabase.rpc(
    "community_roadmap_notification_preview",
  );
  throwRpc(error);
  return data;
}

export async function notifyRoadmapChange(requestKey) {
  const { data, error } = await supabase.rpc(
    "community_notify_roadmap_change",
    { p_request_key: requestKey },
  );
  throwRpc(error);
  return data;
}

export async function getRoadmapNotificationStatus(campaignId = null) {
  const { data, error } = await supabase.rpc(
    "community_get_roadmap_notification_status",
    { p_campaign_id: campaignId },
  );
  throwRpc(error);
  return data;
}

// ── Community staff (moderator / agent) ──────────────────────────────────────

export async function setCommunityStaff({
  userId,
  role,
  enabled = true,
  displayName = null,
}) {
  const { error } = await supabase.rpc("community_set_staff", {
    p_user_id: userId,
    p_role: role,
    p_enabled: enabled,
    p_display_name: displayName,
  });
  throwRpc(error);
}

// ── Community moderation ────────────────────────────────────────────────────

export async function listCommunityModerationQueue() {
  const { data, error } = await supabase.rpc(
    "issue_3720_community_moderation_queue",
  );
  throwRpc(error);
  return data ?? [];
}

export async function listAdminCommunityPosts(kind, filter = "all") {
  const { data, error } = await supabase.rpc("issue_3720_admin_list_posts", {
    p_kind: kind,
    p_filter: filter,
  });
  throwRpc(error);
  return data ?? [];
}

export async function updateAdminIdea({
  postId,
  status,
  publicResponse = "",
  mergeInto = null,
  promote = false,
}) {
  const { data, error } = await supabase.rpc("issue_3720_admin_update_idea", {
    p_post_id: postId,
    p_status: status,
    p_public_response: publicResponse,
    p_merge_into: mergeInto,
    p_promote: Boolean(promote),
  });
  throwRpc(error);
  return data;
}

export async function runAdminQuestionAction({ postId, action, answer = "" }) {
  const { data, error } = await supabase.rpc(
    "issue_3720_admin_question_action",
    { p_post_id: postId, p_action: action, p_answer: answer },
  );
  throwRpc(error);
  return data === true;
}

export async function listModerationWorkspace(section) {
  const { data, error } = await supabase.rpc(
    "issue_3720_admin_moderation_workspace",
    { p_section: section },
  );
  throwRpc(error);
  return data ?? [];
}

export async function runModerationAction({ queueType, recordId, action, reason = "" }) {
  const { data, error } = await supabase.rpc("issue_3720_admin_moderate", {
    p_queue_type: queueType,
    p_record_id: recordId,
    p_action: action,
    p_reason: reason,
  });
  throwRpc(error);
  return data === true;
}

export async function moderateCommunityItem({ queueType, recordId, action }) {
  const { data, error } = await supabase.rpc(
    "issue_3720_community_moderate",
    {
      p_queue_type: queueType,
      p_record_id: recordId,
      p_action: action,
    },
  );
  throwRpc(error);
  return data === true;
}

export async function getCommunityCutoverStatus() {
  const { data, error } = await supabase.rpc(
    "issue_3720_community_cutover_status",
  );
  throwRpc(error);
  return data;
}

export async function recordCommunityCutoverEvidence({ key, state, evidenceRef }) {
  const { data, error } = await supabase.rpc(
    "issue_3720_community_record_cutover_evidence",
    { p_key: key, p_state: state, p_evidence_ref: evidenceRef },
  );
  throwRpc(error);
  return data === true;
}

// ── Support online + availability ────────────────────────────────────────────

export async function fetchSupportIsOnline() {
  const { data, error } = await supabase.rpc("support_is_online");
  if (error) throw error;
  return Boolean(data);
}

export async function setSupportAvailable(available) {
  const { data, error } = await supabase.rpc("support_set_available", {
    p_available: Boolean(available),
  });
  if (error) throw error;
  return Boolean(data);
}

export async function listSupportStaffRoster() {
  const { data, error } = await supabase
    .from("support_staff")
    .select("user_id, role, enabled, available, display_name, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAdminTeamRoster() {
  const { data, error } = await supabase.rpc("issue_3720_admin_team_roster");
  throwRpc(error);
  return data ?? [];
}

// ── Overview helpers ─────────────────────────────────────────────────────────

export async function countOpenSupportTickets() {
  const { count, error } = await supabase
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .in("status", ["new", "open", "pending"]);
  if (error) throw error;
  return count ?? 0;
}

export async function countDraftAnnouncements() {
  const { count, error } = await supabase
    .from("community_announcements")
    .select("id", { count: "exact", head: true })
    .eq("status", "draft");
  if (error) throw error;
  return count ?? 0;
}

export async function getAdminCommunityOverview() {
  const { data, error } = await supabase.rpc("issue_3720_admin_overview");
  throwRpc(error);
  return data ?? {};
}

// ── Official Brand groups ───────────────────────────────────────────────────

export async function listOfficialBrandGroups() {
  const { data, error } = await supabase.rpc("issue_3720_list_brand_groups");
  if (error) throw error;
  return (data ?? []).map((group) => ({
    ...group,
    unread_count: Number(group.unread_count || 0),
    member_count: Number(group.member_count || 0),
  }));
}

export async function listOfficialBrandGroupMessages(conversationId) {
  const { data, error } = await supabase.rpc("issue_3720_list_brand_group_messages", {
    p_conversation_id: conversationId,
    p_limit: 200,
    p_before: null,
  });
  if (error) throw error;
  return (data ?? []).slice().reverse();
}

export async function markOfficialBrandGroupRead(conversationId) {
  const { error } = await supabase.rpc("issue_3720_mark_brand_group_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function setOfficialBrandGroupWatch(conversationId, enabled) {
  const { data, error } = await supabase.rpc("issue_3720_set_brand_group_watch", {
    p_conversation_id: conversationId,
    p_enabled: Boolean(enabled),
  });
  if (error) throw error;
  return data === true;
}

export async function sendOfficialBrandGroupMessage({
  conversationId,
  content,
  replyToId = null,
  relatedMessageIds = [],
}) {
  const { data, error } = await supabase.rpc("issue_3720_send_brand_group_message", {
    p_conversation_id: conversationId,
    p_content: content,
    p_reply_to_id: replyToId,
    p_related_message_ids: relatedMessageIds,
    p_actor_mode: "support",
  });
  if (error) throw error;
  return data;
}

const ALLOWED_FILE_MIMES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
  "video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-m4a",
  "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/csv", "application/csv",
]);

export async function prepareOfficialBrandGroupFiles(conversationId, files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 10) throw new Error("Choose up to 10 files at a time.");
  const total = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (total > 250 * 1024 * 1024) throw new Error("Choose files totaling no more than 250 MB.");
  for (const file of files) {
    if (!ALLOWED_FILE_MIMES.has(String(file.type || "").toLowerCase())) throw new Error(`${file.name} is not a supported file type.`);
    if (file.size < 1 || file.size > 100 * 1024 * 1024) throw new Error(`${file.name} must be between 1 byte and 100 MB.`);
  }
  const { data, error } = await supabase.rpc("issue_3720_prepare_brand_group_files", {
    p_conversation_id: conversationId,
    p_actor_mode: "support",
    p_files: files.map((file) => ({ name: file.name, mime_type: file.type, size_bytes: file.size })),
  });
  if (error) throw error;
  return (data ?? []).map((row, index) => ({
    fileId: row.file_id,
    storagePath: row.storage_path,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    file: files[index],
  }));
}

export async function uploadOfficialBrandGroupFile(prepared, onProgress) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your admin session expired. Sign in again to continue.");
  const path = prepared.storagePath.split("/").map(encodeURIComponent).join("/");
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/brand-group-file-staging/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Content-Type", prepared.mimeType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new Error("Upload interrupted. Try again."));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) || xhr.status === 409
      ? resolve()
      : reject(new Error("Upload failed. Try again."));
    xhr.send(prepared.file);
  });
  onProgress(1);
}

export async function finalizeOfficialBrandGroupFile(fileId) {
  const { data, error } = await invokeWithRefresh("brand-group-files", {
    body: { action: "finalize", file_id: fileId },
  });
  if (error) throw error;
  if (data?.code) throw new Error(data.code === "DRIVE_NOT_READY" ? "The shared Drive folder is still being prepared. Try again shortly." : "Couldn't finish this file. Try again.");
  return data?.message_id ?? null;
}

export async function openOfficialBrandGroupFile(fileId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your admin session expired. Sign in again to continue.");
  const response = await fetch(`${SUPABASE_URL}/functions/v1/brand-group-files?file_id=${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 404 ? "You no longer have access to this file." : "Couldn't open this file.");
  return URL.createObjectURL(await response.blob());
}
