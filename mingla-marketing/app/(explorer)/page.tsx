import { headers } from 'next/headers'

import { ExplorerHero } from '@/components/sections/explorer-home/hero'
import { CutoutNav, CutoutShell, DeviceCta } from '@/components/cutout'
import { MinglaEntityGraph } from '@/components/marketing/entity-graph'
import { resolveCityKey } from '@/lib/city-decks'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #2902 — Explorer home, on the Cutout design.
//
// The page MOUNTS the live `ExplorerHero` verbatim, so its content and
// structure stay identical to what shipped by construction rather than by
// discipline. The Cutout layer only adds the shell, the floating nav,
// `data-cut-deck` (which moulds the swiped cards by scope, see cutout.css) and
// the device-aware action beneath the deck.
//
// ORCH-1007 location-aware hero, KEPT: the marketing city is resolved
// SERVER-SIDE from Vercel geo headers (or ?city= for local testing), then
// passed to the client hero.
//
//   x-vercel-ip-latitude / x-vercel-ip-longitude → nearest seeded city
//   x-vercel-ip-country  → 'NG' maps to Lagos when precise coords are absent
//
// Reading headers()/searchParams renders this page dynamically per request,
// which is correct for a geo-personalised hero.

export const metadata = searchRouteMetadata('/')

interface ExplorerHomePageProps {
  searchParams: Promise<{ city?: string | string[] }>
}

export default async function ExplorerHomePage({ searchParams }: ExplorerHomePageProps) {
  const [headerList, params] = await Promise.all([headers(), searchParams])

  const cityParam = params.city
  const override = Array.isArray(cityParam) ? cityParam[0] : cityParam

  const cityKey = resolveCityKey({
    override,
    latitude: headerList.get('x-vercel-ip-latitude'),
    longitude: headerList.get('x-vercel-ip-longitude'),
    country: headerList.get('x-vercel-ip-country'),
  })

  return (
    <CutoutShell dark noScroll>
      {/* `showAction={false}`: the Explorer action lives under the cards. */}
      <CutoutNav surface="explorer" homeHref="/" showAction={false} />

      <MinglaEntityGraph />

      <div data-cut-deck className="relative h-full">
        <ExplorerHero cityKey={cityKey} />

        {/* Centred in the band between the headline and the deck. A single
            viewport percentage cannot do that: the band is a nearly constant
            ~131-138px tall while the deck's top moves with viewport height, so
            the ideal position ranged 35.6% at 800px to 39.8% at 1000px and the
            action sat 33px low on a tall window. Fitted against measurements at
            800/900/1000: band centre = 0.565*vh - 146, so the action's top is
            that minus half its 42px height.

            The constants are corrected for what is VISIBLE rather than what the
            boxes say, which is where the remaining bias came from: the headline
            BOX ends 9px above where its text actually ends, and the deck ROOT
            starts 25px above the first visible card. Centring on the boxes left
            the action 8-11px low. The band is measured text-bottom to
            card-top.. Mobile lays out differently and
            keeps its own percentage.

            Between the headline and the cards. Measured rather than guessed:
            the visible deck ROOT starts at y=311, not the card cell at y=376,
            so the real clearance was 16px. The deck is nudged down in
            cutout.css to open a 72px band and these percentages centre the
            48px action inside it. */}
        <div className="pointer-events-none absolute inset-x-0 top-[32.6%] z-30 flex justify-center px-6 md:top-[calc(56.5vh_-_188px)]">
          <div className="pointer-events-auto">
            <DeviceCta surface="explorer" location="hero_above_deck" variant="primary" size="md" />
          </div>
        </div>
      </div>
    </CutoutShell>
  )
}
