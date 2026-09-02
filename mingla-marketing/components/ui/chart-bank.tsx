'use client'

// ---------------------------------------------------------------
// #2902 — the chart bank's render side.
//
// Maps a bank id to the actual component so any page can do
// <BankedFigure id="event-demand" /> instead of importing the figure and
// re-deciding its props. The catalogue that describes them, and the reasons
// the live ones are referenced rather than moved, is in
// lib/design-preview/chart-bank.ts.
//
// The live entries are imported straight from where they ship. That is the
// point: the bank must never become a second copy that drifts from the one
// production renders.
// ---------------------------------------------------------------

import type { ComponentType } from 'react'

import { EventDemandCard } from '@/components/ui/event-demand-card'
import { TripPlanCard } from '@/components/ui/trip-plan-card'
import { ReachMixCard } from '@/components/ui/reach-mix-card'
import { VenueFigure, MarketingFigure } from '@/components/ui/host-figures'
import { AriCreativeCard } from '@/components/ui/ari-creative-card'

import { HostSellThroughChart } from '@/components/design-preview/host/host-sellthrough-chart'
import { LagosVenueChart } from '@/components/design-preview/explorer/lagos-venue-chart'
import { EarningsCard } from '@/components/sections/organiser-home/earnings-card'
import { TripPlannerCard } from '@/components/sections/organiser-home/trip-planner-card'
import { DiningDashboardCard } from '@/components/sections/organiser-home/dining-dashboard-card'
import { GrowthOsDashboard } from '@/components/sections/organiser-home/growth-os-dashboard'
import { VenueActivityFeed } from '@/components/sections/organiser-home/venue-activity-feed'
import { EventAttendeesCard } from '@/components/sections/organiser-home/event-attendees-card'
import { PopupCard } from '@/components/sections/organiser-home/popup-card'

/** The one figure in the bank that needs props, given them once here. */
function AriSiteFigure() {
  return (
    <AriCreativeCard
      siteSrc="/marketing/host-icp/gogi-site.jpg"
      siteAlt="A restaurant website Ari built — hero, menu with prices, online ordering and a table booking form."
    />
  )
}

const REGISTRY: Record<string, ComponentType> = {
  'event-demand': EventDemandCard,
  'trip-plan': TripPlanCard,
  'venue-floor': VenueFigure,
  'audience-split': MarketingFigure,
  'reach-mix': ReachMixCard,
  'ari-site': AriSiteFigure,

  'sell-through': HostSellThroughChart,
  'lagos-venues': LagosVenueChart,
  earnings: EarningsCard,
  'trip-planner': TripPlannerCard,
  'dining-dashboard': DiningDashboardCard,
  'growth-os': GrowthOsDashboard,
  'venue-activity': VenueActivityFeed,
  'event-attendees': EventAttendeesCard,
  'popup-claims': PopupCard,
}

export function BankedFigure({ id }: { id: string }) {
  const Component = REGISTRY[id]
  return Component ? <Component /> : null
}

/** Ids the registry can actually render — used by the gallery to stay honest. */
export const RENDERABLE = new Set(Object.keys(REGISTRY))
