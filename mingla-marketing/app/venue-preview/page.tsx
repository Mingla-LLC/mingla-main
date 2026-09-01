// ISSUE-1003 [Venue Website Grader] — the "after" homepage preview.
//
// A standalone, premium venue homepage rendered from a run's saved data. It is
// what the grader screenshots as the before/after "after" — so it deliberately
// lives OUTSIDE the /tools chrome and renders as a full-viewport overlay (max
// z-index) that covers the root layout's consent banner during capture. Not a
// marketing surface: noindex, unlisted, reached only via the run's run_id.

import { Suspense } from 'react'
import { VenuePreviewClient } from './VenuePreviewClient'
import { publicNoindexMetadata } from '@/lib/search/metadata'

export const metadata = publicNoindexMetadata('/venue-preview', {
  title: 'Venue preview',
})

export const dynamic = 'force-dynamic'

export default function VenuePreviewPage() {
  return (
    <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0b0b0d' }} />}>
      <VenuePreviewClient />
    </Suspense>
  )
}
