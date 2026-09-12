export const SEARCH_EVENT_NAMES = [
  'page_view', 'explorer_install_click', 'host_start_click', 'select_content',
  'sign_up', 'plan_created', 'rsvp_complete', 'listing_published',
  'generate_lead', 'share', 'paired_page_switch', 'correction_start', 'tool_interaction',
] as const
export type SearchEventName = (typeof SEARCH_EVENT_NAMES)[number]

export const SEARCH_CITY_SLUGS = ['lagos','durham-nc','cary-nc','raleigh-nc','new-york-city','brussels','paris','london','fort-lauderdale','washington-dc'] as const
export type SearchCitySlug = (typeof SEARCH_CITY_SLUGS)[number]
export const SEARCH_AUDIENCES = ['explorer','host','neutral'] as const
export const SEARCH_PAGE_FAMILIES = ['brand_core','city_hub','explorer_pillar','host_pillar','tools','editorial','public_inventory'] as const
export const SEARCH_ICPS = ['event_promoter','restaurant','resort','venue','trip_operator','experience_host','independent_creator'] as const
export const SEARCH_PUBLICATION_STATES = ['draft','public_noindex','search_ready','stale','expired_archived'] as const
export const SEARCH_DESTINATIONS = ['explorer_onelink','explorer_store','explorer_download','host_onelink','host_store','host_web','public_inventory','external_source'] as const
export const SEARCH_SOURCES = ['navigation','hero','footer','city_card','product','search','direct','referrer'] as const
export const SEARCH_ACTION_STATES = ['opened','succeeded','verified'] as const
export const SEARCH_CONTENT_KINDS = ['place','plan','event','trip','experience','venue','brand'] as const

export interface SearchMeasurementProperties {
  readonly audience: (typeof SEARCH_AUDIENCES)[number]
  readonly page_family: (typeof SEARCH_PAGE_FAMILIES)[number]
  readonly icp?: (typeof SEARCH_ICPS)[number]
  readonly city_slug?: SearchCitySlug
  readonly publication_state?: (typeof SEARCH_PUBLICATION_STATES)[number]
  readonly destination_kind?: (typeof SEARCH_DESTINATIONS)[number]
  readonly source_kind?: (typeof SEARCH_SOURCES)[number]
  readonly action_state?: (typeof SEARCH_ACTION_STATES)[number]
  readonly content_kind?: (typeof SEARCH_CONTENT_KINDS)[number]
  readonly page_location?: string
  readonly page_referrer_origin?: string
}
export interface SanitizedSearchMeasurement { readonly event: SearchEventName; readonly properties: Readonly<Record<string, string>> }

const sets = {
  event: new Set<string>(SEARCH_EVENT_NAMES), audience:new Set<string>(SEARCH_AUDIENCES), page_family:new Set<string>(SEARCH_PAGE_FAMILIES),
  icp:new Set<string>(SEARCH_ICPS), city_slug:new Set<string>(SEARCH_CITY_SLUGS), publication_state:new Set<string>(SEARCH_PUBLICATION_STATES),
  destination_kind:new Set<string>(SEARCH_DESTINATIONS), source_kind:new Set<string>(SEARCH_SOURCES), action_state:new Set<string>(SEARCH_ACTION_STATES), content_kind:new Set<string>(SEARCH_CONTENT_KINDS),
}
const OPTIONAL_KEYS = ['icp','city_slug','publication_state','destination_kind','source_kind','action_state','content_kind','page_location','page_referrer_origin'] as const
const ALL_KEYS = new Set(['audience','page_family',...OPTIONAL_KEYS])
const EVENT_REQUIRED: Readonly<Record<SearchEventName, readonly (keyof SearchMeasurementProperties)[]>> = {
  page_view:['audience','page_family','page_location','source_kind'], explorer_install_click:['audience','page_family','destination_kind','source_kind','action_state'],
  host_start_click:['audience','page_family','destination_kind','source_kind','action_state'], select_content:['audience','page_family','content_kind','source_kind'],
  sign_up:['audience','page_family','action_state'], plan_created:['audience','page_family','action_state'], rsvp_complete:['audience','page_family','action_state'],
  listing_published:['audience','page_family','icp','action_state'], generate_lead:['audience','page_family','icp','action_state'], share:['audience','page_family','action_state'],
  paired_page_switch:['audience','page_family','source_kind'], correction_start:['audience','page_family','source_kind'], tool_interaction:['audience','page_family','icp','action_state'],
}
const EVENT_DESTINATIONS: Partial<Record<SearchEventName, ReadonlySet<string>>> = {
  explorer_install_click:new Set(['explorer_onelink','explorer_store','explorer_download']), host_start_click:new Set(['host_onelink','host_store','host_web']),
}

function safeCleanUrl(value: string, originOnly = false): string | null {
  try { const url=new URL(value); if (!/^https?:$/.test(url.protocol)) return null; return originOnly ? url.origin : `${url.origin}${url.pathname}` }
  catch { return null }
}

export function sanitizeSearchMeasurement(event: unknown, input: unknown): SanitizedSearchMeasurement | null {
  if (typeof event!=='string' || !sets.event.has(event) || input===null || typeof input!=='object' || Array.isArray(input)) return null
  const record=input as Record<string,unknown>; const keys=Object.keys(record)
  if (keys.length>10 || keys.some(key=>!ALL_KEYS.has(key))) return null
  if (typeof record.audience!=='string' || !sets.audience.has(record.audience) || typeof record.page_family!=='string' || !sets.page_family.has(record.page_family)) return null
  for (const key of OPTIONAL_KEYS) {
    const value=record[key]; if (value===undefined) continue
    if (typeof value!=='string' || value.length===0 || value.length>160) return null
    if (key==='page_location') { if (safeCleanUrl(value) !== value) return null; continue }
    if (key==='page_referrer_origin') { if (safeCleanUrl(value,true) !== value) return null; continue }
    const allowed=sets[key as keyof typeof sets]; if (allowed && !allowed.has(value)) return null
  }
  const name=event as SearchEventName
  if (EVENT_REQUIRED[name].some(key=>record[key]===undefined)) return null
  const destinations=EVENT_DESTINATIONS[name]
  if (destinations && !destinations.has(String(record.destination_kind))) return null
  const properties:Record<string,string>={}
  for (const key of ['audience','page_family',...OPTIONAL_KEYS]) if (record[key]!==undefined) properties[key]=String(record[key])
  return { event:name, properties }
}

export function cleanPageLocation(input: string): string | null { return safeCleanUrl(input) }
export function cleanReferrerOrigin(input: string): string | null { return safeCleanUrl(input,true) }
