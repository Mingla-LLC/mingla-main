'use client'
import * as React from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — expanding cards.
//
// DEPENDENCIES: lucide-react only, already installed. The single edit to the
// supplied source is `@/lib/utils` → `@/lib/cn`, which is where this repo's
// `cn` lives.
//
// CHANGES TO THE PATTERN, per Seth:
//   - The collapsed rail carries a ONE-WORD USP in a HORIZONTAL pill. The
//     rotated sentence it replaces was hard to read, sat with no clearance at
//     the foot of the card, and forced the rail narrower than a phone can use.
//     A horizontal pill sets the minimum width instead, so the rail is thicker
//     and the word is legible at a glance.
//   - The expanded card carries a "Learn more" control. The whole card is
//     still clickable — that control IS the link, stretched over the card with
//     an ::after overlay. One anchor, no nested interactive elements, and no
//     div-with-onClick pretending to be a link.
//
// ACCESSIBILITY, added on top of the supplied source:
//   - The supplied version puts `onClick` and `tabIndex` on a bare <li>, which
//     gives a focusable element with no role and no keyboard activation. Here
//     the card is a real list item containing a real link; hover and focus
//     expand it, and Enter follows it because it is an anchor.
//   - Under `prefers-reduced-motion` the grid resizes without a transition.
// ---------------------------------------------------------------

export interface CardItem {
  id: string | number
  /** Shown expanded. */
  title: string
  /** Shown on the collapsed rail — what this is FOR, not just its name. */
  usp: string
  description: string
  imgSrc: string
  icon: React.ReactNode
  linkHref: string
}

interface ExpandingCardsProps extends React.HTMLAttributes<HTMLUListElement> {
  items: CardItem[]
  defaultActiveIndex?: number
}

export const ExpandingCards = React.forwardRef<HTMLUListElement, ExpandingCardsProps>(
  ({ className, items, defaultActiveIndex = 0, ...props }, ref) => {
    const [activeIndex, setActiveIndex] = React.useState(defaultActiveIndex)
    const [isDesktop, setIsDesktop] = React.useState(false)
    const reduced = useMinglaReducedMotion()

    React.useEffect(() => {
      const onResize = () => setIsDesktop(window.innerWidth >= 768)
      onResize()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [])

    const gridStyle = React.useMemo(() => {
      const track = items.map((_, i) => (i === activeIndex ? '5fr' : '1fr')).join(' ')
      return isDesktop
        ? { gridTemplateColumns: track, gridTemplateRows: '1fr' }
        : { gridTemplateRows: track, gridTemplateColumns: '1fr' }
    }, [activeIndex, items, isDesktop])

    return (
      <ul
        ref={ref}
        style={gridStyle}
        className={cn(
          'grid h-[38rem] w-full gap-2.5 md:h-[30rem]',
          !reduced &&
            'transition-[grid-template-columns,grid-template-rows] duration-500 ease-out',
          className,
        )}
        {...props}
      >
        {items.map((item, index) => {
          const active = activeIndex === index
          return (
            <li
              key={item.id}
              data-active={active}
              onMouseEnter={() => setActiveIndex(index)}
              // The collapsed floor is arithmetic, not taste, and the longest
              // word sets it. "Restaurants" measured 113px against a 104px
              // card and overflowed; 116px holds it with the pill a step
              // smaller. Six collapsed cards then take 696 of the 1092px row
              // and the ACTIVE card still gets ~396px — enough for its title,
              // two lines and the control. (At 148px the open card collapsed
              // to 204px, which is the failure this arithmetic exists to
              // avoid.)
              className="group relative min-h-0 min-w-0 overflow-hidden rounded-[var(--cut-r-card)] md:min-w-[116px]"
              style={{ boxShadow: 'var(--cut-mould)' }}
            >
              <img
                src={item.imgSrc}
                alt=""
                aria-hidden="true"
                loading={index < 3 ? 'eager' : 'lazy'}
                decoding="async"
                draggable={false}
                className={cn(
                  'absolute inset-0 h-full w-full object-cover',
                  !reduced && 'transition-all duration-500 ease-out',
                  active ? 'scale-100 grayscale-0' : 'scale-110 grayscale',
                )}
              />
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(10,9,8,0.15) 0%, rgba(10,9,8,0.35) 45%, rgba(10,9,8,0.88) 100%)',
                }}
              />

              {/* Collapsed pill — horizontal, one word, clear of the bottom edge. */}
              <span
                aria-hidden={active}
                className={cn(
                  'absolute bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1.5',
                  'bg-white/16 font-display text-[0.6875rem] text-white ring-1 ring-inset ring-white/25 backdrop-blur-md',
                  !reduced && 'transition-opacity duration-300',
                  active && 'opacity-0',
                )}
              >
                {item.usp}
              </span>

              <div
                className={cn(
                  'absolute inset-0 flex flex-col justify-end gap-3 p-5 sm:p-6',
                  !reduced && 'transition-opacity duration-300',
                  active ? 'opacity-100 delay-100' : 'pointer-events-none opacity-0',
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/18 text-white ring-1 ring-inset ring-white/30 backdrop-blur-md"
                >
                  {item.icon}
                </span>
                <h3 className="font-display text-[1.375rem] leading-tight tracking-[-0.02em] text-white">
                  {item.title}
                </h3>
                <p className="max-w-sm text-[0.9375rem] leading-snug text-white/80">
                  {item.description}
                </p>

                {/* The link IS the whole card: ::after stretches it over the
                    tile, so one anchor serves both the button and the surface. */}
                <a
                  href={item.linkHref}
                  className={cn(
                    'mt-1 inline-flex w-fit items-center gap-2 rounded-full bg-white/14 px-4 py-2.5',
                    'text-[0.875rem] font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur-md',
                    'transition-colors hover:bg-white/24 focus-ring',
                    'after:absolute after:inset-0 after:content-[""]',
                  )}
                >
                  Learn more
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </li>
          )
        })}
      </ul>
    )
  },
)
ExpandingCards.displayName = 'ExpandingCards'
