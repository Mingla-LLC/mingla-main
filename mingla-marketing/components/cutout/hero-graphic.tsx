'use client'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — hero atmosphere.
//
// The previous version clustered a brand pill and three squares into a single
// object inside the headline. Seth's read was correct and worth recording: it
// looked like a UI TOGGLE, not like art — a discrete element competing with the
// headline rather than accentuating it.
//
// So the pill is gone and the shapes are dispersed across the whole hero at low
// opacity, well clear of the copy. They now do what they are for: give the
// space depth and a sense of motion. Nothing sits inside the headline.
// ---------------------------------------------------------------

interface Shape {
  className: string
  style: React.CSSProperties
  float: string
}

const SHAPES: Shape[] = [
  { className: 'left-[6%] top-[18%] h-16 w-16 rounded-[1.25rem] sm:h-24 sm:w-24', style: { transform: 'rotate(-14deg)' }, float: 'cut-float-a' },
  { className: 'right-[9%] top-[24%] h-20 w-20 rounded-[1.5rem] sm:h-28 sm:w-28', style: { transform: 'rotate(11deg)' }, float: 'cut-float-b' },
  { className: 'left-[13%] bottom-[16%] h-14 w-14 rounded-[1rem] sm:h-20 sm:w-20', style: { transform: 'rotate(8deg)' }, float: 'cut-float-c' },
  { className: 'right-[15%] bottom-[13%] h-12 w-12 rounded-[0.9rem] sm:h-16 sm:w-16', style: { transform: 'rotate(-9deg)' }, float: 'cut-float-a' },
]

export function HeroAtmosphere({ className }: { className?: string }) {
  const reduced = useMinglaReducedMotion()
  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 hidden md:block', className)}>
      {SHAPES.map((shape, i) => (
        <span
          key={i}
          className={cn('absolute block', shape.className, !reduced && shape.float)}
          style={{
            ...shape.style,
            background: 'linear-gradient(150deg, rgba(255,255,255,0.95) 0%, rgba(238,231,221,0.85) 100%)',
            boxShadow: '0 14px 30px rgba(20,18,15,0.10), 0 2px 0 rgba(255,255,255,0.9) inset',
          }}
        />
      ))}
      {/* One warm bloom so the shapes sit in light rather than on a flat plane. */}
      <span
        className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(235,120,37,0.10) 0%, rgba(235,120,37,0) 70%)' }}
      />
    </div>
  )
}

/** AIgocy's `.scroll-more` — a bottom-centred pill with top corners only. */
export function ScrollMore({ href, label = 'Scroll for more' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="cut-scroll-more absolute bottom-16 left-1/2 flex h-14 w-[19rem] max-w-[80vw] -translate-x-1/2 items-center justify-center gap-4 text-[0.9375rem] font-semibold text-[var(--cut-body)] transition-colors hover:text-[var(--cut-ink)] focus-ring sm:bottom-14"
    >
      {label}
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--cut-accent)]"
        style={{ background: 'rgba(235,120,37,0.12)' }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v10M2.5 7.5 6 11l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </a>
  )
}
