// #4137 — resolve blog references from the database immediately before every
// preview, campaign creation and send. Client snapshots are display-only and
// are never rendered into recipient mail (I-4137-EMAIL-BLOG-RESOLVED-SERVER-SIDE).
import type { EmailContentBlock } from "./types.ts";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
};
type BlogQueryClient = { from: (table: string) => any };

export class BlogPostBlockError extends Error {
  code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = "BlogPostBlockError";
    this.code = code;
  }
}

function notReady(error: QueryResult["error"]) {
  return /42P01|PGRST20[245]|relation .* does not exist/i.test(
    `${error?.code ?? ""} ${error?.message ?? ""}`,
  );
}

function publicObjectUrl(
  path: string,
  supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "",
) {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  return `${
    supabaseUrl.replace(/\/+$/, "")
  }/storage/v1/object/public/blog-media/${safePath}`;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function resolvedFromRow(
  row: any,
  block: Extract<EmailContentBlock, { type: "blog_post" }>,
  supabaseUrl?: string,
): EmailContentBlock {
  const version = one<any>(row.version);
  const category = one<any>(row.category);
  const cover = one<any>(version?.cover);
  return {
    id: block.id,
    type: "blog_post_resolved",
    postId: block.postId,
    style: block.style,
    buttonText: block.buttonText,
    url: `https://usemingla.com/blog/${row.slug}`,
    title: version.title,
    summary: version.summary,
    categoryLabel: category?.label ?? "Mingla",
    readMinutes: Number(version.read_minutes || 1),
    coverUrl: cover?.storage_path
      ? publicObjectUrl(cover.storage_path, supabaseUrl)
      : null,
    coverAlt: version.cover_alt || cover?.alt || "",
    versionId: version.id,
  };
}

async function queryBlogRows(
  supabase: BlogQueryClient,
  ids: string[],
  publicOnly: boolean,
): Promise<any[]> {
  if (!ids.length) return [];
  let query = supabase.from("blog_posts").select(`
    id,slug,status,publish_at,take_down_at,deleted_at,published_version_id,
    category:blog_categories!inner(label),
    version:blog_post_versions!blog_posts_published_version_fk!inner(
      id,title,summary,read_minutes,cover_alt,
      cover:blog_media!blog_post_versions_cover_media_id_fkey(storage_path,alt)
    )
  `).in("id", ids);
  if (publicOnly) {
    const now = new Date().toISOString();
    query = query.eq("status", "published").is("deleted_at", null).not(
      "published_version_id",
      "is",
      null,
    )
      .lte("publish_at", now).or(`take_down_at.is.null,take_down_at.gt.${now}`);
  }
  const { data, error } = await query as QueryResult;
  if (error) {
    throw new BlogPostBlockError(
      notReady(error) ? "blog_not_ready" : "blog_post_query_failed",
      error.message,
    );
  }
  return Array.isArray(data) ? data : [];
}

export async function resolveBlogPostBlocks(
  supabase: BlogQueryClient,
  document: EmailContentBlock[],
  supabaseUrl?: string,
): Promise<{ document: EmailContentBlock[]; missing: string[] }> {
  const ids = [
    ...new Set(
      document.filter((block) => block.type === "blog_post").map((block: any) =>
        block.postId
      ),
    ),
  ];
  const rows = await queryBlogRows(supabase, ids, true);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !byId.has(id));
  return {
    document: document.map((block) =>
      block.type === "blog_post" && byId.has(block.postId)
        ? resolvedFromRow(byId.get(block.postId), block, supabaseUrl)
        : block
    ),
    missing,
  };
}

export function snapshotsFromResolved(
  reference: EmailContentBlock[],
  resolved: EmailContentBlock[],
): EmailContentBlock[] {
  const byId = new Map(
    resolved.filter((block) => block.type === "blog_post_resolved").map((
      block: any,
    ) => [block.postId, block]),
  );
  return reference.map((block) => {
    if (block.type !== "blog_post") return block;
    const live = byId.get(block.postId) as
      | Extract<EmailContentBlock, { type: "blog_post_resolved" }>
      | undefined;
    return live
      ? {
        ...block,
        snapshot: {
          slug: live.url.split("/").at(-1) || "",
          title: live.title,
          summary: live.summary,
          categoryLabel: live.categoryLabel,
          readMinutes: live.readMinutes,
          coverUrl: live.coverUrl,
          coverAlt: live.coverAlt,
          versionId: live.versionId,
        },
      }
      : block;
  });
}

