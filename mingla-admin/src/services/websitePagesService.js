// #4452 §7.6 — Admin › Communications › Website pages. The page list is the
// site's own manifest (https://usemingla.com/site-manifest.json, read with
// cache: no-store); drafts, publish, history, restore and preview tokens are
// the admin_site_page_* RPCs (forms_can_view to read, forms_can_edit to
// write); a publish then refreshes the site through admin-blog revalidate_page.
import { supabase } from "../lib/supabase";

// #4636: VITE_MARKETING_ORIGIN points a local Admin at a local site (the same variable the blog preview uses).
export const SITE_ORIGIN = String(import.meta.env?.VITE_MARKETING_ORIGIN || "https://usemingla.com").replace(/\/$/, "");

export class PagesError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "PagesError";
    this.code = code;
    this.detail = detail;
  }
}

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new PagesError(error.code || "server", error.message || "Something on the server failed.", error.details || null);
  return data;
}

/** The manifest the site builds (every public page, its spots, hero limits and `since`). */
export async function fetchManifest(origin = SITE_ORIGIN) {
  let res;
  try {
    res = await fetch(`${origin}/site-manifest.json`, { cache: "no-store", credentials: "omit" });
  } catch {
    throw new PagesError("manifest_unreachable", "Couldn't load the page list from usemingla.com.");
  }
  if (!res.ok) throw new PagesError("manifest_unreachable", "Couldn't load the page list from usemingla.com.");
  return res.json();
}

/** Every page's live version and draft state: [{ page_key, live, draft, revalidate_error }]. */
export const pagesState = () => rpc("admin_site_pages_state");
/** { live_content, live_version, draft_content, draft_rev, base_version, can_edit } */
export const getPage = (pageKey) => rpc("admin_site_page_get", { p_page_key: pageKey });
/** Raises PT409 on a stale rev. */
export const savePageDraft = (pageKey, rev, content) => rpc("admin_site_page_save_draft", { p_page_key: pageKey, p_expected_rev: rev, p_content: content });
export const discardPageDraft = (pageKey) => rpc("admin_site_page_discard_draft", { p_page_key: pageKey });
/** Raises PT409 with DETAIL {code:"page_conflict", by, at, version} when someone published first. */
export const publishPage = (pageKey, expectedLive, note = null) => rpc("admin_site_page_publish", { p_page_key: pageKey, p_expected_live_version: expectedLive, p_note: note });
export const pageHistory = (pageKey) => rpc("admin_site_page_history", { p_page_key: pageKey, p_limit: 50 });
export const restorePage = (pageKey, version, expectedLive) => rpc("admin_site_page_restore", { p_page_key: pageKey, p_version: version, p_expected_live_version: expectedLive });
/** A one-hour token for the draft content: { token, expires_at }. */
export const previewToken = (pageKey, content) => rpc("admin_site_page_create_preview_token", { p_page_key: pageKey, p_content: content });
export const markRevalidated = (pageKey, err) => rpc("admin_site_page_mark_revalidated", { p_page_key: pageKey, p_error: err });

/** Refresh the site's pages (forms, blocks, form pages). */
export async function revalidatePages() {
  const { data, error } = await supabase.functions.invoke("admin-blog", { body: { action: "revalidate_page" } });
  if (error || data?.ok !== true) throw new PagesError("revalidate_failed", "The page did not refresh.");
  return true;
}

/** Every page and spot (live or draft) that shows a form. */
export async function formPlacements(formId) {
  const state = await pagesState();
  const pages = await Promise.all((state || []).map(async (p) => ({ key: p.page_key, page: await getPage(p.page_key) })));
  const out = [];
  for (const { key, page } of pages) {
    for (const b of page.live_content?.blocks || []) if (b.form_id === formId) out.push({ page_key: key, spot: b.spot, state: "live" });
    for (const b of page.draft_content?.blocks || []) {
      if (b.form_id === formId && !out.some((o) => o.page_key === key && o.spot === b.spot && o.state === "live")) out.push({ page_key: key, spot: b.spot, state: "draft" });
    }
  }
  return out;
}

export function pagesErrorWords(error) {
  if (error?.code === "PT409") return "Someone else changed this page.";
  if (error?.code === "42501") return "You don't have edit access. Ask an admin for the Website editor role.";
  if (/spot_taken|one block/.test(error?.message || "")) return "That spot already has a block. Pick another spot or remove the other block.";
  if (/invalid_content/.test(error?.message || "")) return "Some of the words are too long or a button has no destination.";
  return error?.message || "That did not go through. Try again.";
}
