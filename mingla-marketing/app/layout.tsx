import type { Metadata } from 'next'
import { GoogleAnalytics } from '@next/third-parties/google'
import { Mochiy_Pop_One, Nunito_Sans, Inter } from 'next/font/google'
import './globals.css'
import { ContentProtection } from '@/components/marketing/content-protection'
import { PostHogProvider } from '@/components/marketing/posthog-provider'
import { ConsentBanner } from '@/components/marketing/consent-banner'

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

export const metadata: Metadata = {
  title: { default: 'Mingla — Find a vibe, not a venue.', template: '%s — Mingla' },
  description:
    "Mingla curates the spots, plans, and experiences that match the night you actually want — for hangouts, dates, group outings, and slow Sundays.",
  metadataBase: new URL('https://www.usemingla.com'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mochiy.variable} ${nunito.variable} ${inter.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-coral-500 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
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
