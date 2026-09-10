import type { Metadata } from 'next'
import Link from 'next/link'
import { AnswerBlock, CutoutSection, DeviceCta } from '@/components/cutout'
import { CoreHero } from '@/components/core-pages/core-hero'
import { CorePageShell } from '@/components/core-pages/core-page-shell'
import { ExplorerProofGrid } from '@/components/core-pages/explorer-proof-grid'
import { NativeDisclosureList } from '@/components/core-pages/native-disclosure-list'
import { ReviewRecord } from '@/components/core-pages/review-record'
import { CITY_HUBS, allCityHubsSearchReady, cityHubPath } from '@/content/cities/registry'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'

const record = CORE_PAGES.explorer
export const metadata: Metadata = corePageMetadata(record)
const moment = ['People', 'Timing', 'Budget', 'Location', 'Mood', 'Required action'] as const
const faqs = [
  { question:'Is Mingla a dating app?', answer:'No. Mingla does not match strangers. It helps couples, friends, groups and solo Explorers make plans for real-world experiences.' },
  { question:'Can I use Mingla for more than dates?', answer:'Yes. Mingla supports date plans, friend groups, solo exploration, celebrations, new-city discovery and other real-world outings.' },
  { question:'Does Mingla sell every ticket or reservation it shows?', answer:'No. Some actions may run through Mingla and others through an identified organiser, venue or third party. The page shows the real action.' },
  { question:'Are prices and availability guaranteed?', answer:'No. Details can change. Mingla shows reviewed wording and points to the primary source when a current check matters.' },
  { question:'Why is a city not linked yet?', answer:'Mingla links a city only after its evidence, media, product proof, accessibility and review gates pass.' },
  { question:'How do I report a wrong detail?', answer:'Email support@usemingla.com with the page URL, exact detail and best primary evidence available.' },
] as const

export default function ExplorerPage() {
  const schema = corePageStructuredData(record)
  return <CorePageShell dark>
    {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
    <CoreHero eyebrow={record.eyebrow} title={record.h1} answer={record.directAnswer} visual={<div className="core-proof-mark"><img src="/brand/mingla-logo-white-on-orange.png" alt="Mingla Explorer app icon" /></div>} primary="explorer" secondary="host" />
    <AnswerBlock question={record.directQuestion} answer={record.directAnswer} crumbs={[{name:'Home',path:'/'},{name:'Explorer',path:'/explorer'}]} lastChecked="10 September 2026" />
    <CutoutSection id="the-moment"><div className="core-section-heading"><h2>Start with the moment.</h2><p>The same place is not right for every plan. The goal is not to show the most results; it is to help you find a choice you can actually make.</p></div><div className="core-six">{moment.map((item,i)=><article className="core-card" key={item}><h3>{String(i+1).padStart(2,'0')} · {item}</h3><p>Use this part of the moment to narrow what actually fits.</p></article>)}</div></CutoutSection>
    <CutoutSection band="dark" id="product-proof"><div className="core-section-heading"><h2>From discovery to a real action.</h2><p>Keep useful ideas together and carry a decision forward without losing the plan.</p></div><ExplorerProofGrid /></CutoutSection>
    <CutoutSection id="complete-plan"><div className="core-section-heading"><h2>From one stop to a complete plan.</h2><p>Some outings are one clear destination. Others work because an activity, meal, show, walk or drink fit together. Mingla can present curated multi-stop ideas without claiming every stop has confirmed space.</p></div><ol className="core-flow"><li>Start with an activity or experience.</li><li>Add the meal, show, walk or drink that fits the moment.</li><li>Check current timing, distance, price and the available action.</li></ol></CutoutSection>
    <CutoutSection id="cities"><div className="core-section-heading"><h2>Explore city by city.</h2><p>Each city has its own boundary, local evidence and review state.</p></div><div className="core-city-directory">{CITY_HUBS.map(city=><article className="core-card" key={city.slug}><h3>{city.city}</h3><p>{city.scopeLabel}</p>{allCityHubsSearchReady()?<Link href={cityHubPath(city)}>Explore {city.city}</Link>:null}</article>)}</div></CutoutSection>
    <CutoutSection id="limits"><div className="core-section-heading"><h2>What Mingla can and cannot verify.</h2><p>Mingla can verify what a cited source said on a reviewed date and whether a real Mingla action existed when tested. It cannot guarantee space, price, third-party policies, suitability or safety for every person.</p></div><div className="core-two"><article className="core-card"><h3>Current truth</h3><p>Use the source, reviewed date and correction path when a detail matters.</p></article><article className="core-card"><h3>About “best”</h3><p>A ranked or “best” claim needs visible criteria, eligible-set boundaries, review date and sponsor separation. Payment does not silently become an independent recommendation.</p></article></div></CutoutSection>
    <CutoutSection band="dark" id="host-bridge"><div className="core-final"><h2>Run the place, event or experience behind the plan?</h2><DeviceCta surface="host" location="explorer_host_bridge" variant="primary" label="See Mingla Host"/></div></CutoutSection>
    <CutoutSection id="questions"><div className="core-section-heading"><h2>Questions about Mingla Explorer.</h2></div><NativeDisclosureList entries={faqs}/></CutoutSection>
    <CutoutSection><ReviewRecord reviewedAt={record.reviewedAt} label="Product record"/></CutoutSection>
    <CutoutSection band="dark"><div className="core-final"><h2>Less searching. Less overthinking. More showing up.</h2><DeviceCta surface="explorer" location="explorer_final" label="Get Mingla"/></div></CutoutSection>
  </CorePageShell>
}
