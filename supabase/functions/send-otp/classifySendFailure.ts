/**
 * #4561: decide what a failed verification send means for the person.
 *
 * The provider's HTTP status alone cannot tell a refused destination from our
 * own outage: its fraud block (60410) arrives as a 403, and so can an account
 * problem. The rule therefore reads the provider's numeric error CODE first:
 *
 *   - 429, 60203 or 20429                      -> rate_limited
 *   - 60200 (invalid parameter: the number)    -> invalid_number
 *   - 401 or 404, any 200xx platform code,
 *     10001 (account not active) or 60223
 *     (channel disabled in the service)        -> account_config (our outage)
 *   - 5xx, a missing or non-numeric code       -> provider_error (retryable)
 *   - any other 4xx with a numeric code        -> channel_unavailable
 *
 * `account_config` and `provider_error` both reach the client as the
 * retryable `send_failed`; only a destination-level refusal (60410, 60605,
 * 21216, 60205 and codes we have never seen) becomes `channel_unavailable`.
 * Pure: no I/O, no provider text in the result.
 */

export type OtpChannel = 'sms' | 'whatsapp' | 'call'

export type SendFailureClass =
  | 'rate_limited'
  | 'invalid_number'
  | 'account_config'
  | 'provider_error'
  | 'channel_unavailable'

export type SendFailureCode =
  | 'rate_limited'
  | 'invalid_number'
  | 'send_failed'
  | 'channel_unavailable'

export interface SendFailure {
  /** Internal class: used for the alert tag and the log line. */
  failureClass: SendFailureClass
  /** Public code returned to the app. */
  code: SendFailureCode
  /** The provider's numeric code, or null when it sent none. */
  providerCode: number | null
}

const ACCOUNT_LEVEL_CODES: ReadonlySet<number> = new Set([
  10001, // Account is not active
  60223, // Delivery channel disabled in the Verify Service settings
])

function readProviderCode(body: unknown): number | null {
  if (body === null || typeof body !== 'object') return null
  const raw = (body as { code?: unknown }).code
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string' && /^\d{3,6}$/.test(raw)) return Number(raw)
  return null
}

function classOf(status: number, providerCode: number | null): SendFailureClass {
  if (status === 429 || providerCode === 60203 || providerCode === 20429) {
    return 'rate_limited'
  }
  if (providerCode === 60200) return 'invalid_number'
  // Our credentials, our account or our service id: a problem every person
  // would hit, so it must never be shown as "we can't reach your number".
  if (status === 401 || status === 404) return 'account_config'
  if (providerCode !== null) {
    if (providerCode >= 20000 && providerCode <= 20999) return 'account_config'
    if (ACCOUNT_LEVEL_CODES.has(providerCode)) return 'account_config'
  }
  if (status >= 500 || status < 400) return 'provider_error'
  // A 4xx without a readable code cannot be proven destination-level.
  if (providerCode === null) return 'provider_error'
  return 'channel_unavailable'
}

const PUBLIC_CODE: Record<SendFailureClass, SendFailureCode> = {
  rate_limited: 'rate_limited',
  invalid_number: 'invalid_number',
  account_config: 'send_failed',
  provider_error: 'send_failed',
  channel_unavailable: 'channel_unavailable',
}

export function classifySendFailure(status: number, body: unknown): SendFailure {
  const providerCode = readProviderCode(body)
  const failureClass = classOf(status, providerCode)
  return { failureClass, code: PUBLIC_CODE[failureClass], providerCode }
}

/** The channels the app may still offer after `refused` was refused. */
export function alternativesAfter(refused: OtpChannel): OtpChannel[] {
  return (['call'] as OtpChannel[]).filter((c) => c !== refused)
}

// Strings the installed app matches on or shows. Old builds read only `error`.
export const SEND_FAILED_TEXT = "Couldn't send code. Try again."
export const RATE_LIMITED_TEXT = 'Too many attempts. Try again later.'
export const INVALID_NUMBER_TEXT = 'Check that number — something looks off.'
export const CHANNEL_UNAVAILABLE_TEXT =
  "We can't text this number. Update Mingla to get your code by phone call."
