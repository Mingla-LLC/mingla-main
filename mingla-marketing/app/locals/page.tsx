import type { Metadata } from 'next'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { SitePage } from '@/components/site/site-page'
import { HeroWords } from '@/components/site-blocks/hero-words'
import { Spot } from '@/components/site-blocks/spot'
import { FactsBlock } from '@/components/site-blocks/sections/facts-block'
import { FinePrintBlock } from '@/components/site-blocks/sections/fine-print-block'
import { StepsBlock } from '@/components/site-blocks/sections/steps-block'
import { VideoBandBlock } from '@/components/site-blocks/sections/video-band-block'
import { LOCALS_BAND, LOCALS_FACTS, LOCALS_FINE, LOCALS_HERO, LOCALS_STEPS } from '@/content/site-blocks/programmes'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Mingla Locals, in the approved design: the headline, "Get
// Mingla to apply" (the Explorer hand-off, §3: applications live in the app),
// the three steps, the two
// programme facts and the closing band. The programme facts are the live
// page's, word for word where they are terms (#3872 pins them): up to three
// Locals per open city, $150 after approval, paid by Mingla, never by the place.

// #4339 Creators and Locals calls (Seth approved, 9 Nov): "Book a call"
// (/schedule/locals) replaces the agreement button and sits beside "Get Mingla
// to apply" in the closing band. The Local agreement is accepted in the app;
// one line of fine print links to it.
//
// #4636: every section is a registry block (components/site-blocks/sections/)
// with this page's default content (content/site-blocks/programmes.ts). The
// steps, facts, band and fine print share the programme frame (pb-100 > wrap).

// #4339 round B: registered in lib/search/route-registry.ts (one absolute title).
export const metadata: Metadata = searchRouteMetadata('/locals')

export default function LocalsPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        <HeroWords page="locals" coded={LOCALS_HERO} />
        <Spot page="locals" id="after-hero" />

        <section className="pb-100" aria-labelledby="locals-how">
          <div className="wrap">
            <StepsBlock content={LOCALS_STEPS} blockId="locals-how" />
            <Spot page="locals" id="after-steps" />
            <FactsBlock content={LOCALS_FACTS} blockId="locals-facts" />
            <Spot page="locals" id="after-facts" />
            <VideoBandBlock content={LOCALS_BAND} blockId="locals-band" />
            <FinePrintBlock content={LOCALS_FINE} blockId="locals-fine" />
          </div>
        </section>
        <Spot page="locals" id="before-footer" />
      </SitePage>
    </div>
  )
}
