'use client'

import { useMemo, useRef, useState } from 'react'
import {
  EXPLORER_EVENT_GUIDE,
  PLAN_FIT_STATUSES,
  type PlanFitStatus,
} from '@/content/page-system/explorer-event-guide'

type PlanState = Record<string, { status: PlanFitStatus; essential: boolean }>

const INITIAL_STATE: PlanState = Object.fromEntries(
  EXPLORER_EVENT_GUIDE.checks.map((check) => [
    check.id,
    { status: 'Not checked' as const, essential: false },
  ]),
)

function resultFor(state: PlanState): { label: string; reason: string } {
  const values = EXPLORER_EVENT_GUIDE.checks.map((check) => state[check.id])
  const failures = values.filter((value) => value.status === 'Does not work').length
  const essentialUnknowns = values.filter(
    (value) => value.essential && (value.status === 'Needs confirmation' || value.status === 'Not checked'),
  ).length
  const confirmations = values.filter((value) => value.status === 'Needs confirmation').length
  const works = values.filter((value) => value.status === 'Works for this plan').length

  if (failures > 0) {
    return { label: 'Poor fit', reason: `${failures} ${failures === 1 ? 'check does' : 'checks do'} not work for this plan.` }
  }
  if (essentialUnknowns > 0) {
    return { label: 'Not enough evidence', reason: `${essentialUnknowns} essential ${essentialUnknowns === 1 ? 'fact needs' : 'facts need'} confirmation.` }
  }
  if (confirmations > 0) {
    return { label: 'Possible fit', reason: `${confirmations} non-essential ${confirmations === 1 ? 'detail still needs' : 'details still need'} confirmation.` }
  }
  if (works === EXPLORER_EVENT_GUIDE.checks.length) {
    return { label: 'Strong fit', reason: 'All eight checks work for this plan.' }
  }
  return { label: 'Not enough evidence', reason: 'Complete the unchecked rows before you commit.' }
}

export function PlanFitCheck() {
  const [state, setState] = useState<PlanState>(INITIAL_STATE)
  const [confirmReset, setConfirmReset] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resetButtonRef = useRef<HTMLButtonElement>(null)
  const result = useMemo(() => resultFor(state), [state])
  const counts = PLAN_FIT_STATUSES.map((status) => ({
    status,
    count: EXPLORER_EVENT_GUIDE.checks.filter((check) => state[check.id].status === status).length,
  }))

  function setStatus(checkId: string, status: PlanFitStatus) {
    setState((current) => ({ ...current, [checkId]: { ...current[checkId], status } }))
  }

  function setEssential(checkId: string, essential: boolean) {
    setState((current) => ({ ...current, [checkId]: { ...current[checkId], essential } }))
  }

  return (
    <section id="plan-fit-check" className="ps-section ps-tool" aria-labelledby="plan-fit-heading">
      <header className="ps-tool-heading">
        <div>
          <p className="ps-eyebrow">Local worksheet</p>
          <h2 ref={headingRef} id="plan-fit-heading" tabIndex={-1}>Run the Plan Fit Check.</h2>
          <p>Mark each check for this plan. Your selections stay in this browser and are not uploaded.</p>
        </div>
        <button type="button" className="ps-button ps-button-secondary" onClick={() => window.print()}>
          Print this guide
        </button>
      </header>

      <div className="ps-tool-layout">
        <div className="ps-check-list">
          {EXPLORER_EVENT_GUIDE.checks.map((check, index) => (
            <fieldset key={check.id} className="ps-check-row">
              <legend><span>{index + 1}</span>{check.label}</legend>
              <p className="ps-check-question">{check.question}</p>
              <div className="ps-radio-grid">
                {PLAN_FIT_STATUSES.map((status) => (
                  <label key={status}>
                    <input
                      type="radio"
                      name={`plan-fit-${check.id}`}
                      value={status}
                      checked={state[check.id].status === status}
                      onChange={() => setStatus(check.id, status)}
                    />
                    <span>{status}</span>
                  </label>
                ))}
              </div>
              <label className="ps-essential">
                <input
                  type="checkbox"
                  checked={state[check.id].essential}
                  onChange={(event) => setEssential(check.id, event.currentTarget.checked)}
                />
                <span>Essential for this plan</span>
              </label>
              <details className="ps-row-help">
                <summary>What makes this ready?</summary>
                <p><strong>Ready:</strong> {check.ready}</p>
                <p><strong>Keep checking:</strong> {check.caution}</p>
                <p><strong>Source reminder:</strong> {check.sourceReminder}</p>
                <p><strong>Next action:</strong> {check.nextAction}</p>
              </details>
            </fieldset>
          ))}
        </div>

        <aside className="ps-result-card" aria-labelledby="plan-fit-result-heading">
          <p className="ps-card-kicker">Your current conclusion</p>
          <h3 id="plan-fit-result-heading">{result.label}</h3>
          <p aria-live="polite" aria-atomic="true">{result.reason}</p>
          <div className="ps-segmented-graphic" aria-hidden="true">
            {counts.map(({ status, count }) => (
              <span key={status} data-status={status} style={{ flexGrow: Math.max(count, 0.22) }} />
            ))}
          </div>
          <ul className="ps-result-counts" aria-label="Plan Fit Check counts">
            {counts.map(({ status, count }) => <li key={status}><span>{status}</span><strong>{count}</strong></li>)}
          </ul>
          <p className="ps-result-caution">This is a decision aid, not a recommendation score.</p>
          {!confirmReset ? (
            <button
              ref={resetButtonRef}
              type="button"
              className="ps-text-button"
              onClick={() => setConfirmReset(true)}
            >
              Reset worksheet
            </button>
          ) : (
            <div className="ps-reset-confirm" role="group" aria-label="Confirm worksheet reset">
              <p>Clear every local selection?</p>
              <button
                type="button"
                className="ps-button ps-button-primary"
                onClick={() => {
                  setState(INITIAL_STATE)
                  setConfirmReset(false)
                  window.requestAnimationFrame(() => headingRef.current?.focus())
                }}
              >
                Clear selections
              </button>
              <button
                type="button"
                className="ps-button ps-button-secondary"
                onClick={() => {
                  setConfirmReset(false)
                  window.requestAnimationFrame(() => resetButtonRef.current?.focus())
                }}
              >
                Keep them
              </button>
            </div>
          )}
        </aside>
      </div>

      <div className="ps-print-comparison" aria-labelledby="blank-comparison-heading">
        <h3 id="blank-comparison-heading">Blank three-option comparison</h3>
        <p>Use this printable table for real options. A blank cell means the fact still needs checking.</p>
        <div className="ps-table-scroll">
          <table>
            <caption>Three-option Plan Fit Check worksheet</caption>
            <thead><tr><th scope="col">Check</th><th scope="col">Option 1</th><th scope="col">Option 2</th><th scope="col">Option 3</th></tr></thead>
            <tbody>
              {EXPLORER_EVENT_GUIDE.checks.map((check) => (
                <tr key={check.id}><th scope="row">{check.label}</th><td /><td /><td /></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
