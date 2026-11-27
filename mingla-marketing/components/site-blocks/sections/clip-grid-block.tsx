// #4636 block `clipGrid` — Creators' four silent clips, moved as-is (R1).
// Renders inside the programme frame (pb-100 > wrap). Decorative: aria-hidden.
import { LandingMedia } from '@/components/landing/landing-media'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import type { BlockProps } from './shared'

export interface ClipGridContent {
  items: readonly { media: LandingMediaRef }[]
}

export function ClipGridBlock({ content }: BlockProps<ClipGridContent>) {
  return (
    <div className="grid4 reel-grid" aria-hidden="true">
      {content.items.map((clip) => (
        <div className="ph reveal" key={clip.media}>
          <LandingMedia media={clip.media} />
        </div>
      ))}
    </div>
  )
}
