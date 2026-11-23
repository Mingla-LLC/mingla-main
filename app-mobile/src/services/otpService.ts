import { trackedInvoke } from './supabase'
import {
  extractFunctionErrorFields,
  readSendOtpFailure,
  type OtpDeliveryChannel,
  type SendOtpFailureCode,
} from '../utils/edgeFunctionError'

export type OtpChannel = OtpDeliveryChannel
export type { SendOtpFailureCode }

export interface SendOtpResult {
  success: boolean
  error?: string
  status?: string
  channel?: OtpChannel
  /** Present on failure only. */
  code?: SendOtpFailureCode
  /** On `channel_unavailable`: the channels the server still allows. */
  alternatives?: OtpChannel[]
}

interface VerifyOtpResult {
  success: boolean
  error?: string
  /** #4561: e.g. `save_failed`, `phone_taken`; absent on older servers. */
  code?: string
}

const SEND_FAILED_TEXT = "Couldn't send code. Try again."

/**
 * Send OTP to the given phone number via Twilio Verify (proxied through edge function).
 * #4561: a failure carries a `code`; a body without one maps to `send_failed`.
 */
export async function sendOtp(phone: string, channel?: OtpChannel): Promise<SendOtpResult> {
  const { data, error } = await trackedInvoke('send-otp', {
    body: { phone, ...(channel && { channel }) },
  })
  const requested: OtpChannel = channel ?? 'sms'

  if (error) {
    const fields = await extractFunctionErrorFields(error, SEND_FAILED_TEXT)
    const failure = readSendOtpFailure(fields.body, fields.token, requested)
    console.error('[sendOtp] Edge function error:', error.name, failure.code)
    return failure
  }

  if (data?.error) {
    return readSendOtpFailure(data as Record<string, unknown>, String(data.error), requested)
  }

  return { success: true, status: data?.status, channel: data?.channel }
}

/**
 * Verify OTP code. On success, phone is saved to profiles.phone server-side.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const { data, error } = await trackedInvoke('verify-otp', {
    body: { phone, code },
  })

  if (error) {
    console.error('[verifyOtp] Edge function error:', error.name, error.message)
    const fields = await extractFunctionErrorFields(error, 'Verification failed. Try again.')
    console.error('[verifyOtp] Actual error:', fields.token)
    const code = typeof fields.body?.code === 'string' ? fields.body.code : undefined
    return { success: false, error: fields.token, ...(code ? { code } : {}) }
  }

  if (data?.error) {
    return { success: false, error: data.error }
  }

  return { success: true }
}
