import type { Metadata } from 'next'
import Link from 'next/link'
import { AnswerBlock, CutoutSection, DeviceCta } from '@/components/cutout'
import { CoreHero } from '@/components/core-pages/core-hero'
import { CorePageShell } from '@/components/core-pages/core-page-shell'
import { PlatformBridgeGraphic } from '@/components/core-pages/platform-bridge-graphic'
import { ReviewRecord } from '@/components/core-pages/review-record'
import { CITY_HUBS } from '@/content/cities/registry'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'

const record = CORE_PAGES.about
export const metadata: Metadata = corePageMetadata(record)

export default function AboutPage() {
  const schema = corePageStructuredData(record)
  return <CorePageShell>
    {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
    <CoreHero eyebrow={record.eyebrow} title={record.h1} answer={record.directAnswer} visual={<PlatformBridgeGraphic />} />
    <AnswerBlock question={record.directQuestion} answer={record.directAnswer} crumbs={[{ name: 'Home', path: '/' }, { name: 'About Mingla', path: '/about' }]} lastChecked="10 September 2026" />
    <CutoutSection id="two-jobs"><div className="core-section-heading"><h2>One platform, two jobs.</h2><p>People need a decision they can act on. Hosts need a clear way to make the experience understandable and available.</p></div><div className="core-two">
      <article className="core-card"><h3>For people making the plan</h3><p>Explore places, events, trips and experiences; compare what fits the people, timing, budget, location and mood; save and share ideas; and take the real reservation, RSVP or ticket action when one is available.</p><p>Mingla does not match strangers. It helps couples, friends, groups and solo Explorers make real-world plans.</p><DeviceCta surface="explorer" location="about_explorer" label="Explore Your City" /></article>
      <article className="core-card"><h3>For people making the experience possible</h3><p>Mingla Host is for organisers, restaurants, bars, cafés, venues, activity spaces, experience brands, trip operators and independent creators. Hosts can present, publish, promote and run only the workflows Mingla currently supports.</p><DeviceCta surface="host" location="about_host" label="Host Your City" /></article>
    </div></CutoutSection>
    <CutoutSection band="dark" id="how-it-connects"><div className="core-section-heading"><h2>How the two sides meet.</h2><p>Mingla keeps the person choosing and the person hosting closer to the same public truth.</p></div><ol className="core-flow"><li>The Host publishes a clear, current result.</li><li>The Explorer finds it in the context of a real plan.</li><li>The person takes the available reservation, RSVP, ticket or information action.</li></ol></CutoutSection>
    <CutoutSection id="launch-cities"><div className="core-section-heading"><h2>Where Mingla is launching.</h2><p>Each city is researched, reviewed and released on its own evidence. Durham, Cary and Raleigh remain separate cities.</p></div><div className="core-city-directory">{CITY_HUBS.map(city => <article className="core-card" key={city.slug}><h3>{city.city}</h3><p>{city.country}</p><p>{city.scopeLabel}</p></article>)}</div></CutoutSection>
    <CutoutSection id="what-mingla-is"><div className="core-section-heading"><h2>What Mingla is—and is not.</h2><p>Mingla is an experience and planning platform for real life. It curates and suggests; people decide, Hosts remain responsible for their offerings, and third-party information can change.</p></div><div className="core-two"><article className="core-card"><h3>Mingla helps with</h3><ul><li>Discovering and comparing real-world options</li><li>Keeping a plan together</li><li>Publishing and operating supported Host offerings</li></ul></article><article className="core-card"><h3>Mingla is not</h3><ul><li>A dating or matchmaking service</li><li>An events-news copier, web host, point-of-sale system or phone-ordering bot</li><li>A permit office, venue inspector or guarantee of availability</li></ul></article></div></CutoutSection>
    <CutoutSection id="products"><div className="core-section-heading"><h2>The Mingla products.</h2><p>One company, with clear tools for both sides of the plan.</p></div><div className="core-two"><article className="core-card"><img src="/brand/mingla-logo-white-on-orange.png" width="64" height="64" alt="Mingla Explorer app icon"/><h3>Mingla</h3><p>The Explorer app is available for iOS and Android.</p><DeviceCta surface="explorer" location="about_product_explorer" label="Get Mingla" /></article><article className="core-card"><img src="/brand/mingla-business-logo.png" width="64" height="64" alt="Mingla Host app icon"/><h3>Mingla Host</h3><p>The Host app is available for iOS and Android, with buyer-facing web pages people can open from a shared link.</p><DeviceCta surface="host" location="about_product_host" label="Get Mingla Host" /></article></div></CutoutSection>
    <CutoutSection id="publishing"><div className="core-section-heading"><h2>How Mingla publishes information.</h2><p>Mingla pages are built for decisions, not keyword volume. Facts, actions, images and product claims need an explainable source, reviewer and date. Content that becomes stale, unsupported or misleading does not remain search-ready.</p><p><Link href="/editorial-standards">Read Mingla Editorial Standards</Link>.</p></div></CutoutSection>
    <CutoutSection id="contact"><div className="core-section-heading"><h2>Contact and corrections.</h2><p>For product support, account questions or a correction to public Mingla information, email <a href="mailto:support@usemingla.com">support@usemingla.com</a>. Include the page URL, exact statement, best primary evidence and whether it is time-sensitive.</p></div><ReviewRecord reviewedAt={record.reviewedAt} /></CutoutSection>
    <CutoutSection band="dark"><div className="core-final"><h2>Find the plan. Feel the city. Show up.</h2><div><DeviceCta surface="explorer" location="about_final_explorer" label="Explore Your City"/><DeviceCta surface="host" location="about_final_host" variant="quiet" label="Host Your City"/></div></div></CutoutSection>
  </CorePageShell>
}
