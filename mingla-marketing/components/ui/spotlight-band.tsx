import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------
// ORCH-1010 — <SpotlightBand>
//
// Wraps a section in data-theme="dark" + the --bg-spotlight night-canvas,
// restoring the consumer hero's dark surface inside the otherwise-light
// /organisers page. Used by the two "argument" crescendos: Comparison
// (optional) + CTA (required). data-theme="dark" flips every theme-aware
// token (text, glass, dividers) back to the dark recipe for descendants,
// so glass-strong cards and white text read correctly without per-element
// overrides.
//
// The section element itself owns vertical/horizontal rhythm; children get
// a centered max-width container at the call site. Optional faint dot-grid
// overlay mirrors the consumer hero's route-grid energy (off by default —
// the business signature is the warm aurora + real card, not the grid).
// ---------------------------------------------------------------

interface SpotlightBandProps {
  children: ReactNode
  /** Faint dot-grid overlay (consumer-hero echo). Default off. */
  grid?: boolean
  /** Extra classes on the <section>. */
  className?: string
  /** Optional id for in-page anchors. */
  id?: string
  /** Optional aria-label for the section landmark. */
  'aria-label'?: string
}

export function SpotlightBand({
  children,
  grid = false,
  className,
  id,
  'aria-label': ariaLabel,
}: SpotlightBandProps) {
  return (
    <section
      id={id}
      aria-label={ariaLabel}
      data-theme="dark"
      style={{ background: 'var(--bg-spotlight)' }}
      className={cn(
        'relative overflow-hidden',
        // Safe-area aware horizontal padding + locked vertical rhythm at the
        // call site via className; defaults provided here.
        'px-6 py-24 md:px-10 md:py-40',
        '[padding-left:max(1.5rem,env(safe-area-inset-left))]',
        '[padding-right:max(1.5rem,env(safe-area-inset-right))]',
        'md:[padding-left:max(2.5rem,env(safe-area-inset-left))]',
        'md:[padding-right:max(2.5rem,env(safe-area-inset-right))]',
        className,
      )}
    >
      {grid ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(235,120,37,0.24)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:72px_72px]"
        />
      ) : null}
      <div className="relative">{children}</div>
    </section>
  )
}
