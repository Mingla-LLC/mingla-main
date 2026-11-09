import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CityMedia } from '@/components/site/city-media'
import { PageHero, SitePage } from '@/components/site/site-page'
import { CITY_HUBS, cityHubPath } from '@/content/cities/registry'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'
import { historicalCityBuildEnabled } from '@/lib/search/historical-city-build'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Cities, in the approved design: the headline and one tile
// per city in the registry (all ten), each opening its city page. Tile media
// comes from components/site/city-media.tsx, shared with the city page hero.
// There is no "Notify me when Mingla lands" form (§7: it had no destination).
// The SEO contract is unchanged: the record's metadata and its
// CollectionPage/ItemList JSON-LD of the ten city pages.

const record = CORE_PAGES.cities
export const metadata: Metadata = corePageMetadata(record)

export default function CitiesPage() {
  if (historicalCityBuildEnabled()) notFound()
  const schema = corePageStructuredData(record)
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer" current="cities">
        {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
        <PageHero
          title={
            <>
              Pick a city. <em>Find a plan.</em>
            </>
          }
          lead="Local plans for the people who live there, and host tools for the places that make it worth it."
        />
        <section className="pb-100" aria-label="Mingla cities">
          <div className="wrap">
            <ul className="cityrow city-tiles">
              {CITY_HUBS.map((city) => (
                <li key={city.slug}>
                  <Link href={cityHubPath(city)} className="reveal">
                    <div className="ph scrim">
                      <CityMedia slug={city.slug} />
                    </div>
                    <div className="ov">
                      <h2>{city.city}</h2>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
