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
            guessed: the headline ends at y=295 and the deck starts at y=376 on
            desktop (81px of clearance); y=242 to y=344 on mobile (102px). These
            percentages centre a 52px action inside both. */}
        <div className="pointer-events-none absolute inset-x-0 top-[31.6%] z-30 flex justify-center px-6 md:top-[34.4%]">
          <div className="pointer-events-auto">
            <DeviceCta
              surface="explorer"
              location="hero_above_deck"
              variant="primary"
              size="md"
              withArrow={false}
              storeMarks
            />
          </div>
        </div>
      </div>
    </CutoutShell>
  )
}
