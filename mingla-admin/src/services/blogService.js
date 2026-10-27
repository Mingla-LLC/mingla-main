import { invokeWithRefresh, SUPABASE_URL, supabase } from "../lib/supabase";

export class BlogServiceError extends Error {
  constructor(code, message, { detail = null, failedChecks = [] } = {}) {
    super(message || code);
    this.name = "BlogServiceError";
    this.code = code;
    this.detail = detail;
    this.failedChecks = failedChecks;
  }
}

function parseFailedChecks(detail) {
  try {
    const value = JSON.parse(detail || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toBlogError(error) {
  const message = String(error?.message || "blog_request_failed");
  const detail = error?.details || error?.detail || null;
  if (error?.code === "PT409" || /blog_post_stale/i.test(message)) {
    return new BlogServiceError("stale", message, { detail });
  }
  if (/blog_not_ready/i.test(message) || ["42P01", "PGRST202", "PGRST204", "PGRST205"].includes(error?.code)) {
    return new BlogServiceError("blog_not_ready", message, { detail, failedChecks: parseFailedChecks(detail) });
  }
  return new BlogServiceError(error?.code || "request_failed", message, { detail });
}

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw toBlogError(error);
  return data;
}

export const getBlogPermissions = () => rpc("issue_4137_blog_my_permissions");
export const listBlogPosts = ({ status = null, query = null, limit = 50, offset = 0 } = {}) =>
  rpc("issue_4137_blog_list_posts", { p_status: status, p_query: query, p_limit: limit, p_offset: offset });
export const getBlogPost = (postId) => rpc("issue_4137_blog_get_post", { p_post_id: postId });
export const createBlogPost = (title, category) => rpc("issue_4137_blog_create_post", { p_title: title, p_category: category });
export const saveBlogDraft = (postId, expectedRevision, patch) => rpc("issue_4137_blog_save_draft", { p_post_id: postId, p_expected_revision: expectedRevision, p_patch: patch });
export const submitBlogPostForReview = (postId, expectedRevision) => rpc("issue_4137_blog_submit_for_review", { p_post_id: postId, p_expected_revision: expectedRevision });
export const requestBlogPostChanges = (postId, expectedRevision, note) => rpc("issue_4137_blog_request_changes", { p_post_id: postId, p_expected_revision: expectedRevision, p_note: note });
export const publishBlogPost = (postId, expectedRevision, publishAt, featured) => rpc("issue_4137_blog_publish", { p_post_id: postId, p_expected_revision: expectedRevision, p_publish_at: publishAt, p_featured: featured });
export const unpublishBlogPost = (postId, expectedRevision) => rpc("issue_4137_blog_unpublish", { p_post_id: postId, p_expected_revision: expectedRevision });
export const setFeaturedBlogPost = (postId) => rpc("issue_4137_blog_set_featured", { p_post_id: postId });
export const getFeaturedBlogPost = () => rpc("issue_4137_blog_featured_now");
export const deleteBlogPost = (postId) => rpc("issue_4137_blog_delete_post", { p_post_id: postId });
export const createBlogPreviewToken = (postId) => rpc("issue_4137_blog_create_preview_token", { p_post_id: postId });
export const listBlogMedia = ({ query = null, limit = 40, offset = 0 } = {}) => rpc("issue_4137_blog_list_media", { p_query: query, p_limit: limit, p_offset: offset });
export const updateBlogMedia = (mediaId, { alt, source, sourceRef }) => rpc("issue_4137_blog_update_media", { p_media_id: mediaId, p_alt: alt, p_source: source, p_source_ref: sourceRef });
export const deleteBlogMedia = (mediaId) => rpc("issue_4137_blog_delete_media", { p_media_id: mediaId });
export const searchBlogLinkTargets = (query, kind) => rpc("issue_4137_blog_search_link_targets", { p_query: query, p_kind: kind });

export async function checkBlogLinks(postId) {
  const { data, error } = await invokeWithRefresh("admin-blog", { body: { action: "check_links", postId } });
  if (error) throw toBlogError(error);
  if (data?.error) throw new BlogServiceError(data.error, data.error);
  return data;
}

export async function revalidateBlog() {
  const { data, error } = await invokeWithRefresh("admin-blog", { body: { action: "revalidate" } });
  if (error) throw toBlogError(error);
  return data;
}

async function jpegForBlog(file) {
  const bitmap = await createImageBitmap(file);
  const longSide = Math.max(bitmap.width, bitmap.height);
  if (longSide < 800) {
    bitmap.close();
    throw new BlogServiceError("image_too_small", "Use a photo at least 800px on its longest side.");
  }
  const scale = Math.min(1, 2400 / longSide);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new BlogServiceError("image_encode_failed", "The photo could not be prepared.");
  if (blob.size > 5 * 1024 * 1024) throw new BlogServiceError("image_too_large", "The prepared photo is over 5 MB.");
  return { blob, width, height };
}

export async function uploadBlogImage(file, { alt, source, sourceRef }) {
  if (!file?.type?.startsWith("image/")) throw new BlogServiceError("image_invalid", "Choose a JPG, PNG or WebP image.");
  if (!String(alt || "").trim() || !String(sourceRef || "").trim()) throw new BlogServiceError("media_details_required", "Alt text and a source reference are required.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new BlogServiceError("unauthorized", "Sign in again to upload.");
  const mediaId = crypto.randomUUID();
  const path = `${user.id}/${mediaId}.jpg`;
  const prepared = await jpegForBlog(file);
  const { error: uploadError } = await supabase.storage.from("blog-media").upload(path, prepared.blob, { contentType: "image/jpeg", upsert: false });
  if (uploadError) throw toBlogError(uploadError);
  try {
    return await rpc("issue_4137_blog_register_media", {
      p_media_id: mediaId,
      p_storage_path: path,
      p_mime: "image/jpeg",
      p_width: prepared.width,
      p_height: prepared.height,
      p_bytes: prepared.blob.size,
      p_alt: alt.trim(),
      p_source: source,
      p_source_ref: sourceRef.trim(),
    });
  } catch (error) {
    await supabase.storage.from("blog-media").remove([path]);
    throw error;
  }
}

export function blogMediaUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/blog-media/${String(path || "").split("/").map(encodeURIComponent).join("/")}`;
}
