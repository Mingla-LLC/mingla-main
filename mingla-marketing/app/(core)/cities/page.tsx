import type { Metadata } from 'next'
import { AnswerBlock, CutoutSection, DeviceCta } from '@/components/cutout'
import { CityDirectory } from '@/components/core-pages/city-directory'
import { CoreHero } from '@/components/core-pages/core-hero'
import { CorePageShell } from '@/components/core-pages/core-page-shell'
import { ReviewRecord } from '@/components/core-pages/review-record'
import { CITY_HUBS } from '@/content/cities/registry'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'

const record = CORE_PAGES.cities
export const metadata: Metadata = corePageMetadata(record)

function CityConstellation() {
  return <div className="core-card" aria-label="Mingla launch cities"><img src="/brand/mingla-logo-white-on-orange.png" width="72" height="72" alt="" />{CITY_HUBS.map(city=><span key={city.slug} className="inline-block m-1 rounded-full border px-3 py-2 text-sm">{city.city}</span>)}</div>
}

export default function CitiesPage() {
  const schema = corePageStructuredData(record)
  return <CorePageShell>
    {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
    <CoreHero eyebrow={record.eyebrow} title={record.h1} answer={record.directAnswer} visual={<CityConstellation />} />
    <AnswerBlock question={record.directQuestion} answer={record.directAnswer} crumbs={[{name:'Home',path:'/'},{name:'Cities',path:'/cities'}]} lastChecked="10 September 2026" />
    <CutoutSection id="directory"><div className="core-section-heading"><h2>Choose a city.</h2><p>Exactly ten independent city identities. A city becomes a link only after the entire ten-city release gate passes.</p></div><CityDirectory /></CutoutSection>
    <CutoutSection band="dark" id="boundaries"><div className="core-section-heading"><h2>One city means one city.</h2><p>Every catalogue applies its approved boundary before ranking a place.</p></div><div className="core-two">{CITY_HUBS.map(city=><article className="core-card" key={city.slug}><h3>{city.city}</h3><p>{city.jurisdiction.scopeStatement}</p></article>)}</div></CutoutSection>
    <CutoutSection id="available"><div className="core-section-heading"><h2>What becomes available.</h2></div><div className="core-two"><article className="core-card"><h3>For Explorers</h3><p>A local catalogue with source-backed context and an appropriate way into Mingla.</p><DeviceCta surface="explorer" location="cities_explorer" label="Explore Your City"/></article><article className="core-card"><h3>For Hosts</h3><p>A city-specific path for places, organisers and experience operators to publish and grow.</p><DeviceCta surface="host" location="cities_host" label="Host Your City"/></article></div></CutoutSection>
    <CutoutSection id="readiness"><div className="core-section-heading"><h2>How a city becomes ready.</h2><p>Readiness is a truth gate, not a launch-date promise.</p></div><ol className="core-flow"><li>Lock the exact city identity.</li><li>Fetch an official, versioned boundary.</li><li>Filter eligible place records inside that boundary.</li><li>Rank the top 50 eligible places overall, then expose the categories present.</li><li>Verify names, local formatting and public actions.</li><li>Audit every named-place image and attribution.</li><li>Complete an in-market local review.</li><li>Pass mobile, desktop, no-JavaScript and crawler checks.</li><li>Promote all ten together to public discovery.</li></ol></CutoutSection>
    <CutoutSection id="not-linked"><div className="core-section-heading"><h2>Why a city may not be linked yet.</h2><p>A city stays in review when its boundary, catalogue, media, source freshness, reviewer or user action is incomplete. Mingla does not turn unfinished inventory into a decorative coming-soon link.</p></div></CutoutSection>
    <CutoutSection><div className="core-section-heading"><h2>Corrections and local knowledge.</h2><p>Email <a href="mailto:support@usemingla.com">support@usemingla.com</a> with the page, exact detail and primary source. Local reviewers help Mingla preserve neighbourhood names, language and practical context.</p></div><ReviewRecord reviewedAt={record.reviewedAt} label="Directory record"/></CutoutSection>
    <CutoutSection band="dark"><div className="core-final"><h2>Choose your side of the city.</h2><div><DeviceCta surface="explorer" location="cities_final_explorer" label="Explore Your City"/><DeviceCta surface="host" location="cities_final_host" variant="quiet" label="Host Your City"/></div></div></CutoutSection>
  </CorePageShell>
}
