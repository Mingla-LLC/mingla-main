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
//
// #3371 — the home page is ONE screen again: hero only, `noScroll`, no city
// guides section. The ten-city launch (#3279) had mounted `RootCityGrid` under
// the hero, which switched the shell to scrolling and the deck wrapper to
// `h-[100svh]`; the action offset below and the deck transform in cutout.css
// are tuned for this non-scrolling layout. City hubs stay reachable from the
// side menu's Cities item, and the Host page keeps its own city list.

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

        {/* "Use Mingla" sits centred in the band between the headline and the
            first visible card. #3371 re-derived the position by MEASURING, not
            by reading boxes: the gap above is the headline's visible TEXT bottom
            (a Range over its text nodes) to the action's top, and the gap below
            is the action's bottom to the top of the highest visible card (the
            peeked back card), never the deck root or a card cell.

            Why this shape. The hero centres its content in a 100svh section, and
            the content's height depends only on vmin (the headline font, its
            margin and the deck scale are all vmin clamps). So the band centre is
            half the viewport plus a vmin term, which is what these fit:
              desktop  50% + min(7vmin, 78.6px) - 176px  (the vmin term stops
                       growing where the headline font reaches its 4rem cap)
              phones   50% - 127px - 4.4vmin, never above 50% - 146px (phones
                       share the 1.7rem floor font; only the deck scale moves
                       with width, and the cap keeps wider portrait layouts
                       from drifting up into the headline)
            `50%` is of this wrapper, i.e. the svh shell, so browser toolbars
            move the action with the hero rather than against it. Below ~700px
            of height the hero content stops rising, so each has a px floor.

            Measured at 1440x900, 1280x800, 1920x1080, 390x844 and 375x667 on a
            production build: both gaps are 31-37px and within 3px of each other
            (the old `32.6%` / `56.5vh - 188px` pair left 1.8px under the action
            at 375x667 and 27px at 1280x800). The desktop band itself was opened
            ~8px in cutout.css. The regression test is
            scripts/issue-3371-explorer-home-one-screen.implementor.happy.test.mjs. */}
        <div className="pointer-events-none absolute inset-x-0 top-[max(181px,calc(50%_-_127px_-_4.4vmin),calc(50%_-_146px))] z-30 flex justify-center px-6 md:top-[max(208px,calc(50%_+_min(7vmin,78.6px)_-_176px))]">
          <div className="pointer-events-auto">
            <DeviceCta surface="explorer" location="hero_above_deck" variant="primary" size="md" />
          </div>
        </div>
      </div>
    </CutoutShell>
  )
}
