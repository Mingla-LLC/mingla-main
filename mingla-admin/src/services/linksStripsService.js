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

// Server refusals from the admin_links_* RPCs (migration 20280505004318):
// each becomes plain copy and, where it names a form field, that field.
const SERVER_REFUSALS = Object.freeze({
  links_title_invalid: { field: "title", message: "Add a title of up to 60 characters." },
  links_url_invalid: { field: "url", message: "Enter a web link like usemingla.com/host." },
  links_shows_on_invalid: { field: "showsOn", message: "Pick today or a later day." },
  links_blog_post_invalid: { field: "blog", message: "Choose a published blog post." },
  links_city_invalid: { field: "city", message: "Pick a city from the list." },
  links_label_invalid: { field: "label", message: "Pick an option from the list." },
  links_opens_invalid: { field: "opens", message: "Pick an option from the list." },
});

const STALE_MESSAGE = "The list changed and has been reloaded.";

function isNetworkFailure(error) {
  if (error?.code) return false;
  const message = String(error?.message || "");
  return error?.name === "TypeError" || /failed to fetch|network ?error|load failed|fetch failed|networkerror/i.test(message);
}

/**
 * The error a failed RPC becomes. code is one of: a links_* refusal (with its
 * field), stale (stale order or a strip that is gone), not_ready, forbidden,
 * network, or request_failed.
 */
export function toLinksStripsError(error) {
  const message = String(error?.message || "links_strips_request_failed");
  const detail = error?.details || error?.detail || null;
  const reason = (message.match(/\blinks_[a-z_]+\b/) || [])[0] || null;
  if (reason && Object.hasOwn(SERVER_REFUSALS, reason)) {
    const result = new LinksStripsError(reason, message, { detail });
    result.field = SERVER_REFUSALS[reason].field;
    return result;
  }
  if (error?.code === "PT409" || reason === "links_strips_stale" || reason === "links_strip_not_found") {
    return new LinksStripsError("stale", message, { detail });
  }
  if (reason === "links_forbidden" || ["42501", "PT403"].includes(error?.code)) {
    return new LinksStripsError("forbidden", message, { detail });
  }
  if (["42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error?.code)) {
    return new LinksStripsError("not_ready", message, { detail });
  }
  if (isNetworkFailure(error)) return new LinksStripsError("network", message, { detail });
  return new LinksStripsError(error?.code || "request_failed", message, { detail });
}

/** Plain words for a Links page error, for toasts and inline errors. */
export function linksStripsErrorMessage(error) {
  if (error?.code && Object.hasOwn(SERVER_REFUSALS, error.code)) return SERVER_REFUSALS[error.code].message;
  switch (error?.code) {
    case "stale":
      return STALE_MESSAGE;
    case "not_ready":
      return "The Links page strips aren't switched on yet: the database migration must be applied first.";
    case "forbidden":
      return "You don't have access to edit the links page. Ask an Admin for Support access.";
    case "network":
      return "The server couldn't be reached. Check your connection and try again.";
    default:
      return "The server didn't accept that change. Try again, and tell engineering if it keeps happening.";
  }
}

/** The form field a server refusal names, or null. */
export function linksStripsErrorField(error) {
  return error?.code && Object.hasOwn(SERVER_REFUSALS, error.code) ? SERVER_REFUSALS[error.code].field : null;
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
