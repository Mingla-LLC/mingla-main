// #4137 — the blog's server-only data layer (imported only by Server
// Components and route handlers; it carries no secret, only the anon key).
//
// Same transport as lib/careers-data.ts: no supabase-js client, a raw fetch to
// PostgREST with the PUBLIC anon key. RLS and the public RPCs
// (supabase/migrations/20280122004137_issue_4137_blog_public_reads.sql) are the
// fence: anon can only ever read public posts and their published version.
//
// Caching: every public read is in the Data Cache for 5 minutes under the tag
// `blog`; POST /api/blog/revalidate drops the tag the moment a post is
// published or taken down. The preview read is never cached.
//
// No database configured (CI builds, verify-search-foundation): the index and
// sitemap are empty and a post is "not found", so the build never depends on
// a database. Configured but failing: throw, so the page shows its error state
// instead of a false "no stories" (Constitution #3, #9).

import type { BlogDocument } from '@mingla/blog-document'

// The transport reads the environment at RUNTIME (a computed key is never
// inlined by the bundler), so the same build can be pointed at another
// database, as the #4137 render test does with its fixture server.
function runtimeEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const env: Record<string, string | undefined> = process.env
  return (env[name] ?? '').trim()
}
function restUrl(): string { return runtimeEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '') }

// Read the media origin at runtime as well. The server-rendered metadata and
// body must follow the database selected for this process (including preview
// and release-test fixtures), rather than retaining the project URL from the
// machine that produced the build.
function mediaBase(): string {
  return (runtimeEnv('NEXT_PUBLIC_SUPABASE_URL') || 'https://gqnoajqerqhnvulmnyvv.supabase.co').replace(/\/$/, '')
}

export const BLOG_PAGE_SIZE = 12
export const BLOG_CACHE_TAG = 'blog'

export interface BlogCover {
  readonly path: string
  readonly width: number
  readonly height: number
  readonly alt: string
}

export interface BlogCard {
  readonly slug: string
  readonly title: string
  readonly summary: string
  readonly category: { readonly slug: string; readonly label: string }
  readonly read_minutes: number
  readonly publish_at: string
  readonly cover: BlogCover | null
  readonly author: { readonly display_name: string }
}

export interface BlogIndex {
  readonly featured: BlogCard | null
  readonly posts: readonly BlogCard[]
  readonly total: number
  readonly categories: readonly { slug: string; label: string; description: string }[]
}

export interface BlogMediaSize { readonly path: string; readonly width: number; readonly height: number }

export interface BlogPublishedVersion {
  readonly title: string
  readonly summary: string
  readonly cover: BlogCover | null
  readonly seo_title: string | null
  readonly seo_description: string | null
  readonly social_title: string | null
  readonly social_description: string | null
  readonly document: BlogDocument
  readonly read_minutes: number
  readonly media: Readonly<Record<string, BlogMediaSize>>
}

export interface BlogPlaceFacts {
  readonly name: string
  readonly primary_type_display_name: string | null
  readonly city: string | null
  readonly rating: number | null
  readonly review_count: number | null
  readonly google_place_id: string | null
  readonly google_maps_uri: string | null
  readonly stored_photo_url: string | null
  readonly open: boolean
}

export interface BlogOfferingFacts {
  readonly event_type: string | null
  readonly city: string | null
  readonly is_public: boolean
  readonly status: string | null
  readonly next_start_at: string | null
  readonly next_end_at: string | null
  readonly timezone: string | null
  readonly passed: boolean
}

export interface BlogEmbeds {
  readonly places: Readonly<Record<string, BlogPlaceFacts>>
  readonly offerings: Readonly<Record<string, BlogOfferingFacts>>
}

export interface BlogPost extends BlogCard {
  readonly first_published_at: string | null
  readonly updated_at: string
  readonly hide_passed_event_cards: boolean
  readonly topics: readonly string[]
  readonly published_version: BlogPublishedVersion
  readonly more_stories: readonly BlogCard[]
}

export interface BlogPreview extends BlogPost {
  readonly embeds: BlogEmbeds
  readonly preview: true
}

export interface BlogSitemapEntry { readonly slug: string; readonly last_modified: string }

export const EMPTY_EMBEDS: BlogEmbeds = { places: {}, offerings: {} }

export function blogDataConfigured(): boolean {
  return restUrl() !== '' && runtimeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') !== ''
}

/** Public URL of a blog-media object (never the billed /render/image endpoint, hold #1643). */
export function blogMediaUrl(path: string): string {
  return `${mediaBase()}/storage/v1/object/public/blog-media/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function blogCardCoverSrc(card: BlogCard): string | null {
  return card.cover ? blogMediaUrl(card.cover.path) : null
}

type CacheMode = 'cached' | 'live'

async function rpc<T>(fn: string, name: string, args: Record<string, unknown>, mode: CacheMode = 'cached'): Promise<T> {
  const anonKey = runtimeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const res = await fetch(`${restUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
    ...(mode === 'live'
      ? { cache: 'no-store' as const }
      : { next: { revalidate: 300, tags: [BLOG_CACHE_TAG] } }),
  })
  if (!res.ok) throw new Error(`blog_data_${fn}_failed:${res.status}`)
  return (await res.json()) as T
}

const EMPTY_INDEX: BlogIndex = { featured: null, posts: [], total: 0, categories: [] }

/** /blog (category null) or a category page, `page` from 1. */
export async function getBlogIndex(category: string | null, page = 1): Promise<BlogIndex> {
  return getBlogIndexSlice(category, (Math.max(1, Math.floor(page)) - 1) * BLOG_PAGE_SIZE)
}

export async function getBlogIndexSlice(category: string | null, offset: number): Promise<BlogIndex> {
  if (!blogDataConfigured()) return EMPTY_INDEX
  return rpc<BlogIndex>('index', 'blog_public_index', {
    p_category: category,
    p_limit: BLOG_PAGE_SIZE,
    p_offset: Math.max(0, Math.min(10_000, Math.floor(offset))),
  })
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  if (!blogDataConfigured() || !SLUG.test(slug) || slug.length > 80) return null
  return rpc<BlogPost | null>('post', 'blog_public_post', { p_slug: slug })
}

export async function getBlogPostEmbeds(slug: string): Promise<BlogEmbeds> {
  if (!blogDataConfigured() || !SLUG.test(slug) || slug.length > 80) return EMPTY_EMBEDS
  const value = await rpc<Partial<BlogEmbeds>>('embeds', 'blog_public_post_embeds', { p_slug: slug })
  return { places: value.places ?? {}, offerings: value.offerings ?? {} }
}

export async function listBlogSitemapEntries(): Promise<readonly BlogSitemapEntry[]> {
  if (!blogDataConfigured()) return []
  return rpc<BlogSitemapEntry[]>('sitemap', 'blog_public_sitemap', {})
}

export async function getBlogPreview(token: string): Promise<BlogPreview | null> {
  if (!blogDataConfigured() || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  return rpc<BlogPreview | null>('preview', 'blog_public_preview', { p_token: token }, 'live')
}
