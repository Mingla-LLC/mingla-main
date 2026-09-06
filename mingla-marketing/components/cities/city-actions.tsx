'use client'

import { useEffect, type ReactNode } from 'react'
import {
  captureMarketing,
  posthogOptIn,
  subscribeMarketingConsent,
} from '@/components/marketing/posthog-provider'
import { DeviceCta, type CutoutSurface } from '@/components/cutout/device-cta'
import { HOST_DESTINATIONS } from '@/components/page-system/city-host-acquisition-bar'
import { ArrowUpRight } from 'lucide-react'
import type { CityHubAnalyticsEvent, CityHubDestinationType } from '@/lib/city-hub-analytics'

interface CityAnalyticsIdentity {
  readonly citySlug: string
  readonly countryCode: string
}

const CITY_TRACKED_LINK_EVENTS = [
  'city_hub_host_action',
  'city_hub_inventory_action',
  'city_hub_switch_city',
] as const satisfies readonly Exclude<CityHubAnalyticsEvent, 'city_hub_view' | 'city_hub_explorer_action'>[]

function cityProperties(identity: CityAnalyticsIdentity, destinationType: CityHubDestinationType) {
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

export function CityDeviceAction({
  surface,
  label,
  location,
  variant,
  className,
  ...identity
}: CityAnalyticsIdentity & {
  readonly surface: CutoutSurface
  readonly label: ReactNode
  readonly location: string
  readonly variant: 'primary' | 'ink' | 'quiet'
  readonly className?: string
}) {
  return (
    <DeviceCta
      surface={surface}
      label={label}
      location={location}
      variant={variant}
      size="lg"
      className={className}
      captureDefaultAnalytics={false}
      onActivate={(destinationType) => {
        captureMarketing(
          surface === 'explorer' ? 'city_hub_explorer_action' : 'city_hub_host_action',
          cityProperties(identity, destinationType),
        )
      }}
    />
  )
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

export function CityHostCreationLinks(identity: CityAnalyticsIdentity) {
  return (
    <ul className="city-host-links">
      {HOST_DESTINATIONS.map((destination) => (
        <li key={destination.href}>
          <a
            href={destination.href}
            onClick={() => captureMarketing(
              'city_hub_host_action',
              cityProperties(identity, destination.destinationType),
            )}
          >
            {destination.label}<ArrowUpRight aria-hidden="true" size={15} />
          </a>
        </li>
      ))}
    </ul>
  )
}
