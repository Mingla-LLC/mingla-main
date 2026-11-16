'use client'
// ISSUE-1003 — fetches the token-verified full report and renders it ungated.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchFullReport, type GraderReport } from '@/lib/growth-tools-submit'
import { ReportView } from '../ReportView'
import { ReportLinkInvalid, ReportLoading } from '../../_template/ReportShell'

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; report: GraderReport; runId: string }
  | { phase: 'error' }

export function ReportPageClient() {
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
    fetchFullReport(id, token).then((res) => {
      if (!alive) return
      setState(res.ok ? { phase: 'ready', report: res.report, runId: id } : { phase: 'error' })
    })
    return () => {
      alive = false
    }
  }, [id, token])

  if (state.phase === 'loading') return <ReportLoading what="report" />
  if (state.phase === 'error') {
    return <ReportLinkInvalid tool="venues" back="Back to the grader" body="Report links are private and can expire. Run the grader again to get a fresh report emailed to you." />
  }

  return <ReportView report={state.report} runId={state.runId} />
}
