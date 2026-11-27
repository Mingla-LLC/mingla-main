import type { Metadata } from 'next'
import { SitePage } from '@/components/site/site-page'
import { AnswerBlock } from '@/components/site-blocks/sections/answer-block'
import { PageHeroBlock } from '@/components/site-blocks/sections/page-hero-block'
import { ParasBlock } from '@/components/site-blocks/sections/paras-block'
import { VCardsBlock } from '@/components/site-blocks/sections/vcards-block'
import { WideClipBlock } from '@/components/site-blocks/sections/wide-clip-block'
import { ABOUT_ANSWER, ABOUT_CARDS, ABOUT_CLIP, ABOUT_HERO, ABOUT_WHY } from '@/content/site-blocks/core'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — About, in the approved design: the centred headline, the
// wide ambient clip, the three paragraphs, and the two video text cards with
// the ink wash: "For people going out" (the Explorer hand-off, §3: a phone
// goes to the store, a computer gets the scan-to-download sheet) and "For
// places with soul" (→ /host). The SEO contract is unchanged: the record's
// metadata and its AboutPage/Breadcrumb JSON-LD.
//
// #4636: every section is a registry block (components/site-blocks/sections/)
// with this page's default content (content/site-blocks/core.ts).

const record = CORE_PAGES.about
export const metadata: Metadata = corePageMetadata(record)

export default function AboutPage() {
  const schema = corePageStructuredData(record)
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
        <PageHeroBlock content={ABOUT_HERO} blockId="about-hero" />
        {/* #4339 round B (SEO audit 3): "What is Mingla?" and its direct
            answer, visible, from the page's own record (answer engines quote it). */}
        <AnswerBlock content={ABOUT_ANSWER} blockId="about-what" />
        <WideClipBlock content={ABOUT_CLIP} blockId="about-clip" />
        <ParasBlock content={ABOUT_WHY} colour="paper" blockId="about-why" />
        <VCardsBlock content={ABOUT_CARDS} colour="cream" blockId="about-cards" />
      </SitePage>
    </div>
  )
}
