// ISSUE-1005 — the full trip quote, opened from the tokenized link in the email.
// Reads ?id=<run_id>&t=<token>, verifies server-side (growth-tools-report), and
// renders the FULL, ungated report. Entering an email on the quoter never reveals
// this; only the emailed link does.

import { Suspense } from 'react'
import { TripReportPageClient } from './TripReportPageClient'
import { publicNoindexMetadata } from '@/lib/search/metadata'

export const metadata = publicNoindexMetadata('/tools/trips/report', {
  title: 'Your trip quote — Mingla',
})

export const dynamic = 'force-dynamic'

export default function TripReportPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Suspense fallback={<ReportSkeleton />}>
        <TripReportPageClient />
      </Suspense>
    </main>
  )
}

function ReportSkeleton() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="flex flex-col items-center gap-3">
        <span aria-hidden="true" className="size-6 animate-spin rounded-full border-2 border-warm/30 border-t-warm" />
        <p className="text-sm text-text-muted">Loading your quote…</p>
      </div>
    </div>
  )
}
