// issue #4508 1.17 / 1.18 — the RSVP guest link without the app: claim-link
// ops `rsvp_guest_resolve` (who saved you a spot, which event) and
// `rsvp_guest_release` ("This isn't me"). Same transport as claim-link-client.

export interface RsvpGuestLanding {
  status: 'open' | 'claimed' | 'released' | 'ended' | 'not_eligible'
  inviterName: string
  inviterFirstName: string | null
  phoneLast4: string | null
  event: {
    title: string
    startsAt: string | null
    timezone: string | null
    venueLine: string | null
    brandName: string | null
    eventUrl: string | null
  } | null
  appLink: { oneLink: string; appScheme: string } | null
}

export type RsvpGuestResolveResult =
  | { kind: 'guest'; guest: RsvpGuestLanding }
  | { kind: 'not_guest' }
  | { kind: 'error' }

export type RsvpGuestReleaseOutcome =
  | 'released'
  | 'already_released'
  | 'already_claimed'
  | 'not_found'
  | 'error'

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const CODE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/
const STATUSES = new Set(['open', 'claimed', 'released', 'ended', 'not_eligible'])

async function invoke(
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> } | null> {
  if (!FUNCTIONS_URL || !ANON_KEY) return null
  try {
    const response = await fetch(`${FUNCTIONS_URL.replace(/\/$/, '')}/claim-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    })
    const value = (await response.json()) as unknown
    return {
      ok: response.ok,
      status: response.status,
      body:
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {},
    }
  } catch {
    return null
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

export function parseRsvpGuestLanding(body: Record<string, unknown>): RsvpGuestResolveResult {
  if (body.ok !== true) return { kind: 'error' }
  const status = text(body.status)
  if (status === null || status === 'not_found') return { kind: 'not_guest' }
  if (!STATUSES.has(status)) return { kind: 'error' }
  const event =
    body.event !== null && typeof body.event === 'object' && !Array.isArray(body.event)
      ? (body.event as Record<string, unknown>)
      : null
  const appLink =
    body.appLink !== null && typeof body.appLink === 'object' && !Array.isArray(body.appLink)
      ? (body.appLink as Record<string, unknown>)
      : null
  return {
    kind: 'guest',
    guest: {
      status: status as RsvpGuestLanding['status'],
      inviterName: text(body.inviterName) ?? 'A friend',
      inviterFirstName: text(body.inviterFirstName),
      phoneLast4: text(body.phoneLast4),
      event:
        event === null
          ? null
          : {
              title: text(event.title) ?? 'An event',
              startsAt: text(event.startsAt),
              timezone: text(event.timezone),
              venueLine: text(event.venueLine),
              brandName: text(event.brandName),
              eventUrl: text(event.eventUrl),
            },
      appLink:
        appLink !== null && typeof appLink.oneLink === 'string' && typeof appLink.appScheme === 'string'
          ? { oneLink: appLink.oneLink, appScheme: appLink.appScheme }
          : null,
    },
  }
}

export async function resolveRsvpGuest(
  rawCode: string,
  signal?: AbortSignal,
): Promise<RsvpGuestResolveResult> {
  const code = rawCode.trim().toUpperCase()
  if (!CODE.test(code)) return { kind: 'not_guest' }
  const result = await invoke({ op: 'rsvp_guest_resolve', code }, signal)
  if (!result || !result.ok) return { kind: 'error' }
  return parseRsvpGuestLanding(result.body)
}

export async function releaseRsvpGuest(rawCode: string): Promise<RsvpGuestReleaseOutcome> {
  const code = rawCode.trim().toUpperCase()
  if (!CODE.test(code)) return 'not_found'
  const result = await invoke({ op: 'rsvp_guest_release', code })
  if (!result) return 'error'
  const outcome = text(result.body.outcome)
  return outcome === 'released' ||
    outcome === 'already_released' ||
    outcome === 'already_claimed' ||
    outcome === 'not_found'
    ? outcome
    : 'error'
}
