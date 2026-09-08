export const CITY_HUB_ANALYTICS_EVENTS = [
  'city_hub_view',
  'city_hub_explorer_action',
  'city_hub_host_action',
  'city_hub_inventory_action',
  'city_hub_switch_city',
] as const

export type CityHubAnalyticsEvent = (typeof CITY_HUB_ANALYTICS_EVENTS)[number]

export const CITY_HUB_DESTINATION_TYPES = [
  'city_hub',
  'explorer_download',
  'explorer_qr',
  'host_download',
  'host_web',
  'event',
  'trip',
  'experience',
  'venue',
  'place',
  'plan',
] as const

export type CityHubDestinationType = (typeof CITY_HUB_DESTINATION_TYPES)[number]

export interface CityHubAnalyticsProperties {
  readonly city_slug: string
  readonly country_code: string
  readonly page_family: 'city_hub'
  readonly destination_type: CityHubDestinationType
}

const DESTINATIONS_BY_EVENT: Readonly<Record<CityHubAnalyticsEvent, readonly CityHubDestinationType[]>> = {
  city_hub_view: ['city_hub'],
  city_hub_explorer_action: ['explorer_download', 'explorer_qr'],
  city_hub_host_action: ['host_download', 'host_web', 'event', 'trip', 'experience', 'venue'],
  city_hub_inventory_action: ['place', 'plan'],
  city_hub_switch_city: ['city_hub'],
}

const CITY_HUB_PATH = /^\/cities\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/
const CITY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COUNTRY_CODE = /^[A-Z]{2}$/

export function isCityHubPathname(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && CITY_HUB_PATH.test(pathname)
}

export function cleanCityHubPathname(pathname: string): string | null {
  if (!isCityHubPathname(pathname)) return null
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function isCityHubEvent(event: string): event is CityHubAnalyticsEvent {
  return (CITY_HUB_ANALYTICS_EVENTS as readonly string[]).includes(event)
}

function isDestinationForEvent(
  event: CityHubAnalyticsEvent,
  destination: unknown,
): destination is CityHubDestinationType {
  return typeof destination === 'string' && DESTINATIONS_BY_EVENT[event].includes(destination as CityHubDestinationType)
}

export function sanitizeCityHubAnalytics(
  event: string,
  properties: Record<string, unknown> | undefined,
): { readonly event: CityHubAnalyticsEvent; readonly properties: CityHubAnalyticsProperties } | null {
  if (!isCityHubEvent(event) || properties === undefined) return null
  const citySlug = properties.city_slug
  const countryCode = properties.country_code
  if (typeof citySlug !== 'string' || !CITY_SLUG.test(citySlug) || citySlug.length > 64) return null
  if (typeof countryCode !== 'string' || !COUNTRY_CODE.test(countryCode)) return null
  if (properties.page_family !== 'city_hub') return null
  if (!isDestinationForEvent(event, properties.destination_type)) return null
  return {
    event,
    properties: {
      city_slug: citySlug,
      country_code: countryCode,
      page_family: 'city_hub',
      destination_type: properties.destination_type,
    },
  }
}
