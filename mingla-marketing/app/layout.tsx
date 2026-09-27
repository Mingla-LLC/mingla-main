import type { Metadata } from 'next'
import { GoogleAnalytics } from '@next/third-parties/google'
import { inter, mochiy, nunito } from './fonts'
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
