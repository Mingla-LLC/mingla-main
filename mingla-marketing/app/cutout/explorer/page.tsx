import type { Metadata } from 'next'
import { ExplorerHero } from '@/components/sections/explorer-home/hero'
import { CutoutNav, CutoutShell, DeviceCta } from '@/components/cutout'

// #2902 — EXPLORER, Cutout shell.
//
// The page MOUNTS the live `ExplorerHero` verbatim: the content and structure
// stay identical to the shipped page by construction rather than by discipline.
//
// Three things the Cutout layer adds around it, all without touching the hero:
//   - the page shell and the floating nav;
//   - `data-cut-deck`, which moulds the swiped cards by scope (see cutout.css);
//   - the device-aware action, positioned BENEATH the deck rather than in the
//     header, per Seth.

export const metadata: Metadata = {
  title: 'Explorer — #2902 Cutout preview',
  description: 'Review-only Cutout shell around the live Mingla Explorer home.',
  robots: { index: false, follow: false },
}

export default function CutoutExplorerPage() {
  return (
    <CutoutShell dark noScroll>
      {/* `showAction={false}`: the Explorer action lives under the cards. */}
      <CutoutNav surface="explorer" homeHref="/cutout/explorer" showAction={false} />

      <div data-cut-deck className="relative h-full">
        <ExplorerHero cityKey="lagos" />

        {/* Between the headline and the cards, per Seth. Measured rather than
            guessed. The first pass measured `.group.absolute` — the card CELL
            at y=376 — and read 81px of clearance. Wrong element: the visible
            deck ROOT starts at y=311, so the real clearance was 16px. The deck
            is nudged down in cutout.css to open a 72px band, and these
            percentages centre the 48px action inside it. */}
        <div className="pointer-events-none absolute inset-x-0 top-[30.8%] z-30 flex justify-center px-6 md:top-[36.2%]">
          <div className="pointer-events-auto">
            <DeviceCta
              surface="explorer"
              location="hero_above_deck"
              variant="primary"
              size="md"
            />
          </div>
        </div>
      </div>
    </CutoutShell>
  )
}
