'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  submitUnsubscribe,
  type UnsubscribeSubmitResult,
} from '@/lib/unsubscribe-submit'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/

type Status = 'idle' | 'submitting' | 'success' | 'error'

const ERROR_COPY: Record<
  Exclude<UnsubscribeSubmitResult & { ok: false }, never>['error'],
  string
> = {
  validation:
    'Enter a valid email address or a phone number in international format (e.g. +19195551234).',
  invalid_token:
    'That one-click link is invalid or expired. Enter your email or phone below and we’ll opt you out.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  server:
    'Something went wrong on our end. Email support@usemingla.com and we’ll honor your opt-out manually.',
  network:
    'We couldn’t reach our servers. Check your connection and try again, or email support@usemingla.com.',
}

export function UnsubscribeForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [scope, setScope] = useState<'marketing' | 'all'>('marketing')
  const [status, setStatus] = useState<Status>('idle')
  const [errorKey, setErrorKey] = useState<
    keyof typeof ERROR_COPY | null
  >(null)
  const [successScope, setSuccessScope] = useState<'marketing' | 'all'>(
    'marketing',
  )

  const trimmedEmail = email.trim()
  const trimmedPhone = phone.trim()
  const emailValid = trimmedEmail.length === 0 || EMAIL_REGEX.test(trimmedEmail)
  const phoneValid = trimmedPhone.length === 0 || PHONE_REGEX.test(trimmedPhone)
  // With a token present, the email is filled server-side, so no typed contact
  // is required. Without a token, at least one valid contact must be entered.
  const hasContact =
    token.length > 0 ||
    (trimmedEmail.length > 0 && EMAIL_REGEX.test(trimmedEmail)) ||
    (trimmedPhone.length > 0 && PHONE_REGEX.test(trimmedPhone))
  const canSubmit =
    status !== 'submitting' && hasContact && emailValid && phoneValid

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setStatus('submitting')
    setErrorKey(null)

    const result = await submitUnsubscribe({
      ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
      ...(trimmedPhone.length > 0 ? { phone: trimmedPhone } : {}),
      ...(token.length > 0 ? { token } : {}),
      scope,
    })

    if (result.ok) {
      setSuccessScope(result.scope)
      setStatus('success')
      return
    }
    setErrorKey(result.error)
    setStatus('error')
  }

  if (status === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="form-ok"
      >
        <p className="h3">You’re opted out.</p>
        <p>
          {successScope === 'all'
            ? 'You won’t receive marketing or non-essential messages from Mingla or the businesses you’ve booked with anymore.'
            : 'You won’t receive marketing messages from Mingla or the businesses you’ve booked with anymore. You may still get essential messages about bookings you make (confirmations, changes, refunds).'}
        </p>
        <p className="hint">
          Your request is honored immediately. If you opted out by mistake or
          have questions, email{' '}
          <a href="mailto:support@usemingla.com">
            support@usemingla.com
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="account-form">
      <p className="muted">
        Enter the email address or phone number you’d like to opt out, choose
        what to stop, and we’ll honor it right away. You don’t need an account or
        to log in.
      </p>

      <div className="field">
        <label
          htmlFor="unsub-email"
        >
          Email address
        </label>
        <input
          id="unsub-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={!emailValid}
          className={emailValid ? undefined : 'invalid'}
        />
      </div>

      <div className="field">
        <label
          htmlFor="unsub-phone"
        >
          Phone number (international format)
        </label>
        <input
          id="unsub-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+19195551234"
          aria-invalid={!phoneValid}
          className={phoneValid ? undefined : 'invalid'}
        />
        <p className="hint">
          Enter at least one — email or phone. Phone must start with + and your
          country code.
        </p>
      </div>

      <fieldset className="choice">
        <legend>
          What would you like to stop?
        </legend>
        <label className="radio">
          <input
            type="radio"
            name="scope"
            value="marketing"
            checked={scope === 'marketing'}
            onChange={() => setScope('marketing')}
          />
          <span>
            <span className="strong">Marketing only</span> —
            stop promotions and announcements. You’ll still get essential
            messages about bookings you make.
          </span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="scope"
            value="all"
            checked={scope === 'all'}
            onChange={() => setScope('all')}
          />
          <span>
            <span className="strong">All messages</span> — stop
            all non-essential messages on this email/phone.
          </span>
        </label>
      </fieldset>

      {status === 'error' && errorKey ? (
        <p
          role="alert"
          className="form-error"
        >
          {ERROR_COPY[errorKey]}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="btn ink full"
      >
        {status === 'submitting' ? 'Opting you out…' : 'Opt out'}
      </button>

      <p className="hint center">
        Opt-out requests are honored immediately. Mingla LLC, 700 Corporate
        Center Dr, Raleigh, NC 27607, USA.
      </p>
    </form>
  )
}
