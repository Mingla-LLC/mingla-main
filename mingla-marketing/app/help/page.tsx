import { searchRouteMetadata } from '@/lib/search/metadata'
// #4339 round B (speed): direct module imports, not the barrel (the
// barrel pulls framer-motion into every route that touches it).
import { BreadcrumbSchema } from '@/components/cutout/schema'
import { SitePage } from '@/components/site/site-page'
import { HelpVideosBlock } from '@/components/site-blocks/sections/help-videos-block'
import { PageHeroBlock } from '@/components/site-blocks/sections/page-hero-block'
import { StillStuckBlock } from '@/components/site-blocks/sections/still-stuck-block'
import { HELP_HERO, HELP_STUCK } from '@/content/site-blocks/core'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// The help centre. Every feature of the platform, shown rather than described.
//
// Discovery here is by intent, not by chapter number: people arrive knowing the
// job they are stuck on ("get paid", "run the door"), not which episode covers
// it. Chapters are the resting state; the chips and the search are the way in.
//
// #4339 phase 2b — redesigned ("Mingla, Edited"): the site nav, the headline,
// the search and chips, the video cards, and "Still stuck?" with
// support@usemingla.com and Book a call (→ /schedule), the same as the live
// /support page. There is no "Send to support" form (§7). The registry and the
// player pages are unchanged. app/help/layout.tsx keeps the <main id="main">
// that carries the #3431 copy opt-in, so the shell adds no second <main>.
// #4636: the headline, the videos and "Still stuck?" are registry blocks
// (pageHero, helpVideos, stillStuck).

export const metadata = searchRouteMetadata('/help')

export default function HelpCentrePage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="host" current="help" layoutMain>
        <BreadcrumbSchema
          crumbs={[
            { name: 'Mingla', path: '/' },
            { name: 'Help centre', path: '/help' },
          ]}
        />
        <PageHeroBlock content={HELP_HERO} blockId="help-hero" />
        {/* #4339 speed fix: the cards render on the server; the browser
            island only filters them (no registry in the payload). */}
        <HelpVideosBlock />
        <StillStuckBlock content={HELP_STUCK} blockId="help-stuck" />
      </SitePage>
    </div>
  )
}
