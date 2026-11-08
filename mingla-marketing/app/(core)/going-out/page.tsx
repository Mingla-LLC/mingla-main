import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { LandingMedia } from '@/components/landing/landing-media'
import { FilterGrid, type FilterItem } from '@/components/site/filter-row'
import { PageHero, SitePage } from '@/components/site/site-page'
import { CITY_HUBS, cityHubForSlug, cityHubPath } from '@/content/cities/registry'
import { CORE_PAGES } from '@/content/core-pages'
import type { LandingMediaRef } from '@/content/host-landing/icps'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Going out, in the approved design: the headline, the filter
// row (one row that swipes on a phone; each chip is a button that filters the
// guides below), the wide "Movie nights" tile and six guide tiles. A guide has
// no page of its own yet (it is a social carousel), so each tile opens its
// city page, or /cities when it spans cities (#4339 §8). The SEO contract is
// unchanged: the record's metadata and its WebPage/Breadcrumb JSON-LD.

const record = CORE_PAGES['going-out']
export const metadata: Metadata = corePageMetadata(record)

const CHIPS = ['Date ideas', 'With friends', 'Solo', 'Family', 'Side quests'] as const
type Chip = (typeof CHIPS)[number]

interface Guide {
  media: LandingMediaRef
  title: string
  line: string
  tags: readonly Chip[]
  /** A city hub slug, or null for /cities. */
  city: string | null
}

const GUIDES: readonly Guide[] = [
  { media: 'v:g-solo', title: 'Solo Saturday', line: 'Some of the best plans only need you.', tags: ['Solo'], city: null },
  { media: 'v:g-culture', title: 'Lagos, not parties', line: 'Four plans this week that aren’t parties.', tags: ['With friends'], city: 'lagos' },
  { media: 'v:g-under', title: 'Underrated Durham', line: 'The places people tell their friends about.', tags: ['With friends'], city: 'durham-nc' },
  { media: 'v:g-date', title: 'Cary has range', line: 'Not the Cary you remember.', tags: ['Date ideas'], city: 'cary-nc' },
  { media: 'v:g-family', title: 'With the grandparents', line: 'Plans for every age at the table.', tags: ['Family'], city: null },
  { media: 'v:g-quests', title: 'Lagos side quests', line: 'Pottery, paint, galleries and more.', tags: ['Side quests'], city: 'lagos' },
]

function guideHref(city: string | null): string {
  if (city === null) return '/cities'
  const hub = cityHubForSlug(city)
  if (!hub) throw new Error(`#4339 going-out: city hub "${city}" is not in the registry`)
  return cityHubPath(hub)
}

function GuideTile({ guide }: { guide: Guide }) {
  return (
    <Link className="tile" href={guideHref(guide.city)}>
      <div className="ph scrim">
        <LandingMedia media={guide.media} />
      </div>
      <div className="ov">
        <h3>{guide.title}</h3>
        <p>{guide.line}</p>
      </div>
      <span className="go" aria-hidden="true">
        <ArrowUpRight />
      </span>
    </Link>
  )
}

export default function GoingOutPage() {
  const schema = corePageStructuredData(record)
  const items: FilterItem[] = GUIDES.map((guide) => ({ key: guide.title, tags: guide.tags, node: <GuideTile guide={guide} /> }))
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer" current="going-out">
        {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
        <PageHero
          title={
            <>
              Going out, <em>sorted.</em>
            </>
          }
          lead="Discover places, events, trips and experiences, inspect the details that change the decision, and save the useful options together."
        />
        {/* #4339 round B (SEO audit 2): the direct question and answer that
            search and answer engines quote, from the page's own record. */}
        <section className="answer-sec" aria-labelledby="going-out-answer">
          <div className="wrap answer-block">
            <h2 className="h2" id="going-out-answer">
              {record.directQuestion}
            </h2>
            <p className="lead">{record.directAnswer}</p>
          </div>
        </section>
        <section className="pb-100" aria-label="Guides">
          <div className="wrap">
            <FilterGrid
              label="Filter guides"
              options={CHIPS}
              items={items}
              gridClassName="grid3 mt-24"
              noun="guide"
              empty="No guides for that yet."
              between={
                <Link className="tile wide mt-24" href="/cities">
                  <div className="ph scrim">
                    <LandingMedia media="v:cozy" />
                  </div>
                  <div className="ov">
                    <h3>
                      Movie nights, <em>under the stars.</em>
                    </h3>
                    <p>Events, trips and places picked for the weekend in your city.</p>
                  </div>
                  <span className="go" aria-hidden="true">
                    <ArrowUpRight />
                  </span>
                </Link>
              }
            />
          </div>
        </section>
        {/* #4339 round B (SEO audit 2): one internal link to every city page,
            anchored on the phrase people search for. */}
        <section className="sec city-links-sec" aria-labelledby="going-out-cities">
          <div className="wrap">
            <h2 className="h2" id="going-out-cities">
              Plans, <em>city by city.</em>
            </h2>
            <ul className="city-links mt-24">
              {CITY_HUBS.map((city) => (
                <li key={city.slug}>
                  <Link href={cityHubPath(city)}>
                    Things to do in {city.city} <ArrowUpRight aria-hidden="true" />
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
