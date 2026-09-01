// #2902 — platform marks, as inline SVG.
//
// lucide's `Apple` is a piece of fruit, not the Apple logo, so the real marks
// are drawn here. Each is used only to label its own platform's action, which
// is the use each vendor's guidelines permit.
//
// The web mark is drawn rather than taken from lucide because lucide's icons
// are STROKE glyphs and these two are FILLED. Mixing the two at 18px makes the
// odd one out look broken; a filled monitor sits in the row correctly.

export function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.05 12.66c-.03-2.4 1.96-3.55 2.05-3.61-1.12-1.64-2.86-1.86-3.48-1.89-1.48-.15-2.89.87-3.64.87-.75 0-1.91-.85-3.14-.83-1.61.02-3.1.94-3.93 2.38-1.68 2.91-.43 7.21 1.2 9.57.8 1.15 1.75 2.45 3 2.4 1.21-.05 1.66-.78 3.12-.78 1.46 0 1.87.78 3.14.75 1.3-.02 2.12-1.18 2.91-2.34.92-1.34 1.3-2.64 1.32-2.71-.03-.01-2.53-.97-2.55-3.85ZM14.66 5.4c.66-.81 1.11-1.93.99-3.05-.95.04-2.11.64-2.8 1.44-.61.71-1.15 1.85-1.01 2.94 1.07.08 2.16-.54 2.82-1.33Z" />
    </svg>
  )
}

/** Google Play's four-colour triangle, flattened to a single fill. */
export function PlayMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M3.6 2.3a1 1 0 0 0-.5.88v17.64a1 1 0 0 0 .5.88l.1.05 9.9-9.75-9.9-9.75-.1.05Zm11.2 8.05L5.3 1.02l11.6 6.6-2.1 2.73Zm0 3.3 2.1 2.73-11.6 6.6 9.5-9.33Zm1.5-1.65 3.2-1.82c.66-.37.66-1.31 0-1.68l-3-1.7-2.3 3.02 2.1 2.18Z" />
    </svg>
  )
}

/** Desktop web. Filled, to match the two brand marks beside it. */
export function WebMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-6.25v2.5h3.25a.75.75 0 0 1 0 1.5H7.5a.75.75 0 0 1 0-1.5h3.25V16H4.5A1.5 1.5 0 0 1 3 14.5v-10Zm1.5 0v10h15v-10h-15Z" />
    </svg>
  )
}
