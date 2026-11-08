import localFont from 'next/font/local'

// #4339 — the "Mingla, Edited" brand type, scoped to the Host landing pages
// (usemingla.com/host/<icp>) only, the same way the /links route font module
// scopes it to /links (#4318). Only app/host/[icp]/page.tsx imports this module, so these
// faces load and preload on the landing pages and nowhere else. The bytes are
// the same pinned WOFF2 files as /links (app/fonts/SOURCES.json
// `linksRouteAssets`); the per-route contract is
// scripts/issue-4339-landing-fonts.contract.mjs, run by the #3548 font gates.

// Display: Instrument Serif, regular and italic (the emphasised half).
export const landingSerif = localFont({
  src: [
    { path: '../../fonts/InstrumentSerif-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/InstrumentSerif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  ],
  variable: '--font-landing-serif',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['Georgia', 'Times New Roman', 'serif'],
})

// Text: Geist 400/500/600.
export const landingSans = localFont({
  src: [
    { path: '../../fonts/Geist-latin-wght-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/Geist-latin-wght-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../fonts/Geist-latin-wght-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-landing-sans',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
})

// Labels: Geist Mono 500, uppercase, always inside a pill.
export const landingMono = localFont({
  src: [{ path: '../../fonts/GeistMono-latin-500-normal.woff2', weight: '500', style: 'normal' }],
  variable: '--font-landing-mono',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
})
