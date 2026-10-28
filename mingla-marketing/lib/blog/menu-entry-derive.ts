// #4137 wave 3 — how the side menu's blog seam value is derived from the
// public blog index. Pure, no imports: scripts/generate-blog-menu-entry.mjs
// runs it at build time (Node strips the types), and the seam test runs it too.

export interface MenuLatestStoryValue {
  readonly href: `/blog/${string}`
  readonly title: string
  readonly coverSrc: string
  readonly coverWidth: number
  readonly coverHeight: number
}

export interface BlogMenuEntryValue {
  readonly blogVisible: boolean
  readonly showNewBadge: boolean
  readonly latest: MenuLatestStoryValue | null
}

interface IndexCard {
  readonly slug: string
  readonly title: string
  readonly publish_at: string
  readonly cover: { readonly path: string } | null
}

export const BLOG_MENU_HIDDEN: BlogMenuEntryValue = { blogVisible: false, showNewBadge: false, latest: null }

/** "New" shows while the newest story is under two weeks old (spec wave 2 OQ-3). */
export const BLOG_NEW_BADGE_DAYS = 14

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function blogMenuEntryFromIndex(
  index: { readonly featured: IndexCard | null; readonly posts: readonly IndexCard[] } | null,
  mediaUrl: (path: string) => string,
  now: Date,
): BlogMenuEntryValue {
  const cards = [index?.featured, ...(index?.posts ?? [])].filter((card): card is IndexCard => Boolean(card && SLUG.test(card.slug)))
  if (cards.length === 0) return BLOG_MENU_HIDDEN
  const newest = [...cards].sort((a, b) => Date.parse(b.publish_at) - Date.parse(a.publish_at))[0]
  const age = now.getTime() - Date.parse(newest.publish_at)
  // The cover is a licensed blog-media image, shrunk by the site's own image
  // optimiser (never Supabase /render/image, hold #1643).
  const latest: MenuLatestStoryValue | null = newest.cover
    ? {
        href: `/blog/${newest.slug}`,
        title: newest.title,
        coverSrc: `/_next/image?url=${encodeURIComponent(mediaUrl(newest.cover.path))}&w=128&q=75`,
        coverWidth: 60,
        coverHeight: 60,
      }
    : null
  return { blogVisible: true, showNewBadge: age >= 0 && age <= BLOG_NEW_BADGE_DAYS * 24 * 3600 * 1000, latest }
}

/** Accepts only a well-formed value; anything else is the hidden value. */
export function parseBlogMenuEntry(value: unknown): BlogMenuEntryValue {
  if (!value || typeof value !== 'object') return BLOG_MENU_HIDDEN
  const entry = value as Record<string, unknown>
  if (entry.blogVisible !== true) return BLOG_MENU_HIDDEN
  const latest = entry.latest as Record<string, unknown> | null
  const latestOk = latest !== null && typeof latest === 'object'
    && typeof latest.href === 'string' && /^\/blog\/[a-z0-9]+(-[a-z0-9]+)*$/.test(latest.href)
    && typeof latest.title === 'string' && latest.title.length > 0
    && typeof latest.coverSrc === 'string' && latest.coverSrc.startsWith('/_next/image?url=')
    && typeof latest.coverWidth === 'number' && typeof latest.coverHeight === 'number'
  return {
    blogVisible: true,
    showNewBadge: entry.showNewBadge === true,
    latest: latestOk ? (latest as unknown as MenuLatestStoryValue) : null,
  }
}
