'use client'
// ORCH-1216 [Explorer "Get the app" lead-capture → TestFlight hard-gate] —
// 2-step consumer/explorer app-interest form. Near-exact clone of the shipped
// ORCH-1045 beta-access-modal.tsx, re-pointed to the explorer surface.
//
// Self-contained accessible modal: AnimatePresence + ESC + body-scroll-lock +
// role=dialog + focus trap + reset-on-open (carried over from beta-access-modal).
// All shared modal visuals/tokens are LOCKED to DESIGN_ORCH-1045 (same warm
// light theme; panel forces data-theme="light").
//
// Step 1: interest chips (ORCH-1219 Fix A — MULTI-SELECT toggle group, NO
// auto-advance; user presses Next). Step 2: name + city + email + consent →
// submit. On a SUCCESSFUL submit the success panel branches on the detected
// platform 3-way (ORCH-1219 Fix C): iOS shows the TestFlight install link + "we
// emailed it too"; Android shows the "iOS-only beta" message; desktop/other
// shows the "beta on iPhone & iPad" message — neither non-iOS branch shows an
// on-screen link, and desktop NEVER claims the user is on Android. The hard-coded
// TestFlight URL appears in the iOS success branch ONLY (hard-gate, no fail-open).
// (The lead is ALSO emailed the link by the edge fn on every device — Fix D.)

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import {
  submitExplorerAppLead,
  type ExplorerAppSubmitResult,
} from '@/lib/explorer-app-submit'
// ORCH-1221 Fix 1 — "All of it" select-all reducer lives in a pure module so it
// is unit-testable without React. The chip handler delegates to nextInterest.
import {
  ALL_VALUE,
  SPECIFIC_INTERESTS,
  nextInterest,
} from '@/lib/explorer-interest'

export interface GetTheAppModalProps {
  open: boolean
  onClose: () => void
  /** Attribution written to explorer_app_leads.source. */
  source: 'explorer_marketing_nav'
}

// HARD RULE (§1.1, §3.2.4): the live TestFlight join link (verified HTTP 200 on
// 2026-06-22) is HARD-CODED inline INSIDE the iOS success branch ONLY
// (SuccessPanel below) — never in an idle/step/error render path, and never in
// the transport/nav (I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT + I-PROPOSED-1216-
// ANDROID-NO-TESTFLIGHT-LINK enforce this). The URL literal is intentionally NOT
// a module-level const so it cannot escape the success-iOS render region.

// Mirror the edge-fn validator + beta-access-modal regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const INTERESTS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Places', value: 'places' },
  { label: 'Events', value: 'events' },
  { label: 'Trips', value: 'trips' },
  { label: 'Experiences', value: 'experiences' },
  { label: 'All of it', value: 'all' },
]

type Status = 'idle' | 'submitting' | 'success' | 'error'
type ErrorKind = 'validation' | 'rate_limited' | 'server' | 'network'
// ORCH-1219 Fix C — 3-way platform. 'other' = desktop / anything non-mobile-Apple
// and non-Android, so desktop NEVER claims the user is on Android.
type Platform = 'ios' | 'android' | 'other'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'

/** True for iPhone / iPad (incl. iPadOS reporting a desktop "MacIntel" UA). */
export function isIosDevice(
  ua: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  // Classic iOS UA.
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ Safari masquerades as desktop Mac: platform "MacIntel" +
  // a touch screen (maxTouchPoints > 1) ⇒ it is an iPad, not a Mac.
  if (platform === 'MacIntel' && maxTouchPoints > 1) return true
  return false
}

/**
 * ORCH-1219 Fix C — resolve a 3-way platform from UA + platform + touch points.
 * iOS wins first (an iPad masquerading as Mac is still iOS); then Android by UA;
 * everything else (desktop incl. real Macs, Windows, Linux, ChromeOS) is 'other'.
 */
export function resolvePlatform(
  ua: string,
  platform: string,
  maxTouchPoints: number,
): Platform {
  if (isIosDevice(ua, platform, maxTouchPoints)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'other'
}

/** SSR-safe platform read (never touches navigator at module load). */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  return resolvePlatform(
    navigator.userAgent ?? '',
    navigator.platform ?? '',
    navigator.maxTouchPoints ?? 0,
  )
}

