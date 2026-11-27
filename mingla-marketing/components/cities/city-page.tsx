import Link from 'next/link'
import type { CityHubRecord } from '@/content/cities/registry'
import { SitePage } from '@/components/site/site-page'
import { CityHeroBlock } from '@/components/site-blocks/sections/city-hero-block'
import { CityHostBandBlock } from '@/components/site-blocks/sections/city-host-band-block'
import { CityPlansBlock } from '@/components/site-blocks/sections/city-plans-block'
import { CityWeekendBlock } from '@/components/site-blocks/sections/city-weekend-block'
import { FaqBlock } from '@/components/site-blocks/sections/faq-block'
import { TopPlacesBlock } from '@/components/site-blocks/sections/top-places-block'
import type { CityIdentity } from '@/components/site-blocks/sections/city-data'
import { CityHubImpression } from './city-actions'
import { CityLifecycleNotice, type CityHubCatalogue } from './city-lifecycle'
import type { CityWeekendModel } from '@/lib/city-weekend'

// #4339 phase 2b — the release layout of /cities/[city] (one template for
// every city), in the approved design:
//
//   1. the photo/clip hero with the city pill, "<City>, what are we outside
//      for?" and the glass bar with Use Mingla (the Explorer hand-off, §3);
//   2. "This weekend" from the live readers (#4339 phase 4a, §4): admin
//      strips first, the city's Friday–Sunday listings, the empty-week rule,
//      and the Events / Experiences / Places chips (city-this-weekend.tsx);
//   2b. the city's ranked places with their detail sheet (city-weekend.tsx),
//      unchanged from phase 2b apart from its own heading;
//   3. the moss "More than one mode." guide band;
//   4. the city's questions (the FAQPage markup's visible answers);
//   5. "Run a place in <City>?" with ONE host button, See Mingla Host → /host
//      (round 1, point 8: we don't know their ICP yet).
//
// DATA: "This weekend" is #4318's readers (lib/city-weekend-data.ts); the rest
// is the page's existing source, unchanged: the #4137 catalogue snapshot
// (ranked places, ready-made plans) and the registry record (guide sections,
// FAQs). The historical #2983 layout stays in city-hub.tsx for its pinned
// build lane.
//
// #4636: the sections are registry blocks (components/site-blocks/sections/:
// cityHero, cityWeekend, topPlaces, cityPlans, faq (city), cityHostBand); the
// page hands each the data it already read. CityHero and CityHostBand moved
// into their block files and are re-exported here for the live city page.

export type { CityIdentity } from '@/components/site-blocks/sections/city-data'
export { CityHero } from '@/components/site-blocks/sections/city-hero-block'
export { CityHostBand } from '@/components/site-blocks/sections/city-host-band-block'

/** The visible trail that matches the BreadcrumbList (Home › Cities › <City>). */
export function CityBreadcrumb({ record }: { readonly record: CityIdentity }) {
  return (
    <nav className="city-crumbs wrap" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link href="/">Home</Link>
        </li>
        <li>
          <Link href="/cities">Cities</Link>
        </li>
        <li>
          <span aria-current="page">{record.city}</span>
        </li>
      </ol>
    </nav>
  )
}

export function CityPage({
  record,
  catalogue,
  weekend,
}: {
  readonly record: CityHubRecord
  readonly catalogue: CityHubCatalogue
  readonly weekend: CityWeekendModel
}) {
  const city = { city: record.slug }
  return (
    <div className="page-system-root city-hub-root city-page-v2 city-page-v3">
      <CityHubImpression citySlug={record.slug} countryCode={record.countryCode} />
      <SitePage surface="explorer" current="cities">
        <CityHeroBlock content={city} identity={record} blockId="city-hub-title" />
        <CityBreadcrumb record={record} />
        <CityLifecycleNotice record={record} />
        <CityWeekendBlock content={city} identity={record} model={weekend} blockId="city-weekend-title" />
        <TopPlacesBlock content={city} record={record} catalogue={catalogue} blockId="city-places-title" />
        <CityPlansBlock content={{ ...city, heading: 'More than *one mode.*' }} colour="moss" record={record} catalogue={catalogue} blockId="city-guide-title" />
        <FaqBlock
          content={{ variant: 'city', prefix: record.city, heading: ' questions, *answered.*', items: record.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })) }}
          colour="paper"
          blockId="city-faq-title"
        />
        <CityHostBandBlock content={city} identity={record} blockId="city-host-title" />
      </SitePage>
      <div data-city-detail-host="" />
    </div>
  )
}
