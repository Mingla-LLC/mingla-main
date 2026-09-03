'use client'

import { useEffect, type ReactNode } from 'react'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { DeviceCta, type CutoutSurface } from '@/components/cutout/device-cta'
import { HOST_DESTINATIONS } from '@/components/page-system/city-host-acquisition-bar'
import { ArrowUpRight } from 'lucide-react'

interface CityAnalyticsIdentity {
  readonly citySlug: string
  readonly countryCode: string
}

function cityProperties(identity: CityAnalyticsIdentity, destinationType: string) {
  return {
    city_slug: identity.citySlug,
    country_code: identity.countryCode,
    page_family: 'city_hub',
    destination_type: destinationType,
  } as const
}

export function CityHubImpression(identity: CityAnalyticsIdentity) {
  useEffect(() => {
    captureMarketing('city_hub_view', cityProperties(identity, 'city_hub'))
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
  readonly event: 'city_hub_host_action' | 'city_hub_inventory_action' | 'city_hub_switch_city'
  readonly destinationType: string
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
