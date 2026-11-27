// #1086 — standalone scheduling page at the top-level /schedule. Any lead funnel
// (grader report, homepage CTA, cold email, ad) points here to book a Mingla
// call. Reads ?venue / ?report_url / ?source (+ optional name/email prefill) on
// the client; the day → time → details → confirm flow is a client state machine.
//
// #4339 phase 3 — redesigned in the approved design (VIEWS.schedule): the site
// nav (Host surface), the dark booking section and the canonical footer, with
// the brand faces route-scoped here (#3548). `?icp=<slug>` from a Host landing
// page preselects "What do you run?".
// #4636: the booking section is the registry block `scheduler`.

import { SitePage } from '@/components/site/site-page'
import { Spot } from '@/components/site-blocks/spot'
import { SchedulerBlock } from '@/components/site-blocks/sections/scheduler-block'
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
        <SchedulerBlock />
        <Spot page="schedule" id="before-footer" />
      </SitePage>
    </div>
  )
}
