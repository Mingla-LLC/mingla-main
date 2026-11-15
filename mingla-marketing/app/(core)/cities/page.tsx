import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CityMedia } from '@/components/site/city-media'
import { PageHero, SitePage } from '@/components/site/site-page'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'
import { historicalCityBuildEnabled } from '@/lib/search/historical-city-build'
import { getCityTiles } from '@/lib/live-cities'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Cities, in the approved design: the headline and one tile
// per LIVE Mingla city, A to Z, each opening its city page. The list is the
// live cities (links_page_cities(), lib/live-cities.ts), read at most every 5
// minutes: switch a city on or off in Admin and it appears or goes with no
// deploy. A city with a hand-made guide opens that guide; a new city opens its
// automatic page (noindex until its guide exists). Tile media
// comes from components/site/city-media.tsx, shared with the city page hero.
// There is no "Notify me when Mingla lands" form (§7: it had no destination).
// The SEO contract is unchanged: the record's metadata and its
// CollectionPage/ItemList JSON-LD of the ten city pages.

const record = CORE_PAGES.cities
export const metadata: Metadata = corePageMetadata(record)

export const revalidate = 300

export default async function CitiesPage() {
  if (historicalCityBuildEnabled()) notFound()
  const { tiles } = await getCityTiles()
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
              {tiles.map((city) => (
                <li key={city.slug}>
                  <Link href={`/cities/${city.slug}`} className="reveal">
                    <div className="ph scrim">
                      <CityMedia slug={city.slug} />
                    </div>
                    <div className="ov">
                      <h2>{city.name}</h2>
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
