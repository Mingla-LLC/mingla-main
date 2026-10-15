/**
 * #3720 Slice F — admin Community RPCs (Slice E schema).
 *
 * Mutations go through SECURITY DEFINER RPCs only. List reads use PostgREST
 * under RLS (admins see drafts via is_admin_user() policies).
 */

import { supabase } from "../lib/supabase";

function throwRpc(error) {
  if (!error) return;
  const msg = error.message || String(error);
  if (/not_authorized/i.test(msg)) throw new Error("You need admin access for this action.");
  if (/not_found/i.test(msg)) throw new Error("That item was not found.");
  if (/invalid_title|invalid_lane|invalid_status|invalid_role/i.test(msg)) {
    throw new Error("Check the form fields and try again.");
  }
  if (/admin_use_is_admin_user/i.test(msg)) {
    throw new Error("Admins already have full community access — do not add them as community staff.");
  }
  throw new Error(msg);
}

// ── Announcements ────────────────────────────────────────────────────────────

export async function listAnnouncements() {
  const { data, error } = await supabase
    .from("community_announcements")
    .select("id, title, body_md, status, published_at, author_user_id, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function upsertAnnouncement({ id = null, title, bodyMd }) {
  const { data, error } = await supabase.rpc("community_upsert_announcement", {
    p_id: id,
    p_title: title,
    p_body_md: bodyMd,
  });
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
      "id, public_title, public_body, internal_note, lane, status, sort_order, created_at, updated_at",
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
