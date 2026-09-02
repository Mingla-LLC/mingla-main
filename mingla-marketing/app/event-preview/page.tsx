// ISSUE-1105 [Event Turnout Predictor] — the "as a Mingla listing" preview.
//
// A faithful web replica of the real Mingla event page (the RN
// @mingla/offering-rendering EventOfferingBody): its design tokens, Inter font
// (the default event theme), and section layout — NOT the marketing brand look.
// Loads Inter with heavy weights here so the 900 hero title matches the app.

import { Suspense } from 'react'
import { Inter } from 'next/font/google'
import { EventPreviewClient } from './EventPreviewClient'
import { publicNoindexMetadata } from '@/lib/search/metadata'

// The real event page's default theme font is Inter; the app renders headings at
// weight 900, which the site-wide Inter (400–700) can't reach — load it here.
const previewInter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

export const metadata = publicNoindexMetadata('/event-preview', {
  title: 'Event preview',
})

export const dynamic = 'force-dynamic'

export default function EventPreviewPage() {
  return (
    <div className={previewInter.className}>
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0c0e12' }} />}>
        <EventPreviewClient />
      </Suspense>
    </div>
  )
}
