import type { Metadata } from 'next'
import { GoogleAnalytics } from '@next/third-parties/google'
import { Mochiy_Pop_One, Nunito_Sans, Inter } from 'next/font/google'
import './globals.css'
import { ContentProtection } from '@/components/marketing/content-protection'
import { PostHogProvider } from '@/components/marketing/posthog-provider'
import { ConsentBanner } from '@/components/marketing/consent-banner'
import { requireRouteContract, type SearchReadyRouteContract } from '@/lib/search/route-registry'
import { SITE_ORIGIN } from '@/lib/site'
import { SkipLink } from '@/components/marketing/skip-link'

// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 1 (marketing web).
// GA4 Measurement ID — public by design (web-only). Single shared stream.
const GA4_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? 'G-Z4W3B9900S'

// GA4 consent command contract. These values are passed through the grant-only
// client boundary; neither the shim nor <GoogleAnalytics> exists before Accept.
const GA_CONSENT_DEFAULT_COMMAND = ['consent', 'default'] as const
const GA_CONSENT_DEFAULTS = {
  ad_storage: 'denied',
  analytics_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
} as const
void GA_CONSENT_DEFAULT_COMMAND
void GA_CONSENT_DEFAULTS

// Brand display — matches the live usemingla.com brand font.
// Mochiy Pop One ships in a single weight (400) with no italic axis.
const mochiy = Mochiy_Pop_One({
  subsets: ['latin'],
  variable: '--font-mochiy',
  display: 'swap',
  weight: '400',
})

// Brand body — matches the live usemingla.com body font.
const nunito = Nunito_Sans({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

// Dashboard / product UI font — a neutral corporate grotesque used INSIDE the
// product-mockup surfaces (hero dashboard card + the adapted dashboard widgets)
// so they read like real software, not branded marketing type (ORCH-1010).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

const homeRoute = requireRouteContract('/', 'search_ready') as SearchReadyRouteContract

export const metadata: Metadata = {
  title: { default: homeRoute.title, template: '%s — Mingla' },
  description: homeRoute.description,
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: 'Mingla',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      {
        url: '/favicon.ico',
        type: 'image/x-icon',
        sizes: '32x32',
      },
      {
        url: '/icon.png',
        type: 'image/png',
        sizes: '512x512',
      },
    ],
    apple: [
      {
        url: '/apple-icon.png',
        type: 'image/png',
        sizes: '180x180',
      },
    ],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mochiy.variable} ${nunito.variable} ${inter.variable}`}>
      <body>
        <noscript>
          <style>{`.search-primary-answer{opacity:1!important;transform:none!important;filter:none!important}`}</style>
        </noscript>
        <SkipLink />
        {children}
        <ContentProtection />
        {/* META-ORCH-1187 — analytics (consent-gated). */}
        <PostHogProvider>
          <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} />
        </PostHogProvider>
        <ConsentBanner />
      </body>
    </html>
  )
}
