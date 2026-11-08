import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { ICP_SLUGS, icpLandingPath, isIcpSlug } from '@/content/host-landing/icps'
import { IcpLandingPage } from '@/components/landing/icp-landing'
import { landingMono, landingSans, landingSerif } from './fonts'

// #4339 — the seven Host landing pages, one per ICP: /host/events, /host/trips,
// /host/experiences, /host/restaurants, /host/hotels, /host/art, /host/play.
// One template (components/landing/icp-landing.tsx), one data object per ICP
// (content/host-landing/icps.ts). Adding an ICP is adding data.
//
// The static siblings /host/download (page) and /host/get (route handler) win
// over this dynamic segment, and `dynamicParams = false` 404s every slug that
// is not an ICP, so no landing slug can shadow them (pinned by the #4339 test).

export const dynamicParams = false

export function generateStaticParams(): { icp: string }[] {
  return ICP_SLUGS.map((icp) => ({ icp }))
}

type Params = Promise<{ icp: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { icp } = await params
  if (!isIcpSlug(icp)) return {}
  // Indexed (search_ready, #4339): canonical, index/follow, in the sitemap.
  return searchRouteMetadata(icpLandingPath(icp))
}

export default async function HostIcpLandingPage({ params }: { params: Params }) {
  const { icp } = await params
  if (!isIcpSlug(icp)) notFound()
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <IcpLandingPage slug={icp} />
    </div>
  )
}
