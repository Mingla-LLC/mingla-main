'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'react-qr-code'
import {
  CLAIM_LINK_COPY,
  claimButton,
  claimTitle,
  desktopWaiting,
  detailLine,
  expiredLine,
  formatClaimStartsAt,
  scanInstruction,
  signInLine,
} from './copy'
import {
  mintClaimLinkHandoff,
  resolveClaimLink,
  type ClaimLinkHandoffResult,
  type ClaimLinkPlatform,
  type ClaimLinkResolveResult,
} from '@/lib/claim-link-client'

const DOWNLOAD_URL = 'https://usemingla.com/download'

interface ClaimLinkClientProps {
  code: string
  platform: ClaimLinkPlatform
}

type HandoffState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; handoffUrl: string; expiresAt: string }
  | { kind: 'expired' }
  | { kind: 'error'; reason: 'rate_limited' | 'unavailable' }

function PrimaryLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="mt-7 flex min-h-12 w-full items-center justify-center rounded-full bg-warm px-6 py-3 text-base font-bold text-[#111216] shadow-[0_16px_42px_rgba(235,120,37,0.24)] outline-none transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-[#0d0d10]"
    >
      {label}
    </a>
  )
}

export function ClaimLinkClient({ code, platform }: ClaimLinkClientProps) {
  const router = useRouter()
  const [resolved, setResolved] = useState<ClaimLinkResolveResult | null>(null)
  const [handoff, setHandoff] = useState<HandoffState>({ kind: 'idle' })

  useEffect(() => {
    const controller = new AbortController()
    void resolveClaimLink(code, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.kind === 'redirect') {
        window.location.replace(result.url)
        return
      }
      if (result.kind === 'claim' && result.claim.redirectCode) {
        router.replace(`/c/${result.claim.redirectCode}`)
        return
      }
      setResolved(result)
    })
    return () => controller.abort()
  }, [code, router])

  const mintHandoff = useCallback(async () => {
    setHandoff({ kind: 'loading' })
    const result: ClaimLinkHandoffResult = await mintClaimLinkHandoff(code)
    setHandoff(
      result.ok
        ? { kind: 'ready', handoffUrl: result.handoffUrl, expiresAt: result.expiresAt }
        : { kind: 'error', reason: result.reason },
    )
  }, [code])

  useEffect(() => {
    if (platform !== 'desktop' || resolved?.kind !== 'claim') return
    if (resolved.claim.status !== 'active' || handoff.kind !== 'idle') return
    void mintHandoff()
  }, [handoff.kind, mintHandoff, platform, resolved])

  useEffect(() => {
    if (handoff.kind !== 'ready') return
    const delay = new Date(handoff.expiresAt).getTime() - Date.now()
    if (!Number.isFinite(delay) || delay <= 0) {
      setHandoff({ kind: 'expired' })
      return
    }
    const timeout = window.setTimeout(
      () => setHandoff({ kind: 'expired' }),
      Math.min(delay, 2_147_483_647),
    )
    return () => window.clearTimeout(timeout)
  }, [handoff])

  const content = useMemo(() => {
    if (resolved?.kind !== 'claim') return null
    const startsAtLabel = formatClaimStartsAt(
      resolved.claim.startsAt,
      resolved.claim.timezone,
    )
    return {
      title: claimTitle(resolved.claim.noun),
      details: detailLine(
        resolved.claim.title,
        startsAtLabel,
        resolved.claim.orderLabel,
        resolved.claim.noun,
      ),
      signIn: signInLine(resolved.claim.emailMasked, resolved.claim.phoneLast4),
      expired: expiredLine(
        resolved.claim.noun,
        resolved.claim.emailMasked,
        resolved.claim.phoneLast4,
      ),
    }
  }, [resolved])

  if (resolved === null || resolved.kind === 'redirect') {
    return <ClaimShell title="Opening your Mingla link…" />
  }

  if (resolved.kind === 'not_found' || resolved.kind === 'error' || !content) {
    return (
      <ClaimShell title="Your tickets are in Mingla">
        <p className="mt-4 text-base leading-7 text-white/70">{CLAIM_LINK_COPY.notFound}</p>
        <PrimaryLink href={DOWNLOAD_URL} label={CLAIM_LINK_COPY.notFoundButton} />
      </ClaimShell>
    )
  }

  const { claim } = resolved
  const isDesktop = platform === 'desktop'

  return (
    <ClaimShell title={content.title}>
      {content.details ? (
        <p className="mt-4 text-sm font-semibold leading-6 text-white/80">{content.details}</p>
      ) : null}

      {claim.status === 'expired' ? (
        <>
          <p className="mt-5 text-base leading-7 text-white/70">{content.expired}</p>
          <PrimaryLink href={claim.appLink.oneLink} label={claimButton(claim.noun)} />
          <p className="mt-3 text-sm leading-6 text-white/52">{CLAIM_LINK_COPY.underButton}</p>
        </>
      ) : isDesktop ? (
        <>
          <p className="mt-5 text-base leading-7 text-white/70">{desktopWaiting(claim.noun)}</p>
          <p className="mt-2 text-sm leading-6 text-white/60">{content.signIn}</p>
          <DesktopHandoff state={handoff} noun={claim.noun} onRefresh={mintHandoff} />
        </>
      ) : (
        <>
          <p className="mt-5 text-base leading-7 text-white/70">{content.signIn}</p>
          <PrimaryLink href={claim.appLink.oneLink} label={claimButton(claim.noun)} />
          <p className="mt-3 text-sm leading-6 text-white/52">{CLAIM_LINK_COPY.underButton}</p>
        </>
      )}
    </ClaimShell>
  )
}

