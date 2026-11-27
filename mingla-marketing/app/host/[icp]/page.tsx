import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { ICP_LANDINGS, ICP_SLUGS, icpLandingPath, isIcpSlug } from '@/content/host-landing/icps'
import { hostLandingStructuredData, serializeStructuredData } from '@/lib/search/page-schema'
import { IcpLandingPage } from '@/components/landing/icp-landing'
import { IcpLandingAnalytics } from '@/components/landing/icp-landing-analytics'
import { CallButtonAnalytics } from '@/components/forms/call-button-analytics'
import { PublishedOr } from '@/components/site-blocks/published-page'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 — the seven Host landing pages, one per ICP: /host/events, /host/trips,
// /host/experiences, /host/restaurants, /host/hotels, /host/art, /host/play.
// One template (components/landing/icp-landing.tsx), one data object per ICP
// (content/host-landing/icps.ts). Adding an ICP is adding data.
//
// The static siblings /host/download (page) and /host/get (route handler) win
// over this dynamic segment, and the isIcpSlug guard below 404s every slug that
// is not an ICP, so no landing slug can shadow them (pinned by the #4339 test).
//
// #4452 rework 1 (P0-3): dynamicParams is true. Every page now carries the
// site-pages cache tag (the root layout's pop-up mount and the Spots), and on
// Next 15 revalidating a tag on a `dynamicParams = false` route turns its
// prerendered pages into 404s (NoFallbackError) until the next deploy. The seven
// ICP pages are still prerendered by generateStaticParams; anything else is the
// 404 page through notFound().

export const dynamicParams = true

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
      {/* #4339 round B: WebPage + BreadcrumbList (Home › Mingla Host › <ICP>). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeStructuredData(hostLandingStructuredData(icpLandingPath(icp), ICP_LANDINGS[icp].name)) }}
      />
      {/* #4636: a published block list replaces the coded sections (analytics stay); with none, the coded page renders unchanged. */}
      <PublishedOr pageKey={icp} extra={<><IcpLandingAnalytics slug={icp} /><CallButtonAnalytics /></>}>
        <IcpLandingPage slug={icp} />
      </PublishedOr>
    </div>
  )
}
