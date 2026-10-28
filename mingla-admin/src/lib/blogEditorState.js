import { BLOG_READINESS_CHECKS, blogDocumentReferences, validateBlogDocument } from "../../../packages/blog-document/src/index.ts";

export function createBlock(type, fields = {}) {
  return { id: crypto.randomUUID().replaceAll("-", "").slice(0, 12), type, ...fields };
}

export function insertBlogBlock(blocks, block, afterId = null) {
  const next = [...blocks];
  const at = afterId ? next.findIndex((item) => item.id === afterId) + 1 : next.length;
  next.splice(Math.max(0, at), 0, block);
  return next;
}
export function moveBlogBlock(blocks, blockId, direction) {
  const from = blocks.findIndex((item) => item.id === blockId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= blocks.length) return blocks;
  const next = [...blocks];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
export function removeBlogBlock(blocks, blockId) { return blocks.filter((item) => item.id !== blockId); }
export function updateBlogBlock(blocks, blockId, patch) { return blocks.map((item) => item.id === blockId ? { ...item, ...patch } : item); }

function plainText(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function inlineHtml(block) {
  if (typeof block.html === "string") return block.html;
  if (Array.isArray(block.items)) return block.items.join("<br>");
  if (typeof block.text === "string") return block.text;
  return "";
}

export function convertBlogBlock(block, target) {
  if (!block) return block;
  const html = inlineHtml(block);
  if (target === "paragraph") return { id: block.id, type: "paragraph", html };
  if (target === "heading-2" || target === "heading-3") {
    return { id: block.id, type: "heading", level: target === "heading-2" ? 2 : 3, text: plainText(html) };
  }
  if (target === "bullet-list" || target === "numbered-list") {
    return { id: block.id, type: "list", ordered: target === "numbered-list", items: Array.isArray(block.items) ? block.items : [html] };
  }
  if (target === "quote") return { id: block.id, type: "quote", html, cite: block.cite || "" };
  if (target === "callout") return { id: block.id, type: "callout", html, tone: block.tone === "tip" ? "tip" : "note" };
  return block;
}

export function blogBlockReducer(state, action) {
  const present = state.present || [];
  if (action.type === "undo" && state.past?.length) return { past: state.past.slice(0, -1), present: state.past.at(-1), future: [present, ...(state.future || [])] };
  if (action.type === "redo" && state.future?.length) return { past: [...(state.past || []), present].slice(-50), present: state.future[0], future: state.future.slice(1) };
  let next = present;
  if (action.type === "insert") next = insertBlogBlock(present, action.block, action.afterId);
  if (action.type === "move") next = moveBlogBlock(present, action.blockId, action.direction);
  if (action.type === "remove") next = removeBlogBlock(present, action.blockId);
  if (action.type === "update") next = updateBlogBlock(present, action.blockId, action.patch);
  if (action.type === "convert") next = present.map((item) => item.id === action.blockId ? convertBlogBlock(item, action.target) : item);
  if (action.type === "replace") return { past: [], present: action.blocks || [], future: [] };
  if (next === present) return state;
  return { past: [...(state.past || []), present].slice(-50), present: next, future: [] };
}

export function scheduleBlogAutosave(callback, delay = 1200) {
  const timer = window.setTimeout(callback, delay);
  return () => window.clearTimeout(timer);
}

export function evaluateBlogReadiness({ post, draft, media = {}, linkCheck }) {
  const validation = validateBlogDocument(draft?.document || { version: 1, blocks: [] });
  const refs = blogDocumentReferences(draft?.document || { version: 1, blocks: [] });
  const cover = media[draft?.cover_media_id];
  const states = {
    title: Boolean(draft?.title?.trim()), category: Boolean(post?.category_slug),
    slug: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(post?.slug || ""),
    cover_present: Boolean(draft?.cover_media_id && draft?.cover_alt?.trim()),
    cover_size: Boolean(cover && cover.width >= 1600 && cover.height >= 900 && cover.width / cover.height >= 1.5 && cover.width / cover.height <= 2.4),
    image_alt: !validation.errors?.some((problem) => problem.includes("alt")),
    image_source: refs.mediaIds.every((id) => Boolean(media[id]?.source_ref)),
    links_live: Boolean(linkCheck?.ok), places_live: true, offerings_public: true, city_links: true,
    seo_lengths: (!draft?.seo_title || draft.seo_title.length <= 60) && (!draft?.seo_description || draft.seo_description.length <= 160),
  };
  return BLOG_READINESS_CHECKS.map((check) => ({ ...check, ok: Boolean(states[check.id]) }));
}
