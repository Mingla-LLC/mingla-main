'use client'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import { siteAttribution } from '@/lib/links-src'
import { appHandoffHrefs } from '@/lib/app-handoff'

// #4339 §5 — "Prompt your website into existence", phase 2a: the VISUAL DEMO
// only. The visitor describes their place and taps Generate; five build steps
// tick by while a small site preview assembles with their place's name; then
// the sheet "Ari's ready to build it." opens. "Continue on Mingla Web" goes to
// host web through the #4137 seam (lib/app-handoff.ts → cta-destination.ts).
//
// The description stays in this page's memory. It is never put in a URL, never
// stored and never sent anywhere (spec §5: it must not travel in a query
// string).
//
// TODO(#4339 §5): the Ari draft hand-off — post the description to the
// rate-limited draft endpoint, get a short opaque `draft` id, and continue to
// host web's /ari?draft=<id> so Ari starts building after sign-in. Until that
// ships, Continue opens host web's front door with nothing attached.

const STEPS = [
  'Reading your description',
  'Choosing a look',
  'Writing your pages',
  'Connecting tickets and bookings',
  'Rendering your site',
] as const
const MIN_LENGTH = 12
const MAX_LENGTH = 1000
const ATTRIBUTION = siteAttribution('business_hero')

/** The preview's title and address, from the first clause of the description. */
export function previewName(description: string): { title: string; host: string } {
  const first = description.split(/[,.]/)[0] ?? ''
  const name = first
    .trim()
    .replace(/^(a|an|the)\s+/i, '')
    .split(/\s+/)
    .slice(0, 4)
    .join(' ')
  const title = name.charAt(0).toUpperCase() + name.slice(1)
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'yourplace'
  return { title, host: `${slug}.usemingla.com` }
}

export function SitePromptDemo() {
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [step, setStep] = useState(-1)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState('')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  const fieldId = useId()
  const errorId = useId()
  const preview = previewName(text)

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  // "Make my site" glides here and focuses the box.
  useEffect(() => {
    const root = rootRef.current
    const section = root?.closest('section')
    if (!root || !section) return
    const onClick = (event: Event) => {
      if (!(event.target as HTMLElement).closest('[data-focus-gen]')) return
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      root.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
      window.setTimeout(() => areaRef.current?.focus({ preventScroll: true }), reduced ? 0 : 450)
    }
    section.addEventListener('click', onClick)
    return () => section.removeEventListener('click', onClick)
  }, [])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (text.trim().length < MIN_LENGTH) {
      setError(`Tell us a little more: at least ${MIN_LENGTH} characters.`)
      areaRef.current?.focus()
      return
    }
    setError('')
    setRunning(true)
    setStep(0)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const tick = reduced ? 60 : 850
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = STEPS.map((_, i) => window.setTimeout(() => setStep(i), i * tick))
    timers.current.push(
      window.setTimeout(() => {
        setStep(STEPS.length)
        setSheetOpen(true)
      }, STEPS.length * tick + 300),
    )
  }

  const closeSheet = useCallback(() => {
    setSheetOpen(false)
    setRunning(false)
    setStep(-1)
    window.requestAnimationFrame(() => areaRef.current?.focus({ preventScroll: true }))
  }, [])

  // Blocks of the preview appear as the steps tick.
  const blocks = step < 0 ? 0 : Math.ceil(((Math.min(step, STEPS.length - 1) + 1) * 5) / STEPS.length)

  return (
    <div className="gen reveal" ref={rootRef}>
      {!running ? (
        <form className="ask" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor={fieldId}>Describe your place</label>
            <textarea
              id={fieldId}
              ref={areaRef}
              value={text}
              maxLength={MAX_LENGTH}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setText(e.target.value)}
              placeholder="A rooftop café in Lekki with live acoustic sets on Fridays and the best plantain in town."
            />
            {error ? (
              <small id={errorId} role="alert" className="gen-error">
                {error}
              </small>
            ) : null}
          </div>
          <div className="row gen-actions">
            <button className="btn cta sm" type="submit">
              <Sparkles aria-hidden="true" /> Generate
            </button>
          </div>
        </form>
      ) : (
        <div className="stage" aria-live="polite">
          <ul className="steps">
            {STEPS.map((label, i) => (
              <li key={label} className={i < step ? 'ok' : i === step ? 'on' : undefined}>
                <i aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
          <div className="brw" aria-hidden="true">
            <div className="bar0">
              <i />
              <i />
              <i />
              <span>{preview.host}</span>
            </div>
            <div className="pg">
              <div className={blocks >= 1 ? 'blk hero in' : 'blk hero'}>{preview.title}</div>
              <div className={blocks >= 2 ? 'blk row3 in' : 'blk row3'}>
                <b />
                <b />
                <b />
              </div>
              <div className={blocks >= 3 ? 'blk line in' : 'blk line'} style={{ width: '80%' }} />
              <div className={blocks >= 4 ? 'blk line in' : 'blk line'} style={{ width: '62%' }} />
              <div className={blocks >= 5 ? 'blk btnr in' : 'blk btnr'} />
            </div>
          </div>
        </div>
      )}
      {sheetOpen ? <AriSheet onClose={closeSheet} /> : null}
    </div>
  )
}

function AriSheet({ onClose }: { onClose: () => void }) {
  const hrefs = appHandoffHrefs('host', ATTRIBUTION)
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true })
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && dialog.contains(active)
      if (event.shiftKey ? !inside || active === first : !inside || active === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      root.style.overflow = previousOverflow
    }
  }, [onClose])

  return createPortal(
    <div
      data-landing-sheet=""
      data-sheet="ari"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={dialogRef} className="modal-in" role="dialog" aria-modal="true" aria-labelledby="lp-ari-sheet-title">
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <h3 id="lp-ari-sheet-title">
          Ari’s ready <em>to build it.</em>
        </h3>
        <p>Sign in to Mingla Host and Ari starts building it straight away, from what you wrote. You can watch every step.</p>
        <a ref={primaryRef} className="sheet-cta" href={hrefs.computerHref} target="_blank" rel="noopener" onClick={onClose}>
          Continue on Mingla Web <ArrowRight aria-hidden="true" width={17} height={17} />
        </a>
      </div>
    </div>,
    document.querySelector('[data-landing]') ?? document.body,
  )
}
