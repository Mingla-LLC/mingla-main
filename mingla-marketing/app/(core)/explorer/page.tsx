import type { Metadata } from 'next'
import Image from 'next/image'
import { AnswerBlock, CutoutSection, DeviceCta } from '@/components/cutout'
import { CityDirectory } from '@/components/core-pages/city-directory'
import { CoreHero } from '@/components/core-pages/core-hero'
import { CorePageShell } from '@/components/core-pages/core-page-shell'
import { ExplorerProofGrid } from '@/components/core-pages/explorer-proof-grid'
import { NativeDisclosureList } from '@/components/core-pages/native-disclosure-list'
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
  { question:'Are prices and availability guaranteed?', answer:'No. Details can change. Check the primary source when current price or availability matters.' },
  { question:'How do I report a wrong detail?', answer:'Email support@usemingla.com with the page URL, exact detail and best primary evidence available.' },
] as const

export default function ExplorerPage() {
  const schema = corePageStructuredData(record)
  return <CorePageShell dark>
    {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
    <CoreHero eyebrow={record.eyebrow} title={record.h1} answer={record.directAnswer} visual={<figure className="core-explorer-hero-proof"><Image src="/product-proof/explorer-saved-details.png" alt="Mingla Explorer showing the saved Sample sunset gallery plan open in its details sheet." width={1206} height={2622} sizes="(min-width: 1024px) 21rem, 18rem" priority /></figure>} primary="explorer" secondary="host" />
    <AnswerBlock question={record.directQuestion} answer={record.directAnswer} crumbs={[{name:'Home',path:'/'},{name:'Explorer',path:'/explorer'}]} />
    <CutoutSection id="the-moment"><div className="core-section-heading"><h2>Start with the moment.</h2><p>The same place is not right for every plan. The goal is not to show the most results; it is to help you find a choice you can actually make.</p></div><div className="core-six">{moment.map((item,i)=><article className="core-card" key={item}><h3>{String(i+1).padStart(2,'0')} · {item}</h3><p>Use this part of the moment to narrow what actually fits.</p></article>)}</div></CutoutSection>
    <CutoutSection band="dark" id="product-proof"><div className="core-section-heading"><h2>From discovery to a real action.</h2><p>Keep useful ideas together and carry a decision forward without losing the plan.</p></div><ExplorerProofGrid /></CutoutSection>
    <CutoutSection id="complete-plan"><div className="core-section-heading"><h2>From one stop to a complete plan.</h2><p>Some outings are one clear destination. Others work because an activity, meal, show, walk or drink fit together. Mingla can present curated multi-stop ideas without claiming every stop has confirmed space.</p></div><ol className="core-flow"><li>Start with an activity or experience.</li><li>Add the meal, show, walk or drink that fits the moment.</li><li>Check current timing, distance, price and the available action.</li></ol></CutoutSection>
    <CutoutSection id="cities"><div className="core-section-heading"><h2>Explore city by city.</h2><p>Pick the city you are in—or the one you are heading to.</p></div><CityDirectory /></CutoutSection>
    <CutoutSection band="dark" id="host-bridge"><div className="core-final"><h2>Run the place, event or experience behind the plan?</h2><DeviceCta surface="host" location="explorer_host_bridge" variant="primary" label="See Mingla Host"/></div></CutoutSection>
    <CutoutSection id="questions"><div className="core-section-heading"><h2>Questions about Mingla Explorer.</h2></div><NativeDisclosureList entries={faqs}/></CutoutSection>
    <CutoutSection band="dark"><div className="core-final"><h2>Less searching. Less overthinking. More showing up.</h2><DeviceCta surface="explorer" location="explorer_final" label="Get Mingla"/></div></CutoutSection>
  </CorePageShell>
}
