// META-ORCH-1222 [Careers site] — client submit transport for the apply form.
// Clone of lib/explorer-app-submit.ts transport: a thin, anon-safe POST to the
// public `careers-apply` edge function. The marketing app has NO Supabase
// client, so this uses a raw fetch with the public anon key in the
// Authorization + apikey headers. The anon key is public by design — RLS denies
// anon SELECT, and the edge fn re-validates + writes via the service role
// (I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT extends to careers libs).

export interface CareersApplyClientInput {
  job_slug: string
  full_name: string
  email: string
  whatsapp_phone: string
  preferred_salary: string
  portfolio_url: string
  cv_base64: string
  cv_filename: string
  cv_mime: string
}

export type CareersApplyResult =
  | { ok: true }
  | { ok: false; error: 'validation'; fields?: string[] }
  | { ok: false; error: 'rate_limited' | 'server' | 'network' }

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export async function submitCareersApplication(
  input: CareersApplyClientInput,
  signal?: AbortSignal,
): Promise<CareersApplyResult> {
  if (!FUNCTIONS_URL || !ANON_KEY) {
    if (typeof console !== 'undefined') {
      console.error(
        '[careers-apply-submit] Missing NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL or ' +
          'NEXT_PUBLIC_SUPABASE_ANON_KEY — see mingla-marketing/.env.example',
      )
    }
    return { ok: false, error: 'network' }
  }

  let response: Response
  try {
    response = await fetch(`${FUNCTIONS_URL.replace(/\/$/, '')}/careers-apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify(input),
      signal,
    })
  } catch {
    // Thrown fetch (offline, DNS, abort) → network.
    return { ok: false, error: 'network' }
  }

  if (response.ok) {
    try {
      const body = (await response.json()) as { ok?: boolean }
      if (body?.ok) return { ok: true }
      // 200 but unexpected shape — treat as server error (no false success).
      return { ok: false, error: 'server' }
    } catch {
      return { ok: false, error: 'server' }
    }
  }

  if (response.status === 400) {
    // Surface the per-field list so the form can map errors to inputs.
    try {
      const body = (await response.json()) as { fields?: string[] }
      return { ok: false, error: 'validation', fields: body?.fields }
    } catch {
      return { ok: false, error: 'validation' }
    }
  }
  if (response.status === 429) return { ok: false, error: 'rate_limited' }
  // 405 / 5xx / anything else → server.
  return { ok: false, error: 'server' }
}

/**
 * Read a File into a base64 string (no data: prefix). Client-only (FileReader).
 * Resolves the base64 payload the edge fn decodes server-side.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('cv_read_failed'))
        return
      }
      // result is a data: URL; strip the prefix to get raw base64.
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('cv_read_failed'))
    reader.readAsDataURL(file)
  })
}
