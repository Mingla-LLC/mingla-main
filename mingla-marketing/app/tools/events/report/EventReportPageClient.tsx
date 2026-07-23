'use client'
// ISSUE-1004 — fetches the token-verified full event report and renders it ungated.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchEventReport, type EventReport } from '@/lib/growth-tools-submit'
import { EventReportView } from '../EventReportView'

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

  if (state.phase === 'loading') {
    return (
      <div className="grid place-items-center py-24 text-center">
        <div className="flex flex-col items-center gap-3">
          <span aria-hidden="true" className="size-6 animate-spin rounded-full border-2 border-warm/30 border-t-warm" />
          <p className="text-sm text-text-muted">Loading your forecast…</p>
        </div>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-md border border-divider-strong bg-parchment p-8 text-center" data-theme="light">
        <p className="font-display text-2xl text-text-primary">This link isn&rsquo;t valid</p>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Report links are private and can expire. Run the predictor again to get a fresh
          forecast emailed to you.
        </p>
        <a
          href="/tools/events"
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-warm px-6 text-sm font-semibold text-white"
        >
          Back to the predictor
        </a>
      </div>
    )
  }

  return <EventReportView report={state.report} runId={state.runId} initialGated={false} />
}
