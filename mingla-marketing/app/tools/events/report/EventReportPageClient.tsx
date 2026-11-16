'use client'
// ISSUE-1004 — fetches the token-verified full event report and renders it ungated.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchEventReport, type EventReport } from '@/lib/growth-tools-submit'
import { EventReportView } from '../EventReportView'
import { ReportLinkInvalid, ReportLoading } from '../../_template/ReportShell'

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; report: EventReport; runId: string }
  | { phase: 'error' }

export function EventReportPageClient() {
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
    fetchEventReport(id, token).then((res) => {
      if (!alive) return
      setState(res.ok ? { phase: 'ready', report: res.report, runId: id } : { phase: 'error' })
    })
    return () => {
      alive = false
    }
  }, [id, token])

  if (state.phase === 'loading') return <ReportLoading what="forecast" />
  if (state.phase === 'error') {
    return <ReportLinkInvalid tool="events" back="Back to the predictor" body="Report links are private and can expire. Run the predictor again to get a fresh report emailed to you." />
  }

  return <EventReportView report={state.report} runId={state.runId} />
}
