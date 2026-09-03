'use client'

import { useMemo, useRef, useState } from 'react'
import {
  HOST_EVENT_PROMOTER_GUIDE,
  LAUNCH_TASK_STATUSES,
  type LaunchTaskStatus,
} from '@/content/page-system/host-event-promoter-guide'

type TaskState = Record<string, LaunchTaskStatus>

const TASKS = HOST_EVENT_PROMOTER_GUIDE.phases.flatMap((phase) =>
  phase.tasks.map((task, taskIndex) => ({
    id: `${phase.id}-${taskIndex}`,
    phaseId: phase.id,
    phaseLabel: phase.label,
    task,
  })),
)

const INITIAL_STATE: TaskState = Object.fromEntries(TASKS.map((task) => [task.id, 'Not started' as const]))

export function LaunchToDoorTimeline() {
  const [state, setState] = useState<TaskState>(INITIAL_STATE)
  const [phaseFilter, setPhaseFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | LaunchTaskStatus>('all')
  const [confirmReset, setConfirmReset] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resetButtonRef = useRef<HTMLButtonElement>(null)

  const summary = useMemo(() => {
    const applicable = TASKS.filter((task) => state[task.id] !== 'Not applicable')
    const ready = applicable.filter((task) => state[task.id] === 'Ready')
    const attention = TASKS.filter((task) => state[task.id] === 'Needs attention')
    const nextPhase = HOST_EVENT_PROMOTER_GUIDE.phases.find((phase) =>
      TASKS.some(
        (task) => task.phaseId === phase.id && state[task.id] !== 'Ready' && state[task.id] !== 'Not applicable',
      ),
    )
    const stateLabel = ready.length === 0
      ? 'Nothing marked ready yet'
      : ready.length === applicable.length
        ? 'All applicable items marked ready'
        : 'Checklist in progress'
    return { applicable, ready, attention, nextPhase, stateLabel }
  }, [state])

  const progress = summary.applicable.length === 0
    ? 0
    : Math.round((summary.ready.length / summary.applicable.length) * 100)

  return (
    <section id="launch-checklist" className="ps-section ps-tool" aria-labelledby="launch-checklist-heading">
      <header className="ps-tool-heading">
        <div>
          <p className="ps-eyebrow">Local launch worksheet</p>
          <h2 ref={headingRef} id="launch-checklist-heading" tabIndex={-1}>Build the launch checklist.</h2>
          <p>Mark operational readiness without entering an event name, guest detail, budget or audience record.</p>
        </div>
        <button type="button" className="ps-button ps-button-secondary" onClick={() => window.print()}>
          Print this checklist
        </button>
      </header>

      <div className="ps-filter-row" data-print-hide>
        <label>
          <span>Show phase</span>
          <select value={phaseFilter} onChange={(event) => setPhaseFilter(event.currentTarget.value)}>
            <option value="all">All phases</option>
            {HOST_EVENT_PROMOTER_GUIDE.phases.map((phase) => (
              <option key={phase.id} value={phase.id}>{phase.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Show state</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as 'all' | LaunchTaskStatus)}
          >
            <option value="all">All states</option>
            {LAUNCH_TASK_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
      </div>

      <div className="ps-tool-layout">
        <div className="ps-timeline">
          {HOST_EVENT_PROMOTER_GUIDE.phases.map((phase) => {
            const phaseTasks = TASKS.filter((task) => task.phaseId === phase.id)
            const phaseFiltered = phaseFilter !== 'all' && phaseFilter !== phase.id
            return (
              <article key={phase.id} className="ps-phase" data-filtered={phaseFiltered ? 'true' : 'false'}>
                <header><span>{phase.label}</span><h3>{phase.title}</h3></header>
                <div className="ps-phase-tasks">
                  {phaseTasks.map((task) => {
                    const statusFiltered = statusFilter !== 'all' && state[task.id] !== statusFilter
                    return (
                      <fieldset key={task.id} className="ps-task" data-filtered={statusFiltered ? 'true' : 'false'}>
                        <legend>{task.task}</legend>
                        <div className="ps-radio-grid ps-radio-grid-compact">
                          {LAUNCH_TASK_STATUSES.map((status) => (
                            <label key={status}>
                              <input
                                type="radio"
                                name={`launch-task-${task.id}`}
                                value={status}
                                checked={state[task.id] === status}
                                onChange={() => setState((current) => ({ ...current, [task.id]: status }))}
                              />
                              <span>{status}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )
                  })}
                </div>
                {phase.guard ? <p className="ps-phase-guard"><strong>Guard:</strong> {phase.guard}</p> : null}
              </article>
            )
          })}
        </div>

        <aside className="ps-result-card" aria-labelledby="launch-result-heading">
          <p className="ps-card-kicker">Worksheet progress</p>
          <h3 id="launch-result-heading">{summary.stateLabel}</h3>
          <p className="ps-progress-value" aria-live="polite" aria-atomic="true">
            {summary.ready.length} of {summary.applicable.length} applicable items ready
          </p>
          <div className="ps-progress-track" aria-hidden="true"><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
          <p><strong>Next unfinished phase:</strong> {summary.nextPhase ? `${summary.nextPhase.label} — ${summary.nextPhase.title}` : 'None'}</p>
          <div className="ps-attention-groups">
            <strong>Needs attention</strong>
            {summary.attention.length === 0 ? <p>None marked.</p> : (
              HOST_EVENT_PROMOTER_GUIDE.phases.map((phase) => {
                const items = summary.attention.filter((task) => task.phaseId === phase.id)
                return items.length > 0 ? (
                  <div key={phase.id}><span>{phase.label}</span><ul>{items.map((item) => <li key={item.id}>{item.task}</li>)}</ul></div>
                ) : null
              })
            )}
          </div>
          <p className="ps-result-caution">
            Checklist completion does not prove legal compliance, reach, attendance, sales or operational readiness.
          </p>
          {!confirmReset ? (
            <button ref={resetButtonRef} type="button" className="ps-text-button" onClick={() => setConfirmReset(true)}>
              Reset checklist
            </button>
          ) : (
            <div className="ps-reset-confirm" role="group" aria-label="Confirm checklist reset">
              <p>Clear every local checklist state?</p>
              <button
                type="button"
                className="ps-button ps-button-primary"
                onClick={() => {
                  setState(INITIAL_STATE)
                  setConfirmReset(false)
                  setPhaseFilter('all')
                  setStatusFilter('all')
                  window.requestAnimationFrame(() => headingRef.current?.focus())
                }}
              >
                Clear states
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
    </section>
  )
}
