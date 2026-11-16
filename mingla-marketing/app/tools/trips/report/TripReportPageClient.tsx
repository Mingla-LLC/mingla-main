'use client'
// ISSUE-1005 — fetches the token-verified full trip report and renders it ungated.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchTripReport, type TripReport } from '@/lib/growth-tools-submit'
import { TripReportView } from '../TripReportView'
import { ReportLinkInvalid, ReportLoading } from '../../_template/ReportShell'

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; report: TripReport; runId: string }
  | { phase: 'error' }

export function TripReportPageClient() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const token = params.get('t') ?? ''
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let alive = true
    if (!id || !token) {
      setState({ phase: 'error' })
      return
    }
    fetchTripReport(id, token).then((res) => {
      if (!alive) return
      setState(res.ok ? { phase: 'ready', report: res.report, runId: id } : { phase: 'error' })
    })
    return () => {
      alive = false
    }
  }, [id, token])

  if (state.phase === 'loading') return <ReportLoading what="quote" />
  if (state.phase === 'error') {
    return <ReportLinkInvalid tool="trips" back="Back to the quoter" body="Quote links are private and can expire. Run the quoter again to get a fresh quote emailed to you." />
  }

  return <TripReportView report={state.report} runId={state.runId} />
}
