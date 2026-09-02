'use client'
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

// The dispersed hero shapes were removed on Seth's instruction: unnecessary,
// and they competed with the headline rather than supporting it. The hero is
// now the photograph, the scrim and the type — nothing else.

/** AIgocy's `.scroll-more` — a bottom-centred pill with top corners only. */
export function ScrollMore({ href, label = 'Scroll for more' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="cut-scroll-more absolute bottom-0 left-1/2 hidden h-14 md:flex w-[19rem] max-w-[80vw] -translate-x-1/2 items-center justify-center gap-4 text-[0.9375rem] font-semibold text-[var(--cut-body)] transition-colors hover:text-[var(--cut-ink)] focus-ring"
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
