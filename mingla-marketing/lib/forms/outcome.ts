// #4452 §3.2 — the client failure states and their exact copy (pure; unit tested).

export type SubmitOutcome =
  | { ok: true; submissionId: string; leadEventId: string | null; deduped: boolean; goal: string; handoffToken: string | null; schedulerKey: string | null }
  | { ok: false; kind: 'network' | 'validation' | 'form_changed' | 'form_closed' | 'rate_limited' | 'paused' | 'server'; fields?: Array<{ key: string; code: string; message: string; suggestion?: string }> }

/** The exact failure copy (§3.2 client failure states). Answers are always kept. */
export const FAILURE_COPY: Record<Exclude<SubmitOutcome, { ok: true }>['kind'], string> = {
  network: 'No connection. Your answers are saved. Try again',
  validation: 'Some answers need a fix below.',
  form_changed: 'This form was just updated. Check your answers and send again.',
  form_closed: 'This form is closed.',
  rate_limited: 'Too many tries from this connection. Try again in a few minutes.',
  paused: 'Forms are paused for a few minutes. Your answers are saved on this device.',
  server: "We couldn't send this. Your answers are saved here. Try again",
}

export function outcomeFor(status: number, body: Record<string, unknown> | null): SubmitOutcome {
  if (status === 200 && body?.ok === true && typeof body.submission_id === 'string') {
    return {
      ok: true,
      submissionId: body.submission_id,
      leadEventId: typeof body.lead_event_id === 'string' ? body.lead_event_id : null,
      deduped: body.deduped === true,
      goal: typeof body.goal === 'string' ? body.goal : 'none',
      handoffToken: typeof body.handoff_token === 'string' ? body.handoff_token : null,
      schedulerKey: typeof body.scheduler_key === 'string' ? body.scheduler_key : null,
    }
  }
  const error = String(body?.error ?? '')
  if (status === 400) return { ok: false, kind: 'validation', fields: Array.isArray(body?.fields) ? body?.fields as never : [] }
  if (status === 409) return { ok: false, kind: 'form_changed' }
  if (status === 410) return { ok: false, kind: 'form_closed' }
  if (status === 429) return { ok: false, kind: 'rate_limited' }
  if (status === 503 || error === 'paused') return { ok: false, kind: 'paused' }
  return { ok: false, kind: 'server' }
}
