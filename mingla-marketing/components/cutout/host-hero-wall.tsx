import Image from 'next/image'
import { hostImage } from '@/lib/design-preview/host-imagery'
import { HeroWallMotion } from './host-hero-wall-motion'

// ---------------------------------------------------------------
// #4137 — the /host hero backdrop: a wall of six photographs that zoom slowly
// behind a light veil. It replaces the 2.39 MB painted-village video.
//
// Server Component. The only client code is HeroWallMotion, which marks the
// wall `data-paused` when it is off screen or the tab is hidden, so the zoom
// stops (cutout.css). Under prefers-reduced-motion the zoom never runs.
//
// The wall is absolutely positioned inside the hero's fixed min-height, so it
// adds no layout shift. Every tile is decorative: alt="" inside an aria-hidden
// container, and no caption, place tag or credit is ever rendered.
// ---------------------------------------------------------------

const TILES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const

export function HostHeroWall() {
  return (
    <HeroWallMotion>
      {TILES.map((slot, index) => {
        const image = hostImage(slot)
        return (
          <div key={slot} className="cut-hero-wall-tile">
            <Image
              src={image.file}
              alt=""
              fill
              sizes="(min-width: 768px) 34vw, 50vw"
              className="object-cover"
              priority={index === 0}
              fetchPriority={index === 0 ? 'high' : 'low'}
              loading={index === 0 ? undefined : 'eager'}
            />
          </div>
        )
      })}
      <div className="cut-hero-veil" />
    </HeroWallMotion>
  )
}
