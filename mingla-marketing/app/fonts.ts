import localFont from 'next/font/local'

// Brand display — matches the live usemingla.com brand font.
// Mochiy Pop One ships in a single weight (400) with no italic axis.
export const mochiy = localFont({
  src: [
    { path: './fonts/MochiyPopOne-latin-400-normal.woff2', weight: '400', style: 'normal' },
  ],
  variable: '--font-mochiy',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['MinglaMochiyArialFallback'],
})

// Brand body — matches the live usemingla.com body font.
export const nunito = localFont({
  src: [
    { path: './fonts/NunitoSans-latin-wght-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/NunitoSans-latin-wght-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/NunitoSans-latin-wght-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/NunitoSans-latin-wght-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-nunito',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['MinglaNunitoArialFallback'],
})

// Dashboard / product UI font — a neutral corporate grotesque used INSIDE the
// product-mockup surfaces (hero dashboard card + the adapted dashboard widgets)
// so they read like real software, not branded marketing type (ORCH-1010).
export const inter = localFont({
  src: [
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['MinglaInterRootArialFallback'],
})

// Preview pages need real Inter 800/900 faces without broadening root Inter.
export const previewInter = localFont({
  src: [
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '700', style: 'normal' },
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '800', style: 'normal' },
    { path: './fonts/Inter-latin-wght-normal.woff2', weight: '900', style: 'normal' },
  ],
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['MinglaInterPreviewArialFallback'],
})
