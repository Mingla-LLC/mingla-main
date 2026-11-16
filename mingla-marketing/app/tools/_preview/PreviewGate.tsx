'use client'

// #4452 §6.4 — the gated preview the anonymous page shows. It renders ONLY the
// preview allowlist the server sent (the full report is never in the page):
// the headline facts, "Fix #1" and placeholder rows behind the blur, then the
// email step (with the optional, unticked tips box, Q-A1-2). The full report
// opens from the emailed link.
import { useState } from 'react'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { submitGrowthToolsGate, type ToolPreview } from '@/lib/growth-tools-submit'

export type PreviewTool = 'venues' | 'events' | 'trips' | 'experiences'

function get(o: ToolPreview, path: string[]): unknown {
  let v: unknown = o
  for (const k of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
  return v
}
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

export function previewFacts(tool: PreviewTool, p: ToolPreview): { title: string; facts: Array<[string, string]>; unpriced: boolean } {
  if (tool === 'venues') {
    return { title: text(get(p, ['venue', 'name'])), unpriced: false, facts: [
      ['Score', `${text(get(p, ['scores', 'overall']))}`], ['Grade', text(get(p, ['scores', 'grade']))], ['Fixes', text(get(p, ['fix_count']))],
    ] }
  }
  if (tool === 'events') {
    return { title: text(get(p, ['event', 'title'])), unpriced: false, facts: [
      ['Turnout', `${text(get(p, ['forecast', 'low']))}–${text(get(p, ['forecast', 'high']))}`], ['Capacity', text(get(p, ['forecast', 'capacity']))],
    ] }
  }
  if (tool === 'trips') {
    const unpriced = get(p, ['pricing_status']) === 'unpriced'
    return { title: text(get(p, ['trip', 'title'])), unpriced, facts: unpriced
      ? [['Destination', text(get(p, ['trip', 'destination']))]]
      : [['Destination', text(get(p, ['trip', 'destination']))], ['Charge per person', `${text(get(p, ['plan', 'currency']))} ${text(get(p, ['plan', 'recommended_price_per_person']))}`]] }
  }
  return { title: text(get(p, ['experience', 'description'])).slice(0, 80), unpriced: false, facts: [
    ['Now', `${text(get(p, ['currency']))} ${text(get(p, ['current_price']))}`], ['Fair price', `${text(get(p, ['currency']))} ${text(get(p, ['recommended_price']))}`],
  ] }
}

export function PreviewGate({ tool, preview, runId, onReset, resetLabel }: { tool: PreviewTool; preview: ToolPreview; runId: string; onReset: () => void; resetLabel: string }) {
  const [email, setEmail] = useState('')
  const [tips, setTips] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const { title, facts, unpriced } = previewFacts(tool, preview)
  const fix = text(get(preview, ['first_fix', 'title']))
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-text-primary">
      <button type="button" onClick={onReset} className="mb-6 inline-flex min-h-10 items-center rounded-full border border-white/12 bg-white/8 px-4 text-sm font-semibold">
        {resetLabel}
      </button>
      <h2 className="text-3xl font-semibold">{title}</h2>
      {unpriced ? (
        <p className="mt-3">We couldn&rsquo;t price this trip yet. Live prices didn&rsquo;t come back; prices will follow when we can check them.</p>
      ) : null}
      <dl className="mt-6 grid grid-cols-2 gap-4">
        {facts.filter(([, v]) => v.trim() !== '').map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-white/12 p-4">
            <dt className="text-xs uppercase tracking-widest opacity-70">{k}</dt>
            <dd className="mt-1 text-xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {fix ? <p className="mt-6 font-semibold">Fix #1: {fix}</p> : null}
      <div className="mt-3 space-y-2 blur-sm select-none" aria-hidden="true">
        <div className="h-4 rounded bg-white/15" /><div className="h-4 w-5/6 rounded bg-white/15" /><div className="h-4 w-2/3 rounded bg-white/15" />
      </div>
      {state === 'sent' ? (
        <p className="mt-6" role="status">Sent. Your full report is in your inbox.</p>
      ) : (
        <form className="mt-6 space-y-3" onSubmit={async (e) => {
          e.preventDefault()
          setState('sending')
          captureMarketing('tool_gate_email_submitted', { tool, run_id: runId })
          const r = await submitGrowthToolsGate(runId, email.trim(), undefined, tips)
          setState(r.ok ? 'sent' : 'error')
        }}>
          <label className="block text-sm font-semibold" htmlFor="pg-email">Email me the full report</label>
          <input id="pg-email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="min-h-14 w-full rounded-2xl border border-white/20 bg-white px-4 text-base text-black" />
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={tips} onChange={(e) => setTips(e.target.checked)} /> Also send me tips for hosts. Optional.
          </label>
          <button type="submit" disabled={state === 'sending'} className="min-h-12 rounded-full bg-white px-6 font-semibold text-black">
            {state === 'sending' ? 'Sending…' : 'Send my report'}
          </button>
          {state === 'error' ? <p role="alert">We couldn&rsquo;t send it. Try again.</p> : null}
        </form>
      )}
    </div>
  )
}
