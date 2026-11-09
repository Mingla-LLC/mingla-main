// #4339 §5 — "Prompt your website into existence" → Ari: the marketing half of
// the draft hand-off.
//
// 1. On Generate, the description is POSTed (body only, never a URL) to the
//    public `site-prompt-draft` edge function, which stores it for 24 hours and
//    answers with an opaque draft id.
// 2. "Continue on Mingla Host" opens host web's sign-in with a resume path that
//    carries ONLY that id: /auth?next=/ari?draft=<id>. Host web keeps `next`
//    through email sign-in, Google/Apple and sign-up (the ORCH-1375 resume
//    path), then the Ari tab claims the draft and sends it to Ari.
// 3. Every device goes to host web, phones included (round 3, point 1): the
//    one deliberate exception to "phones go to the store".
// 4. Any failure (no env, network, timeout, refusal) resolves to null, and
//    Continue opens host web's front door with nothing attached.
//
// The host web origin comes from lib/cta-destination.ts (#4137 seam); this file
// holds no URL constant. React-free and pure, so the node test loads it.

import { resolveCtaDestinations } from './cta-destination'
import type { OneLinkAttribution } from './links-src'

export const DRAFT_POST_TIMEOUT_MS = 8000

const DRAFT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DraftTransport {
  /** `<supabase>/functions/v1`, no trailing slash; null when not configured. */
  functionsBase: string | null
  anonKey: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** The functions base and anon key from the public build env. */
export function draftTransportFromEnv(): DraftTransport {
  const functions = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
  const rest = process.env.NEXT_PUBLIC_SUPABASE_URL
  const functionsBase = functions
    ? functions.replace(/\/$/, '')
    : rest
      ? `${rest.replace(/\/$/, '')}/functions/v1`
      : null
  return { functionsBase, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null }
}

/**
 * Store the description and return its draft id, or null on any failure. The
 * description travels in the POST body only.
 */
export async function postSitePromptDraft(description: string, transport: DraftTransport): Promise<string | null> {
  const { functionsBase, anonKey } = transport
  if (!functionsBase || !anonKey) return null
  const doFetch = transport.fetchImpl ?? fetch
  const aborter = new AbortController()
  const timer = setTimeout(() => aborter.abort(), transport.timeoutMs ?? DRAFT_POST_TIMEOUT_MS)
  try {
    const res = await doFetch(`${functionsBase}/site-prompt-draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ description: description.trim() }),
      signal: aborter.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { draft_id?: unknown }
    return typeof data.draft_id === 'string' && DRAFT_ID_RE.test(data.draft_id) ? data.draft_id : null
  } catch {
    // Network, abort or a non-JSON answer: Continue still works without a draft.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Where "Continue on Mingla Host" goes, on every device. With a draft: host
 * web's sign-in, resuming at the Ari tab with the draft id. Without one: host
 * web's front door.
 */
export function ariDraftContinueHref(draftId: string | null, attribution: OneLinkAttribution): string {
  const hostWeb = resolveCtaDestinations('host', attribution).computerHref
  if (draftId === null || !DRAFT_ID_RE.test(draftId)) return hostWeb
  const next = `/ari?draft=${draftId.toLowerCase()}`
  return resolveCtaDestinations('host', attribution, {
    hostComputerHref: `${hostWeb}/auth?next=${encodeURIComponent(next)}`,
  }).computerHref
}
