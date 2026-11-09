// #4339 Creators and Locals calls (Seth approved, 9 Nov) — the server half of
// /schedule/creators and /schedule/locals: "Your city" is every live Mingla
// city, read at request time (lib/schedule-cities.ts liveCityOptions).
//
// The booking itself is the /schedule flow (app/schedule/ScheduleClient.tsx)
// with its `audience` prop; the page is noindex like /schedule.

import { Suspense } from 'react'
import { connection } from 'next/server'
import { ScheduleClient } from './ScheduleClient'
import { SitePage } from '@/components/site/site-page'
import type { ProgramAudience } from '@/lib/booking-social'
import { liveCityOptions } from '@/lib/schedule-cities'
import { PROGRAM_CALL_COPY } from '@/lib/program-call-copy'

export async function ProgramCallPage({ audience }: { audience: ProgramAudience }) {
  // Request time, never the build: the live list is the database's.
  await connection()
  const cities = await liveCityOptions()
  // The brand faces are applied by each route's page (#3548: a page owns its font emission).
  return (
    <SitePage surface="explorer">
      <Suspense fallback={<ProgramCallSkeleton audience={audience} />}>
        <ScheduleClient audience={audience} cities={cities} copy={PROGRAM_CALL_COPY[audience]} />
      </Suspense>
    </SitePage>
  )
}

function ProgramCallSkeleton({ audience }: { audience: ProgramAudience }) {
  return (
    <section className="sec dark sched-sec">
      <div className="wrap sched">
        <div>
          <h1 className="sched-title">
            Talk to the <em>{audience === 'creator' ? 'Creators team.' : 'Locals team.'}</em>
          </h1>
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
