// #4452 §2.3 — the published blocks, forms and form pages, for server components.
//
// One anonymous PostgREST call to site_public_content(), cached under the
// 'site-pages' tag (revalidated by POST /api/blog/revalidate {"tag":"pages"}).
// A failed call renders nothing: every page shows as designed, and a
// console.error with no payload is logged. Preview content (one-hour token)
// is set per request by app/site-preview/[token] through previewSlot().
import { mergePreview } from './preview'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { EMPTY_CONTENT, type SiteContent } from './model'
import { SITE_PAGES_CACHE_TAG } from './tags'

function runtimeEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const env: Record<string, string | undefined> = process.env
  return (env[name] ?? '').trim()
}

export async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const base = runtimeEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')
  const key = runtimeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!base || !key) return null
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`site_rpc_${res.status}`)
  return res.json()
}

function shaped(raw: unknown): SiteContent {
  const r = (raw ?? {}) as Partial<SiteContent>
  return { pages: r.pages ?? {}, forms: r.forms ?? {}, form_pages: r.form_pages ?? {} }
}

const liveContent = unstable_cache(
  async (): Promise<SiteContent> => shaped(await rpc('site_public_content', {})),
  ['site-public-content-v1'],
  { tags: [SITE_PAGES_CACHE_TAG], revalidate: false },
)

export function siteBlocksOn(): boolean {
  return (process.env.NEXT_PUBLIC_SITE_BLOCKS ?? 'on') !== 'off'
}

/** The preview content of one request (#4636 adds the library media map and the staff page's settings). */
export type PreviewValue = SiteContent & {
  pageKey: string
  changes: number
  editor?: { origin: string } | null
  media?: Record<string, unknown>
  custom?: Record<string, unknown> | null
}

/** Per-request preview content (set by the preview route before it renders the page). */
export const previewSlot = cache((): { value: PreviewValue | null } => ({ value: null }))

/** #4452 §7.6: inside the Website pages editor's preview, the Admin origin markers talk to; else null. */
export function editorMode(): { origin: string; pageKey: string } | null {
  const v = previewSlot().value
  return v?.editor ? { origin: v.editor.origin, pageKey: v.pageKey } : null
}

export async function siteContent(): Promise<SiteContent> {
  const preview = previewSlot().value
  if (preview) return preview
  if (!siteBlocksOn()) return EMPTY_CONTENT
  try {
    return await liveContent()
  } catch {
    console.error('[site-pages] content unavailable; pages render as designed')
    return EMPTY_CONTENT
  }
}

export async function sitePreview(token: string): Promise<(PreviewValue & { expiresAt: string }) | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  try {
    const raw = (await rpc('site_public_preview', { p_token: token })) as Record<string, unknown> | null
    if (!raw || typeof raw.page_key !== 'string') return null
    const live = await liveContent().catch(() => EMPTY_CONTENT)
    const merged = mergePreview(live, raw as { page_key: string; content: unknown; forms?: unknown; changes?: unknown; expires_at?: unknown })
    // #4636: the library items the previewed content uses, and a staff page's address and SEO fields.
    const media = raw.media && typeof raw.media === 'object' ? (raw.media as Record<string, unknown>) : {}
    const custom = raw.custom && typeof raw.custom === 'object' ? (raw.custom as Record<string, unknown>) : null
    return { ...merged, media, custom }
  } catch {
    return null
  }
}

