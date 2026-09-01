'use client'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — AIgocy's hero signature, ported.
//
// In the template the headline's second line is a flex row: the words, then a
// `.title-icon` holding a 255x80 brand pill (`.box`) with a six-layer glow, and
// three geometric shapes floating over and around it, breaking out of the pill's
// bounds. It is the single most recognisable thing on the page and the first
// pass had no equivalent at all.
//
// Rebuilt here in CSS/SVG rather than as images so it re-tints with the brand,
// scales with the type, and costs no network request. The shapes drift on a
// slow loop; `prefers-reduced-motion` pins them.
// ---------------------------------------------------------------

export function HeroGraphic({ className }: { className?: string }) {
  const reduced = useMinglaReducedMotion()

  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-block h-[0.84em] w-[2.3em] align-middle', className)}
    >
      {/* The brand pill. */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: 'linear-gradient(180deg, #f0842f 0%, #dd6a16 100%)',
          boxShadow: 'var(--cut-pill-glow)',
        }}
      />

      {/* Three shapes, breaking out of the pill on three sides. */}
      <span
        className={cn(
          'absolute left-[12%] top-[-14%] block h-[44%] w-[30%] rounded-[0.16em]',
          !reduced && 'cut-float-a',
        )}
        style={{
          background: 'linear-gradient(150deg, #ffffff 0%, #efe9e0 100%)',
          boxShadow: '0 8px 18px rgba(20,18,15,0.20), 0 2px 0 rgba(255,255,255,0.9) inset',
        }}
      />
      <span
        className={cn(
          'absolute right-[4%] top-[20%] block h-[54%] w-[34%] rounded-[0.18em]',
          !reduced && 'cut-float-b',
        )}
        style={{
          background: 'linear-gradient(150deg, #fdfbf8 0%, #e6ded2 100%)',
          boxShadow: '0 10px 22px rgba(20,18,15,0.22), 0 2px 0 rgba(255,255,255,0.9) inset',
        }}
      />
      <span
        className={cn(
          'absolute bottom-[-18%] left-[40%] block h-[38%] w-[26%] rounded-[0.14em]',
          !reduced && 'cut-float-c',
        )}
        style={{
          background: 'linear-gradient(150deg, #ffffff 0%, #ece4d8 100%)',
          boxShadow: '0 8px 18px rgba(20,18,15,0.20), 0 2px 0 rgba(255,255,255,0.9) inset',
        }}
      />
    </span>
  )
}

/** AIgocy's `.scroll-more` — a bottom-centred pill with top corners only. */
export function ScrollMore({ href, label = 'Scroll for more' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="cut-scroll-more absolute bottom-16 left-1/2 sm:bottom-14 flex h-14 w-[19rem] max-w-[80vw] -translate-x-1/2 items-center justify-center gap-4 text-[0.9375rem] font-semibold text-[var(--cut-body)] transition-colors hover:text-[var(--cut-ink)] focus-ring"
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
