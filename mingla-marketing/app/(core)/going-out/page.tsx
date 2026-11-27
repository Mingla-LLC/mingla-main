import type { Metadata } from 'next'
import { SitePage } from '@/components/site/site-page'
import { AnswerBlock } from '@/components/site-blocks/sections/answer-block'
import { CityLinksBlock } from '@/components/site-blocks/sections/city-links-block'
import { FilterGridBlock } from '@/components/site-blocks/sections/filter-grid-block'
import { PageHeroBlock } from '@/components/site-blocks/sections/page-hero-block'
import { GOING_OUT_ANSWER, GOING_OUT_CITIES, GOING_OUT_GUIDES, GOING_OUT_HERO } from '@/content/site-blocks/core'
import { CORE_PAGES } from '@/content/core-pages'
import { getCityTiles } from '@/lib/live-cities'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Going out, in the approved design: the headline, the filter
// row (one row that swipes on a phone; each chip is a button that filters the
// guides below), the wide "Movie nights" tile and six guide tiles. A guide has
// no page of its own yet (it is a social carousel), so each tile opens its
// city page, or /cities when it spans cities (#4339 §8). The SEO contract is
// unchanged: the record's metadata and its WebPage/Breadcrumb JSON-LD.
//
// #4636: every section is a registry block (components/site-blocks/sections/)
// with this page's default content (content/site-blocks/core.ts).

const record = CORE_PAGES['going-out']
export const metadata: Metadata = corePageMetadata(record)

export const revalidate = 300

export default async function GoingOutPage() {
  const { tiles: cityTiles } = await getCityTiles()
  const schema = corePageStructuredData(record)
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer" current="going-out">
        {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
        <PageHeroBlock content={GOING_OUT_HERO} blockId="going-out-hero" />
        {/* #4339 round B (SEO audit 2): the direct question and answer that
            search and answer engines quote, from the page's own record. */}
        <AnswerBlock content={GOING_OUT_ANSWER} blockId="going-out-answer" />
        <FilterGridBlock content={GOING_OUT_GUIDES} blockId="going-out-guides" />
        {/* #4339 round B (SEO audit 2): one internal link to every city page,
            anchored on the phrase people search for. */}
        <CityLinksBlock content={GOING_OUT_CITIES} blockId="going-out-cities" tiles={cityTiles} />
      </SitePage>
    </div>
  )
}
