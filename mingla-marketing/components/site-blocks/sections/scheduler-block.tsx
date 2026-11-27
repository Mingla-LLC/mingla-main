// #4636 live block `scheduler` — the dark booking section (#1086, #4339
// phase 3): day → time → details → confirm, a client state machine reading
// ?venue / ?report_url / ?source / ?icp. Moved as-is (R1) from
// app/schedule/page.tsx, with its loading skeleton.
import { Suspense } from 'react'
import { LazyScheduleClient as ScheduleClient } from '../lazy-islands'  // #4636: own chunk (first-load budget)

export type SchedulerContent = Record<string, never>

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

// #4641: /schedule books the "host-demo" scheduler explicitly.
export function SchedulerBlock() {
  return (
    <Suspense fallback={<ScheduleSkeleton />}>
      <ScheduleClient schedulerKey="host-demo" />
    </Suspense>
  )
}
