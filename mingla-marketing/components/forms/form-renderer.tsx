'use client'

// #4452 §2.5 / §2.7 / §2.8 — the premium field kit and the form renderer.
//
// - Field components own their state; the form keeps answers in a ref, so typing
//   in one field re-renders only that field. Only a choice that drives a
//   show_if bumps the form (adaptive questions mount and unmount in place).
// - Errors show after blur or Send, never while typing, and clear as soon as
//   the value is valid (R-24). The rules are the shared contract's.
// - Success shows only after the server confirms (200).
// - Save and resume: answers are kept on this device for 7 days, consent never.

import { CalendarInput } from '@mingla/calendar-web'
import '@mingla/calendar-web/calendar.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type FormDefinition,
  type FormField,
  type AfterSubmit,
  emailTypoFix,
  errorMessage,
  isVisible,
  validateAnswers,
} from '@/lib/forms/contract'
import { countryByIso, fmtPhone, matchCountries } from '@/lib/forms/countries'
import {
  clearDraft,
  FAILURE_COPY,
  postForm,
  readDraft,
  sessionUtm,
  submitBody,
  trackFunnel,
  writeDraft,
  type SubmitOutcome,
} from '@/lib/forms/submit'
import { formEvent } from './form-events'
import { designOf } from '@/lib/forms/design'
import { type BookingBasics, bookingFromAnswers } from '@/lib/forms/booking'
import type { FormContext } from '@/lib/forms/events'
import { fireMarketingLead } from '@/lib/marketing-pixels'
import { postGrowthTools } from '@/lib/growth-tools-transport'
import { visitorRegion } from '@/lib/visitor-region'
import './forms.css'

export interface RendererForm {
  id: string
  key: string
  version: number
  audience: 'host' | 'creator' | 'local'
  fields: FormField[]
  design?: Record<string, unknown>
  slug?: string | null
  preview?: boolean
  after_submit?: AfterSubmit
}

type Answers = Record<string, unknown>

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fieldError(def: FormDefinition, answers: Answers, key: string): { code: string; message: string; fix?: string } | null {
  const res = validateAnswers(def, answers, localToday())
  const e = res.errors.find((x) => x.key === key)
  if (!e) return null
  const type = def.fields.find((f) => f.key === key)?.type ?? null
  const raw = answers[key]
  const fix = e.code === 'typo' && typeof raw === 'string' ? emailTypoFix(raw) ?? undefined : undefined
  return { code: e.code, message: errorMessage(type, e.code, fix ? fix.slice(fix.lastIndexOf('@') + 1) : undefined), fix }
}

interface FieldProps {
  field: FormField
  def: FormDefinition
  answers: React.MutableRefObject<Answers>
  showErrors: boolean
  onValue: (key: string, value: unknown, structural: boolean) => void
  phoneCountryHint: string | null
}

function FieldShell({ field, error, children, id }: { field: FormField; error: string | null; children: React.ReactNode; id: string }) {
  return (
    <div className={`fk-field${error ? ' fk-bad' : ''}`} data-field={field.key}>
      {field.type !== 'consent' ? (
        <label className="fk-label" htmlFor={id} id={`${id}-label`}>
          {field.label}
          {field.required ? null : <span className="fk-opt"> (optional)</span>}
        </label>
      ) : null}
      {children}
      {field.help ? <p className="fk-help" id={`${id}-help`}>{field.help}</p> : null}
      {error ? (
        <p className="fk-error" role="alert" id={`${id}-error`}>
          <span aria-hidden="true">!</span> {error}
        </p>
      ) : null}
    </div>
  )
}

function useFieldError(props: FieldProps) {
  const [touched, setTouched] = useState(false)
  const [, bump] = useState(0)
  const show = touched || props.showErrors
  const err = show ? fieldError(props.def, props.answers.current, props.field.key) : null
  return { err, touch: () => setTouched(true), refresh: () => bump((n) => n + 1) }
}

