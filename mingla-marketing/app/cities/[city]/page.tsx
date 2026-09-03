import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CityHub } from '@/components/cities/city-hub'
import { CITY_HUBS, cityHubForSlug } from '@/content/cities/registry'
import { getLagosCatalogueSnapshot } from '@/lib/page-system/city-catalogue.server'
import { cityHubMetadata } from '@/lib/search/metadata'
import { cityHubStructuredData, serializeCityHubStructuredData } from '@/lib/search/city-schema'

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
  const catalogue = city === 'lagos' ? getLagosCatalogueSnapshot('/cities/lagos') : null
  return (
    <>
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
      />
    </>
  )
}
