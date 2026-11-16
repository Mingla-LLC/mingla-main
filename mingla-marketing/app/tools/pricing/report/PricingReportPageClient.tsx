'use client'
// ISSUE-1006 — fetches the token-verified full pricing audit and renders it ungated.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchPricingReport, type PricingReport } from '@/lib/growth-tools-submit'
import { PricingReportView } from '../PricingReportView'
import { ReportLinkInvalid, ReportLoading } from '../../_template/ReportShell'

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; report: PricingReport; runId: string }
  | { phase: 'error' }

export function PricingReportPageClient() {
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
    fetchPricingReport(id, token).then((res) => {
      if (!alive) return
      setState(res.ok ? { phase: 'ready', report: res.report, runId: id } : { phase: 'error' })
    })
    return () => {
      alive = false
    }
  }, [id, token])

  if (state.phase === 'loading') return <ReportLoading what="audit" />
  if (state.phase === 'error') {
    return <ReportLinkInvalid tool="experiences" back="Back to the audit" body="Audit links are private and can expire. Run the audit again to get a fresh one emailed to you." />
  }

  return <PricingReportView report={state.report} runId={state.runId} />
}