function TextField(props: FieldProps & { kind: 'name' | 'email' | 'short' | 'long' }) {
  const { field } = props
  const id = `fk-${field.key}`
  const [value, setValue] = useState(() => String(props.answers.current[field.key] ?? ''))
  const { err, touch, refresh } = useFieldError(props)
  const limit = props.kind === 'long' ? 2000 : props.kind === 'short' ? 120 : props.kind === 'name' ? 80 : 254
  const set = (v: string) => {
    const next = v.slice(0, limit)
    setValue(next)
    props.onValue(field.key, next, false)
    refresh()
  }
  const common = {
    id,
    value,
    'aria-invalid': err ? true : undefined,
    'aria-describedby': [field.help ? `${id}-help` : '', err ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined,
    onBlur: touch,
    placeholder: field.placeholder,
  }
  return (
    <FieldShell field={field} error={err?.message ?? null} id={id}>
      {props.kind === 'long' ? (
        <>
          <textarea className="fk-input fk-area" rows={4} maxLength={limit} onChange={(e) => set(e.target.value)} {...common} />
          <p className="fk-count" aria-live="polite">{value.length}/{limit}</p>
        </>
      ) : (
        <input
          className="fk-input"
          type={props.kind === 'email' ? 'email' : 'text'}
          inputMode={props.kind === 'email' ? 'email' : undefined}
          autoComplete={props.kind === 'email' ? 'email' : props.kind === 'name' ? 'name' : undefined}
          maxLength={limit}
          onChange={(e) => set(e.target.value)}
          {...common}
        />
      )}
      {err?.fix ? (
        <p className="fk-fix">
          Did you mean <strong>{err.fix}</strong>?{' '}
          <button type="button" className="fk-link" onClick={() => set(err.fix as string)}>Fix it</button>
        </p>
      ) : null}
    </FieldShell>
  )
}

function PhoneField(props: FieldProps) {
  const { field } = props
  const id = `fk-${field.key}`
  const initial = props.answers.current[field.key] as { country?: string; number?: string } | undefined
  const [iso, setIso] = useState(initial?.country ?? 'NG')
  const [manual, setManual] = useState(false)
  const [number, setNumber] = useState(initial?.number ?? '')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const { err, touch, refresh } = useFieldError(props)
  const country = countryByIso(iso) ?? countryByIso('NG')!
  const push = (nextIso: string, nextNumber: string) => {
    const c = countryByIso(nextIso)
    props.onValue(field.key, nextNumber.trim() ? { country: nextIso, dial: c?.dial ?? '+1', number: nextNumber } : null, false)
    refresh()
  }
  useEffect(() => {
    // §2.7: a picked city sets the phone country unless the person chose one by hand.
    if (!manual && props.phoneCountryHint && countryByIso(props.phoneCountryHint) && props.phoneCountryHint !== iso) {
      setIso(props.phoneCountryHint)
      push(props.phoneCountryHint, number)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.phoneCountryHint])
  const list = matchCountries(q)
  return (
    <FieldShell field={field} error={err?.message ?? null} id={id}>
      <div className="fk-phone">
        <button type="button" className="fk-country" aria-expanded={open} aria-label={`Country code ${country.name} ${country.dial}`} onClick={() => setOpen((o) => !o)}>
          <span aria-hidden="true">{country.flag}</span> {country.dial}
        </button>
        <input
          id={id}
          className="fk-input"
          type="tel"
          autoComplete="tel-national"
          inputMode="tel"
          value={number}
          aria-invalid={err ? true : undefined}
          onBlur={touch}
          onChange={(e) => {
            const v = /^\s*\+/.test(e.target.value) ? e.target.value : fmtPhone(e.target.value)
            setNumber(v)
            push(iso, v)
          }}
        />
      </div>
      {open ? (
        <div className="fk-inline-list">
          <input
            className="fk-input"
            autoFocus
            placeholder="Type a country or code"
            aria-label="Type a country or code"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
              if (e.key === 'Enter' && list[0]) { e.preventDefault(); setIso(list[0].iso); setManual(true); setOpen(false); push(list[0].iso, number) }
            }}
          />
          <ul role="listbox" aria-label="Countries">
            {list.slice(0, 60).map((c) => (
              <li key={c.iso} role="option" aria-selected={c.iso === iso}>
                <button type="button" onClick={() => { setIso(c.iso); setManual(true); setOpen(false); push(c.iso, number) }}>
                  <span aria-hidden="true">{c.flag}</span> {c.name} <span className="fk-dim">{c.dial}</span>
                </button>
              </li>
            ))}
          </ul>
          {q && list.length === 0 ? <p className="fk-help">No country matches &lsquo;{q}&rsquo;. The full list has every country.</p> : null}
        </div>
      ) : null}
    </FieldShell>
  )
}