function DesktopHandoff({
  state,
  noun,
  onRefresh,
}: {
  state: HandoffState
  noun: 'ticket' | 'pass' | 'booking' | 'receipt'
  onRefresh: () => Promise<void>
}) {
  if (state.kind === 'idle' || state.kind === 'loading') {
    return <p className="mt-8 text-sm text-white/60">{CLAIM_LINK_COPY.scanPreparing}</p>
  }
  if (state.kind === 'expired') {
    return (
      <div className="mt-8">
        <p className="text-sm text-white/68">{CLAIM_LINK_COPY.scanExpired}</p>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="mt-4 min-h-12 rounded-full border border-white/25 px-6 py-3 text-sm font-bold text-white outline-none transition hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-white"
        >
          {CLAIM_LINK_COPY.scanRefresh}
        </button>
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <p className="mt-8 text-sm leading-6 text-white/68">
        {state.reason === 'rate_limited'
          ? CLAIM_LINK_COPY.scanRateLimited
          : CLAIM_LINK_COPY.scanError}
      </p>
    )
  }
  return (
    <div className="mt-8">
      <div className="mx-auto w-fit rounded-[22px] bg-white p-5 shadow-[0_1px_2px_rgba(14,14,16,0.1)]">
        <div
          role="img"
          aria-label={`${scanInstruction(noun)} This is not your ticket.`}
          className="h-[220px] w-[220px]"
        >
          <QRCode
            value={state.handoffUrl}
            size={220}
            fgColor="#0E0E10"
            bgColor="#FFFFFF"
            level="M"
            style={{ height: '100%', width: '100%', display: 'block' }}
          />
        </div>
      </div>
      <p className="mt-5 text-sm font-semibold leading-6 text-white/78">{scanInstruction(noun)}</p>
      <p className="mt-2 text-sm leading-6 text-white/52">{CLAIM_LINK_COPY.scanDisclaimer}</p>
    </div>
  )
}

function ClaimShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main
      id="main"
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#08090b] px-5 py-10 text-text-primary"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_12%,rgba(235,120,37,0.18),transparent_32%),radial-gradient(ellipse_at_84%_18%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(180deg,#08090b_0%,#0d0d10_58%,#07080a_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent" />
      </div>
      <article className="relative w-full max-w-md rounded-[28px] border border-white/12 bg-[#0d0d10]/94 p-7 text-center shadow-[0_40px_120px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">Mingla</p>
        <h1 className="mt-3 font-display text-4xl leading-tight text-white sm:text-5xl">{title}</h1>
        {children}
      </article>
    </main>
  )
}
