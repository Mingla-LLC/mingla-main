// #4318 — usemingla.com/links: the server-only data layer.
//
// Same transport as lib/blog/data.ts: no supabase-js, a raw fetch to PostgREST
// with the PUBLIC anon key, cached in the Next Data Cache for 5 minutes under
// the `links` tag (the admin "Links page" tab can drop the tag so a new strip
// shows at once). The database is the fence:
//   - `public.links_page_week()`  — real, public, published, upcoming events,
//     trips and experiences, one row per occurrence in the next 7 days;
//   - `public.links_page_strips()` — published, unexpired admin strips;
//   - `public.links_page_places(p_lat, p_lng, p_radius_km, p_limit)` — up to 3
//     real places for a city with a quiet week (#4318 addendum 2);
//   - `public.links_page_cities()` — the cities live for consumers in Explorer,
//     the one owner of which cities /links lists and where they are (#4318
//     live cities, 8 Nov 2026). Flip a city live in Admin and it is listed
//     within 5 minutes; switch it off and it goes.
//
// No database configured (local dev, CI builds): every list is empty and the
// page shows its designed empty state. Configured but failing (for example the
// functions are not applied yet): the error is logged on the server (never
// swallowed) and that list is empty, so the bio link still opens instead of
// crashing; the page then shows the same empty state.

import {
  cityReachKm,
  normalisePlaces,
  QUIET_WEEK_PLACES,
  type LinksCity,
  type LinksCityRow,
  type LinksPlace,
  type LinksPlaceRow,
  type LinksStripRow,
  type LinksWeekRow,
} from './links-week'

export const LINKS_CACHE_TAG = 'links'
export const LINKS_REVALIDATE_SECONDS = 300

function runtimeEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const env: Record<string, string | undefined> = process.env
  return (env[name] ?? '').trim()
}

export function linksDataConfigured(): boolean {
  return runtimeEnv('NEXT_PUBLIC_SUPABASE_URL') !== '' && runtimeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') !== ''
}

async function rpc<T>(
  name: 'links_page_week' | 'links_page_strips' | 'links_page_places' | 'links_page_cities',
  args: Record<string, number> = {},
): Promise<T[]> {
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
    body: JSON.stringify(args),
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
  /** The cities live in Explorer (`links_page_cities()`), in the database's order. */
  cities: LinksCityRow[]
  /** Which reads failed (logged on the server); empty when all is well. */
  failed: Array<'week' | 'strips' | 'cities'>
}

export async function getLinksData(): Promise<LinksData> {
  if (!linksDataConfigured()) return { rows: [], strips: [], cities: [], failed: [] }
  const [week, strips, cities] = await Promise.allSettled([
    rpc<LinksWeekRow>('links_page_week'),
    rpc<LinksStripRow>('links_page_strips'),
    rpc<LinksCityRow>('links_page_cities'),
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
  if (cities.status === 'rejected') {
    failed.push('cities')
    console.error('[#4318 links] links_page_cities read failed', cities.reason)
  }
  return {
    rows: week.status === 'fulfilled' ? week.value : [],
    strips: strips.status === 'fulfilled' ? strips.value : [],
    cities: cities.status === 'fulfilled' ? cities.value : [],
    failed,
  }
}

export interface LinksPlacesData {
  /** Places per city slug (only the cities asked for). */
  places: Record<string, LinksPlace[]>
  /** Cities whose places read failed (logged on the server). */
  failed: string[]
}

/**
 * Up to 3 real places for each city asked for, around the city's centre (from
 * `links_page_cities()`) and within its own reach. Photos are stored
 * thumbnails on the public object endpoint (never /render/image).
 */
export async function getLinksPlaces(cities: readonly LinksCity[]): Promise<LinksPlacesData> {
  const out: LinksPlacesData = { places: {}, failed: [] }
  if (!linksDataConfigured() || cities.length === 0) return out
  const storage = runtimeEnv('NEXT_PUBLIC_SUPABASE_URL')
  const results = await Promise.allSettled(
    cities.map((city) =>
      rpc<LinksPlaceRow>('links_page_places', {
        p_lat: city.lat,
        p_lng: city.lng,
        p_radius_km: Math.round(city.reachKm ?? cityReachKm(city.slug)),
        p_limit: QUIET_WEEK_PLACES,
      }),
    ),
  )
  results.forEach((result, i) => {
    const city = cities[i]
    if (result.status === 'fulfilled') {
      out.places[city.slug] = normalisePlaces(result.value, city.slug, storage)
    } else {
      out.failed.push(city.slug)
      console.error(`[#4318 links] links_page_places read failed for ${city.slug}`, result.reason)
    }
  })
  return out
}
