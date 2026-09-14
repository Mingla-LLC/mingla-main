import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CutoutSection, DeviceCta } from '@/components/cutout'
import { CitiesHero } from '@/components/core-pages/cities-hero'
import { CityDirectory } from '@/components/core-pages/city-directory'
import { CorePageShell } from '@/components/core-pages/core-page-shell'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'
import { historicalCityBuildEnabled } from '@/lib/search/historical-city-build'

const record = CORE_PAGES.cities
export const metadata: Metadata = corePageMetadata(record)

export default function CitiesPage() {
  if (historicalCityBuildEnabled()) notFound()
  const schema = corePageStructuredData(record)
  return <CorePageShell>
    {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
    <CitiesHero />
    <CutoutSection id="directory"><div className="core-section-heading core-section-heading--center"><h2>Choose your city.</h2></div><CityDirectory /></CutoutSection>
    <CutoutSection band="dark"><div className="core-final core-final--balanced"><h2>Explore the city—or host what happens in it.</h2><div><DeviceCta surface="explorer" location="cities_final_explorer" label="Explore Your City"/><DeviceCta surface="host" location="cities_final_host" variant="quiet" label="Host Your City"/></div></div></CutoutSection>
  </CorePageShell>
}
