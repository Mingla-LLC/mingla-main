import type { Metadata } from 'next'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { SitePage } from '@/components/site/site-page'
import { PublishedOr } from '@/components/site-blocks/published-page'
import { HeroWords } from '@/components/site-blocks/hero-words'
import { Spot } from '@/components/site-blocks/spot'
import { ClipGridBlock } from '@/components/site-blocks/sections/clip-grid-block'
import { FinePrintBlock } from '@/components/site-blocks/sections/fine-print-block'
import { StepsBlock } from '@/components/site-blocks/sections/steps-block'
import { VideoBandBlock } from '@/components/site-blocks/sections/video-band-block'
import { CREATORS_BAND, CREATORS_CLIPS, CREATORS_FINE, CREATORS_HERO, CREATORS_STEPS } from '@/content/site-blocks/programmes'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Mingla Creators, in the approved design: the headline, four
// clips and the three steps. The step copy is the live page's programme facts.
//
// #4339 Creators and Locals calls (Seth approved, 9 Nov): creator setup lives
// in the Mingla (Explorer) app, so the primary button is "Get Mingla to join",
// the device-aware Explorer hand-off (a phone goes to the Explorer store, a
// computer gets the QR sheet with no web option). The second button and the
// closing band are "Book a call" (/schedule/creators). The Creator agreement
// is accepted in the app; one line of fine print links to it.
//
// #4636: every section is a registry block (components/site-blocks/sections/)
// with this page's default content (content/site-blocks/programmes.ts). The
// clips, steps, band and fine print share the programme frame (pb-100 > wrap).

// #4339 round B: registered in lib/search/route-registry.ts (one absolute title).
export const metadata: Metadata = searchRouteMetadata('/creators')

// #4636: a published block list replaces the coded sections; with none, the coded page renders unchanged.
export default function CreatorsPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      {/* #4339 (Seth): Creators sign up in Explorer, so the page is on the
          Explorer surface and its top bar's "Use Mingla" goes to Explorer. */}
      <PublishedOr pageKey="creators">
        <SitePage surface="explorer">
          <HeroWords page="creators" coded={CREATORS_HERO} />
          <Spot page="creators" id="after-hero" />

          <section className="pb-100" aria-label="How Mingla Creators works">
            <div className="wrap">
              <ClipGridBlock content={CREATORS_CLIPS} blockId="creators-clips" />
              <Spot page="creators" id="after-clips" />
              <StepsBlock content={CREATORS_STEPS} blockId="creators-steps" />
              <Spot page="creators" id="after-steps" />
              <VideoBandBlock content={CREATORS_BAND} blockId="creators-band" />
              <FinePrintBlock content={CREATORS_FINE} blockId="creators-fine" />
            </div>
          </section>
          <Spot page="creators" id="before-footer" />
        </SitePage>
      </PublishedOr>
    </div>
  )
}
