import type { Metadata } from 'next'
import { ExplorerHero } from '@/components/sections/explorer-home/hero'
import { CutoutNav, CutoutShell } from '@/components/cutout'

// #2902 — EXPLORER, Cutout shell.
//
// Seth's correction: "Explorer should stay exactly the same way content and
// structurally, but just have the cutout effect."
//
// So this page MOUNTS THE LIVE `ExplorerHero` verbatim. Re-implementing a
// 29KB component would guarantee drift from the page it is supposed to match;
// mounting it guarantees the content and structure are identical by
// construction. The Cutout treatment is the page shell it sits inside and the
// tabbed nav above it — nothing inside the hero is touched.

export const metadata: Metadata = {
  title: 'Explorer — #2902 Cutout preview',
  description: 'Review-only Cutout shell around the live Mingla Explorer home.',
  robots: { index: false, follow: false },
}

export default function CutoutExplorerPage() {
  return (
    <CutoutShell dark>
      <CutoutNav surface="explorer" homeHref="/cutout/explorer" mobileDockOffset="5rem" />
      <ExplorerHero cityKey="lagos" />
    </CutoutShell>
  )
}
