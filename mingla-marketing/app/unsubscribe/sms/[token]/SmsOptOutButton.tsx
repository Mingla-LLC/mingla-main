'use client'

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'done' | 'invalid' | 'error'

// #4273 — one button. Only a person's click opts out; opening the page never
// does. The POST goes to /unsubscribe/<token>, which mingla-marketing proxies
// to the marketing-unsubscribe edge function; it answers JSON.
export function SmsOptOutButton({ token }: { token: string | null }) {
  const [status, setStatus] = useState<Status>(token === null ? 'invalid' : 'idle')

  async function optOut() {
    if (token === null || status === 'submitting') return
    setStatus('submitting')
    try {
      const response = await fetch(`/unsubscribe/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null
      if (response.ok && body?.ok === true) {
        setStatus('done')
        return
      }
      setStatus(body?.error === 'link_invalid' || response.status === 400 ? 'invalid' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-warm/30 bg-warm/10 p-5 text-white/85"
      >
        <p className="font-display text-xl text-white">You’re opted out.</p>
        <p className="mt-2 text-sm leading-7 text-white/76 sm:text-base">
          You won’t get marketing texts from this host’s brands on Mingla anymore.
          Texts about tickets and RSVPs you make still reach you.
        </p>
        <p className="mt-3 text-sm leading-7 text-white/60">
          Opted out by mistake? Email{' '}
          <a
            href="mailto:support@usemingla.com"
            className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
          >
            support@usemingla.com
          </a>
          .
        </p>
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <div role="alert" className="rounded-2xl border border-white/14 bg-black/30 p-5 text-white/80">
        <p className="font-display text-xl text-white">This link isn’t valid.</p>
        <p className="mt-2 text-sm leading-7 text-white/70">
          You can still opt out on the{' '}
          <a href="/unsubscribe" className="font-semibold text-warm underline-offset-4 hover:underline focus-ring">
            opt-out page
          </a>{' '}
          by entering your number, or email support@usemingla.com.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm leading-7 text-white/72 sm:text-base">
        You’ll stop getting marketing texts from every brand this host runs on
        Mingla. Texts about tickets and RSVPs you make still reach you.
      </p>
      <button
        type="button"
        onClick={optOut}
        disabled={status === 'submitting'}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-warm px-6 text-base font-semibold text-black transition hover:brightness-110 disabled:opacity-60 focus-ring"
      >
        {status === 'submitting' ? 'Stopping…' : 'Stop marketing texts'}
      </button>
      {status === 'error' ? (
        <p role="alert" className="text-sm text-red-300">
          Something went wrong on our end. Try again, or email support@usemingla.com
          and we’ll stop the texts manually.
        </p>
      ) : null}
    </div>
  )
}
