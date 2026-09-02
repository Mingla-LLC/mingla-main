// ISSUE-1005 [Quote Any Trip] — the "as a bookable Mingla trip page" preview.
//
// A faithful web replica of the real Mingla trip page (the RN
// @mingla/offering-rendering TripOfferingBody): its design tokens, Inter font
// (the default offering theme), and section layout — NOT the marketing brand
// look. Loads Inter with heavy weights so the 900 hero title matches the app.

import { Suspense } from 'react'
import { Inter } from 'next/font/google'
import { TripPreviewClient } from './TripPreviewClient'
import { publicNoindexMetadata } from '@/lib/search/metadata'

const previewInter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

export const metadata = publicNoindexMetadata('/trip-preview', {
  title: 'Trip preview',
})

export const dynamic = 'force-dynamic'

export default function TripPreviewPage() {
  return (
    <div className={previewInter.className}>
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0c0e12' }} />}>
        <TripPreviewClient />
      </Suspense>
    </div>
  )
}
