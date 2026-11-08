// #4318 — Links page custom strips. Reads and writes go only through the
// SECURITY DEFINER admin RPCs (Support area, the same guard as the tab), plus
// the Blog tab's own post reader for the blog picker.
//
// Each export names its RPC literally: the #3988 tab-contract suite reads the
// exported bodies to list what the Links page tab reaches.
import { supabase } from "../lib/supabase";

export class LinksStripsError extends Error {
  constructor(code, message, { detail = null } = {}) {
    super(message || code);
    this.name = "LinksStripsError";
    this.code = code;
    this.detail = detail;
  }
}

/** The error a failed RPC becomes: stale, not_ready, forbidden or request_failed. */
export function toLinksStripsError(error) {
  const message = String(error?.message || "links_strips_request_failed");
  const detail = error?.details || error?.detail || null;
  if (error?.code === "PT409" || /stale/i.test(message)) return new LinksStripsError("stale", message, { detail });
  if (["42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error?.code)) {
    return new LinksStripsError("not_ready", message, { detail });
  }
  if (["42501", "PT403"].includes(error?.code) || /forbidden|not_authorized|permission/i.test(message)) {
    return new LinksStripsError("forbidden", message, { detail });
  }
  return new LinksStripsError(error?.code || "request_failed", message, { detail });
}

/** Plain words for a Links page error, for toasts and inline errors. */
export function linksStripsErrorMessage(error) {
  switch (error?.code) {
    case "stale":
      return "Someone else changed the strips at the same time. The list has been reloaded; try again.";
    case "not_ready":
      return "The Links page strips aren't switched on yet: the database migration must be applied first.";
    case "forbidden":
      return "Your account can't change the Links page. Ask an Admin for Support access.";
    default:
      return error?.message && !/^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "The server didn't accept that. Check your connection and try again.";
  }
}

export async function listLinksStrips() {
  const { data, error } = await supabase.rpc("admin_links_strips_list");
  if (error) throw toLinksStripsError(error);
  return data;
}

export async function saveLinksStrip(args) {
  const { data, error } = await supabase.rpc("admin_links_strip_save", args);
  if (error) throw toLinksStripsError(error);
  return data;
}

export async function deleteLinksStrip(id) {
  const { data, error } = await supabase.rpc("admin_links_strip_delete", { p_id: id });
  if (error) throw toLinksStripsError(error);
  return data;
}

export async function reorderLinksStrips(ids) {
  const { data, error } = await supabase.rpc("admin_links_strips_reorder", { p_ids: ids });
  if (error) throw toLinksStripsError(error);
  return data;
}

/**
 * Posts a strip may open: the Blog tab's own reader, published filter, and
 * only posts whose derived state is published now (never drafts, scheduled,
 * taken down or unpublished posts).
 */
export async function listPublishedBlogPostsForLinks() {
  const { data, error } = await supabase.rpc("issue_4137_blog_list_posts", {
    p_status: "published", p_query: null, p_limit: 100, p_offset: 0,
  });
  if (error) throw toLinksStripsError(error);
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  return posts.filter((post) => post?.derived_state === "published" && post.id && post.title);
}
