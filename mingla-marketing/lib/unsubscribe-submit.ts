// META-ORCH-1161 COMPLIANCE-PAGES — client submit transport for /unsubscribe.
//
// Thin, anon-safe POST to the public `self-serve-unsubscribe` edge function.
// The marketing app has NO Supabase client (no @supabase/supabase-js dependency),
// so this uses a raw `fetch` with the public anon key in the Authorization +
// apikey headers — mirroring lib/beta-access-submit.ts exactly. The anon key is
// public by design: RLS denies anon writes and the edge fn writes via the service
// role. The edge fn re-validates everything; this transport only shapes the call.

export interface UnsubscribeInput {
  /** Lowercased on the server; either email or phone (or both) must be present. */
  email?: string
  /** E.164 (e.g. +19195551234). */
  phone?: string
  /** marketing = stop promos, keep transactional; all = stop everything. */
  scope: 'marketing' | 'all'
  /** Optional one-click email token (?token=). When present, pre-fills email server-side. */
  token?: string
}

export type UnsubscribeSubmitResult =
  | { ok: true; scope: 'marketing' | 'all' }
  | {
      ok: false
      error: 'validation' | 'invalid_token' | 'rate_limited' | 'server' | 'network'
    }

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export async function submitUnsubscribe(
  input: UnsubscribeInput,
  signal?: AbortSignal,
): Promise<UnsubscribeSubmitResult> {
  if (!FUNCTIONS_URL || !ANON_KEY) {
    if (typeof console !== 'undefined') {
      console.error(
        '[unsubscribe-submit] Missing NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL or ' +
          'NEXT_PUBLIC_SUPABASE_ANON_KEY — see mingla-marketing/.env.example',
      )
    }
    return { ok: false, error: 'network' }
  }

  let response: Response
  try {
    response = await fetch(
      `${FUNCTIONS_URL.replace(/\/$/, '')}/self-serve-unsubscribe`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
        },
        body: JSON.stringify(input),
        signal,
      },
    )
  } catch {
    return { ok: false, error: 'network' }
  }

  if (response.ok) {
    try {
      const body = (await response.json()) as {
        ok?: boolean
        scope?: 'marketing' | 'all'
      }
      if (body?.ok) {
        return { ok: true, scope: body.scope ?? input.scope }
      }
      return { ok: false, error: 'server' }
    } catch {
      return { ok: false, error: 'server' }
    }
  }

  if (response.status === 400) {
    // Distinguish a dead one-click token from a plain validation miss so the
    // page can fall back to the manual form with the right message.
    try {
      const body = (await response.json()) as { error?: string }
      if (body?.error === 'invalid_token') return { ok: false, error: 'invalid_token' }
    } catch {
      // fall through to generic validation
    }
    return { ok: false, error: 'validation' }
  }
  if (response.status === 429) return { ok: false, error: 'rate_limited' }
  return { ok: false, error: 'server' }
}