function ChoiceField(props: FieldProps & { multi: boolean }) {
  const { field } = props
  const id = `fk-${field.key}`
  const [value, setValue] = useState<string[]>(() => {
    const v = props.answers.current[field.key]
    return Array.isArray(v) ? v as string[] : typeof v === 'string' ? [v] : []
  })
  const { err, touch, refresh } = useFieldError(props)
  const toggle = (o: string) => {
    const next = props.multi ? (value.includes(o) ? value.filter((x) => x !== o) : [...value, o]) : [o]
    setValue(next)
    props.onValue(field.key, props.multi ? next : next[0] ?? null, true)
    touch()
    refresh()
  }
  const opts = field.options ?? []
  return (
    <FieldShell field={field} error={err?.message ?? null} id={id}>
      <div className={props.multi ? 'fk-chips' : 'fk-cards'} role={props.multi ? 'group' : 'radiogroup'} aria-labelledby={`${id}-label`}>
        {opts.map((o, i) => {
          const on = value.includes(o)
          return (
            <button
              key={o}
              id={i === 0 ? id : undefined}
              type="button"
              role={props.multi ? undefined : 'radio'}
              aria-checked={props.multi ? undefined : on}
              aria-pressed={props.multi ? on : undefined}
              className={on ? 'on' : undefined}
              onClick={() => toggle(o)}
              onKeyDown={(e) => {
                if (props.multi) return
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); toggle(opts[(i + 1) % opts.length]) }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); toggle(opts[(i - 1 + opts.length) % opts.length]) }
              }}
            >
              {props.multi && on ? '✓ ' : ''}{o}
            </button>
          )
        })}
      </div>
    </FieldShell>
  )
}

function CityField(props: FieldProps & { onCountry: (iso: string | null) => void }) {
  const { field } = props
  const id = `fk-${field.key}`
  const [q, setQ] = useState(() => String((props.answers.current[field.key] as { label?: string } | undefined)?.label ?? ''))
  const [results, setResults] = useState<Array<{ label: string; city?: string; region?: string; country?: string }>>([])
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const seq = useRef(0)
  const { err, touch, refresh } = useFieldError(props)
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      // #4452 follow-up (B15): the visitor's region ranks their own country's cities first.
      const region = visitorRegion()
      const r = await postGrowthTools('growth-tools-geocode', region ? { q: q.trim(), region } : { q: q.trim() }).catch(() => null)
      if (mine !== seq.current) return  // only the latest query is shown
      const cities = r && r.ok ? (r.body as { cities?: typeof results } | null)?.cities : null
      if (cities) { setBusy(false); setResults(cities.slice(0, 5)) }
      else { setBusy(true); setResults([]) }
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  const pick = (c: { label: string; city?: string; region?: string; country?: string; free?: boolean }) => {
    setQ(c.label)
    setResults([])
    props.onValue(field.key, c, false)
    props.onCountry(c.country && /^[A-Z]{2}$/.test(c.country) ? c.country : null)
    touch()
    refresh()
  }
  return (
    <FieldShell field={field} error={err?.message ?? null} id={id}>
      <input
        id={id}
        className="fk-input"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-autocomplete="list"
        value={q}
        onBlur={touch}
        onChange={(e) => { setQ(e.target.value); props.onValue(field.key, e.target.value.trim().length >= 2 ? { label: e.target.value, free: true } : null, false); refresh() }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]) }
          if (e.key === 'Escape' && results.length) { e.stopPropagation(); setResults([]) }
        }}
      />
      {results.length ? (
        <div className="fk-inline-list">
          <ul role="listbox">
            {results.map((c, i) => (
              <li key={`${c.label}-${i}`} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>{c.label}</button>
              </li>
            ))}
          </ul>
          <p className="fk-powered">Powered by Google</p>
        </div>
      ) : q.trim().length >= 2 && !busy ? null : null}
      {busy ? <p className="fk-help">City search is busy. Type your city and we&rsquo;ll use it.</p> : null}
    </FieldShell>
  )
}

