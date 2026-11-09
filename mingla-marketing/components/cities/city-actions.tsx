'use client'

import { useEffect, type ReactNode } from 'react'
import {
  captureMarketing,
  posthogOptIn,
  subscribeMarketingConsent,
} from '@/components/marketing/marketing-capture'
import type { CutoutSurface } from '@/components/cutout/device-cta'
import type { CityHubAnalyticsEvent, CityHubDestinationType } from '@/lib/city-hub-analytics'

export interface CityAnalyticsIdentity {
  readonly citySlug: string
  readonly countryCode: string
}

const CITY_TRACKED_LINK_EVENTS = [
  'city_hub_host_action',
  'city_hub_inventory_action',
  'city_hub_switch_city',
] as const satisfies readonly Exclude<CityHubAnalyticsEvent, 'city_hub_view' | 'city_hub_explorer_action'>[]

export function cityProperties(identity: CityAnalyticsIdentity, destinationType: CityHubDestinationType) {
  return {
    city_slug: identity.citySlug,
    country_code: identity.countryCode,
    page_family: 'city_hub',
    destination_type: destinationType,
  } as const
}

export function CityHubImpression(identity: CityAnalyticsIdentity) {
  useEffect(() => {
    let active = true
    const capture = (): void => {
      void posthogOptIn().then(() => {
        if (active) captureMarketing('city_hub_view', cityProperties(identity, 'city_hub'))
      })
    }
    capture()
    const unsubscribe = subscribeMarketingConsent(capture)
    return () => {
      active = false
      unsubscribe()
    }
  }, [identity.citySlug, identity.countryCode])
  return null
}

/**
 * The closed event a city device action records (#2983 allowlist). The action
 * itself lives in city-hub-actions.tsx (#4339 speed fix), so the device CTA,
 * its QR panel and motion load only where a page renders one.
 */
export function cityDeviceActionEvent(surface: CutoutSurface): 'city_hub_explorer_action' | 'city_hub_host_action' {
  return surface === 'explorer' ? 'city_hub_explorer_action' : 'city_hub_host_action'
}

export function CityTrackedLink({
  event,
  destinationType,
  children,
  ...identity
}: CityAnalyticsIdentity & {
  readonly event: (typeof CITY_TRACKED_LINK_EVENTS)[number]
  readonly destinationType: CityHubDestinationType
  readonly children: ReactNode
}) {
  return (
    <span
      onClick={() => captureMarketing(event, cityProperties(identity, destinationType))}
      className="contents"
    >
      {children}
    </span>
  )
}
