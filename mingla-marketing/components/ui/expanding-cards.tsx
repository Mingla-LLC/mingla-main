'use client'
import * as React from 'react'
import { getImageProps } from 'next/image'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { HostImage } from '@/lib/design-preview/host-imagery'

// ---------------------------------------------------------------
// #2902, rewritten for #4137 — expanding cards.
//
// ONE CARD OPEN AT A TIME, and it stays open. A card opens on mouse hover, on
// keyboard focus, or on a tap/click of its full-card <button>. NOTHING closes
// a card except another card opening: there is no pointer-leave or blur
// handler, so moving the pointer through the gap between cards, or off the
// list, never collapses the open one.
//
// NO `isDesktop` STATE AND NO RESIZE LISTENER (F-5). The old version started in
// rows, then switched to columns in an effect, which shifted the layout on
// every desktop load. The row-versus-column layout is now pure CSS by
// breakpoint (`.cut-xc` in cutout.css), so the server HTML already has the
// right shape.
//
// THE BODY IS FIXED-WIDTH (F-3). The text block is absolutely positioned at
// `min(300px, 100% - 40px)`, and the open desktop card is always wider than
// that, so the paragraph never re-flows while the card animates open. It
// fades instead.
//
// ACCESSIBILITY (F-1). Each card has a real <button aria-expanded> stretched
// over it, so keyboard users can open every card. The body is not hidden from
// screen readers when collapsed, so every description is still read. The
// optional "Learn more" link is a sibling of the button, never nested in it.
//
// IMAGES (F-2). Full colour in every state. Desktop and phone get their own
// crop through <picture>.
// ---------------------------------------------------------------

export interface CardItem {
  id: string | number
  /** Shown expanded. */
  title: string
  /** Shown on the collapsed rail — what this is FOR, not just its name. */
  usp: string
  description: string
  /** Art-directed pair: 4:5 for the desktop strip, 3:2 for the phone row. */
  imgSrc: { desktop: HostImage; phone: HostImage }
  icon: React.ReactNode
  /**
   * Optional. The seven ICP pages are not built yet, and a card that links
   * nowhere beats one that links to a 404 (Seth, #4137 OQ-4: off for now).
   */
  linkHref?: string
}

interface ExpandingCardsProps extends React.HTMLAttributes<HTMLUListElement> {
  items: CardItem[]
  defaultActiveIndex?: number
}

function CardPicture({ images }: { images: CardItem['imgSrc'] }) {
  const common = { alt: '', fill: true, loading: 'lazy' as const }
  const { props: desktop } = getImageProps({
    ...common,
    src: images.desktop.file,
    sizes: '(min-width: 1024px) 40vw, 100vw',
  })
  const { props: phone } = getImageProps({
    ...common,
    src: images.phone.file,
    sizes: '100vw',
  })
  return (
    <picture>
      <source media="(min-width: 1024px)" srcSet={desktop.srcSet} sizes={desktop.sizes} />
      <source srcSet={phone.srcSet} sizes={phone.sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img {...phone} className="cut-xcard-img" draggable={false} aria-hidden="true" />
    </picture>
  )
}

export const ExpandingCards = React.forwardRef<HTMLUListElement, ExpandingCardsProps>(
  ({ className, items, defaultActiveIndex = 0, ...props }, ref) => {
    const [activeIndex, setActiveIndex] = React.useState(defaultActiveIndex)
    const baseId = React.useId()

    return (
      <ul ref={ref} className={cn('cut-xc', className)} {...props}>
        {items.map((item, index) => {
          const active = activeIndex === index
          const bodyId = `${baseId}-card-${index}`
          return (
            <li
              key={item.id}
              data-active={active}
              className="cut-xcard"
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') setActiveIndex(index)
              }}
            >
              <CardPicture images={item.imgSrc} />
              <div aria-hidden="true" className="cut-xcard-shade" />

              <button
                type="button"
                className="cut-xcard-trigger"
                aria-expanded={active}
                aria-controls={bodyId}
                onFocus={() => setActiveIndex(index)}
                onClick={() => setActiveIndex(index)}
              >
                <span className="sr-only">{item.title}</span>
              </button>

              {/* The label chip: vertical on the collapsed desktop strip,
                  horizontal in the stacked phone row. */}
              <span aria-hidden="true" className="cut-xchip">
                {item.usp}
              </span>

              <div id={bodyId} className="cut-xbody">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/18 text-white ring-1 ring-inset ring-white/30 backdrop-blur-md"
                >
                  {item.icon}
                </span>
                <h3 className="font-display text-[1.375rem] leading-tight tracking-[-0.02em] text-white">
                  {item.title}
                </h3>
                <p className="text-[0.9375rem] leading-snug text-white/85">{item.description}</p>
                {item.linkHref ? (
                  <a
                    href={item.linkHref}
                    className={cn(
                      'relative z-20 mt-1 inline-flex w-fit items-center gap-2 rounded-full bg-white/14 px-4 py-2.5',
                      'text-[0.875rem] font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur-md',
                      'transition-colors hover:bg-white/24 focus-ring',
                    )}
                  >
                    Learn more
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    )
  },
)
ExpandingCards.displayName = 'ExpandingCards'