function SocialField(props: FieldProps) {
  const { field } = props
  const id = `fk-${field.key}`
  const [platform, setPlatform] = useState<'instagram' | 'tiktok' | 'youtube' | 'website'>('instagram')
  const [value, setValue] = useState('')
  const { err, touch, refresh } = useFieldError(props)
  const push = (p: typeof platform, v: string) => { props.onValue(field.key, v.trim() ? { platform: p, value: v } : null, false); refresh() }
  const valid = !fieldError(props.def, { ...props.answers.current }, field.key) && value.trim() !== ''
  const preview = valid ? (validateAnswers({ ...props.def, fields: [field] }, { [field.key]: { platform, value } }, localToday()).values[field.key] as { url?: string } | undefined)?.url : null
  return (
    <FieldShell field={field} error={err?.message ?? null} id={id}>
      <div className="fk-seg" role="radiogroup" aria-label="Platform">
        {(['instagram', 'tiktok', 'youtube', 'website'] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={platform === p} className={platform === p ? 'on' : undefined}
            onClick={() => { setPlatform(p); push(p, value) }}>
            {p === 'instagram' ? 'Instagram' : p === 'tiktok' ? 'TikTok' : p === 'youtube' ? 'YouTube' : 'Website'}
          </button>
        ))}
      </div>
      <div className="fk-prefixed">
        <span aria-hidden="true">{platform === 'website' ? 'https://' : '@'}</span>
        <input id={id} className="fk-input" value={value} onBlur={touch} onChange={(e) => { setValue(e.target.value); push(platform, e.target.value) }} />
      </div>
      {preview ? <p className="fk-help">{preview} · The team opens this before your call.</p> : null}
    </FieldShell>
  )
}

function DateField(props: FieldProps) {
  const { field } = props
  const id = `fk-${field.key}`
  const [mode, setMode] = useState<'weekend' | 'next' | 'pick' | null>(null)
  const { err, touch, refresh } = useFieldError(props)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const choose = (m: 'weekend' | 'next' | 'pick') => {
    setMode(m)
    const now = new Date()
    if (m === 'weekend') {
      const sat = new Date(now); sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7))
      const sun = new Date(sat); sun.setDate(sat.getDate() + 1)
      props.onValue(field.key, { from: iso(sat < now ? now : sat), to: iso(sun) }, false)
    } else if (m === 'next') {
      const mon = new Date(now); mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7))
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
      props.onValue(field.key, { from: iso(mon), to: iso(sun) }, false)
    }
    touch()
    refresh()
  }
  return (
    <FieldShell field={field} error={err?.message ?? null} id={id}>
      <div className="fk-chips">
        {([['weekend', 'This weekend'], ['next', 'Next week'], ['pick', 'Pick dates']] as const).map(([m, label]) => (
          <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'on' : undefined} onClick={() => choose(m)}>{label}</button>
        ))}
      </div>
      {mode === 'pick' ? (
        <CalendarInput id={id} className="fk-input" mode="date" min={localToday()} onBlur={touch} aria-label={field.label} clearable
          onChange={(e) => { props.onValue(field.key, e.target.value ? { from: e.target.value } : null, false); refresh() }} />
      ) : null}
    </FieldShell>
  )
}

