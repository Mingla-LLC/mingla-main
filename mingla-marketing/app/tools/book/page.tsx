// ISSUE-1083 — standalone scheduling page. Any lead funnel (grader report,
// homepage CTA, cold email, ad) can point at /tools/book to schedule a Mingla
// call. Reads ?venue / ?report_url / ?source (+ optional name/email prefill) on
// the client; the whole day → time → confirm flow is a client state machine.

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { BookCallClient } from './BookCallClient'

export const metadata: Metadata = {
  title: 'Book a call with Mingla',
  description:
    'Grab 20 minutes with Mingla — pick a day and time. We’ll show you how we drive high-ticket guests to your venue and fix your website for free.',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function BookCallPage() {
  return (
    <Suspense fallback={<BookSkeleton />}>
      <BookCallClient />
    </Suspense>
  )
}

function BookSkeleton() {
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
