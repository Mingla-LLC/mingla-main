// ISSUE-1004 [Event Turnout Predictor] — the "as a Mingla listing" preview.
//
// A polished, ready-to-publish version of the organiser's event, rendered from
// a run's saved listing copy. Opened from the report ("See the full listing
// preview"). Unlisted, noindex, reached only via the run's run_id.

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EventPreviewClient } from './EventPreviewClient'

export const metadata: Metadata = {
  title: 'Event preview',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function EventPreviewPage() {
  return (
    <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0b0b0d' }} />}>
      <EventPreviewClient />
    </Suspense>
  )
}
