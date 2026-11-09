// #4339 round B — what a page is, for measurement: its audience, its page
// family and, on a Host landing page, its ICP. One table, shared by the
// page_view (posthog-provider.tsx) and the two hand-off events
// (explorer_install_click, host_start_click), so a click is attributed to the
// page it happened on.
//
// The ICP values are the governed `SEARCH_ICPS` of @mingla/search-measurement;
// the landing slugs are content/host-landing/icps.ts. React-free and pure.

import type { SearchMeasurementProperties } from '@mingla/search-measurement'

export type SearchIcp = NonNullable<SearchMeasurementProperties['icp']>

/** Host landing slug (/host/<slug>, and the Book a call `icp`) → the governed ICP. */
export const LANDING_ICP: Readonly<Record<string, SearchIcp>> = {
  events: 'event_promoter',
  trips: 'trip_operator',
  experiences: 'experience_host',
  restaurants: 'restaurant',
  hotels: 'hotel_resort',
  art: 'art_space',
  play: 'play_space',
}

/** Free tool (the `tool` property of the tool events) → the ICP it serves. */
export const TOOL_ICP: Readonly<Record<string, SearchIcp>> = {
  events: 'event_promoter',
  venues: 'venue',
  trips: 'trip_operator',
  experiences: 'experience_host',
}

export interface PageMeasurement {
  readonly audience: SearchMeasurementProperties['audience']
  readonly page_family: SearchMeasurementProperties['page_family']
  readonly icp?: SearchIcp
}

const HOST_LANDING = /^\/host\/([a-z]+)\/?$/

export function landingIcp(slug: string | null | undefined): SearchIcp | undefined {
  if (!slug) return undefined
  return Object.prototype.hasOwnProperty.call(LANDING_ICP, slug) ? LANDING_ICP[slug] : undefined
}

export function pageMeasurement(pathname: string | null | undefined): PageMeasurement {
  const path = pathname ?? '/'
  const landing = HOST_LANDING.exec(path)
  const icp = landing ? landingIcp(landing[1]) : undefined
  if (icp) return { audience: 'host', page_family: 'host_landing', icp }
  if (path === '/host' || path.startsWith('/host/')) return { audience: 'host', page_family: 'host_pillar' }
  if (path.startsWith('/cities/')) return { audience: 'explorer', page_family: 'city_hub' }
  if (path.startsWith('/tools')) return { audience: 'host', page_family: 'tools' }
  if (path === '/going-out') return { audience: 'explorer', page_family: 'explorer_pillar' }
  if (path === '/blog' || path.startsWith('/blog/')) return { audience: 'neutral', page_family: 'editorial' }
  return { audience: 'neutral', page_family: 'brand_core' }
}
