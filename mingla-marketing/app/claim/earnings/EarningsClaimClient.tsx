'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'

export function EarningsClaimClient() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const valid = /^[A-Za-z0-9_-]{32,200}$/.test(token)
  const appUrl = useMemo(
    () => valid ? `mingla://claim/earnings?token=${encodeURIComponent(token)}` : '',
    [token, valid],
  )
  return (
    <main className="min-h-screen bg-[#09090b] text-white grid place-items-center px-5 py-16">
      <section className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-white/[0.045] p-7 sm:p-10">
        <p className="text-xs font-extrabold tracking-[0.16em] text-orange-400">REFERRAL REWARDS</p>
        <h1 className="mt-3 text-4xl font-black leading-tight">Claim what you earned</h1>
        <p className="mt-4 leading-7 text-white/65">
          Mingla matches this private claim to the exact verified email that received it. The link never reveals the reward amount or your email on this page.
        </p>
        {valid ? (
          <>
            <a className="mt-7 inline-flex min-h-12 items-center rounded-full bg-orange-500 px-6 font-extrabold text-white" href={appUrl} rel="nofollow">
              Open Mingla to claim
            </a>
            <p className="mt-4 text-sm leading-6 text-white/50">Sign in with the email that received the link. After the match, your reward history, vouchers and eligible payout details appear under Earnings &amp; rewards.</p>
          </>
        ) : (
          <p className="mt-6 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-red-100">This claim link is incomplete. Use the full private link from the email.</p>
        )}
      </section>
    </main>
  )
}
