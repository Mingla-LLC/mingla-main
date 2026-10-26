export type ClaimNoun = 'ticket' | 'pass' | 'booking' | 'receipt'

const TITLES: Record<ClaimNoun, string> = {
  ticket: 'Your ticket is in the Mingla app',
  pass: 'Your pass is in the Mingla app',
  booking: 'Your booking is in the Mingla app',
  receipt: 'Your receipt is in the Mingla app',
}

const BUTTONS: Record<ClaimNoun, string> = {
  ticket: 'Get my tickets',
  pass: 'Get my pass',
  booking: 'Get my booking',
  receipt: 'Get my receipt',
}

const DESKTOP_WAITING: Record<ClaimNoun, string> = {
  ticket: 'Your ticket is waiting in the Mingla app on your phone.',
  pass: 'Your pass is waiting in the Mingla app on your phone.',
  booking: 'Your booking is waiting in the Mingla app on your phone.',
  receipt: 'Your receipt is waiting in the Mingla app on your phone.',
}

export const CLAIM_LINK_COPY = {
  underButton: 'Already have Mingla? This button opens it.',
  scanPreparing: 'Preparing your code…',
  scanExpired: 'This code has expired.',
  scanRefresh: 'Get a new code',
  scanRateLimited: 'Too many codes for this ticket. Try again in a few minutes.',
  scanError:
    "We couldn't prepare a code. Your ticket is safe: open Mingla on your phone and sign in with the email or mobile number you used.",
  notFound:
    "We couldn't open this link. Your tickets are in the Mingla app: sign in with the email or mobile number you used.",
  notFoundButton: 'Get my tickets',
  scanDisclaimer: 'This is not your ticket. It works once, for 10 minutes.',
} as const

export function claimTitle(noun: ClaimNoun): string {
  return TITLES[noun]
}

export function claimButton(noun: ClaimNoun): string {
  return BUTTONS[noun]
}

export function desktopWaiting(noun: ClaimNoun): string {
  return DESKTOP_WAITING[noun]
}

export function scanInstruction(noun: ClaimNoun): string {
  if (noun === 'pass') return 'Scan with your phone camera to get your pass.'
  if (noun === 'booking') return 'Scan with your phone camera to get your booking.'
  if (noun === 'receipt') return 'Scan with your phone camera to get your receipt.'
  return 'Scan with your phone camera to get your tickets.'
}

export function signInLine(emailMasked: string | null, phoneLast4: string | null): string {
  if (emailMasked && phoneLast4) {
    return `Sign in with ${emailMasked} or the number ending ${phoneLast4}.`
  }
  if (emailMasked) return `Sign in with ${emailMasked}.`
  if (phoneLast4) return `Sign in with the number ending ${phoneLast4}.`
  return 'Sign in with the email or mobile number you used.'
}

export function expiredLine(
  noun: ClaimNoun,
  emailMasked: string | null,
  phoneLast4: string | null,
): string {
  const proof = signInLine(emailMasked, phoneLast4)
    .replace(/^Sign in /, 'sign in ')
    .replace(/\.$/, '')
  return `This link has expired. Your ${noun} is still yours: ${proof}.`
}

export function detailLine(
  title: string | null,
  startsAtLabel: string | null,
  orderLabel: string | null,
  noun: ClaimNoun,
): string | null {
  const parts = [title]
  if (noun === 'receipt') parts.push(orderLabel)
  parts.push(startsAtLabel)
  const clean = parts.filter((part): part is string => Boolean(part?.trim()))
  return clean.length > 0 ? clean.join(' · ') : null
}

export function formatClaimStartsAt(
  startsAt: string | null,
  timezone: string | null,
): string | null {
  if (!startsAt) return null
  const instant = new Date(startsAt)
  if (!Number.isFinite(instant.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone: timezone || 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
      .format(instant)
      .replace(/[\u00a0\u202f]/g, ' ')
  } catch {
    return new Intl.DateTimeFormat('en', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
      .format(instant)
      .replace(/[\u00a0\u202f]/g, ' ')
  }
}
