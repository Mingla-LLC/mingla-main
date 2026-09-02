// #1086 — standalone scheduling page at the top-level /schedule. Any lead funnel
// (grader report, homepage CTA, cold email, ad) points here to book a Mingla
// call. Reads ?venue / ?report_url / ?source (+ optional name/email prefill) on
// the client; the day → time → confirm flow is a client state machine.

import { Suspense } from 'react'
import { ScheduleClient } from './ScheduleClient'
import { publicNoindexMetadata } from '@/lib/search/metadata'

export const metadata = publicNoindexMetadata('/schedule', {
  title: 'Book a call with Mingla',
  description: 'Grab 20 minutes with Mingla — pick a day and time that works for you.',
})

export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <Suspense fallback={<ScheduleSkeleton />}>
      <ScheduleClient />
    </Suspense>
  )
}

function ScheduleSkeleton() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="flex flex-col items-center gap-3">
        <span
          aria-hidden="true"
          className="size-6 animate-spin rounded-full border-2 border-warm/30 border-t-warm"
        />
        <p className="text-sm text-white/70">Loading…</p>
      </div>
    </div>
  )
}
