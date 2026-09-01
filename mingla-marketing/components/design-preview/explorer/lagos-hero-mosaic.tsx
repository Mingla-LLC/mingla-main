'use client'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { useActiveInViewport } from '@/lib/use-active-in-viewport'
import { LAGOS_VENUES } from '@/lib/design-preview/lagos-truth'

// #2902 — the Explorer hero media.
//
// WHY A MOSAIC AND NOT A CINEMATIC PLATE. The brief forbids generating a fake
// Lagos scene, and no owned Lagos film exists. What DOES exist is ten real
// photographs of ten real Lagos venues, already in Mingla's own storage bucket.
// So the hero is made of the actual inventory the page is about. It is
// specific, it is Lagos, it is ours, and nothing in it is invented.
//
// Motion: three columns drift vertically at different speeds. The animation is
// pure `transform` (compositor-only), pauses when the hero leaves the viewport
// or the tab is hidden, and is replaced by a static grid under reduced motion.

const COLUMNS = 3
const SPEEDS = ['58s', '74s', '66s'] as const

function columnFor(index: number) {
  const picks = LAGOS_VENUES.filter((_, i) => i % COLUMNS === index)
  // Doubling the list is what makes the -50% keyframe loop seamlessly.
  return [...picks, ...picks]
}

export function LagosHeroMosaic() {
  const reduced = useMinglaReducedMotion()
  const { ref, active } = useActiveInViewport<HTMLDivElement>()
  const animating = !reduced && active

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden bg-obsidian">
      {/* -inset-y-32 overfills the frame vertically. Reviewing the built hero
          showed bare black bands above and below the columns, because a
          drifting column is never exactly viewport-height. */}
      <div className="absolute -inset-y-32 inset-x-0 flex justify-center gap-3 md:gap-4">
        {Array.from({ length: COLUMNS }).map((_, col) => (
          <div
            key={col}
            className={cn(
              'relative w-1/3 max-w-[24rem] shrink-0 overflow-hidden',
              // The middle column is offset so the grid never reads as a table.
              col === 1 && '-mt-24',
            )}
          >
            <div
              className="flex flex-col gap-3 md:gap-4"
              style={
                animating
                  ? {
                      animation: `mingla-marquee-y ${SPEEDS[col]} linear infinite`,
                      animationDirection: col === 1 ? 'reverse' : 'normal',
                    }
                  : undefined
              }
            >
              {[...columnFor(col), ...columnFor(col)].map((venue, i) => (
                <div
                  key={`${venue.placeKey}-${i}`}
                  className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-[#1a1a2e]"
                >
                  {/* Decorative: the headline carries the message, and each
                      venue is named with its real data further down the page. */}
                  <img
                    src={venue.photo}
                    alt=""
                    aria-hidden="true"
                    loading={i < 2 ? 'eager' : 'lazy'}
                    decoding="async"
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Desaturating wash. The mosaic is atmosphere; the copy sanctuary in
          LandingHero owns contrast, and this keeps the photos from fighting it. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: 'rgba(8,9,12,0.34)' }}
      />
    </div>
  )
}
