// #4636 block `wideClip` — About's wide ambient clip, moved as-is (R1).
// Decorative: aria-hidden.
import { LandingMedia } from '@/components/landing/landing-media'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import type { BlockProps } from './shared'

export interface WideClipContent {
  media: LandingMediaRef
}

export function WideClipBlock({ content }: BlockProps<WideClipContent>) {
  return (
    <section className="about-clip" aria-hidden="true">
      <div className="wrap">
        <div className="ph reveal">
          <LandingMedia media={content.media} />
        </div>
      </div>
    </section>
  )
}
