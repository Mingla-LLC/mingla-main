'use client'

import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { DeviceCta, type CutoutSurface } from '@/components/cutout/device-cta'
import { DeviceLink } from '@/components/cutout/device-link'
import { HOST_DESTINATIONS } from '@/components/page-system/city-host-acquisition-bar'
import { siteAttribution } from '@/lib/links-src'
import { cityDeviceActionEvent, cityProperties, type CityAnalyticsIdentity } from './city-actions'

// #4339 speed fix — the historical #2983 city layout's device action and Host
// creation links, moved out of city-actions.tsx so the redesigned city page
// (which renders neither) does not ship the device CTA, its QR panel,
// framer-motion or the Cutout host bar. city-actions.tsx keeps the analytics
// the redesigned page uses (the view impression and tracked links).

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
        captureMarketing(cityDeviceActionEvent(surface), cityProperties(identity, destinationType))
      }}
    />
  )
}

export function CityHostCreationLinks(identity: CityAnalyticsIdentity) {
  return (
    <ul className="city-host-links">
      {HOST_DESTINATIONS.map((destination) => (
        <li key={destination.href}>
          {/* #4137 OQ-3: phone → Mingla Host install; computer → this create page. */}
          <DeviceLink
            surface="host"
            attribution={siteAttribution('business_hero')}
            hostComputerHref={destination.href}
            sameTab
            onActivate={() => captureMarketing(
              'city_hub_host_action',
              cityProperties(identity, destination.destinationType),
            )}
          >
            {destination.label}<ArrowUpRight aria-hidden="true" size={15} />
          </DeviceLink>
        </li>
      ))}
    </ul>
  )
}
