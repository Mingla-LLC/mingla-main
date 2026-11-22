/**
 * Extract the real error message from a Supabase FunctionsHttpError.
 *
 * supabase-js v2 wraps non-2xx edge-function responses in a
 * FunctionsHttpError whose `.message` is the generic string
 * "Edge Function returned a non-2xx status code".
 * The actual response is stored as `error.context` (a Response object).
 *
 * IMPORTANT: We read the body as TEXT first, then parse as JSON.
 * A Response body can only be consumed once — if .json() fails mid-stream,
 * .text() will also fail. Reading as text first is always safe.
 *
 * We use duck-typing (`typeof .text === 'function'`) instead of
 * `instanceof Response` because React Native polyfills can break
 * the instanceof check across JS realms.
 */

const GENERIC_SDK_MESSAGE = 'Edge Function returned a non-2xx status code'

export async function extractFunctionError(
  error: unknown,
  fallback: string,
): Promise<string> {
  try {
    const err = error as Record<string, unknown> | null | undefined
    if (!err) return fallback

    const ctx = err.context

    // Strategy 1: Read the Response body as text, then parse as JSON
    if (ctx && typeof (ctx as Response).text === 'function') {
      try {
        const raw = await (ctx as Response).text()

        // Try parsing as JSON
        try {
          const body = JSON.parse(raw)
          if (body?.error && typeof body.error === 'string') return body.error
          if (body?.message && typeof body.message === 'string') return body.message
          if (body?.msg && typeof body.msg === 'string') return body.msg
        } catch {
          // Not JSON — use raw text if it's short and not HTML
          if (raw && raw.length > 0 && raw.length < 200 && !raw.startsWith('<!')) {
            return raw
          }
        }
      } catch {
        // Body stream couldn't be read — fall through
      }
    }

    // Strategy 2: Use HTTP status code for a meaningful message when body is unavailable
    const ctx2 = err.context as Record<string, unknown> | undefined
    if (ctx2 && typeof (ctx2 as any).status === 'number') {
      const status = (ctx2 as any).status as number
      if (status === 400) return `${fallback} (bad request)`
      if (status === 401) return 'Session expired — please sign in again'
      if (status === 403) return 'Not authorized for this action'
      if (status === 404) return `${fallback} (not found)`
      if (status === 429) return 'Too many requests — try again in a moment'
      if (status >= 500) return `${fallback} (server error)`
    }

    // Strategy 3: Check if error.message is meaningful (not the generic SDK message)
    const msg = err.message
    if (
      typeof msg === 'string' &&
      msg.length > 0 &&
      !msg.startsWith('Edge Function returned')
    ) {
      return msg
    }
  } catch {
    // Defensive: if anything unexpected happens, fall through
  }

  return fallback
}

/** Read bounded `error` + `detail` from a FunctionsHttpError without double-consuming the body. */
export async function extractFunctionErrorFields(
  error: unknown,
  fallback: string,
): Promise<{
  token: string
  detail: string | null
  body: Record<string, unknown> | null
}> {
  try {
    const err = error as Record<string, unknown> | null | undefined
    if (!err) return { token: fallback, detail: null, body: null }

    const ctx = err.context
    if (ctx && typeof (ctx as Response).text === 'function') {
      try {
        const raw = await (ctx as Response).text()
        try {
          const body = JSON.parse(raw) as Record<string, unknown> & {
            error?: unknown
            detail?: unknown
            message?: unknown
          }
          const detail =
            typeof body.detail === 'string' && body.detail.length > 0
              ? body.detail
              : null
          if (typeof body.error === 'string' && body.error.length > 0) {
            return { token: body.error, detail, body }
          }
          if (typeof body.message === 'string' && body.message.length > 0) {
            return { token: body.message, detail, body }
          }
          if (detail !== null) return { token: fallback, detail, body }
        } catch {
          if (raw && raw.length > 0 && raw.length < 200 && !raw.startsWith('<!')) {
            return { token: raw, detail: null, body: null }
          }
        }
      } catch {
        // fall through
      }
    }

    const token = await extractFunctionError(error, fallback)
    return { token, detail: null, body: null }
  } catch {
    return { token: fallback, detail: null, body: null }
  }
}

// ─── #4561: send-otp failure contract (pure; shared by both sendOtp callers) ───

export type OtpDeliveryChannel = 'sms' | 'whatsapp' | 'call'

/**
 * What a failed send means. A body with no recognised `code` (an older
 * server, a network failure, a gateway page) is the retryable `send_failed`.
 */
export type SendOtpFailureCode =
  | 'channel_unavailable'
  | 'rate_limited'
  | 'phone_taken'
  | 'invalid_number'
  | 'send_failed'

export interface SendOtpFailure {
  success: false
  error: string
  code: SendOtpFailureCode
  /** On `channel_unavailable`: the refused channel. */
  channel?: OtpDeliveryChannel
  /** On `channel_unavailable`: the channels the server still allows. */
  alternatives?: OtpDeliveryChannel[]
}

const SEND_OTP_FAILURE_CODES: readonly SendOtpFailureCode[] = [
  'channel_unavailable',
  'rate_limited',
  'phone_taken',
  'invalid_number',
  'send_failed',
]
const OTP_CHANNELS: readonly OtpDeliveryChannel[] = ['sms', 'whatsapp', 'call']

function isOtpChannel(value: unknown): value is OtpDeliveryChannel {
  return typeof value === 'string' && (OTP_CHANNELS as readonly string[]).includes(value)
}

/** Map a send-otp error body (or none) to a failed result. */
export function readSendOtpFailure(
  body: Record<string, unknown> | null,
  message: string,
  requestedChannel: OtpDeliveryChannel,
): SendOtpFailure {
  const rawCode = body?.code
  const code: SendOtpFailureCode =
    typeof rawCode === 'string' && (SEND_OTP_FAILURE_CODES as readonly string[]).includes(rawCode)
      ? (rawCode as SendOtpFailureCode)
      : 'send_failed'
  const result: SendOtpFailure = { success: false, error: message, code }
  if (code === 'channel_unavailable') {
    const refused = body?.channel
    const channel = isOtpChannel(refused) ? refused : requestedChannel
    const offered = Array.isArray(body?.alternatives) ? (body?.alternatives as unknown[]) : []
    result.channel = channel
    result.alternatives = offered.filter(isOtpChannel).filter((c) => c !== channel)
  }
  return result
}

/** The channels the app offers people (WhatsApp is not offered: #4561 D-1). */
const OFFERED_CHANNELS: readonly OtpDeliveryChannel[] = ['sms', 'call']

/** Add a refused channel to the per-number list, without duplicates. */
export function withRefusedChannel(
  refused: readonly OtpDeliveryChannel[],
  channel: OtpDeliveryChannel,
): OtpDeliveryChannel[] {
  return refused.includes(channel) ? [...refused] : [...refused, channel]
}

/**
 * What the phone step's main button does for a number, given the channels
 * already refused for it: text, call, or nothing (both refused).
 */
export function phoneStepSendChannel(
  refused: readonly OtpDeliveryChannel[],
): OtpDeliveryChannel | null {
  const left = OFFERED_CHANNELS.filter((c) => !refused.includes(c))
  return left.length > 0 ? left[0] : null
}

/** The code screen's "try another way" options for a number. */
export function otpPickerChannels(
  refused: readonly OtpDeliveryChannel[],
): OtpDeliveryChannel[] {
  return OFFERED_CHANNELS.filter((c) => !refused.includes(c))
}

/** The support address shown under every Email support button (#4561 Q-2/Q-8). */
export const SUPPORT_EMAIL = 'support@usemingla.com'
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`
