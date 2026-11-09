import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
// #4339 speed fix: the release layout only; the #2983 historical build swaps
// this module for city-hub.tsx (next.config.ts, CITY_ROUTE_MODULE).
import { CityHub } from '@/components/cities/city-route'
import { CITY_HUBS, cityHubForSlug } from '@/content/cities/registry'
import { getCityCatalogueSnapshot, getLagosCatalogueSnapshot } from '@/lib/page-system/city-catalogue.server'
import { cityHubMetadata } from '@/lib/search/metadata'
import { cityHubStructuredData, serializeCityHubStructuredData } from '@/lib/search/city-schema'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'
import { getCityWeekend } from '@/lib/city-weekend-data'
import { historicalCityBuildEnabled } from '@/lib/search/historical-city-build'

// #4339 phase 2b — the release layout is the redesigned city page
// (components/cities/city-page.tsx); its brand faces are route-scoped here
// (#3548).
//
// #4339 phase 4a — "This weekend" reads #4318's public readers
// (links_page_week, links_page_strips, links_page_places) through
// lib/city-weekend-data.ts: the same 5-minute cache and `links` tag as /links,
// so the page regenerates at most every 5 minutes. The ranked places, plans and
// FAQs below it keep their existing sources.

interface CityHubPageProps {
  readonly params: Promise<{ city: string }>
}

export const dynamicParams = false

export function generateStaticParams() {
  return CITY_HUBS.map((record) => ({ city: record.slug }))
}

export async function generateMetadata({ params }: CityHubPageProps): Promise<Metadata> {
  const { city } = await params
  const record = cityHubForSlug(city)
  if (!record) return {}
  return cityHubMetadata(record)
}

export default async function CityHubPage({ params }: CityHubPageProps) {
  const { city } = await params
  const record = cityHubForSlug(city)
  if (!record) notFound()
  const structuredData = cityHubStructuredData(record)
  const legacyLagosCatalogue = city === 'lagos' ? getLagosCatalogueSnapshot('/cities/lagos') : null
  const catalogue = legacyLagosCatalogue ?? getCityCatalogueSnapshot(record.slug, `/cities/${record.slug}`)
  const weekend = historicalCityBuildEnabled() ? undefined : await getCityWeekend(record.slug, new Date().toISOString())
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeCityHubStructuredData(structuredData) }}
        />
      ) : null}
      <CityHub
        record={record}
        catalogue={catalogue ? {
          ...catalogue,
          initialType: 'places',
          initialCategories: [],
          initialIntents: [],
          initialDetail: null,
        } : undefined}
        weekend={weekend}
      />
    </div>
  )
}
