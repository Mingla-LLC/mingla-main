// #4636 build 2 — the RPC contract the Website pages editor (build 3) calls,
// in one place. Pages keep the #4452 calls in websitePagesService.js (draft,
// publish, history, restore, preview token); this adds block-list pages,
// staff-made pages, the site-wide nav and footer, and the media library.
//
// No Supabase import: the page passes its client (siteCms(supabase)), so the
// module runs under node:test. Every call throws SiteCmsError with the
// database's code (42501 not allowed, PT409 conflict / address taken,
// 22023 invalid, P0002 not found) and a plain-English message.
//
// Media library uploads (the browser resizes images first; no Supabase Image
// Transformations, hold #1643):
//   image  site-media/library/<id>.jpg   + site-media/library/<id>_thumb.jpg
//   video  site-video/library/<id>.mp4   + site-media/library/<id>_poster.jpg   (MP4, at most 50 MB and 60 s)
// then registerMedia(id, …) records it (the bytes are read from storage).
// The database refuses every upload into these buckets once usage reaches 90 %
// of 5 GB; mediaUsage() drives the meter (warn at 70 %).

export const SITE_SETTINGS_KEY = "site-settings";
export const PAGE_FORMATS = Object.freeze(["landing", "host-type", "programme", "story", "blank"]);
export const VIDEO_MAX_BYTES = 52428800;
export const VIDEO_MAX_SECONDS = 60;
export const IMAGE_MAX_BYTES = 5242880;

const MESSAGES = Object.freeze({
  "42501": "You can view this page. Ask a website editor to change it.",
  page_draft_conflict: "Someone else changed this page. Reload to see their version.",
  page_conflict: "Someone else published this page first. Reload to see their version.",
  path_reserved: "That address is already used.",
  path_taken: "That address is already used.",
  path_locked: "A published page keeps its address.",
  bad_path: "Use lowercase letters, numbers and hyphens, at most two parts (like /summer-socials).",
  invalid_content: "Something on this page isn't allowed. Check the highlighted block.",
  media_in_use: "A live page uses this file. Remove it from the page first.",
  media_not_uploaded: "The upload didn't finish. Try again.",
  media_too_large: "That file is too large.",
  video_too_long: "Videos can be at most 60 seconds.",
  bad_alt: "Describe the picture in plain words (up to 200 characters).",
  redirect_to_self: "A page can't send visitors to itself.",
  bad_redirect: "Send visitors to a page on usemingla.com.",
});

export class SiteCmsError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "SiteCmsError";
    this.code = code;
    this.detail = detail;
  }
}

/** The database error as { code, message, detail }: the RAISE word (path_taken…) wins over the SQLSTATE. */
export function siteCmsError(error) {
  const word = typeof error?.message === "string" && /^[a-z_]+$/.test(error.message) ? error.message : null;
  let detail = error?.details ?? null;
  try {
    detail = typeof detail === "string" && detail.startsWith("{") ? JSON.parse(detail) : detail;
  } catch {
    /* keep the raw detail */
  }
  const code = word ?? error?.code ?? "server";
  const message = MESSAGES[word] ?? MESSAGES[error?.code] ?? "Something on the server failed. Try again.";
  return new SiteCmsError(code, message, detail);
}

/** Storage paths for a library item (the database expects exactly these). */
export function libraryPaths(id, kind) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id))) throw new SiteCmsError("bad_media", "Not a media id.");
  if (kind === "image") {
    return { file: { bucket: "site-media", path: `library/${id}.jpg`, contentType: "image/jpeg" }, still: { bucket: "site-media", path: `library/${id}_thumb.jpg`, contentType: "image/jpeg" } };
  }
  if (kind === "video") {
    return { file: { bucket: "site-video", path: `library/${id}.mp4`, contentType: "video/mp4" }, still: { bucket: "site-media", path: `library/${id}_poster.jpg`, contentType: "image/jpeg" } };
  }
  throw new SiteCmsError("bad_media", "Pick a picture or a video.");
}

/** A refusal before any network call: wrong type, too large or too long. null = fine. */
export function mediaPickProblem({ kind, type, bytes, seconds }) {
  if (kind === "video") {
    if (type !== "video/mp4") return "Videos must be MP4.";
    if (bytes > VIDEO_MAX_BYTES) return "Videos can be at most 50 MB.";
    if (!(seconds > 0) || seconds > VIDEO_MAX_SECONDS) return MESSAGES.video_too_long;
    return null;
  }
  if (kind === "image") return bytes > IMAGE_MAX_BYTES ? "Pictures can be at most 5 MB after resizing." : null;
  return "Pick a picture or a video.";
}

/** The RPC calls, bound to a Supabase client. */
export function siteCms(client) {
  const rpc = async (name, args = {}) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw siteCmsError(error);
    return data;
  };
  return {
    // Staff-made pages.
    createPage: (path, name, format, sections = null) => rpc("admin_site_page_create", { p_path: path, p_name: name, p_format: format, p_sections: sections }),
    updatePageMeta: (pageKey, patch) => rpc("admin_site_page_update_meta", { p_page_key: pageKey, p_patch: patch }),
    deletePage: (pageKey, redirectTo = "/") => rpc("admin_site_page_delete", { p_page_key: pageKey, p_redirect_to: redirectTo }),
    // Media library.
    mediaList: (kind = null, includeArchived = false) => rpc("admin_site_media_list", { p_kind: kind, p_include_archived: includeArchived, p_limit: 200 }),
    registerMedia: (id, kind, width, height, durationSeconds, alt) =>
      rpc("admin_site_media_register", { p_id: id, p_kind: kind, p_width: width, p_height: height, p_duration_seconds: kind === "video" ? durationSeconds : null, p_alt: alt }),
    updateMediaAlt: (id, alt) => rpc("admin_site_media_update", { p_id: id, p_alt: alt }),
    archiveMedia: (id) => rpc("admin_site_media_archive", { p_id: id }),
    mediaUsage: () => rpc("admin_site_media_usage"),
    /** Upload one library file (no upsert: a library path is written once). */
    async upload(target, blob) {
      const { error } = await client.storage.from(target.bucket).upload(target.path, blob, { contentType: target.contentType, upsert: false });
      if (error) throw new SiteCmsError(/row-level security|policy/i.test(error.message ?? "") ? "storage_full_or_denied" : "upload_failed",
        /row-level security|policy/i.test(error.message ?? "") ? "Uploads are paused: the site's storage is nearly full, or you can't upload." : "The upload didn't finish. Try again.");
      return target;
    },
    /** Refresh the site after a publish / restore / delete of one page (or 'site-settings'). */
    async revalidate(pageKey) {
      const { data, error } = await client.functions.invoke("admin-blog", { body: { action: "revalidate_page", pageKey } });
      if (error || data?.ok !== true) throw new SiteCmsError("revalidate_failed", "The page did not refresh.");
      return true;
    },
  };
}
