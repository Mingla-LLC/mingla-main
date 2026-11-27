import { PageHeroBlock } from '@/components/site-blocks/sections/page-hero-block'
import { ToolCardsBlock } from '@/components/site-blocks/sections/tool-cards-block'
import { SitePage } from '@/components/site/site-page'
import { TOOLS_CARDS, TOOLS_HERO } from '@/content/site-blocks/core'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #1003 [Venue Website Grader — growth tools, test cut] — the /tools hub.
//
// #4339 phase 2b — redesigned ("Mingla, Edited"): the site nav, the headline
// and four tool cards, each with its clip and opening its live tool page
// (/tools/venues, /tools/events, /tools/trips, /tools/pricing), over the
// canonical footer (app/tools/layout.tsx renders this page bare). The SEO
// contract is unchanged: the search_ready metadata for "/tools".
// #4339 phase 2c — the tool pages moved onto the same frame; the brand faces
// now come from app/tools/layout.tsx for the whole /tools tree.
// #4636: the headline and the cards are registry blocks (pageHero, toolCards).

export const metadata = searchRouteMetadata('/tools')

export default function ToolsHubPage() {
  return (
    <div>
      <SitePage surface="host" current="tools">
        <PageHeroBlock content={TOOLS_HERO} blockId="tools-hero" />
        <ToolCardsBlock content={TOOLS_CARDS} blockId="tools-cards" />
      </SitePage>
    </div>
  )
}
