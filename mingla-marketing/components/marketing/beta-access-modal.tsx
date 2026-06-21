'use client'
// ORCH-1045 [Business "Get Beta Access" lead-capture] — 3-step organiser beta form.
//
// Self-contained accessible modal: mirrors the in-repo video-modal.tsx shell
// (AnimatePresence + ESC + body-scroll-lock + role=dialog) and ADDS a focus trap
// + reset-on-open (a form needs both; the video modal has neither). All copy +
// tokens are LOCKED to DESIGN_ORCH-1045_GET_BETA_ACCESS.md. Renders on the
// light/warm marketing theme (panel forces data-theme="light").
//
// Step 1: brand-type chips (single-select). Step 2: business/name/city.
// Step 3: email + consent → submit. Success/error/idempotent states per §6.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import {
  submitBetaAccessLead,
  type BetaAccessSubmitResult,
} from '@/lib/beta-access-submit'

export interface BetaAccessModalProps {
  open: boolean
  onClose: () => void
  /** Attribution written to beta_access_leads.source. */
  source: 'organiser_marketing_nav' | 'organiser_marketing_hero'
}

const EASE_OUT_QUART = [0.16, 1, 0.3, 1] as const

// Mirror JoinWaitlistSheet.tsx:38 + the edge-fn validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const BRAND_TYPES: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Restaurant', value: 'restaurant' },
  { label: 'Café / Bar', value: 'cafe_bar' },
  { label: 'Club / Nightlife', value: 'club_nightlife' },
  { label: 'Event organiser', value: 'event_organiser' },
  { label: 'Experience / Tour', value: 'experience_tour' },
  { label: 'Venue / Space', value: 'venue_space' },
  { label: 'Other', value: 'other' },
]

type Status = 'idle' | 'submitting' | 'success' | 'error'
type SuccessStatus = 'created' | 'already_on_list'
type ErrorKind = 'validation' | 'rate_limited' | 'server' | 'network'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'

