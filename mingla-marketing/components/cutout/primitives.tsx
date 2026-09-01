import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'

// #2902 — Cutout layout primitives. All server components: nothing here needs
// state, so nothing here ships JavaScript. That matters because every one of
// these renders the page's indexable content, and answer engines largely do not
// execute JS — the meaning has to be in the HTML.

/**
 * The page shell: the card the whole site lies on.
 *
 * `dark` is for the Explorer surface, which stays the night canvas it already
 * is — the Cutout treatment there is the shell and the nav, not a repaint.
 */
export function CutoutShell({
  children,
  dark = false,
  noScroll = false,
}: {
  children: ReactNode
  dark?: boolean
  /**
   * Locks the page to exactly one viewport. The Explorer home is a
   * non-scrolling hero, and the live `ExplorerHero` is a fixed `h-[100svh]` —
   * inside a padded shell that overflows by exactly the padding, which is why
   * the page scrolled a few pixels. This clips the page and forces the hero to
   * FILL the inset rather than overhang it.
   */
  noScroll?: boolean
}) {
  return (
    <div
      data-cutout
      data-cut-band={dark ? 'dark' : undefined}
      className={cn(
        'px-2 pb-2 pt-2 sm:px-3 sm:pb-3 sm:pt-3',
        noScroll ? 'h-[100svh] overflow-hidden' : 'min-h-screen',
      )}
      style={{ background: dark ? '#0a0a0c' : 'var(--cut-ground, #efe9df)' }}
    >
      <div
        className={cn(
          'cut-shell relative',
          noScroll && 'h-full [&>section]:!h-full [&>section]:!min-h-0',
        )}
      >
        {children}
      </div>
    </div>
  )
}

interface CutoutSectionProps {
  children: ReactNode
  id?: string
  band?: 'light' | 'dark'
  /** `hero` removes the top rhythm so the hero can own the full viewport. */
  rhythm?: 'hero' | 'normal' | 'tight'
  className?: string
  'aria-label'?: string
  as?: 'section' | 'div'
}

export function CutoutSection({
  children,
  id,
  band = 'light',
  rhythm = 'normal',
  className,
  'aria-label': ariaLabel,
  as: Tag = 'section',
}: CutoutSectionProps) {
  return (
    <Tag
      id={id}
      aria-label={ariaLabel}
      data-cut-band={band === 'dark' ? 'dark' : undefined}
      // 7rem clears the fixed nav. Without it every in-page CTA lands its own
      // heading underneath the header — caught by looking at a built page.
      style={{
        scrollMarginTop: '7rem',
        background: band === 'dark' ? 'var(--cut-ground)' : 'transparent',
        color: 'var(--cut-ink)',
      }}
      className={cn(
        'relative px-5 sm:px-8 lg:px-12',
        rhythm === 'hero' && 'py-0',
        rhythm === 'normal' && 'py-16 sm:py-24 lg:py-28',
        rhythm === 'tight' && 'py-12 sm:py-16',
        '[padding-left:max(1.25rem,env(safe-area-inset-left))]',
        '[padding-right:max(1.25rem,env(safe-area-inset-right))]',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </Tag>
  )
}

interface CutoutCardProps {
  children: ReactNode
  className?: string
  interactive?: boolean
  /** Inner padding. `none` when the card frames a full-bleed media window. */
  pad?: 'none' | 'sm' | 'md' | 'lg'
  as?: 'div' | 'li' | 'article'
}

// AIgocy pads .features-item at 32px and .pricing-item / .team-item at 40px.
// The first pass used 24–28 and the cards read as cramped next to the template.
const PAD = {
  none: '',
  sm: 'p-4 sm:p-5',
  md: 'p-6 sm:p-8',
  lg: 'p-8 sm:p-10',
} as const

export function CutoutCard({
  children,
  className,
  interactive = false,
  pad = 'md',
  as: Tag = 'div',
}: CutoutCardProps) {
  return (
    <Tag className={cn('cut-card', interactive && 'cut-card-interactive', PAD[pad], className)}>
      {children}
    </Tag>
  )
}

/**
 * The media window — a rounded rectangle inset inside a card. This is the
 * literal cut-out: the card frames a hole the media shows through.
 */
export function CutoutMedia({
  children,
  className,
  ratio = 'landscape',
}: {
  children: ReactNode
  className?: string
  ratio?: 'landscape' | 'portrait' | 'square' | 'wide' | 'auto'
}) {
  const RATIO = {
    landscape: 'aspect-[4/3]',
    portrait: 'aspect-[3/4]',
    square: 'aspect-square',
    wide: 'aspect-[16/9]',
    auto: '',
  } as const
  return <div className={cn('cut-media relative w-full', RATIO[ratio], className)}>{children}</div>
}

/**
 * The overhanging tile. Negative margins are the entire effect — the tile hangs
 * past the card's corner so the card reads as cut around it. Decorative by
 * default: the heading beside it always carries the meaning.
 */
export function CutoutTile({
  children,
  className,
  overhang = true,
}: {
  children: ReactNode
  className?: string
  overhang?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'cut-tile inline-flex h-14 w-14 shrink-0 items-center justify-center text-white',
        overhang && '-ml-3 -mt-12 sm:-ml-4 sm:-mt-14',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function CutoutEyebrow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-4 py-2.5',
        'text-[0.75rem] font-bold uppercase tracking-[0.14em]',
        'cut-btn-light text-[var(--cut-accent-ink)]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'var(--cut-accent)' }}
      />
      {children}
    </span>
  )
}

interface CutoutHeadingProps {
  eyebrow?: string
  children: ReactNode
  lede?: ReactNode
  align?: 'left' | 'center'
  as?: 'h1' | 'h2' | 'h3'
  className?: string
  /** Rendered under the lede — normally a <DeviceCta>. */
  action?: ReactNode
}

export function CutoutHeading({
  eyebrow,
  children,
  lede,
  align = 'left',
  as: Tag = 'h2',
  className,
  action,
}: CutoutHeadingProps) {
  return (
    <div
      className={cn(
        'flex flex-col',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      {eyebrow ? <CutoutEyebrow className="mb-5">{eyebrow}</CutoutEyebrow> : null}
      <Tag
        className={cn(
          'font-display cut-gradient-text',
          Tag === 'h1' ? 'cut-display max-w-[15ch]' : 'cut-display-2 max-w-[18ch]',
          align === 'center' && 'mx-auto',
        )}
      >
        {children}
      </Tag>
      {lede ? (
        <p
          className={cn(
            'mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-[var(--cut-body)] sm:text-lg',
            align === 'center' && 'mx-auto',
          )}
        >
          {lede}
        </p>
      ) : null}
      {action ? <div className="mt-8 flex flex-wrap items-center gap-3">{action}</div> : null}
    </div>
  )
}

/** Thin connector rail with a dot node — AIgocy's card-to-centre linkage. */
export function CutoutConnector({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('relative block h-px w-full', className)}>
      <span className="cut-connector absolute inset-0" />
      <span
        className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'var(--cut-accent)' }}
      />
    </span>
  )
}
