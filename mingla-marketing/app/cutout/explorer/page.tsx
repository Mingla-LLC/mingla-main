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

        {/* Beneath the sliding cards, above the hero's own bottom pill row.
            Measured, not guessed: at 1440x900 the deck ends at y=747 and the
            pill row starts at y=844, so the action is centred in that 97px gap.
            The first attempt sat at 5.25rem and overlapped the card. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-[4.7rem] z-30 flex justify-center px-6">
          <div className="pointer-events-auto">
            <DeviceCta surface="explorer" location="hero_under_deck" variant="primary" size="lg" />
          </div>
        </div>
      </div>
    </CutoutShell>
  )
}
