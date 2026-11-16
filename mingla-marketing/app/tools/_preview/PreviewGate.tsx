'use client'

// #4452 §6.4 — the gated preview the anonymous page shows. It renders ONLY the
// preview allowlist the server sent (the full report is never in the page):
// the headline, "Fix #1" and placeholder rows behind the blur, then the email
// step (with the optional, unticked tips box, Q-A1-2). The full report opens
// from the emailed link. #4452 §6.1: drawn as the left card of the paper tool
// page (design renderTools, result stage).
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
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function money(n: number | null, currency: string): string {
  if (n === null) return ''
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${currency} ${Math.round(n)}`
  }
}

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
      : [['Destination', text(get(p, ['trip', 'destination']))], ['Charge per person', money(num(get(p, ['plan', 'recommended_price_per_person'])), text(get(p, ['plan', 'currency'])))]] }
  }
  return { title: text(get(p, ['experience', 'description'])).slice(0, 80), unpriced: false, facts: [
    ['Now', money(num(get(p, ['current_price'])), text(get(p, ['currency'])))], ['Fair price', money(num(get(p, ['recommended_price'])), text(get(p, ['currency'])))],
  ] }
}

/** The preview's serif headline: the headline number and what it is (never "$0" for an unpriced trip). */
export function previewHeadline(tool: PreviewTool, p: ToolPreview): [string, string] | null {
  if (tool === 'venues') {
    const s = num(get(p, ['scores', 'overall']))
    return s === null ? null : [String(Math.round(s)), 'out of 100']
  }
  if (tool === 'events') {
    const lo = num(get(p, ['forecast', 'low']))
    const hi = num(get(p, ['forecast', 'high']))
    return lo === null || hi === null ? null : [`${lo}–${hi}`, 'people, likely']
  }
  if (tool === 'trips') {
    if (get(p, ['pricing_status']) === 'unpriced') return null
    const v = num(get(p, ['plan', 'recommended_price_per_person']))
    return v === null || v <= 0 ? null : [money(v, text(get(p, ['plan', 'currency']))), 'per person']
  }
  const rec = num(get(p, ['recommended_price']))
  return rec === null || rec <= 0 ? null : [money(rec, text(get(p, ['currency']))), 'a seat, your fair price']
}

export function PreviewGate({ tool, preview, runId, onReset, resetLabel }: { tool: PreviewTool; preview: ToolPreview; runId: string; onReset: () => void; resetLabel: string }) {
  const [email, setEmail] = useState('')
  const [tips, setTips] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const { title, facts, unpriced } = previewFacts(tool, preview)
  const headline = previewHeadline(tool, preview)
  const fix = text(get(preview, ['first_fix', 'title']))
  return (
    <div className="tp-card" data-preview-gate={tool}>
      <button type="button" onClick={onReset} className="tp-link">{resetLabel}</button>
      <span className="tp-mono">Your preview{title ? ` · ${title}` : ''}</span>
      {unpriced ? (
        <>
          <h2>We couldn&rsquo;t price this trip <em>yet.</em></h2>
          <p className="fk-help">Live prices didn&rsquo;t come back; prices will follow when we can check them.</p>
        </>
      ) : headline ? (
        <h2>{headline[0]} <em>{headline[1]}</em></h2>
      ) : null}
      <dl className="tp-facts">
        {facts.filter(([, v]) => v.trim() !== '' && v.trim() !== '–').map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {fix ? <p style={{ fontSize: 14, color: '#3f3d39' }}>Fix #1: <b>{fix}</b></p> : null}
      {/* Placeholder rows only: no real value sits behind the blur. */}
      <div className="tp-blur" aria-hidden="true">
        <div><i style={{ width: '46%' }} /><i style={{ width: '22%' }} /></div>
        <div><i style={{ width: '38%' }} /><i style={{ width: '26%' }} /></div>
      </div>
      {state === 'sent' ? (
        <p role="status" style={{ fontSize: 15 }}><b>Sent.</b> Your full report is in your inbox. The link works for 30 days.</p>
      ) : (
        <form style={{ display: 'grid', gap: 14 }} onSubmit={async (e) => {
          e.preventDefault()
          setState('sending')
          captureMarketing('tool_gate_email_submitted', { tool, run_id: runId })
          const r = await submitGrowthToolsGate(runId, email.trim(), undefined, tips)
          setState(r.ok ? 'sent' : 'error')
        }}>
          <div className="fk-field">
            <label className="fk-label" htmlFor="pg-email">{fix ? 'Where should we send the rest of your fixes?' : 'Where should we send your full report?'}</label>
            <input id="pg-email" className="fk-input" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="button" role="checkbox" aria-checked={tips} className={`fk-consent${tips ? ' on' : ''}`} onClick={() => setTips((v) => !v)}>
            <span className="fk-tick" aria-hidden="true">{tips ? '✓' : ''}</span>
            <span>Also send me tips for hosts. Optional.</span>
          </button>
          <button type="submit" className="tp-go" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Send my full report'}
          </button>
          {state === 'error' ? <p role="alert" className="fk-error">We couldn&rsquo;t send it. Check the email and try again.</p> : null}
          <p className="tp-tiny">The full report opens from the link in your email.</p>
        </form>
      )}
    </div>
  )
}
