import localFont from 'next/font/local'

// #4318 — the "Mingla, Edited" brand type, scoped to usemingla.com/links only.
// This module is imported by the /links route alone, so these faces load and
// preload there and nowhere else (the rest of the site keeps app/fonts.ts).
// Assets: pinned WOFF2 converted from the brand pack (app/fonts/SOURCES.json
// `linksRouteAssets`), guarded by scripts/issue-3548-local-fonts.*.test.mjs.
// Fallbacks are plain system stacks (no generated metric faces).

// Display: Instrument Serif, regular and italic (the emphasised half).
export const linksSerif = localFont({
  src: [
    { path: '../fonts/InstrumentSerif-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/InstrumentSerif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  ],
  variable: '--font-links-serif',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['Georgia', 'Times New Roman', 'serif'],
})

// Text: Geist 400/500/600.
export const linksSans = localFont({
  src: [
    { path: '../fonts/Geist-latin-wght-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/Geist-latin-wght-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/Geist-latin-wght-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-links-sans',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
})

// Labels: Geist Mono 500, uppercase, always inside a pill.
export const linksMono = localFont({
  src: [{ path: '../fonts/GeistMono-latin-500-normal.woff2', weight: '500', style: 'normal' }],
  variable: '--font-links-mono',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
})