export function BetaAccessModal({ open, onClose, source }: BetaAccessModalProps) {
  const reduced = useMinglaReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const headingId = useId()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [brandType, setBrandType] = useState('')
  const [brandName, setBrandName] = useState('')
  const [contactName, setContactName] = useState('')
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<Status>('idle')
  const [successStatus, setSuccessStatus] = useState<SuccessStatus>('created')
  const [errorKind, setErrorKind] = useState<ErrorKind>('network')

  const abortRef = useRef<AbortController | null>(null)

  // ── Reset all state on open (false → true) — mirror JoinWaitlistSheet L78-86 ─
  useEffect(() => {
    if (!open) return
    setStep(1)
    setBrandType('')
    setBrandName('')
    setContactName('')
    setCity('')
    setEmail('')
    setConsent(false)
    setTouched({})
    setStatus('idle')
    setSuccessStatus('created')
    setErrorKind('network')
  }, [open])

  // ── ESC closes (mirror video-modal L18-25) ──────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ── Body scroll lock while open (mirror video-modal L28-35) ──────────────────
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // ── Abort any in-flight submit on close/unmount ──────────────────────────────
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [open])

  // ── Focus management: move focus to the first focusable of the current step,
  //    or the success heading on success. ──────────────────────────────────────
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

  // ── Focus trap: keep Tab/Shift+Tab within the panel ──────────────────────────
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

  const step1Valid = brandType !== ''
  const step2Valid =
    brandName.trim().length > 0 &&
    contactName.trim().length > 0 &&
    city.trim().length > 0
  const canSubmit = emailValid && consent && status !== 'submitting'

  const markTouched = useCallback((key: string): void => {
    setTouched((t) => ({ ...t, [key]: true }))
  }, [])

  const goNext = useCallback((): void => {
    if (step === 1) {
      if (!step1Valid) return
      setStep(2)
      return
    }
    if (step === 2) {
      setTouched((t) => ({
        ...t,
        brandName: true,
        contactName: true,
        city: true,
      }))
      if (!step2Valid) return
      setStep(3)
    }
  }, [step, step1Valid, step2Valid])

  const goBack = useCallback((): void => {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))
  }, [])

  // ── Chip select (auto-advance on pointer only; keyboard uses Next) ───────────
  const selectChip = useCallback(
    (value: string, viaPointer: boolean): void => {
      setBrandType(value)
      if (viaPointer && !reduced) {
        window.setTimeout(() => setStep(2), 220)
      }
    },
    [reduced],
  )

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (): Promise<void> => {
    setTouched((t) => ({ ...t, email: true, consent: true }))
    if (!emailValid || !consent) return

    // Offline short-circuit (DESIGN §6.9).
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorKind('network')
      setStatus('error')
      return
    }

    setStatus('submitting')
    const controller = new AbortController()
    abortRef.current = controller

    let result: BetaAccessSubmitResult
    try {
      result = await submitBetaAccessLead(
        {
          brandType,
          brandName: brandName.trim(),
          contactName: contactName.trim(),
          city: city.trim(),
          email: trimmedEmail,
          consent: true,
          source,
        },
        controller.signal,
      )
    } catch {
      result = { ok: false, error: 'network' }
    }
    abortRef.current = null

    if (result.ok) {
      // META-ORCH-1187 — beta-access CTA conversion (analytics; consent-gated
      // no-op). The lead-capture transport fires beta_access_submitted itself;
      // this records the CTA-completion at the modal call site.
      captureMarketing('marketing_cta_clicked', {
        cta_id: 'beta_access_submitted',
        location: source,
      })
      setSuccessStatus(result.status)
      setStatus('success')
    } else {
      setErrorKind(result.error)
      setStatus('error')
    }
  }, [
    emailValid,
    consent,
    brandType,
    brandName,
    contactName,
    city,
    trimmedEmail,
    source,
  ])

  const errorCopy = useMemo((): string => {
    switch (errorKind) {
      case 'network':
        return "That didn't go through — check your connection and try again."
      case 'server':
        return 'Something broke on our end. Give it another go in a moment.'
      case 'rate_limited':
        return "Whoa — that's a lot of tries. Take a breather and try again in a few minutes."
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
          key="beta-backdrop"
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
            key="beta-panel"
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
                email={trimmedEmail}
                successStatus={successStatus}
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
                    Step {step} of 3
                  </p>
                  <div
                    role="progressbar"
                    aria-valuemin={1}
                    aria-valuemax={3}
                    aria-valuenow={step}
                    aria-label="Beta access form progress"
                    className="mt-3 flex gap-1.5"
                  >
                    {[1, 2, 3].map((n) => (
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
                  reduced={reduced}
                  headingId={headingId}
                  // step 1
                  brandType={brandType}
                  onSelectChip={selectChip}
                  // step 2
                  brandName={brandName}
                  setBrandName={setBrandName}
                  contactName={contactName}
                  setContactName={setContactName}
                  city={city}
                  setCity={setCity}
                  // step 3
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

                  {step < 3 ? (
                    <Button
                      variant="primary"
                      size="md"
                      onClick={goNext}
                      disabled={step === 1 ? !step1Valid : !step2Valid}
                      className={step === 1 ? 'w-full sm:w-auto' : 'flex-1 sm:flex-none'}
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
                      {status === 'submitting' ? 'Joining…' : 'Join the beta'}
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
  step: 1 | 2 | 3
  reduced: boolean
  headingId: string
  brandType: string
  onSelectChip: (value: string, viaPointer: boolean) => void
  brandName: string
  setBrandName: (v: string) => void
  contactName: string
  setContactName: (v: string) => void
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
          What kind of business are you?
        </h2>
        <p className="mt-2 text-base text-text-secondary">
          Pick the one that fits best. You can tell us more in a sec.
        </p>
        <div
          role="radiogroup"
          aria-label="What kind of business are you?"
          className="mt-6 flex flex-wrap gap-3"
        >
          {BRAND_TYPES.map((bt, i) => {
            const selected = props.brandType === bt.value
            return (
              <button
                key={bt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-step-autofocus={i === 0 ? '' : undefined}
                onClick={() => props.onSelectChip(bt.value, true)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault()
                    props.onSelectChip(bt.value, false)
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
                {bt.label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (step === 2) {
    return (
      <div className="mt-6">
        <h2
          id={headingId}
          className="font-display text-2xl tracking-[-0.01em] text-text-primary md:text-[28px]"
        >
          Tell us about your place.
        </h2>
        <p className="mt-2 text-base text-text-secondary">
          Just the basics — so we know who we&apos;re setting up.
        </p>
        <div className="mt-6 flex flex-col gap-4">
          <Field
            id="beta-brand-name"
            label="Business name"
            placeholder="e.g. The Corner Table"
            value={props.brandName}
            onChange={props.setBrandName}
            onBlur={() => props.markTouched('brandName')}
            error={props.touched.brandName && props.brandName.trim().length === 0 ? 'Add your business name.' : undefined}
            autoCapitalize="words"
            maxLength={120}
            autoFocus
          />
          <Field
            id="beta-contact-name"
            label="Your name"
            placeholder="e.g. Ada"
            value={props.contactName}
            onChange={props.setContactName}
            onBlur={() => props.markTouched('contactName')}
            error={props.touched.contactName && props.contactName.trim().length === 0 ? 'Add your name.' : undefined}
            autoCapitalize="words"
            maxLength={80}
          />
          <Field
            id="beta-city"
            label="City"
            placeholder="e.g. Lagos"
            value={props.city}
            onChange={props.setCity}
            onBlur={() => props.markTouched('city')}
            error={props.touched.city && props.city.trim().length === 0 ? 'Add your city.' : undefined}
            autoCapitalize="words"
            maxLength={80}
          />
        </div>
      </div>
    )
  }

  // step 3
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
        Where do we send your invite?
      </h2>
      <p className="mt-2 text-base text-text-secondary">
        We&apos;ll email you when your spot opens up.
      </p>
      <div className="mt-6 flex flex-col gap-4">
        <Field
          id="beta-email"
          label="Email"
          placeholder="you@yourplace.com"
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
          autoFocus
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
            I&apos;m OK with Mingla emailing me about the business beta and how to
            get set up.
          </span>
        </label>
      </div>
    </div>
  )
}

// ─── Field primitive (shared by Step 2 + Step 3 email) ──────────────────────────
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

// ─── Success panel (§6.7) ───────────────────────────────────────────────────────
interface SuccessPanelProps {
  headingId: string
  email: string
  successStatus: SuccessStatus
  reduced: boolean
  onDone: () => void
}

function SuccessPanel(props: SuccessPanelProps) {
  const already = props.successStatus === 'already_on_list'
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
        {already ? "You're already on the list." : "You're on the list."}
      </h2>
      <p className="mt-2 max-w-sm text-base text-text-secondary">
        {already ? (
          <>
            Good news — we already have{' '}
            <span className="font-medium text-text-primary">{props.email}</span>{' '}
            down for the business beta. We&apos;ll be in touch as your spot opens.
          </>
        ) : (
          <>
            Your place deserves to be found — and we&apos;re getting Mingla ready
            for you. We&apos;ll email{' '}
            <span className="font-medium text-text-primary">{props.email}</span>{' '}
            the moment your spot opens.
          </>
        )}
      </p>
      {!already ? (
        <p className="mt-2 text-[13px] text-text-muted">
          Keep an eye on your inbox.
        </p>
      ) : null}
      <Button variant="primary" size="md" onClick={props.onDone} className="mt-8">
        Done
      </Button>
    </motion.div>
  )
}
