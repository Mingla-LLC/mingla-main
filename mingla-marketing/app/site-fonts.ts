import localFont from 'next/font/local'

// #4339 — the "Mingla, Edited" brand type for the redesigned marketing pages,
// scoped per route the same way the /links route font module scopes it (#4318).
// Only the redesigned pages import this module: Home (app/(explorer)/page.tsx),
// Mingla Host (app/host/page.tsx) and the seven Host landing pages
// (app/host/[icp]/page.tsx). These faces load and preload there and nowhere
// else; every other page keeps the site faces from app/fonts.ts (#3548). The
// bytes are the same pinned WOFF2 files as /links (app/fonts/SOURCES.json
// `linksRouteAssets`); the per-route contract is
// scripts/issue-4339-landing-fonts.contract.mjs, run by the #3548 font gates.

// Display: Instrument Serif, regular and italic (the emphasised half).
export const landingSerif = localFont({
  src: [
    { path: './fonts/InstrumentSerif-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/InstrumentSerif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  ],
  variable: '--font-landing-serif',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  // #4339 round B: metric-matched fallbacks (components/landing/landing.css
  // @font-face, size-adjust and ascent/descent overrides from the capsize
  // metrics of Instrument Serif against Georgia, Noto Serif on Android and
  // Times New Roman), so the serif headline does not reflow when the face
  // arrives. Next's generated fallback stays off (#3548 font manifest).
  fallback: ['MinglaSerifFallbackGeorgia', 'MinglaSerifFallbackNoto', 'MinglaSerifFallbackTimes', 'Georgia', 'serif'],
})

// Text: Geist 400/500/600.
export const landingSans = localFont({
  src: [
    { path: './fonts/Geist-latin-wght-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Geist-latin-wght-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Geist-latin-wght-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-landing-sans',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
})

// Labels: Geist Mono 500, uppercase, always inside a pill.
export const landingMono = localFont({
  src: [{ path: './fonts/GeistMono-latin-500-normal.woff2', weight: '500', style: 'normal' }],
  variable: '--font-landing-mono',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
})
