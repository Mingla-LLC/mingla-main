import type { ClaimNoun } from '@/app/c/[code]/copy'

export type ClaimLinkPlatform = 'ios' | 'android' | 'desktop'

export interface ResolvedClaimLink {
  status: 'active' | 'expired'
  code: string
  redirectCode: string | null
  noun: ClaimNoun
  title: string | null
  orderLabel: string | null
  startsAt: string | null
  timezone: string | null
  emailMasked: string | null
  phoneLast4: string | null
  appLink: { oneLink: string; appScheme: string }
}

export type ClaimLinkResolveResult =
  | { kind: 'claim'; claim: ResolvedClaimLink }
  | { kind: 'redirect'; url: string }
  | { kind: 'not_found' }
  | { kind: 'error'; reason: 'rate_limited' | 'unavailable' }

export type ClaimLinkHandoffResult =
  | { ok: true; handoffUrl: string; expiresAt: string }
  | { ok: false; reason: 'rate_limited' | 'unavailable' }

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const CODE = /^[0-9A-Za-z]{10}$/
const NOUNS = new Set<ClaimNoun>(['ticket', 'pass', 'booking', 'receipt'])

function endpoint(): string | null {
  if (!FUNCTIONS_URL || !ANON_KEY) return null
  return `${FUNCTIONS_URL.replace(/\/$/, '')}/claim-link`
}

async function invoke(
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ response: Response; body: Record<string, unknown> } | null> {
  const url = endpoint()
  if (!url) return null
  try {
    const response = await fetch(url, {
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
      response,
      body:
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {},
    }
  } catch {
    return null
  }
}

const nullableString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

export async function resolveClaimLink(
  rawCode: string,
  signal?: AbortSignal,
): Promise<ClaimLinkResolveResult> {
  const code = rawCode.trim().toUpperCase()
  if (!CODE.test(code)) return { kind: 'not_found' }
  const result = await invoke({ op: 'resolve', code }, signal)
  if (!result) return { kind: 'error', reason: 'unavailable' }
  if (result.response.status === 429) return { kind: 'error', reason: 'rate_limited' }
  if (!result.response.ok || result.body.ok !== true) {
    return { kind: 'error', reason: 'unavailable' }
  }
  if (result.body.status === 'redirect' && typeof result.body.url === 'string') {
    return { kind: 'redirect', url: result.body.url }
  }
  if (result.body.status === 'not_found') return { kind: 'not_found' }
  if (result.body.status !== 'active' && result.body.status !== 'expired') {
    return { kind: 'error', reason: 'unavailable' }
  }
  const noun = NOUNS.has(result.body.noun as ClaimNoun)
    ? (result.body.noun as ClaimNoun)
    : 'ticket'
  const appLink = result.body.appLink
  if (
    appLink === null ||
    typeof appLink !== 'object' ||
    Array.isArray(appLink) ||
    typeof (appLink as Record<string, unknown>).oneLink !== 'string' ||
    typeof (appLink as Record<string, unknown>).appScheme !== 'string'
  ) {
    return { kind: 'error', reason: 'unavailable' }
  }
  return {
    kind: 'claim',
    claim: {
      status: result.body.status,
      code,
      redirectCode: nullableString(result.body.redirectCode),
      noun,
      title: nullableString(result.body.title),
      orderLabel: nullableString(result.body.orderLabel),
      startsAt: nullableString(result.body.startsAt),
      timezone: nullableString(result.body.timezone),
      emailMasked: nullableString(result.body.emailMasked),
      phoneLast4: nullableString(result.body.phoneLast4),
      appLink: {
        oneLink: (appLink as Record<string, string>).oneLink,
        appScheme: (appLink as Record<string, string>).appScheme,
      },
    },
  }
}

export async function mintClaimLinkHandoff(
  rawCode: string,
  signal?: AbortSignal,
): Promise<ClaimLinkHandoffResult> {
  const code = rawCode.trim().toUpperCase()
  if (!CODE.test(code)) return { ok: false, reason: 'unavailable' }
  const result = await invoke({ op: 'handoff', code }, signal)
  if (!result) return { ok: false, reason: 'unavailable' }
  if (result.response.status === 429) return { ok: false, reason: 'rate_limited' }
  if (
    !result.response.ok ||
    result.body.ok !== true ||
    typeof result.body.handoffUrl !== 'string' ||
    typeof result.body.expiresAt !== 'string'
  ) {
    return { ok: false, reason: 'unavailable' }
  }
  return {
    ok: true,
    handoffUrl: result.body.handoffUrl,
    expiresAt: result.body.expiresAt,
  }
}