function ConsentField(props: FieldProps) {
  const { field } = props
  const [on, setOn] = useState(false)  // never pre-ticked, never restored
  return (
    <div className="fk-field" data-field={field.key}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`fk-consent${on ? ' on' : ''}`}
        onClick={() => { setOn(!on); props.onValue(field.key, !on, false) }}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setOn(!on); props.onValue(field.key, !on, false) } }}
      >
        <span className="fk-tick" aria-hidden="true">{on ? '✓' : ''}</span>
        <span>{field.label}</span>
      </button>
    </div>
  )
}

export interface FormRendererProps {
  form: RendererForm
  placement: 'inline' | 'popup' | 'form_page' | 'book_call_details'
  spotKey?: string | null
  blockId?: string | null
  sendLabel?: string
  onDone?: (outcome: Extract<SubmitOutcome, { ok: true }>, firstName: string | null, booking?: BookingBasics | null) => void
  onDirty?: (dirty: boolean) => void
}

export function FormRenderer({ form, placement, spotKey, blockId, sendLabel = 'Send', onDone, onDirty }: FormRendererProps) {
  const def = useMemo<FormDefinition>(() => ({
    v: 1, audience: form.audience, fields: form.fields, ads: { lead_on: true, goal: 'none' }, routing: { card: { on: false } }, after_submit: form.after_submit,
  }), [form])
  const answers = useRef<Answers>({})
  const [structure, setStructure] = useState(0)
  const [showErrors, setShowErrors] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const [resume, setResume] = useState<Answers | null>(null)
  const [cityCountry, setCityCountry] = useState<string | null>(null)
  const [firstName, setFirstName] = useState<string | null>(null)
  const idem = useRef<string>('')
  const openedAt = useRef<number>(Date.now())
  const visitId = useRef<string>('')
  const honeypot = useRef<HTMLInputElement>(null)
  const started = useRef(false)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consentKeys = useMemo(() => form.fields.filter((f) => f.type === 'consent').map((f) => f.key), [form])
  // #4452 §8: the fixed properties every forms event carries.
  const ctx = useMemo<FormContext>(() => ({ form_key: form.key, form_version: form.version, label: form.audience, placement, spot: spotKey ?? null }), [form, placement, spotKey])
  const design = useMemo(() => designOf(form.design), [form])
  // §2.7: one question per screen on phones, when the Design tab says so.
  const [isPhone, setIsPhone] = useState(false)
  const [step, setStep] = useState(0)
  const rootRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 859px)')
    const on = () => setIsPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // §8 form_viewed: an inline or form-page form at least 50% in view for 1 s, once per page view.
  useEffect(() => {
    if (placement !== 'inline' && placement !== 'form_page') return
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    let sent = false
    const io = new IntersectionObserver(([entry]) => {
      if (sent) return
      if (entry.intersectionRatio >= 0.5) {
        timer = timer ?? setTimeout(() => {
          sent = true
          formEvent('form_viewed', ctx)
          trackFunnel('form_viewed', { formId: form.id, visitId: visitId.current, placement })
          io.disconnect()
        }, 1000)
      } else if (timer) { clearTimeout(timer); timer = null }
    }, { threshold: [0, 0.5, 1] })
    io.observe(el)
    return () => { io.disconnect(); if (timer) clearTimeout(timer) }
  }, [ctx, form.id, placement])

  useEffect(() => {
    idem.current = crypto.randomUUID()
    visitId.current = crypto.randomUUID()
    openedAt.current = Date.now()
    const d = readDraft(form.id, Date.now())
    if (d && Object.keys(d).length) setResume(d)
    // §2.7 UTM prefill hint for a city/choice field.
    const campaign = (sessionUtm().campaign ?? '').toLowerCase()
    const prefill = (form as unknown as { prefill?: Array<{ field_key: string; match: string; value: string }> }).prefill ?? []
    for (const p of prefill) {
      if (campaign.includes(p.match.toLowerCase())) answers.current[p.field_key] = p.value
    }
  }, [form])

  const onValue = useCallback((key: string, value: unknown, structural: boolean) => {
    if (value === null || value === undefined || value === '') delete answers.current[key]
    else answers.current[key] = value
    if (!started.current) {
      started.current = true
      formEvent('form_started', ctx, { first_field: key })
      trackFunnel('form_started', { formId: form.id, visitId: visitId.current, placement, props: { first_field: key } })
    }
    if (key === form.fields.find((f) => f.type === 'name')?.key && typeof value === 'string') setFirstName(value.trim().split(' ')[0] || null)
    onDirty?.(Object.keys(answers.current).length > 0)
    if (structural) setStructure((n) => n + 1)
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => writeDraft(form.id, answers.current, consentKeys, Date.now()), 400)
  }, [form, placement, consentKeys, onDirty, ctx])

  const send = async () => {
    if (state === 'sending') return  // no double send
    setShowErrors(true)
    const res = validateAnswers(def, answers.current, localToday())
    if (!res.ok) {
      setErrorCount(res.errors.length)
      formEvent('form_error', ctx, { fields: res.errors.map((e) => e.key).join(','), count: res.errors.length, source: 'client' })
      trackFunnel('form_error', { formId: form.id, visitId: visitId.current, placement, props: { count: res.errors.length, source: 'client' } })
      const first = res.errors[0]?.key
      if (first) document.getElementById(`fk-${first}`)?.focus()
      return
    }
    setErrorCount(0)
    if (form.preview) {
      setState('done')
      onDone?.({ ok: true, submissionId: 'preview', leadEventId: null, deduped: false, goal: 'none', handoffToken: null, schedulerKey: null }, res.first_name, bookingFromAnswers(form.fields, answers.current, form.audience))
      return
    }
    setState('sending')
    setFailure(null)
    const visible: Answers = {}
    for (const f of form.fields) if (isVisible(f, form.fields, answers.current) && f.key in answers.current) visible[f.key] = answers.current[f.key]
    const outcome = await postForm(submitBody({
      idempotencyKey: idem.current, formId: form.id, version: form.version, answers: visible, placement,
      spotKey, blockId, openedAt: openedAt.current, honeypot: honeypot.current?.value ?? '',
    }))
    if (outcome.ok) {
      clearDraft(form.id)
      if (outcome.leadEventId) fireMarketingLead(form.audience, outcome.leadEventId)
      formEvent('form_submitted', ctx, { deduped: outcome.deduped })
      try { window.localStorage.setItem(`mingla:form-done:${form.id}`, String(Date.now())) } catch { /* storage off */ }
      setState('done')
      const after = form.after_submit
      if (after?.action === 'book_call' && outcome.handoffToken && outcome.schedulerKey) {
        // The public route follows the audience; the profile key is data. A new
        // profile therefore needs no new route or renderer release.
        const path = form.audience === 'creator' ? '/schedule/creators' : form.audience === 'local' ? '/schedule/locals' : '/schedule'
        const next = new URL(path, window.location.origin)
        next.searchParams.set('profile', outcome.schedulerKey)
        next.searchParams.set('handoff', outcome.handoffToken)
        window.location.assign(next.toString())
        return
      }
      if (after?.action === 'link' && after.url) {
        window.location.assign(new URL(after.url, window.location.origin).toString())
        return
      }
      onDone?.(outcome, res.first_name, bookingFromAnswers(form.fields, visible, form.audience))
      return
    }
    setState('idle')
    setFailure(FAILURE_COPY[outcome.kind])
    if (outcome.kind === 'validation' || outcome.kind === 'form_changed') formEvent('form_error', ctx, { fields: '', count: 1, source: 'server' })
    else formEvent('form_submit_failed', ctx, { reason: outcome.kind })
    if (outcome.kind === 'form_closed') clearDraft(form.id)
  }

  const visibleFields = form.fields.filter((f) => isVisible(f, form.fields, answers.current))
  void structure
  const stepMode = design.phone_steps && isPhone && visibleFields.length > 1
  const at = Math.min(step, Math.max(0, visibleFields.length - 1))
  const shownFields = stepMode ? visibleFields.slice(at, at + 1) : visibleFields
  const lastStep = !stepMode || at >= visibleFields.length - 1
  const next = () => {
    const f = visibleFields[at]
    const err = f ? validateAnswers(def, answers.current, localToday()).errors.find((e) => e.key === f.key) : null
    if (err) {
      setShowErrors(true)
      document.getElementById(`fk-${f!.key}`)?.focus()
      return
    }
    setShowErrors(false)
    setStep(at + 1)
    // §2.7 / §8: each Continue in phone step mode logs form_step with the step number.
    formEvent('form_step', ctx, { step: at + 1, of: visibleFields.length })
    trackFunnel('form_step', { formId: form.id, visitId: visitId.current, placement, step: at + 1 })
  }
  if (state === 'done') return null

  return (
    <form ref={rootRef} className="fk-form" noValidate onSubmit={(e) => { e.preventDefault(); if (lastStep) void send(); else next() }} data-columns={String(design.columns)} data-steps={stepMode ? `${at + 1}/${visibleFields.length}` : undefined}>
      {resume ? (
        <div className="fk-resume" role="status">
          <p>Pick up where you left off{firstName || typeof resume.name === 'string' ? `, ${String(resume.name ?? firstName).split(' ')[0]}` : ''}?</p>
          <button type="button" className="fk-link" onClick={() => {
            answers.current = { ...resume }
            setResume(null)
            setStructure((n) => n + 1)
            formEvent('form_resumed', ctx)
          }}>Pick up</button>
          <button type="button" className="fk-link" onClick={() => { clearDraft(form.id); setResume(null) }}>Start again</button>
        </div>
      ) : null}
      {showErrors && errorCount > 0 ? (
        <p className="fk-summary" role="alert">{errorCount} answer{errorCount === 1 ? '' : 's'} need{errorCount === 1 ? 's' : ''} a fix below.</p>
      ) : null}
      <div key={structure === 0 ? 'base' : `s${resume ? 'r' : ''}`} className="fk-fields">
        {stepMode ? <p className="fk-step" aria-live="polite">Question {at + 1} of {visibleFields.length}</p> : null}
        {shownFields.map((f) => {
          const p: FieldProps = { field: f, def, answers, showErrors, onValue, phoneCountryHint: cityCountry }
          switch (f.type) {
            case 'name': return <TextField key={f.key} {...p} kind="name" />
            case 'email': return <TextField key={f.key} {...p} kind="email" />
            case 'short': return <TextField key={f.key} {...p} kind="short" />
            case 'long': return <TextField key={f.key} {...p} kind="long" />
            case 'phone': return <PhoneField key={f.key} {...p} />
            case 'single': return <ChoiceField key={f.key} {...p} multi={false} />
            case 'multi': return <ChoiceField key={f.key} {...p} multi />
            case 'dropdown': return f.source === 'google_city'
              ? <CityField key={f.key} {...p} onCountry={setCityCountry} />
              : <ChoiceField key={f.key} {...p} multi={false} />
            case 'social': return <SocialField key={f.key} {...p} />
            case 'date': return <DateField key={f.key} {...p} />
            case 'consent': return <ConsentField key={f.key} {...p} />
          }
        })}
      </div>
      {/* The bot trap: after the fields, never focusable, hidden from assistive tech (#4452 rework 1, P0-2). */}
      <div className="fk-hp" aria-hidden="true">
        <label>Leave this empty <input ref={honeypot} tabIndex={-1} autoComplete="off" name="website_url" aria-hidden="true" /></label>
      </div>
      {failure ? (
        <p className="fk-failure" role="alert">
          {failure}
        </p>
      ) : null}
      <div className="fk-actions">
        {stepMode && at > 0 ? <button type="button" className="fk-link" onClick={() => setStep(at - 1)}>Back</button> : null}
        <button type="submit" className="fk-send" disabled={state === 'sending'} aria-busy={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : lastStep ? sendLabel : 'Continue'}
        </button>
      </div>
    </form>
  )
}
