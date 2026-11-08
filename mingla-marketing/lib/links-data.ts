// #4318 — usemingla.com/links: the server-only data layer.
//
// Same transport as lib/blog/data.ts: no supabase-js, a raw fetch to PostgREST
// with the PUBLIC anon key, cached in the Next Data Cache for 5 minutes under
// the `links` tag (the admin "Links page" tab can drop the tag so a new strip
// shows at once). The database is the fence:
//   - `public.links_page_week()`  — real, public, published, upcoming events,
//     trips and experiences, one row per occurrence in the next 7 days;
//   - `public.links_page_strips()` — published, unexpired admin strips.
//
// No database configured (local dev, CI builds): both lists are empty and the
// page shows its designed empty state. Configured but failing (for example the
// functions are not applied yet): the error is logged on the server (never
// swallowed) and that list is empty, so the bio link still opens instead of
// crashing; the page then shows the same empty state.

import type { LinksStripRow, LinksWeekRow } from './links-week'

export const LINKS_CACHE_TAG = 'links'
export const LINKS_REVALIDATE_SECONDS = 300

function runtimeEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const env: Record<string, string | undefined> = process.env
  return (env[name] ?? '').trim()
}

export function linksDataConfigured(): boolean {
  return runtimeEnv('NEXT_PUBLIC_SUPABASE_URL') !== '' && runtimeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') !== ''
}

async function rpc<T>(name: 'links_page_week' | 'links_page_strips'): Promise<T[]> {
  const anonKey = runtimeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const base = runtimeEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: '{}',
    next: { revalidate: LINKS_REVALIDATE_SECONDS, tags: [LINKS_CACHE_TAG] },
  })
  if (!res.ok) throw new Error(`links_data_${name}_failed:${res.status}`)
  const body: unknown = await res.json()
  if (!Array.isArray(body)) throw new Error(`links_data_${name}_not_a_list`)
  return body as T[]
}

export interface LinksData {
  rows: LinksWeekRow[]
  strips: LinksStripRow[]
  /** Which reads failed (logged on the server); empty when all is well. */
  failed: Array<'week' | 'strips'>
}

export async function getLinksData(): Promise<LinksData> {
  if (!linksDataConfigured()) return { rows: [], strips: [], failed: [] }
  const [week, strips] = await Promise.allSettled([
    rpc<LinksWeekRow>('links_page_week'),
    rpc<LinksStripRow>('links_page_strips'),
  ])
  const failed: LinksData['failed'] = []
  if (week.status === 'rejected') {
    failed.push('week')
    console.error('[#4318 links] links_page_week read failed', week.reason)
  }
  if (strips.status === 'rejected') {
    failed.push('strips')
    console.error('[#4318 links] links_page_strips read failed', strips.reason)
  }
  return {
    rows: week.status === 'fulfilled' ? week.value : [],
    strips: strips.status === 'fulfilled' ? strips.value : [],
    failed,
  }
}