export function GetTheAppModal({ open, onClose, source }: GetTheAppModalProps) {
  const reduced = useMinglaReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const headingId = useId()

  const [step, setStep] = useState<1 | 2>(1)
  // ORCH-1219 Fix A — interest is multi-select: an array of toggled values.
  const [interest, setInterest] = useState<string[]>([])
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<Status>('idle')
  const [platform, setPlatform] = useState<Platform>('other')
  const [errorKind, setErrorKind] = useState<ErrorKind>('network')

  const abortRef = useRef<AbortController | null>(null)

  // ── Reset all state on open (false → true) ──────────────────────────────────
  useEffect(() => {
    if (!open) return
    setStep(1)
    setInterest([])
    setName('')
    setCity('')
    setEmail('')
    setConsent(false)
    setTouched({})
    setStatus('idle')
    setPlatform('other')
    setErrorKind('network')
  }, [open])

  // ── ESC closes ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ── Body scroll lock while open ─────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // ── Abort any in-flight submit on close/unmount ─────────────────────────────
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [open])

  // ── Focus management: first focusable of the step, or success heading. ──────
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const id = window.setTimeout(() => {
      if (status === 'success') {
        const h = panel.querySelector<HTMLElement>('[data-success-heading]')
        h?.focus()
        return
      }
      const first = panel.querySelector<HTMLElement>(
        '[data-step-autofocus]',
      ) ?? panel.querySelector<HTMLElement>(FOCUSABLE)
      first?.focus()
    }, reduced ? 0 : 60)
    return () => window.clearTimeout(id)
  }, [open, step, status, reduced])

  // ── Focus trap: keep Tab/Shift+Tab within the panel ─────────────────────────
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((n) => n.offsetParent !== null || n === document.activeElement)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // ── Validation helpers ───────────────────────────────────────────────────────
  const trimmedEmail = email.trim().toLowerCase()
  const emailValid = EMAIL_RE.test(trimmedEmail) && trimmedEmail.length <= 254

  // ORCH-1219 Fix A — at least one interest chip toggled on. User presses Next.
  const step1Valid = interest.length >= 1
  const canSubmit =
    name.trim().length > 0 &&
    emailValid &&
    city.trim().length > 0 &&
    consent &&
    status !== 'submitting'

  const markTouched = useCallback((key: string): void => {
    setTouched((t) => ({ ...t, [key]: true }))
  }, [])

  const goNext = useCallback((): void => {
    if (step === 1 && step1Valid) setStep(2)
  }, [step, step1Valid])

  const goBack = useCallback((): void => {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2) : s))
  }, [])

  // ── Chip toggle (ORCH-1219 Fix A multi-select / ORCH-1221 Fix 1 select-all) ──
  // Each chip toggles via the pure `nextInterest` reducer: specific pills toggle
  // individually, and "All of it" is a SELECT-ALL control (sets/clears all 5,
  // and auto-reflects when every specific pill is on). NO setStep(2) here — the
  // user presses Next (the 220ms pointer auto-advance was removed in ORCH-1219).
  const toggleChip = useCallback((value: string): void => {
    setInterest((prev) => nextInterest(prev, value))
  }, [])

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (): Promise<void> => {
    setTouched((t) => ({ ...t, name: true, email: true, city: true, consent: true }))
    if (!(name.trim().length > 0 && emailValid && city.trim().length > 0 && consent)) {
      return
    }

    // Detect the device platform once, at submit time (SSR-safe).
    const detected = detectPlatform()
    setPlatform(detected)

    // Offline short-circuit.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorKind('network')
      setStatus('error')
      return
    }

    setStatus('submitting')
    const controller = new AbortController()
    abortRef.current = controller

    let result: ExplorerAppSubmitResult
    try {
      result = await submitExplorerAppLead(
        {
          name: name.trim(),
          email: trimmedEmail,
          city: city.trim(),
          interest,
          consent: true,
          platform: detected,
          source,
        },
        controller.signal,
      )
    } catch {
      result = { ok: false, error: 'network' }
    }
    abortRef.current = null

    if (result.ok) {
      // META-ORCH-1187 — get-the-app CTA conversion (analytics; consent-gated
      // no-op). The transport fires get_the_app_submitted itself; this records
      // the CTA-completion at the modal call site.
      captureMarketing('marketing_cta_clicked', {
        cta_id: 'get_the_app_submitted',
        location: source,
      })
      setStatus('success')
    } else {
      setErrorKind(result.error)
      setStatus('error')
    }
  }, [name, emailValid, city, consent, interest, trimmedEmail, source])

  const errorCopy = useMemo((): string => {
    switch (errorKind) {
      case 'network':
        return "That didn't go through — check your connection and try again."
      case 'server':
        return 'Something broke on our end. Give it another go in a moment.'
      case 'rate_limited':
        return 'Whoa — slow down a sec. Try again in a few minutes.'
      case 'validation':
        return 'Hmm, something in the form needs a fix.'
      default:
        return 'Something went wrong. Try again.'
    }
  }, [errorKind])

  // Panel motion (reduced-motion → instant).
  const panelMotion = reduced
    ? { initial: false, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, scale: 0.96, y: 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97, y: 8 },
        transition: { type: 'spring' as const, stiffness: 240, damping: 28 },
      }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="getapp-backdrop"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.22 }}
          onClick={() => {
            // Ignore backdrop click while submitting (avoid accidental data loss).
            if (status !== 'submitting') onClose()
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
          style={{
            background: 'rgba(8,9,12,0.55)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          <motion.div
            key="getapp-panel"
            ref={panelRef}
            data-theme="light"
            {...panelMotion}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[440px] overflow-hidden rounded-[36px] bg-parchment p-6 shadow-[var(--elev-3)] ring-1 ring-[var(--glass-border)] sm:max-w-[480px] sm:p-8"
            style={{ maxHeight: '90vh', overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="glass-soft absolute right-5 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-full text-text-primary transition-all duration-200 hover:brightness-110 focus-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>

            {status === 'success' ? (
              <SuccessPanel
                headingId={headingId}
                platform={platform}
                reduced={reduced}
                onDone={onClose}
              />
            ) : (
              <>
                {/* Progress */}
                <div className="pr-12">
                  <p
                    aria-live="polite"
                    className="text-[11px] font-semibold uppercase tracking-[0.22em] text-warm-ink"
                  >
                    Step {step} of 2
                  </p>
                  <div
                    role="progressbar"
                    aria-valuemin={1}
                    aria-valuemax={2}
                    aria-valuenow={step}
                    aria-label="Get the app form progress"
                    className="mt-3 flex gap-1.5"
                  >
                    {[1, 2].map((n) => (
                      <span
                        key={n}
                        className={cn(
                          'h-1 flex-1 rounded-full transition-colors duration-200',
                          n <= step ? 'bg-warm' : 'bg-divider-strong',
                        )}
                      />
                    ))}
                  </div>
                </div>

                <StepBody
                  step={step}
                  headingId={headingId}
                  // step 1
                  interest={interest}
                  onToggleChip={toggleChip}
                  // step 2
                  name={name}
                  setName={setName}
                  city={city}
                  setCity={setCity}
                  email={email}
                  setEmail={setEmail}
                  emailValid={emailValid}
                  consent={consent}
                  setConsent={setConsent}
                  // shared
                  touched={touched}
                  markTouched={markTouched}
                  submitting={status === 'submitting'}
                />

                {/* Submit error banner */}
                {status === 'error' ? (
                  <motion.div
                    initial={reduced ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduced ? 0 : 0.16 }}
                    role="alert"
                    className="mt-6 flex items-start gap-2.5 rounded-[16px] border px-4 py-3"
                    style={{
                      background: 'rgba(184,58,46,0.08)',
                      borderColor: 'rgba(184,58,46,0.25)',
                    }}
                  >
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0 text-danger"
                      aria-hidden="true"
                    />
                    <span className="text-[13px] text-text-primary">
                      {errorCopy}
                    </span>
                  </motion.div>
                ) : null}

                {/* Footer */}
                <div
                  className={cn(
                    'mt-8 flex items-center gap-3',
                    step === 1 ? 'justify-end' : 'justify-between',
                  )}
                >
                  {step > 1 ? (
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={goBack}
                      disabled={status === 'submitting'}
                      className="flex-none"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      Back
                    </Button>
                  ) : null}

                  {step < 2 ? (
                    <Button
                      variant="primary"
                      size="md"
                      onClick={goNext}
                      disabled={!step1Valid}
                      className="w-full sm:w-auto"
                    >
                      Next
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="md"
                      onClick={handleSubmit}
                      loading={status === 'submitting'}
                      disabled={!canSubmit}
                      className="flex-1 sm:flex-none"
                    >
                      {status === 'submitting' ? 'Getting it…' : 'Get the app'}
                    </Button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

// ─── Step body ────────────────────────────────────────────────────────────────
interface StepBodyProps {
  step: 1 | 2
  headingId: string
  interest: string[]
  onToggleChip: (value: string) => void
  name: string
  setName: (v: string) => void
  city: string
  setCity: (v: string) => void
  email: string
  setEmail: (v: string) => void
  emailValid: boolean
  consent: boolean
  setConsent: (v: boolean) => void
  touched: Record<string, boolean>
  markTouched: (key: string) => void
  submitting: boolean
}

function StepBody(props: StepBodyProps) {
  const { step, headingId } = props

  if (step === 1) {
    return (
      <div className="mt-6">
        <h2
          id={headingId}
          className="font-display text-2xl tracking-[-0.01em] text-text-primary md:text-[28px]"
        >
          What are you most excited for?
        </h2>
        <p className="mt-2 text-base text-text-secondary">
          Pick everything that pulls you in — choose as many as you like, then hit
          Next.
        </p>
        {/* ORCH-1219 Fix A — MULTI-SELECT toggle group (NOT a radiogroup). Each
            chip toggles on/off via aria-pressed; the user presses Next.
            ORCH-1221 Fix 1 — "All of it" is a SELECT-ALL control (see
            nextInterest): it sets/clears all 5 and auto-reflects selected when
            every specific pill is chosen. */}
        <div
          role="group"
          aria-label="What are you most excited for? Choose all that apply."
          className="mt-6 flex flex-wrap gap-3"
        >
          {INTERESTS.map((it, i) => {
            // ORCH-1221 Fix 1 — "All of it" reflects as selected when every
            // specific pill is chosen (the array also carries 'all' then, but
            // derive it so the chip is robust to either representation).
            const selected =
              it.value === ALL_VALUE
                ? SPECIFIC_INTERESTS.every((v) => props.interest.includes(v))
                : props.interest.includes(it.value)
            return (
              <button
                key={it.value}
                type="button"
                aria-pressed={selected}
                data-step-autofocus={i === 0 ? '' : undefined}
                onClick={() => props.onToggleChip(it.value)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault()
                    props.onToggleChip(it.value)
                  }
                }}
                className={cn(
                  'inline-flex h-12 items-center gap-2 rounded-full px-5 text-base font-medium transition-all duration-150 focus-ring active:scale-[0.98]',
                  selected
                    ? 'bg-warm text-white hover:bg-warm-hover'
                    : 'border border-[var(--glass-border)] text-text-primary hover:-translate-y-0.5 hover:border-[rgba(235,120,37,0.35)] hover:bg-[rgba(235,120,37,0.06)]',
                )}
              >
                {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                {it.label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // step 2 — name + city + email + consent
  const emailError =
    props.touched.email && !props.emailValid && props.email.length > 0
      ? "That email doesn't look right."
      : props.touched.email && props.email.trim().length === 0
        ? "That email doesn't look right."
        : undefined

  return (
    <div className="mt-6">
      <h2
        id={headingId}
        className="font-display text-2xl tracking-[-0.01em] text-text-primary md:text-[28px]"
      >
        Where do we send it?
      </h2>
      <p className="mt-2 text-base text-text-secondary">
        Just the basics — so we can get you in and tell you when your city goes live.
      </p>
      <div className="mt-6 flex flex-col gap-4">
        <Field
          id="getapp-name"
          label="Your name"
          placeholder="e.g. Ada"
          value={props.name}
          onChange={props.setName}
          onBlur={() => props.markTouched('name')}
          error={props.touched.name && props.name.trim().length === 0 ? 'Add your name.' : undefined}
          autoCapitalize="words"
          maxLength={80}
          autoFocus
        />
        <Field
          id="getapp-email"
          label="Email"
          placeholder="you@email.com"
          value={props.email}
          onChange={props.setEmail}
          onBlur={() => props.markTouched('email')}
          error={emailError}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={254}
          disabled={props.submitting}
        />
        <Field
          id="getapp-city"
          label="City"
          placeholder="e.g. Lagos"
          value={props.city}
          onChange={props.setCity}
          onBlur={() => props.markTouched('city')}
          error={props.touched.city && props.city.trim().length === 0 ? 'Add your city.' : undefined}
          autoCapitalize="words"
          maxLength={80}
        />
        <label className="mt-2 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={props.consent}
            onChange={(e) => {
              props.setConsent(e.target.checked)
              props.markTouched('consent')
            }}
            disabled={props.submitting}
            className="mt-0.5 h-[22px] w-[22px] shrink-0 cursor-pointer rounded-[6px] border border-[var(--glass-border)] accent-warm focus-ring"
          />
          <span className="text-[13px] leading-relaxed text-text-secondary">
            I&apos;m OK with Mingla emailing me about the app and when my city goes
            live.
          </span>
        </label>
      </div>
    </div>
  )
}

// ─── Field primitive (shared by Step 2 fields) ──────────────────────────────────
interface FieldProps {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  error?: string
  type?: string
  inputMode?: 'email' | 'text'
  autoCapitalize?: string
  autoCorrect?: string
  spellCheck?: boolean
  maxLength?: number
  disabled?: boolean
  autoFocus?: boolean
}

function Field(props: FieldProps) {
  const hasError = Boolean(props.error)
  const errorId = `${props.id}-error`
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={props.id} className="text-sm font-semibold text-text-secondary">
        {props.label}
      </label>
      <input
        id={props.id}
        data-step-autofocus={props.autoFocus ? '' : undefined}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
        placeholder={props.placeholder}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        autoCapitalize={props.autoCapitalize}
        autoCorrect={props.autoCorrect}
        spellCheck={props.spellCheck}
        maxLength={props.maxLength}
        disabled={props.disabled}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        className={cn(
          'h-12 w-full rounded-[16px] bg-white/70 px-4 text-base text-text-primary transition-colors duration-150 placeholder:text-text-muted focus-ring',
          'border',
          hasError
            ? 'border-danger'
            : 'border-[var(--glass-border)] hover:border-[rgba(14,14,16,0.18)] focus:border-warm',
          props.disabled ? 'opacity-60' : '',
        )}
      />
      {hasError ? (
        <motion.p
          id={errorId}
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="text-[13px] text-danger"
        >
          {props.error}
        </motion.p>
      ) : null}
    </div>
  )
}

// ─── Success panel — platform branch (§3.2.4, the new state) ────────────────────
interface SuccessPanelProps {
  headingId: string
  platform: Platform
  reduced: boolean
  onDone: () => void
}

function SuccessPanel(props: SuccessPanelProps) {
  const isIos = props.platform === 'ios'
  const isAndroid = props.platform === 'android'
  return (
    <motion.div
      initial={props.reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: props.reduced ? 0 : 0.28 }}
      className="flex flex-col items-center py-4 text-center"
    >
      <motion.span
        initial={props.reduced ? false : { scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'rgba(63,139,92,0.12)' }}
      >
        <Check className="h-7 w-7 text-success" aria-hidden="true" />
      </motion.span>
      <h2
        id={props.headingId}
        data-success-heading
        tabIndex={-1}
        aria-live="polite"
        className="mt-6 font-display text-2xl tracking-[-0.01em] text-text-primary outline-none md:text-[28px]"
      >
        {isIos ? "You're in. Grab the app." : "You're on the list."}
      </h2>
      {isIos ? (
        // ── iOS success branch — TestFlight install link (hard-gate). The
        //    TESTFLIGHT_URL literal appears HERE ONLY. ──────────────────────────
        <>
          <p className="mt-2 max-w-sm text-base text-text-secondary">
            Mingla is in TestFlight while we polish it. Tap below to install it and
            start finding things to do.
          </p>
          <a
            href="https://testflight.apple.com/join/1gvHNqkQ"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-base font-display font-medium tracking-[-0.005em]',
              'transition-all duration-200 ease-out-quart cursor-pointer focus-ring',
              'bg-warm text-white hover:-translate-y-0.5 hover:bg-[var(--color-warm-hover)] hover:brightness-110 active:translate-y-0 active:brightness-100',
            )}
          >
            Open in TestFlight
          </a>
          {/* ORCH-1219 Fix D — the link is ALSO emailed (every device). */}
          <p className="mt-3 text-[13px] text-text-muted">
            We&apos;ve also emailed you the link.
          </p>
          <Button
            variant="ghost"
            size="md"
            onClick={props.onDone}
            className="mt-3"
          >
            Done
          </Button>
        </>
      ) : (
        // ── Non-iOS success branch — NO on-screen link in EITHER sub-case
        //    (ORCH-1216 hard-gate holds). ORCH-1219 Fix C splits it 3-way so
        //    desktop NEVER claims the user is on Android. ─────────────────────
        <>
          {isAndroid ? (
            <p className="mt-2 max-w-sm text-base text-text-secondary">
              We detect you&apos;re on Android — Mingla is only available for beta
              testing on iOS right now. We&apos;ll let you know the moment Android
              drops. We&apos;ve emailed you the TestFlight link to open on your
              iPhone.
            </p>
          ) : (
            <p className="mt-2 max-w-sm text-base text-text-secondary">
              Mingla&apos;s in beta on iPhone &amp; iPad right now. We&apos;ve
              emailed you the TestFlight link — open it on your iPhone to install.
            </p>
          )}
          <Button
            variant="primary"
            size="md"
            onClick={props.onDone}
            className="mt-8"
          >
            Done
          </Button>
        </>
      )}
    </motion.div>
  )
}