export async function listBlogPostOptions(
  supabase: BlogQueryClient,
  { query = "", ids = [], supabaseUrl, staffPosts }: {
    query?: string;
    ids?: string[];
    supabaseUrl?: string;
    staffPosts?: any[];
  } = {},
) {
  const requestedIds = ids.length
    ? ids
    : (staffPosts ?? []).map((post) => post.id).filter(Boolean);
  if (!requestedIds.length && staffPosts) return [];
  let request = supabase.from("blog_posts").select(`
    id,slug,status,publish_at,take_down_at,deleted_at,draft_version_id,published_version_id,
    category:blog_categories!inner(label),
    published:blog_post_versions!blog_posts_published_version_fk(id,title,summary,read_minutes,cover_alt,cover:blog_media!blog_post_versions_cover_media_id_fkey(storage_path,alt)),
    draft:blog_post_versions!blog_posts_draft_version_fk(id,title,summary,read_minutes,cover_alt,cover:blog_media!blog_post_versions_cover_media_id_fkey(storage_path,alt))
  `).is("deleted_at", null).order("publish_at", {
    ascending: false,
    nullsFirst: false,
  }).limit(20);
  if (requestedIds.length) request = request.in("id", requestedIds);
  else if (query.trim()) {
    request = request.ilike("slug", `%${query.trim().replace(/[%,()]/g, "")}%`);
  }
  const { data, error } = await request as QueryResult;
  if (error) {
    throw new BlogPostBlockError(
      notReady(error) ? "blog_not_ready" : "blog_post_query_failed",
      error.message,
    );
  }
  const now = Date.now();
  const staffById = new Map((staffPosts ?? []).map((post) => [post.id, post]));
  const order = new Map(requestedIds.map((id, index) => [id, index]));
  return (Array.isArray(data) ? data : []).map((row: any) => {
    const published = one<any>(row.published);
    const draft = one<any>(row.draft);
    const version = published ?? draft;
    const category = one<any>(row.category);
    const cover = one<any>(version?.cover);
    const staff = staffById.get(row.id) as any;
    const publishAt = row.publish_at ? new Date(row.publish_at).getTime() : 0;
    const takeDownAt = row.take_down_at
      ? new Date(row.take_down_at).getTime()
      : null;
    const state = staff?.derived_state ??
      (row.status === "published" && publishAt > now
        ? "scheduled"
        : row.status === "published" && takeDownAt !== null && takeDownAt <= now
        ? "taken_down"
        : row.status);
    const available = state === "published" && Boolean(published);
    const reason = state === "scheduled"
      ? `Scheduled for ${
        new Date(row.publish_at).toLocaleString("en", {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })
      }. Can be added once it's published.`
      : state === "draft" || state === "in_review"
      ? "Not published yet."
      : state === "taken_down" || state === "unpublished"
      ? "Taken down from the blog."
      : null;
    return {
      postId: row.id,
      slug: row.slug,
      title: available ? published.title : staff?.title || version?.title || row.slug,
      summary: version?.summary || "",
      categoryLabel: category?.label || "Mingla",
      readMinutes: Number(version?.read_minutes || 1),
      coverUrl: cover?.storage_path
        ? publicObjectUrl(cover.storage_path, supabaseUrl)
        : null,
      coverAlt: version?.cover_alt || cover?.alt || "",
      versionId: published?.id || version?.id || "",
      publishedAt: row.publish_at,
      state,
      available,
      reason,
    };
  }).sort((a: any, b: any) =>
    (order.get(a.postId) ?? 999) - (order.get(b.postId) ?? 999)
  );
}

export function renderBlogPostBlockText(
  block: Extract<EmailContentBlock, { type: "blog_post_resolved" }>,
) {
  return block.style === "link"
    ? `${block.title}: ${block.url}`
    : `${block.title}\n${block.summary}\n${block.buttonText}: ${block.url}`;
}
