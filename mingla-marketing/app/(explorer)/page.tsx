import { HomePage } from '@/components/site/home-page'
import { MinglaEntityGraph } from '@/components/marketing/entity-graph'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2a — Explorer home, redesigned ("Mingla, Edited"): the Reelmark
// hero (three-line headline, one arrow to "Use Mingla", the curved card
// carousel), then How it works, "Not a dating app. A plans app.", the cities
// row, the marquee and the "Run a place with soul?" band, over the canonical
// footer. Content lives in components/site/home-page.tsx.
//
// It replaces the #3371 one-screen deck hero, so the page scrolls and closes
// with the footer like every other page. The SEO contract is unchanged: the
// search_ready metadata for "/" and the Organization/WebSite entity graph.
// The brand faces are route-scoped through app/site-fonts.ts (#3548).

export const metadata = searchRouteMetadata('/')

export default function ExplorerHomePage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <MinglaEntityGraph />
      <HomePage />
    </div>
  )
}
