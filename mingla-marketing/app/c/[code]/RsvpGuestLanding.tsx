'use client'

// issue #4508 1.17 / 1.18 — the RSVP guest link opened without the app:
// "{Inviter} saved you a spot. Your pass is in the Mingla app." with
// "Get the app and your pass", "I already have Mingla" and "This isn't me".
// Every status has its own message and a way forward.

import { useState } from 'react'
import {
  releaseRsvpGuest,
  type RsvpGuestLanding as Guest,
  type RsvpGuestReleaseOutcome,
} from '@/lib/rsvp-guest-client'
import type { ClaimLinkPlatform } from '@/lib/claim-link-client'

const DOWNLOAD_URL = 'https://usemingla.com/download'

export const RSVP_GUEST_COPY = {
  savedSpot: (inviter: string) => `${inviter} saved you a spot`,
  passInApp: 'Your pass is in the Mingla app.',
  getApp: 'Get the app and your pass',
  haveApp: 'I already have Mingla',
  notMe: "This isn't me",
  notMeConfirm: "We'll give the spot back and won't text this number about this event again.",
  notMeYes: 'Yes, give the spot back',
  notMeCancel: 'Keep my spot',
  releasing: 'Giving the spot back…',
  released: "Thanks for letting us know. We've given the spot back and won't text this number about this event again.",
  alreadyClaimed: 'This pass has already been claimed, so there is nothing to give back.',
  releaseFailed: "We couldn't reach Mingla. Check your connection and try again.",
  claimedTitle: 'This pass has been claimed',
  claimedBody: 'Open Mingla on the phone that claimed it to see the pass.',
  releasedTitle: 'This spot was given back',
  releasedBody: 'This invite is no longer active. You can still find the event in Mingla.',
  endedTitle: 'This event has ended',
  endedBody: "See what's on next in the Mingla app.",
  pendingTitle: 'Not confirmed yet',
  pendingBody: (inviter: string) =>
    `${inviter}'s RSVP is waiting for the host. We'll text you as soon as your spot is confirmed.`,
} as const

function formatWhen(startsAt: string | null, timezone: string | null): string | null {
  if (!startsAt) return null
  const date = new Date(startsAt)
  if (Number.isNaN(date.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(date)
  } catch {
    return null
  }
}

const BUTTON =
  'mt-4 flex min-h-12 w-full items-center justify-center rounded-full px-6 py-3 text-base font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-[#0d0d10]'
const PRIMARY = `${BUTTON} bg-warm text-[#111216] shadow-[0_16px_42px_rgba(235,120,37,0.24)] hover:brightness-105`
const SECONDARY = `${BUTTON} border border-white/25 text-white hover:bg-white/8`
const GHOST = `${BUTTON} text-white/70 underline-offset-4 hover:underline`

export function RsvpGuestLanding({
  code,
  guest,
  platform,
}: {
  code: string
  guest: Guest
  platform: ClaimLinkPlatform
}) {
  const [confirming, setConfirming] = useState(false)
  const [release, setRelease] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; outcome: RsvpGuestReleaseOutcome }
  >({ kind: 'idle' })
  const inviterFirst = guest.inviterFirstName ?? guest.inviterName
  const when = formatWhen(guest.event?.startsAt ?? null, guest.event?.timezone ?? null)
  const oneLink = guest.appLink?.oneLink ?? DOWNLOAD_URL
  // On a computer the app scheme opens nothing; the OneLink offers the stores.
  const appScheme = platform === 'desktop' ? oneLink : (guest.appLink?.appScheme ?? oneLink)

  const eventCard = guest.event ? (
    <div className="mt-6 rounded-[20px] border border-white/12 bg-white/[0.04] p-5 text-left">
      <p className="text-lg font-bold text-white">{guest.event.title}</p>
      {when ? <p className="mt-1 text-sm text-white/70">{when}</p> : null}
      {guest.event.venueLine ? <p className="text-sm text-white/70">{guest.event.venueLine}</p> : null}
      {guest.event.brandName ? (
        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-white/50">Hosted by {guest.event.brandName}</p>
      ) : null}
    </div>
  ) : null

  if (release.kind === 'done') {
    return (
      <>
        <p className="mt-5 text-base leading-7 text-white/75" role="status">
          {release.outcome === 'already_claimed'
            ? RSVP_GUEST_COPY.alreadyClaimed
            : release.outcome === 'error'
              ? RSVP_GUEST_COPY.releaseFailed
              : RSVP_GUEST_COPY.released}
        </p>
        {release.outcome === 'error' ? (
          <button type="button" className={SECONDARY} onClick={() => setRelease({ kind: 'idle' })}>
            Try again
          </button>
        ) : (
          <a className={SECONDARY} href={DOWNLOAD_URL}>
            See what&rsquo;s on in Mingla
          </a>
        )}
      </>
    )
  }

  if (guest.status !== 'open') {
    const [title, body] =
      guest.status === 'claimed'
        ? [RSVP_GUEST_COPY.claimedTitle, RSVP_GUEST_COPY.claimedBody]
        : guest.status === 'released'
          ? [RSVP_GUEST_COPY.releasedTitle, RSVP_GUEST_COPY.releasedBody]
          : guest.status === 'ended'
            ? [RSVP_GUEST_COPY.endedTitle, RSVP_GUEST_COPY.endedBody]
            : [RSVP_GUEST_COPY.pendingTitle, RSVP_GUEST_COPY.pendingBody(inviterFirst)]
    return (
      <>
        <p className="mt-4 text-lg font-bold text-white">{title}</p>
        <p className="mt-2 text-base leading-7 text-white/70">{body}</p>
        {eventCard}
        <a className={PRIMARY} href={guest.status === 'claimed' ? appScheme : oneLink}>
          {guest.status === 'claimed' ? 'Open Mingla' : 'Get the Mingla app'}
        </a>
      </>
    )
  }

  return (
    <>
      <p className="mt-4 text-base leading-7 text-white/75">{RSVP_GUEST_COPY.passInApp}</p>
      {eventCard}
      <a className={PRIMARY} href={oneLink} data-testid="issue-4508-guest-get-app">
        {RSVP_GUEST_COPY.getApp}
      </a>
      <a className={SECONDARY} href={appScheme} data-testid="issue-4508-guest-have-app">
        {RSVP_GUEST_COPY.haveApp}
      </a>
      {confirming ? (
        <div className="mt-5 rounded-[18px] border border-white/12 p-4 text-left" role="group" aria-label={RSVP_GUEST_COPY.notMe}>
          <p className="text-sm leading-6 text-white/75">{RSVP_GUEST_COPY.notMeConfirm}</p>
          <button
            type="button"
            className={SECONDARY}
            disabled={release.kind === 'busy'}
            aria-busy={release.kind === 'busy'}
            onClick={() => {
              setRelease({ kind: 'busy' })
              void releaseRsvpGuest(code).then((outcome) => setRelease({ kind: 'done', outcome }))
            }}
          >
            {release.kind === 'busy' ? RSVP_GUEST_COPY.releasing : RSVP_GUEST_COPY.notMeYes}
          </button>
          <button
            type="button"
            className={GHOST}
            disabled={release.kind === 'busy'}
            onClick={() => setConfirming(false)}
          >
            {RSVP_GUEST_COPY.notMeCancel}
          </button>
        </div>
      ) : (
        <button type="button" className={GHOST} onClick={() => setConfirming(true)} data-testid="issue-4508-guest-not-me">
          {RSVP_GUEST_COPY.notMe}
        </button>
      )}
    </>
  )
}
