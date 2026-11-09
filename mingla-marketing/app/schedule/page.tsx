// #1086 — standalone scheduling page at the top-level /schedule. Any lead funnel
// (grader report, homepage CTA, cold email, ad) points here to book a Mingla
// call. Reads ?venue / ?report_url / ?source (+ optional name/email prefill) on
// the client; the day → time → details → confirm flow is a client state machine.
//
// #4339 phase 3 — redesigned in the approved design (VIEWS.schedule): the site
// nav (Host surface), the dark booking section and the canonical footer, with
// the brand faces route-scoped here (#3548). `?icp=<slug>` from a Host landing
// page preselects "What do you run?".

import { Suspense } from 'react'
import { ScheduleClient } from './ScheduleClient'
import { SitePage } from '@/components/site/site-page'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

export const metadata = publicNoindexMetadata('/schedule', {
  title: 'Book a call with Mingla',
  description: 'Grab 20 minutes with Mingla — pick a day and time that works for you.',
})

export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="host">
        <Suspense fallback={<ScheduleSkeleton />}>
          <ScheduleClient />
        </Suspense>
      </SitePage>
    </div>
  )
}

function ScheduleSkeleton() {
  return (
    <section className="sec dark sched-sec">
      <div className="wrap sched">
        <div>
          <h1 className="sched-title">
            Grab 20 minutes <em>with Mingla.</em>
          </h1>
          <p className="lead">Pick a time. You’ll get a calendar invite with a video link.</p>
        </div>
        <div className="panel">
          <div className="sched-state" role="status">
            <span className="spin" aria-hidden="true" />
            <p className="muted">Loading…</p>
          </div>
        </div>
      </div>
    </section>
  )
}
